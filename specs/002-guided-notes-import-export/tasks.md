---
description: "Task list for Feature 002 Guided Notes import and export"
---

# Tasks: 002 Guided Notes 匯入與匯出（單題）

**Input**: Design documents from `/specs/002-guided-notes-import-export/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Included because the specification defines independent acceptance tests and the project constitution requires normal and boundary tests for each feature. Write each story's tests before its implementation and verify the tests fail for the expected missing behavior.

**Organization**: Tasks are grouped by the three user stories in `spec.md`, in priority order. Complete each story's test checkpoint before starting the next story phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with another marked task because it edits a different file and has no dependency on unfinished work.
- **[Story]**: `US1`, `US2`, or `US3`, matching `spec.md`.
- Every task names the exact project file(s) it changes or validates.

## Phase 1: Setup — Sheets API and live PoC

**Purpose**: Prepare the Google Sheets client and validate the credential/read/write path against a disposable sheet before implementing the feature adapter.

- [X] T001 [P] Add `googleapis` to `backend/package.json` and update the root `package-lock.json` with the workspace dependency.
- [X] T002 [P] Add empty `GOOGLE_SERVICE_ACCOUNT_JSON`, `GUIDED_NOTES_POC_SPREADSHEET_URL`, `GUIDED_NOTES_POC_WORKSHEET_TITLE`, and `GUIDED_NOTES_POC_SCRATCH_RANGE` entries with safe descriptions to the root `.env.example`; verify the root `.gitignore` continues to ignore `.env`.
- [X] T003 Create `backend/scripts/guided-notes-sheets-poc.ts` to load service-account JSON only from the backend environment, read the configured disposable worksheet, require the configured `GUIDED_NOTES_POC_SCRATCH_RANGE`, confirm a non-first-row header and reversed question/answer column order can be located in the formatted grid, snapshot target and neighboring non-target values/formulas/notes/format, perform RAW write/empty-string clear in one batch, verify target and non-target contents, exercise a definitively invalid batch, restore the original scratch contents in a finally path, and print elapsed time without printing credentials or raw API responses.
- [X] T004 Run `node --env-file=../.env --import tsx scripts/guided-notes-sheets-poc.ts` from `backend/` against a disposable worksheet with at most 100 questions and grid at most 1,000 rows × 26 columns; record actual credential/read/write/atomicity results and elapsed times in `specs/002-guided-notes-import-export/quickstart.md`. If the `tsx` loader cannot start due to the local `uv_os_get_passwd` / `ENOMEM` failure, run the equivalent Node 24 native TypeScript transform command and record both outcomes. Proceed only if every PoC check passes. If credentials or a disposable sheet are unavailable, stop at this gate and report the blocker; if a check fails, diagnose and fix it before proceeding. Never mark this checkpoint passed on a failure or unrun PoC.

**Checkpoint**: Proceed to foundational adapter work only after T004 records a successful PoC. A missing credential, missing test sheet, or failed check blocks the next phase until resolved. Do not use a real classroom worksheet for mutation tests.

---

## Phase 2: Foundational — shared types, configuration, and test seams

**Purpose**: Provide the common data types, server configuration, and injectable integration boundary required by all user stories.

- [X] T005 [P] Define `WorksheetReference`, `Question`, `WorksheetLayout`, `WinningAnswer`, `WinningResultsSnapshot`, and `GuidedNotesOperation` in `backend/src/guided-notes/types.ts`; Activity starts with `worksheet=null`, `questions=[]`, count 0 and after import has 1–100 ordered unique non-empty IDs; encode results as `READY { answers } | UNAVAILABLE` so a READY empty list means no winners while UNAVAILABLE rejects export before Sheets write; enforce the remaining data-model validation and status constraints in `data-model.md`.
- [X] T006 [P] Define the injectable `GoogleSheetsAdapter` read/resolve/batch-write types in `backend/src/integrations/google-sheets/types.ts`; batch writes must represent one target answer cell per activity question and support `""` for clearing a no-winner cell.
- [X] T007 [P] Add failing Vitest cases for absent/malformed `GOOGLE_SERVICE_ACCOUNT_JSON` and secret-safe configuration errors in `backend/tests/unit/guided-notes/sheets-config.test.ts`.
- [X] T008 Implement backend parsing and validation of `GOOGLE_SERVICE_ACCOUNT_JSON` in `backend/src/config.ts`; do not include credential values in thrown messages or logs, and keep teacher login usable only according to existing Feature 001 behavior.
- [X] T009 Create the serial Guided Notes operation coordinator and typed service boundary in `backend/src/guided-notes/service.ts`; permit only one external import/export at a time and expose no client-controlled stage or winner data.
- [X] T010 Create injectable in-memory Sheets and winning-results fakes in `backend/tests/support/fake-google-sheets.ts` and `backend/tests/support/fake-winning-results.ts`; record requested ranges, preserve non-target values/formulas/notes/format, inject `READY`/`UNAVAILABLE`, and simulate definite rejection or lost response with full commit, no commit, or unavailable read-back.

**Checkpoint**: Types, config tests, service boundary, and fake adapter are in place. Run the config Vitest suite before starting US1; resolve failures before moving on.

---

## Phase 3: User Story 1 — 匯入學習單題號與題數 (Priority: P1) 🎯 MVP

**Goal**: A logged-in teacher imports the ordered 1–100 question IDs from a selected worksheet while the activity is PREPARING; the UI shows the server-computed count and failed imports leave the previous list unchanged.

**Independent Test**: With a fake worksheet whose headers are below the first row, whose columns are reversed, and whose IDs are `1`, `2`, `4` with a blank row between them, verify the UI displays 3 IDs in source order. Missing/ambiguous headers, duplicate/empty/101 IDs, student access, and read failure must not replace the current activity list.

### Tests for User Story 1 (write first; confirm expected failures before implementation)

- [X] T011 [P] [US1] Add Vitest cases in `backend/tests/unit/guided-notes/worksheet-parser.test.ts` for arbitrary header row/column order, header trimming, blank rows, nonconsecutive IDs, exact displayed ID preservation, duplicate IDs with the full duplicate IDs and source row numbers, zero valid IDs, ambiguous headers, and 100-versus-101 question boundaries.
- [X] T012 [P] [US1] Add WebSocket/service integration cases in `backend/tests/integration/guided-notes-import.test.ts` for teacher-only PREPARING access, server-stage recheck before commit, worksheet/tab selection, production-like composition-root injection using fake adapter/provider, atomic Activity replacement, no question descriptions in Activity or teacher snapshots, and unchanged state after read or validation failure.
- [X] T013 [P] [US1] Add teacher import E2E cases in `frontend/tests/e2e/guided-notes-import.spec.ts` and `frontend/tests/e2e/fixtures.ts` for URL/tab selection, count and ordered IDs display, actionable validation errors, student denial, and a fake adapter injected through the same server composition-root factory used by production, with no real Google credentials.

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement pure header and question extraction in `backend/src/guided-notes/worksheet-parser.ts`; find exactly one candidate row containing one whole-cell, trimmed 題號 and one whole-cell, trimmed 作答, ignore noncandidate rows even when one required label repeats, and reject duplicate labels in candidate rows or multiple candidate rows, preserve non-whitespace IDs exactly, ignore rows without IDs, reject duplicate IDs with each ID and its source row numbers, reject zero valid IDs, and enforce the inclusive 1–100 limit.
- [X] T015 [P] [US1] Implement service-account client creation and worksheet metadata/value reads in `backend/src/integrations/google-sheets/adapter.ts`; use `FORMATTED_VALUE`, quote tab names safely in A1 ranges, scan the selected tab's full grid, and keep all credentials server-side.
- [X] T016 [P] [US1] Extend `backend/src/domain/activity-state.ts` so its initial import state is `worksheet=null`, `questions=[]`, count 0; successful imports atomically set the worksheet and 1–100 ordered, unique, non-empty question IDs, deriving count from the array only after full validation and a final server-side PREPARING-stage check.
- [X] T017 [US1] Implement `GuidedNotesService.importWorksheet` in `backend/src/guided-notes/service.ts`; validate the sheet read and parsed candidate before replacing Activity state, and return the ordered IDs/count only after commit.
- [X] T018 [US1] Add `guidedNotes.import`, `guidedNotes.imported`, teacher-only `guidedNotes.snapshot`, and import error handling to `backend/src/realtime/protocol.ts` and `backend/src/realtime/handler.ts`; implement `UnavailableWinningResultsProvider` in `backend/src/guided-notes/unavailable-results.ts` and wire it by default, with the configured Google adapter and injectable provider through the actual `backend/src/server.ts` composition root; check authenticated connection role and PREPARING before any Google API call.
- [X] T019 [US1] Add import message handling and the teacher import UI to `frontend/src/realtime/messages.ts`, `frontend/src/realtime/client.ts`, `frontend/src/state/activity.ts`, `frontend/src/components/GuidedNotesPanel.tsx`, and `frontend/src/App.tsx`; display only server-returned question IDs/count, support the empty initial snapshot, and require teacher reauthentication after reconnect per Feature 001.
- [X] T020 [US1] Run backend Vitest, frontend Vitest, and `npm run test:e2e --workspace @speckit-buzzer/frontend` for T011–T013; fix failures and record actual results in `specs/002-guided-notes-import-export/quickstart.md` before starting US2.

**Checkpoint**: US1 passes the independent import test and all T011–T013 cases before US2 begins.

---

## Phase 4: User Story 2 — 將搶答成功答案寫回學習單 (Priority: P1)

**Goal**: After the activity ends, a logged-in teacher confirms writing each server-selected winning answer to the current row matching its question ID; no-winner cells are cleared, and every other cell/value/format is preserved.

**Independent Test**: Seed Activity with imported IDs and fake server-side winner results. Reorder worksheet rows after import, then export and verify answers follow IDs rather than old row numbers, no-winner old text becomes blank, extra worksheet IDs and all non-target cells remain unchanged, and a rejected batch leaves all target cells unchanged.

### Tests for User Story 2 (write first; confirm expected failures before implementation)

- [X] T021 [P] [US2] Add Vitest cases in `backend/tests/unit/guided-notes/export-mapping.test.ts` for fresh header/column discovery, row reorder, missing or duplicate target IDs, untouched extra IDs, winning-answer mapping, and `""` no-winner targets.
- [X] T022 [P] [US2] Add adapter/service integration cases in `backend/tests/integration/guided-notes-export.test.ts` for one multi-range batch, RAW values, preservation of non-target values/formulas/notes/format, all-or-none definite rejection, full-commit and no-commit lost-response read-backs, unresolved `UNCONFIRMED`, and no worksheet imported: assert `WORKSHEET_NOT_IMPORTED` is returned before either the winning-results provider or Sheets adapter is called.
- [X] T023 [P] [US2] Add Playwright export cases in `frontend/tests/e2e/guided-notes-export.spec.ts` and `frontend/tests/e2e/fixtures.ts` for ENDED-stage teacher confirmation, answer/clear counts, displayed success only after confirmation, `WORKSHEET_NOT_IMPORTED` guidance with no provider/Sheets call, visible provider-unavailable state with no write, and blocked export before ENDED.

### Implementation for User Story 2

- [X] T024 [P] [US2] Add fresh worksheet-to-Activity question mapping in `backend/src/guided-notes/worksheet-parser.ts`; require exactly one current target row for every Activity question ID and never use `sourceRowAtImport` as the export coordinate.
- [X] T025 [P] [US2] Implement `GoogleSheetsAdapter.batchWriteValues` in `backend/src/integrations/google-sheets/adapter.ts` with one `spreadsheets.values.batchUpdate`, `valueInputOption=RAW`, one answer range per question, and an empty string for each no-winner target; do not send non-target cells or use a separate clear request.
- [X] T026 [US2] Implement `GuidedNotesService.exportAnswers` in `backend/src/guided-notes/service.ts`; require ENDED, check for an imported worksheet first and return `WORKSHEET_NOT_IMPORTED` before invoking the results provider or Sheets adapter, then obtain `READY { answers }` from the injected server-side Feature 003 provider or return `WINNING_RESULTS_UNAVAILABLE` before any Sheets write; treat READY with an empty list as no winners, re-read the current worksheet, validate every target before writing, serialize the operation, and confirm ambiguous outcomes by reading all targets back.
- [X] T027 [US2] Add `guidedNotes.export`, `guidedNotes.exported`, and export authorization/result routing in `backend/src/realtime/protocol.ts` and `backend/src/realtime/handler.ts`; reject non-teacher or non-ENDED requests before calling Sheets, route `WORKSHEET_NOT_IMPORTED` and provider/export errors through the stable error envelope, and never accept client-supplied answer text or target coordinates.
- [X] T028 [US2] Add export confirmation and result counts to `frontend/src/components/GuidedNotesPanel.tsx`, `frontend/src/realtime/messages.ts`, `frontend/src/realtime/client.ts`, and `frontend/src/state/activity.ts`; wire the typed request/response through the existing private-send client API, show completion only on `guidedNotes.exported`, and show actionable states for rejected or unconfirmed results without a success state.
- [X] T029 [US2] Run backend Vitest, frontend Vitest, and `npm run test:e2e --workspace @speckit-buzzer/frontend` for T021–T023; fix failures and record actual results in `specs/002-guided-notes-import-export/quickstart.md` before starting US3.

**Checkpoint**: US1 and US2 tests pass. Verify target-only writes, blank clearing, and whole-batch behavior before implementing the failure-reporting increment.

---

## Phase 5: User Story 3 — 處理學習單讀寫失敗 (Priority: P2)

**Goal**: The teacher sees a useful, secret-free recovery message for Google read/write failures, and the system never reports unconfirmed work as complete.

**Independent Test**: Inject not-found, access-denied, transient read failure, rejected batch, and lost write-response cases. Verify import state and target-cell behavior match the operation outcome, messages offer a next step, logs contain no credential or raw URL, and no unconfirmed write emits success.

### Tests for User Story 3 (write first; confirm expected failures before implementation)

- [X] T030 [P] [US3] Add Vitest/integration cases in `backend/tests/integration/guided-notes-errors.test.ts` for credential/config errors, Google 403/404/429/503 mapping, invalid sheet/layout messages, atomic batch rejection, read-back confirmation, and secret/URL redaction.
- [X] T031 [P] [US3] Add Playwright failure-state cases in `frontend/tests/e2e/guided-notes-errors.spec.ts` and `frontend/tests/e2e/fixtures.ts` for actionable import/read/write errors, retry guidance, and absence of a success message when the write result is unconfirmed.

### Implementation for User Story 3

- [X] T032 [US3] Map Google client failures to stable codes in `backend/src/integrations/google-sheets/errors.ts` and `backend/src/guided-notes/service.ts`; preserve the `WORKSHEET_NOT_IMPORTED` service error and distinguish configuration, invalid reference, access, not found/layout, transient read/write, unavailable winning results, definite write rejection, and unconfirmed outcome without forwarding raw API messages; retry only idempotent reads or definitively not-applied writes, at most twice per request with 250 ms then 500 ms delays, within a 10-second operation deadline that includes read-back; never blindly retry an ambiguous write.
- [X] T033 [US3] Render the stable Traditional Chinese recovery messages, including an instruction to import a worksheet for `WORKSHEET_NOT_IMPORTED`, in `frontend/src/components/GuidedNotesPanel.tsx` and `frontend/src/realtime/messages.ts`; keep sheet URLs, service-account JSON and raw Google errors out of visible text and client logs.
- [X] T034 [US3] Run backend Vitest, frontend Vitest, and `npm run test:e2e --workspace @speckit-buzzer/frontend` for T030–T031; fix failures and record actual results in `specs/002-guided-notes-import-export/quickstart.md` before polish.

**Checkpoint**: Failure cases are distinguishable, actionable, secret-free, and do not create partial Activity imports or partial spreadsheet batches.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the feature against the constitution, quickstart, and all four PlantUML blueprints; then complete convergence and PR review before merge.

- [X] T035 [P] Review `.env.example`, `.gitignore`, `backend/src/config.ts`, `backend/src/integrations/google-sheets/`, and error/log code to confirm no real key/token/credential is tracked, sent to the browser, or printed.
- [X] T036 Run root `npm run typecheck`, `npm run test`, `npm run test:e2e`, and `npm run build`; fix all failures and record exact commands/results in `specs/002-guided-notes-import-export/quickstart.md`.
- [X] T037 [P] Compare implementation and contracts against `diagrams/002-guided-notes-component.puml`, `diagrams/002-guided-notes-class.puml`, `diagrams/002-guided-notes-sequence-import.puml`, and `diagrams/002-guided-notes-sequence-export.puml`; update any necessary `.puml` source and regenerate corresponding `diagrams/002-guided-notes-*.png` files.
- [X] T038 After T004 and T036, complete the live-sheet and fake-adapter scenarios in `specs/002-guided-notes-import-export/quickstart.md`; for live performance record import/export elapsed times with at most 100 questions and grid no larger than 1,000 × 26 under SC-006 conditions; also record the dimensions and measured elapsed times for any larger grid, non-target cell comparison, and actual environment without recording secret values.
- [X] T039 After T036–T038, run `$speckit-converge` for `specs/002-guided-notes-import-export/`; resolve and complete any remaining tasks it adds, rerun affected phase tests and analysis, and record the final convergence result in `specs/002-guided-notes-import-export/quickstart.md`. Do not mark this task complete while converge reports outstanding work.
- [X] T040 After T039 and all required tests pass, prepare and submit the PR from codex-002-guided-notes-import-export; include the change summary and actual test results from the quickstart, obtain review, address requested corrections, and leave the PR unmerged until review is complete. PR #2's first review corrections are addressed; the follow-up review request was withdrawn by the owner.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001/T002 can start in parallel. T003 needs T001. T004 needs T002/T003 and a disposable Google test sheet plus environment credentials; it is a hard gate before the production adapter.
- **Foundational (Phase 2)**: Starts after Setup PoC. T005/T006/T007 can proceed in parallel; T008 follows T007; T009 follows T005/T006; T010 follows T006. Complete the config test checkpoint before story work.
- **US1 (Phase 3)**: Starts after foundations. T011/T012/T013 are test-first parallel work; implementation follows their expected red result. Run T020 and pass before US2.
- **US2 (Phase 4)**: Depends on US1's imported Activity/worksheet association. T021/T022/T023 can be authored in parallel; T024/T025 can be implemented in parallel after tests, then T026→T027→T028. Run T029 and pass before US3.
- **US3 (Phase 5)**: Builds on the read/write paths from US1/US2. T030/T031 are parallel test-first tasks; run T034 and pass before polish.
- **Polish (Phase 6)**: Requires all story checkpoints. T035/T037 can run in parallel; T036 is the full regression gate; T038 records results after T004/T036.
- **Convergence and PR delivery (Phase 6)**: T039 follows the full regression, diagram, and quickstart checks; complete any work convergence adds before T040. T040 is the final review gate and must not merge the PR.

### User Story Dependencies

- **US1 (P1)**: Can start after Setup and Foundational. It is the suggested MVP and establishes the server-owned worksheet reference and ordered question IDs.
- **US2 (P1)**: Delivered after US1 because it writes the Activity's imported questions back to the associated worksheet. Its mapping and writer can be unit-tested against a seeded Activity/fake sheet.
- **US3 (P2)**: Delivered after both operation paths exist so read, write, auth and uncertain outcomes share consistent user-facing error behavior.

### Parallel Opportunities

- **Setup**: T001 and T002 edit separate files.
- **Foundational**: T005, T006 and T007 edit separate files; T009/T010 are separated by the service and test-support paths once their type dependencies are done.
- **US1**: T011–T013 are separate test files; after the red checkpoint, T014–T016 are separate parser, adapter, and Activity files.
- **US2**: T021–T023 are separate test files; T024 and T025 edit the parser and adapter separately.
- **US3**: T030 and T031 are separate backend and browser test files.
- **Polish**: T035 security review and T037 diagram comparison edit separate areas.
- **Convergence/PR**: T039 and T040 are sequential gates; do not parallelize them with implementation or test tasks.

### Parallel Example: User Story 1

```text
# After Phase 2, author these tests concurrently and verify each fails for missing US1 behavior:
T011 backend/tests/unit/guided-notes/worksheet-parser.test.ts
T012 backend/tests/integration/guided-notes-import.test.ts
T013 frontend/tests/e2e/guided-notes-import.spec.ts

