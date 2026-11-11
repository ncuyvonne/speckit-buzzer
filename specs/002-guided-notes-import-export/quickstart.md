# Quickstart: 002 Guided Notes 匯入與匯出（單題）

## Prerequisites

- Windows local development environment with Node.js 24 LTS and npm installed.
- Google Cloud project with Google Sheets API v4 enabled.
- A service account JSON credential available locally as `GOOGLE_SERVICE_ACCOUNT_JSON`; share only a disposable test spreadsheet with the account's `client_email`.
- The app's normal `TEACHER_PASSWORD` and `GROUP_IDS` local settings from Feature 001.
- Never use a real student worksheet for failure-injection tests. Keep the credential in ignored `.env`/process environment; do not add it to source control or `VITE_*` settings.

## Configure and start

1. During implementation, add the name `GOOGLE_SERVICE_ACCOUNT_JSON` to the root `.env.example` with an empty, non-credential placeholder. Set the real JSON in local `.env` or the Node process environment. `.env` is already ignored by the repository.
2. In Google Sheets sharing, grant the service-account email edit access to the disposable workbook; enable Sheets API for the credential's Google Cloud project.
3. From the repository root, start the existing backend and frontend in separate terminals:

   ```powershell
   npm run dev --workspace @speckit-buzzer/backend
   npm run dev --workspace @speckit-buzzer/frontend
   ```

4. Open `http://127.0.0.1:5173`, log in as the teacher, and paste the disposable spreadsheet URL. Select its worksheet tab by title.

## Automated validation

The full-feature commands remain the final validation gate. The Phase 3 import checkpoint has been run and its actual results are recorded below.

