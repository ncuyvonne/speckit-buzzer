# Google Sheets Integration Boundary

## Ownership boundary

Only `backend/src/integrations/google-sheets/` calls Google. It receives a validated spreadsheet ID and selected worksheet identity from `GuidedNotesService`; it never receives a browser credential. It returns typed worksheet metadata/values or a normalized integration error. Google-specific error text and response bodies do not escape this boundary.

## Authentication

- Read `GOOGLE_SERVICE_ACCOUNT_JSON` only in the backend process environment and parse it as a service-account credential object.
- Create the Sheets API v4 client with `https://www.googleapis.com/auth/spreadsheets` scope, which is needed for the feature's read and write operations.
- The owner shares each classroom spreadsheet with the service account's `client_email`. The application does not request a teacher Google OAuth token.
- Keep real credentials in ignored local `.env` or the execution environment. `.env.example` contains no usable key. Never place this variable in `VITE_*`, WebSocket messages, UI state, screenshots, errors or logs.

## Read contract

1. Resolve the selected tab by its exact title from spreadsheet metadata; retain `sheetId` and `title` as the worksheet reference.
2. Obtain the current grid row/column dimensions and read that grid from the selected tab using A1 notation. Quote the worksheet title and escape embedded apostrophes when constructing a range.
3. Read with `valueRenderOption=FORMATTED_VALUE` and rows as the major dimension. The parser searches the returned grid for exactly one row that contains one `題號` and one `作答` header after trimming surrounding whitespace.
4. Preserve each non-whitespace question ID as the exact displayed string and its source order. Ignore blank rows and rows with no question ID. Reject duplicate IDs, zero valid questions and more than 100 questions.
5. At export, repeat metadata/value reads; never trust row/column positions from a prior import.

## Write contract

- Map each current Activity question ID to exactly one current worksheet row. If any target is absent or duplicated, reject before write.
- Build one `spreadsheets.values.batchUpdate` request whose `data` contains exactly one answer-cell range per Activity question. Use `valueInputOption=RAW` so answer strings are stored literally, including strings beginning with `=`. Use an empty string for a no-winner cell so the prior cell value is cleared.
- Do not send `batchClear` separately and do not update the whole answer column. The request contains no non-target cells; no formatting operation is used.
- A confirmed API rejection means the atomic batch has not been applied. If the transport result is ambiguous, read back all target values: report success only when the full intended result is confirmed, report failure only when all targets are confirmed unchanged, and otherwise return `SHEET_WRITE_UNCONFIRMED`. A mixed read-back violates the atomicity invariant and must be surfaced for investigation, not treated as success or safely retried.
- Retry only idempotent reads or write rejections explicitly classified as not applied. Allow at most two retries per request, with 250 ms then 500 ms exponential delays, always within a 10-second end-to-end operation deadline. Do not retry an ambiguous write before read-back; after an ambiguous write, return confirmed success only for a full intended read-back, confirmed failure only for a full unchanged read-back, and `SHEET_WRITE_UNCONFIRMED` otherwise. If the deadline expires while a write request remains pending, return `SHEET_WRITE_UNCONFIRMED`; the deadline does not cancel the request, which may finish after the response. The service retains its operation lock until that request settles.

## API call budget and limits

A typical import needs one metadata read and one values read. An export needs a fresh metadata read, values read and one multi-range values batch update (plus a read-back only when needed to resolve an ambiguous response). Google counts a batch call as one request for quota purposes and recommends combining related reads/writes. The API documents atomic application of Sheets requests; if an update is invalid, none of its dependent changes are applied. SC-006's repeatable benchmark profile uses a worksheet grid no larger than 1,000 rows × 26 columns, at most 100 question IDs, no quota/transient API error, and no injected network delay. This is a benchmark fixture, not a product scan limit: dynamic discovery must still scan other worksheet dimensions and their elapsed time must be recorded.

## Adapter test seam

`GoogleSheetsAdapter` exposes typed operations for resolving a worksheet, reading its values, and applying a batch of target cell values. `GuidedNotesService` receives the adapter through construction so unit/integration/E2E tests can inject an in-memory fake that records ranges, preserves non-target values/formulas/notes/formatting, and can simulate a definite rejection, a lost response with full commit, a lost response with no commit, and an unavailable read-back. This interface also provides an injectable Feature 003 winning-results provider; `READY` with an empty list differs from `UNAVAILABLE`.
