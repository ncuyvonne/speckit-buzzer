# Quickstart: 003 搶答與結果判定

本文件是 Feature 003 的本機驗收指引。每次交付都應執行適用驗收並記錄實際結果；本次實作結果見 [validation-results.md](./validation-results.md)。

## Prerequisites

- Windows 本機 checkout，已安裝 Node.js 24 LTS 與 npm。
- 在 repo 根目錄執行 npm install 安裝 workspace 相依套件。
- 根目錄 .env 設定本機老師密碼和組別清單，格式參照 .env.example；不要提交 .env。
- 若要手動驗收 Google Sheets 匯出，須在後端環境設定 GOOGLE_SERVICE_ACCOUNT_JSON，並將 disposable 測試試算表分享給服務帳戶；遵循 Feature 002 的 Google Sheets boundary，不將憑證放入前端或訊息。
- 透過老師介面匯入至少一題的測試學習單，參照 Feature 002 disposable worksheet 流程。自動化測試使用 fake Sheets adapter，不需真實憑證；避免使用正式課堂資料做破壞性測試。

## Start the application

在 repo 根目錄的第一個終端機啟動後端：

```powershell
npm run dev --workspace @speckit-buzzer/backend
```

在第二個終端機啟動前端：

```powershell
npm run dev --workspace @speckit-buzzer/frontend
```

使用本機 loopback 網址登入老師並準備活動，再以多個瀏覽器分頁或 context 加入不同組別。

## Acceptance walkthrough

1. **正常提交及鎖定**：組別 A 在 BUZZING 對題目 1 送出非空答案。該組收到接受及鎖定確認；老師於 2 秒內看到 A 的答案及目前勝出組別。
2. **同組競送／重複提交**：讓 A 的兩位學生同時對題目 1 送出不同答案。只有一筆被接受；另一筆收到已鎖定錯誤，原答案維持不變。
3. **不同組競答**：B、C 近乎同時提交同題。兩組首筆有效答案均可接受，但該題只有一位勝者，依伺服器接收序號決定；客戶端時間不影響結果。
4. **輸入及階段邊界**：測試空白答案、未知題號，以及 PREPARING／ENDED 提交。收到相應錯誤，且沒有錯誤資料、鎖定或順位變化。
5. **資料隔離**：檢視學生 WebSocket 的初始資料、廣播、成功及錯誤回應；BUZZING 時不得出現其他組狀態、答案或勝出資訊。老師能查看全組進度及有效答案。
6. **結束及重連**：進入 ENDED 後，學生只看到各題成功組別／答案與本組答案／狀態；老師可查看完整資料。重連不解除鎖定；程序重啟後不要求復原舊答案。
7. **Feature 002 boundary**：以已匯入題目及 ENDED 結果要求寫回，確認只使用伺服器勝出答案；無人作答時按 Feature 002 規格清空目標答案格；沒有題目或結果不可用時不得寫入。

## Automated validation commands

實作完成後於 repo 根目錄執行：

```powershell
npm run test --workspace @speckit-buzzer/backend
npm run test --workspace @speckit-buzzer/frontend
npm run test:e2e
npm run typecheck
npm run build
```

預期結果為新增與既有相關測試通過、型別檢查和 build 成功。實作交付時須記錄實際命令、退出狀態及測試結果；本指南的預期不代表已執行或通過。
