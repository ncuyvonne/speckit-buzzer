# Data Model: 003 搶答與結果判定

## Activity

Feature 001 的單一伺服器活動，題目由 Feature 002 匯入。

| Field | Type | Validation / Rule |
|---|---|---|
| stage | PREPARING / BUZZING / ENDED | 由既有 ActivityState 管理；只有 BUZZING 接受答案。 |
| questions | Question[] | 沿用目前活動題目；題號唯一。未知題目不得接受答案。 |

Feature 003 不建立第二份活動階段或題目清單。

## Group

Feature 001 組別清單中的有效組別。

| Field | Type | Validation / Rule |
|---|---|---|
| id | string | 必須存在於 GroupRoster。學生提交時由伺服器連線狀態推導，不讀取客戶端組別欄位。 |

同組可有多個學生連線；答案屬於組別，而非個別 socket。

## GroupSubmission

一組對一題首次送出的有效答案。

| Field | Type | Validation / Rule |
|---|---|---|
| groupId | string | 由伺服器已驗證連線取得的有效組別 ID。 |
| questionId | string | 必須符合 Activity 目前題號。 |
| answerText | string | 至少含一個非空白字元；保留原文，不修剪。 |
| receivedOrder | number | 由伺服器配置的正整數，嚴格遞增；只在有效提交接受時配置，用來判定勝出及同時間精度的先後。 |
| acceptedAt | number | 伺服器接受時間戳，供診斷使用；不接受客戶端值，也不作勝出 tie-break。 |
| locked | boolean | 接受時設為 true；已接受提交不可解鎖。被拒絕提交不建立資料。 |

**Identity and uniqueness**：目前活動中 (groupId, questionId) 唯一。檢查並插入須在同一同步操作完成；首筆有效答案在本次活動維持不變。

## WinningResult

每題由已接受提交推導的結果。

| Field | Type | Validation / Rule |
|---|---|---|
| questionId | string | 目前活動題號。 |
| groupId | string | 此題 receivedOrder 最小的已接受提交所屬組別。 |
| answerText | string | 勝出提交的原始答案。 |
| receivedOrder | number | 勝出提交的伺服器序號。 |

若題目尚無有效提交，即沒有勝出結果。客戶端不可設定勝者。

## StudentOwnProgress

BUZZING 階段於學生加入或重新連線後，回傳給該學生所屬組別的恢復投影。

| Field | Type | Validation / Rule |
|---|---|---|
| questionId | string | 目前活動題號。 |
| submitted | boolean | 該學生所屬組別是否已提交此題。 |
| answerText | string or null | 僅回傳該組已接受的原始答案；未提交時為 null。 |
| locked | boolean | 已提交時為 true，未提交時為 false。 |

此投影不得包含勝出組別、勝出答案、排名或其他組別資料。

## TeacherQuestionProgress

老師檢視單題所有組別提交狀況的投影。

| Field | Type | Validation / Rule |
|---|---|---|
| questionId | string | 目前活動題號。 |
| groups | TeacherGroupSubmissionState[] | 每個設定組別恰有一筆狀態，依組別設定順序排列。 |
| winningGroupId | string or null | 尚無提交時為 null，否則為伺服器推導的勝出組別。 |
| winningAnswer | string or null | 尚無勝者時為 null，否則為勝出答案。 |

每筆 group state 包含 groupId、submitted、answerText；未提交時 answerText 為 null。只傳給已驗證老師。

## StudentQuestionResult

活動結束後，按查詢者組別產生的單題投影。

| Field | Type | Validation / Rule |
|---|---|---|
| questionId | string | 目前活動題號。 |
| winningGroupId | string or null | 伺服器推導的勝出組別。 |
| winningAnswer | string or null | 伺服器推導的勝出答案。 |
| ownAnswer | string or null | 查詢者組別的答案。 |
| ownStatus | SUBMITTED / NOT_SUBMITTED | 查詢者組別是否已提交。 |
| ownGroupWon | boolean | 查詢者組別是否為勝者。 |

學生投影不可包含其他非勝出組別的答案或提交狀態。BUZZING 時不傳此投影，只傳本組提交確認。

## WinningResultsSnapshot（Feature 002 boundary）

將 003 勝出結果對接 backend/src/guided-notes/types.ts 中既有的 WinningResultsProvider。

- READY 且有答案：每個勝出題號提供一筆 WinningAnswer(questionId, groupId, answerText)。
- READY 且答案清單空：活動有題目但無人提交，代表沒有答案需寫回。
- UNAVAILABLE：結果來源尚未就緒時使用；Feature 002 必須在寫入前拒絕匯出。沒有匯入題目時，Feature 002 會先以 WORKSHEET_NOT_IMPORTED 拒絕，正常流程不會呼叫 provider。
- Snapshot 僅由伺服器資料產生，不接受瀏覽器欄位。

## Relationships and lifecycle

- 一個 Activity 擁有題目清單及活動階段。
- 每筆 GroupSubmission 參照一個 Activity 題目與一個有效組別。
- 每個組別／題號最多一筆 GroupSubmission；同組多位學生共用該記錄。
- 每個 WinningResult 是該題最早已接受答案的推導結果。
- TeacherQuestionProgress 是對所有組別、題目、提交及勝者的唯讀投影。
- StudentQuestionResult 是按單一組別篩選後的唯讀投影。
- 所有提交與結果僅存在伺服器程序記憶體；程序結束即清除。
