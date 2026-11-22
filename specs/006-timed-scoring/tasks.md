---
description: "Feature 006 implementation tasks"
---

# Tasks: 006 計時搶答與計分板

**Input**: Design documents from `specs/006-timed-scoring/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/realtime-websocket.md](./contracts/realtime-websocket.md), [quickstart.md](./quickstart.md)

**Tests**: Include Vitest and Playwright tasks because the feature specification defines independent tests, acceptance scenarios, and measurable test outcomes. During implementation, write the listed tests first and verify they fail before the corresponding implementation; no tests were run while generating this task list.

**Organization**: Tasks follow the specification's priority order and are grouped by user story. User Story 1 is the MVP increment.

## Format

Every task uses `- [ ] T### [P?] [Story?] Description` with a concrete path. `[P]` appears only when the task can be done independently in a different file; story tasks carry `[US1]`, `[US2]`, or `[US3]`.

## Path Conventions

- Backend: `backend/src/`, `backend/tests/`
- Frontend: `frontend/src/`, `frontend/tests/`
- Design and acceptance documents: `specs/006-timed-scoring/`
- Feature diagrams: `diagrams/006-timed-scoring-*.puml` and matching `.png`

## Phase 1: Setup

**Purpose**: Prepare shared project infrastructure.

The repository already has the npm workspaces, TypeScript, React/Vite, Node.js/WebSocket services, Google Sheets adapter, Vitest, and Playwright required by the plan. Feature 006 adds no runtime dependency; the required setup action is to begin implementation on the planned independent branch.

- [X] T001 Create and switch to the independent branch `codex/006-timed-scoring` before any implementation task, and confirm the active branch against `specs/006-timed-scoring/plan.md`.

---

## Phase 2: Foundational

**Purpose**: Complete blockers shared by all user stories.

The existing server already owns activity state, teacher authentication, group roster, WebSocket envelopes, and worksheet import. No additional cross-story foundation blocks implementation; each change is attached to the story that uses it.

---

## Phase 3: User Story 1 - 設定限時並公平結束搶答 (Priority: P1) 🎯 MVP

**Goal**: Let the teacher set a 0–3600 second limit, show the server countdown to both roles, end at the deadline, and reject answers received at or after it.

**Independent Test**: Set 0 seconds and confirm no countdown or automatic end. Set 1 second, start buzzing, and confirm teacher and student countdowns, automatic end, and acceptance only for answers received strictly before the deadline. Also verify manual end cancels the timer and a stale callback cannot end a later round.

### Tests for User Story 1

Write these tests before implementation and establish that each fails for the missing behavior.

- [X] T002 [P] [US1] Add ActivityState tests for default 0, accepted integer limits 0/1/3600, rejected negative/fractional/over-3600 values, and preparing-only configuration in `backend/tests/unit/activity-state.test.ts`.
- [X] T003 [P] [US1] Add ActivityTimer fake-clock tests for countdown ticks, deadline end, manual cancellation, and a queued old-generation callback after timer cancellation/restart in `backend/tests/unit/activity-timer.test.ts`.
- [X] T004 [P] [US1] Add submission boundary tests for received time before/equal/after deadline and no mutation on rejection in `backend/tests/unit/buzzer-results.test.ts`.
- [X] T005 [P] [US1] Add WebSocket integration tests for teacher-only time-limit setting, snapshots/reconnect, teacher and student countdown/phase events, automatic end, and manual end; assert countdown and ENDED events reach connected clients within 1000 ms in `backend/tests/integration/activity-timer.test.ts`.
- [X] T006 [P] [US1] Add teacher control tests for valid and invalid seconds, displayed validation errors, and unlimited mode in `frontend/tests/unit/teacher-panel.test.ts`.
- [X] T007 [P] [US1] Add browser tests for timed and unlimited rounds, both-role countdowns, automatic end, late-answer rejection, and manual end; assert the countdown and ended state are visible within 1000 ms of their specified events in `frontend/tests/e2e/activity-timer.spec.ts`.

