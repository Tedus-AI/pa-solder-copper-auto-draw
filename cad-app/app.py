"""Run with: streamlit run app.py --server.headless true."""
from dataclasses import asdict
from pathlib import Path
import tempfile

import plotly.graph_objects as go
import streamlit as st
import yaml

from pa_cad.design import Design, calculate
from pa_cad.export import export_bundle
from pa_cad.solid import copper_block, solder_preform


st.set_page_config(page_title="PA 銅塊與錫片自動出圖", layout="wide")
st.title("PA 銅塊與錫片自動出圖")
st.caption("雙迴焊設計流程：設定尺寸 → 銅塊 3D → 錫量與厚度 → 錫片 3D → STEP／DXF")
st.info("正式目標為可修改尺寸並再生的原生 Creo／Pro/E PRT 特徵樹，目前尚未完成。現階段可輸出 STEP 3D 與 DXF 2D。")
st.caption("所有尺寸單位為 mm。範例 PA 為 780/M1P；40×30 銅塊基座只是示範，請依 thermal／RF 結果修改。")

defaults = yaml.safe_load((Path(__file__).parent / "examples/780-m1p.yaml").read_text())
labels = {
    "package": {"length": "PA 長度", "width": "PA 寬度", "max_tolerance": "PA 最大尺寸增量",
                "support_height": "封裝支撐高度 SPH"},
    "pcb": {"opening_length": "PCB 開孔 M（長）", "opening_width": "PCB 開孔 N（寬）",
            "thickness": "PCB 厚度 C", "relief_diameter": "PCB relief 直徑 O",
            "placement_accuracy": "貼片機放置精度", "opening_tolerance": "PCB 開孔公差"},
    "copper": {"base_length": "銅塊外形 E（長）", "base_width": "銅塊外形 F（寬）",
               "base_thickness": "銅塊基座厚度 G（2.5 或 3）", "corner_radius": "銅塊四角半徑 R",
               "hole_diameter": "吊掛孔直徑 D", "hole_edge_offset": "吊掛孔中心距邊 C",
               "pad_size": "四角小凸台邊長 J"},
    "stack": {"lead_solder": "引腳下方錫厚 A", "board_solder": "銅塊與 PCB 間錫厚 B",
              "flange_gap": "PA flange 至大凸台平面 D", "pad_height": "小凸台高度 K／E"},
    "preform": {"chamfer": "錫片 45° 削角 Y", "trial_delta": "三款試片厚度增減量"},
}

with st.form("design"):
    name = st.text_input("設計名稱（英數字與 _ -）", defaults["name"])
    values = {"name": name}
    tabs = st.tabs(["PA／PCB", "銅塊", "高度堆疊／錫片"])
    for groups, tab in zip([("package", "pcb"), ("copper",), ("stack", "preform")], tabs):
        with tab:
            for group in groups:
                values[group] = {}
                cols = st.columns(2)
                for i, (field, label) in enumerate(labels[group].items()):
                    with cols[i % 2]:
                        values[group][field] = st.number_input(
                            label, value=float(defaults[group][field]), step=.01, format="%.4f", key=f"{group}.{field}"
                        )
    trial_choice = st.selectbox("試片厚度選擇", ["middle", "lower", "upper"])
    use_yaml = st.checkbox("改用進階 YAML 輸入（優先於上方欄位）")
    with st.expander("進階 YAML／批次流程參數"):
        yaml_text = st.text_area("YAML 設計參數", yaml.safe_dump(defaults, sort_keys=False), height=280)
    submitted = st.form_submit_button("計算並產生圖檔", type="primary")


def mesh(solid):
    vertices, triangles = solid.val().tessellate(.08, .15)
    return {"x": [v.x for v in vertices], "y": [v.y for v in vertices], "z": [v.z for v in vertices],
            "i": [t[0] for t in triangles], "j": [t[1] for t in triangles], "k": [t[2] for t in triangles]}


if submitted:
    st.session_state.pop("generated", None)
    try:
        values["trial_result"] = {"choice": trial_choice, "locked": False, "value": None, "signature": None, "confirmed_at": None}
        design = Design.from_mapping(yaml.safe_load(yaml_text) if use_yaml else values)
        result = calculate(design)
        with st.spinner("建立實體、驗證 STEP 並產生 DXF…"):
            with tempfile.TemporaryDirectory(prefix="pa-cad-") as work:
                folder = export_bundle(design, work)
                st.session_state["generated"] = {
                    "name": design.name,
                    "zip": (folder / f"{design.name}.zip").read_bytes(),
                    "yaml": (folder / "parameters.yaml").read_text(),
                    "result": asdict(result),
                    "copper": mesh(copper_block(design, result)),
                    "preform": mesh(solder_preform(design, result)),
                }
    except Exception as exc:
        st.error(f"無法產生圖檔：{exc}")

if generated := st.session_state.get("generated"):
    r = generated["result"]
    cols = st.columns(4)
    for col, label, value in zip(cols, ["中凸台總高 L", "錫片計算厚度 Z", "模型錫厚", "所需錫量"],
                                 [f"{r['boss_total_height']:.4f} mm", f"{r['calculated_thickness']:.6f} mm",
                                  f"{r['model_thickness']:.6f} mm", f"{r['solder_volume']:.4f} mm³"]):
        col.metric(label, value)
    st.success("銅塊與錫片均已建立為單一實體，STEP 已回讀驗證。")
    st.download_button("下載完整圖檔 ZIP（STEP＋DXF＋報告）", generated["zip"],
                       file_name=f"{generated['name']}.zip", mime="application/zip", type="primary")
    st.download_button("下載設計參數 YAML", generated["yaml"], file_name=f"{generated['name']}.yaml")
    cols = st.columns(2)
    for col, part, label, color in zip(cols, ["copper", "preform"], ["銅塊", "錫片"], ["#b87333", "#af52de"]):
        with col:
            fig = go.Figure(go.Mesh3d(**generated[part], color=color, flatshading=True, name=label))
            fig.update_layout(title=label, scene={"aspectmode": "data", "xaxis_title": "X / mm",
                                                 "yaxis_title": "Y / mm", "zaxis_title": "Z / mm"},
                              margin={"l": 0, "r": 0, "b": 0, "t": 40}, height=400)
            st.plotly_chart(fig, width="stretch")
    st.write("三款試片厚度（未取整） / mm：", [round(v, 6) for v in r["trial_thicknesses"]])
    with st.expander("計算過程與設計差異", expanded=True):
        for warning in r["warnings"]:
            st.warning(warning)
        st.json(r)
