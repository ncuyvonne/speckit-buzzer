# Data Model: 006 計時搶答與計分板

本功能延伸目前程序內的一個 Activity、既有題目與組別；不建立第二套活動清單。服務端保存權威狀態，前端只接收按角色限制的投影。

## Activity

一場本機搶答活動及其匯入題目、階段和時限。

| 欄位 | 型別 | 驗證／規則 |
|---|---|---|
| stage | `PREPARING \| BUZZING \| ENDED` | 伺服器持有；老師手動結束或期限到達後為 ENDED；確認重設後回 PREPARING。 |
| worksheet | `WorksheetReference \| null` | 沿用目前學習單；重設保留，成功匯入後由新匯入取代。 |
| questions | `Question[]` | 沿用匯入的頂層題目清單；沿用既有每份最多 100 題限制；題組是單一 Question。 |
| timeLimitSeconds | integer | 含 0 至 3600；0 表示不限時；新活動、確認重設及成功換入學習單後為 0。僅準備中可由老師設定。 |
| deadlineAt | integer milliseconds or null | 伺服器產生；僅限時搶答中存在；開始時以伺服器開始時間加時限計算。不是用戶端可寫入欄位。 |

### Activity transitions

| 目前狀態 | 操作／條件 | 下一狀態 | 附帶規則 |
|---|---|---|---|
| PREPARING | 老師開始 | BUZZING | 時限為 0 時無截止計時；正值建立 deadline 並開始剩餘秒數更新。 |
| BUZZING | 老師手動結束 | ENDED | 取消 timer；保留已接受答案及勝出結果。 |
| BUZZING | deadline 到達 | ENDED | 只結束一次；取消 ticker；此時及之後收到的提交均拒絕。 |
| ENDED | 老師確認重設 | PREPARING | 保留 worksheet/questions；清除提交、勝出、標記及計分；時限歸零。 |
| PREPARING | 學習單匯入成功 | PREPARING | 以新匯入題目取代舊題目；計時為 0 且無舊提交／標記。失敗則整體不變。 |

取消重設確認不送出重設命令，因此 Activity 和所有關聯資料均不變。教師角色與階段授權由後端 handler 驗證。

## ActivityTimer / Countdown Projection

計時服務管理排程，但 deadline 是伺服器活動狀態，不能由瀏覽器提供。

| 欄位／投影 | 型別 | 驗證／規則 |
|---|---|---|
| deadlineAt | integer milliseconds or null | 與 Activity.deadlineAt 同一權威截止值；0 秒或非 BUZZING 時為 null。 |
| remainingSeconds | integer 0–3600 or null | 從 deadline 與伺服器當下時間計算；0 秒時為 null 並顯示「不限時」。只供畫面使用，不可作提交授權。 |
| timerRunning | boolean | 僅時限大於 0 且 BUZZING 為 true；手動結束、到期、重設、成功重新匯入及程序關閉時停止。 |
| generation | private integer | 每次開始或取消計時遞增；每個排程 callback 捕捉當次世代及 deadline，僅在兩者仍與目前 ActivityTimer 相符時有效。不可由 WebSocket 傳入或修改。 |

後端每秒發布 `remainingSeconds`；到期事件須檢查捕捉的 generation、deadline 仍有效且 Activity.stage 為 BUZZING，避免已取消或上一輪的延遲 callback 結束目前活動。

## GroupSubmission

沿用既有作答實體；每組對每個頂層題目至多一筆已接受答案。

| 欄位 | 型別 | 驗證／規則 |
|---|---|---|
| groupId | string | 由已驗證學生連線推導，必須存在於 GroupRoster；不得信任作答 payload 的組別。 |
| questionId | string | 必須是目前 Activity.questions 的題目 ID。 |
| answerText | string | 至少一個非空白字元；保留原始文字。 |
| receivedOrder | integer | 後端對有效接受答案遞增配置；用於既有搶答先後，不取代 timer 截止比較。 |
| receivedAt | integer milliseconds | 後端在同步接受路徑取樣一次；只有 `receivedAt < deadlineAt` 可繼續驗證並插入。 |
| locked | boolean | 接受後 true；重複、無效及逾時答案不建立鎖定。 |

