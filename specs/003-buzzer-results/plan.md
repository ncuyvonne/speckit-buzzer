# Implementation Plan: 003 搶答與結果判定

**Branch**: codex-003-buzzer-results | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification in specs/003-buzzer-results/spec.md; primary design blueprints are the 003 PlantUML source files under ./diagrams/.

## Summary

沿用既有 React／TypeScript／Vite 前端、Node.js WebSocket 服務及單一活動記憶體狀態。新增 BuzzerResultsService，由已驗證學生連線提交答案並從伺服器連線狀態取得組別。服務驗證活動階段、題號、答案和唯一提交鍵，於一次不含非同步等待的同步操作中接受並鎖定首筆有效答案，以伺服器遞增序號決定各題勝出組別。服務產生教師完整作答進度、學生本組確認、活動結束後的角色限定結果，並實作 Feature 002 已預留的 WinningResultsProvider。前端沿用現有 WebSocket 連線及協定。

## Technical Context

**Language/Version**: 前端 TypeScript 5.9 + React 19 + Vite 8；後端 Node.js 24 LTS + TypeScript 5.9 + WebSocket。

**Primary Dependencies**: React 19、Vite 8、Node.js ws 8、Google Sheets API v4（既有 googleapis 套件，由 Feature 002 adapter 使用）、Vitest 5、Playwright 1.63；本功能沿用現有相依套件。

**Storage**: 單一後端程序記憶體，沿用 ActivityState、活動題號及 GroupRoster；答案與結果僅在目前程序保存，重啟後不復原。SQLite 雖是可行選項，但本功能規格及 001 的活動生命週期均不要求重啟復原，因此不引入持久化資料庫。

**Testing**: Vitest 單元測試及 WebSocket 整合測試；Playwright 端對端測試；tsc --noEmit 型別檢查。本規劃階段未執行測試。

**Target Platform**: Windows 本機課堂單機執行；前後端沿用 loopback 連線及 /ws。

**Project Type**: 本機全端 Web 應用程式（React SPA、Node.js WebSocket 服務）。

**Performance Goals**: 一位老師與實際班級全體學生同時在線、正常本機連線時，每筆有效答案送出後 2 秒內更新教師作答狀況。

**Constraints**: 僅在 BUZZING 接受答案；沿用既有活動題號和組別設定；客戶端不可指定組別、接收時間或成功結果；依角色與階段限制資料回傳；沿用 16 KiB WebSocket 訊息上限；不判斷正確性或計分。Feature 003 提供權威結果給 Feature 002；Google Sheets 讀寫由既有 Google Sheets API v4 adapter 執行，GOOGLE_SERVICE_ACCOUNT_JSON 僅從後端環境變數讀取，不傳到瀏覽器或訊息中。

**Scale/Scope**: 一個本機活動、既有組別清單、由 Feature 002 匯入的 1–100 個題號；同組可有多個學生連線。驗收以實際班級人數為準，沒有新增產品人數上限。

## Constitution Check

| 憲章原則 | 計畫符合方式 | Gate |
|---|---|---|
| I. 輸入驗證與清楚錯誤 | 後端驗證連線角色、組別、階段、題號、非空白答案及唯一提交；回傳穩定錯誤代碼和可理解訊息。 | PASS |
| II. 機敏資料只由環境變數提供 | Google Sheets 服務帳戶憑證沿用 Feature 002 的 GOOGLE_SERVICE_ACCOUNT_JSON 後端環境變數；不傳到瀏覽器、訊息或 log。003 不另存憑證。 | PASS |
| III. 正常與邊界測試 | 規劃正常提交、空白、錯誤階段／題號、同組並行與重複提交、跨組競答、角色隔離及重連案例。實作時須執行並回報。 | PASS（測試待實作階段） |
| IV. 共享狀態與時間以伺服器為準 | 組別取自伺服器連線；同步接受操作和伺服器接收序號決定鎖定與勝出；忽略客戶端時間及勝出宣告。 | PASS |
| V. 程式碼與文件保持一致 | 資料模型、WebSocket 契約、Feature 002 結果 provider 和 003 四張 PlantUML 圖逐項對照。 | PASS |
| VI. 獨立 branch 與 Pull Request | 規劃位於 codex-003-buzzer-results；完成後依憲章提交 PR 審查，不在本階段合併。 | PASS |
| VII. PlantUML 設計優先 | 使用組件圖、類別圖、提交時序圖及結果釋出時序圖作為資料、訊息和模組藍圖。 | PASS |
| 本機執行範圍 | 前後端仍只在本機 loopback 執行，不新增外部服務或部署方式。 | PASS |

