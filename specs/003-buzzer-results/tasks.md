---
description: "003 搶答與結果判定的依賴排序實作任務"
---

# Tasks: 003 搶答與結果判定

**Input**: Design documents from specs/003-buzzer-results/

**Prerequisites**: plan.md、spec.md、research.md、data-model.md、contracts/realtime-websocket.md、quickstart.md

**Tests**: 依 Constitution Principle III，列出正常與邊界案例的 Vitest、WebSocket integration 及 Playwright 測試任務；實作時測試需先建立並確認失敗，再完成對應功能。

**Organization**: 任務依 spec.md 的三個 P1 User Story 分階段，並以 003 PlantUML 圖表及 Feature 002 結果 provider 邊界為設計依據。

## Format: `[ID] [P?] [Story] Description`

- `[P]`：可平行處理，且不依賴尚未完成的任務或同一檔案修改。
- `[Story]`：對應 spec.md 的使用者故事。
- 每個任務均列出具體檔案路徑。

## Path Conventions

- Web application：`backend/src/`、`backend/tests/`、`frontend/src/`、`frontend/tests/`。
- Design blueprints：`diagrams/003-buzzer-results-*.puml` 與配對 PNG。

---

## Phase 1: Setup

**Purpose**: 確認開發與測試骨架。

目前已有 npm workspace、React/Vite 前端、Node/WebSocket 後端、Vitest、Playwright、ActivityState、GroupRoster 及共用測試 server。**不需要新增專案初始化任務**；沿用現有設定。

## Phase 2: Foundational

**Purpose**: 為所有故事準備共用的基礎設施。

目前的 WebSocket 連線、老師認證、學生組別加入、活動階段和題目清單已由 001／002 提供，且 003 的核心資料模型只服務於 US1，故不另設阻擋所有故事的通用 foundation task。先完成 US1 後，US2、US3 才能在同一份已接受作答狀態上提供查詢投影。

---

## Phase 3: User Story 1 - 學生送出並鎖定各題答案 (Priority: P1) 🎯 MVP

**Goal**: 搶答期間，學生以伺服器連線所屬組別提交答案；每組每題只接受首筆有效答案並鎖定，各題成功組別由伺服器有效接收順序決定。

**Independent Test**: 啟動本機 WebSocket server，設定多題及多組，使用兩個以上學生連線提交依序、並行、空白、未知題號及錯誤階段答案；確認每組每題最多一筆，勝者唯一且依 server receivedOrder，拒絕請求不更改任何結果，客戶端指定 group/time/winner 不被採用。

### Tests for User Story 1

- [X] T001 [P] [US1] 在 backend/tests/unit/buzzer-results.test.ts 覆蓋正常答案、Unicode 空白答案、原始答案保留、錯誤階段、未知題號、空題目清單、同組重複提交、並行提交及不同組競答；注入相同 acceptedAt 時間戳驗證 receivedOrder 仍決定唯一勝者，且拒絕請求不改變狀態或消耗序號。
- [X] T002 [P] [US1] 在 backend/tests/unit/buzzer-results-protocol.test.ts 覆蓋 buzzerResults.submitAnswer 的合法／缺欄位／錯誤型別 payload、無效 requestId 及 16 KiB 訊息限制。
- [X] T003 [P] [US1] 在 backend/tests/integration/buzzer-results-submit.test.ts 以真實 WebSocket 連線驗證學生身分推導、答案接受與鎖定、空白／錯誤階段／未知題號／空題目清單／重複錯誤及伺服器接收序號決勝；空題目清單時拒絕提交且不建立作答或消耗勝出序號。
- [X] T004 [P] [US1] 在 frontend/tests/e2e/buzzer-results-submit.spec.ts 驗證學生在 BUZZING 選題提交、看到已接受／鎖定狀態，且再提交時顯示清楚錯誤並保留第一筆答案。

### Implementation for User Story 1

