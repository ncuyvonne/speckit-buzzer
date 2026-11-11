# Implementation Plan: 002 Guided Notes 匯入與匯出（單題）

**Branch**: `codex-002-guided-notes-import-export` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification in `specs/002-guided-notes-import-export/spec.md`; project technology choices and the 002 PlantUML diagrams in `diagrams/`.

## Summary

沿用既有 React/TypeScript/Vite 前端與 Node.js/WebSocket 後端。老師只在既有 WebSocket 連線已驗證為老師時匯入或寫回；後端再檢查伺服器持有的活動階段，並由 `GuidedNotesService` 呼叫 Google Sheets API。既有 `backend/src/server.ts` 作為 composition root，建立 Sheets adapter、Feature 003 結果 provider 與 Guided Notes service，並注入 RealtimeHub；在 Feature 003 provider 實作尚未接入前，正式預設 provider 明確回傳 `UNAVAILABLE`，因此不執行寫回；測試可用 fake adapter/provider 注入同一組服務接線。工作表欄位及題號列每次從所選工作表內容動態辨識。成功匯入後，伺服器以記憶體保存工作表參照和有序題號；寫回時重新讀取工作表、依題號定位目標格，再以單一批次更新寫入答案及清空無人作答格。SQLite 不加入本功能，因 001 已選定單程序記憶體活動且規格沒有重啟復原要求。

## Technical Context

**Language/Version**: TypeScript 5.9；Node.js 24 LTS（延續 001）

**Primary Dependencies**: React 19、Vite 8、Node.js `ws` 8、Google Sheets API v4 Node.js client (`googleapis`)、Vitest 5、Playwright 1.63

**Storage**: 後端單程序記憶體；題號清單和工作表參照隸屬目前 Activity。工作表座標於每次操作重新讀取時暫時計算，不作為可信的永久位置保存。SQLite 不使用。

**Testing**: Vitest 單元及 WebSocket 整合測試；Playwright 端對端測試；`tsc --noEmit` 型別檢查；E2E 使用可注入的 fake Sheets adapter，不依賴真實憑證。

**Target Platform**: Windows 本機課堂單機執行；前端及 Node.js 僅綁定 `127.0.0.1`，後端對 Google Sheets API 發出必要的外部 HTTPS 請求。

**Project Type**: 本機全端 Web 應用程式（React SPA、Node.js HTTP/WebSocket 服務）。

**Performance Goals**: SC-006 的 10 秒目標使用可重現參考工作表：最多 100 題、grid 不超過 1,000 列 × 26 欄、無限流或暫時性 API 錯誤且不注入網路延遲。這是 benchmark fixture，不是產品對工作表 grid 尺寸的限制；其他尺寸仍動態掃描並記錄實際耗時。

**Constraints**: 工作表參照、老師身分及階段由後端驗證；Google 機敏憑證僅由後端環境變數載入。沿用 001 每條新 WebSocket 連線重新登入老師的規則。單份工作表最多 100 題；只支援單題模式。

**Scale/Scope**: 一個本機活動、單一老師操作流程、多個學生連線；尚未匯入工作表時為 0 題，成功匯入後為 1–100 個唯一非空題號。掃描範圍為老師選定工作表的整個 grid，以符合標題列可在任一列、欄位可在任一欄的規格。

## Constitution Check

| 憲章原則 | 計畫符合方式 | Gate |
|---|---|---|
| I. 輸入驗證與清楚錯誤 | 驗證工作表 URL／工作表名稱、唯一標題列、題號唯一性與 100 題上限；Google 錯誤轉成可採取行動且不含原始憑證的訊息。 | PASS |
| II. 機敏資料只由環境變數提供 | 後端從 `GOOGLE_SERVICE_ACCOUNT_JSON` 建立 API 認證；`.env` 維持忽略，`.env.example` 只列變數名稱及無效佔位說明；不將憑證送至瀏覽器或 log。 | PASS |
| III. 正常與邊界案例測試 | 計畫 Vitest 測正常、錯誤、空列、重複題號、100/101 題、批次失敗；Playwright 驗證老師操作及可見結果。實作階段須執行並回報。 | PASS（規劃已涵蓋；尚未執行測試） |
| IV. 共享狀態與時間以伺服器為準 | WebSocket handler 以連線老師角色及 Activity.stage 授權；匯入資料完整驗證後才替換活動題目清單；答案來源由伺服器活動結果提供。 | PASS |
| V. 程式碼與文件保持一致 | 本計畫、資料模型及契約逐一對應四張 002 PlantUML 圖。修正文檔清單中過期的「預期題數必須一致」註記，使其符合已釐清的自動計數規則。 | PASS |
| VI. 獨立 branch 與 PR | 目前位於 `codex-002-guided-notes-import-export`；完成後依憲章透過 PR 審查，不在本階段合併。 | PASS |
| VII. PlantUML 設計優先 | 下表逐張把組件圖、類別圖及兩張時序圖映射到服務、資料模型、契約和測試；實作完成時再核對圖與程式。 | PASS |
| 本機執行範圍 | UI 與 WebSocket server 維持 loopback；Google Sheets API 是本功能明確要求的外部資料來源，不會將本機應用公開部署。 | PASS |

