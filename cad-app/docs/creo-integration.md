# Creo／Pro/E 原生 PRT 整合

雲端已驗證的輸出是由 OpenCascade 建立的 STEP 實體，**沒有在真實 Creo 產生或驗證原生 `.prt`**。圖檔包已提供 schema 2 的 `creo_job.json` 與標準函式庫 `creo_runner.py`，可在 Windows本機使用真實原生母檔執行參數更新與再生；母檔與本機實測仍未完成。`--format prt` 在雲端會明確回報本機執行要求。

使用者已確認：**Creo Parametric 7.0.10.0／Windows 11，已有授權，必須原生參數化 PRT。** 實際工作站的執行與模型驗證尚未完成。STEP 匯入後另存 PRT 不符合要求。操作與母檔詳細規格見 [Windows整合指南](windows-creo7.md)。

## 不符合需求：STEP 匯入實體另存 PRT

此做法可能產生 Creo 可開啟的原生檔案，但缺少要求的原生建模歷程與驅動尺寸，因此只能作幾何參考，不作正式輸出。

驗收除了重新開啟 PRT、確認 mm、單一實體、外接尺寸及體積，還必須修改參數並成功再生，檢查特徵無失敗及對應 DXF 同步更新。

## 正式方向：原生參數化特徵

依實際版本與可用授權選 Creo TOOLKIT／J-Link 等官方支援介面。參照 `creo_job.json` 建立：

1. 基座草繪、擠出與四角圓角。
2. 對角孔與大凸台。
3. 四角小凸台。
4. 錫片八邊形草繪與厚度擠出。
5. 原生尺寸／單位與再生驗證，儲存銅塊及錫片 PRT。

可依版本選擇直接建立原生特徵，或使用預先在 Creo 建好的原生參數化母檔，由程式填入參數並再生／另存。母檔尚未建立或驗證，不能假定現有 STEP 可代替。尺寸與特徵對應見 [原生特徵契約](native-feature-contract.md)。

已核對 CREOSON 原始碼與 JSON specs，runner 會在再生前呼叫 `creo.set_creo_version(version=7)`。本版以原生母檔參數化為實作方向，未宣稱 CREOSON 可從空模型任意建立完整特徵。無需公開工作站服務或設定企業VPN。

此方向需實作並在實際 Creo 實測。現有 STEP／DXF 核心可供比較；尚未證明原生 PRT 可產生或再生。
