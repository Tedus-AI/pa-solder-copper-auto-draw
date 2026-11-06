# pa-solder-copper-auto-draw

## 線上 HTML 出圖工具

**[開啟 PA Copper CAD](https://tedus-ai.github.io/pa-solder-copper-auto-draw/)**

以一般 HTML／CSS／JavaScript 建立，透過 GitHub Actions 部署至 GitHub Pages。瀏覽器直接執行 OpenCascade WebAssembly，提供銅塊與錫片 3D 預覽、STEP／STL／DXF、體積扣除錫厚計算與完整圖檔包，不需要 Python 網站主機或 Streamlit。

原生參數化 PRT 須在 Creo Parametric 7.0.10.0／Windows 11 使用下載包內的 runner 與真實原生母檔產生，實機驗證尚未完成。網頁不將 STEP 匯入另存視為原生特徵樹。

網頁原始碼在 `web/`，部署與測試方式見 [DEPLOYMENT.md](DEPLOYMENT.md)。以下保留原始 Python CLI 使用說明。

桌面尺寸工作區支援點選欄位後在3D定位／呼吸標記、銅塊／錫片／PCB／PA／E-PAD顯示開關、六面視角、PA／PCB參考組裝、PA公差到PCB開窗的 Delta／Ampleon 自動連動，以及原規範第9頁的 Layout 綠漆／E-PAD DXF。PCB／PA不參與3D出圖；詳細尺寸對應與Layout圖層極性見 [工作區與Layout規格](web/WORKSPACE_AND_LAYOUT.md)。

專案名稱與 PA 型號同排顯示，可儲存、另存、載入與刪除本機專案，重新整理會恢復最近儲存的專案；目前使用此瀏覽器的 localStorage，尚未連接後端。尺寸欄的 Typ. 表示未加公差的設計尺寸。

目前工作區另包含三層銅色色階、PA最大公差虛線、公差來源與解鎖編輯、PA／PCB單邊間隙極限、真實圓角破邊孔、中凸台Xc/Yc定位，以及各自動值旁的公式問號。L依PPT第6頁固定自動計算，中凸台本體高度為L−K。

5G RRU PA（功率放大器）焊料 / Copper Coin 自動出圖工具。

輸入 PA 封裝與設計參數（YAML），自動計算並輸出：

| 圖層 | 說明 |
|---|---|
| `PA_BODY` | PA 本體外框 |
| `PA_PAD` | Exposed pad / flange |
| `SOLDER` | 焊料區（支援 window-pane 鋼板開窗分割，降低 void） |
| `COPPER_COIN` | Copper coin 外形（pad 外擴 + 圓角） |
| `PCB_CUTOUT` | PCB 挖槽（coin + 間隙） |
| `DIM` | 基本尺寸標註 |

輸出格式：**DXF**（CAD 用，各層分開）＋ **PNG** 預覽圖，並列出焊料覆蓋率。

## 安裝

```bash
pip install -e ".[dev]"
```

## 使用

```bash
pa-draw examples/pa_example.yaml -o output
```

輸出範例：

```
[PA_example]
  pad          : 8.00 x 4.00 mm
  solder       : 6 windows, area 25.20 mm², coverage 78.8%
  copper coin  : 9.00 x 5.00 mm (R0.3)
  PCB cutout   : 9.20 x 5.20 mm
  -> output/PA_example.dxf
  -> output/PA_example.png
```

## 專案結構

```
src/pa_draw/
  models.py      資料模型（Rect、PAPackage、SolderSpec、CopperCoinSpec）
  config.py      讀取 YAML
  geometry.py    幾何計算（內縮、外擴、開窗分割）
  dxf_writer.py  DXF 輸出（ezdxf）
  preview.py     PNG 預覽（matplotlib）
  cli.py         命令列入口
examples/        範例參數
tests/           pytest 測試
output/          輸出資料夾（不進版控）
```

## 測試

```bash
pytest
```

## Roadmap

- [ ] 從 Excel / CSV 批次讀入多顆 PA
- [ ] 多 PA 同板排版
- [ ] 焊料 / coin 一維熱阻估算（Rth = t / (k·A)）
- [ ] STEP 輸出（給 Icepak / FloTHERM 建模）
- [ ] 非矩形 pad（多 lead、flange 開孔）