- [X] T005 [P] [US1] 在 backend/src/domain/buzzer-results.ts 定義 GroupSubmission 及 BuzzerResultsService；逐字遵循 data-model.md 約束：「(groupId, questionId) 唯一」、「至少含一個非空白字元；保留原文，不修剪」、「由伺服器配置的正整數，嚴格遞增；只在有效提交接受時配置，用來判定勝出及同時間精度的先後。」及「伺服器接受時間戳，供診斷使用；不接受客戶端值，也不作勝出 tie-break。」；check-and-set 不得含 await。
- [X] T006 [P] [US1] 在 backend/src/realtime/protocol.ts 解碼 buzzerResults.submitAnswer，只接受 questionId 與 answerText 字串，拒絕客戶端傳入 groupId、時間或勝出欄位，沿用既有訊息上限與錯誤 envelope。
- [X] T007 [P] [US1] 在 frontend/src/realtime/messages.ts 新增提交請求、已接受確認及錯誤代碼的 TypeScript 型別，確認提交 payload 不含組別或時間欄位。
- [X] T008 [US1] 在 backend/src/realtime/handler.ts 與 backend/src/server.ts 注入 BuzzerResultsService；學生加入有效組別後僅回傳目前有序題號清單，提交時以連線 context 的 groupId 呼叫服務，僅回覆本組接受／鎖定狀態，不回傳勝出資訊。
- [X] T009 [US1] 在 frontend/src/realtime/client.ts 與 frontend/src/state/buzzer-results.ts 接收學生題號清單、提交確認／錯誤並更新本組狀態，顯示答案已接受並鎖定或具體拒絕原因。
- [X] T010 [US1] 建立 frontend/src/components/BuzzerAnswerPanel.tsx 並在 frontend/src/App.tsx 接線，呈現目前活動題號、答案輸入、接受／鎖定確認和可修正的拒絕訊息。

**Checkpoint**: 本組答案提交、伺服器鎖定與每題唯一勝者可獨立驗收；執行 T001–T004 的測試並確認以上邊界。

---

## Phase 4: User Story 2 - 老師即時檢視各題作答狀況 (Priority: P1)

**Goal**: 搶答中老師可查看每題每組提交狀態、有效答案及目前成功組別；學生端不收到教師全量資料。

**Independent Test**: 讓多組對多題提交，再比對教師收到的全組投影與各學生 WebSocket 收到的訊息；每筆有效提交後 2 秒內教師進度更新，學生訊息只含本組確認。

### Tests for User Story 2

- [X] T011 [P] [US2] 在 backend/tests/unit/buzzer-results-progress.test.ts 驗證教師投影包含每題所有已設定組別、未提交狀態、原始有效答案及唯一勝出組別／答案。
- [X] T012 [P] [US2] 在 backend/tests/integration/buzzer-results-teacher-progress.test.ts 驗證教師登入初始快照、每次有效答案後的教師更新只傳給已驗證老師，學生連線與錯誤回應不含其他組狀態或勝出資料。
- [X] T013 [P] [US2] 在 frontend/tests/e2e/buzzer-results-teacher-progress.spec.ts 驗證老師對每題可即時檢視所有組別狀態與答案，並量測實際班級人數下有效提交至教師畫面更新不超過 2 秒。

### Implementation for User Story 2

- [X] T014 [P] [US2] 在 backend/src/domain/buzzer-results.ts 實作 getTeacherProgress()，逐題依 GroupRoster 順序產生完整教師投影；未提交組別 answerText 為 null，勝出欄位只由已接受提交推導。
- [X] T015 [US2] 在 backend/src/realtime/handler.ts 實作教師進度查詢、教師驗證後初始快照及有效提交後的 teacher-only 廣播，逐一確認接收端角色為 TEACHER。
- [X] T016 [P] [US2] 建立 frontend/src/components/TeacherResultsPanel.tsx，顯示每題所有組別的已提交／尚未提交、答案及目前成功組別，未提交答案欄位顯示空狀態。
- [X] T017 [P] [US2] 在 frontend/src/realtime/messages.ts、frontend/src/realtime/client.ts 及 frontend/src/state/buzzer-results.ts 接上 buzzerResults.teacherProgress 快照與更新，忽略格式錯誤或非教師可見訊息。
- [X] T018 [US2] 在 frontend/src/components/TeacherPanel.tsx 與 frontend/src/App.tsx 整合 TeacherResultsPanel，老師重新登入後先套用伺服器完整快照，再持續更新畫面。

**Checkpoint**: 教師可按題判讀全組作答及成功結果；學生收到的封包不含其他組狀態、答案或成功資訊。

---

## Phase 5: User Story 3 - 活動結束後檢視每題結果 (Priority: P1)

