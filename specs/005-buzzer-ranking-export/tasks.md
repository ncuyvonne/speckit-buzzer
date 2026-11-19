# Tasks: 005 搶答公平順位與 CSV 匯出

**Input**: Design documents in `specs/005-buzzer-ranking-export/`
**Blueprint**: `diagrams/005-buzzer-ranking-export-component.puml`, `diagrams/005-buzzer-ranking-export-class.puml`, and `diagrams/005-buzzer-ranking-export-sequence.puml` (with matching PNGs)
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Implementation notes**: Reuse the existing npm workspaces, WebSocket server, in-memory `ActivityState`, Google Sheets adapter boundary, Vitest, and Playwright. Do not add a database or new framework for this feature. CSV export does not call Google Sheets. Server time, accepted order, success-count snapshots, ranking, and role-filtered results remain authoritative.

**Test ordering**: For each user story, write its listed tests before implementation and confirm they fail against the missing behavior before proceeding.

## Phase 1: Setup

**Purpose**: Establish the correct Feature 004-based revision and isolated Feature 005 branch/worktree before source changes; existing app and test infrastructure are reused.

- [x] T001 [Constitution VI] Confirm Feature 004 PR #4 has an approved review and pin the base to its exact reviewed head `890395169abaede0c3d4362e630d78e8f2b4bd99`; create the isolated `codex/005-buzzer-ranking-export` worktree from that revision and transfer only `specs/005-buzzer-ranking-export/` plus `diagrams/005-buzzer-ranking-export-*`; keep the 005 PR stacked on `codex/004-question-groups` until PR #4 merges, then rebase/retarget as directed by `specs/005-buzzer-ranking-export/plan.md`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the shared client/server message shapes from the realtime contract before story handlers and UI consume them.

- [x] T002 [P] Add typed fair-ranking settings, ranked teacher progress, ended student result, CSV request/response, and error payloads to `backend/src/realtime/protocol.ts` per `specs/005-buzzer-ranking-export/contracts/realtime-websocket.md`.
- [x] T003 [P] Add matching client request and server response types for settings, ranks, student results, and CSV download to `frontend/src/realtime/messages.ts` per `specs/005-buzzer-ranking-export/contracts/realtime-websocket.md`.

**Checkpoint**: Both protocol definitions match the WebSocket contract and the sequence diagram before feature behavior is added.

---

## Phase 3: User Story 1 - 老師設定公平順位 (Priority: P1)

**Goal**: Let a teacher configure the fair-ranking switch and positive decimal delay during `PREPARING`; default to disabled and freeze settings when the activity starts.

**Independent Test**: Create activities with default-off, enabled-valid, and enabled-invalid settings. Verify default-off preserves received order, a positive finite decimal delay is accepted, blank/zero/negative/non-numeric values prevent start, and changes after start are rejected.

### Tests for User Story 1

- [x] T004 [P] [US1] Test default settings, positive finite decimal validation, disabled `null` delay, and rejection of blank/zero/negative/non-finite delay in `backend/tests/unit/buzzer-results-fair-ranking-settings.test.ts`.
- [x] T005 [P] [US1] Test teacher-only setting updates, `PREPARING`-only updates, invalid-setting rejection without state mutation, and frozen settings after `BUZZING` in `backend/tests/integration/buzzer-results-fair-ranking-settings.test.ts`.
- [x] T006 [P] [US1] Test the frontend settings request, default-off state, and validation-error presentation in `frontend/tests/unit/buzzer-results-fair-ranking-settings.test.ts`.

### Implementation for User Story 1

- [x] T007 [P] [US1] Add fair-ranking state and lifecycle validation in `backend/src/domain/activity-state.ts` and `backend/src/domain/buzzer-results.ts`: `enabled` defaults to `false`; enabled `delaySeconds` must be finite and greater than zero, may be decimal seconds, and settings cannot change after transition to `BUZZING`.
- [x] T008 [US1] Handle `buzzerResults.setFairRanking` in `backend/src/realtime/handler.ts`, authorize the teacher, accept updates only in `PREPARING`, return the configured state, and reject invalid settings or post-start changes with actionable errors.
- [x] T009 [P] [US1] Add settings request/ack handling and fair-ranking settings state to `frontend/src/realtime/client.ts` and `frontend/src/state/buzzer-results.ts`.
- [x] T010 [US1] Add the default-off toggle, decimal-seconds input, validation feedback, and preparing-stage save flow to `frontend/src/components/TeacherPanel.tsx`.