**Pre-research gate**: PASS。使用者已明確指定技術棧；資料庫選擇依 001 的既有決策採記憶體。Google API 批次更新、認證及本地整合模式已完成文件研究。撰寫計畫時，真實服務帳戶與工作表 PoC 尚待使用者提供；實作階段已以 T004 通過，實際結果記錄於 quickstart，現況不再是未執行。

## Project Structure

### Documentation (this feature)

```text
specs/002-guided-notes-import-export/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── guided-notes-websocket.md
    └── google-sheets-boundary.md
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── components/
│   │   └── GuidedNotesPanel.tsx       # 老師輸入工作表、匯入、查看題數、確認寫回
│   ├── realtime/
│   │   ├── client.ts                  # 沿用既有連線及老師登入生命週期
│   │   └── messages.ts                # 新增 Guided Notes request/response/error 型別
│   └── state/
│       └── activity.ts                # 顯示伺服器回報的匯入題號與題數
└── tests/e2e/
    └── guided-notes.spec.ts           # 透過 Playwright fixture 注入 fake Sheets adapter

backend/
├── src/
│   ├── server.ts                      # composition root；從環境變數讀認證並注入 feature services/providers
│   ├── config.ts                      # 驗證 backend-only service-account JSON，不回傳原始解析錯誤
│   ├── domain/
│   │   └── activity-state.ts          # 目前活動題號、工作表參照的伺服器端狀態
│   ├── realtime/
│   │   ├── protocol.ts                # 驗證新訊息形狀及大小
│   │   └── handler.ts                 # 驗證連線角色與活動階段後派送操作
│   ├── guided-notes/
│   │   ├── service.ts                 # 匯入／寫回流程及活動狀態交換
│   │   ├── worksheet-parser.ts        # 標題、題號及目標列映射的純邏輯
│   │   └── unavailable-results.ts     # Feature 003 接入前安全回傳 UNAVAILABLE 的預設 provider
│   └── integrations/google-sheets/
│       ├── types.ts                   # 可注入 Sheets adapter 介面
│       ├── errors.ts                  # Google API 錯誤正規化
│       └── adapter.ts                 # 建立 Sheets v4 client、工作表讀取與單一 batchUpdate
├── scripts/
│   ├── guided-notes-sheets-poc.ts      # 僅對 disposable worksheet 執行的手動 API PoC
│   └── guided-notes-service-benchmark.mjs # 先 build，再以實際 service/adapter 測 import/export；限制於 scratch range 並還原
└── tests/
    ├── unit/guided-notes/             # parser、驗證、錯誤映射、資料狀態
    ├── integration/                   # WebSocket 授權與 Sheets adapter 注入
    └── support/                       # fake Sheets transport / fixture
```

**Structure Decision**: 延續現有 npm workspaces 的 `frontend/` 和 `backend/`，不新增 app、資料庫或狀態管理框架。前端只負責老師操作與呈現；WebSocket 與活動權威留在既有 handler/domain；Google API 與表格解析放在後端新模組。這個分層對應組件圖的 UI → SheetFlow → Sheet，以及 Activity Questions／Results 的伺服器資料來源。

## PlantUML Blueprint Alignment