### Implementation for User Story 1

- [X] T008 [US1] Extend ActivityState with the configured limit and server deadline; enforce the data-model constraint `timeLimitSeconds | integer | 含 0 至 3600; 0 表示不限時; 新活動、確認重設及成功換入學習單後為 0。僅準備中可由老師設定。` in `backend/src/domain/activity-state.ts`.
- [X] T009 [US1] Implement the server countdown, cancellation, and deadline transition; enforce `deadlineAt | integer milliseconds or null | 伺服器產生；僅限時搶答中存在；開始時以伺服器開始時間加時限計算。不是用戶端可寫入欄位。`, `timerRunning | boolean | 僅時限大於 0 且 BUZZING 為 true；手動結束、到期、重設、成功重新匯入及程序關閉時停止。`, and `generation | private integer | 每次開始或取消計時遞增；每個排程 callback 捕捉當次世代及 deadline，僅在兩者仍與目前 ActivityTimer 相符時有效。不可由 WebSocket 傳入或修改。`; stale callbacks must not end a new round in `backend/src/domain/activity-timer.ts`.
- [X] T010 [US1] Enforce the answer cutoff in the synchronous accept path; sample server time once and accept only `receivedAt < deadlineAt`, with `receivedAt | integer milliseconds | 後端在同步接受路徑取樣一次；只有 receivedAt < deadlineAt 可繼續驗證並插入。` in `backend/src/domain/buzzer-results.ts`.
- [X] T011 [P] [US1] Decode and validate `activity.setTimeLimit`, require integer seconds 0–3600, and return `TIME_LIMIT_INVALID` without changing state for invalid values in `backend/src/realtime/protocol.ts`.
- [X] T012 [US1] Integrate teacher start/end and time-limit commands with ActivityTimer; publish countdown, phase, snapshot, and remaining-time fields while retaining the server as authority in `backend/src/realtime/handler.ts`.
- [X] T013 [US1] Construct and inject ActivityTimer into the activity and realtime services, and stop its schedules during server shutdown in `backend/src/server.ts`.
- [X] T014 [P] [US1] Add typed time-limit, countdown, and phase/snapshot fields plus the setting command and error response to `frontend/src/realtime/messages.ts`.
- [X] T015 [US1] Handle countdown, time-limit, and phase/snapshot messages for new and reconnecting clients in `frontend/src/realtime/client.ts`.
- [X] T016 [US1] Store `timeLimitSeconds` and nullable `remainingSeconds` from server snapshots and events in `frontend/src/state/activity.ts`.
- [X] T017 [P] [US1] Add teacher time-limit input, range/integer feedback, unlimited label, and teacher countdown display in `frontend/src/components/TeacherPanel.tsx`.
- [X] T018 [P] [US1] Display the server countdown or unlimited label to students without using browser time as the cutoff authority in `frontend/src/components/BuzzerAnswerPanel.tsx`.

**Checkpoint**: User Story 1 works with both 0 and positive limits, the exact deadline boundary, automatic and manual end, reconnect snapshots, and stale timer callbacks.

---

## Phase 4: User Story 2 - 標記成功答案並查看計分板 (Priority: P1)

**Goal**: Let teachers mark or revise correctness after the activity ends, show a deterministic scoreboard to teachers and students, and reset or replace an activity without retaining old results.

**Independent Test**: End an activity with winners and no-winner questions. Verify only winner questions can be marked after end, correction/incorrect/clear changes produce exactly the current score, all roster groups appear in the required order, students see the same ended scoreboard, and reset confirmation/cancellation plus successful/failed worksheet imports have the specified cleanup behavior.

### Tests for User Story 2

Write these tests before implementation and establish that each fails for the missing behavior.