# After the red checkpoint, these implementation files can be developed independently:
T014 backend/src/guided-notes/worksheet-parser.ts
T015 backend/src/integrations/google-sheets/adapter.ts
T016 backend/src/domain/activity-state.ts
```

### Parallel Example: User Story 2

```text
# After US1 passes, author these tests concurrently:
T021 backend/tests/unit/guided-notes/export-mapping.test.ts
T022 backend/tests/integration/guided-notes-export.test.ts
T023 frontend/tests/e2e/guided-notes-export.spec.ts

# After the red checkpoint, the mapping and writer modules are separate:
T024 backend/src/guided-notes/worksheet-parser.ts
T025 backend/src/integrations/google-sheets/adapter.ts
```

---

### Parallel Example: User Story 3

```text
# After US1 and US2 pass, author these failure-path tests concurrently:
T030 backend/tests/integration/guided-notes-errors.test.ts
T031 frontend/tests/e2e/guided-notes-errors.spec.ts
```
## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 including the live Sheets API PoC; do not invent or skip credentials/results.
2. Complete Phase 2 foundational configuration and adapter/test seams.
3. Complete US1 import and pass its Vitest, integration, and Playwright checkpoint (T020).
4. Stop and validate the imported IDs/count, dynamic header lookup, and unchanged state after rejected imports. This is the first demonstrable increment.

### Incremental Delivery

1. Setup + Foundational → verified local credential boundary and feature seams.
2. US1 → teacher imports an ordered ID list and sees its server-computed count.
3. US2 → teacher writes answers/clears to mapped target cells after ENDED.
4. US3 → failures remain actionable, atomic and secret-free.
5. Polish → full tests, 100-question performance evidence, diagram check and quickstart record.
6. Converge remaining work, then prepare and complete PR review without merging.

### Phase Gate Rule

Do not start a later phase until all tests in the preceding story checkpoint pass. If the live Sheets PoC or any gate fails, fix the cause or report the exact blocker; never mark a phase complete based on an unrun test.

## Notes

- `[P]` marks different files with no dependency on incomplete tasks.
- Every task has a sequential ID, checkbox, applicable story label, and concrete file path.
- Cross-cutting completion tasks include convergence and PR review; merge remains outside this feature task list.
- Unit/integration/E2E cases are written before their corresponding story implementation.
- Never use a real classroom worksheet for mutation or failure-injection tests.
- Log only request ID, operation type and normalized error category; do not log credentials, raw URLs or raw Google API bodies.

## Phase 7: Convergence

- [X] T041 [P] Add the exhausted transient-read retry path to `diagrams/002-guided-notes-sequence-import.puml`, showing `SHEET_READ_FAILED` and unchanged Activity state after retry exhaustion, then regenerate its PNG per FR-014, SC-005 and Constitution V (partial).
- [X] T042 Add `backend/scripts/guided-notes-service-benchmark.mjs` and its build prerequisite to the `plan.md` source tree so the SC-006 live timing evidence has a documented, reproducible owner (partial).

## Phase 8: Convergence

- [X] T043 Update `diagrams/002-guided-notes-sequence-export.puml` to route an ambiguous response from any write attempt, including a retry after a definite rejection, through target-cell read-back and the confirmed-success/unchanged/unconfirmed outcomes; regenerate its PNG per FR-014, SC-007 and Constitution V (partial).

## Phase 9: PR #2 review corrections

- [X] T044 Clarify in spec.md, service error messages, and guided-notes-errors.spec.ts that a write timeout is unconfirmed rather than failed; a pending API request may still apply, and its operation lock remains held until settlement.
- [X] T045 Define header candidates by exact trimmed whole-cell labels and require both headers on the same row; ignore label mentions and duplicate partial labels on noncandidate rows, and cover this boundary in parser tests and contracts.
- [X] T046 Add an export integration fixture with the header on row 5, 題號 in column C, 作答 in column E, and adjacent content that must remain unchanged.
- [X] T047 Align import/export PlantUML sequence diagrams with per-read retry boundaries, the missing/mismatched sheetId SHEET_NOT_FOUND branch, and late pending-write timeout behavior; regenerate and inspect both PNGs.
- [X] T048 On Node 24, run the related/full validation gates, record actual results in this quickstart, update PR #2's body, push the original PR branch, and leave it open and unmerged.
