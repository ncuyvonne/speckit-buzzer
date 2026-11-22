# Research: 006 計時搶答與計分板

## 沿用 React／Vite 與 Node.js／WebSocket 工作區

- **Decision**: 沿用 `frontend/` 的 React + Vite、`backend/` 的 Node.js + TypeScript + `ws`，並擴充既有 WebSocket 訊息及伺服器領域服務。
- **Rationale**: 工作區已提供活動階段、老師授權、組別名冊、學生／教師進度投影及 Vitest／Playwright。新增第二個伺服器或通訊方式會增加狀態同步路徑，沒有本功能需要。
- **Alternatives considered**: 新增另一個 API server、前端自行判斷計時或增加另一個訊息通道。均會造成共享階段或截止來源分裂。
- **Evidence**: `package.json` 的 npm workspaces；`backend/src/server.ts` 建構 ActivityState、BuzzerResultsService 及 RealtimeHub；`backend/src/realtime/handler.ts` 驗證角色並傳送階段與結果；`frontend/src/App.tsx` 組合教師和學生畫面。

## 將活動、計時、判定與分數留在程序記憶體

- **Decision**: 使用記憶體保存 Feature 006 活動時限、截止時刻、正誤標記及計分投影；不加入 SQLite。
- **Rationale**: 目前 ActivityState 已明確是單一程序的一場 server-owned 活動；BuzzerResultsService 已用 Map 保存該活動的答案及勝出結果。新程序啟動時已建立空白 ActivityState，沒有目前題目或答案的載入／復原流程。記憶體能沿用程序生命週期，並讓重設／重新匯入直接清除本場資料。
- **Alternatives considered**: SQLite 會新增套件、schema、交易／遷移和程序重啟後該恢復哪個階段的決策。持久化活動一部分資料而不復原現有匯入題目與答案，會產生不一致的復原狀態，超出規格。
- **Evidence**: `backend/src/domain/activity-state.ts:17-24,39-78`；`backend/src/domain/buzzer-results.ts:78-120`；`backend/src/server.ts:47-66` 每次建構新的活動與答案服務；`backend/package.json` 目前未含 SQLite 相依套件。
- **Bounded assumption**: 程序重啟會丟棄活動、倒數、答案、標記與計分，和現有活動／答案行為一致。若日後要求重啟復原，再將資料持久化作為獨立決策。

## 在同步答案接受點檢查伺服器截止時間

- **Decision**: 新增 deadline 規則，並在 `BuzzerResultsService.submitAnswer` 的同步驗證及插入操作中檢查；以同一次取樣的伺服器接收時間與 deadline 比較，`receivedAt >= deadline` 拒絕。
- **Rationale**: 現有答案接受在同一同步 check-and-set 中驗證並保存首筆答案；該插入是同組並行提交的線性化點。截止檢查放在同一個無 await 路徑，可確保計時回呼尚未改變階段時也不接受逾期答案。等於 deadline 明確算逾時。
- **Alternatives considered**: 只等 `setTimeout` 回呼將階段改成 ENDED，或以瀏覽器倒數作裁定。前者有事件佇列競態，後者會信任可偏移的用戶端時鐘。
- **Evidence**: `backend/src/domain/buzzer-results.ts:93-120`；`backend/src/domain/activity-state.ts:72-78`；Feature 006 規格 FR-003–005；`diagrams/006-timed-scoring-sequence-timer.puml`。

## 以伺服器倒數更新同步畫面並在事件結束時取消

- **Decision**: 計時開始時由伺服器建立 deadline 並每秒廣播整數剩餘秒數；到期後後端結束活動並停止 ticker。手動結束、確認重設、成功換入新學習單、伺服器關閉均停止計時事件。Callback 捕捉計時世代與 deadline，只有兩者仍有效且活動仍為 BUZZING 才可結束活動。
- **Rationale**: 師生畫面只呈現伺服器更新；不用同步各瀏覽器本機時鐘，且符合規格要求的可見倒數與更新目標。只檢查 BUZZING 不足以排除已排隊的舊 callback 在重設後新一輪執行；世代及 deadline 可使舊排程失效。
- **Alternatives considered**: 只傳一次開始時間，再由瀏覽器時鐘持續倒數。此作法會受每台裝置時鐘誤差影響，且重新連線需額外估算時間偏移。
- **Evidence**: `backend/src/server.ts` 的單一服務組合與 close 生命周期；`backend/src/realtime/handler.ts` 的連線集合及階段廣播；`frontend/src/realtime/client.ts` 的 snapshot／phase 事件處理；規格 SC-007。

