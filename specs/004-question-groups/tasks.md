---
description: "Dependency-ordered implementation tasks for Feature 004 question groups"
---
# Tasks: 004 題組與多填空

**Input**: Design documents in `specs/004-question-groups/` and the five Feature 004 blueprints in `diagrams/004-question-groups-*.puml`.

**Tests**: Include tests because Constitution Principle III requires normal and boundary tests, and the feature specification defines independent test scenarios. For each story, add its tests before implementation and confirm the new cases fail first. Use the existing Vitest and Playwright setup.

**Organization**: All three user stories are P1. Implement in data-flow order: import layout (US1), complete-vector submission (US2), then mapped export (US3).

## Phase 1: Setup

**Purpose**: Isolate Feature 004 from the dirty shared checkout before implementation.

- [X] T001 Create the isolated `codex/004-question-groups` worktree from a base containing Features 002 and 003; transfer `specs/004-question-groups/` and `diagrams/004-question-groups-*` into it; verify `.specify/memory/constitution.md`; ensure `diagrams/004-question-groups-sequence-import.puml` shows the `sb004` persisted-anchor import guard and regenerate its PNG, then verify all five `.puml`/PNG pairs with the installed Java/PlantUML CLI before implementation; keep unrelated changes from `codex-003-buzzer-results` out of the Feature 004 worktree and PR.

---

## Phase 2: Foundational

**Purpose**: Define shared question and submission shapes before story work.

- [X] T002 Extend shared domain and wire types in `backend/src/guided-notes/types.ts`, `backend/src/domain/activity-state.ts`, `backend/src/domain/buzzer-results.ts`, `backend/src/realtime/protocol.ts`, and `frontend/src/realtime/messages.ts`: retain the model constraints “Import is allowed only in `PREPARING`; submissions only in `BUZZING`; export only in `ENDED`”, “`worksheet`: Set together with the fully validated question list”, “Contains 1–100 unique top-level question IDs; child rows do not increase this count”, “`SINGLE` has one answer slot. `GROUP` has 2–20 numbered slots”, and “A single question has one logical slot. Each group has its own contiguous sequence from 1 through its slot count”; define `exportAnchorState` as `NONE | PREPARED | CONFIRMED` with “PREPARED carries the first-attempt manifest during a write and while its outcome is uncertain. CONFIRMED carries it after success or matching read-back. NONE has no manifest. Activity replacement clears the state”; preserve the legacy single-answer request shape and represent group submissions as complete ordered vectors.

**Checkpoint**: All stories use the same question-kind, answer-slot, and submission vocabulary without adding a parallel answer service or persistence layer.

---

## Phase 3: User Story 1 - 匯入混合單題與題組 (Priority: P1) 🎯 MVP

**Goal**: Import mixed single/group worksheets, preserve top-level question order, and atomically reject invalid layouts.

**Independent Test**: Import a fixture with a single question, two-slot and four-slot groups, and a spacer row; verify three top-level questions and the two group counts. Reject one-marker and malformed groups, 21 slots, minimum requests over 16,384 bytes, and a previously exported sheet carrying `sb004` anchors without replacing the previously imported worksheet or question layout.

### Tests for User Story 1

- [X] T003 [P] [US1] Add parser cases in `backend/tests/unit/guided-notes/worksheet-parser.test.ts` for mixed rows, dynamic headers, full-width, half-width and mixed-style markers, different group counts, duplicate IDs, one-marker groups, mismatched delimiters, and missing/repeated/reversed/orphaned/non-contiguous markers; cover 20-slot acceptance and 21-slot rejection, then confirm the new cases fail before implementation.
- [X] T004 [P] [US1] Add import preflight and atomicity cases in `backend/tests/integration/guided-notes-import.test.ts` and metadata fixtures in `backend/tests/support/fake-google-sheets.ts`: prove valid minimum requests of exactly 16,384 UTF-8 bytes are accepted, 16,385-byte minimum requests are rejected with question/row guidance, PROJECT-visible `sb004` ROW/COLUMN anchors on the selected sheet reject a previously exported sheet while other keys, tabs and location types do not, teacher/phase failures occur before Sheets access, and all failures leave the prior worksheet and question list unchanged; confirm the new cases fail before implementation.
- [X] T005 [P] [US1] Extend `frontend/tests/e2e/guided-notes-import.spec.ts` to display mixed question types and per-group slot counts, reject a previously exported sheet with an actionable original/unexported-sheet message, and cover 20/21-slot, one-marker, and minimum-payload errors without changing the current activity; confirm the new assertions fail before implementation.