**Goal**: 活動結束後學生查看每題成功組別／答案及本組答案／成功、未成功或未作答狀態；老師仍能查看完整資料；Feature 002 匯出使用同一伺服器勝出資料。

**Independent Test**: 讓多組對多題提交並結束活動，讓已作答、勝出及未作答的學生查詢結果；核對學生只得到勝出答案和本組資料，老師得到完整結果，重連後狀態保持，匯出 provider 回傳伺服器結果。

### Tests for User Story 3

- [X] T019 [P] [US3] 在 backend/tests/unit/buzzer-results-student-results.test.ts 覆蓋勝出組、非勝出組、未作答組、無人作答題、未結束查詢拒絕及學生投影不包含其他非勝出組答案。
- [X] T020 [P] [US3] 在 backend/tests/integration/buzzer-results-release.test.ts 驗證只有已加入學生可於 ENDED 查詢、PREPARING／BUZZING 不釋出結果、老師仍可取得完整結果，以及重新加入後本組鎖定狀態恢復。
- [X] T021 [P] [US3] 在 backend/tests/integration/buzzer-results-export.test.ts 使用 fake GoogleSheetsAdapter 驗證 WinningResultsProvider 將每題伺服器勝出答案交給 Feature 002，無人作答時回傳 READY 空答案清單且不依賴真實憑證。
- [X] T022 [P] [US3] 在 frontend/tests/e2e/buzzer-results-release.spec.ts 驗證活動結束後勝出、未勝出、未作答學生看到正確結果，學生重新連線能恢復本組狀態，且其他非勝出組答案未出現在 UI 或 WebSocket payload。

### Implementation for User Story 3

- [X] T023 [P] [US3] 在 backend/src/domain/buzzer-results.ts 實作 getStudentResults(groupId)，只允許 ENDED 查詢並為每題輸出 questionId、winningGroupId、winningAnswer、ownAnswer、ownStatus（SUBMITTED／NOT_SUBMITTED）及 ownGroupWon；不得輸出其他非勝出組資料。
- [X] T024 [P] [US3] 在 backend/src/realtime/protocol.ts 加入 buzzerResults.getStudentResults 請求解碼及相應角色／階段錯誤代碼，保留既有 requestId 與訊息大小驗證。
- [X] T025 [P] [US3] 在 frontend/src/realtime/messages.ts 與 frontend/src/state/buzzer-results.ts 加入 StudentQuestionResult 型別及 buzzerResults.studentResults／buzzerResults.ownProgress 處理；BUZZING 恢復資料僅包含本組答案狀態。
- [X] T026 [US3] 在 backend/src/realtime/handler.ts 於學生 BUZZING 加入／重連時傳回 buzzerResults.ownProgress，並只在 ENDED 回應 buzzerResults.getStudentResults；在學生重連流程不輸出任何其他組別資料。
- [X] T027 [P] [US3] 建立 frontend/src/components/StudentResultsPanel.tsx，呈現各題成功組別／答案及本組答案、成功／未成功／未作答狀態，不渲染非勝出組答案。
- [X] T028 [US3] 在 frontend/src/components/BuzzerAnswerPanel.tsx、frontend/src/App.tsx 與 frontend/src/realtime/client.ts 接上 ENDED 結果查詢、StudentResultsPanel 顯示及重新連線後依目前階段恢復正確畫面。
- [X] T029 [US3] 在 backend/src/guided-notes/winning-results-provider.ts 實作 Feature 002 的 WinningResultsProvider，從 BuzzerResultsService 產生 WinningResultsSnapshot；在 backend/src/server.ts 注入此 provider，READY 空答案與 UNAVAILABLE 狀態依 data-model.md 區分。

**Checkpoint**: 學生與老師能在 ENDED 檢視各自允許的資料，重連不清除答案；Feature 002 只使用伺服器端成功答案。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 完成圖表一致性、quickstart 驗收及實際測試紀錄。