```powershell
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Expected: TypeScript checks and builds pass; Vitest covers parser, operation authorization, imported-list replacement and batch construction; Playwright injects a local fake Sheets adapter and fake Feature 003 results provider through the server composition root, then verifies teacher-visible success/error states without external credentials.

## Import scenarios

Prepare a disposable worksheet with:

- notes or another row before the headers;
- `作答` before `題號`;
- question IDs `1`, `2`, and `4`, with a blank row between them;
- one existing value in a target answer cell and a formula/value in a non-target cell.

Expected: import reports 3 questions in source row order. Also try a sheet with a noncandidate row containing duplicate 題號 labels and another explanatory cell mentioning 題號/作答, followed by one valid header row; these labels must not cause a false ambiguity. Then use variants with a missing/duplicate header in a candidate row, duplicate question ID, no valid ID, or 101 valid IDs. Each invalid import shows a repair hint and leaves the previously imported Activity list unchanged.

## Export scenarios

Use an injected server-side Feature 003 results provider with `READY` results for one answered and one unanswered question. Separately set it to `UNAVAILABLE`; export must fail before the Sheets write method is called. End the activity, confirm export, and verify:

- the winning group's answer is written to the current row for its matching question ID;
- the no-winner target cell is cleared, including any old text;
- only target `作答` cells change; the header, other values, formulas and formatting stay intact;
- missing or duplicate current target IDs reject before any write;
- an alternate layout with headers on row 5 (題號 in column C and 作答 in column E), nonconsecutive IDs, and a label-like explanatory note writes only the corresponding E-column answer cells while preserving neighboring content;
- a simulated definite rejection changes no target cells and does not display success;
- response loss followed by full intended read-back reports success, full unchanged read-back reports failure, and unavailable or mixed read-back reports `SHEET_WRITE_UNCONFIRMED` without a success state.
- a batch still pending at the 10-second deadline returns `SHEET_WRITE_UNCONFIRMED`; the request is not cancelled and may finish after the response. The UI tells the teacher to inspect the sheet before retrying, and the operation lock remains held until the pending request settles.

Also end an activity with no imported worksheet and attempt export. Expect `WORKSHEET_NOT_IMPORTED`; assert neither the results provider nor Sheets adapter is called, and the UI tells the teacher to import a worksheet first.

Also check unauthenticated/student connections, import outside PREPARING, and export before ENDED. All must be rejected before the Google adapter is called.

## Performance and live API PoC

Before implementing the adapter, time import and export of a disposable worksheet with at most 100 questions and a grid no larger than 1,000 rows × 26 columns under the SC-006 reference conditions: no quota/transient API errors and no injected network delay. Each operation must complete and report a result in 10 seconds or less. Also include a blank-heavy worksheet to check the full-grid scan; larger dimensions remain supported and must have their dimensions and observed latency recorded, but are outside the fixed 10-second benchmark profile.

At planning time, live credential and spreadsheet PoC evidence was pending. The implementation-phase records below document the authorized disposable-sheet run, its command, and measured results; fake-adapter tests alone are not sufficient to mark that gate passed.

## Current implementation gate status (2026-11-11)

- T001–T003 are complete; `npm run typecheck --workspace @speckit-buzzer/backend` passed.
- T004 passed against the disposable `工作表1` worksheet. The service-account JSON was valid and authenticated successfully; the sheet was restricted to its owner and the authorized service account, with the service account verified as an editor. Credential values and the live spreadsheet URL are intentionally omitted.
- Test fixture: 1,000 × 26 grid; two question IDs; headers on row 2 with `作答` before `題號`; a blank row between question rows; existing answer values, neighboring text, and a neighboring formula. The scratch range was `A1:C5`.
- The prescribed `node --env-file=../.env --import tsx scripts/guided-notes-sheets-poc.ts` command could not start because the installed `tsx` loader triggered Node `uv_os_get_passwd` / `ENOMEM` before making an API request. The equivalent Node 24 native TypeScript transform command passed: `node --env-file=../.env --experimental-transform-types scripts/guided-notes-sheets-poc.ts`.
- Actual PoC result: `GUIDED_NOTES_SHEETS_POC=PASS`; `question_count=2`; four neighboring cells checked; full-grid read `892 ms`; RAW write and no-winner clear `425 ms`; definitively invalid batch rejection and unchanged-state check `295 ms`; total elapsed `3,363 ms`. The original scratch values and formula were confirmed restored.
- The native TypeScript transform emitted Node's experimental-feature warning, and `googleapis` emitted a deprecation warning for the current credentials constructor; neither prevented the live PoC from passing.
- Phase 1 is complete. The live PoC gate passed, so Phase 2 may begin.

## Phase 2 validation (2026-11-11)

- T005–T010 are complete: shared domain types, injectable Sheets boundary, secret-safe credential parser, serial operation coordinator, and in-memory Sheets/results fakes are in place.
- TDD evidence: the new Sheets configuration tests first failed because the parser did not exist; after implementation, the targeted suite passed.
- `npm run test --workspace @speckit-buzzer/backend -- tests/unit/guided-notes/sheets-config.test.ts tests/unit/guided-notes/service-coordinator.test.ts` — passed, 2 files / 5 tests.
- `npm run typecheck --workspace @speckit-buzzer/backend` — passed.
- The Phase 2 checkpoint passed; Phase 3 may begin.

## Phase 3 validation — US1 import checkpoint (2026-11-11)

- T011–T019 are complete. The parser, WebSocket/service integration, and teacher import E2E cases were written first and failed before the corresponding implementation was added.
- `npm run test` — passed with exit code 0. Backend Vitest: 12 files / 58 tests passed. Frontend Vitest reported that no `tests/**/*.test.ts` files are defined and exited successfully.
- `npm run typecheck` — passed for frontend and backend.
- `npm run test:e2e --workspace @speckit-buzzer/frontend -- --reporter=line` — passed, 19/19 E2E tests, including the three Guided Notes import cases and the existing 001 reconnect/stage cases.
- E2E ran against an isolated ephemeral Vite port because the normal 5173 port was already serving the user's app. The test runner environment used `PLAYWRIGHT_PORT=<ephemeral port>`, `PLAYWRIGHT_TEST_ORIGIN=http://127.0.0.1:<same port>`, and `PLAYWRIGHT_EXTERNAL_SERVER=1`; Vite was started directly and stopped after the run. The configured Playwright server option remains enabled by default.
- The Phase 3 checkpoint passed. Phase 4 may begin.

## Phase 4 validation — US2 answer export checkpoint (2026-11-11)

- T021–T028 are complete. Test-first red results were observed: the mapping tests initially failed because the mapper was absent; export integration requests initially returned `INVALID_MESSAGE` and the adapter still failed closed; the first export E2E case initially had no export control. These cases passed after implementation.
- The export mapper re-discovers the current header and target rows by exact question ID, ignores extra worksheet IDs, and rejects missing or duplicate activity targets. `sourceRowAtImport` is not used for write coordinates.
- The Sheets adapter test verifies one `spreadsheets.values.batchUpdate` call, quoted/escaped worksheet ranges, `valueInputOption=RAW`, literal answer strings, and empty-string no-winner clears. Fake-adapter integration checks preserved non-target values, formula, note and format; definitive rejection; full commit, no commit and unavailable read-back after response loss; and the no-import short-circuit.
- `npm run test` — passed with exit code 0. Backend Vitest: 14 files / 72 tests passed. Frontend Vitest still reports no `tests/**/*.test.ts` files and exits successfully.
- `npm run typecheck` — passed for frontend and backend.
- `npm run test:e2e --workspace @speckit-buzzer/frontend -- --reporter=line` — passed, 23/23 E2E tests, including all four export cases and the full 001/002 regression suite.
- As in Phase 3, E2E used an externally managed Vite server on an ephemeral loopback port with `PLAYWRIGHT_PORT`, `PLAYWRIGHT_TEST_ORIGIN`, and `PLAYWRIGHT_EXTERNAL_SERVER=1`; the test harness stopped that process after the run.
- The Phase 4 checkpoint passed. Phase 5 may begin.

