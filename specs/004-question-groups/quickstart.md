# Quickstart: 004 題組與多填空

This guide defines the Feature 004 validation scenarios and records observed implementation evidence.

See the [WebSocket contract](./contracts/group-questions-websocket.md) for the exact byte boundary, the [worksheet contract](./contracts/worksheet-group-layout.md) for export verification and the [data model](./data-model.md) for the export manifest lifecycle.

## Prerequisites

- Windows local development environment with Node.js 24 LTS and npm.
- Repository dependencies installed with `npm ci`.
- The existing teacher password and group list configured as for Features 001–003.
- Automated tests use the fake Sheets adapter. Provider fault cases can use a fake results provider. Include an export integration through the actual `BuzzerWinningResultsProvider` with the fake Sheets adapter.
- A manual Google Sheets check requires a disposable workbook shared with the configured service account. Keep `GOOGLE_SERVICE_ACCOUNT_JSON` in the backend environment or ignored local `.env`; never put it in `VITE_*`, test output, or source control.

## Start the local application

From the repository root, run the existing backend and frontend in separate PowerShell terminals:

```powershell
npm run dev --workspace @speckit-buzzer/backend
npm run dev --workspace @speckit-buzzer/frontend
```

Open `http://127.0.0.1:5173`, authenticate as teacher or join as a configured student group. The backend remains bound to loopback and obtains Google credentials only from its environment.

## Worksheet fixture

Create a disposable worksheet with headers in a row and columns chosen for the test. A minimal fixture can be pasted as tab-separated values:

```text
題號	作答
1
2	（1）
	（2）
3	（1）
	（2）
	（3）
```

Expected import: 3 top-level questions in order; question 1 is single-answer; question 2 has 2 slots; question 3 has 3 slots. The blank question-number cells under questions 2 and 3 are child slots, not additional questions.

For the new-activity guard, seed the selected sheet with one PROJECT-visible row/column developer metadata entry using key `sb004`; import must be rejected before replacing the active worksheet/questions. A sheet with unrelated metadata keys only, or a different tab with an `sb004` anchor, must still import. Also verify this after a prior Feature 004 export, when the activity manifest has been cleared but the sheet anchors remain.

Prepare variants for dynamic headers, spacer rows, missing/duplicate/reversed/orphan markers and a one-marker group. Create a valid 20-slot group and a 21-slot variant. Verify the 21-slot sheet fails as a whole and retains the prior worksheet and questions. At import use a long question ID to make the minimum complete request with one `a` in each slot exactly 16,384 bytes, then 16,385. Accept the first and reject the second, identifying the over-limit topic.

## Automated validation commands

### US1 observed results (2026-11-19)

From the isolated `codex/004-question-groups` worktree:

| Command | Observed result |
| --- | --- |
| `npx vitest run tests/unit/guided-notes/worksheet-parser.test.ts tests/integration/guided-notes-import.test.ts` (from `backend/`) | 2 files passed; 13 tests passed |
| `npx playwright test tests/e2e/guided-notes-import.spec.ts` (from `frontend/`) | 5 tests passed |
| `npm run typecheck --workspaces` | Frontend and backend TypeScript checks passed |
| `npm run test --workspace @speckit-buzzer/frontend` | 2 files passed; 6 tests passed |

These are the US1 checkpoint results. Final repository-wide gates are recorded below; a manual Google Sheets benchmark still requires a disposable workbook and configured credentials.

### US2 observed results (2026-11-19)