- [X] T030 更新 diagrams/003-buzzer-results-component.puml、diagrams/003-buzzer-results-class.puml、diagrams/003-buzzer-results-sequence-submit.puml 及 diagrams/003-buzzer-results-sequence-release.puml，讓最終模組、學生重連 ownProgress、教師廣播和結果釋出流程與程式一致；在 repo 根目錄執行 java -jar plantuml.jar "./diagrams/*.puml" 重新產生 PNG。
- [X] T031 在 specs/003-buzzer-results/quickstart.md 執行本機端對端驗收與 Vitest、Playwright、typecheck、build 指令，並將命令、退出碼、實際結果和四張圖表核對結果記錄於 specs/003-buzzer-results/validation-results.md。
- [ ] T032 在 specs/003-buzzer-results/validation-results.md 記錄實際功能分支、測試證據與合併前規格／憲章核對；依 Constitution Principle VI 建立 PR、說明變更及測試結果、取得審查核准後才合併，並記錄 PR 識別資訊及審查結論。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：現有 npm workspace、前後端、測試框架已就緒，無新增初始化任務。
- **Foundational（Phase 2）**：現有認證、組別、活動狀態和 WebSocket 基礎已就緒；US1 建立共同作答模型和服務。
- **US1（Phase 3）**：第一個可交付的功能增量，依賴既有活動和學生加入流程。
- **US2（Phase 4）**：依賴 US1 的已接受作答與勝者狀態。
- **US3（Phase 5）**：依賴 US1 的已接受作答與勝者狀態；建議在 US2 後整合，避免同時修改 handler.ts、messages.ts 和 App.tsx。
- **Polish（Phase 6）**：依賴所有預定交付的使用者故事完成；T032 的 PR 審查與合併 gate 依賴 T030 圖表核對及 T031 測試／驗收紀錄完成。

### User Story Dependencies

- **US1 (P1)**：無 003 使用者故事依賴，可在既有 001／002 完成後開始。
- **US2 (P1)**：依賴 US1 的提交模型、服務與事件接線，以便產生教師投影。
- **US3 (P1)**：依賴 US1 的提交與勝出結果；與 US2 在領域投影層可分開，整合共用 realtime/frontend 檔案時須序列處理。

### Parallel Opportunities

- US1 的 T001–T004 分別修改 unit、protocol、integration、E2E 測試檔，可平行撰寫。
- US1 的 T005–T007 修改不同後端 domain、後端 protocol、前端 messages 檔案，可在測試任務完成後平行。
- US2 的 T011–T013 測試位於不同檔案，可平行；T016 教師面板可與後端 progress projection T014 分開實作。
- US3 的 T019–T022 測試檔可平行；T027 結果面板可與 provider T029 分開實作。
- 跨故事共用的 backend/src/realtime/handler.ts、frontend/src/realtime/messages.ts、frontend/src/realtime/client.ts 及 frontend/src/App.tsx 不宜同時由多個實作者修改；依 US1 → US2 → US3 順序整合。

---

## Parallel Example: User Story 1