### Implementation for User Story 1

- [X] T006 [US1] Implement worksheet parsing in `backend/src/guided-notes/worksheet-parser.ts` and import mapping types in `backend/src/guided-notes/types.ts`: retain the model constraints “`questionId`: Exact non-empty displayed question-number value; unique within the imported worksheet and activity”, “`displayOrder`: 1-based order of top-level questions from top to bottom”, “`answerSlots`: A single question has one logical slot. Each group has its own contiguous sequence from 1 through its slot count”, “`placeholderNumber`: 1-based. Group slots must be contiguous and unique. A single question uses slot 1 without a worksheet marker”, and “`sourceRowAtImport`: 1-based traceability only. First export must rediscover the live worksheet positions; this import coordinate is not authoritative after sheet edits”; locate unique dynamic headers and parse full-width or ASCII-parenthesis markers in each answer cell, including mixed styles; enforce “`GROUP` has 2–20 numbered slots” in consecutive rows with blank child question cells; preserve source order and “1–100 unique top-level question IDs; child rows do not increase this count”; report question ID and row for missing, duplicate, reversed, orphaned, mismatched-delimiter, or out-of-range markers.
- [X] T007 [US1] Implement import preflight and atomic activity replacement in `backend/src/guided-notes/service.ts`, `backend/src/domain/activity-state.ts`, `backend/src/integrations/google-sheets/types.ts`, `backend/src/integrations/google-sheets/adapter.ts`, and `backend/src/realtime/handler.ts`: after teacher/phase authorization and before parsing, search developer metadata for `metadataKey=sb004` and `visibility=PROJECT`, then reject only ROW/COLUMN records on the selected numeric `sheetId`; ignore other keys, tabs and location types; build the compact group request with the displayed question ID, one `a` per slot, and a representative 36-byte ASCII request ID; reject if its UTF-8 length exceeds 16,384 bytes; keep `spreadsheetId` parsed and validated from the teacher's selected reference, `sheetId` resolved by the server from worksheet metadata, and `worksheetTitle` equal to the exact selected tab title; recheck `PREPARING` before commit; enforce the model rule “A valid import is parsed into a temporary candidate and replaces the current worksheet/question structure only after every header, ID, marker, and count check passes.”
- [X] T008 [P] [US1] Store and decode the imported ordered question summary in `frontend/src/state/activity.ts` and `frontend/src/realtime/messages.ts`, exposing only question ID, `SINGLE`/`GROUP`, and answer count to student views; never expose the teacher worksheet reference.
- [X] T009 [US1] Render the imported question types and group counts through `frontend/src/components/GuidedNotesPanel.tsx` and `frontend/src/App.tsx`, keeping child slots out of the top-level question count.
- [X] T010 [US1] Run parser/import Vitest cases in `backend/tests/unit/guided-notes/worksheet-parser.test.ts` and `backend/tests/integration/guided-notes-import.test.ts`, the import journey in `frontend/tests/e2e/guided-notes-import.spec.ts`, and `npm run typecheck`; record exact commands and observed outcomes in `specs/004-question-groups/quickstart.md`.

**Checkpoint**: A teacher can import valid mixed worksheets and see slot counts; malformed worksheets fail as a whole without changing the current activity.

---

## Phase 4: User Story 2 - 一次送出題組全部答案並判定順位 (Priority: P1)

**Goal**: Accept one complete answer vector per group/question, assign server receipt order, lock only accepted submissions, and retain existing single-answer behavior.

**Independent Test**: Submit partial and whitespace-only vectors and confirm no answer, lock, or rank is created; reject a teacher's submission and any submission outside `BUZZING`; submit a complete vector once and confirm server order decides the winner. Verify 16,384-byte acceptance, 16,385-byte local rejection with draft retention, and teacher/student visibility rules.

### Tests for User Story 2