- [X] T019 [P] [US2] Add scoring-service tests for teacher/ENDED/winner eligibility, mark/replace/clear behavior, manual-only judgment, one point per correct answer, all roster groups, tie ordering, and `rank` equal to each entry's 1-based sorted position in `backend/tests/unit/scoring.test.ts`.
- [X] T020 [P] [US2] Add WebSocket integration tests for unauthorized and wrong-stage marks, winner-only marks, teacher progress, ended scoreboard queries, reconnect, and live teacher/student scoreboard updates; assert both roles receive each updated scoreboard within 1000 ms of a mark in `backend/tests/integration/scoring.test.ts`.
- [X] T021 [P] [US2] Add import integration tests proving successful worksheet replacement clears old submissions/marks/scores and failed import leaves the active worksheet and results unchanged in `backend/tests/integration/guided-notes-import-reset.test.ts`.
- [X] T022 [P] [US2] Add teacher scoring panel tests for correct/incorrect/clear controls, scoreboard ordering, and reset confirmation/cancel behavior in `frontend/tests/unit/teacher-scoring-panel.test.tsx`.
- [X] T023 [P] [US2] Add browser tests for marking, changing and clearing judgments, student ended scoreboard visibility, and reset/import confirmation flows; assert the updated scoreboard is visible to both roles within 1000 ms of a mark in `frontend/tests/e2e/scoring.spec.ts`.

### Implementation for User Story 2

- [X] T024 [P] [US2] Implement the in-memory scoring service; enforce `judgement | CORRECT | INCORRECT | 只有 teacher + ENDED 可設定；null 表示取消並移除目前標記。` and `questionId | string | 必須屬於目前題目，且該題已有 WinningResult.winningGroupId。`; each question has one current mark. Derive scores as one point per CORRECT mark, include all roster groups, sort by `score` descending, `successfulQuestionCount` descending, numeric-string IDs numerically ascending, then other IDs in natural string order, and assign `rank | positive integer | 依 score 降冪、successfulQuestionCount 降冪、groupId 規則升冪排序後的順序。` in `backend/src/domain/scoring.ts`.
- [X] T025 [P] [US2] Add a teacher-only ENDED reset transition that retains worksheet/questions, clears the deadline, and returns to PREPARING with the limit set to 0 in `backend/src/domain/activity-state.ts`.
- [X] T026 [US2] Add an idempotent session-clear operation for submissions, locks, and winners; preserve the existing unique key `(groupId, questionId)` during a round in `backend/src/domain/buzzer-results.ts`.
- [X] T027 [P] [US2] Decode `buzzerResults.markCorrectness`, `buzzerResults.getScoreboard`, and `activity.reset`; validate `CORRECT | INCORRECT | null` and reject unexpected or invalid payloads in `backend/src/realtime/protocol.ts`.
- [X] T028 [US2] Enforce teacher/ENDED/winner rules for marking and reset, stop the timer on reset, clear scoring and answer state, and publish the ended scoreboard to teachers and students after queries or mark changes in `backend/src/realtime/handler.ts`.
- [X] T029 [US2] Connect successful worksheet-import commit to timer, submission, winner, and scoring cleanup; set the new activity limit to 0 only after the replacement succeeds, and leave all old state unchanged on failure in `backend/src/guided-notes/service.ts`.
- [X] T030 [P] [US2] Add typed correctness, scoreboard, reset, and reset-confirmation event payloads to `frontend/src/realtime/messages.ts`.
- [X] T031 [US2] Handle mark responses, teacher progress judgments, scoreboard queries/updates, reset completion, and ended reconnect state in `frontend/src/realtime/client.ts` and `frontend/src/state/buzzer-results.ts`.
- [X] T032 [US2] Build the teacher mark/change/clear controls and scoreboard view, showing judgment only for winner questions in `frontend/src/components/TeacherScoringPanel.tsx`.
- [X] T033 [US2] Add a reset action available after ENDED and a confirmation dialog that states worksheet/questions are retained while answers, locks, winners, marks, scores, and the time limit are cleared; cancellation sends no command in `frontend/src/components/TeacherPanel.tsx`.
- [X] T034 [US2] Build the ended-only student scoreboard showing rank, group ID, score, and successful question count in `frontend/src/components/StudentScoreboardPanel.tsx`.
- [X] T035 [US2] Mount teacher scoring and student scoreboard views in their role-appropriate ended states without exposing teacher-only progress to students in `frontend/src/App.tsx`.

