# Data Model: 005 搶答公平順位與 CSV 匯出

本模型沿用單一活動程序記憶體生命週期。題號順序、有效組別、單題／題組答案結構由既有活動與 Feature 002／004 提供。

## Entities

### FairRankingSettings（公平順位設定）

| Field | Type | Rules |
|---|---|---|
| `enabled` | boolean | 新活動預設 `false`；只允許老師在 `PREPARING` 設定。 |
| `delaySeconds` | finite number or null | 啟用時為 1–30 秒（含端點），可為小數；停用時為 `null`，或非空時也須在相同範圍。啟用欄位預填 3 秒。 |
| `frozenAtStart` | boolean／derived lifecycle state | 活動進入 `BUZZING` 後不得再修改設定；其後答案沿用同一規則。 |

### AcceptedAnswer（組別有效答案）

| Field | Type | Rules |
|---|---|---|
| `groupId` | string | 由已驗證學生連線取得，不信任 client payload 的組別宣告。 |
| `questionId` | string | 必須屬於目前活動題目清單。 |
| `answer` | existing answer content | 沿用單題原始文字或 Feature 004 完整題組答案；每組每題只接受一筆。 |
| `receivedAtMs` | number | 伺服器接受有效答案時記錄；不採用 client time。 |
| `acceptedOrder` | integer | 伺服器在同步接受臨界區配置，作為相同有效時間的唯一 tie-break。 |
| `priorWinCountSnapshot` | integer | 接受前，該組在其他題目當下排行第一的題數；不含目前題目，接受後固定。 |
| `effectiveAtMs` | number | 關閉時等於 `receivedAtMs`；開啟時等於 `receivedAtMs + priorWinCountSnapshot × delaySeconds × 1000`。 |
| `locked` | true | 接受後即鎖定；無效或重複提交不產生此 entity。 |

### QuestionRanking（每題順位，derived view）

由同一 `questionId` 的 `AcceptedAnswer` 按 `effectiveAtMs` 升序，再按 `acceptedOrder` 升序產生 1 開始的連續順位。順位 1 為目前成功組別。沒有有效答案時沒有成功組別；尚未提交的組別不占數字順位。

### TeacherProgress（教師投影）

每題包含成功組別／答案，並為每個已設定組別提供 `submitted`、已接受答案及 `rank`；未提交組別 `rank = null`、答案為 `null`。教師可以在 `BUZZING` 看目前順位，也可以在 `ENDED` 查看最終順位。

### StudentResults（學生結束投影）

每題包含所有組別的 `groupId`、`submitted` 及 `rank | null`，並提供成功組別及成功答案、本組答案／狀態。不得包含其他非成功組別答案。活動進行中仍只提供本組作答進度。

### CsvResultRow（CSV 列）

每筆已接受提交一列，欄位順序如下：

1. `題號`
2. `組別`
3. `答案`
4. `搶答順位`
5. `是否搶答成功`（順位 1 為「是」，其餘為「否」）
6. `送出時間`（伺服器本機時間 `YYYY-MM-DD HH:MM:SS.mmm`）

未提交組別不輸出資料列；無提交的題目也不輸出空白列。題組答案依子題編號遞增連續串接，例如 `（1）答案一（2）答案二`。CSV 的實際標頭、編碼及逸出見 [csv-export.md](./contracts/csv-export.md)。

## State and Validation Rules

- `PREPARING`: 老師可設定公平開關與延遲；活動預設關閉。若啟用，延遲必須是有限正秒數，否則不得開始。
- `BUZZING`: 設定固定；只接受有效題號、有效組別、非空白答案及每組每題第一筆提交。服務在接受點記錄快照和有效時間，再更新該題順位。
- `ENDED`: 不再接受答案；學生查詢全組順位和角色允許的答案，教師可檢視完整結果並匯出 CSV。
- 拒絕提交或匯出不得改變設定、答案、順位或成功組別。
- 程序重啟不復原活動狀態，沿用既有 Feature 003 生命週期。
