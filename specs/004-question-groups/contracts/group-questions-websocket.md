# Group Questions WebSocket Contract

## Boundary and authorization

This contract extends the existing Feature 001 WebSocket envelope and Features 002/003 messages. It reuses `/ws`, request IDs, the origin check, the 16 KiB incoming-message cap, reconnect authentication, server-owned activity stage, and existing error envelope.

- Only an authenticated teacher may import while the server activity is `PREPARING` or export after it is `ENDED`.
- Only an authenticated student connection with a valid server-associated group may submit while `BUZZING`.
- The client sends a question ID and answer text/vector only. It cannot select a different group, stage, winner, accepted time, rank, or worksheet coordinate.
- The server validates question kind, expected answer count, placeholder indices, nonblank text, stage, and the group's one-submission rule before recording any part of a vector.
- A valid complete vector is accepted as one operation. An incomplete or malformed vector creates no submission, lock, or winner candidate.

## Question layout summary

After import, teacher snapshots/import responses and the student question list expose the ordered question shape needed to render the appropriate number of answer fields. Existing `questionIds` and `questionCount` remain available for current views.

```json
{
  "questionIds": ["1", "2", "3"],
  "questionCount": 3,
  "questionLayouts": [
    { "questionId": "1", "kind": "SINGLE", "answerCount": 1 },
    { "questionId": "2", "kind": "GROUP", "answerCount": 2 },
    { "questionId": "3", "kind": "GROUP", "answerCount": 4 }
  ]
}
```

The student view receives question ID, kind, and answer count only. It does not receive the teacher's spreadsheet reference or any other group's submission.

## Student submission

Single questions keep the existing one-text submission shape:

```json
{
  "type": "buzzerResults.submitAnswer",
  "requestId": "answer-1",
  "payload": { "questionId": "1", "answerText": "答案" }
}
```

Grouped questions submit all numbered child answers in one message:

```json
{
  "type": "buzzerResults.submitAnswer",
  "requestId": "123e4567-e89b-12d3-a456-426614174000",
  "payload": {
    "questionId": "2",
    "subAnswers": [
      { "placeholderNumber": 1, "answerText": "第一格答案" },
      { "placeholderNumber": 2, "answerText": "第二格答案" }
    ]
  }
}
```

The server requires exactly the imported set of placeholder numbers, with each number present once and every answer containing a non-whitespace character. The received order is assigned by the server only after validation. The first accepted complete vector for a group/question pair locks the pair; a later request cannot overwrite it.

## Server projections

All answer vectors use `{ placeholderNumber, answerText }[]`. A single-question result is represented as one answer at slot 1 so projections have one stable shape.

- **Teacher progress**: per question, each configured group's `submitted` state and complete `answers` vector, plus the winning group and full winning vector. Teacher-only.
- **Student own progress during `BUZZING`**: each question's own `submitted`, `locked`, and `answers`. No winner, rank, or other group fields.
- **Student results after `ENDED`**: winning group/vector and the requesting group's own status/vector. No other non-winning group's answer or submission status.
- **Same-group updates**: after an accepted vector, all online students connected to that group receive the updated own-progress projection.
- **Reconnect**: after the normal role rejoin, reconstruct the question layout, own submissions and lock state from the server. ENDED students receive only the same own/winner projection allowed before reconnect.

Example student own-progress entry:

```json
{
  "questionId": "2",
  "submitted": true,
  "locked": true,
  "answers": [
    { "placeholderNumber": 1, "answerText": "第一格答案" },
    { "placeholderNumber": 2, "answerText": "第二格答案" }
  ]
}
```

## Errors

Use the existing error envelope and stable codes:

| Code | When returned | State effect |
|---|---|---|
| `GROUP_ANSWER_INCOMPLETE` | A group vector omits a required slot or contains a blank/whitespace-only answer. The message names missing/empty slot numbers. | No answer, lock, or rank is recorded. |
| `GROUP_ANSWER_INVALID` | A group vector contains an extra, duplicate, out-of-range, or otherwise invalid placeholder number, or its shape does not match the imported question kind. | No answer, lock, or rank is recorded. |
| `ANSWER_EMPTY` | A single-question answer is empty or whitespace-only. | No answer, lock, or rank is recorded. |
| `ANSWER_LOCKED` | This group already has an accepted submission for the question. | The original complete vector and winner remain unchanged. |
| `QUESTION_INVALID` | The question ID is not in the current activity. | No answer or result is recorded. |
| `STAGE_CONFLICT` / `GROUP_INVALID` / `AUTH_REQUIRED` | Existing phase, group, or role checks fail. | No answer or result is recorded. |

Errors use Traditional Chinese actionable messages and do not expose spreadsheet URLs, credentials, or another group's answers.

`GROUP_ANSWER_TOO_LARGE` is a local browser error for a submission over 16,384 bytes. Keep all draft answers editable, show a shortening hint, and leave pending, accepted, lock and rank state unchanged. The user can shorten the draft and submit again.

## Size, ordering, and compatibility

- A group has 2–20 slots. The byte limit is **16,384 inclusive**, measured on the complete compact JSON request encoded as UTF-8. It includes escaped text, the envelope, request ID, question ID and child indices.
- The browser group path uses a fixed **36-byte ASCII** request ID (including its fallback path). Serialize once, count with `TextEncoder`, then send the measured string if it fits. Create a pending request only when it is sent. Keep the existing server request ID grammar and the existing single-question client path.
- During import the backend uses the same group envelope shape and a representative 36-byte ASCII ID. It counts the compact JSON with the real displayed question ID, every ordered slot and `a` in each `answerText`. Reject the worksheet atomically if the minimum is over 16,384 bytes.
- The server keeps the existing 16 KiB transport and decoder caps. A direct oversized message that bypasses the browser never reaches submission processing. The WebSocket transport can close with 1009 before request parsing, so a correlated error reply is only possible if the message reaches the decoder.
- The backend assigns a monotonically increasing received order after full validation. The first accepted complete vector per question wins; received-order resolves equal server timestamp precision.
- The existing single-answer field remains supported for single questions. Grouped question messages use `subAnswers`; the two shapes are not interchangeable.
- No new HTTP route, authentication flow, or client-side authority is introduced.
