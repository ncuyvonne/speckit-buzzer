# Implementation Plan: 001 角色與階段同步

**Branch**: `codex-001-role-phase-sync` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-role-phase-sync/spec.md`

## Summary

以 React + TypeScript + Vite 建立老師與學生的本機單頁介面，並以 Node.js WebSocket
服務維護唯一活動階段、驗證老師密碼、接受學生組別選擇及同步狀態。老師權限只存在
於已驗證的即時連線；每次重連或重整都重新輸入密碼。伺服器程序內以記憶體保存本次
活動狀態。細節與介面契約見 [research.md](./research.md)、[data-model.md](./data-model.md)
及 [contracts/realtime-websocket.md](./contracts/realtime-websocket.md)。

## Technical Context

**Language/Version**: TypeScript 5.x；Node.js 24 LTS（採最新 24.x 修補版）

**Primary Dependencies**: React、Vite、Node.js `ws`；測試使用 Vitest 與 Playwright

**Storage**: Node.js 單一程序的記憶體狀態；學生目前組別存於該分頁的 `sessionStorage`，並鏡像至目前 History API 歷史項目，供瀏覽器儲存不可用時同分頁還原；不使用 SQLite

**Testing**: Vitest 單元及真實 WebSocket 整合測試、Playwright 端對端測試、`tsc --noEmit` 型別檢查

**Target Platform**: 本機 Windows 開發及課堂單機執行。瀏覽器開啟 `http://127.0.0.1:5173`，Vite 和 Node 都綁定 loopback。

**Project Type**: 本機全端 Web 應用程式，包含前端 SPA 與 Node.js 即時服務

**Performance Goals**: 正常本機連線下，階段切換後所有在線畫面於 2 秒內更新，符合 SC-002

**Constraints**: 老師密碼由環境變數提供，老師每次新連線都重新輸入密碼，權限只綁定該連線。
組別設定有效時，密碼缺漏或空白只停用老師登入，老師端收到可修正的 `AUTH_INVALID`。
伺服器程序重啟會開始新活動，階段回到「準備中」。學生在同一分頁與同一活動中可恢復組別，包含「已結束」階段。
WebSocket 只允許指定的本機 Origin，每筆傳入訊息上限為 16 KiB。

**Scale/Scope**: 一個本機活動、一位老師及多位學生；須驗證至少兩個不同組別同時在線，並驗證同組多人同時在線。規格未要求硬性人數上限。

## Constitution Check

| 憲章原則 | 計畫符合方式 | Gate |
|---|---|---|
| 輸入驗證與清楚錯誤 | 伺服器驗證老師密碼、組別及階段轉換；前端以明確錯誤代碼顯示訊息 | PASS |
| 機敏資料只由環境變數提供 | 老師密碼只由 `TEACHER_PASSWORD` 讀取；不建立 session token；`.env.example` 只放名稱與佔位值，`.env` 加入 `.gitignore` | PASS |
| 正常與邊界案例測試 | Vitest 覆蓋正常／錯誤驗證及階段邊界；Playwright 覆蓋多使用者同步及重連 | PASS |
| 伺服器為共享狀態權威 | 階段只由後端 Activity Service 更新；所有畫面使用伺服器快照與廣播事件 | PASS |
| 文件與程式碼一致 | 以 spec、資料模型及 WebSocket 契約作為實作依據；行為變更同步更新文件 | PASS |
| 獨立 branch 與 PR | 目前分支為 `codex-001-role-phase-sync`；完成後以 PR 審查合併 | PASS |
| PlantUML 設計優先 | 規劃以四張 001 圖為藍圖，圖表與契約在設計後關卡一起核對 | PASS |
| 本機執行範圍 | 開發與驗收只綁定 localhost，不部署至公網 | PASS |

**Gate result**: PASS。上一輪釐清曾提出 60 秒免重新登入，但使用者選擇保留憲章，
並將規格改為每次重連都重新輸入密碼。計畫不建立或保存老師登入 token，因此沒有憲章例外。

## Project Structure

### Documentation (this feature)