**Checkpoint**: A teacher can set valid rules before start; invalid or late changes do not mutate the activity.

---

## Phase 4: User Story 2 - 依活動規則產生每題完整順位 (Priority: P1)

**Goal**: Rank every valid submission per question using strict server receive order when fairness is off, or a frozen prior-win snapshot and configured delay when it is on. Rank 1 is the winner.

**Independent Test**: Submit answers for several questions with multiple groups, once with fairness off and once on. Verify received-time order when off; when on, verify `receivedAtMs + K × D × 1000`, the acceptance-time snapshot of wins on other questions, stable snapshots, and accepted-order tie-breaking.

### Tests for User Story 2

- [x] T011 [P] [US2] Test received-time ordering, `K × D` effective-time calculation, frozen prior-win snapshots, accepted-order ties, invalid/duplicate submission exclusion, contiguous ranks, and that rank/winner outcomes do not judge answer correctness or calculate scores in `backend/tests/unit/fair-ranking.test.ts`.
- [x] T012 [P] [US2] Test multi-question submissions, winner changes, server-side accepted order, and teacher progress ranks through WebSocket in `backend/tests/integration/buzzer-results-ranking.test.ts`.
- [x] T013 [P] [US2] Test fairness-off ordering and fairness-on winner/rank outcomes in `frontend/tests/e2e/buzzer-results-ranking.spec.ts`; set the existing `groupIds` fixture from `PLAYWRIGHT_GROUP_IDS` to match backend `GROUP_IDS`, connect one student client per entry, measure each valid submission-to-teacher-visible-update latency, assert it is at most 2 seconds, and record group count N and measurements.

### Implementation for User Story 2

- [x] T014 [P] [US2] Implement deterministic per-question effective-time sorting and contiguous rank assignment in `backend/src/domain/fair-ranking.ts`; use server `acceptedOrder` for equal effective times and ignore unsubmitted groups.
- [x] T015 [US2] Update answer acceptance and ranking in `backend/src/domain/buzzer-results.ts`: record server `receivedAtMs` and `acceptedOrder`; snapshot the group's current rank-1 count on other questions before acceptance; freeze `priorWinCountSnapshot`; compute `effectiveAtMs` as `receivedAtMs + priorWinCountSnapshot × delaySeconds × 1000` when enabled and as `receivedAtMs` when disabled; recompute only the submitted question; do not judge answer correctness or calculate scores.
- [x] T016 [US2] Publish teacher-only live ranks, winner, and complete submitted answers from `backend/src/realtime/handler.ts`; keep unanswered groups at `rank = null` and do not expose other groups' progress to students during `BUZZING`.
- [x] T017 [P] [US2] Map server ranking updates into the frontend results state in `frontend/src/state/buzzer-results.ts` and `frontend/src/realtime/client.ts` without client-side timestamp or winner calculations.
- [x] T018 [US2] Display each submitted group's live rank, winner, and unanswered state in `frontend/src/components/TeacherResultsPanel.tsx`.

**Checkpoint**: Each accepted answer has a deterministic server-assigned rank, and rank 1 consistently identifies the current winner.

---

## Phase 5: User Story 3 - 活動結束後檢視完整順位 (Priority: P1)

**Goal**: After `ENDED`, show students every group's rank or “未作答”, the winning answer, and their own answer while withholding other non-winning answers; teachers retain the full result.

**Independent Test**: End a multi-question activity with submitted and unsubmitted groups. Verify student results include all ranks and missing-answer states, only the winner's and student's own answers, and teacher results include all answers. Verify student live progress remains private before end.

### Tests for User Story 3

- [x] T019 [P] [US3] Test the ended student projection for all group ranks, `rank = null` for unsubmitted groups, winner answer visibility, own-answer visibility, and omission of other non-winning answers in `backend/tests/unit/buzzer-results-student-ranking.test.ts`.
- [x] T020 [P] [US3] Test `BUZZING` versus `ENDED` stage behavior and teacher/student result projections over WebSocket in `backend/tests/integration/buzzer-results-student-ranking.test.ts`.
- [x] T021 [P] [US3] Test post-end rank visibility, unanswered labels, answer privacy, and teacher full-result visibility in `frontend/tests/e2e/buzzer-results-student-ranking.spec.ts`.

