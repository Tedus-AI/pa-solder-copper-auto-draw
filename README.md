# pa-solder-copper-auto-draw

## 線上 HTML 出圖工具

**[開啟 PA Copper CAD](https://tedus-ai.github.io/pa-solder-copper-auto-draw/)**

以一般 HTML／CSS／JavaScript 建立，透過 GitHub Actions 部署至 GitHub Pages。瀏覽器直接執行 OpenCascade WebAssembly，提供銅塊與錫片 3D 預覽、有顏色的 STEP（含組合 STEP）、DXF／PDF 2D 圖面、體積扣除錫厚計算與完整圖檔包，不需要 Python 網站主機或 Streamlit。

原生參數化 PRT 須在 Creo Parametric 7.0.10.0／Windows 11 使用下載包內的 runner 與真實原生母檔產生，實機驗證尚未完成。網頁不將 STEP 匯入另存視為原生特徵樹。

**版本號**：頁首「PA Copper CAD」旁顯示工具版本（例：`v1.10.0`），滑鼠移上去或在「⚙ 設定 → 版本」可看到建置時間與 commit。版本號取自 `web/package.json` 的 `version`：每次合併功能更新提高次版號（1.10 → 1.11），只修錯誤時提高修訂號（1.10.0 → 1.10.1）。建置時另寫出 `version.json`；開著的頁面每 30 分鐘及切回視窗時比對網站上的 `version.json`，網站已發佈新版時頁首出現「有新版本」，先儲存專案再點選即重新整理。版本紀錄：v1.1–v1.9 對應 PR #1–#9，v1.10.0 新增版本號顯示與自動儲存。v1.11.0 新增頁首全螢幕按鈕與「進入工具時自動全螢幕」（瀏覽器規定須由使用者操作觸發，故於開啟後第一次點擊或按鍵時進入；可在設定 → 顯示關閉）。

網頁原始碼在 `web/`，部署與測試方式見 [DEPLOYMENT.md](DEPLOYMENT.md)。以下保留原始 Python CLI 使用說明。

桌面尺寸工作區支援點選欄位後在3D定位／呼吸標記、銅塊／錫片／PCB／PA／E-PAD顯示開關、六面視角、PA／PCB參考組裝、PA公差到PCB開窗的 Delta／Ampleon 自動連動，以及原規範第9頁的 Layout 綠漆／E-PAD DXF。銅塊與錫片 2D 圖面依公司圖面 348001J40001 的格式出圖（可選含封面），尺寸公差跟隨工具設定；各自有 12 碼料號（前 10 碼對應 PART NO.、後 2 碼對應 REV，可上鎖），並可輸出 2D 圖面 PDF，可選擇套用設定中上傳的浮水印（比照 Acrobat，置於圖面內容之下；浮水印檔另存於資料庫的 Watermark 資料夾）。出圖零件下拉含 E-PAD（Layout 綠漆 DXF）。輸出檔名統一為 專案名稱_Copper_Coin_日期／專案名稱_Solder_Preform_日期／專案名稱_Coin_Solder_Masker_日期。PCB／PA不參與3D出圖；詳細尺寸對應與Layout圖層極性見 [工作區與Layout規格](web/WORKSPACE_AND_LAYOUT.md)。

專案名稱、專案ID（本工具專用）、PA 品牌與 PA 型號同排顯示；專案名稱可從 AI-Thermal 工具的專案清單下拉選擇（只讀）。專案可儲存、另存、載入與刪除，並預設**自動儲存**（修改後約 2 秒寫入瀏覽器、本機資料庫資料夾與 SharePoint；離線時恢復連線後補傳；新專案輸入專案名稱後才自動建立），資料庫比照 Thermal-Test-Report-Builder：頁首的 ⚙ 設定可選擇本機資料庫資料夾（可放共用磁碟；每個專案一份 JSON，與 SharePoint 結構相同）與每日自動備份資料夾，並可開啟 SharePoint 雙存檔（Thermal-Spec-DB／文件／PA_Copper_CAD）；頁首左右並排顯示 SharePoint 與本機的寫入狀態。尺寸欄的 Typ. 表示未加公差的設計尺寸。

新增「錫厚圖解／計算表」：以目前尺寸逐步呈現容腔減銅凸台、削角後面積與錫厚。容腔的避空面積 Aₒ 採 PCB 開孔實際的四個外側半圓（2πr²，同側重疊時扣除），不再沿用 PDF 第12／13頁只計一個整圓 π(O/2)² 的等效式；預設案例 Z 由 0.3748 改為 0.3859 mm。HSK 說明明列對應位置挖槽、槽深 G＋0.05 mm 與加工公差 ±0.05 mm。

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
