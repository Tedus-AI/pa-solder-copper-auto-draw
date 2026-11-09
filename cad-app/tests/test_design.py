from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest
import yaml

from pa_cad.design import Design, calculate, ceil_tenth

ROOT = Path(__file__).parents[1]


@pytest.fixture
def data():
    return yaml.safe_load((ROOT / "examples/780-m1p.yaml").read_text())


def test_pdf_page13_numeric_regression(data):
    r = calculate(Design.from_mapping(data))
    assert (r.boss_length, r.boss_width) == (20.6, 9.8)
    assert r.boss_total_height == pytest.approx(.48)
    assert r.copper_to_flange == pytest.approx(.63)
    assert r.cavity_volume == pytest.approx(136.945107, abs=.0005)  # 4 relief half-discs, not p12's one circle
    assert r.boss_volume == pytest.approx(67.970, abs=.0005)
    assert r.solder_volume == pytest.approx(68.974707, abs=.0005)
    assert r.preform_area == pytest.approx(178.76)
    assert r.calculated_thickness == pytest.approx(.385850899214)
    assert r.recommended_opening == (20.9, 10.1)
    assert r.trial_thicknesses == pytest.approx((r.calculated_thickness-.15, r.calculated_thickness, r.calculated_thickness+.15))


def test_ceiling_without_rounding_down():
    assert ceil_tenth(20.57) == 20.6
    assert ceil_tenth(20.6) == 20.6
    assert ceil_tenth(20.60001) == 20.7


def test_stack_changes_gap_and_volume(data):
    d = Design.from_mapping(data)
    r1 = calculate(d)
    r2 = calculate(replace(d, pcb=replace(d.pcb, thickness=2.1)))
    assert r2.boss_total_height == pytest.approx(r1.boss_total_height+.1)
    assert r2.copper_to_flange == pytest.approx(r1.copper_to_flange+.1)
    assert r2.solder_volume > r1.solder_volume


@pytest.mark.parametrize("group,field,value", [
    ("package", "length", float("nan")), ("pcb", "thickness", True),
    ("copper", "base_width", 8), ("copper", "pad_size", 4),
    ("copper", "base_thickness", 2.9), ("copper", "hole_edge_offset", 0),
    ("stack", "flange_gap", .1),
     ("preform", "thickness_override", -1),
    ("pcb", "opening_length", 20), ("preform", "unknown", 1),
])
def test_invalid_inputs_rejected(data, group, field, value):
    data[group][field] = value
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_path_traversal_name_rejected(data):
    data["name"] = "../../outside"
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_project_display_metadata_roundtrips_without_changing_design_geometry(data):
    original = Design.from_mapping(data)
    original_result = calculate(original)
    data["project"] = {"name": "  基地台 PA 專案 / A  ", "pa_model": '  H-37248KC-6/2 "Rev A"  '}
    updated = Design.from_mapping(data)
    assert updated.name == original.name
    assert updated.to_mapping()["project"] == {"name": "基地台 PA 專案 / A", "pa_model": 'H-37248KC-6/2 "Rev A"', "pa_brand": ""}
    assert calculate(updated) == original_result
    assert Design.from_mapping(updated.to_mapping()) == updated
    data["project"]["pa_model"] = " "
    assert Design.from_mapping(data).project.pa_model == ""
    assert original.project.name == "未命名專案"


@pytest.mark.parametrize("project", [None, {"name": ""}, {"name": "a"*101},
                                     {"pa_model": None}, {"name": "row\nbreak"}, {"unexpected": "x"}])
def test_invalid_project_display_metadata_is_rejected(data, project):
    data["project"] = project
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_no_inferred_base_dimensions(data):
    del data["copper"]["base_length"]
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_override_changes_model_only(data):
    r1 = calculate(Design.from_mapping(data))
    data["trial_result"] = {"choice":"upper", "locked":False}
    r2 = calculate(Design.from_mapping(data))
    assert r2.model_thickness == pytest.approx(r2.calculated_thickness+.15)
    assert r2.calculated_thickness == r1.calculated_thickness
    assert r2.trial_thicknesses == r1.trial_thicknesses


def test_trial_conflict_and_clearance_visible(data):
    r = calculate(Design.from_mapping(data))
    assert r.corner_clearance == pytest.approx(.282842712474619)
    assert any("0.15" in w for w in r.warnings)
    assert any("0.2828 mm" in w for w in r.warnings)


def test_browser_layout_metadata_roundtrip_preserves_manufacturing_geometry(data):
    original = calculate(Design.from_mapping(data))
    data["layout"] = {"border_width": 1.5, "epad_size": 2, "web_width": .4, "hole_clearance": 4}
    design = Design.from_mapping(data)
    updated = calculate(design)
    assert design.to_mapping()["layout"] == data["layout"]
    assert updated.boss_volume == original.boss_volume
    assert updated.model_thickness == original.model_thickness