```text
specs/001-role-phase-sync/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation-results.md  # 實作期間的測試與圖表核對結果
├── contracts/
│   └── realtime-websocket.md
└── tasks.md                 # 由 $speckit-tasks 建立，不屬於本次輸出
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── components/
│   │   ├── TeacherPanel.tsx
│   │   └── StudentJoin.tsx
│   ├── realtime/
│   │   ├── client.ts
│   │   └── messages.ts
│   ├── state/
│   │   ├── activity.ts
│   │   └── student-selection.ts
│   ├── App.tsx
│   └── main.tsx
└── tests/
    └── e2e/

backend/
├── src/
│   ├── config.ts
│   ├── server.ts
│   ├── domain/
│   │   ├── activity-state.ts
│   │   ├── group-roster.ts
│   │   └── teacher-auth.ts
│   └── realtime/
│       ├── protocol.ts
│       ├── handler.ts
│       └── heartbeat.ts
└── tests/
    ├── unit/
    ├── integration/
    └── support/

diagrams/
├── 001-role-phase-sync-component.puml
├── 001-role-phase-sync-component.png
├── 001-role-phase-sync-class.puml
├── 001-role-phase-sync-class.png
├── 001-role-phase-sync-sequence.puml
├── 001-role-phase-sync-sequence.png
├── 001-role-phase-sync-sequence-recovery.puml
└── 001-role-phase-sync-sequence-recovery.png
```

**Structure Decision**: The repository uses npm workspaces with separate `frontend` and `backend`
packages. `frontend/src/` contains the browser views, WebSocket client, and client state.
`backend/src/` contains the local server, message handler, and logic for teacher authentication,
activity state, the group roster, and connection state.

## Diagram and Contract Alignment

| PlantUML source | Contract and data-model mapping | Planned modules |
|---|---|---|
| `diagrams/001-role-phase-sync-component.puml` | Browser views and tab storage communicate through the WebSocket client. The local server validates origins, manages per-connection heartbeat timers, and routes protocol messages to server-owned activity, roster, credential, and connection state. | `frontend/src/components/`, `frontend/src/realtime/`, `frontend/src/state/`, `backend/src/server.ts`, `backend/src/realtime/`, `backend/src/domain/`, `backend/src/config.ts` |
| `diagrams/001-role-phase-sync-class.puml` | `Activity`, `ActivityStage`, `Group`, `UserConnection`, `StudentSelection`, and teacher credential configuration match `data-model.md`; role and group bindings belong to live connections. | `backend/src/domain/activity-state.ts`, `backend/src/domain/group-roster.ts`, `backend/src/domain/teacher-auth.ts`, `frontend/src/state/student-selection.ts` |
| `diagrams/001-role-phase-sync-sequence.puml` | Initial connection and origin validation, teacher authentication, student join, `activity.snapshot`, `activity.advance`, and `activity.phaseChanged` follow the event names and rules in `contracts/realtime-websocket.md`. | `frontend/src/realtime/client.ts`, `frontend/src/components/TeacherPanel.tsx`, `frontend/src/components/StudentJoin.tsx`, `backend/src/realtime/handler.ts`, `backend/src/domain/` |
| `diagrams/001-role-phase-sync-sequence-recovery.puml` | Teacher reconnect/reload requires a new `teacher.authenticate`; student reconnect/reload resends a stored group after the server-pushed snapshot; invalid groups return `GROUP_INVALID`; both flows follow the connection lifecycle in the WebSocket contract. | `frontend/src/realtime/client.ts`, `frontend/src/state/student-selection.ts`, `backend/src/realtime/handler.ts`, `backend/src/domain/` |

The server rejects unapproved WebSocket origins during the HTTP upgrade. It sends the initial
snapshot only after an accepted connection opens. Every `.puml` file is rendered to a neighboring
PNG, and the source, image, contract, and data model must describe the same flow.

## 實作順序與驗收交接