| Command | Observed result |
| --- | --- |
| `npx vitest run tests/unit/buzzer-results.test.ts tests/unit/buzzer-results-protocol.test.ts tests/integration/buzzer-results-submit.test.ts tests/integration/buzzer-results-teacher-progress.test.ts tests/unit/buzzer-results-student-results.test.ts` (from `backend/`) | 5 files passed; 37 tests passed |
| `npm run test --workspace @speckit-buzzer/frontend` | 2 files passed; 10 tests passed, including fixed-ID fallback and exact/over-limit client serialization |
| `npx playwright test tests/e2e/buzzer-results-submit.spec.ts` (from `frontend/`) | 4 tests passed; included partial recovery, immutable group lock, rejoin, exact 16,384-byte UTF-8 send, and 16,385-byte draft recovery |
| `npx playwright test tests/e2e/buzzer-results-teacher-progress.spec.ts` (from `frontend/`) | 1 test passed; classroom size 3; observed teacher progress latency 43 ms |
| `npm run typecheck --workspaces` | Frontend and backend TypeScript checks passed |

The new US2 cases were first run before implementation: 5 new backend cases failed; the browser case initially failed because group inputs were not rendered. They passed after the server, client, and UI changes.

### US3 observed results (2026-11-19)

| Command | Observed result |
| --- | --- |
| `npx vitest run tests/unit/guided-notes/export-mapping.test.ts tests/unit/guided-notes/service-coordinator.test.ts tests/integration/guided-notes-export.test.ts tests/integration/buzzer-results-export.test.ts tests/integration/guided-notes-errors.test.ts` (from `backend/`) | 5 files passed; 50 tests passed, including mixed group sizes, exact raw prewrite values, atomic writes plus anchors, confirmed repeats, missing/moved anchors, and lost-response reconciliation |
| `npx playwright test tests/e2e/guided-notes-errors.spec.ts tests/e2e/guided-notes-export.spec.ts` (from `frontend/`) | 9 tests passed; includes target-value-only edits and refusal after structural movement |
| `npm run typecheck --workspace @speckit-buzzer/backend` | Passed |

### Final repository regression gates (2026-11-19)

| Command | Observed result |
| --- | --- |
| `npm run typecheck` | Frontend and backend TypeScript checks passed |
| `npm test` | Frontend: 2 files / 10 tests passed. Backend: 23 files / 154 tests passed |
| `npm run test:e2e` | 37 Playwright tests passed, including mixed import/submission/export and missing-anchor repeat rejection |
| `npm run build` | Frontend Vite build and backend TypeScript build passed |

The five Feature 004 PlantUML sources and paired PNGs were reconciled with the export lifecycle and regenerated in the isolated worktree. Automated checks use the fake Sheets adapter. The live 100-question Google Sheets service benchmark is recorded below; it used the previously authorized disposable Feature 002 workbook through a temporary tab, which was deleted after the run.

Run the feature's backend and browser coverage plus the existing regression commands:

```powershell
npm run typecheck
npm run test --workspace @speckit-buzzer/backend
npm run test --workspace @speckit-buzzer/frontend
npm run test:e2e --workspace @speckit-buzzer/frontend
npm run build
```

Expected coverage:

- Backend Vitest: mixed single/group parsing with full-width, half-width and mixed markers; one-marker/20/21-slot boundaries; import-service minimum-envelope boundaries at 16,384/16,385 bytes; `sb004` rejection and unrelated-metadata acceptance; unauthorized/wrong-stage rejection before Sheets access; atomic failed import; exact slot mapping; anchor and coordinate validation; same-activity re-export, no-winner single clears and no-winner group marker preservation.
- Buzzer service/integration: reject partial or blank vectors without state changes; accept a complete vector once regardless of answer correctness; do not score; preserve original answer strings; assign rank only from server receive order; reject duplicates; keep teacher, student-own, and ended-result projections role-safe.
- Transport: for group messages sized at 16,384 and 16,385 UTF-8 bytes, include Chinese and JSON-escaped characters. Check exact-limit acceptance, an over-limit browser draft with no message and no pending state, then successful submission after shortening. Inject an over-limit raw message to confirm server-side rejection with no receipt, lock or rank. Keep the single-answer regression cases.
- Export integration: submit answers through the real buzzer path, then assert the first adapter batch includes every value/clear and the original anchors. Verify a stable repeat uses the same target coordinates and creates zero new anchors. Change the fake layout by inserting a blank row among cleared child slots, moving/deleting rows or columns, or removing an anchor; each unverifiable repeat sends zero batches. A target-cell-value-only edit after confirmation must not invalidate the mapping; the repeat overwrites it with the activity result. Include literal answers starting with `=`, definite rejection, acknowledged commit, lost-response commit verified by anchors and intended raw values, PREPARED promotion without a second batch, and still-unconfirmed results that retain PREPARED and send no new batch.
- Playwright: import a mixed worksheet and verify new-activity rejection of a previously exported sheet; render the right field count; recover partial and oversized drafts; verify lock and rank feedback; restore the role-scoped state on rejoin; export each winning slot and then repeat export in the same activity.