## 將人工判定與計分板投影分離於答案接受

- **Decision**: 以新的後端 scoring domain service 保存每題一個 `CORRECT`／`INCORRECT` 標記或未標記狀態；查詢時依答案服務的勝出結果及 GroupRoster 計算分數、成功題數與排名。
- **Rationale**: 答案服務只決定送達先後；老師判正誤是獨立活動結束後的操作。由標記推導分數可讓改標與取消保持冪等，不會多次加減錯誤。所有 roster 組別可包含零分列。
- **Alternatives considered**: 直接修改答案為正確答案或將分數累加到可變計數。前者違反不自動改答案的規格，後者在改標／取消時易出現漂移。
- **Evidence**: `backend/src/domain/buzzer-results.ts:128-184` 的 winner 與角色投影；規格 FR-006–011；`diagrams/006-timed-scoring-class.puml`。

## 延伸現有 WebSocket 投影並維持學生資料隔離

- **Decision**: 由 RealtimeHub 對新增訊息檢查 teacher/student 身分與 ActivityState；結束後師生取得計分板，搶答中學生只取得本組的進度數及總題數。教師可取得所有組別提交、勝出及正誤標記。
- **Rationale**: 現有 handler 已按連線角色分離 teacherProgress、ownProgress 與 ended studentResults。將資料在伺服器生成及傳送時裁切，避免學生從訊息本體讀到其他組資料。
- **Alternatives considered**: 傳送完整教師進度，再由 React 隱藏其他組別。這不會保護 WebSocket payload。
- **Evidence**: `backend/src/realtime/handler.ts:140-194,279-309`；`backend/src/domain/buzzer-results.ts:132-184`；`frontend/src/realtime/messages.ts`；Feature 006 規格 FR-011–013。

## 沿用 Google Sheets API 及後端環境變數憑證邊界

- **Decision**: 學習單重新匯入／匯出仍使用 Feature 002 的 `GuidedNotesService`、`GoogleSheetsAdapter` 與 `googleapis`；本功能不增加 Sheets API 請求。憑證仍由後端讀取 `GOOGLE_SERVICE_ACCOUNT_JSON`。
- **Rationale**: Feature 006 只要在成功換入新題目後重設本場狀態；讀寫工作表既有行為和契約不變。沿用原 adapter 不會在前端暴露 service-account 憑證。
- **Alternatives considered**: 新建 Sheets client、由瀏覽器讀寫、或把憑證放入 WebSocket payload。均會重複責任或違反憲章憑證原則。
- **Evidence**: `backend/src/server.ts:55-66`；`backend/src/config.ts:29-63`；`.env.example`；`specs/002-guided-notes-import-export/contracts/google-sheets-boundary.md`。

## 沿用 Vitest 與 Playwright 測試架構

- **Decision**: 將邊界時鐘及服務行為放在 Vitest，WebSocket 角色投影使用現有 integration suite，師生操作及瀏覽器畫面使用 Playwright。
- **Rationale**: 後端已有 `now` 注入及 fake timer 測試先例；E2E 已提供本機 server、teacher/student 連線與階段同步 fixtures。
- **Alternatives considered**: 新增測試框架或以長時間 `sleep` 測截止時刻。Fake clock 可精確測 `< deadline`、`= deadline`、`> deadline`，較穩定。
- **Evidence**: `backend/tests/unit/buzzer-results.test.ts`；`backend/tests/unit/heartbeat.test.ts`；`backend/tests/support/test-server.ts`；`frontend/tests/e2e/teacher-phase.spec.ts`；root/backend/frontend `package.json`。
