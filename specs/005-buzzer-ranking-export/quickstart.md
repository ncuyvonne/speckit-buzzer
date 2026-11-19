# Quickstart: 005 搶答公平順位與 CSV 匯出

本文件列出 Feature 005 的本機啟動方式、人工驗收步驟及自動化品質檢查。

## Prerequisites

- Windows checkout；Node.js 24.x 與 npm 已安裝。
- 在 repo 根目錄執行 `npm ci`，依 lockfile 安裝既有 workspace 套件。
- `.env` 參照 `.env.example` 設定本機老師密碼及組別清單；勿提交 `.env`。
- 新功能自動化測試使用既有 fake Sheets fixture，不需 Google 憑證。手動匯入真實學習單時才需使用既有 `GOOGLE_SERVICE_ACCOUNT_JSON` backend 環境設定及測試試算表。
- 依 [WebSocket contract](./contracts/realtime-websocket.md) 與 [CSV contract](./contracts/csv-export.md) 準備驗收案例。

## Start the local application

在 repo 根目錄的兩個終端機分別啟動：

```powershell
npm run dev --workspace @speckit-buzzer/backend
```

```powershell
npm run dev --workspace @speckit-buzzer/frontend
```

用教師介面準備活動，再以多個瀏覽器頁籤加入不同組別。

## Acceptance walkthrough

1. **預設關閉／設定**：確認公平順位預設關閉；教師可在 `PREPARING` 開啟並輸入正秒數（含小數）。啟用但空白、零、負數或非數值時不得開始活動；`BUZZING` 後不得修改。
2. **未啟用排名**：公平順位關閉時讓多組提交同題，教師看到的順位和成功組別須依伺服器收到／確認順序。
3. **成功題數快照**：先讓某組在其他題成為目前第一名，再提交新題；確認每個既有成功題加上設定延遲秒數。使用新提交改變其他題順位後，已接受答案的快照不追溯改變。
4. **相同有效時間與邊界提交**：安排相同有效時間，確認 accepted order 唯一決定順位。空白、重複、未知題號、無效組別及錯誤階段答案不改變排名或成功題數。
5. **角色可見性**：`BUZZING` 學生只見本組進度；`ENDED` 學生見所有組別名次／未作答、成功答案和本組答案，不見其他非成功組別答案；教師可見完整結果。
6. **CSV 下載**：教師結束活動後下載 CSV，確認每題每組一列、必要欄位、組題子答案以 `（1）答案；（2）答案` 格式依序排列、無人成功與未作答空欄、逗號／引號／CR／LF 逸出，以及檔案 `EF BB BF` 前綴和 Windows Excel 繁體中文顯示。
7. **效能驗收**：設定 `PLAYWRIGHT_GROUP_IDS` 為與 backend `GROUP_IDS` 相同的逗號分隔組別清單；以每組一條學生連線送出有效答案，確認教師每次都在 2 秒內看到更新順位／成功組別，並記錄組數 N 與量測結果。未設定時 Playwright fixture 使用既有預設 `1,2,3`。
8. **權限與階段拒絕**：學生匯出、活動未結束匯出、結果未就緒匯出及活動開始後更改設定均須收到明確錯誤，且不得產生部分檔案或改動活動狀態。

## Automated validation commands

在 repo 根目錄執行：

```powershell
npm run test --workspace @speckit-buzzer/backend
npm run test --workspace @speckit-buzzer/frontend
npm run test:e2e
npm run typecheck
npm run build
```

## Validation record

2026-11-19 本機驗證結果：

| Command | Result |
|---|---|
| `npm run test --workspace @speckit-buzzer/backend` | Passed: 31 files, 174 tests. |
| `npm run test --workspace @speckit-buzzer/frontend` | Passed: 3 files, 19 tests. |
| `npm run test:e2e` | Passed: 41 Playwright tests. The SC-006 run used N = 3 groups; submission-to-visible-rank measurements were 50 ms, 39 ms, and 45 ms. |
| `npm run typecheck` | Passed for frontend and backend workspaces. |
| `npm run build` | Passed for frontend Vite build and backend TypeScript build. |

The SC-006 Playwright test also attaches `sc-006-ranking-latencies.json` with the measured group count and each submission latency. These results describe the local test run; configure `PLAYWRIGHT_GROUP_IDS` to match the backend `GROUP_IDS` when repeating the walkthrough with a different class roster.
