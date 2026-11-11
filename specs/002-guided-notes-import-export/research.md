# Research: 002 Guided Notes 匯入與匯出（單題）

**Branch**: `codex-002-guided-notes-import-export`
**Date**: 2026-11-11

## Existing project decisions

- Feature 001 is already implemented with React, TypeScript, Vite, Node.js `ws`, Vitest and Playwright. Its plan chooses one in-memory Activity; restarting Node starts a new PREPARING activity. Feature 002 therefore uses in-memory worksheet/question metadata and does not add SQLite without a restart-recovery requirement.
- The live WebSocket connection owns the teacher role. Every reconnect requires password entry again. Guided Notes requests therefore use the existing WebSocket envelope and per-connection authorization rather than introducing browser credentials or a parallel session token.
- The current server binds to `127.0.0.1`; the browser already has a typed realtime client and Playwright fixtures that start a backend per scenario.

## Decisions

### 1. Keep Google Sheets access on the Node backend

**Decision**: Add a backend `GuidedNotesService` and an injected Google Sheets adapter. The React view sends the selected sheet reference and operation request through the existing WebSocket connection. The server checks the current connection role and Activity stage before invoking the service. The browser never receives Google credentials or API access tokens.

**Rationale**: This follows the component/import/export sequence diagrams and reuses 001's authentication boundary and message conventions. The server already owns shared activity state; it must also own the imported question list and the results used for export.

**Alternatives considered**: Calling Sheets API from React was rejected because it would expose credential handling to the browser and bypass the server's teacher/stage gates. New REST endpoints were rejected for this first version because authentication is attached to a live WebSocket connection and the diagrams already put UI operations through the SheetFlow component.

### 2. Store activity worksheet metadata in memory

**Decision**: Extend the current Activity state with the imported worksheet reference and ordered question IDs. Build a replacement import result off to the side and swap it into Activity only after the full source has been read and validated.

**Rationale**: 001 defines one process-local activity and no restart recovery. Keeping the same lifecycle avoids an extra persistence model and ensures a failed import cannot partially replace the active list.

**Alternatives considered**: SQLite would preserve questions across process restarts, but no such requirement exists and 001 explicitly resets the activity on restart. Introducing SQLite would create a persistence policy inconsistent with the existing feature.

### 3. Use an environment-configured service account for Sheets API v4

**Decision**: The backend parses `GOOGLE_SERVICE_ACCOUNT_JSON` from its environment and creates a Google API client with the spreadsheet scope. The `.env.example` names the setting without containing a credential; a developer's real `.env` remains ignored. Teachers share each workbook with the service-account email before import.

**Rationale**: Google distinguishes service accounts, which can access specifically shared documents, from OAuth client IDs that request end-user consent. A service account fits this local single-operator classroom project and the user's environment-variable requirement. Credential scope stays in Node, and workbook access is constrained by what was shared with that account.

**Alternatives considered**: OAuth user consent would access a teacher's own Google identity but adds a consent/redirect flow and refresh-token lifecycle. An API key only supports public data and is not appropriate for private classroom worksheets. If workbook sharing with a service account is unacceptable in the real classroom, this decision must be revisited before implementation.

### 4. Scan worksheet values and map by visible question IDs

**Decision**: Retrieve selected worksheet dimensions and its values, then scan the complete grid for the unique header row. Compare header labels after trimming surrounding whitespace. Request formatted values so IDs use the representation visible in the worksheet; ignore whitespace-only ID cells, preserve other ID text exactly, retain source order, and reject duplicates. Accept 1–100 valid IDs; reject zero or more than 100.

**Rationale**: The specification allows headers anywhere and variable column order, so fixed A1/column assumptions are invalid. The import sequence and class diagrams model one or more questions and the import sequence treats an empty effective question list as invalid. Google documents `FORMATTED_VALUE` as the default for values reads and permits reads of a specified A1 range.

**Alternatives considered**: `UNFORMATTED_VALUE` can normalize a displayed ID such as `001` to a numeric value and lose the representation the spec says to preserve. Scanning only the first row or a fixed column range conflicts with the diagrams/spec. A maximum scan rectangle is not imposed because the current requirement says any row/column; the 10-second goal must be checked against supplied classroom templates.

### 5. Use one atomic `values.batchUpdate` for every export target

**Decision**: Re-read the latest selected worksheet before each export, dynamically locate current rows/columns, validate every activity ID has exactly one target row, and construct all target cells before writing. Require an explicit Feature 003 provider result: `READY { answers }` (including a valid empty list) or `UNAVAILABLE`, which stops before any Sheets write. Use one `spreadsheets.values.batchUpdate` request with `valueInputOption=RAW`; write successful answers and set no-winner targets to `""` in the same request. Exclude every non-target cell. On an ambiguous transport outcome, read back targets: full intended state is success, full unchanged state is failure, and an unreadable or mixed result remains unconfirmed/invariant-failure rather than a success.

**Rationale**: Google documents batch value writes across multiple ranges and states that Sheets requests apply atomically; if an update request is invalid, none of its changes are applied. The values guide says an empty string clears a value, and `RAW` stores a string literally instead of interpreting input such as `=1+2` as a formula. Keeping clearing and writing in one request is necessary for all-or-none behavior and avoids changing formatting. The API interface used here does not provide compare-and-swap protection between the fresh scan and batch update, so simultaneous external edits to a target ID/cell remain an explicit race limitation.

**Alternatives considered**: Per-cell writes, or a separate write and clear call, were rejected because they split one logical operation into partially committed calls. `USER_ENTERED` was rejected because student-supplied answer text could be interpreted as a formula or date. The plan does not use a formatting update API.

### 6. Test the integration without live credentials in automated suites

**Decision**: Pure parsing, authorization, stage rules, import replacement, error mapping and batch construction use Vitest. A fake Sheets adapter is injected for backend integration and Playwright end-to-end scenarios. A separately documented manual PoC with a shared test sheet validates actual API auth, formatting, clearing, atomic rejection and latency before feature implementation proceeds.

**Rationale**: Automated tests remain deterministic and safe for local CI without private keys or modifications to a real classroom sheet. The manual PoC verifies the external service behavior that a fake cannot establish.

**Alternatives considered**: Requiring Google credentials in every test run was rejected because it leaks secrets into test setup, makes tests flaky, and risks modifying real sheets.

## Primary documentation

- [Google Sheets API `spreadsheets.values.batchUpdate`](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate) — multi-range value write request and `RAW`/formatted response parameters.
- [Google Sheets API read and write cell values](https://developers.google.com/workspace/sheets/api/guides/values) — range reads, formatted-value behavior, `RAW` literal values, clearing a value with an empty string, and batching related operations.
- [Google Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits) — atomic request behavior, request quotas, and retry guidance for time-based quota errors.
- [Google Workspace credential choices](https://developers.google.com/workspace/guides/create-credentials) — API key, OAuth client, and service account roles and use cases.
- [Google Workspace authentication overview](https://developers.google.com/workspace/guides/auth-overview) — credential, scope, consent and access-token concepts.
- [Vite environment variables and modes](https://vite.dev/guide/env-and-mode) — browser bundle exposure of `VITE_*` variables; Google secret configuration stays in Node.
- [Vitest environments](https://vitest.dev/guide/environment) and [Playwright fixtures](https://playwright.dev/docs/test-fixtures) — unit/integration and isolated browser test support.

## Validation not yet performed

No live Google Cloud project, service account, or test spreadsheet was supplied, so this research is documentation-based. The actual authenticated read/write PoC and all implementation tests remain pending and are explicitly required in `quickstart.md` before the implementation phase is accepted.