**唯一性**：`(groupId, questionId)` 在一場活動中唯一。題組由匯入器視為一個頂層題，完整題組提交仍只佔一份提交記錄。

## WinningResult

每題依最早有效接受答案推導的勝出結果；沿用既有模型，不含正確性判定。

| 欄位 | 型別 | 規則 |
|---|---|---|
| questionId | string | 目前頂層題目 ID。 |
| winningGroupId | string or null | 最早有效提交的組別；無提交時 null。 |
| winningAnswer | string or null | 勝出提交原始答案；無勝出者時 null。 |

答案到期後不會建立或改寫 WinningResult；手動結束前既有結果保留至重設或程序結束。

## CorrectnessMark

老師在活動結束後對有勝出者的單題作人工判定。

| 欄位 | 型別 | 驗證／規則 |
|---|---|---|
| questionId | string | 必須屬於目前題目，且該題已有 WinningResult.winningGroupId。 |
| judgement | `CORRECT \| INCORRECT` | 只有 teacher + ENDED 可設定；`null` 表示取消並移除目前標記。 |
| winningGroupId | string | 關聯至該題已選出的勝出組別；老師不能另選其他組別評分。 |

**唯一性與生命週期**：每個 questionId 至多一個目前標記。改判為另一值會取代原值；取消不保留歷史。重設或成功換入學習單時清除所有標記。系統不解析答案文字來判斷對錯。

## ScoreboardEntry

由 GroupRoster、WinningResult 及 CorrectnessMark 推導的唯讀計分列。

| 欄位 | 型別 | 規則 |
|---|---|---|
| groupId | string | 目前名冊內的組別；每組恰有一列，即使分數和成功題數都是 0。 |
| score | non-negative integer | 該組目前所有 CORRECT 判定數；每題最多加 1。 |
| successfulQuestionCount | non-negative integer | 該組為勝出組別的不同題目數，不因對錯或取消標記變化。 |
| rank | positive integer | 依 score 降冪、successfulQuestionCount 降冪、groupId 規則升冪排序後的順序。 |

數字字串組別 ID 使用數值升冪（2 在 10 前）；其他 ID 使用規格指定的自然字串順序。分數不另行累加持久化，避免改標／取消後漂移。

## StudentOwnProgress

BUZZING 階段供學生本人所屬組別使用的作答進度投影。

| 欄位 | 型別 | 規則 |
|---|---|---|
| questions | `OwnQuestionProgress[]` | 只含目前活動的頂層題目及本組的 submitted、answerText、locked。 |
| submittedCount | integer 0–questionCount | 由不同 questionId 且已接受的本組答案計數；不含被拒絕或逾時提交。 |
| totalQuestionCount | integer 1–100 | 目前成功匯入之頂層題目數，題組只計 1。 |

僅在 BUZZING 傳送／顯示；不得包括其他組別狀態、答案、分數或勝出資料。準備中與已結束隱藏 N / 總題數。

## Relationships and reset lifecycle

- Activity 一對多擁有目前 GroupSubmission 及 WinningResult；一場活動只有一個 Countdown。
- 每個 WinningResult 由一個已接受 GroupSubmission 推導；CorrectnessMark 關聯其 questionId 並只標記勝出組別答案。
- ScoreboardEntry 是所有 roster group 的目前投影，由勝出與正誤標記重新計算。
- StudentOwnProgress 以已驗證 groupId 篩選 GroupSubmission；不同組別間不可互相投影。
- 老師確認重設：停止計時 → Activity 回 PREPARING 且保留 worksheet/questions、時限設 0 → 清除 submissions/winners/marks/scoreboard → 廣播新階段及空進度。
- 匯入成功：只有在 GuidedNotesService 完成驗證及提交新 worksheet/questions 後才清除舊活動答案、標記及計分；匯入失敗不觸發清理。
- 全部活動狀態只存在目前程序記憶體。程序重啟不復原活動或其倒數與成績。