**Pre-research gate**: PASS。規格與本機技術選擇已明確；既有程式、001／002 契約和 ./diagrams/ 中 003 PlantUML 圖提供所需整合模式。Google Sheets API 與後端環境變數憑證沿用 Feature 002，不由 Feature 003 重複建立整合。

## Project Structure

### Documentation（本功能）

```text
specs/003-buzzer-results/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── realtime-websocket.md
```

### Source Code（repository root）

```text
frontend/
├── src/
│   ├── components/
│   │   ├── BuzzerAnswerPanel.tsx
│   │   └── TeacherResultsPanel.tsx
│   ├── realtime/
│   │   ├── client.ts
│   │   └── messages.ts
│   └── state/
│       └── buzzer-results.ts
└── tests/e2e/

backend/
├── src/
│   ├── domain/
│   │   └── buzzer-results.ts
│   ├── guided-notes/
│   │   └── winning-results-provider.ts
│   └── realtime/
│       ├── protocol.ts
│       └── handler.ts
└── tests/
    ├── unit/
    └── integration/

diagrams/
├── 003-buzzer-results-component.puml / .png
├── 003-buzzer-results-class.puml / .png
├── 003-buzzer-results-sequence-submit.puml / .png
└── 003-buzzer-results-sequence-release.puml / .png
```

**Structure Decision**: 沿用 npm workspaces 的 frontend/、backend/ 及現有 WebSocket 協定。作答狀態和結果投影放在後端領域服務；handler 負責授權、協定處理及依角色傳送；前端只保存和顯示伺服器投影。Google Sheets API 的讀寫仍由 Feature 002 的 server-side adapter 負責，Feature 003 只提供獲勝結果 provider。依 001 的單次程序活動生命週期使用記憶體，不新增 SQLite 或另一個應用程式。任務拆解時可依實際模組命名微調檔名。

## PlantUML Blueprint Alignment

本計畫以 ./diagrams/ 中 003 的四張 PlantUML 圖為主要設計藍圖，而非事後補充的插圖。實作模組、資料欄位、協定訊息、角色隔離及測試案例均依下表映射；若實作需偏離圖表，須同步修正 .puml 與 PNG 並記錄理由。

| PlantUML 圖表 | 規劃依據 | 對應設計／模組 |
|---|---|---|
| diagrams/003-buzzer-results-component.puml | UI 經 RealtimeHub 提交或查詢；服務讀取活動和組別並產生教師進度、學生確認及結果。 | 前端結果面板、backend/src/realtime/handler.ts、backend/src/domain/buzzer-results.ts、ActivityState、GroupRoster。 |
| diagrams/003-buzzer-results-class.puml | GroupSubmission 以組別＋題號唯一；教師和學生結果是不同投影；接收順序決定勝者。 | data-model.md、後端領域服務、前端訊息型別、WinningResultsProvider。 |
| diagrams/003-buzzer-results-sequence-submit.puml | 依序驗證身分、階段、題號與答案；首筆有效答案鎖定；本組收到確認、教師收到即時更新。 | realtime-websocket.md、protocol decoder、handler、領域服務。 |
| diagrams/003-buzzer-results-sequence-release.puml | ENDED 後學生查詢勝出答案及本組結果；教師查詢完整資料。 | 契約的結果查詢／回應、服務投影、前端結果檢視。 |

圖表、資料模型及契約須共用相同狀態、欄位與訊息流程。實作若改變流程，須一併更新 PlantUML 來源及相鄰 PNG。

