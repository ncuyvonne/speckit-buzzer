# Implementation Plan: 005 搶答公平順位與 CSV 匯出

**Branch**: `codex/005-buzzer-ranking-export` *(isolated worktree based on approved Feature 004 PR #4 head `890395169abaede0c3d4362e630d78e8f2b4bd99`; PR #4 is open, so this is a stacked branch)* | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification in `specs/005-buzzer-ranking-export/spec.md`; primary blueprints are the Feature 005 PlantUML sources and PNGs under `./diagrams/`.

## Summary

沿用現有 React／TypeScript／Vite 前端、Node.js WebSocket 後端與單一活動記憶體狀態。老師可在準備階段設定公平順位；每筆答案接受時，伺服器依該組在其他題目當下排行第一的題數快照計算延遲秒數，並以有效時間和伺服器確認順序重排該題。教師即時結果及活動結束後學生結果增加順位投影，維持現有答案可見範圍。

活動結束後，教師透過既有已驗證 WebSocket 下載 CSV。後端依題目順序和順位為每筆已接受提交產生一列 UTF-8 BOM CSV；前端將回傳內容下載為檔案。Google Sheets API v4 及環境變數憑證沿用 Feature 002，只用於既有學習單讀寫；本功能 CSV 不新增 Sheets 寫入流程。

## Technical Context

**Language/Version**: Frontend TypeScript 5.9、React 19.3、Vite 8；backend TypeScript 5.9、Node.js 24.x、`ws` 8.18。此 checkout 的 Node.js 為 24.22.0。

**Primary Dependencies**: 現有 npm workspaces、React、Vite、`ws`、`googleapis` 189、Vitest 5、Playwright 1.63；本功能沿用既有套件，不新增框架或 Google API client。

**Storage**: 後端程序記憶體，沿用 `ActivityState` 與 `BuzzerResultsService` 的生命週期。SQLite 不在本功能採用範圍；活動重啟復原未列入 003／005 規格。

**Testing**: backend/frontend Vitest 單元與整合測試、現有 Playwright E2E、TypeScript `tsc --noEmit`、workspace build。實際驗證結果記錄於 [quickstart.md](./quickstart.md#validation-record)。

**Target Platform**: Windows 本機課堂使用；Vite 綁定 `127.0.0.1:5173`，Node.js WebSocket 後端綁定 `127.0.0.1:3001`，瀏覽器透過 `/ws` 連線。

**Project Type**: 本機全端 Web 應用程式（React SPA + Node.js WebSocket service）。

**Performance Goals**: 正常本機連線下，以本活動 `GROUP_IDS` 設定的組數 N 作為驗收負載（每組一條學生 WebSocket 連線）；每筆有效答案送出後，教師在 2 秒內看到順位與成功組別更新。驗收須記錄 N 與量測結果，依 Feature 005 SC-006 執行。

**Constraints**: 伺服器是階段、組別、接收時間、成功題數快照及順位的權威來源；每組每題一筆有效答案；公平順位僅準備階段設定；活動開始後固定。問題數沿用匯入清單（最多 100 題），WebSocket client message 沿用 16 KiB 上限。Google Sheets service-account 憑證只從 backend 環境變數讀取，不傳到瀏覽器、協定訊息或 log。

**Scale/Scope**: 一個本機活動、既有組別清單及 1–100 個活動題號；不新增程序重啟復原、答案正誤判定、計分或其他部署方式。

## Constitution Check

| 憲章原則 | 規劃符合方式 | Gate |
|---|---|---|
| I. 輸入驗證與清楚錯誤 | 後端驗證公平順位設定、階段、角色、組別、題號、空白／重複答案及匯出前提，回傳可操作的錯誤訊息。 | PASS |
| II. 機敏資料只由環境變數提供 | 沿用 backend `GOOGLE_SERVICE_ACCOUNT_JSON`；憑證不進前端、WebSocket payload 或 log。 | PASS |
| III. 正常與邊界案例測試 | 延遲開關、快照、拒絕提交、角色隔離、CSV escaping／BOM 測試已完成；完整執行結果見 quickstart 驗證紀錄。 | PASS |
| IV. 共享狀態與時間以伺服器為準 | 同步接受操作快照成功題數、記錄 received order，計算 effective time；不採用 client time 或 client winner。 | PASS |
| V. 程式碼與文件一致 | 資料模型、WebSocket／CSV 契約、quickstart 與三張 005 PlantUML 圖相互對照。 | PASS |
| VI. 獨立 branch 與 Pull Request | Feature 005 的專用 worktree branch `codex/005-buzzer-ranking-export` 已建立；提交 PR 審查，並依 PR #4 合併狀態 rebase／retarget。 | PASS（分支已建立；PR 流程依 T036 進行） |
| VII. PlantUML 設計優先 | 組件、類別及時序圖作為服務責任、資料欄位、訊息與結果投影的主要藍圖；組件圖已明確標示程序記憶體。 | PASS |
| 本機執行範圍 | 沿用 loopback；不增加雲端部署、遠端服務或持久化資料庫。 | PASS |

**Pre-research gate**: PASS。Feature 005 規格與技術選擇足以設計；資料存放依現有程式及 Feature 003 生命週期選定記憶體，Google Sheets 沿用既有整合。

## Project Structure

### Documentation（本功能）

```text
specs/005-buzzer-ranking-export/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── realtime-websocket.md
    └── csv-export.md
```

### Source Code（repository root）

```text
frontend/
├── src/
│   ├── components/
│   │   ├── TeacherPanel.tsx             # 準備階段公平順位設定、結束後匯出
│   │   ├── TeacherResultsPanel.tsx      # 教師即時順位
│   │   └── StudentResultsPanel.tsx      # 結束後全組順位投影
│   ├── realtime/
│   │   ├── client.ts                    # 新增設定／匯出訊息處理
│   │   └── messages.ts                  # 更新 WebSocket 型別
│   └── state/
│       └── buzzer-results.ts            # 保存教師順位、學生結束結果及設定狀態
└── tests/
    ├── unit/                            # 純狀態與呈現資料測試
    └── e2e/                             # fairness、排名、CSV 下載驗收

backend/
├── src/
│   ├── domain/
│   │   ├── buzzer-results.ts            # 接受答案、快照及結果投影
│   │   ├── fair-ranking.ts              # 有效時間與單題排序規則
│   │   └── buzzer-results-csv.ts        # CSV 欄位、逸出與 BOM 序列化
│   ├── realtime/
│   │   ├── protocol.ts                  # 新增設定、排行及 CSV 訊息型別
│   │   └── handler.ts                   # 角色、階段檢查及傳送投影
│   └── integrations/google-sheets/      # 沿用 002 adapter，本功能不新增 Sheets 操作
└── tests/
    ├── unit/                            # ranking、輸入驗證、CSV bytes
    └── integration/                     # WebSocket auth、角色隔離及訊息流程

diagrams/
├── 005-buzzer-ranking-export-component.puml / .png
├── 005-buzzer-ranking-export-class.puml / .png
└── 005-buzzer-ranking-export-sequence.puml / .png
```

**Structure Decision**: 沿用現有 `frontend/`、`backend/` npm workspaces 與 `/ws`。排名邏輯與 CSV 序列化放在 backend domain；`RealtimeHub` 驗證權限／階段並傳送適當角色投影；前端只傳送老師設定、呈現伺服器順位及下載回傳 CSV。Google Sheets adapter 保持在既有整合邊界。

## PlantUML Blueprint Alignment

本計畫以 `./diagrams/` 的 Feature 005 三張圖作為設計藍圖。組件圖中的資料狀態已由資料庫圖示改成「程序記憶體」，避免把既有單一活動狀態誤讀成 SQLite 或重啟後持久化。

| PlantUML 藍圖 | 規劃依據 | 對應設計與契約 |
|---|---|---|
| `diagrams/005-buzzer-ranking-export-component.puml` | 教師控制、學生作答／結果、活動服務、順位、角色可見性及 CSV 匯出責任；資料留在單一 backend 程序。 | `RealtimeHub`、`BuzzerResultsService`、`FairRanking`、結果投影、CSV 序列化及 WebSocket 契約。 |
| `diagrams/005-buzzer-ranking-export-class.puml` | `ActivitySettings`、`AcceptedAnswer` 的 received order／成功題數快照／effective time／rank、`QuestionResult`、`CsvResultRow` 關係。 | [data-model.md](./data-model.md)、排名領域服務、CSV 資料欄位。 |
| `diagrams/005-buzzer-ranking-export-sequence.puml` | 準備階段設定、伺服器驗證與計時、公平順位公式、學生角色限定結果及教師匯出流程。 | [realtime-websocket.md](./contracts/realtime-websocket.md)、[csv-export.md](./contracts/csv-export.md)、quickstart 驗收流程。 |

設計與實作不可改變圖中權威資料流或答案可見性而不更新相應 `.puml` 和 PNG；實作結束時逐張核對，並在 PR 說明差異或同步修正。

## Design Decisions and Operation Boundaries

1. **記憶體資料生命週期**：沿用每個 `createRealtimeServer` 建立的 `ActivityState` 和 `BuzzerResultsService`。Feature 003 已將程序重啟後活動復原排除；選 SQLite 會另增儲存、交易和恢復語意，並超出本功能需求。
2. **公平設定生命週期**：老師僅能在 `PREPARING` 設定 `enabled` 和 `delaySeconds`；預設關閉，啟用欄位預填 3 秒。延遲範圍為 1–30 秒（含端點），允許範圍內小數；停用時為空或非空值也須套用相同範圍驗證。活動進入 `BUZZING` 後凍結。
3. **答案接受與快照**：延續現有同步檢查／插入臨界區。接受答案前，計算該組在其他題目前排行第一的數目 K，記錄快照；有效時間為 `receivedAtMs + K × delaySeconds × 1000`。公平順位關閉時有效時間等於 `receivedAtMs`。兩者相同時以伺服器 `acceptedOrder` 排序。
4. **順位與成功組別**：每題按有效時間、再按 accepted order 排出連續順位；第一名就是目前成功組別。每次有效答案接受後重算該題順位，讓尚未提交的組別不占順位。其他題既有答案的 K 快照不追溯更新；新的答案使用其接受當下可見的其他題第一名。
5. **角色投影**：搶答中教師取得各組答案與目前順位；學生只收到本組進度。活動結束後學生取得所有組別的 rank／未作答狀態、成功答案及本組答案，但不取得其他非成功組別答案；教師取得完整結果。
6. **CSV 傳遞方式**：透過已驗證老師 WebSocket 請求 CSV，回傳 BOM CSV 文字及檔名；前端建立檔案下載。這重用現有 teacher socket 授權，不新增 HTTP 登入或另一份 session。client→server 仍受既有 16 KiB 限制；匯出內容是 server→client 回應，不縮短答案或改寫結果。
7. **CSV 表格**：每筆已接受提交一列，欄位為題號、組別、答案、搶答順位、是否搶答成功、送出時間；題組答案依子題號連續串接，未提交組別和無提交題目不輸出資料列。送出時間取自伺服器 `receivedAtMs` 並格式化為本機時間 `YYYY-MM-DD HH:MM:SS.mmm`。資料儲存格若以 ASCII／全形公式觸發字元或 Tab／CR／LF 開頭，序列化前加單引號，再使用 CSV 引號逸出、CRLF 列分隔及 UTF-8 BOM。
8. **Google Sheets boundary**：沿用既有 `googleapis` Sheets API v4 adapter 及 backend `GOOGLE_SERVICE_ACCOUNT_JSON`。Feature 005 的 CSV 是活動結果下載，不呼叫 Sheets API；不得把服務帳戶憑證放在前端或回傳訊息。

**Post-design gate result**: 規劃階段的設計檢查 PASS；T001 建立的獨立 worktree 已承載實作。方案維持本機程序記憶體、伺服器權威、既有憑證邊界與角色投影；實作已核對三張 005 圖，完整功能測試結果記錄於 quickstart。

## Implementation Handoff

`specs/005-buzzer-ranking-export/tasks.md` 已由 `$speckit-tasks` 產生，依序拆分公平設定與驗證、有效時間快照和排名、教師／學生結果投影、CSV 產生與 WebSocket 下載，以及 Vitest、WebSocket integration、Playwright 和圖表一致性驗收。跨文件分析後，tasks 必須涵蓋以 `GROUP_IDS` 組數量測 SC-006、整題無提交的 CSV 邊界，以及不判定答案正誤／不計分的範圍限制。

**Branch/base gate**: Feature 004 PR [#4](https://github.com/ncuyvonne/speckit-buzzer/pull/4) has an `APPROVED` review on head `890395169abaede0c3d4362e630d78e8f2b4bd99` and was verified open and unmerged on 2026-11-19. Feature 005 uses that exact reviewed revision as its base in isolated worktree branch `codex/005-buzzer-ranking-export`; while PR #4 is open, the Feature 005 PR targets `codex/004-question-groups`. After PR #4 merges, rebase Feature 005 onto the resulting integrated revision and retarget its PR before merge. The original checkout remains `codex-003-buzzer-results` with unrelated pending changes and must not be switched or committed wholesale. Only Feature 005 implementation and its `specs/005-buzzer-ranking-export/` and `diagrams/005-buzzer-ranking-export-*` artifacts belong in this worktree.

## Complexity Tracking

無憲章違規，沒有新增資料庫、遠端服務、session 系統或大型架構層。公平排名與 CSV 均使用現有 backend 程序狀態及 WebSocket 授權邊界。