| PlantUML 圖表 | 規劃依據 | 對應實作與設計產物 |
|---|---|---|
| `diagrams/002-guided-notes-component.puml` | UI 不直接呼叫 Google；後端 SheetFlow 協調匯入／寫回，Questions 由 Activity 保存，Results 由核心搶答活動提供。成功答案覆寫、無人答題清空、錯誤時整批不變。 | `GuidedNotesPanel`、WebSocket handler、`server.ts` composition root、`GuidedNotesService`、typed `WinningResultsProvider`（Feature 003 未接入時以 UNAVAILABLE provider 安全拒絕寫回）、`ActivityState`、Google Sheets adapter；`data-model.md`、兩份 contract。 |
| `diagrams/002-guided-notes-class.puml` | 表達 RealtimeHub 的連線角色授權、GuidedNotesService 的序列化與 deadline、ActivityState、worksheet reference、結果 provider 與 Sheets adapter 的具體責任。 | `ConnectionContext`、`GuidedNotesService`、`ActivityState`、`WorksheetReference`、`Question`、`WinningResultsProvider` 及 `GoogleSheetsAdapter`；座標映射每次讀取時產生，避免以匯入時的舊列號寫回。 |
| `diagrams/002-guided-notes-sequence-import.puml` | 先驗證老師及 PREPARING，再讀所選工作表、動態找標題列與兩欄，驗證有效題號，最後一次替換活動清單。 | `guidedNotes.import` 契約、純 parser、`GuidedNotesService.importWorksheet`；匯入錯誤時保留舊活動清單。零有效題號依時序圖視為不可匯入。 |
| `diagrams/002-guided-notes-sequence-export.puml` | 先驗證老師及 ENDED；要求結果 provider 回傳 READY，從伺服器結果取得答案，重讀最新工作表、重定位題號，先完成全部驗證，再一次批次寫入答案或空字串；明確未套用可有限重試；回應不明時讀回且不盲目重送。 | `guidedNotes.export` 契約、伺服器端 `WinningResultsProvider`、`GuidedNotesService.exportAnswers`、單一 `values.batchUpdate`；缺漏或重複的活動題號會在寫入前拒絕。 |

**Mapping rules**: 題號按 Google 回傳的顯示文字保留，僅以空白判斷空題號；標題欄以 trim 後的精確文字辨識。寫回只要求目前工作表能將每個活動題號唯一定位；不屬於本活動的額外工作表題號不會被更新。舊 `sourceRow` 僅供來源追蹤，寫回不可依賴它。

## Design Decisions and Operation Boundaries

1. **活動狀態**：沿用 001 的 Activity 記憶體狀態。匯入先在暫存資料完成所有解析和驗證，提交前再次確認伺服器階段仍為 PREPARING，成功後才替換題目清單與工作表參照；若 Sheets 讀取／解析失敗或活動階段期間已改變，現有活動不變。伺服器重啟後按 001 規則開始新活動，不保證還原上一份工作表。
2. **工作表參照**：老師貼上 Google Sheets URL 並從工作表名稱選擇分頁。後端解析 spreadsheet ID 並檢查工作表名稱，瀏覽器不接受憑證或 API access token。
3. **認證**：本機服務帳戶 JSON 由 `GOOGLE_SERVICE_ACCOUNT_JSON` 環境變數提供；範圍限 Google Sheets API。老師需將要使用的試算表分享給該服務帳戶。因專題要求憑證由環境變數提供且系統本機單人操作，先不導入 OAuth 同意頁、refresh token 儲存或 Google Picker。
4. **讀取及識別**：後端查詢工作表 grid 尺寸並暫時讀取所選分頁值；以 `FORMATTED_VALUE` 保留可見題號文字。只有整格修剪前後空白後精確等於「題號」或「作答」才算標題。只有同一列含兩種必要標題才是候選列；只含一種標題的說明／資料列不構成候選，也不因該標題重複而拒絕。候選列各自必須只有一個兩種標題，且候選列唯一。題號 ID 精確比對；匯入 1–100 個非空唯一 ID，空白列跳過，零題或超過 100 題拒絕。為找動態標題而暫時讀取的格子不會成為活動資料、瀏覽器回應或業務輸入；只保存題號、題數及來源參照。
5. **寫回及原子性**：先確認活動已有成功匯入的 WorksheetReference；若無，回傳 `WORKSHEET_NOT_IMPORTED` 並在呼叫結果 provider 或 Sheets adapter 前停止。重新掃描目前工作表，對每個活動題號要求唯一列，先建好全部目標 ranges；任一標題／題號映射失敗則不呼叫寫入。全部答案和無人答題的空字串清除放入單一 `spreadsheets.values.batchUpdate`，`valueInputOption=RAW`，不拆成多個批次或另發 `batchClear`。Google API 對 Sheets requests 提供原子套用；明確拒絕表示沒有更新，回應遺失則讀回目標格：全數符合預期才回報成功、全數未變才回報失敗，仍不確定時顯示 `SHEET_WRITE_UNCONFIRMED`。若 10 秒期限在批次請求仍 pending 時屆滿，服務回報未確認；期限不會取消已送出的 API 請求，該請求可能在回覆後完成。操作鎖維持到原請求結束，老師須先檢查工作表再決定是否重試。
6. **操作序列**：一次只允許一個 Guided Notes 外部操作；使用後端操作鎖避免同活動同時匯入／寫回。階段及老師權限均於 server 收到訊息時驗證，不接受 client 提供的 stage 或搶答結果。
7. **錯誤與重試**：外部錯誤映射到固定錯誤代碼和可行動訊息，log 只記錯誤分類及 requestId，不記 URL query、憑證或原始 API response。僅對 idempotent reads 或明確確認未套用的寫入拒絕重試；每個 request 最多重試兩次，退避 250 ms、500 ms，整個 operation 以 10 秒為 deadline 並把 read-back 計入期限。寫入結果不確定時先讀回且不盲目重送；若期限在已送出的批次請求結束前屆滿，回報 `SHEET_WRITE_UNCONFIRMED`，明確告知該請求可能在逾時回覆後完成，並保留操作鎖至請求結束；老師應先檢查工作表再決定是否重試。

