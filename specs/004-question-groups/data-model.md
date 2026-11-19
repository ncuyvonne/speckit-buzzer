# Data Model: 004 題組與多填空

## Activity

The existing single server-owned classroom activity. Feature 004 extends its imported question definitions; it does not create another activity, stage, or result owner.

| Field | Type | Validation / Rule |
|---|---|---|
| `stage` | `PREPARING \| BUZZING \| ENDED` | Existing server-owned state. Import is allowed only in `PREPARING`; submissions only in `BUZZING`; export only in `ENDED`. |
| `worksheet` | `WorksheetReference \| null` | Set together with the fully validated question list. |
| `questions` | `Question[]` | Ordered by the source sheet. Contains 1–100 unique top-level question IDs; child rows do not increase this count. |
| `exportAnchorState` | `NONE \| PREPARED \| CONFIRMED` | PREPARED carries the first-attempt manifest during a write and while its outcome is uncertain. CONFIRMED carries it after success or matching read-back. NONE has no manifest. Activity replacement clears the state. |

Activity, worksheet association, submissions, and winners remain in process memory. A backend restart begins a new activity and does not restore previous results.

## WorksheetReference

The server-side pointer to the selected Google spreadsheet and worksheet tab; it contains no credential or access token.

| Field | Type | Validation / Rule |
|---|---|---|
| `spreadsheetId` | `string` | Parsed and validated from the teacher's selected spreadsheet reference. Never sent to students or written to logs. |
| `sheetId` | `number` | Resolved by the server from worksheet metadata. |
| `worksheetTitle` | `string` | Exact selected tab title. |

## Question

An ordered union of a single-answer question and a grouped question.

| Field | Type | Validation / Rule |
|---|---|---|
| `questionId` | `string` | Exact non-empty displayed question-number value; unique within the imported worksheet and activity. |
| `displayOrder` | `number` | 1-based order of top-level questions from top to bottom. |
| `kind` | `SINGLE \| GROUP` | `SINGLE` has one answer slot. `GROUP` has 2–20 numbered slots. |
| `answerSlots` | `AnswerSlot[]` | A single question has one logical slot. Each group has its own contiguous sequence from 1 through its slot count. Its smallest encoded browser request with a single `a` per slot fits in 16,384 bytes. |
| `sourceRowAtImport` | `number` | 1-based traceability only. First export must rediscover the live worksheet positions; this import coordinate is not authoritative after sheet edits. |

The `answerSlots` shape is server-owned and is summarized to clients as question ID, kind, and answer count. Question descriptions, full worksheet contents, and answer-key data are not imported.

## AnswerSlot

One answer position within a top-level question.

| Field | Type | Validation / Rule |
|---|---|---|
| `placeholderNumber` | `number` | 1-based. Group slots must be contiguous and unique. A single question uses slot 1 without a worksheet marker. |
| `sourceRowAtImport` | `number` | Source row for traceability. During initial import, the group marker must occupy the answer cell on this row; its coordinate is not used as the sole first-export locator. |

For grouped questions, slot 1 is on the row that contains the question ID; later slots occupy consecutive rows whose question-number cells are blank. Each marker is the full-width form `（n）` and occupies its answer cell by itself.

## AcceptedSubmission

Shared server-owned identity and ordering fields for an accepted submission. Each active group/question pair has at most one accepted submission.

| Field | Type | Validation / Rule |
|---|---|---|
| `groupId` | `string` | Derived from the authenticated student's server connection and validated against the current roster. |
| `questionId` | `string` | Must match one imported question. |
| `receivedOrder` | `number` | Server-assigned monotonically increasing order for accepted submissions; determines the winner and exact-time ties. |
| `receivedAt` | `number` | Server time for the accepted complete submission; client time is never accepted as authority. |
| `locked` | `boolean` | `true` after a complete valid submission is accepted. No partial answer is stored or locked. |

**Identity and uniqueness**: `(groupId, questionId)` is unique for the active session. Validate and insert the complete single answer or group vector as one synchronous server operation. A partial or invalid vector does not consume the group's one-submission allowance.

## SingleSubmission

The existing single-answer submission shape. It extends AcceptedSubmission and retains one text field.

| Field | Type | Validation / Rule |
|---|---|---|
| `answerText` | `string` | Must contain a non-whitespace character; exact submitted text is preserved. |

## GroupSubmission

A complete answer vector for a GROUP question. It extends AcceptedSubmission.

| Field | Type | Validation / Rule |
|---|---|---|
| `answers` | `SubAnswer[]` | Exactly one answer for every expected slot (2–20), ordered by placeholder number. All entries must contain a non-whitespace character; original answer text is preserved. |

## SubAnswer

| Field | Type | Validation / Rule |
|---|---|---|
| `placeholderNumber` | `number` | Must match exactly one expected slot; no duplicates, omissions, or extras. |
| `answerText` | `string` | Must contain a non-whitespace character; exact submitted text is preserved. |

Every grouped answer slot has one entry. Single submissions retain their legacy text shape and are normalized to slot 1 when creating result projections or worksheet export targets.
## WinningResult

The server-derived result for one top-level question.

| Field | Type | Validation / Rule |
|---|---|---|
| `questionId` | `string` | One imported activity question. |
| `groupId` | `string` | Group on the first accepted complete submission. |
| `answers` | `SubAnswer[]` | One normalized slot for `SINGLE`; the full winning vector for `GROUP`, never a per-child winner. |
| `receivedOrder` | `number` | The lowest server-assigned accepted order for that question. |

