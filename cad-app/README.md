# PA Copper & Preform CAD

基地台 final PA 雙迴焊製程的參數化出圖工具。由 PCB 開孔、PA 封裝、銅塊外形與高度堆疊，自動產生銅塊與削角錫片的 **STEP 3D、DXF 2D、STL／SVG 預覽及錫厚計算報告**。

**正式需求是可修改尺寸並在 Creo 再生的原生參數化 `.prt`，目標為 Creo Parametric 7.0.10.0／Windows 11。** 本版已提供本機母檔 runner，但真實原生母檔與使用者電腦的執行驗證尚未完成，因此目前沒有已驗證的 PRT 交付。STEP／DXF 可供幾何與規則驗證；STEP 匯入另存不符合特徵樹要求。參見 [Creo 整合條件](docs/creo-integration.md)。

## 使用流程

1. 輸入已知 PCB 開孔、PA 尺寸與封裝支撐高度 SPH。
2. 輸入 thermal／RF 定義的銅塊外形 E/F；外形不能僅由 PA 或開孔推算。
3. 自動生成圓角基座、兩個對角吊掛孔、大凸台及四角小凸台。
4. 依高度堆疊與體積扣除法，計算錫片厚度並列出三款試作厚度。
5. 生成四角 45° 削角錫片，下載銅塊與錫片圖檔及計算報告。

## 開發環境

已驗證：Linux x86_64、Python 3.12、CadQuery 2.8。無需圖形桌面、資料庫或雲端 API 金鑰。完整依賴版本記錄在 `requirements.lock`，它是 Python 3.12/Linux 的已驗證版本清單，其他平台需另行驗證 wheel 相容性。

```bash
bash scripts/install.sh
source scripts/env.sh
pytest -q
```

已有虛擬環境時，安裝腳本可重複執行。快取保存在被忽略的 `.venv` 內，不需寫入唯讀的使用者家目錄。

## 操作介面

```bash
source scripts/env.sh
streamlit run app.py --server.headless true --browser.gatherUsageStats false
```

可輸入尺寸、旋轉查看 3D，並下載完整 ZIP。每次輸出均驗證實體有效性、單一實體、解析式體積與 STEP 回讀結果。錯誤輸入會清除舊下載結果，避免誤用前次設計。

## 命令列／自動化

```bash
source scripts/env.sh
pa-cad examples/780-m1p.yaml --calculate-only
pa-cad examples/780-m1p.yaml -o output
```

輸出 `output/pa_780_m1p/`：

| 檔案 | 內容 |
|---|---|
| `copper.step` / `preform.step` | 可回讀的 3D B-rep 實體，mm |
| `copper.dxf` | 銅塊上／前／右視圖、尺寸、公差與表面處理註記，1:1 |
| `preform.dxf` | 削角錫片上視圖、側視厚度與尺寸註記，1:1 |
| `*.stl` / `*.svg` | 預覽，不作尺寸與公差的唯一依據 |
| `report.json` | 所有原始參數、計算值、實體體積與設計差異 |
| `parameters.yaml` | 可再次輸入的設計參數 |
| `creo_job.json` | 目標為 Creo 7.0.10.0 的 schema 2 原生參數化任務 |
| `creo_runner.py` / `WINDOWS_CREO7.md` | Windows 本機執行工具與母檔準備／驗收指南；只需 Python標準函式庫 |
| `sha256.json` | 交付檔案的 SHA-256 |
| `pa_780_m1p.zip` | 上述檔案打包 |

程式拒絕覆寫既有設計目錄；重跑時請使用新的 `-o` 根目錄或修改設計名稱。`--format prt` 在雲端會以非零狀態說明本機執行要求。Windows端需有 J-Link／本機 CREOSON 與兩個符合介面的真實原生母檔；詳細操作見 [Windows本機指南](docs/windows-creo7.md)。runner 會檢查特徵、單位、體積與尺寸，實際改動尺寸並恢復，再儲存／重新開檔；不會把 STEP 匯入當成原生建模。

## 規則與範例結果

本版依使用者提供的《PA銅塊焊接雙迴焊製程設計規範_20260319》第 3–13 頁轉錄工程規則；原始 PDF、聯絡資料未放入專案。

| 項目 | 780/M1P 範例 |
|---|---:|
| PA 尺寸 | 20.57 × 9.78 mm |
| 大凸台 I × H | 20.6 × 9.8 mm |
| PCB 開孔 M × N | 20.9 × 10.1 mm |
| CuH / L | 0.48 mm |
| 銅塊基座頂面至 flange | 0.63 mm |
| 體積扣除後所需錫量 | 約 66.996 mm³ |
| 錫片面積 | 178.760 mm² |
| 計算錫厚 | 約 0.3748 mm |
| 三款試作厚度（預設 ±0.05） | 約 0.3248 / 0.3748 / 0.4248 mm |

`40 × 30 mm` 基座是可修改的示範值，不是文件指定的製造尺寸。模型保留完整計算精度；若製程選定 0.37 mm，請明確設定 `preform.thickness_override: 0.37`。

PDF 第 12 頁試片為 ±0.05 mm，第 13 頁表格採 ±0.15 mm；工具會揭露差異並以輸入值計算。四角小凸台與削角的解析距離約 0.2828 mm，亦與文件「約 0.37 mm」註記不同，已保留在報告。詳細公式、原點、工程範圍與待確認項目見 [設計規則](docs/design-rules.md)。

## 驗證範圍

測試涵蓋 PDF 數值回歸、進位規則、無效輸入、STEP 體積及尺寸回讀、DXF 孔／凸台／尺寸、ZIP 完整性及介面實際產生下載。這些是軟體與名義幾何驗證；最終尺寸、公差堆疊與錫厚仍需依熱／RF 設計及製程切片確認。
