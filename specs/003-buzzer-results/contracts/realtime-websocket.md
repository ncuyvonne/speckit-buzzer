# Realtime WebSocket Contract: 003 搶答與結果判定

本契約延伸 [Feature 001](../../001-role-phase-sync/contracts/realtime-websocket.md) 和現有 Feature 002 WebSocket 協定。沿用 /ws、JSON envelope、requestId、綁定即時連線的老師身分、Origin 驗證及 16 KiB 傳入訊息上限。

## Authorization and data visibility

- 學生必須已加入有效組別。組別由伺服器連線取得；客戶端不可在提交中指定 groupId。
- 同一條已加入學生連線只能維持原組別；以不同 groupId 重送 student.join 會被拒絕，且連線仍保留原組別。
- 只有伺服器 Activity 為 BUZZING 且題號存在於目前題目清單時，才可提交。
- 客戶端時間、勝出組別、答案正確性及分數均不具權威性。
- 教師快照與進度事件只傳給已驗證教師。
- BUZZING 期間學生只收到本組提交確認。學生初始資料、廣播、錯誤和查詢回應均不得暴露其他組的提交狀態、答案或勝出資訊。
- ENDED 後學生結果只含每題勝出組別／答案及查詢者本組答案／狀態；省略其他非勝出組資料。
- 身分或請求錯誤不得改變答案或勝出順序。

## Client-to-server messages

沿用 {type, requestId, payload} envelope；後端仍須驗證形狀、欄位及 UTF-8 byte size。

### buzzerResults.submitAnswer

```json
{
  "type": "buzzerResults.submitAnswer",
  "requestId": "buzz-submit-1",
  "payload": {
    "questionId": "1",
    "answerText": "學生輸入的原始答案"
  }
}
```

伺服器從已加入的學生連線取得組別。依序驗證角色／組別、BUZZING、活動題號、非空白答案及唯一提交鍵；全部通過後，在一次同步操作接受、鎖定並配置伺服器接收序號。

### buzzerResults.getTeacherProgress

```json
{
  "type": "buzzerResults.getTeacherProgress",
  "requestId": "buzz-teacher-view-1",
  "payload": {}
}
```

僅已驗證老師可要求。老師登入時也會取得目前完整教師進度，讓重新連線後可恢復檢視。

### buzzerResults.getStudentResults

```json
{
  "type": "buzzerResults.getStudentResults",
  "requestId": "buzz-student-results-1",
  "payload": {}
}
```

僅已加入的學生可在 Activity 為 ENDED 後要求；組別由伺服器連線取得。

## Server-to-client messages

### buzzerResults.submitted

僅回覆提交學生連線，並以 requestId 關聯。

```json
{
  "type": "buzzerResults.submitted",
  "requestId": "buzz-submit-1",
  "payload": {
    "questionId": "1",
    "accepted": true,
    "locked": true
  }
}
```

拒絕提交使用標準 error envelope，不改變既有資料。

### buzzerResults.questionList

學生成功加入組別後，伺服器回傳目前活動依顯示順序排列的題號，供學生選擇題目；老師在 PREPARING 階段匯入新題號後，也會只向已加入學生更新此清單。此訊息只含題號，不含題目敘述、正解或其他組別資料；尚未匯入題目時清單為空。

```json
{
  "type": "buzzerResults.questionList",
  "payload": { "questionIds": ["1", "2", "4"] }
}
```

### buzzerResults.ownProgress

學生在 BUZZING 期間加入或重新連線後，伺服器只回傳該學生所屬組別在各題的提交狀態；已有答案時一併回傳該組自己的答案。此訊息不含勝出組別、其他組資料或排名。

```json
{
  "type": "buzzerResults.ownProgress",
  "payload": {
    "questions": [
      { "questionId": "1", "submitted": true, "answerText": "本組答案", "locked": true },
      { "questionId": "2", "submitted": false, "answerText": null, "locked": false }
    ]
  }
}
```

