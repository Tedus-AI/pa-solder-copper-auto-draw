# Creo Parametric 7.0.10.0／Windows 11 本機整合

正式交付要求：銅塊與錫片均為可修改驅動尺寸、再生的原生參數化 PRT。使用者已確認有此版本 Creo 與授權。

目前提供的是**原生母檔的參數更新／再生 runner**。尚未在使用者電腦執行，亦未提供經 Creo 建立的母檔，因此目前沒有已驗證的 PRT 交付。本機通訊模擬測試不是 Creo 或 Windows 相容性測試。

## 一次性前置準備

1. 在 Windows 11 啟動已授權的 Creo Parametric 7.0.10.0。確認實際版本，不要使用不同版本儲存後假定相容。
2. 確認 Creo 安裝包含 J-Link。安裝檔位置檢查僅作診斷，不會讀取授權檔或憑證。
3. 從 [CREOSON 專案的 Releases](https://github.com/SimplifiedLogic/creoson/releases) 選擇適用本機 Creo／Java 的版本並依其文件設定 Creo 路徑與本機連接埠（預設9056）。本工具要求提供 `creo.set_creo_version` 的介面；CREOSON 自2.8.0加入此 Creo 7 再生修正。尚未驗證特定 CREOSON 發行包與此工作站的相容性，請勿自動採用新版內附 Java 取代 Creo 環境。
4. 在同一電腦準備 Python 3.11 或更新版本。runner 只使用 Python 標準函式庫，不需安裝 CadQuery、Streamlit 或 Python 第三方套件。
5. 準備以下**真實原生參數化母檔**，可按下文建立，或由既有可編輯零件調整。檔案不能是匯入 STEP 後另存。

```text
C:\pa-cad\templates\copper_master.prt.1
C:\pa-cad\templates\preform_master.prt.1
```

可使用不帶修訂號的 `.prt`，或 Creo 儲存的 `.prt.N`；runner 會選最高數字修訂版。它只在臨時工作目錄操作母檔副本，並驗證來源 SHA-256 不變。若同名母檔已在 Creo 記憶體中，會拒絕執行，避免使用到使用者正在編輯的模型。請使用專供自動化的 Creo 工作階段。

CREOSON 只需本機存取，不需要將工作站服務公開到網際網路或建立企業 VPN。runner 僅接受 loopback `/creoson` 位址。

## 原生母檔建模契約

兩零件皆使用 mm、XY中心為原點、底面 Z=0。建立 REAL／DOUBLE 型別參數，將其連到草繪／特徵的實際驅動尺寸。只有參數表而沒有幾何關聯會在再生探測中失敗。

### 銅塊

| 必要參數 | 範例值／意義 |
|---|---|
| `BASE_L` / `BASE_W` / `BASE_T` | 40 / 30 / 3，基座長寬厚；長寬是示範值 |
| `BASE_R` | 3，四角圓角半徑 |
| `HOLE_D` / `HOLE_EDGE` | 3 / 4，吊掛孔直徑、孔中心距兩相鄰外邊 |
| `BOSS_L` / `BOSS_W` | 20.6 / 9.8，大凸台長寬 |
| `BOSS_X` / `BOSS_Y` | 新版任務的中凸台中心相對基座中心位移，預設 0 / 0，可為正、負或零；舊版未含此參數的任務仍視為中心對齊 |
| `CUH` / `PAD_H` | 0.48 / 0.15，凸台總高／四角小凸台高 |
| `PAD_SIZE` | 1.5，小凸台正方形邊長 |

必須存在且為 ACTIVE 的原生特徵名稱：

| 特徵名稱 | 幾何與尺寸約束 |
|---|---|
| `BASE_EXTRUDE` | 以原點對稱的矩形草繪，長 `BASE_L`、寬 `BASE_W`，沿 +Z 擠出 `BASE_T` |
| `BASE_ROUNDS` | 基座4條垂直邊，半徑 `BASE_R` |
| `MOUNT_HOLES` | 先完成基座圓角，再作兩個對角貫穿圓形切除，直徑 `HOLE_D`；中心為 `(-BASE_L/2+HOLE_EDGE,-BASE_W/2+HOLE_EDGE)` 與 `(BASE_L/2-HOLE_EDGE,BASE_W/2-HOLE_EDGE)`。孔可以切穿圓角／外邊，不能以「孔必須封閉」的限制取代真實切除；不得與中凸台相交或使最終零件分裂 |
| `MAIN_BOSS` | 在基座頂面 Z=`BASE_T`、中心 `(BOSS_X,BOSS_Y)`，長寬 `BOSS_L/BOSS_W`，擠出高度 `CUH-PAD_H` |
| `CORNER_PADS` | 大凸台四角各有 `PAD_SIZE` 正方形，外側邊與大凸台外邊對齊，沿 +Z 擠出 `PAD_H`；可用單一多輪廓擠出或原生陣列 |

特徵名稱需與上表一致，讓 runner 能檢查。參數驅動尺寸時，請使用該模型實際的尺寸符號，例如 `<基座長度尺寸符號> = BASE_L`；不要照抄任意 `d0/d1` 對應。大凸台高度必須使用 `CUH-PAD_H`，不能將總高度誤當成大凸台擠出高度。

四角小凸台中心為 `(BOSS_X ±(BOSS_L-PAD_SIZE)/2, BOSS_Y ±(BOSS_W-PAD_SIZE)/2)`。所有草繪應具完整尺寸／幾何約束，避免外部參考或以游離位置決定孔位。介面中的「距左邊」與「距下邊」會轉成 `BOSS_X = 距左邊 − BASE_L/2`、`BOSS_Y = 距下邊 − BASE_W/2`。舊母檔若只有中心對齊關聯，需新增兩個有正負號的驅動位置尺寸後才能接受新版任務。

孔破邊時，runner 以實際圓角基座與圓形切除交集計算體積，不再扣掉兩個完整圓柱。此校驗不取代 Creo 對單一有效實體的驗收；分裂或與中凸台衝突的設計不可交付。

### 錫片

| 必要參數 | 範例值／意義 |
|---|---|
| `PREFORM_L` / `PREFORM_W` | 20.6 / 9.8 |
| `CHAMFER_Y` | 3.4，4個45°削角的直角邊長 |
| `PREFORM_Z` | 約0.374779，厚度；完整精度由 job 填入 |

建立以原點對稱、完整約束的八邊形草繪：在長 `PREFORM_L`、寬 `PREFORM_W` 的矩形四角各扣除直角邊長 `CHAMFER_Y` 的等腰直角三角形。以此輪廓沿 +Z 擠出 `PREFORM_Z`，原生特徵命名 `PREFORM_EXTRUDE`。

錫片長寬與 CuH 由出圖工具依 PA／PCB／高度堆疊計算後填入母檔；這版 runner 不會把完整 PA 體積公式寫成 Creo relations。使用者可在 Creo 修改上述幾何驅動參數並再生。若更改 PA／PCB 原始設計條件，請回工具重新計算、出圖，以維持錫厚與 DXF 的一致性。

## 執行檢查

將工具產生的完整 ZIP 解壓縮，在該資料夾開啟終端機：

```powershell
py -3 creo_runner.py check --creo-root "C:\Program Files\PTC\Creo 7.0.10.0"
```

請依實際安裝位置修改路徑。檢查會輸出作業系統、Python版本、指定路徑的 J-Link／啟動檔是否存在、Creo連線結果與 Creo 7 通訊設定結果；不讀授權密鑰。`target` 是指定目標，不是自動偵測到的 Creo 完整版本；檔案存在及連線成功亦不代表原生模型已通過驗證。

## 產生原生模型

```powershell
py -3 creo_runner.py generate creo_job.json --templates "C:\pa-cad\templates" --output "C:\pa-cad\run-001"
```

輸出資料夾必須尚未存在。runner 會：

1. 驗證 job 目標、mm單位、參數與解析式體積。
2. 連接本機 CREOSON，明確設定 `creo.set_creo_version(version=7)`。
3. 複製真實母檔，以唯一名稱操作；只更新既有參數，不憑空建立同名註記充當驅動尺寸。
4. 再生，拒絕匯入特徵、缺失／未啟用特徵、錯誤模型、錯誤單位或體積／外接尺寸不符。
5. 銅塊 `BASE_L` 暫增0.5，驗證長度與體積實際變化；錫片 `PREFORM_Z` 暫增0.01，驗證厚度與體積實際變化；再恢復原值並驗證。
6. 由 Creo backup 寫出版本化 PRT，以唯一零件名稱交付，避免與既有模型名稱衝突。
7. 從記憶體移除本次零件，重新開啟剛儲存的 PRT，再驗證，最後留下 `native_report.json`。

程式不會更改全域 config.pro、關閉 Creo、刪除無關模型或儲存來源母檔。失敗時輸出留在獨立臨時目錄並有 `FAILED.txt`，不會當成通過的交付；請先檢查 Creo 訊息與失敗原因。

## 驗收範圍

runner 的自動檢查仍不能取代以下人工驗收：實際 Creo完整版本、每個草繪可編輯且完整約束、所有關鍵驅動尺寸及完整設計變更流程、單一有效實體。特別是中凸台位移在基座內時，整體體積與外接尺寸可能完全不變；參數讀回及原有 `BASE_L`／錫厚再生探測不能證明 `BOSS_X/Y` 已正確驅動草繪，必須實際檢查位置尺寸及改值後的位置變化。初版報告會保留 `automatic_checks_passed_manual_acceptance_pending`，不宣稱所有驗收已完成。

新版參數檔保留各尺寸的 `tolerances` 上下偏差。文件沒有明訂的公差只能標為「未指定」；分析暫按零計算，不等同零公差的製造規格。公差用於尺寸／配合分析，PRT 的實體仍使用設計尺寸（Typ.），即未加上下公差的輸入值，不是實測平均值。

原始 ZIP 的 DXF 與 job 同一組尺寸對應；在 Creo 手動改動 PRT 後，不會自動更新這些 DXF，必須回工具同步參數再輸出。現有 DXF 是設計尺寸（Typ.）／公差圖，不是 Creo DRW 的自動更新關聯工程圖。

專案顯示資料保留在 `project.name` 與 `project.pa_model`，支援中文與一般符號，最多100字。它們不參與任何尺寸、體積或 Creo 原生參數計算；輸出檔名仍由安全的 `name` 欄位決定。舊參數檔沒有 `project` 時會使用預設專案資料。

## API 核對來源

本 runner 的 request／response 格式已對照 [CREOSON 官方原始碼](https://github.com/SimplifiedLogic/creoson)，參考提交 `c5ddd28149f345a717de387f9ddc1e0e5428468a` 的 JSON specs 與 Java help：`connection.connect`、`creo.set_creo_version`、`file.open/rename/regenerate/backup/erase`、`feature.list`、`parameter.set/list`、`geometry.bound_box` 等。這是介面核對，不是該第三方發行包與 Creo 7.0.10.0／Windows 11 的實機相容性認證。