### Implementation for User Story 3

- [x] T022 [P] [US3] Extend the student result projection in `backend/src/domain/buzzer-results.ts` with every group's `groupId`, `submitted`, and `rank`, plus winner and own-group data; omit all other non-winning answers.
- [x] T023 [US3] Gate the full student result broadcast on `ENDED` and preserve teacher full-answer visibility in `backend/src/realtime/handler.ts`; during `BUZZING`, send students only their own progress.
- [x] T024 [P] [US3] Store and map the ended student rank projection in `frontend/src/state/buzzer-results.ts` and `frontend/src/realtime/client.ts` while preserving role-specific payload boundaries.
- [x] T025 [US3] Render every group's rank or “未作答”, winner answer, and own answer/status in `frontend/src/components/StudentResultsPanel.tsx`; do not render answers for other non-winning groups.

**Checkpoint**: Students can review the complete final order without seeing other non-winning answers; teachers can inspect all answers.

---

## Phase 6: User Story 4 - 老師匯出活動順位 CSV (Priority: P1)

**Goal**: Allow an authenticated teacher to download complete results after the activity ends, with one row per question/group and Excel-compatible Traditional Chinese encoding.

**Independent Test**: Export a completed activity with multiple questions, submitted and unsubmitted groups, group answers, and CSV-special characters. Verify row coverage/order, all six columns, blank unanswered cells, escaping, CRLF, and UTF-8 BOM; verify unauthorized, premature, and not-ready requests return errors without a partial file.

### Tests for User Story 4

- [x] T026 [P] [US4] Test CSV headers, question/group row coverage, rank ordering, blank unanswered fields, and a question with no submissions (all groups still have rows and winner/group answer/rank fields are blank); also test ordered subanswers, comma/quote/CR/LF escaping, CRLF records, and `EF BB BF` prefix in `backend/tests/unit/buzzer-results-csv.test.ts`.
- [x] T027 [P] [US4] Test teacher authorization, `ENDED` and result-readiness guards, and requester-only CSV response over WebSocket in `backend/tests/integration/buzzer-results-csv-export.test.ts`.
- [x] T028 [P] [US4] Test the teacher CSV download and inspect its rows, BOM, Traditional Chinese headers, and unanswered rows in `frontend/tests/e2e/buzzer-results-csv-export.spec.ts`.

### Implementation for User Story 4

- [x] T029 [P] [US4] Implement CSV row construction and serialization in `backend/src/domain/buzzer-results-csv.ts` with header order `題號,成功組別,成功答案,組別,組別答案,搶答順位`, question order, ranked submitted groups followed by unsubmitted groups, ordered subanswers, standard quoting, CRLF, and UTF-8 BOM; when a question has no submissions, emit every group row with winner, answer, and rank fields blank.
- [x] T030 [US4] Handle `buzzerResults.exportCsv` in `backend/src/realtime/handler.ts`; allow only the authenticated teacher after `ENDED` when results are ready, return the CSV only to the requester, and return a clear error without partial CSV otherwise.
- [x] T031 [P] [US4] Handle the CSV-ready response in `frontend/src/realtime/client.ts` and download `csvText` using a `text/csv;charset=utf-8` Blob and the server-provided filename.
- [x] T032 [US4] Add the results-ready export control and download/error states to `frontend/src/components/TeacherPanel.tsx`.

**Checkpoint**: Teacher export matches displayed results and contract format; unauthorized or incomplete exports produce no file.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the implementation against the quickstart, contracts, PlantUML blueprints, and project quality gates.