After reconnect and join while the Activity is ENDED, the frontend requests buzzerResults.getStudentResults and renders the role-filtered response below.

### buzzerResults.teacherProgress

有效答案接受或成功匯入新題號後，傳給所有已驗證教師連線；老師驗證登入後亦取得全量初始快照。

```json
{
  "type": "buzzerResults.teacherProgress",
  "payload": {
    "questions": [
      {
        "questionId": "1",
        "groups": [
          { "groupId": "1", "submitted": true, "answerText": "學生答案" },
          { "groupId": "2", "submitted": false, "answerText": null }
        ],
        "winningGroupId": "1",
        "winningAnswer": "學生答案"
      }
    ]
  }
}
```

每次傳送完整目前投影，確保重新連線的老師可補回錯過的更新。正常本機連線及實際班級人數下，更新目標為 2 秒內。

### buzzerResults.studentResults

ENDED 後的 requestId 關聯回應。

```json
{
  "type": "buzzerResults.studentResults",
  "requestId": "buzz-student-results-1",
  "payload": {
    "questions": [
      {
        "questionId": "1",
        "winningGroupId": "1",
        "winningAnswer": "學生答案",
        "ownAnswer": "本組答案",
        "ownStatus": "SUBMITTED",
        "ownGroupWon": false
      }
    ]
  }
}
```

無人提交時 winner 欄位為 null；查詢組別未作答時 ownAnswer 為 null、ownStatus 為 NOT_SUBMITTED。

## Errors

沿用 {type:"error", requestId, payload:{code,message}}，訊息使用可採取行動的繁體中文。

| Code | 意義及不變更保證 |
|---|---|
| AUTH_REQUIRED | 連線未取得此操作所需權限；狀態不變。 |
| GROUP_INVALID | 學生尚未加入有效組別，或已加入後嘗試變更組別；既有連線身分與作答狀態不變。 |
| STAGE_CONFLICT | 提交不在 BUZZING，或 ENDED 前要求學生結果；不更改狀態或釋出結果。 |
| QUESTION_INVALID | 題號不屬於目前 Activity；不儲存答案且不消耗接收序號。 |
| ANSWER_EMPTY | 答案為空或只含空白；提示輸入答案，保留提交名額。 |
| ANSWER_LOCKED | 組別該題已有有效答案；保留首筆答案與鎖定狀態。 |
| INVALID_MESSAGE | 訊息形狀、類型或 payload 無效；狀態不變。 |

handler 先檢查連線角色與組別；領域服務在 mutation boundary 再驗證階段、題號、答案與唯一鍵。

## Ordering and failure guarantees

- 僅在全部驗證通過後接受答案。
- 服務以不含 await 的同步檢查及插入完成 (groupId, questionId) 唯一性；接受提交時配置嚴格遞增的 receivedOrder。
- 每題最小 receivedOrder 為勝者。時間戳只供資訊用途；相同精度不會造成勝者不確定。
- 無效或重複提交不消耗序號、不改變已接受答案或勝者。
- 活動期間組別不得修改、撤回或重置已接受答案。
- 教師更新包含所有設定組別；學生訊息不得重用教師投影。
- Feature 002 WinningResultsSnapshot 只從後端已接受答案產生。

## Google Sheets boundary

Feature 003 不直接呼叫 Google Sheets API，也不接收 Google credentials。Feature 002 使用既有 Google Sheets API v4 adapter 讀寫工作表，並透過 GOOGLE_SERVICE_ACCOUNT_JSON 從後端環境變數取得服務帳戶憑證。Feature 003 僅實作 Feature 002 所需的 WinningResultsProvider；自動化測試可注入 fake provider／adapter，不需真實憑證。詳細憑證、讀取、寫入及錯誤界線見 [Feature 002 Google Sheets boundary](../../002-guided-notes-import-export/contracts/google-sheets-boundary.md)。
