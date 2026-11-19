# Research: 003 搶答與結果判定

## Reuse the existing local TypeScript/WebSocket application

- **Decision**: 使用既有 React 19／Vite 前端、Node.js 24／TypeScript 5.9 後端，擴充目前 /ws 協定及 server composition。
- **Rationale**: 001／002 已持有活動、組別、老師連線角色、WebSocket handler 和題號；package.json 已固定相依套件與 workspace。
- **Alternatives considered**: 新增服務、傳輸方式或 runtime 套件。這會增加同步和部署路徑，現有架構已足以涵蓋需求。
- **Evidence**: root/backend/frontend package.json；specs/001-role-phase-sync/plan.md；specs/002-guided-notes-import-export/plan.md。

## Keep submissions in process memory

- **Decision**: 將答案及勝出順序存於目前後端程序，沿用 Feature 001 的單一活動生命週期。
- **Rationale**: 003 明確不要求程序重啟後復原；既有 ActivityState 和 GroupRoster 已是伺服器權威。
- **Alternatives considered**: SQLite 或其他持久化儲存。重啟復原超出規格並需新增生命週期和一致性契約。
- **Evidence**: backend/src/domain/activity-state.ts；001 data-model.md；003 Assumptions。

## Make acceptance a synchronous check-and-set

- **Decision**: 在單一同步服務操作中驗證階段、題號、答案和唯一鍵，再插入答案並配置單調遞增伺服器序號。
- **Rationale**: Node.js 單一事件迴圈會依序執行這段同步操作。插入即為接受線性化點；同組不會同時通過唯一性檢查，不同組有效提交也有明確總序。毫秒時間戳可能相同，不能作唯一排序鍵。
- **Alternatives considered**: 信任用戶端時間、以 wall-clock 時間作唯一順序、或在 check-and-set 中 await。前兩者不權威，後者引入競態。
- **Evidence**: FR-005–FR-009；diagrams/003-buzzer-results-class.puml；backend/src/realtime/handler.ts。

## Construct role-filtered server projections

- **Decision**: 由結果服務產生教師進度和學生結果兩種投影，handler 依連線角色和活動階段傳送。
- **Rationale**: 在伺服器端組裝及傳送時過濾，可避免初始快照、即時事件、錯誤或查詢暴露其他組資料。
- **Alternatives considered**: 傳送完整資料後只在 React 隱藏。這不會阻止客戶端讀取線上 payload。
- **Evidence**: FR-011–FR-016；001／002 WebSocket 契約。

## Reuse Feature 002 winning-results boundary

- **Decision**: 以權威 003 結果服務實作既有 WinningResultsProvider，回傳現有 WinningResultsSnapshot 型別。
- **Rationale**: 002 已預留此服務端邊界供匯出使用；共享一個勝出結果來源，避免重算或由瀏覽器提供答案。
- **Alternatives considered**: 在 Google Sheets 整合內重新判定勝者，或接受瀏覽器傳入結果。兩者都會分裂或削弱伺服器權威性。
- **Evidence**: backend/src/guided-notes/service.ts；backend/src/guided-notes/types.ts；002 data-model.md。

## Reuse the Google Sheets API v4 integration and backend-only credentials

- **Decision**: 保留 Google Sheets 讀寫在 Feature 002 的既有 Google Sheets API v4 adapter；Feature 003 只供應權威的 winning-results snapshot。服務帳戶憑證由後端從 GOOGLE_SERVICE_ACCOUNT_JSON 環境變數讀取。
- **Rationale**: 002 已有 googleapis 相依套件、server-side adapter、服務帳戶設定和可注入的測試 seam。複製整合或把憑證放到前端會增加憑證暴露面並重複資料存取責任。
- **Alternatives considered**: 由瀏覽器直接呼叫 Google Sheets API、在 003 建立第二個 Sheets client、或把 service account 寫入程式碼／一般文件。這些都不符合現有邊界與憲章憑證原則。
- **Evidence**: backend/src/integrations/google-sheets/adapter.ts；backend/src/config.ts；specs/002-guided-notes-import-export/contracts/google-sheets-boundary.md；.env.example。

## Preserve request, error, and size conventions

- **Decision**: 沿用 JSON envelope、requestId、typed protocol validation、穩定錯誤碼與 16 KiB 訊息上限。
- **Rationale**: 現有前後端皆依賴此契約；驗證可提供明確錯誤並限制單筆 payload 大小。
- **Alternatives considered**: 新增另一個 endpoint 或無上限文字欄位。兩者都非必要，無上限資料也會增加記憶體風險。
- **Evidence**: backend/src/realtime/protocol.ts；backend/src/config.ts；001／002 realtime contracts。

## Decisions carried from the specification

- 答案只要含非空白字元即有效；接受後保留原文。
- 只有通過所有驗證的提交才會取得伺服器接收序號；拒絕或重複提交不改變答案及順位。
- 不新增正確性判斷、計分、修改、撤回、單題重置或程序重啟復原。
- 教師更新傳給所有已驗證教師連線；學生訊息只含自己組別可見資料。
- 2 秒目標在本機正常連線及實際班級人數下驗收，不新增硬性人數限制。