## Phase 5 validation — US3 failure handling checkpoint (2026-11-11)

- T030–T033 are complete. Error tests cover configuration and credential failures, Google status mapping, retry limits and delays, deadline handling, import state preservation, definite write rejection, ambiguous write read-back, stable recovery messages, and secret/URL redaction.
- Test-first evidence: before implementation, the error integration suite had 5 failing cases and the error E2E suite had 3 failing cases. After implementation, `npm run test --workspace @speckit-buzzer/backend -- tests/integration/guided-notes-errors.test.ts` passed, 1 file / 12 tests; `guided-notes-errors.spec.ts` passed, 4/4 E2E cases.
- `npm run test` — passed, exit code 0. Backend Vitest: 15 files / 84 tests passed. Frontend Vitest found no `tests/**/*.test.ts` files and exited successfully.
- `npm run typecheck` — passed for frontend and backend.
- `npm run test:e2e --workspace @speckit-buzzer/frontend -- --reporter=line` — passed, 27/27 E2E tests, including the four new US3 failure cases and all US1/US2 and feature-001 regression cases.
- For E2E, Vite was started from `frontend/` on an isolated ephemeral loopback port to avoid the existing development server. The environment used `PLAYWRIGHT_PORT=<ephemeral port>`, `PLAYWRIGHT_TEST_ORIGIN=http://127.0.0.1:<same port>`, and `PLAYWRIGHT_EXTERNAL_SERVER=1`; the harness stopped its Vite process after the run.
- Retry behavior was verified: reads retry after 250 ms and 500 ms, definite non-applied writes retry at most twice, and ambiguous writes are never blindly repeated; read-back determines whether the result is fully applied, unchanged, or unconfirmed.
- The Phase 5 checkpoint passed. Phase 6 may begin.

## Phase 6 implementation and contract review (2026-11-11)

- T035 security boundary review passed. `.gitignore` ignores `.env*` while allowing only the placeholder `.env.example`; `git check-ignore` confirmed `.env`, `.env.local`, and `.env.production` are ignored, and `git ls-files` found no tracked environment or credential JSON files. The example contains no usable credential. The backend parses `GOOGLE_SERVICE_ACCOUNT_JSON`, constructs the Sheets client server-side, and uses only normalized error codes/messages; the browser receives no service-account fields or full sheet URL, and backend source has no operation logging of raw Google responses or request payloads.
- T037 found the original blueprint vocabulary too abstract to show the implemented RealtimeHub, operation serialization/deadline, GoogleSheetsAdapter, current-row remapping, retries and ambiguous-write read-back. Updated all four 002 PlantUML sources and the plan's source-tree / status notes to match the implementation and contracts.
- Regenerated all four paired PNGs with Java 8 and the existing PlantUML 1.2026.10beta1 JAR. The generated class and export sequence images were visually inspected; source and PNG files are present together under `diagrams/`.

## Phase 6 validation — full regression and live worksheet (2026-11-11)

- T036 passed from the repository root:
  - `npm run typecheck` — passed for frontend and backend.
  - `npm run test` — passed, exit code 0; backend Vitest 15 files / 84 tests passed; frontend Vitest reports no `tests/**/*.test.ts` files and exits successfully.
  - `npm run test:e2e` — passed, 27/27 Playwright E2E tests. It used an externally managed Vite server on an ephemeral loopback port with `PLAYWRIGHT_PORT`, matching `PLAYWRIGHT_TEST_ORIGIN`, and `PLAYWRIGHT_EXTERNAL_SERVER=1`; the server was started from `frontend/` and stopped after the run.
  - `npm run build` — passed; Vite production build and backend TypeScript build both completed.
  - `git diff --check` — passed.
