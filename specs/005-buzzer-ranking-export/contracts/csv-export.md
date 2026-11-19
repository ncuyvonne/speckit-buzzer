# Contract: Feature 005 CSV Export

## File format

- Encoding: UTF-8 with BOM (`EF BB BF` at the start of the file), so Windows Excel can display Traditional Chinese.
- Record separator: CRLF.
- Header order: `題號,組別,答案,搶答順位,是否搶答成功,送出時間`.
- Each row represents one accepted submission. Questions follow imported question order; submitted groups follow final rank order. Unsubmitted groups are omitted. A question with no submissions contributes no data row.
- `是否搶答成功` is `是` for rank 1 and `否` for every later rank.
- Single-question answers preserve the accepted answer. Group answers use ascending subquestion number and concatenate without extra separators, for example `（1）答案一（2）答案二`.
- `送出時間` is the server-local time derived from the accepted submission's `receivedAtMs`, formatted `YYYY-MM-DD HH:MM:SS.mmm`.
- Before CSV quoting, a data cell starting with `=`, `+`, `-`, `@`, their full-width variants `＝`, `＋`, `－`, `＠`, Tab, CR, or LF is prefixed with an apostrophe to reduce spreadsheet formula interpretation risk. The apostrophe is part of the exported cell value.
- Every field containing a comma, quote, CR, or LF is double-quoted; internal double quotes are doubled per CSV escaping rules. Formula-prefix handling occurs before this quoting.

## Authorization and timing

- Only an authenticated teacher can request the file, and only after the activity ends and its result is ready.
- Students do not receive the teacher CSV response.
- Export is read-only and does not change activity answers or worksheet data.
- Permission, phase, or result-readiness failures return a clear error and no partial CSV.