- [X] T011 [P] [US2] Add service/domain cases in `backend/tests/unit/buzzer-results.test.ts` and `backend/tests/unit/buzzer-results-protocol.test.ts` for complete, partial, blank, extra, duplicate, missing and out-of-range slots; retry after invalid input; immutable first acceptance; exact-time ordering; single-answer compatibility; and acceptance/ranking without correctness judgment or score; confirm the new cases fail before implementation.
- [X] T012 [P] [US2] Extend `backend/tests/integration/buzzer-results-submit.test.ts` and `backend/tests/integration/buzzer-results-teacher-progress.test.ts` to prove the server accepts a vector atomically, uses server receipt order, rejects a raw oversized WebSocket message without recording receipt/lock/rank, rejects teacher submissions and submissions outside `BUZZING` without state changes, and sends only the teacher/all-group and student/own-group projections allowed by the contract; confirm the new cases fail before implementation.
- [X] T013 [P] [US2] Extend `frontend/tests/e2e/buzzer-results-submit.spec.ts` and `frontend/tests/e2e/buzzer-results-teacher-progress.spec.ts` for partial-submit recovery, complete-vector locking, multibyte/escaped text at 16,384 and 16,385 bytes, draft shortening and retry, single-answer regression, role-specific results, and rejoin; confirm the new assertions fail before implementation.

### Implementation for User Story 2

- [X] T014 [US2] Extend `BuzzerResultsService` in `backend/src/domain/buzzer-results.ts` to accept one complete answer per `SINGLE` or the model rule “Exactly one answer for every expected slot (2–20), ordered by placeholder number. All entries must contain a non-whitespace character; original answer text is preserved”; enforce “`(groupId, questionId)` is unique for the active session. Validate and insert the complete single answer or group vector as one synchronous server operation. A partial or invalid vector does not consume the group's one-submission allowance”; derive `groupId` from the authenticated student's server connection and validate it against the current roster; require `questionId` to match an imported question; assign server `receivedAt` and monotonically increasing `receivedOrder`; lock only accepted complete submissions; preserve a single `answerText` containing a non-whitespace character exactly as submitted; reject duplicates without changing the first accepted answer or winner; never judge correctness or score answers.
- [X] T015 [US2] Validate and route grouped requests in `backend/src/realtime/protocol.ts` and `backend/src/realtime/handler.ts`: derive group identity from the authenticated connection in `RealtimeHub` and validate it against the configured roster; require the exact imported slot set; return `GROUP_ANSWER_INCOMPLETE` or `GROUP_ANSWER_INVALID` with actionable slot details; preserve the single-answer wire shape; enforce role and stage checks; and publish the teacher, student-own, and ended-result projections without accepting client time, group, rank, or winner.
- [X] T016 [P] [US2] Update group submission serialization and decoding in `frontend/src/realtime/client.ts` and `frontend/src/realtime/messages.ts`: use a fixed 36-byte ASCII request ID; serialize the complete compact request once; measure that exact string with `TextEncoder`; send and create pending state only at or below 16,384 bytes; above the limit return a local shortening hint while keeping the draft editable and leaving pending, accepted, lock, and rank state unchanged; cover the ID fallback and snapshot/broadcast/reconnect decoders.
- [X] T017 [US2] Render one input for `SINGLE` and every imported slot for `GROUP` in `frontend/src/components/BuzzerAnswerPanel.tsx`, `frontend/src/state/buzzer-results.ts`, and `frontend/src/App.tsx`; submit the full vector once and retain all entered text after incomplete or oversized rejection.
- [X] T018 [US2] Render complete vectors, lock state, and winner state in `frontend/src/components/TeacherResultsPanel.tsx` and `frontend/src/components/StudentResultsPanel.tsx`, preserving teacher all-group visibility and student own/winner-only visibility.
- [X] T019 [US2] Run the focused domain, protocol, integration, and Playwright cases in `backend/tests/unit/buzzer-results.test.ts`, `backend/tests/unit/buzzer-results-protocol.test.ts`, `backend/tests/integration/buzzer-results-submit.test.ts`, `backend/tests/integration/buzzer-results-teacher-progress.test.ts`, `frontend/tests/e2e/buzzer-results-submit.spec.ts`, and `frontend/tests/e2e/buzzer-results-teacher-progress.spec.ts`; record exact commands and observed outcomes in `specs/004-question-groups/quickstart.md`.