def test_browser_auto_opening_and_rule_roundtrip(data):
    data["pcb"].update(opening_mode="auto", opening_rule="delta")
    data["package"].update(length=20.62, width=9.83)
    delta = Design.from_mapping(data)
    assert (delta.pcb.opening_length, delta.pcb.opening_width) == (21, 10.2)
    assert (calculate(delta).boss_length, calculate(delta).boss_width) == (20.7, 9.9)
    data["pcb"]["opening_rule"] = "ampleon"
    ampleon = Design.from_mapping(data)
    assert (ampleon.pcb.opening_length, ampleon.pcb.opening_width) == (20.9, 10.1)
    assert calculate(ampleon).model_thickness != calculate(delta).model_thickness
    assert Design.from_mapping(ampleon.to_mapping()) == ampleon


@pytest.mark.parametrize("key,value", [("opening_mode", True), ("opening_rule", "invalid")])
def test_invalid_opening_linkage_rejected(data, key, value):
    data["pcb"][key] = value
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_modern_browser_boss_and_tolerance_metadata(data):
    data["boss"] = {"length": 21, "width": 10,
                    "center_from_left": 21, "center_from_bottom": 14,
                    "size_mode": "manual", "height_mode": "auto"}
    data["pcb"].update(opening_length=21.5, opening_width=10.5)
    data["preform"].update(length=21, width=10)
    data["tolerances"] = {"package.length": {"minus": .1, "plus": .2},
                          "pcb.opening_length": {"minus": .15, "plus": .1},
                          "boss.length": {"minus": .05, "plus": .05}}
    d = Design.from_mapping(data)
    r = calculate(d)
    assert (r.boss_length, r.boss_width) == (21, 10)
    assert r.boss_total_height == pytest.approx(.48)
    assert any("未置中" in w for w in r.warnings)
    assert r.boss_center == (1, -1)
    assert r.gap_analysis["x"]["min"] == pytest.approx((21.5-.15-20.57-.2)/2)
    assert r.gap_analysis["x"]["max"] == pytest.approx((21.5+.1-20.57+.1)/2)
    assert Design.from_mapping(d.to_mapping()) == d


def test_gap_bounds_use_dimensions_not_placement_capability(data):
    data["pcb"]["placement_accuracy"] = 5
    r = calculate(Design.from_mapping(data))
    assert r.gap_analysis["x"]["min"] == pytest.approx(.0515)
    assert r.gap_analysis["x"]["max"] == pytest.approx(.2785)
    assert r.gap_analysis["y"]["min"] == pytest.approx(.0465)
    assert r.gap_analysis["y"]["max"] == pytest.approx(.2735)


def test_auto_opening_uses_asymmetric_undersize_allowance(data):
    data["pcb"]["opening_mode"] = "auto"
    data["tolerances"] = {"pcb.opening_length": {"minus": .2, "plus": 0}}
    r = calculate(Design.from_mapping(data))
    assert r.recommended_opening[0] == 21.0
    assert r.gap_analysis["x"]["min"] == pytest.approx(.0515)
    data["pcb"]["opening_rule"] = "ampleon"
    assert calculate(Design.from_mapping(data)).recommended_opening[0] == 20.9


def test_corner_hole_breakout_is_allowed_and_real_area_is_larger_than_full_circle_subtraction(data):
    import math
    data["copper"]["hole_edge_offset"] = 1
    d = Design.from_mapping(data)
    r = calculate(d)
    full_cut_area = 40*30-(4-math.pi)*3**2-2*math.pi*1.5**2
    assert r.copper_base_area > full_cut_area


def test_boss_offset_must_stay_on_rounded_base_and_away_from_holes(data):
    data["boss"] = {"center_from_left": 38, "center_from_bottom": 15}
    with pytest.raises(ValueError, match="中凸台"):
        Design.from_mapping(data)


def test_browser_trial_lock_is_portable_and_invalidated_after_geometry_change(data):
    import json
    import subprocess
    repo = ROOT.parent
    source = """import{calculate,defaults}from'./web/src/design.js';
const d=structuredClone(defaults);d.trial_result.choice='upper';const r=calculate(d);
d.trial_result={choice:'upper',locked:true,value:r.model_thickness,signature:r.trial_signature,confirmed_at:'2026-11-07T00:00:00Z'};
console.log(JSON.stringify(calculate(d).design));"""
    exported=json.loads(subprocess.check_output(['node','--input-type=module','-e',source],cwd=repo,text=True))
    d=Design.from_mapping(exported);r=calculate(d)
    assert r.trial_status=='locked'
    assert r.model_thickness==pytest.approx(r.calculated_thickness+.15)
    assert r.corner_clearance==pytest.approx(.282842712474619)
    exported['copper']['pad_size']=1.6
    stale=calculate(Design.from_mapping(exported))
    assert stale.trial_status=='stale'
    assert exported['trial_result']['value']==r.model_thickness


# --- Browser (web/src/design.js) / Python parity -------------------------------

def _node(source):
    import json
    import shutil
    import subprocess
    if not shutil.which("node"):
        pytest.skip("node is required for browser parity checks")
    return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", source], cwd=ROOT.parent, text=True))


