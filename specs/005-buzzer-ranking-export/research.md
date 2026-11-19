# Research: 005 搶答公平順位與 CSV 匯出

## Decisions

### 1. 沿用單一 backend 程序記憶體

**Decision**: 將公平設定、有效答案、成功題數快照及順位結果保存在既有 backend 程序狀態中，不新增 SQLite。

**Rationale**: `backend/src/domain/activity-state.ts` 已將活動定義為單一程序擁有；`backend/src/domain/buzzer-results.ts` 使用 `Map` 保存目前活動答案。Feature 003 的計畫與規格明確不要求程序重啟後復原，因此 005 沿用同一生命週期即可。

**Alternatives considered**: SQLite。拒絕於本功能採用，因為它會新增 schema、交易、重啟恢復及清除資料規則，而 005 不要求這些行為。

### 2. 使用接受時快照計算公平延遲

**Decision**: 每筆有效答案接受前，讀取該組在其他題目目前排行第一的題數 K，並固定該筆答案的有效時間。公平順位啟用時 `effectiveAtMs = receivedAtMs + K × delaySeconds × 1000`；關閉時 `effectiveAtMs = receivedAtMs`。排名同時時以伺服器接受順序決勝。

**Rationale**: 這遵循 Feature 005 的釐清答案，讓已接受答案不因其他題後來的順位改變而回溯變更。現有 `BuzzerResultsService.submitAnswer` 已把驗證、唯一鍵檢查和插入放在同步操作中，可延續作為多連線提交的線性化點。

**Alternatives considered**: 活動結束後以最終成功題數重算所有有效時間。未採用，因為這會讓題目之間相互依賴並改寫已接受答案的時間快照。

### 3. 沿用 WebSocket 作為設定、結果及下載授權通道

**Decision**: 擴充既有 teacher-only WebSocket 協定，提供公平設定、順位投影及 CSV 匯出回應；前端將 CSV 回應下載成檔案。

**Rationale**: 目前 teacher 身分存在於已驗證 WebSocket connection context。沿用它可以保留現有角色與階段檢查，避免新增 HTTP 登入、Cookie 或下載 token 系統。

**Alternatives considered**: 新增 HTTP 檔案下載路由。未採用，因為它需要另外建立與現有 WebSocket 教師身分相連的 HTTP 授權機制。

### 4. CSV 使用既定列模型和 Windows 相容編碼

**Decision**: CSV 每個題目／組別組合一列；欄位包含題號、成功組別、成功答案、組別、組別答案、順位。檔案用 UTF-8 BOM、CRLF 列分隔及標準 CSV 引號逸出。

**Rationale**: 一列一組可同時呈現每題成功者與各組順位；BOM 對應使用者已確認的 Windows Excel 直接開啟需求。標準逸出保留答案內的逗號、引號及換行。

### 5. 沿用既有測試分層

**Decision**: Vitest backend tests 驗證延遲公式、同時排序、輸入驗證及 CSV bytes；WebSocket integration tests 驗證角色／階段；Playwright 驗收老師設定、學生答案隔離、結束後順位與檔案下載。

**Rationale**: 專案已有 backend/frontend Vitest 設定、WebSocket test server 與 fake Sheets adapter，以及每個 E2E case 使用隔離後端的 Playwright fixture。Vite 只轉譯 TypeScript、不執行型別檢查，因此另執行 `npm run typecheck`。

## Integration Research

- Google 官方 Node.js quickstart 使用 Google Workspace API client library，並提醒正式環境須選擇適當的授權／憑證方式：[Sheets API Node.js quickstart](https://developers.google.com/workspace/sheets/api/quickstart/nodejs)。本功能沿用 repo 現有 service-account JSON 後端環境變數，不新增授權流。
- Sheets values API 以 spreadsheet ID 和 A1 range 讀寫；多個範圍可用 batch API，文字輸入選項應依是否需要解析公式／日期選擇：[Read and write cell values](https://developers.google.com/workspace/sheets/api/guides/values)。Feature 005 不直接讀寫 Sheets。
- Sheets `spreadsheets.batchUpdate` 會先驗證子請求，失敗時整批不套用：[Batch requests](https://developers.google.com/workspace/sheets/api/guides/batch)。此行為是 Feature 002 現有 worksheet 操作的背景，不是本功能 CSV 匯出依賴。
- Google ADC 可由 `GOOGLE_APPLICATION_CREDENTIALS`、本機 ADC 檔或執行環境服務帳戶找憑證：[Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)。本 repo 已使用 `GOOGLE_SERVICE_ACCOUNT_JSON`，本規劃不改變既有憑證格式。
- Vite 只轉譯 TypeScript，型別檢查須由獨立命令負責：[Vite TypeScript features](https://vite.dev/guide/features#typescript)。
- Vitest 預設使用 Node test environment；本功能的資料和 CSV 測試可沿用設定，不必新增 DOM 模擬相依套件：[Vitest test environments](https://vitest.dev/guide/environment.html)。
- Playwright 建議以使用者可見結果撰寫隔離測試：[Playwright best practices](https://playwright.dev/docs/best-practices)。E2E 重用現有 fake-service fixtures，不依賴真實 Google 帳戶或課堂試算表。

## Local Codebase Evidence

- `backend/src/server.ts` 每次建立 server 時建立一個 `ActivityState`、`GroupRoster`、`BuzzerResultsService`、Sheets adapter 和 `RealtimeHub`。
- `backend/src/domain/buzzer-results.ts` 已有 `receivedOrder`、伺服器 `acceptedAt`、每組每題唯一提交及教師／學生不同結果投影。
- `backend/src/realtime/handler.ts` 已按 teacher/student connection role 處理活動階段、提交、教師進度、學生結果和 Feature 002 Sheets import/export。
- `frontend/src/realtime/messages.ts`、`frontend/src/realtime/client.ts`、`frontend/src/state/buzzer-results.ts` 是新增設定、排名和下載協定的對應點。
- `frontend/tests/e2e/fixtures.ts`、`backend/tests/support/fake-google-sheets.ts` 提供隔離驗收所需的既有測試支援。