**Checkpoint**: User Story 2 works with manual marks only, deterministic ties, all roster groups, ended-only student visibility, confirmed reset, and atomic worksheet replacement cleanup.

---

## Phase 5: User Story 3 - 查看本組作答進度 (Priority: P2)

**Goal**: Show each student only their own group's accepted top-level question count while buzzing is active.

**Independent Test**: Import single questions and a question group. During BUZZING, verify the student's count starts at 0, increases only for accepted distinct questions, counts a question group once, and never changes because another group submits. Confirm rejected/duplicate submissions do not increase it, the prompt is hidden outside BUZZING, and student payloads contain no other-group data.

### Tests for User Story 3

Write these tests before implementation and establish that each fails for the missing behavior.

- [X] T036 [P] [US3] Extend own-progress unit tests for accepted distinct question counts, question groups as one top-level question, rejected/duplicate/late submissions, and the total question count in `backend/tests/unit/buzzer-results-progress.test.ts`.
- [X] T037 [P] [US3] Add WebSocket tests proving each student receives only their group's progress and that other-group submissions do not alter or leak into that projection in `backend/tests/integration/buzzer-results-own-progress.test.ts`.
- [X] T038 [P] [US3] Add component tests for the exact progress label and visibility only during BUZZING in `frontend/tests/unit/buzzer-answer-panel.test.ts`.
- [X] T039 [P] [US3] Add browser tests for own-group progress, question-group counting, other-group isolation, rejection cases, and hiding outside BUZZING in `frontend/tests/e2e/own-progress.spec.ts`.

### Implementation for User Story 3

- [X] T040 [US3] Extend the own-group projection with accepted distinct-question count and current top-level question total; enforce `submittedCount | integer 0–questionCount | 由不同 questionId 且已接受的本組答案計數；不含被拒絕或逾時提交。` and `totalQuestionCount | integer 1–100 | 目前成功匯入之頂層題目數，題組只計 1。` in `backend/src/domain/buzzer-results.ts`.
- [X] T041 [US3] Send the progress projection only to the authenticated student's own group during BUZZING, and ensure rejects or other-group updates cannot place another group's fields in student messages in `backend/src/realtime/handler.ts`.
- [X] T042 [P] [US3] Add typed `submittedCount` and `totalQuestionCount` fields to own-progress messages in `frontend/src/realtime/messages.ts`.
- [X] T043 [US3] Store own-group progress updates without mixing them with teacher-wide results in `frontend/src/state/buzzer-results.ts` and `frontend/src/realtime/client.ts`.
- [X] T044 [US3] Render exactly「本組已送出 N / 總題數」while stage is BUZZING and hide that progress in PREPARING and ENDED in `frontend/src/components/BuzzerAnswerPanel.tsx`.

**Checkpoint**: User Story 3 displays an accurate own-group count while buzzing and exposes no other-group progress or answers.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Reconcile the implementation with the specification, design blueprint, and project quality gates.