**Checkpoint**: Complete group submissions are immutable, ranked by server receipt order, and visible only to authorized roles; invalid or oversized drafts do not affect state.

---

## Phase 5: User Story 3 - 將各子題答案寫回學習單 (Priority: P1)

**Goal**: Export each winner's answer to the original question/slot cell, preserve non-target cells, and allow safe same-activity re-export only while the original mapping remains verifiable.

**Independent Test**: Export a mixed worksheet and confirm every answer replaces its matching marker. A confirmed repeat reuses the same coordinates after verifying anchors and live mappings; structural changes or missing anchors reject the whole write, while a target-value-only edit does not invalidate identity and is overwritten with the current result.

### Tests for User Story 3

- [X] T020 [P] [US3] Extend mapping tests in `backend/tests/unit/guided-notes/export-mapping.test.ts` and `backend/tests/unit/guided-notes/service-coordinator.test.ts` for variable group sizes, exact question/slot mapping, missing or duplicate first-export targets, PREPARED/CONFIRMED lifecycle, target-value-only edits on confirmed repeats, and refusal when row/column anchors or structural mappings move or disappear; confirm the new cases fail before implementation.
- [X] T021 [P] [US3] Extend `backend/tests/integration/guided-notes-export.test.ts` and `backend/tests/integration/buzzer-results-export.test.ts` to exercise the real `BuzzerWinningResultsProvider` with the fake Sheets adapter; assert teacher-only export after `ENDED`, no Sheets access for unauthorized or wrong-stage requests, one atomic applicable-writes-plus-anchors batch, winning-vector slot writes, no-winner single clears, no-winner group marker preservation with zero group-cell writes, `UNAVAILABLE` no-write, unchanged non-target cells, definite rejection, and lost-response reconciliation for applied, definitively unapplied, and inconclusive outcomes; confirm the new cases fail before implementation.
- [X] T022 [P] [US3] Extend `frontend/tests/e2e/guided-notes-export.spec.ts` to export mixed single/group results and repeat within the same activity; verify same-target writes after target-value-only edits, zero-write rejection after structural movement or missing anchors, and no new anchors on repeat; confirm the new assertions fail before implementation.

### Implementation for User Story 3

- [X] T023 [P] [US3] Implement initial and repeat `WorksheetLayout` mapping plus manifest construction in `backend/src/guided-notes/worksheet-parser.ts` and `backend/src/guided-notes/types.ts`: enforce “`headerRowNumber`: Unique current header row containing exactly one `題號` and one `作答` title”, “Each activity question ID must resolve to exactly one current row”, and “First export maps a group to current numbered marker rows and verifies the imported kind and count. Repeat export validates the manifest's original rows against the live snapshot”; repeat export requires original sheet/header/row/column coordinates, matching dimension anchors, question IDs and blank child-row relationships; a confirmed target-cell value change alone is not identity evidence.
- [X] T024 [P] [US3] Update `backend/src/guided-notes/winning-results-provider.ts` to provide ordered winning answer vectors and retain the result-model constraint “One normalized slot for `SINGLE`; the full winning vector for `GROUP`, never a per-child winner”; normalize a legacy single answer to slot 1, preserve `READY` with no winners as a valid result that clears unanswered singles and preserves unanswered group markers, and keep `UNAVAILABLE` as no-write; order results by the server-assigned `receivedOrder`.
- [X] T025 [P] [US3] Extend the Sheets contracts and implementation in `backend/src/integrations/google-sheets/types.ts` and `backend/src/integrations/google-sheets/adapter.ts`: enforce manifest constraints “`header`: Original coordinates of the unique header and its named columns”, “`targets`: Exactly one original coordinate for every imported question/slot pair, including unanswered single clears and preserved group placeholders”, “`anchors`: Exactly one anchor per distinct target row, header row, question column and answer column”, and “Each `ExportTarget` keeps the exact `questionId`, logical slot, original row and answer column, raw prewrite value, and intended literal string or null; null clears a single target or preserves a no-winner group marker according to question kind/cardinality”; create each anchor with PROJECT visibility and metadata key `sb004`, plus its expected positive Sheets metadata ID, compact attempt token, dimension, sheet ID and coordinate; keep the manifest and anchor data backend-only and never store answers in sheet metadata; read row/column developer metadata and send applicable target writes/clears plus first-export `CreateDeveloperMetadataRequest` anchors in one atomic `spreadsheets.batchUpdate`; mask writes to `userEnteredValue` and leave non-target values, formulas, notes, and formatting unchanged.
- [X] T026 [US3] Orchestrate export in `backend/src/domain/activity-state.ts` and `backend/src/guided-notes/service.ts`: require teacher + `ENDED` + imported worksheet + `READY`; retain the model rule “It continues to serialize external Sheets operations, enforce the 10-second deadline, and distinguish confirmed success, confirmed failure, and unconfirmed outcomes”; preserve the operation lock and retry rules; implement `PREPARED`/`CONFIRMED` transitions per “PREPARED is retained while a first-write outcome is unresolved. CONFIRMED follows acknowledged success or complete matching read-back”; retain a `PREPARED` manifest while the initial write is unresolved; promote to `CONFIRMED` on acknowledgment or complete matching read-back; clear only after definitive non-application and fresh marker validation; otherwise preserve the unconfirmed state and do not send another batch; on confirmed repeats verify original anchors/mappings and write to those original coordinates.
- [X] T027 [US3] Run mapping, coordinator, export integration, buzzer-results export, and browser export cases in `backend/tests/unit/guided-notes/export-mapping.test.ts`, `backend/tests/unit/guided-notes/service-coordinator.test.ts`, `backend/tests/integration/guided-notes-export.test.ts`, `backend/tests/integration/buzzer-results-export.test.ts`, and `frontend/tests/e2e/guided-notes-export.spec.ts`; cover winning vectors, no-winner single clears, preserved no-winner group markers, serialization, deadline timeout, operation locking, confirmed success/failure, and uncertain-write reconciliation without duplicate writes; record exact commands and observed outcomes in `specs/004-question-groups/quickstart.md`.

