# 原生參數化 PRT 的建模與驗收契約

使用者已確認有 Creo Parametric 7.0.10.0／Windows 11 與授權，且需要可修改尺寸並再生的原生特徵樹。runner 已實作母檔參數更新與驗證，但**未在實際 Creo 驗證，母檔尚未提供**。本檔的完整設計契約與本版最小母檔介面有所區別；本版必要參數及特徵名稱以 [Windows本機指南](windows-creo7.md) 為準。

## 兩個獨立零件

| 零件 | 必要特徵 |
|---|---|
| `copper.prt` | 具尺寸約束的基座草繪、基座擠出、四角圓角、依所選角位的一至四個通孔、大凸台草繪／擠出、四角小凸台（個別或陣列） |
| `preform.prt` | 具尺寸約束的四角45°削角八邊形草繪、厚度擠出 |

所有模型均以 mm 建立；底面／中心基準採既有設計規則。母檔方案可接受，但母檔必須有上述原生特徵，不能是匯入的單一 STEP 實體。

## 驅動參數對應

以下為完整設計資料的對應名稱，部分是派生／追蹤資料，不是本版 runner 必填的母檔參數。本版填入幾何驅動參數，完整 PA／PCB 體積公式仍由工具計算；未將所有公式寫成 Creo relations。

| 原生參數 | 來源／意義 |
|---|---|
| `BASE_L` / `BASE_W` / `BASE_T` | 銅塊外形 E/F/G |
| `BASE_R` | 四角半徑 |
| `HOLE_D` / `HOLE_EDGE` | 吊掛孔直徑及距相鄰兩邊的中心距 |
| `PA_L` / `PA_W` / `SPH` | PA 設計長／寬（Typ.）及支撐高度 |
| `PCB_L` / `PCB_W` / `PCB_T` | PCB 開孔及板厚 |
| `RELIEF_D` | 體積公式中的 relief 直徑 |
| `LEAD_SOLDER` / `BOARD_SOLDER` | 高度堆疊 A/B |
| `FLANGE_GAP` | flange 到大凸台平面 D |
| `PAD_SIZE` / `PAD_H` | 四角小凸台邊長 J 與高度 K |
| `BOSS_L` / `BOSS_W` | PA 長／寬向上進位至 0.1 的派生尺寸 I/H |
| `CUH` / `BOSS_H` | 總凸台高度 L 及大凸台高度 L-K |
| `PREFORM_L` / `PREFORM_W` | 錫片長／寬，同 I/H |
| `CHAMFER_Y` | 四個45°削角的直角邊長 |
| `CALC_Z` / `PREFORM_Z` | 體積法計算厚度／實際選用厚度 |

修改原始參數後，派生尺寸必須由明確的關係式或工具重新計算，更新原生驅動尺寸並再生。不可只改外部 JSON 或零件註記、卻未改動幾何。L、體積與進位公式沿用 `design-rules.md`，需在實際 Creo 檢查關係式與單位行為。

## 必要驗收

1. 在指定 Creo 版本開啟兩個 PRT，確認為原生可編輯草繪／擠出／孔／圓角等特徵，而非整體匯入特徵。
2. 範例銅塊總高為 3.48、基座為40×30；錫片長寬20.6×9.8，依固定0.2828 mm斜邊間隙計算厚度約0.374779。外接尺寸與體積須符合 JSON，且皆為單一有效實體。
3. 修改基座長寬／厚度，確認孔位置、基座圓角及凸台相對基準保持設計意義。
4. 修改 PA 或板厚，確認凸台與錫片尺寸按規則更新，並檢查再生結果，不只看參數表數值。
5. 修改削角或選定錫厚，錫片須再生並更新對應 DXF；記錄厚度覆寫與體積估算的差別。
6. 對不合法尺寸（孔超出基座、凸台相交、負高度、削角碰到小凸台）明確拒絕，不交付舊模型或失敗特徵。
7. 儲存後關閉、重新開啟 PRT，再驗證原生特徵、尺寸與單位；將實際 Creo 版本與驗證結果附於交付報告。

目前這些 Creo 驗收均尚未執行；現有 STEP 回讀與軟體測試不能替代它們。

### Selectable mounting corners

`copper.hole_corners` lists one to four of `bottom_left`, `bottom_right`, `top_left`, `top_right`, viewed from +Z. Missing values retain bottom-left/top-right. Alternate selections add the integer `HOLE_MASK` parameter: bits 1, 2, 4, 8 respectively. The default mask is 9; all four is 15. The native master must expose this parameter and use Pro/PROGRAM conditions to include the matching individual hole features inside MOUNT_HOLES. Each included hole uses the existing HOLE_D and HOLE_EDGE dimensions. An older master lacking HOLE_MASK is rejected for alternate selections, rather than generating an incorrect diagonal pair. Actual native regeneration still requires the licensed Creo machine and validation of feature presence.
