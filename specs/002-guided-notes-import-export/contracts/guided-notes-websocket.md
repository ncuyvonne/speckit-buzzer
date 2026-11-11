# Guided Notes WebSocket Contract

## Connection and authorization

This contract extends [Feature 001's realtime WebSocket contract](../../001-role-phase-sync/contracts/realtime-websocket.md). It reuses `/ws`, the existing JSON envelope, request ID rules, Origin check, 16 KiB incoming message limit, live per-connection teacher role, and fixed error envelope.

- Every new connection starts unauthenticated. A teacher must authenticate again after reconnect, per Feature 001.
- The server checks teacher role before operation validation. Unauthenticated or student connections receive `AUTH_REQUIRED`; no Google API call is made.
- `guidedNotes.import` is accepted only while server Activity is `PREPARING`.
- `guidedNotes.export` is accepted only while server Activity is `ENDED`.
- The client does not supply current stage, question IDs, winning group, answer text, spreadsheet ID outside the import reference, or Google credentials as authoritative state. The server derives activity and results.
- The activity snapshot containing question IDs and selected worksheet title is sent only to the authenticated teacher after authentication. Student snapshots do not expose the teacher's source reference.

## Client-to-server messages

### `guidedNotes.import`

```json
{
  "type": "guidedNotes.import",
  "requestId": "gn-import-1",
  "payload": {
    "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/<id>/edit",
    "worksheetTitle": "工作表1"
  }
}
```

The backend validates the URL shape and tab title, obtains sheet metadata and values, discovers a unique header row, validates 1–100 unique non-empty IDs, and constructs a candidate import. Only a completely valid candidate replaces the Activity's prior worksheet and question list.

### `guidedNotes.export`

```json
{
  "type": "guidedNotes.export",
  "requestId": "gn-export-1",
  "payload": {}
}
```

The backend obtains the saved worksheet reference and current server-side activity questions/results. It re-reads the latest worksheet and resolves targets by question ID before issuing one atomic batch write. The client cannot send alternative answers or target coordinates.

## Server-to-client messages

### `guidedNotes.imported`

```json
{
  "type": "guidedNotes.imported",
  "requestId": "gn-import-1",
  "payload": {
    "worksheetTitle": "工作表1",
    "questionIds": ["1", "2", "4"],
    "questionCount": 3
  }
}
```

Sent only after the Activity worksheet reference and full ordered question list have been replaced. The count is computed by the server.

### `guidedNotes.snapshot`

```json
{
  "type": "guidedNotes.snapshot",
  "payload": {
    "worksheetTitle": null,
    "questionIds": [],
    "questionCount": 0
  }
}
```

Sent to the authenticated teacher after login so a reconnecting teacher can see the server's current in-memory import. Before the first successful import, `worksheetTitle` is `null`, `questionIds` is empty, and `questionCount` is zero. It contains no Google credentials, full URL, or question descriptions.

### `guidedNotes.exported`

```json
{
  "type": "guidedNotes.exported",
  "requestId": "gn-export-1",
  "payload": {
    "writtenCellCount": 3,
    "clearedCellCount": 1
  }
}
```

Sent only after Google confirms the atomic request succeeded, or after a read-back confirms the intended values after a lost response. A missing confirmation never produces a success event.

## Errors

Errors use the Feature 001 envelope: `{"type":"error","requestId":"...","payload":{"code":"...","message":"..."}}`. Add these stable codes to the existing error union:

| Code | Meaning and user action |
|---|---|
| `SHEETS_NOT_CONFIGURED` | Backend credential environment variable is absent or invalid; check local setup. |
| `SHEET_REFERENCE_INVALID` | URL is not a supported Google Sheets URL; copy the worksheet URL again. |
| `SHEET_ACCESS_DENIED` | The spreadsheet is not shared with the configured service account or read/write permission is missing; check sharing. |
| `SHEET_NOT_FOUND` | Spreadsheet or selected worksheet cannot be found; check URL and tab title. |
| `SHEET_LAYOUT_INVALID` | Required headers are missing, duplicated, or ambiguous; keep one shared header row with one of each exact title. |
| `QUESTION_IDS_INVALID` | No valid IDs, duplicate IDs, or more than 100 IDs; repair the question-number column. Duplicate-ID details identify the duplicated displayed IDs and their source row numbers. |
| `QUESTION_TARGET_INVALID` | An Activity question is missing or no longer unique in the current worksheet; restore a unique matching row before retrying. |
| `WORKSHEET_NOT_IMPORTED` | The Activity has no successfully imported worksheet; import one during PREPARING before exporting. The server rejects before calling the results provider or Google Sheets adapter. |
| `WINNING_RESULTS_UNAVAILABLE` | Feature 003 has not made an authoritative results snapshot available; wait until results are ready and retry. No Sheets write is attempted and no target cell is cleared. |
| `SHEET_READ_FAILED` | Temporary or unclassified read failure; check access/network and retry. |
| `SHEET_WRITE_FAILED` | Google definitively rejected the batch; the atomic request made no changes; inspect permissions/protected cells and retry. |
| `SHEET_WRITE_UNCONFIRMED` | The response was lost and a read-back could not determine whether the atomic batch applied; inspect the sheet before deciding whether to retry. |
| `GUIDED_NOTES_BUSY` | Another import/write is running; wait for it to finish before retrying. |

Messages are in Traditional Chinese, actionable, and do not include access credentials, raw Google response bodies, or the submitted URL. Logs may include request ID, operation type, and normalized error category only.

## State and failure guarantees

- Import is valid only in PREPARING and export only in ENDED. Invalid role/stage requests are rejected before contacting Google.
- Import commits its new worksheet/questions only after full parse and validation. Read, layout, count, or duplicate-ID failures leave the current Activity list and worksheet association unchanged.
- Export first requires an imported worksheet reference. If it is absent, return `WORKSHEET_NOT_IMPORTED` before calling the results provider or Sheets adapter. Otherwise export requires Feature 003 to return `READY { answers }`; `READY` with `answers: []` is authoritative no-winner data, while `UNAVAILABLE` fails before any Sheets write. Export re-discovers the header row, columns and question-ID rows from the latest sheet. For every Activity question ID, there must be exactly one current row. Additional worksheet IDs outside the current Activity are ignored and never modified.
- All winning answers and no-winner clears are represented in one batch request. Missing/duplicate target rows prevent the request from being sent. Only target `作答` cells are included.
- A definitive Google batch rejection means no spreadsheet changes. If the response is lost, the single atomic request may have applied in full or not at all; read back all target cells. Report success only when the full intended result is confirmed, report failure only when all targets are confirmed unchanged, and otherwise report `SHEET_WRITE_UNCONFIRMED`. A mixed state is an invariant violation to report and investigate, never claim as a successful or safely retriable batch.
- Rejected imports do not change server Activity. Errors must not imply that an ambiguous write definitely changed or definitely left the sheet unchanged. The adapter does not provide compare-and-swap protection against an external editor changing target values between the pre-write read and batch request; this limitation is documented in the plan.
