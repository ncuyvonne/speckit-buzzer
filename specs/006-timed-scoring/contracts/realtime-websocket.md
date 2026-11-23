# WebSocket Contract: 006 計時搶答與計分板

本契約延伸既有 JSON WebSocket envelope、`requestId`、`activity.snapshot`、`activity.phaseChanged`、`buzzerResults.ownProgress`、`buzzerResults.teacherProgress`、`buzzerResults.studentResults` 及錯誤 envelope。URL、傳輸上限、老師認證、學生組別加入和 Google Sheets API 契約不變。

## Common envelope

用戶端命令沿用：

```json
{"type":"<command>","requestId":"<id>","payload":{}}
```

伺服器錯誤沿用既有 `error` 訊息與 `requestId`／錯誤碼／可讀說明。所有新的操作都在 handler 由已認證連線角色推導權限；不接受 payload 內的 role、groupId、server time、winner、score 或 correctness result。

## Role and phase matrix

| 操作 | 角色 | 活動階段 | 行為 |
|---|---|---|---|
| 設定時限 | TEACHER | PREPARING | 接受整數 0–3600；其他值拒絕且不變更設定。 |
| 開始搶答 | TEACHER | PREPARING | 使用現行時限轉入 BUZZING；正值開始倒數。 |
| 提交答案 | STUDENT 且有效組別 | BUZZING 且 `receivedAt < deadlineAt`（如有 deadline） | 沿用每組每題一次、首筆有效提交獲勝規則。 |
| 標記正誤 | TEACHER | ENDED 且題目有 winner | 新增／取代／取消該題唯一判定。 |
| 讀取計分板 | TEACHER 或已加入組別的 STUDENT | ENDED | 回傳全組排名、得分及成功題數。 |
| 重設活動 | TEACHER | ENDED，且 UI 已顯示確認後 | 保留目前 worksheet/questions，清除本場作答及計分，回 PREPARING 並將時限歸零。 |

權限或階段不符時沿用 `AUTH_REQUIRED`、`STAGE_CONFLICT` 等錯誤；拒絕時不修改答案、標記、排名或時限。

## Client commands

### `activity.setTimeLimit`

```json
{"type":"activity.setTimeLimit","requestId":"r1","payload":{"seconds":30}}
```

只允許已認證老師在 PREPARING 使用。`seconds` 必須是整數 0–3600；伺服器成功時回傳 `activity.timeLimitSet` 與新值。0 表示不限時。無效值使用 `TIME_LIMIT_INVALID`，不得改變現有值。

### `buzzerResults.submitAnswer`（沿用並增加截止規則）

```json
{"type":"buzzerResults.submitAnswer","requestId":"r2","payload":{"questionId":"Q1","answerText":"答案"}}
```

只有學生連線可呼叫；組別從已加入連線取得。後端在同步接受路徑取樣一次 `receivedAt`；`receivedAt >= deadlineAt` 一律以 `ANSWER_TIMED_OUT` 拒絕，且不能消耗鎖定或勝出順位。若後端已轉入 ENDED，使用 `STAGE_CONFLICT` 拒絕。用戶端時間欄位不接受。

### `buzzerResults.markCorrectness`

```json
{"type":"buzzerResults.markCorrectness","requestId":"r3","payload":{"questionId":"Q1","judgement":"CORRECT"}}
```

`judgement` 可為 `CORRECT`、`INCORRECT` 或 `null`（取消）。僅已認證老師在 ENDED 可呼叫，而且題目必須有伺服器推導的勝出組別。新值取代舊值；無 winner 以 `WINNER_NOT_FOUND` 拒絕；不讀取或自動判斷答案文字。

### `buzzerResults.getScoreboard`

```json
{"type":"buzzerResults.getScoreboard","requestId":"r4","payload":{}}
```

老師及已加入組別的學生僅在 ENDED 可查詢。重連後若階段為 ENDED，前端自動查詢計分板及既有角色限定結果。

### `activity.reset`

```json
{"type":"activity.reset","requestId":"r5","payload":{}}
```

只有老師確認 UI 顯示之清除摘要後才送出。後端仍須驗證 TEACHER 與 ENDED；重設不接受任何要保留或清除的欄位，行為由功能規格固定。老師取消時不得傳送本命令。

## Server events and snapshots

### `activity.snapshot` 與 `activity.phaseChanged`

對所有已連線師生傳送非敏感活動階段及計時狀態：

