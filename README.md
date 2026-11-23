# 課堂即時搶答系統

老師匯入 Google 試算表中的題號，學生以組別作答；老師查看搶答結果、人工判斷對錯，並用計分板公布分數。

> **快速開始前先知道：**目前沒有免 Google 憑證的內建 Demo 模式。匯入題目需要 Google Sheets API 服務帳戶。系統只在本機執行；學生裝置要示範時，請在同一台電腦用不同瀏覽器或無痕視窗加入組別。

## 快速開始

以下步驟假設你已準備 Google Sheets 服務帳戶。第一次設定時，先照「準備 Google Sheets」完成一次。

### 1. 安裝套件並建立本機設定

使用 Node.js 24 LTS 與 npm。在專案根目錄開啟 PowerShell：

~~~powershell
Copy-Item .env.example .env
npm ci
~~~

用文字編輯器開啟根目錄的 .env，至少設定老師密碼與組別：

~~~dotenv
TEACHER_PASSWORD=請換成本機使用的密碼
GROUP_IDS=1,2,3
GOOGLE_SERVICE_ACCOUNT_JSON=
~~~

請將 TEACHER_PASSWORD 換成只供本機使用的密碼。不要把密碼或服務帳戶憑證提交到版本庫、貼到 README 或分享給學生。

### 2. 準備 Google Sheets

1. 在 Google Cloud 啟用 Google Sheets API v4，建立服務帳戶並下載 JSON 金鑰檔。金鑰檔請放在 repo 目錄以外。
2. 把服務帳戶的 client_email 加到測試試算表的共用清單，權限設為「編輯者」。
3. 建立一份新的 Google 試算表，選「檔案 → 匯入 → 上傳」，上傳下方其中一份範例 CSV，並選擇取代目前試算表。記下工作表分頁名稱。

- [單題範例學習單](backend/tests/fixtures/feature004/單題_範例_學習單.csv)
- [題組範例學習單](backend/tests/fixtures/feature004/題組_範例_學習單.csv)

把服務帳戶 JSON 壓成一行，寫入 .env 的 GOOGLE_SERVICE_ACCOUNT_JSON。在 PowerShell 將下方路徑換成金鑰檔的實際位置：

~~~powershell
$credentialJson = Get-Content 'C:\path\service-account.json' -Raw | ConvertFrom-Json | ConvertTo-Json -Compress
Add-Content .env ("GOOGLE_SERVICE_ACCOUNT_JSON='" + $credentialJson + "'")
~~~

若 .env 已有 GOOGLE_SERVICE_ACCOUNT_JSON= 這一行，請直接替換該行，避免重複設定。此設定只供後端讀取；不要把服務帳戶 JSON 放進前端設定或 VITE_* 變數。

### 3. 啟動前後端

在專案根目錄開兩個 PowerShell 終端機。

終端機一：

~~~powershell
npm run dev --workspace @speckit-buzzer/backend
~~~

終端機二：

~~~powershell
npm run dev --workspace @speckit-buzzer/frontend
~~~

等待兩個終端機顯示服務啟動後，在同一台電腦開啟 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

### 4. 進行一輪示範

1. 老師登入，輸入 Google 試算表網址及剛才記下的分頁名稱，按「匯入題號」。
2. 用另一個瀏覽器或無痕視窗開啟同一網址，選擇組別並加入。要模擬多組時，每組使用不同的瀏覽器視窗。
3. 老師在「準備中」可設定倒數秒數；輸入 0 表示不限時。公平順位預設關閉。
4. 老師按「開始搶答」。學生選題、填答案並送出；題組要填完全部子題才可送出。
5. 老師按「結束活動」，再對有成功組別的題目標記「對」或「錯」。標記「對」每題得 1 分；系統不會自動判斷答案。
6. 看老師或學生畫面上的計分板。需要留存順位時，老師可按「匯出 CSV」。

**出題提醒：**系統匯入題號和作答欄，不會顯示學習單中的題目文字。示範時請另外開啟原學習單或投影題目，讓學生知道題目內容。

