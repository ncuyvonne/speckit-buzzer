# Data Model: 002 Guided Notes 匯入與匯出（單題）

## Activity

The one server-owned classroom activity defined by Feature 001, extended with the current Guided Notes source and questions.

| Field | Type | Validation / Rule |
|---|---|---|
| `stage` | `ActivityStage` | Existing server-owned `PREPARING`, `BUZZING`, or `ENDED` state; import is allowed only in `PREPARING`, export only in `ENDED`. |
| `worksheet` | `WorksheetReference \| null` | Null before a successful import. Set only after the entire import passes validation. |
| `questions` | `Question[]` | Empty before a successful import (count 0); after import, ordered by source row with 1–100 entries and unique, non-empty IDs. A failed import leaves the old value unchanged. |
| `winningResults` | `WinningResultsSnapshot` (provided by Feature 003) | Server-owned result availability and answers; never accepted from client payloads. `READY` with an empty answer list means no winners; `UNAVAILABLE` means the result source is not ready and MUST block export before any Sheets write. |

The Activity and worksheet association are held in process memory, matching Feature 001. Restarting the backend creates a new activity; Feature 002 does not recover the previous worksheet/question list.

## WorksheetReference

A server-side pointer to the selected spreadsheet and tab; it contains no credential or access token.

| Field | Type | Validation / Rule |
|---|---|---|
| `spreadsheetId` | `string` | Parsed and validated by the backend from a Google Sheets URL. Do not log the submitted URL or its query parameters. |
| `sheetId` | `number` | Google Sheets tab identifier resolved from metadata when the teacher selects the worksheet. |
| `worksheetTitle` | `string` | Exact selected tab title; used to rebuild quoted A1 ranges safely. |

## Question

A single activity question identified by the exact displayed question-number value read from the sheet.

| Field | Type | Validation / Rule |
|---|---|---|
| `questionId` | `string` | Read as `FORMATTED_VALUE`; whitespace-only cells are empty; other values are preserved exactly and compared case-sensitively. Unique within the selected worksheet and activity. |
| `displayOrder` | `number` | 1-based order among valid question rows from top to bottom. |
| `sourceRowAtImport` | `number` | 1-based source row for traceability only. Export must rediscover the row from the current worksheet and must not trust this saved coordinate. |

A blank row or row without a question ID is not a Question and never becomes an export target. The number of Questions is the displayed activity question count.

## WorksheetLayout (per-operation value)

A transient result of scanning one current worksheet. Do not save it as the authoritative future export mapping.

| Field | Type | Validation / Rule |
|---|---|---|
| `headerRowNumber` | `number` | 1-based row containing exactly one whole-cell, trimmed `題號` and one whole-cell, trimmed `作答` header. A candidate row contains both required labels; only one candidate row may exist. |
| `questionColumnNumber` | `number` | 1-based column of `題號`, discovered at runtime. |
| `answerColumnNumber` | `number` | 1-based column of `作答`, discovered at runtime. |
| `questionRows` | `Map<string, number>` | Maps each non-empty unique displayed question ID to its current 1-based row. On export this is rebuilt from the latest read. |

Header comparison trims only surrounding whitespace and otherwise requires the exact configured Chinese titles. Text that merely mentions a title is not a label. Rows that contain only one required title are not candidates, even if that title appears more than once. A candidate row with duplicate required titles, missing headers, or multiple candidate rows is invalid.

## WinningAnswer

The result supplied by the server-side buzzer domain after Feature 003 has selected a successful group.

| Field | Type | Validation / Rule |
|---|---|---|
| `questionId` | `string` | Must match one imported Activity question. |
| `groupId` | `string` | Winning group selected by the server. |
| `answerText` | `string` | Exact answer submitted by the winning group; written as a literal value (`RAW`). |

No winner means no `WinningAnswer` for the question; export still includes that question's answer cell with an empty string to clear it.

## WinningResultsSnapshot

An explicit server-side boundary for results produced by Feature 003. An empty answer list is authoritative only when its status is `READY`.

The production composition root uses `BuzzerWinningResultsProvider` by default. `UnavailableWinningResultsProvider` remains available only as an explicitly injected fallback for tests or an intentionally unavailable result source; it must not replace the production default or an authoritative empty `READY` snapshot.

| Variant | Type | Rule |
|---|---|---|
| Available | `{ status: "READY"; answers: WinningAnswer[] }` | The result provider has completed; an empty `answers` list means no Activity question has a winner. |
| Unavailable | `{ status: "UNAVAILABLE"; reason?: "NOT_READY" }` | Results cannot yet be read authoritatively. Export fails with `WINNING_RESULTS_UNAVAILABLE` before calling the Sheets write operation; it MUST NOT clear answer cells. |

## GuidedNotesOperation

A transient request and outcome for a teacher-triggered import or export.

| Field | Type | Validation / Rule |
|---|---|---|
| `requestId` | `string` | Existing WebSocket request ID (1–64 ASCII letters, digits, `_` or `-`); used to correlate one response. |
| `operationType` | `IMPORT \| EXPORT` | Import or export flow. |
| `status` | `PENDING \| SUCCEEDED \| FAILED \| UNCONFIRMED` | Server-owned. UI reports completion only for `SUCCEEDED`; uncertain network outcomes are not mislabeled successful. If the deadline expires while a write remains pending, the request may still apply after the `UNCONFIRMED` response. |
| `writtenCellCount` | `number` | Export result count when known, including cleared target cells if the API response confirms them. |
| `clearedCellCount` | `number` | Export count of questions without a winning answer. |

Only one external Guided Notes operation may be active at a time in the single-process activity. After a write deadline response, keep the operation lock until the original write request settles. Operation details are not durable records and must not contain credentials or raw Google API error payloads.

## Relationships and lifecycle

- One Activity references zero or one selected Worksheet and owns an ordered Question list; the initial/unimported state is `worksheet = null`, `questions = []`, and count 0.
- Each Question maps to exactly one current row after a successful worksheet scan.
- A Question has zero or one WinningAnswer when `winningResults.status` is `READY`; Feature 002 does not judge correctness. `UNAVAILABLE` is never interpreted as zero winners.
- An import reads and validates into a temporary candidate, then replaces `worksheet` and `questions` together. Any failure leaves the previous Activity values intact.
- An export takes all Activity questions and server results, validates every target before sending one Google batch update, and changes no non-target cells.
- If the Activity has no imported WorksheetReference, export returns `WORKSHEET_NOT_IMPORTED` before calling the results provider or Sheets adapter.