- [x] T033 [P] [Constitution V] Update acceptance walkthroughs and automated validation commands to match the delivered behavior in `specs/005-buzzer-ranking-export/quickstart.md`.
- [x] T034 [P] [Constitution VII] Compare service responsibilities, data fields, role visibility, and message flow with `diagrams/005-buzzer-ranking-export-component.puml`, `diagrams/005-buzzer-ranking-export-class.puml`, and `diagrams/005-buzzer-ranking-export-sequence.puml`; update any mismatched `.puml` and its matching `.png`, regenerating PNGs with the PlantUML CLI.
- [x] T035 [Constitution III] Run and record `npm run test --workspace @speckit-buzzer/backend`, `npm run test --workspace @speckit-buzzer/frontend`, `npm run test:e2e`, `npm run typecheck`, and `npm run build` from `package.json`, `backend/package.json`, and `frontend/package.json`; report actual commands and outcomes without marking unrun checks as passed.
- [ ] T036 [Constitution VI] Open the Feature 005 PR from `codex/005-buzzer-ranking-export` to `codex/004-question-groups` while PR #4 remains open; include scope, actual test evidence, and limitations, obtain review before merging, and after PR #4 merges rebase/retarget Feature 005 to the integrated revision per `.specify/memory/constitution.md` and `specs/005-buzzer-ranking-export/plan.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Use the reviewed Feature 004 PR #4 head as the current base and keep Feature 005 stacked on `codex/004-question-groups` until #4 merges; complete T001 before editing implementation files.
- **Foundational (Phase 2)**: Depends on Setup; protocol types block story handler and UI work.
- **User Story 1**: Depends on Foundational; creates the settings lifecycle required by fair ranking.
- **User Story 2**: Depends on User Story 1; produces the authoritative rank used by ended results and CSV.
- **User Stories 3 and 4**: Both depend on User Story 2. They can proceed independently after ranking is stable, with coordination for shared `handler.ts` and `client.ts` changes.
- **Polish**: Depends on all four stories selected for delivery.

### User Story Dependencies

```text
Setup → Foundational → US1 → US2 ─┬→ US3
                                  └→ US4
```

### Parallel Opportunities

- T002 and T003 update separate protocol files after the contracts are fixed.
- Within each story, backend unit, WebSocket integration, and browser E2E test files (T004–T006, T011–T013, T019–T021, T026–T028) can be authored in parallel.
- Backend domain work and frontend state/client work can proceed in parallel when they touch separate files and consume the agreed contracts (for example T007/T009, T014/T017, T022/T024, T029/T031).
- US3 and US4 can be developed in parallel after US2, but integrate changes to shared `backend/src/realtime/handler.ts` and `frontend/src/realtime/client.ts` in sequence to avoid conflicts.
- Diagram review and quickstart updates (T033–T034) touch separate artifacts and can proceed in parallel after implementation stabilizes.

### Parallel Execution Examples

- **US1**: Author T004, T005, and T006 together. After they fail for the expected missing behavior, implement backend state (T007) alongside frontend state/client handling (T009); then complete dependent handler and UI tasks.
- **US2**: Author T011, T012, and T013 together. Once tests are in place, implement the ranking helper (T014) alongside frontend mapping (T017); integrate the answer service and handler afterward.
- **US3**: Author T019, T020, and T021 together. Implement the backend projection (T022) alongside frontend state mapping (T024); then wire stage/role handling and render the student view.
- **US4**: Author T026, T027, and T028 together. Implement the CSV serializer (T029) alongside frontend download handling (T031); then connect the WebSocket export handler and teacher control.

## Implementation Strategy

### MVP First

The smallest coherent MVP is **US1 + US2**: teachers can configure the rule and the server applies it to produce trustworthy ranks. US1 alone exposes a setting without delivering its ranking effect. After the MVP, deliver US3 for student result visibility and US4 for downloadable records.

1. Complete Setup and Foundational phases.
2. Complete US1, then verify settings/defaults and stage restrictions.
3. Complete US2, then verify both ranking modes and snapshot/tie behavior; this completes the MVP.
4. Complete US3 and US4 independently, then run the full quality gates and blueprint review.

### Incremental Delivery

Each story has its own tests and checkpoint. Do not begin CSV or ended-result integration until the server ranking behavior from US2 is stable. Keep all test evidence and any deviations from the PlantUML blueprint in the feature PR.

## Notes

- `[P]` means the task changes a separate file set and has no dependency on an incomplete task.
- User story labels map directly to the four P1 stories in `specs/005-buzzer-ranking-export/spec.md`.
- Reuse current test fixtures in `backend/tests/support/` and `frontend/tests/e2e/fixtures.ts` where applicable; do not add dependencies unless an implementation gap is demonstrated.
- The original checkout remains `codex-003-buzzer-results`; the dedicated `codex/005-buzzer-ranking-export` worktree is the implementation checkout, and T001 records that the independent-branch gate is complete. Do not switch or commit the original checkout wholesale.
- T036 remains open until the Feature 005 PR is created, reviewed, and later retargeted after Feature 004 PR #4 merges; do not merge either PR before review.
