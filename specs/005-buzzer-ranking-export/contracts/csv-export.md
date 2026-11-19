# Contract: Feature 005 CSV Export

## File format

- Encoding: UTF-8 with BOM (`EF BB BF` at the start of the file), so Windows Excel directly displays Traditional Chinese.
- Record separator: CRLF.
- Header order: `題號,成功組別,成功答案,組別,組別答案,搶答順位`.
- Each row represents one question and one configured group. Question rows follow the imported question order; submitted groups follow rank order; unsubmitted groups follow submitted rows.
- The successful group and successful answer are repeated on each row for that question. If no group submitted, these fields are empty.
- An unsubmitted group's answer and rank are empty. It still has a row.
- A question group is rendered in the single `組別答案` cell in ascending subquestion order, with the corresponding subquestion labels.
- Every field containing a comma, quote, CR, or LF is double-quoted; internal double quotes are doubled per CSV escaping rules.

## Authorization and timing

- Only an authenticated teacher can request the file, and only after the activity ends and its result is ready.
- Students do not receive the teacher CSV response.
- Export is read-only and does not change activity answers or worksheet data.
- Permission, phase, or result-readiness failures return a clear error and no partial CSV.