- [X] T045 [P] Compare the implemented services, state transitions, and message order with all four Feature 006 diagrams; update the `.puml` sources and regenerate paired PNGs only where implementation differs in `diagrams/006-timed-scoring-component.puml`, `diagrams/006-timed-scoring-class.puml`, `diagrams/006-timed-scoring-sequence-timer.puml`, and `diagrams/006-timed-scoring-sequence-scoring.puml`.
- [X] T046 Update validation steps and record actual command results in `specs/006-timed-scoring/quickstart.md`; reconcile any contract, data-model, or plan change against `specs/006-timed-scoring/spec.md` and the corresponding design files.
- [X] T047 Run the backend/frontend Vitest suites, Playwright E2E suite, `npm run typecheck`, and `npm run build` listed in `specs/006-timed-scoring/quickstart.md`; record commands, exit codes, and failures for the implementation handoff.
- [ ] T048 Open a PR from `codex/006-timed-scoring`, include scope, diagram/document consistency, and actual test results from `specs/006-timed-scoring/plan.md`, obtain the required review, and merge only after approval.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Create/switch to `codex/006-timed-scoring` before implementation; the existing workspaces and test tools are available.
- **Foundational (Phase 2)**: No additional global blocker; existing activity, role, roster, WebSocket, and worksheet-import foundations are in place.
- **User Story 1 (Phase 3)**: Can start immediately; it establishes time-limit and cutoff support.
- **User Story 2 (Phase 4)**: Follows User Story 1 because reset and successful worksheet replacement must cancel the timer and reset its limit; it also uses the common realtime message/client files.
- **User Story 3 (Phase 5)**: Follows User Story 1 because it consumes the BUZZING phase and shared client message/state plumbing. Its own-progress service and component do not depend on scoring, though shared handler/client files should be integrated one story at a time.
- **Polish (Phase 6)**: Depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: No feature dependency; MVP.
- **US2 (P1)**: Depends on US1's ActivityTimer cancellation and reset-to-zero integration.
- **US3 (P2)**: Depends on US1's stage/time projection; does not depend on US2's scoring rules.

### Parallel Opportunities

- Within each story, `[P]` tests use distinct files and can be authored concurrently before implementation.
- In US1, `T011` protocol validation and `T014` frontend message types can proceed in parallel; after `T016`, teacher and student presentation work is split across parallel tasks `T017` and `T018`.
- In US2, parallel tasks `T024` scoring domain work and `T025` activity reset work use separate domain files; `T027` protocol validation and `T030` frontend message types also use separate files.
- In US3, `T040` backend progress calculation and `T042` frontend message typing use separate files; after shared message work is integrated, frontend state and the answer panel can be completed in their own files.
- Do not parallelize tasks that edit the same central files (`handler.ts`, `protocol.ts`, `messages.ts`, `client.ts`, `state/buzzer-results.ts`) across stories; integrate those story changes in the dependency order above.

### Parallel Examples

```text
US1 tests: T002, T003, T004, T005, T006, T007 (different test files)
US1 after ActivityState types are agreed: T011 and T014 (backend protocol / frontend messages)
US2 tests: T019, T020, T021, T022, T023 (different test files)
US2 domain/protocol: T024 and T025; T027 and T030 (separate files)
US3 tests: T036, T037, T038, T039 (different test files)
US3 projection/types: T040 and T042 (backend domain / frontend message types)
```

## Implementation Strategy

### MVP First (User Story 1)

1. Complete T001 by creating/switching to the independent feature branch; no new dependencies are required.
2. Complete US1 tests and implementation (T002–T018).
3. Validate the independent timer story using the acceptance criteria above and the Vitest/Playwright commands in `quickstart.md`.
4. Review the timer sequence diagram and cutoff behavior before proceeding to scoring.

### Incremental Delivery

1. US1 provides the independently usable timed/unlimited buzzer MVP.
2. US2 adds teacher-only manual scoring, student ended scoreboard, and reset/import cleanup.
3. US3 adds the own-group progress prompt during BUZZING.
4. Complete Phase 6 consistency review and record actual validation results before PR review.

## Notes

- `[P]` means a different file can be changed independently without an incomplete-task dependency.
- Tests are included because the spec and constitution require normal and boundary coverage; this task generation did not execute them.
- All runtime state remains in process memory as specified by `plan.md`; do not add SQLite or expose Google Sheets credentials to the browser.
- Follow the server authority, role projections, deadline equality rule, and manual-only correctness rule from the Feature 006 contracts.

## Phase 7: Convergence

- [X] T049 [US2] On successful worksheet import, synchronize the frontend time limit to 0 and clear cached answer, judgment, and scoreboard state; add regression coverage for importing after a nonzero preparing-stage limit per FR-014 and SC-006 (partial).