## 實作前驗證與順序

1. 使用已分享給服務帳戶的 disposable 測試工作表執行 Google Sheets API 讀寫 PoC，檢查環境變數認證、動態標題／欄位定位、RAW 答案寫入、空字串清除、拒絕時整批不變及 SC-006 參考 grid。此 gate 已於 T004 通過；實際命令、fixture、恢復檢查和耗時記錄於 quickstart，Phase 6 的 T038 再核對完整 live-sheet 情境與效能紀錄。
2. 建立純 parser 及 Activity replacement 的 Vitest 單元測試，再實作 Google Sheets adapter 和其錯誤映射測試。
3. 在 `backend/src/server.ts` composition root 注入正式 Sheets adapter 與 Feature 003 provider，新增 WebSocket message unions 與 server dispatch；另以注入 fake 的相同 root 驗證 teacher role、PREPARING/ENDED gating 及 operation lock 的整合測試。
4. 接上老師 UI 並新增 fake-adapter Playwright flows：有效匯入、缺標題／重複題號、學生拒絕、階段拒絕、成功寫回、無人答題清空及模擬整批失敗。
5. 執行 feature tests、workspace typecheck/build 及 E2E；逐張核對表中四張圖與契約、程式行為。測試須通過後再進下一個實作 Phase，並回報實際命令與結果。

## Risks and Bounded Assumptions

- **Grid 大小與 10 秒目標**：規格限制題數但沒有限制空白列／欄或工作表 grid 尺寸。完整掃描維持任意位置辨識；SC-006 以 1,000 × 26 參考 grid 重現 10 秒 benchmark，其他尺寸記錄實際延遲，不能把 benchmark 當產品上限或固定位置假設。
- **服務帳戶分享流程**：老師需把試算表分享給 service account email。若教學情境不允許分享，必須在實作前改採老師 OAuth；不可把服務帳戶私鑰送至瀏覽器。
- **外部同時編輯**：寫回重新讀取最新欄位及題號並只更新目標答案格；Google Sheets API 本計畫未使用 compare-and-swap，無法原子保護「重新掃描」到「批次送出」之間由外部編輯者更動題號或目標格的競態。系統不寫入非目標 range，但此競態是已知限制，不能宣稱已偵測或避免；驗收需記錄此假設及風險。
- **結果來源相依**：寫回依賴 Feature 003 提供每題成功組別及答案；本功能只傳遞和保存，不判斷答案正確性。

## Post-Design Constitution Check

| 憲章原則 | Phase 1 證據 | Gate |
|---|---|---|
| I. 驗證及清楚錯誤 | WebSocket contract、Google boundary contract、parser validation/error mapping | PASS |
| II. 憑證只由環境變數提供 | `GOOGLE_SERVICE_ACCOUNT_JSON` 只在後端；quickstart 設定不提交的 `.env`；前端契約不含秘密 | PASS |
| III. 正常與邊界測試 | quickstart 列出 Vitest、Playwright、型別檢查及必要案例；實作階段尚未跑測試 | PASS（測試待實作階段執行） |
| IV. 伺服器為狀態權威 | Activity/stage/winner 由後端提供；前端只送工作表選擇和寫回確認 | PASS |
| V. 文件與程式一致 | 四張圖到模組／模型／契約對照完成；清單過時 Notes 已修正；實作需按 quickstart 核對 | PASS |
| VI. Branch/PR | 分支為 `codex-002-guided-notes-import-export`；PR 審查留在交付階段 | PASS |
| VII. 圖表優先 | 組件、類別、匯入及寫回時序各有明確實作映射；輸出 PNG 與 `.puml` 保持配對 | PASS |
| 本機限制 | 服務僅在 loopback 執行；Sheets API 是限定的外部整合 | PASS |

**Post-design gate**: 文件設計一致性 PASS。計畫撰寫當時，真實 Google Sheets 帳戶 PoC 仍是 Phase 1 的硬性 gate；實作時 T004 已通過，Phase 3–5 自動化測試結果記錄於 quickstart。此歷史設計 gate 不代表目前仍有 PoC 或測試待執行。

## Complexity Tracking

無憲章例外或額外專案層。延用既有 workspace、WebSocket 協定及記憶體 Activity；不加入 SQLite、前端狀態管理框架或另一套 web framework。
