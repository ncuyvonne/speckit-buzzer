# Contract: Feature 005 WebSocket

沿用現有 JSON WebSocket envelope：client requests 使用 `type`、`requestId`、`payload`；server responses 沿用既有 response、`error` 與 role-filtered broadcast 模式。既有 16 KiB 限制適用於 client→server 訊息。

## Teacher fair-ranking settings

設定請求只接受已驗證 teacher 且活動為 `PREPARING`：

```json
{
  "type": "buzzerResults.setFairRanking",
  "requestId": "request-id",
  "payload": { "enabled": true, "delaySeconds": 0.5 }
}
```

停用公平順位時，`delaySeconds` 可為 `null`。啟用時必須是有限正數。伺服器以 `buzzerResults.fairRankingConfigured` 確認設定，並於教師重新連線時提供目前設定。活動進入 `BUZZING` 後拒絕設定更新；若啟用但延遲無效，也拒絕 `PREPARING → BUZZING`。

## Teacher progress

既有 `buzzerResults.teacherProgress` 每題的 `groups[]` 增加 `rank: integer | null`。已提交組別有連續名次和答案；未提交組別 `rank = null`、`answerText = null`。`winningGroupId`／`winningAnswer` 對應 rank 1。只有 teacher 收到完整組別答案與進度。

## Student results

既有 `buzzerResults.studentResults` 每題增加 `groups[]`，列出所有組別的 `groupId`、`submitted` 及 `rank: integer | null`。保留 `winningGroupId`、`winningAnswer`、`ownAnswer`、`ownStatus`、`ownGroupWon`。除成功答案外，不得附帶其他組別答案；`buzzerResults.ownProgress` 在 `BUZZING` 仍只含本組資料。

## CSV export

已驗證 teacher 在 `ENDED` 可送出：

```json
{
  "type": "buzzerResults.exportCsv",
  "requestId": "request-id",
  "payload": {}
}
```

伺服器回覆 `buzzerResults.csvReady`，包含 `fileName` 與 `csvText`。`csvText` 含 UTF-8 BOM 字元及完整 CSV 內容；前端以 `text/csv;charset=utf-8` 建立下載。此回應只傳給發出請求且仍具 teacher role 的連線。

## Errors and authority

- 非 teacher 設定或匯出：沿用 `AUTH_REQUIRED`。
- 活動階段不符：沿用 `STAGE_CONFLICT`。
- 延遲值無效或啟用設定不完整：增加明確錯誤碼並提供可修正訊息。
- 結果不可用：回傳清楚的結果尚未就緒錯誤，不傳空白成功檔。
- 客戶端不可提供組別、received time、prior win count、有效時間、排名或成功組別作為權威欄位。