def _parity_cases(data):
    cases = {"example": deepcopy(data)}
    c = deepcopy(data); c["project"] = {"name": "RRU 專案", "pa_brand": " NXP ", "pa_model": "X"}; cases["project_with_brand"] = c
    c = deepcopy(data); c["project"] = {"name": "RRU", "pa_vendor": "NXP"}; cases["unknown_project_field_rejected"] = c
    c = deepcopy(data); c["pcb"] = {k: v for k, v in c["pcb"].items() if k not in ("opening_length", "opening_width")}
    cases["no_opening_dims_is_auto"] = c
    c = deepcopy(data); c["pcb"]["opening_mode"] = "auto"; c["pcb"]["opening_rule"] = "ampleon"
    c["tolerances"] = {"pcb.opening_length": {"minus": .2}, "package.width": {"plus": .2, "source": "datasheet"}}
    cases["partial_tolerances_ampleon"] = c
    c = deepcopy(data); c["pcb"].update(opening_width=8.5, relief_diameter=4.4); c["package"]["width"] = 8
    c["boss"] = {"center_from_left": 18, "center_from_bottom": 14}
    cases["overlapping_relief_offset_boss"] = c
    c = deepcopy(data); c["stack"]["lead_solder"] = .12; cases["edited_stack_rejected"] = c
    c = deepcopy(data); c["boss"] = {"height_mode": "manual", "total_height": .5}; cases["manual_height_rejected"] = c
    c = deepcopy(data); c["tolerances"] = {"pcb.unknown": {"minus": 0, "plus": 0}}; cases["unknown_tolerance_rejected"] = c
    c = deepcopy(data); c["copper"]["hole_diameter"] = 15; cases["hole_too_large_rejected"] = c
    c = deepcopy(data); del c["copper"]["base_width"]; cases["missing_base_rejected"] = c
    return cases


def _python_summary(case):
    try:
        r = calculate(Design.from_mapping(case))
    except ValueError:
        return {"ok": False}
    return {"ok": True, "L": r.boss_total_height, "h": r.copper_to_flange, "cavity": r.cavity_volume,
            "solder": r.solder_volume, "z": r.calculated_thickness, "opening": list(r.recommended_opening),
            "gap": [r.gap_analysis[a][k] for a in "xy" for k in ("nominal", "min", "max")],
            "signature": r.trial_signature, "base_area": r.copper_base_area}


def test_browser_and_python_accept_and_compute_the_same_designs(data):
    import json
    cases = _parity_cases(data)
    source = """import{calculate}from'./web/src/design.js';
const cases=%s,out={};
for(const[name,c]of Object.entries(cases)){try{const r=calculate(c),g=r.gap_analysis;
out[name]={ok:true,L:r.boss_total_height,h:r.copper_to_flange,cavity:r.cavity_volume,solder:r.solder_volume,z:r.calculated_thickness,
opening:r.recommended_opening,gap:['x','y'].flatMap(a=>['nominal','min','max'].map(k=>g[a][k])),signature:r.trial_signature,base_area:r.copper_base_area};}
catch(e){out[name]={ok:false,message:e.message};}}
console.log(JSON.stringify(out));""" % json.dumps(cases)
    browser = _node(source)
    for name, case in cases.items():
        py, js = _python_summary(case), browser[name]
        assert py["ok"] == js["ok"], (name, js.get("message"))
        if not py["ok"]:
            assert name.endswith("_rejected"), name
            continue
        assert py["signature"] == js["signature"], name
        for key in ("L", "h", "cavity", "solder", "z", "base_area"):
            assert py[key] == pytest.approx(js[key], rel=1e-9, abs=1e-9), (name, key)
        assert py["opening"] == pytest.approx(js["opening"]), name
        assert py["gap"] == pytest.approx(js["gap"]), name


def test_tolerance_tables_match_browser():
    from pa_cad.design import TOLERANCE_DEFAULTS
    browser = _node("import{toleranceDefaults}from'./web/src/tolerances.js';"
                    "console.log(JSON.stringify(Object.fromEntries(Object.entries(toleranceDefaults).map(([k,v])=>[k,[v.minus,v.plus]]))));")
    assert {k: list(v) for k, v in TOLERANCE_DEFAULTS.items()} == browser


def test_relief_area_handles_overlapping_half_discs():
    import math
    from pa_cad.design import relief_area
    assert relief_area(10.1, 2) == pytest.approx(2*math.pi)
    assert relief_area(6, 4) < 2*math.pi*4
    browser = _node("import{reliefArea}from'./web/src/design.js';console.log(JSON.stringify(reliefArea({opening_width:6,relief_diameter:4})));")
    assert relief_area(6, 4) == pytest.approx(browser, rel=1e-12)


def test_locked_trial_requires_iso_timestamp(data):
    r = calculate(Design.from_mapping(data))
    data["trial_result"] = {"choice": "middle", "locked": True, "value": r.model_thickness,
                            "signature": r.trial_signature, "confirmed_at": "yesterday"}
    with pytest.raises(ValueError, match="ISO 8601"):
        Design.from_mapping(data)
    data["trial_result"]["confirmed_at"] = "2026-11-08T09:30:00+08:00"
    assert calculate(Design.from_mapping(data)).trial_status == "locked"