## Design Decisions and Operation Boundaries

1. **伺服器端原子接受**：submission service 以不含非同步等待的同步操作檢查階段、題號、答案及「組別＋題號」是否存在，並接受／鎖定首筆答案。此 check-and-set 是線性化點；不可在其中等待外部工作。
2. **競答排序**：接受的有效提交取得伺服器遞增 receivedOrder；每題序號最小者為唯一勝者。伺服器時間戳可作診斷欄位，但不是 tie-break 權威。無效或重複提交不消耗勝出順位。
3. **伺服器授權和投影**：組別從已驗證連線取得，不讀取 payload 的組別。教師快照／更新只傳給教師；BUZZING 學生只收本組確認；ENDED 學生只收勝出答案和本組答案／狀態。須在伺服器建立和傳送訊息時執行過濾。
4. **活動題目**：沿用 001／002 伺服器持有的單一 Activity 及題號清單。學生加入後只收到排序題號清單，以便選題；不接收題目敘述或正解。只在 BUZZING 接受目前清單中的題號；保留答案原始文字，以 Unicode 空白判斷是否全空白。
5. **連線恢復與生命週期**：答案按活動內組別和題號保存，不綁定學生 socket；BUZZING 學生重新加入後只收到本組逐題鎖定／答案狀態，ENDED 學生查詢角色限定結果。程序重啟建立新活動，舊答案不復原。
6. **Feature 002 結果邊界**：實作既有 WinningResultsProvider，以伺服器成功答案建立 WinningResultsSnapshot。有題目但無人作答時回傳 READY 空答案清單；沒有可用題目時回傳不可用狀態，阻止匯出。客戶端不能提供匯出結果。
7. **即時更新**：有效提交同步更新狀態後，發送最新題目進度給教師連線；老師登入時取得初始進度；學生僅在 ENDED 查詢角色限定結果。沿用 requestId、錯誤 envelope 和 16 KiB 限制。2 秒目標以實際班級人數作本機端對端驗收。

**Pre-design gate result**: PASS。無憲章例外；權限、共享狀態、資料生命週期及 PlantUML 對應均有明確設計依據。

## Implementation Handoff

後續任務建議順序：領域模型和同步提交服務；結果 provider 與 002 接線；protocol、WebSocket 授權／回應／教師廣播；前端面板和狀態；單元、整合、端對端案例；最後逐張核對四張 PlantUML 圖。具體任務由 $speckit-tasks 產生；本計畫不建立 tasks.md。

## Post-Design Constitution Check

| 憲章原則 | Phase 1 設計證據 | Gate |
|---|---|---|
| I. 驗證及清楚錯誤 | 契約列明角色、階段、題號、空白和鎖定錯誤；伺服器驗證。 | PASS |
| II. 機敏資料 | GOOGLE_SERVICE_ACCOUNT_JSON 僅由後端環境變數讀取；憑證不傳至瀏覽器／訊息或 log，提交內容也不寫入 log。 | PASS |
| III. 正常與邊界測試 | quickstart 列出正常、錯誤、競賽、角色隔離和重連驗收；實作時執行。 | PASS（測試待實作階段） |
| IV. 伺服器權威 | 後端持有提交、鎖定、接收序號和勝出結果；前端只呈現結果。 | PASS |
| V. 文件一致性 | 契約、資料模型、Feature 002 provider 邊界和四張 003 圖逐項對照。 | PASS |
| VI. branch／PR | 使用獨立功能分支，完成後以 PR 審查。 | PASS |
| VII. PlantUML 優先 | 每張圖均對應明確服務、訊息、資料欄位或投影。 | PASS |
| 本機執行 | 沿用 loopback，不新增遠端部署或服務。 | PASS |

**Post-design gate**: PASS。實作後仍須依憲章執行適用測試並記錄實際結果；本規劃階段未執行測試。

## Complexity Tracking

無憲章違規或額外架構層。答案只需在現有後端程序使用 Map／等效集合保存；不新增資料庫、外部服務、狀態管理框架或另一套 WebSocket server。