```text
# 四項測試任務分別在不同檔案，可平行撰寫
T001 backend/tests/unit/buzzer-results.test.ts
T002 backend/tests/unit/buzzer-results-protocol.test.ts
T003 backend/tests/integration/buzzer-results-submit.test.ts
T004 frontend/tests/e2e/buzzer-results-submit.spec.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. 沿用現有 Setup／Foundational，不新增專案骨架。
2. 完成 US1 的領域服務、協定、伺服器提交處理和學生 UI。
3. 執行 US1 unit、WebSocket integration 及 Playwright 測試，確認鎖定、唯一勝者和拒絕案例。
4. 可獨立展示學生答案已送出並鎖定；服務端勝者可由單元／整合驗收確認。老師即時監看與公開結果由後續故事加入。

### Incremental Delivery

1. US1：提交、鎖定、伺服器決勝。
2. US2：老師進度快照與即時更新。
3. US3：活動結束結果、學生重連恢復、Feature 002 provider。
4. 每階段各自通過其 Independent Test，再進入下一階段。

## Notes

- 每個 checkbox task 都有唯一 ID、必要的 [P]／[Story] 標籤及實際檔案路徑。
- 每個 data-model 欄位限制需按 data-model.md 原約束實作；不可接受客戶端提供的組別或時間。
- [P] 僅用於不同檔案且無未完成依賴的工作。
- 測試任務先於該故事實作任務；本 tasks 產生階段沒有建立或執行測試程式碼。

## Phase 7: Convergence
- [X] T033 CRITICAL：在 `student.join` 維持已加入學生的伺服器組別綁定，拒絕同一連線以不同 `groupId` 重新綁定；加入 WebSocket 整合回歸測試，確認重新加入不會改變本組進度或結果可見範圍 per Constitution IV, FR-001, FR-016, US3/AC4 (contradicts)
- [X] T034 HIGH：使用 Unicode `White_Space` 定義驗證答案至少含一個非空白字元（涵蓋 U+0085 NEL），接受時保留原始字串，並加入單元回歸測試 per FR-004, SC-003, T001 (partial)
- [X] T035 HIGH：將 teacher-progress Playwright 負載測試參數化為同時連線學生人數；未指定實際班級人數時以 200 人作代表性安全驗收基準，驗證提交至老師更新不超過 2 秒，並在 validation-results.md 記錄連線人數與實測時間；可用 `PLAYWRIGHT_CLASS_SIZE` 覆寫 per SC-004, T013 (partial)

## Phase 8: Review Follow-up
- [X] T036 [P] 在 `frontend/tests/e2e/buzzer-results-teacher-progress.spec.ts` 加入回歸測試：老師登入後匯入題目，在任何學生提交前即可看到每題及所有組別的未提交狀態 per FR-012, US2 (review finding)
- [X] T037 在 `backend/src/realtime/handler.ts` 與 `specs/003-buzzer-results/contracts/realtime-websocket.md` 修正成功匯入後的教師進度刷新，讓所有已驗證教師連線取得新題目清單對應的完整進度；先通過 T036 per FR-012, US2 (review finding)
- [X] T038 [P] 在 `frontend/tests/unit/realtime-client.test.ts` 加入回歸測試：已加入學生收到組別變更 `GROUP_INVALID` 後，仍保留伺服器綁定的角色、組別及分頁儲存值 per FR-001, FR-016 (review finding)
- [X] T039 在 `frontend/src/realtime/client.ts` 調整 `GROUP_INVALID` 處理，只在尚未加入有效組別的連線清除組別選擇；已加入學生收到變更組別拒絕時保留目前角色和組別；先通過 T038 per FR-001, FR-016 (review finding)
- [X] T040 在 `specs/003-buzzer-results/validation-results.md` 記錄 Phase 8 紅綠測試、完整測試結果及審查發現修正 per Constitution III, V (review finding)

## Phase 9: Convergence
- [X] T041 CRITICAL：更新 `specs/003-buzzer-results/plan.md` 的即時更新決策、`diagrams/003-buzzer-results-component.puml` 與 `diagrams/003-buzzer-results-sequence-submit.puml`，明確呈現成功匯入新題號後向已驗證教師刷新 `teacherProgress`；依計畫所列 PlantUML CLI 重產對應 PNG per Constitution V, VII, FR-012 (partial)

## Phase 10: PR Review Corrections — Student UI
- [X] T042 在 `BuzzerAnswerPanel` 保持題目選單可切換已鎖定題目，並為 `AUTH_REQUIRED`、`GROUP_INVALID` 顯示學生可採取的繁體中文處置；加入元件單元測試及 Q1 鎖定後切換 Q2 的 Playwright 回歸測試 per FR-005, FR-013 (review finding)

## Phase 11: PR Review Corrections — Live Group Progress and Privacy
- [X] T043 加入 WebSocket 整合測試並修正成功提交後的進度同步，讓同組其他學生連線立即收到本組 ownProgress 鎖定狀態，不必再次提交 per FR-005, FR-011, FR-016 (review finding)
- [X] T044 加入不同組別同題並行提交的接收順序勝者整合測試，並檢查 BUZZING 期間學生收到的所有封包不含其他組答案／狀態 per FR-011, SC-002 (review finding)

## Phase 12: PR Review Corrections — Design Artifacts and Evidence
- [X] T045 對齊 US1 規格、003 計畫與 WebSocket 契約中的同組 ownProgress 即時更新；修正 002 圖表中 provider 的正式注入／測試 fallback 說明，並更新 003 圖表及所有受影響 PNG per Constitution V, VII (review finding)
- [X] T046 將 Phase 10–12 的紅綠測試、測試命令／退出碼和 PlantUML 結果記錄於 `validation-results.md`；保留 T032 未完成，直到外部審查核准並記錄審查結論 per Constitution III, V (review finding)