**Checkpoint**: A teacher can export complete vectors atomically to verified original cells; result-not-ready, uncertain, or structurally changed worksheets never receive an unsafe partial or repeated write.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Reconcile the implementation with its blueprints, prove regression and performance gates, then prepare review.

- [X] T028 After implementation, compare all five Feature 004 blueprints in `diagrams/004-question-groups-*.puml` with code, update any differing source diagrams, regenerate their paired PNGs with `java -jar plantuml.jar "./diagrams/004-question-groups-*.puml"`, and reconcile `specs/004-question-groups/data-model.md`, `contracts/`, `plan.md`, and `quickstart.md` with actual behavior.
- [X] T029 Run repository regression gates from `package.json`: `npm run typecheck`, backend and frontend workspace Vitest, `npm run test:e2e --workspace @speckit-buzzer/frontend`, and `npm run build`; record exact commands and actual results in `specs/004-question-groups/quickstart.md`, marking unrun checks as unrun.
- [X] T030 Benchmark import and export separately with a disposable Google worksheet and backend environment credentials using the Feature 002 reference size (up to 100 top-level questions, 1,000 rows × 26 columns); verify each completes within 10 seconds and record test conditions/results in `specs/004-question-groups/quickstart.md`.
- [X] T031 Run the constitution-required `$speckit-converge` check against `specs/004-question-groups/spec.md`, `plan.md`, `tasks.md`, the implementation, and `diagrams/004-question-groups-*.puml` after implementation; add any remaining unbuilt work to `specs/004-question-groups/tasks.md` and resolve it before PR review.
- [ ] T032 Prepare the Feature 004 PR from `codex/004-question-groups` with only the implementation, `diagrams/004-*`, and `specs/004-question-groups/`; include evidence from `specs/004-question-groups/quickstart.md` and obtain the constitution-required review before merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 must finish first so implementation does not modify the dirty shared `codex-003-buzzer-results` checkout.
- **Foundational (Phase 2)**: T002 depends on T001 and blocks all user stories because backend, wire, and frontend code must share the same question/submission shapes.
- **User Stories (Phases 3–5)**: Complete US1 before integrated US2 because submissions consume the imported layout; complete US2 before US3 because export consumes winning answer vectors.
- **Polish (Phase 6)**: T028–T032 depend on all three story checkpoints.

### User Story Dependencies