The frontend Vitest project currently uses a Node environment without a DOM simulator; UI behavior should be verified through the existing Playwright E2E setup rather than adding a DOM dependency solely for this feature.

## Manual Google Sheets benchmark

Use only a **one-use disposable spreadsheet**. The benchmark writes Feature 004 `sb004` developer-metadata anchors which persist after the answer cells are restored, so do not reuse this worksheet for another activity or benchmark run.

The repository includes `backend/scripts/guided-notes-service-benchmark.mjs`. It times the real backend import and export service calls separately, exports one winner for the first question, clears other unanswered single questions, preserves no-winner group markers without sending cell writes for them, restores the original answer-cell values, and verifies that restoration. Make the first question a single-answer question so the benchmark winner has one answer; include at least two groups with different slot counts after it so export also measures mapping and anchoring grouped targets.

Create a disposable Google spreadsheet and share it with the service account's `client_email` as an Editor. Enable the Google Sheets API for that service-account project. In one worksheet tab, create up to 100 unique top-level question IDs (preferably 100 for the reference run), with the entire grid within 1,000 rows × 26 columns. For example, use a single-answer first question, a two-slot group, a three-slot group, then enough single-answer questions to reach 100 total. Put `題號` and `作答` in the header row; put each fullwidth marker such as `（1）` in its own `作答` cell, with child rows directly below the group start and blank `題號` cells. Keep every target cell inside the scratch range configured below.

From the repository root in Windows PowerShell, load the downloaded service-account JSON directly into the current process environment. Replace the three example values with your disposable workbook URL, tab title and local credential-file path. The credential value is not printed by these assignments and does not need to be pasted into chat:

```powershell
$credentialFile = 'C:\path\to\service-account.json'
$env:GOOGLE_SERVICE_ACCOUNT_JSON = Get-Content -Raw $credentialFile
$env:GUIDED_NOTES_POC_SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/REPLACE_WITH_DISPOSABLE_ID/edit'
$env:GUIDED_NOTES_POC_WORKSHEET_TITLE = 'Benchmark'
$env:GUIDED_NOTES_POC_SCRATCH_RANGE = 'A1:Z1000'

npm run build --workspace @speckit-buzzer/backend
node backend/scripts/guided-notes-service-benchmark.mjs
```

The script must print `GUIDED_NOTES_SERVICE_BENCHMARK=PASS` and `scratch_targets_restored=true`. Confirm `question_count` is 100 (or the tested count, never over 100), `grid` is no larger than `1000x26`, and both `import_ms` and `export_ms` are at most `10000`. The script measures each service operation separately; it does not enforce the 10-second threshold itself. Record the exact output and conditions in this file. A second run against the same worksheet requires a new disposable tab because the first run's `sb004` anchors remain even though the answer-cell values are restored.

#### Observed live result (2026-11-19)

- The existing Feature 002 disposable workbook was still accessible to the configured service account. A read-only Sheets API request confirmed the selected tab exists and its grid is `1000x26`; a temporary-tab create/delete also confirmed edit access.
- Generated a temporary tab with 100 top-level question IDs: a single-answer first question, a 2-slot group, a 3-slot group, and 97 additional single-answer questions. Ran the real `GuidedNotesService` and Google Sheets adapter with no injected network delay or transient API failure.
- The first synthetic run exposed a benchmark assertion that counted questions instead of answer target cells when groups were present. The script now calculates clear targets from each question's slot count; the successful timing below is from the rerun after that correction.
- Output: `GUIDED_NOTES_SERVICE_BENCHMARK=PASS`; `question_count=100`; `grid=1000x26`; `import_ms=1033`; `export_ms=1498`; `scratch_targets_restored=true`; `temporary_tab_removed=true`.
- The temporary tab was deleted after the run, removing its temporary export anchors. The existing Feature 002 worksheet tab was not modified.