1. **本機連線**。在 `frontend/vite.config.ts` 固定 `127.0.0.1:5173` 與 `strictPort`，將 `/ws`
   代理到 `127.0.0.1:3001`，保留原始 `Origin`。在 `backend/src/server.ts` 驗證 Origin 後才完成
   HTTP 101。連線建立後，`server.ts` 啟動 `backend/src/realtime/heartbeat.ts` 的心跳。心跳模組每 30 秒送出 ping，若 10 秒內未收到 pong，便終止該連線。連線關閉時，`server.ts` 透過心跳模組清除該連線的計時器。伺服器關閉時則清除所有心跳計時器。
   驗收須涵蓋瀏覽器透過代理連上並收到第一份快照、不允許的 Origin 收到 HTTP 403，以及失聯連線不影響其他連線。
2. **US1 老師登入與階段控制**。驗證成功後依序送出 `teacher.authenticated` 和最新快照。
   伺服器先驗證連線角色，再驗證階段轉換。推進成功後廣播 `activity.phaseChanged`，
   老師端在 US1 就使用此事件更新畫面。Vitest 透過實際 WebSocket 讓未登入連線送出
   `activity.advance`，核對 `AUTH_REQUIRED`、階段不變且沒有階段廣播。
3. **US2 學生加入與同步**。驗證組別後只綁定目前連線，依序回覆 `student.joined` 和最新快照。
   學生端接收 US1 已建立的階段廣播。用已加入的學生連線驗證 `teacher.authenticate` 回覆
   `INVALID_MESSAGE`、`activity.advance` 回覆 `AUTH_REQUIRED`，且階段未變更、沒有階段廣播；另驗證老師連線送出 `student.join` 會被拒絕。
   關閉連線時集中清理該連線的角色與組別，驗收同組其他學生不受影響。
4. **US3 學生恢復**。同一分頁收到新連線快照後才以保存的組別重新加入。伺服器重新驗證，
   拒絕時前端清除舊值並返回選組。同一伺服器程序所持有的活動有效期間不設斷線時限，依
   `SC-003` 涵蓋全部三個階段（包含 `ENDED`）；伺服器重啟會建立新的 `PREPARING` 活動，不屬於同一活動的恢復保證。

Playwright 的 `webServer` 啟動 Vite。固定代理連接埠時使用單一 worker，每個案例由測試 fixture 啟動
獨立後端並在結束時關閉連線、計時器及伺服器。案例以專用環境設定從 `PREPARING` 開始，
多使用者案例在同一後端上開啟多個瀏覽器 context。測試用的老師密碼由 fixture 產生並透過環境設定提供。
任務拆解時依本節更新 `tasks.md` 的代理設定、事件接線、測試隔離與相依順序。

## Post-Design Constitution Check

| Requirement | Design evidence | Gate |
|---|---|---|
| Validate input and show clear errors | WebSocket contract defines password, group, transition and malformed-message validation with actionable error codes | PASS |
| Keep credentials out of code, documents, logs and repo | Server reads the configured password from the environment; the entered value is handled transiently, discarded after comparison, and never logged; no resume token is issued or persisted | PASS |
| Test normal and boundary cases | Data model invariants and quickstart acceptance walkthrough cover valid/invalid credentials, groups, transitions and reconnect flows | PASS |
| Trust server state | Activity state and transition validation exist only in backend domain service; clients render server snapshots/broadcasts | PASS |
| Keep docs aligned | The sequence diagrams limit login to an accepted upgrade. The contract, data model and plan agree on snapshots, role checks, broadcasts and reconnect behavior; the contract, plan, tasks and component diagram define the heartbeat lifecycle consistently. | PASS |
| Branch and PR workflow | Plan remains on `codex-001-role-phase-sync`; implementation is reviewed through its PR | PASS |
| Use PlantUML as design source | Proposed source modules map directly to component, class and sequence diagrams; all current PNGs were regenerated from their source and implementation must be checked against them | PASS |
| Stay local-only | Both local servers bind to loopback; no public hosting or remote service is introduced | PASS |

**Post-design gate result**: PASS. The user chose password re-entry after every reconnect, so the
design no longer needs any teacher session token or token exception to the constitution.

## Complexity Tracking

No constitution violations or additional project layers are proposed. SQLite, a routing library,
an application state library, and a full-stack framework are excluded because this feature has one
activity view, a small role-based flow, and no restart-persistence requirement.