**重複示範：**在「已結束」按「重設活動」可保留學習單、題目及公平順位設定，清除本場作答與計分並把時限歸零。重新匯入另一份學習單也會清除舊作答與計分；匯入失敗則保留原活動。

## 操作規則

- 活動依序經過「準備中 → 搶答中 → 已結束」。只有老師能切換階段。
- 每組每題只接受第一筆有效答案；無效、空白或逾時答案不會鎖定題目。
- 倒數時限可設整數 0–3600 秒，預設為 0。伺服器判斷截止時間；截止時刻及之後收到的答案都拒絕。老師也可提早結束。
- 學生在搶答中只看到本組「已送出 N / 總題數」進度；題組算 1 題。活動結束後，學生可查看計分板、本組答案、勝出答案及各組順位，看不到其他組別的答案。
- 老師只能在「已結束」後標記有成功組別的題目。可以改標或取消標記。計分板依得分由高至低、成功題數由多至少、組別編號由小至大排序。
- 公平順位預設關閉。啟用後可設定每次成功題數增加的延遲（1–30 秒）；活動開始後設定固定。公平順位只影響順位，不會判斷答案對錯。
- 成功匯出答案的工作表會留下 sb004 標記，不能再匯入成新活動。每次驗收或重複示範都請使用原始範例的另一份副本。

## 學習單格式與限制

- 同一列須有且只有一個「題號」與一個「作答」欄。欄位位置可以不同，標題列前可以有說明列。
- 每份學習單最多 100 個唯一題號。題組須使用連續列；第一列有題號，後續子題列的題號留白。
- 題組以連續的全形或半形 (1)、(2) 等標記子題；每組需有 2–20 個子題，學生須填完才可一次送出。
- 單次 WebSocket 訊息最多 16 KiB（16,384 位元組）。
- CSV 匯出欄位為「題號、組別、答案、搶答順位、是否搶答成功、送出時間」，每筆已接受的作答各占一列，檔案使用 UTF-8 BOM。
- 寫回 Google 試算表只會寫入勝出答案，不會寫入老師的對錯標記或計分板。

## 已知限制

- 前端與後端都只綁定本機 127.0.0.1。其他電腦無法直接連線；本 repo 沒有教室網路或公開部署設定。
- 活動狀態只存在目前後端程序記憶體。服務重啟後，活動、作答、順位、計時與計分都不會復原；目前沒有 SQLite、雲端資料庫、活動歷史或多伺服器同步。
- Google Sheets 是匯入與答案寫回來源，不是活動狀態備份。請用一次性測試試算表，勿對正式課堂資料做故障注入或破壞性測試。
- 學生以連線時選定的組別代表作答；系統沒有學生帳號或身分驗證。
- 老師需自行判斷答案對錯；系統沒有自動評分功能。

## 開發者檢查

以下指令都從專案根目錄執行：

~~~powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
~~~

若 Playwright 首次提示缺少瀏覽器，可安裝 Chromium：

~~~powershell
npx playwright install chromium
~~~

執行端對端測試前，先停止手動啟動的前後端服務，讓 Playwright 自行管理本機埠號。自動化測試使用模擬試算表，不需 Google 憑證。

## 深入文件

想看單一功能細節，從對應的 quickstart 開始：

- [001 角色與階段同步](specs/001-role-phase-sync/quickstart.md)
- [002 Google Sheets 匯入與匯出](specs/002-guided-notes-import-export/quickstart.md)
- [003 搶答結果](specs/003-buzzer-results/quickstart.md)
- [004 題組與多填空](specs/004-question-groups/quickstart.md)
- [005 公平順位與 CSV 匯出](specs/005-buzzer-ranking-export/quickstart.md)
- [006 計時、人工計分與本組進度](specs/006-timed-scoring/quickstart.md)
- [001–006 合併與驗收稽核](specs/acceptance-audit-001-006.md)