The feature does not judge answer correctness or score child answers independently.

## Role-specific projections

- **Teacher question progress**: every group’s submitted state and complete answer vector, plus the current winning group and winning vector. Sent only to an authenticated teacher.
- **Student own progress**: the student's group vector and lock state only. While `BUZZING`, it contains no other group status, answer, or winner.
- **Student result**: after `ENDED`, the winning vector and the requesting group's vector/status only. It contains no other non-winning group's answers.
- **Question layout summary**: ordered question IDs, `SINGLE`/`GROUP` kind, and answer count. Students may receive this structure to render their answer fields, but never receive the teacher's worksheet reference.

## WorksheetLayout (per operation)

A fresh result of scanning the current selected worksheet. Header discovery and worksheet access follow Feature 002.

| Field | Type | Validation / Rule |
|---|---|---|
| `headerRowNumber` | `number` | Unique current header row containing exactly one `題號` and one `作答` title. |
| `questionColumnNumber` | `number` | Dynamically discovered current column. |
| `answerColumnNumber` | `number` | Dynamically discovered current column. |
| `questionRows` | `Map<string, number>` | Each activity question ID must resolve to exactly one current row. |
| `slotRows` | `Map<string, number[]>` | First export maps a group to current numbered marker rows and verifies the imported kind and count. Repeat export validates the manifest's original rows against the live snapshot. |

The first export rejects missing/duplicate markers or question IDs before writing. On repeat export the original mapping is corroborated by live dimension anchors, question structure and exact coordinates. Target values from a confirmed export do not determine cell identity.

## ExportManifest

The backend holds one manifest for the first export in the current activity.

| Field | Type | Validation / Rule |
|---|---|---|
| `worksheet` | `WorksheetReference` | Matches the active spreadsheet and numeric sheet ID. |
| `header` | `{ row, questionColumn, answerColumn }` | Original coordinates of the unique header and its named columns. |
| `targets` | `ExportTarget[]` | Exactly one original coordinate for every imported question/slot pair, including clears. |
| `anchors` | `DimensionAnchor[]` | Exactly one anchor per distinct target row, header row, question column and answer column. Every Feature 004 export anchor uses PROJECT visibility and the stable developer metadata key `sb004`. Each holds the expected positive Sheets metadata ID, application key, compact attempt token, dimension, sheet ID and coordinate. |

Each `ExportTarget` keeps the exact `questionId`, logical slot, original row and answer column, canonical JSON for the cell's exact `userEnteredValue` (null when absent), and intended literal string or clear. Displayed values remain separate for parsing IDs, headers, and markers. The exact raw prewrite value and intended value reconcile a PREPARED first-write attempt; after confirmation, later target-cell value edits do not invalidate identity and are overwritten on repeat export. Dimension anchors are PROJECT metadata created with the first write. Compare ID, key, token, dimension and location on read. Anchor data and the manifest are backend-only. Worksheet anchor entries persist independently of the in-memory activity and have no saved answers. Before importing a worksheet for a new activity, the service searches `metadataKey=sb004` and `visibility=PROJECT`, then matches row/column locations to the selected numeric `sheetId`; a match rejects the import so an already-exported worksheet cannot be mistaken for an original template after activity state is reset.

## GuidedNotesOperation

The existing transient teacher-triggered import/export operation. It continues to serialize external Sheets operations, enforce the 10-second deadline, and distinguish confirmed success, confirmed failure, and unconfirmed outcomes. After an uncertain confirmed repeat, the service privately holds the repeat's prewrite and intended target values while `Activity.exportAnchorState` remains `CONFIRMED`; a later request revalidates the existing anchors and reconciles the target values before any new batch. This pending repeat is neither sent to clients nor stored as a new first-export manifest. The operation contains no credential, raw Google response, or durable activity record.

## Relationships and lifecycle

- One Activity has one selected worksheet and an ordered set of 1–100 top-level Questions after import.
- A `SINGLE` Question has one logical AnswerSlot. A `GROUP` Question has 2–20 ordered AnswerSlots.
- One AcceptedSubmission covers exactly one Question and one group. A SINGLE submission contains slot 1; a GROUP submission contains every expected SubAnswer.
- One Question has zero or one WinningResult, derived from the earliest accepted complete AcceptedSubmission.
- A valid import is parsed into a temporary candidate and replaces the current worksheet/question structure only after every header, ID, marker, and count check passes.
- An invalid or partial answer vector creates no submission, lock, or rank. An accepted complete vector is immutable for that group/question pair.
- First export re-reads the worksheet, validates current markers and records a PREPARED manifest before dispatch. One `spreadsheets.batchUpdate` writes all targets and creates all anchors atomically.
- PREPARED becomes CONFIRMED after the initial batch is acknowledged or a read-back matches all anchors, mappings and intended target values. If read-back proves non-application, clear PREPARED only after revalidating the original markers; a later export request may start a fresh first attempt. If evidence is inconclusive or partial, keep PREPARED and return the existing unconfirmed status without another write.
- A repeat export uses the confirmed manifest's original coordinates once all anchor locations, live headers, question IDs and slot relationships agree. Current target values may differ; the repeat writes the latest confirmed results to those verified original cells. Missing or altered identity evidence prevents the write. A new activity uses an original or unexported worksheet.
- Feature 004 export anchors use PROJECT metadata key `sb004`; a new import rejects the selected worksheet when a row/column anchor matches its numeric sheet ID before changing the current Activity. Other keys, tabs, and location types are ignored.