- **US1 (P1)**: Starts after T002; provides the validated mixed worksheet and question/slot counts.
- **US2 (P1)**: Starts after T010; uses US1's imported layout for complete-vector validation and student input.
- **US3 (P1)**: Starts after T019; uses US1's worksheet mapping and US2's complete winning vectors.
- Unit and integration tests may use seeded fixtures, but the integrated browser journey follows US1 → US2 → US3.

### Within Each User Story

- Add focused normal and boundary tests first and confirm the new assertions fail before implementation.
- **US1**: T003, T004, and T005 can run in parallel. After those tests, T006 and T008 can run in parallel; T007 follows T006; T009 follows T008 and the import API; T010 validates the story.
- **US2**: T011, T012, and T013 can run in parallel. After them, T014 and T016 can run in parallel; T015 follows T014; T017 follows the client and imported layout; T018 follows the server projections; T019 validates the story.
- **US3**: T020, T021, and T022 can run in parallel. After them, T023, T024, and T025 can run in parallel; T026 integrates those components; T027 validates the story.

### Parallel Opportunities

- Test authoring is independent across parser unit tests, backend integration tests, and Playwright files within each user story.
- Parser/mapping, frontend state/client, winning-results provider, and Sheets adapter tasks are parallel only where they touch separate files and have no incomplete dependency.

## Parallel Examples

### User Story 1

```text
Task: "T003 parser unit tests in backend/tests/unit/guided-notes/worksheet-parser.test.ts"
Task: "T004 import integration tests in backend/tests/integration/guided-notes-import.test.ts"
Task: "T005 import browser tests in frontend/tests/e2e/guided-notes-import.spec.ts"
```

### User Story 2

```text
Task: "T011 answer-service unit tests in backend/tests/unit/buzzer-results.test.ts"
Task: "T012 submission/projection integration tests in backend/tests/integration/buzzer-results-submit.test.ts"
Task: "T013 submission browser tests in frontend/tests/e2e/buzzer-results-submit.spec.ts"
```

### User Story 3

```text
Task: "T020 export mapping unit tests in backend/tests/unit/guided-notes/export-mapping.test.ts"
Task: "T021 export integration tests in backend/tests/integration/guided-notes-export.test.ts"
Task: "T022 export browser tests in frontend/tests/e2e/guided-notes-export.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete setup and shared types (T001–T002).
2. Complete US1 import/layout recognition (T003–T010).
3. **Stop and validate**: prove mixed worksheets, count limits, payload preflight, and atomic failure before implementing answer submission/export.

### Incremental Delivery

1. Complete US1 and validate it independently.
2. Add US2 complete-vector submission, server rank, role-safe views, and transport boundary.
3. Add US3 real result-provider export, anchor verification, and same-activity repeat.
4. Reconcile diagrams/docs, run regression and benchmark gates, converge, then prepare the reviewed PR.

## Notes

- `[P]` means different files and no incomplete dependency; `[US#]` maps a task to a user story.
- Keep the existing Vitest/Playwright stack; do not add a DOM simulator or a second answer service.
- Update task checkboxes only from observed implementation and test evidence.

## Phase 7: Convergence

- [X] T033 Remove the stale statement that all tasks are unchecked; keep task-status guidance consistent with observed implementation and test evidence per Constitution V. (partial)

## Phase 8: Convergence

- [X] T034 Verify live same-activity repeat export after target-value-only edits and reject a repeat after a structural row/column change or missing anchor before any target write; record the disposable-tab conditions and observed results in `specs/004-question-groups/quickstart.md`, then delete the temporary tabs per plan: concurrent Sheets edits / FR-018 / SC-005 (partial).

## Phase 9: PR Review Corrections

- [X] T035 Accept full-width, half-width, and mixed-style group markers; reject mismatched delimiters; cover all forms in parser tests and align the worksheet contract wording with the mixed-style rule.
- [X] T036 Preserve no-winner group placeholders with no answer-cell writes while still clearing no-winner single cells; cover initial and repeated exports in mapping, service integration, Playwright, and live Sheets tests.
- [ ] T037 Update PR evidence with exact 16,384/16,385-byte boundary coverage, explain the `sb004` metadata and reimport guard/reset tradeoff, check whether the actual teacher worksheet fixture is available, and request a new review. Do not substitute a synthetic fixture for an unavailable source template.