#### Observed live anchor validation (2026-11-19)

- Command: `node --env-file=C:/Users/USER/Desktop/speckit_buzzer/.env backend/scripts/guided-notes-live-anchor-validation.mjs` from the repository root. The script creates a temporary `1000x26` tab, runs the real `GuidedNotesService` and Google Sheets adapter, then deletes the tab.
- Fixture: one winning single, a 2-slot winning group, a 3-slot no-winner group, and one no-winner single. First export wrote 3 answer cells, cleared the one no-winner single, and left all three no-winner group markers unchanged.
- Edited only the first winning group target value, then repeated export in the same activity. The service rewrote the original answer vector and the sheet's `sb004` anchor count stayed unchanged.
- Inserted a row between the group's original slots. The next repeat returned `QUESTION_TARGET_INVALID`; the adapter sent zero export batches and the post-rejection answer-cell snapshot matched the pre-request snapshot.
- Output: `LIVE_ANCHOR_VALIDATION=PASS`; `first_export_written=3`; `first_export_cleared=1`; `target_value_only_repeat=PASS`; `anchor_count_unchanged_on_repeat=true`; `structural_change_rejected=QUESTION_TARGET_INVALID`; `rejected_repeat_batches=0`; `temporary_tab_removed=true`. The existing Feature 002 worksheet tab was not modified.

#### Post-review regression checks (2026-11-19)

- `npm run test --workspace @speckit-buzzer/backend`: 23 files / 154 tests passed, including full-width, half-width and mixed marker parsing, malformed delimiter rejection, no-winner group preservation, no-winner single clearing, and exact 16,384/16,385-byte cases.
- `npm run test --workspace @speckit-buzzer/frontend`: 2 files / 10 tests passed, including exact 16,384/16,385-byte browser transport cases.
- `npm run test:e2e --workspace @speckit-buzzer/frontend`: 37 Playwright tests passed. Export E2E asserts the no-winner group markers remain unchanged on first and repeated export.
- `npm run typecheck` and `npm run build`: both passed for frontend and backend.
- The optional cell-by-cell teacher-template fixture was not added because no teacher spreadsheet file exists in either the repository worktree or the original Desktop checkout; no synthetic file was represented as the teacher's template.

Under the Feature 002 reference conditions—at most 100 top-level question IDs, grid no larger than 1,000 rows × 26 columns, no injected network delay or quota/transient API error—each operation must complete in 10 seconds or less. After export, also verify:

- Each winning answer replaced the matching numbered placeholder cell.
- A no-winner single target is cleared; no-winner group markers stay unchanged and receive no cell write.
- A second export during the same activity updates the same cells after verifying the original coordinates and slot mapping. Check that no new developer metadata is created on repeat.
- In separate disposable fixtures, insert a blank row between group child rows or delete/move an original row or column. Verify the earlier anchors move or disappear and the next export reports a layout problem with zero changed answer cells. Also test a missing anchor and a target-value-only edit: the latter preserves identity and the repeat writes the current result to the original target.
- A new activity uses an original or unexported worksheet.
- After a Feature 004 export, attempting to import that same worksheet for a new activity is rejected because `sb004` anchors persist; a copy/original without those anchors remains importable.
- All non-target values, formulas, notes, and formatting are unchanged.

Keep the sheet structure stable during each export. Run the edits between operations to verify the supported detection. If Sheets quota or a protected target rejects the first batch, verify no target values or anchors were applied. For an uncertain write, inspect the sheet before retrying. The service reconciles the existing attempt before it issues another write.