```json
{"type":"activity.snapshot","payload":{"stage":"BUZZING","groups":["1","2"],"timeLimitSeconds":30,"remainingSeconds":18}}
```

`timeLimitSeconds` 永遠為 0–3600；剩餘時間為整數或 `null`。不限時時為 `timeLimitSeconds: 0`、`remainingSeconds: null`。快照要讓新連線者立即重建同一倒數畫面。deadline/剩餘時間僅供顯示，不是接受答案的依據。

階段改變沿用 `activity.phaseChanged` 並帶相同階段／時限／剩餘時間欄位。老師手動結束或期限到達時皆廣播 ENDED；確認重設後廣播 PREPARING 及時限 0。成功重新匯入時更新教師 worksheet snapshot、學生題號清單與教師進度。

### `activity.countdown`

```json
{"type":"activity.countdown","payload":{"remainingSeconds":17}}
```

限時 BUZZING 時由伺服器每秒廣播；0 秒不限時不發 countdown tick。到期時先由伺服器結束活動，再廣播 ENDED。逾時提交即使到期 callback 尚未執行仍已被截止檢查拒絕。

### `activity.timeLimitSet`、`activity.resetCompleted`

- `activity.timeLimitSet`: `payload: { seconds: integer }`，回覆老師設定成功。
- `activity.resetCompleted`: `payload: { stage: "PREPARING", timeLimitSeconds: 0 }`，在老師確認且後端重設完成後廣播；失敗或取消不發送。

### `buzzerResults.ownProgress`

沿用每個本組題目的 `submitted`、`answerText` 及 `locked`，新增安全的合計欄位：

```json
{"type":"buzzerResults.ownProgress","payload":{"questions":[{"questionId":"Q1","submitted":true,"answerText":"答案","locked":true}],"submittedCount":1,"totalQuestionCount":3}}
```

只傳給同一組學生連線且只在 BUZZING 傳送；`submittedCount` 計算不同頂層題目中的已接受提交，題組算一題。無效／重複／逾時提交不增加計數。訊息不得含其他組別內容、分數、進度或 winner。

### `buzzerResults.teacherProgress`

只傳給已認證教師；沿用每題所有組別狀態與勝出答案，另含該題 `judgement: "CORRECT" | "INCORRECT" | null`。學生不得收到此投影。

### `buzzerResults.scoreboard`

```json
{"type":"buzzerResults.scoreboard","payload":{"entries":[{"rank":1,"groupId":"2","score":3,"successfulQuestionCount":4},{"rank":2,"groupId":"10","score":3,"successfulQuestionCount":3}]}}
```

只在 ENDED 供教師及學生使用。回傳所有名冊組別各一列，依 score 降冪、successfulQuestionCount 降冪、組別 ID 升冪。純數字 ID 用數值排序，其他 ID 用自然字串順序。每次標記新增／改標／取消後廣播最新 scoreboard 給已連線師生。

### Existing results projections

- `buzzerResults.studentResults`：仍只供 ENDED 學生使用；只含 winner 答案及本組答案／狀態，不含其他非勝出組答案。
- `buzzerResults.teacherProgress`：教師完整各組資料；只傳給已認證老師。
- PREPARING／BUZZING 學生不得收到 scoreboard、教師全組投影或其他組答案。

## Error and no-mutation rules

| 狀況 | 回應 | 不變條件 |
|---|---|---|
| 時限小數、負數或大於 3600 | `TIME_LIMIT_INVALID` | 階段與時限不變。 |
| 期限時刻或之後送答案 | `ANSWER_TIMED_OUT` | 不建答案、不鎖題、不排順位、不增進度。 |
| 以非老師設定時限／標記／重設 | `AUTH_REQUIRED` | 活動、標記與結果不變。 |
| 非準備階段設定時限、非結束階段標記／重設 | `STAGE_CONFLICT` | 活動及分數不變。 |
| 標記題目沒有 winner | `WINNER_NOT_FOUND` | 不建立判定、不變分。 |
| UI 取消重設 | 不傳送命令 | 活動及所有資料不變。 |
| 學習單匯入失敗 | 沿用 Guided Notes 錯誤碼 | 保留目前 worksheet/questions，且不清理作答／計分。 |

## Google Sheets boundary

Feature 006 不新增 Sheets API operation。匯入與匯出繼續遵守 [Feature 002 Google Sheets boundary](../../002-guided-notes-import-export/contracts/google-sheets-boundary.md)，service-account 憑證僅由後端環境變數載入。