- T038 live API PoC: `node --env-file=../.env --experimental-transform-types scripts/guided-notes-sheets-poc.ts` from `backend/` — `GUIDED_NOTES_SHEETS_POC=PASS`; 2 question IDs on a 1,000 × 26 grid; full-grid read 948 ms, RAW batch write 398 ms, invalid atomic batch rejection 377 ms, total PoC 3,896 ms. Four adjacent non-target cells were compared, and the scratch range—including target values and existing formula/content/format—was verified restored.
- Feature-level timing: after the successful root build, `node --env-file=../.env scripts/guided-notes-service-benchmark.mjs` from `backend/` exercised the real `GuidedNotesService` and Google adapter on the same disposable worksheet — PASS; 2 questions, 1,000 × 26 grid, import 945 ms, export 1,014 ms, and all scratch target values were verified restored. The benchmark refuses to write outside `GUIDED_NOTES_POC_SCRATCH_RANGE` and logs no sheet URL or credential.
- Both live runs used Windows PowerShell, Node v24.22.0, the Google Sheets API service account loaded from ignored `.env`, and no injected network delay or transient failure. No larger-than-1,000 × 26 grid was used, so no larger-grid latency is claimed. The separate fake-adapter integration tests verify preservation of non-target values, formulas, notes and formatting plus rejected, committed, unchanged and unconfirmed write outcomes.
- The first sandboxed live API attempt could not obtain an HTTP response due to the environment's network restriction and ended before any write; the same user-authorized disposable-sheet PoC then passed with network access. Neither failed attempt modified the worksheet.
- The Phase 6 regression and live-sheet checkpoints T036 and T038 passed. T039 converge is the remaining gate before PR preparation.

## Convergence validation (2026-11-11)

- T041–T043 closed the convergence findings: the import diagram now shows `SHEET_READ_FAILED` after retry exhaustion without Activity mutation; the export diagram routes ambiguous responses from any batch attempt to read-back, and shows timeout-before-read-back as unconfirmed; the plan lists the feature-level live benchmark and its build prerequisite.
- Regenerated the changed PlantUML PNGs with the existing Java 8-compatible PlantUML JAR. Visually inspected the updated export sequence diagram. `node --check backend/scripts/guided-notes-service-benchmark.mjs` and `git diff --check` passed.
- `$speckit-analyze` after convergence edits — no findings. Coverage: 17 FR + 8 buildable SC and 16 acceptance scenarios mapped to tasks; 43 task IDs; 100% requirement coverage; no constitution alignment issues, ambiguities, duplications, or unmapped tasks.
- Final `$speckit-converge` for `specs/002-guided-notes-import-export/` — converged with no remaining implementation or documentation tasks. No app source changed during convergence, so the Phase 6 typecheck, Vitest, E2E, build and live benchmark results above remain the current application evidence.
- T039 is complete. At the convergence checkpoint, T040 remained the PR submission/review gate; the PR submission and first review-correction cycle are now recorded below.


## PR #2 review correction validation (2026-11-11)

- Validation environment: Windows PowerShell, Node v24.22.0, npm 11.19.1.
- npm run typecheck — passed for frontend and backend.
- npm run test — passed; backend Vitest 15 files / 87 tests passed. Frontend Vitest found no configured tests/**/*.test.ts files and exited successfully.
- npm run test:e2e --workspace @speckit-buzzer/frontend -- --reporter=line — passed, 27/27 Playwright tests. The run used a local Vite server on loopback port 5187 with PLAYWRIGHT_PORT=5187, PLAYWRIGHT_TEST_ORIGIN=http://127.0.0.1:5187, and PLAYWRIGHT_EXTERNAL_SERVER=1; the server was stopped after the run.
- npm run build — passed; Vite production build and backend TypeScript build completed.
- git diff --check and PlantUML -checkonly for the updated import/export sequence diagrams — passed.
- The parser unit case confirms that duplicate labels on a row without both required headers and explanatory prose mentioning the labels are ignored when one valid candidate header row exists. The export integration case passes with the header on row 5, question IDs in column C, answers in column E, and adjacent values/notes unchanged.
- The delayed-write integration case confirms that expiry of the 10-second deadline returns SHEET_WRITE_UNCONFIRMED, does not cancel the pending batch, holds the operation lock until settlement, and allows the pending write to complete afterward. The Playwright error case checks the teacher-facing warning that the batch may already have applied or may still finish.
- The revised import and export sequence PNGs were regenerated with the Java 8-compatible PlantUML JAR and visually inspected.
- T044–T048 are complete. Review fixes were pushed to PR #2's original branch, the PR description now includes the Node 24 results and quickstart evidence, and mini-duan's follow-up review was requested. PR #2 remains open and unmerged while that review is pending.
