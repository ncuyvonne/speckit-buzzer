# Implementation Plan: 006 計時搶答與計分板

**Branch**: `codex/006-timed-scoring`（已建立並用於 Feature 006 實作） | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: 使用者指定 React、TypeScript、Vite、Node.js、WebSocket、Google Sheets API、Vitest 與 Playwright；活動狀態可採記憶體或 SQLite，且本計畫必須以 `diagrams/` 圖表為藍圖。

## Summary

在現有本機課堂搶答應用程式中加入限時、截止判定、教師人工正誤標記與計分板、學生本組作答進度，以及可確認的活動重設。後端以伺服器時鐘及現有 WebSocket 階段同步為準；時限、答案、標記及成績沿用目前單一活動的程序記憶體生命週期。Google Sheets 匯入仍使用既有後端整合；本功能不新增 Sheets 存取路徑或憑證。

## Technical Context

**Language/Version**: TypeScript 5.9、Node.js 24 LTS 型別環境、React 19.3。

**Primary Dependencies**: 現有 Vite 8、`ws` 8.18、`googleapis` 189；測試使用 Vitest 5 與 Playwright 1.63。Feature 006 不新增執行期依賴。

**Storage**: 後端程序記憶體；沿用單一 ActivityState、Map 型作答記錄及服務建構注入。重設或成功重新匯入會清除本場結果；程序重啟不復原活動、倒數、標記或分數。

**Testing**: 後端與前端單元／整合測試使用 Vitest；瀏覽器端對端流程使用 Playwright。使用可注入時鐘及 Vitest fake timers 驗證截止邊界；實際 E2E 只驗證短時限的畫面與階段同步。

**Target Platform**: Windows 本機課堂應用；Vite 與 Node.js 服務沿用 loopback。只有既有後端 Google Sheets adapter 會呼叫 Google Sheets API；憑證由後端環境變數提供。

**Project Type**: npm workspaces 全端 Web 應用程式，`frontend/` 為 React/Vite，`backend/` 為 Node.js/WebSocket。

**Performance Goals**: 正常本機連線時倒數、結束階段及教師標記後計分板在規格指定的 1 秒內反映；自動歸零後 1 秒內連線畫面顯示已結束。驗收以實際班級連線數執行，不另設產品人數上限。

**Constraints**: 時限僅接受 0–3600 的整數秒；0 不啟動倒數。截止判定、接受序列、標記授權及階段轉換由後端決定。學生搶答中只可取得本組作答進度。活動重設須先由老師確認，並保留學習單及題目。

**Scale/Scope**: 一個伺服器程序內的一場活動；沿用既有組別名冊及最多 100 個匯入主題的範圍。題組已在匯入時視為單一主題。

## Constitution Check

| 原則／Gate | 規劃證據 | 狀態 |
|---|---|---|
| I. 輸入驗證與清楚錯誤 | 計時設定、階段、角色、題目勝出狀態與重設確認均由後端驗證；契約列出錯誤回應。 | PASS |
| II. 機敏資料 | 不增加憑證；Sheets API 沿用後端環境變數與既有 adapter。倒數及作答內容不寫入 log。 | PASS |
| III. 正常與邊界測試 | 規劃正常流程、0／1／3600 秒、截止前／等於／之後、手動結束、改標取消、同分及重設確認／取消案例；實際 Vitest、Playwright、型別檢查與建置結果列於 `quickstart.md`。 | PASS（已驗證） |
| IV. 共享狀態與時間以伺服器為準 | 時限、答案截止、活動階段、成功組別、判定與計分均由後端保存及投影；前端只顯示伺服器更新。 | PASS |
| V. 程式碼與文件一致 | Phase 1 資料模型、WebSocket 契約及測試案例對照四張 Feature 006 PlantUML 圖；實作偏離時須同步更新圖與文件。 | PASS |
| VI. 獨立分支與 PR | Feature 006 實作於以最新 `main` 為基礎的獨立分支 `codex/006-timed-scoring`；PR #6 已建立並向 `mini-duan` 要求審查。 | PASS（等待審查核准） |
| VII. PlantUML 設計優先 | 四張 `diagrams/006-timed-scoring-*.puml` 為服務邊界、資料關係及訊息順序的藍圖；PNG 已由目前來源產生並檢視。 | PASS |
| 本機執行範圍 | 沿用 loopback；不新增遠端部署、資料服務或第二個應用程式。 | PASS |
| 開發流程 | 規劃完成後再執行 `$speckit-tasks`、跨文件分析、實作與收斂；此計畫不建立 `tasks.md`。 | PASS |

**Pre-design gate**: PASS。規格與憲章沒有未解衝突；研究已選定既有記憶體生命週期，無待解技術選項。

## Project Structure

### Documentation (this feature)

```text
specs/006-timed-scoring/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── realtime-websocket.md
└── tasks.md                 # 由 $speckit-tasks 建立，不屬於本階段
```

### Source Code (repository root)

```text
backend/src/
├── domain/
│   ├── activity-state.ts          # 延伸時限與確認後重設的階段狀態
│   ├── activity-timer.ts          # 新增後端倒數、到期與取消控制；世代識別可排除舊 callback
│   ├── buzzer-results.ts          # 截止檢查、既有提交及本組進度投影
│   └── scoring.ts                 # 新增人工判定與計分板投影
├── realtime/
│   ├── protocol.ts                # 新增訊息解碼、驗證及錯誤碼
│   └── handler.ts                 # 教師授權、廣播及角色／階段投影
├── guided-notes/service.ts        # 僅在成功匯入後通知活動資料清理
└── server.ts                     # 組合計時與計分服務並在關閉時停止計時器

backend/tests/
├── unit/                          # 狀態、時限、計分與協定測試
└── integration/                   # WebSocket 角色、廣播、重設及匯入案例

frontend/src/
├── realtime/messages.ts           # 新增伺服器與客戶端訊息型別
├── realtime/client.ts             # 解碼倒數、計分板與重設更新
├── state/activity.ts               # 保存時限、倒數及重設後階段
├── state/buzzer-results.ts        # 保存教師判定、計分板與本組進度
├── components/TeacherPanel.tsx    # 時限設定、階段控制及重設確認入口
├── components/BuzzerAnswerPanel.tsx # 本組 N / 總題數提示
├── components/TeacherScoringPanel.tsx # 教師判定、改標／取消及計分板
└── components/StudentScoreboardPanel.tsx # 活動結束後學生計分板

frontend/tests/
├── unit/                           # 元件與 WebSocket client 狀態測試
└── e2e/                            # 計時、標記、重設及學生可見性流程
```

**Structure Decision**: 沿用既有 `backend/`、`frontend/` npm workspaces 和 WebSocket hub。伺服器網域服務保有權威狀態，`RealtimeHub` 負責授權及依角色傳送投影，React 元件呈現其資料。Google Sheets 匯入及憑證處理留在 Feature 002 的後端邊界。

## Phase 0: Research Summary

研究決策、依據與替代方案詳見 [research.md](./research.md)。選擇與目前單場記憶體活動生命週期一致，不新增 SQLite；截止檢查放在同步答案接受路徑，避免計時回呼與答案事件的處理順序造成歧異。

## PlantUML Blueprint Alignment

使用者要求 `./diagrams/` 圖表作為 plan 藍圖。以下四張圖是 Phase 1 設計及後續實作的共同依據，不能把它們當成事後插圖：

| PlantUML 圖 | 設計責任 | 對應規劃 |
|---|---|---|
| `diagrams/006-timed-scoring-component.puml` | 老師、學生、課堂介面、即時連線、活動、計時、搶答結果、計分與名冊的責任邊界。 | 本計畫的 source structure、服務組合、角色授權及即時投影。 |
| `diagrams/006-timed-scoring-class.puml` | Activity、時限、接受答案、每題勝出結果、正誤標記、組別名次與本組進度之關聯。 | [data-model.md](./data-model.md) 的欄位、唯一性、清除及排序規則。 |
| `diagrams/006-timed-scoring-sequence-timer.puml` | 設定、開始、伺服器截止、老師手動結束及截止附近答案的判定順序。 | [realtime-websocket.md](./contracts/realtime-websocket.md)、截止線性化點及 timer 測試。 |
| `diagrams/006-timed-scoring-sequence-scoring.puml` | 人工標記、改標／取消、師生計分板更新、確認／取消重設及成功／失敗匯入。 | WebSocket 契約、計分服務、活動重設與端對端驗收。 |

實作若改變任何箭頭、投影或生命週期，須同步更新 `.puml`、配對 PNG、資料模型、契約與測試說明。

## Design Decisions and Operation Boundaries

1. **活動生命週期**：沿用單一 `ActivityState`。在準備中設定時限；開始時建立伺服器截止狀態；手動結束或到期後進入已結束。老師確認重設才由已結束回到準備中，保留 worksheet/questions 及公平順位設定並清空本場答案、勝出、標記及計分；重設將時限歸零。
2. **計時及截止**：新增後端計時服務持有排程，開始時保存截止時刻並推送整秒剩餘時間；timer callback 捕捉該次啟動的世代／deadline，只有世代仍相同、deadline 仍有效且活動仍為搶答中時才能結束活動，避免取消後已排隊的舊 callback 結束新一輪活動。手動結束及重設都取消排程並遞增世代。未設時限時不排程、畫面顯示不限時。
3. **唯一答案接受點**：在 `BuzzerResultsService.submitAnswer` 的同步檢查／插入操作中只取一次伺服器接收時間；當時間大於或等於截止時刻即拒絕，且不鎖題、不建立提交、不改勝者、不增進度。截止檢查在任何答案狀態變更之前，不能依賴到期計時器回呼是否先執行。
4. **人工判定與分數**：新增計分服務，只接受已驗證老師在已結束階段對有勝出組別的題目標記 CORRECT、INCORRECT 或清除標記。每題最多一個現行判定；分數由 CORRECT 標記數推導，不保存重複加總。系統不比對答案內容。
5. **計分板投影**：每個設定組別均出現（含零分）；依得分降冪、成功題數降冪、組別編號升冪排序。成功題數取自勝出結果，不受正誤標記影響。只在已結束時給老師及學生查詢或接收更新。
6. **學生進度及資訊隔離**：沿用目前本組 ownProgress 題目清單；以不同頂層 question 的 `submitted` 數計 N，題組已是一個頂層題目。只有本組進度及總題數送給學生；教師完整進度與其他組答案不得混入學生投影。
7. **重新匯入**：沿用 `GuidedNotesService.importWorksheet` 及其原子驗證流程。只有匯入成功提交後才清除舊活動作答／計分並將時限設回 0；公平順位設定保留不變，再更新題目清單及教師進度。匯入失敗不清除或替換現有資料。Sheets API 路徑不變。
8. **瀏覽器確認**：老師選擇重設後，確認介面列出保留的學習單／題目與會清除的本場資料。只有明確確認才傳送重設訊息；取消不送出訊息，後端仍獨立驗證老師角色及已結束階段。
9. **程序生命週期**：活動、倒數、答案、判定與計分都放在本程序記憶體；新程序不復原前一程序。這與現有 worksheet／答案生命週期一致，不承諾程序重啟復原。

## Phase 1: Design Artifacts

- [data-model.md](./data-model.md)：活動時限、截止、提交、判定、成績及本組進度欄位與關係。
- [contracts/realtime-websocket.md](./contracts/realtime-websocket.md)：新增 WebSocket 命令、事件、權限、階段、投影及錯誤。
- [quickstart.md](./quickstart.md)：本機執行、可重現的計時／判定／重設流程及 Vitest／Playwright 命令。

## Validation Plan

實作階段應擴充現有 Vitest／Playwright 測試，不另建測試框架：

- **Activity／timer 單元**：時限 0、1、3600 和非法數值；開始、每秒剩餘值、到期一次結束、手動結束取消排程、重設歸零、取消後舊世代 callback 不得結束重設後新一輪，以及到期回呼不重複轉換。
- **答案服務單元**：有效答案在截止前接受；接收時間等於／晚於截止均拒絕；無論 timer 回呼先後都不得於截止後鎖題或改勝者；截止前已有提交仍保留。
- **計分單元**：只有老師可標記勝出題；無勝者、錯階段拒絕；對→錯、錯→對及清除只留一個判定；零分組與兩層同分按第三層組別編號穩定排序。
- **WebSocket 整合**：計時設定及重設授權、timer/phase 廣播、teacher progress 判定欄位、師生 scoreboard 更新與 ENDED 重連查詢；確認學生不會收到其他組進度或答案。
- **匯入整合**：成功匯入更新題數、進度分母及清除活動結果；解析／Sheets 失敗保留現有活動；不改變既有 service-account 環境變數邊界。
- **Playwright**：準備階段設定時限，開始後學生看到倒數與 N / 總題數，歸零後自動結束且遲到答案拒絕；老師手動結束；結束後標記、改標、取消和計分板；重設確認與取消；學生結束後能看榜且搶答中沒有其他組資料。

建議實作驗收命令列於 [quickstart.md](./quickstart.md)。本規劃階段沒有執行測試。

## Risks and Bounded Assumptions

- **程序重啟**：選用記憶體表示活動重啟時答案、計時及標記皆不復原；如未來需要崩潰復原或重啟後繼續活動，須另行決定持久化及 timer 恢復規則，再評估 SQLite。
- **截止與畫面延遲**：伺服器截止檢查是權威；客戶端倒數更新或 phase 廣播延遲不能延長答案接受期限。
- **到期排程延遲**：Node.js 計時回呼可能受事件迴圈忙碌影響；答案服務仍以截止時刻拒絕。timer callback 以世代及 deadline 驗證有效性，避免到期回呼延遲至重設後新一輪才執行；已結束階段也不得被重複改變。
- **重新匯入原子性**：清理只接在成功匯入提交後；清理與新題目更新須在對外發送新快照前完成，失敗時不得部分清除。
- **名次與分數**：成功題數及分數都由目前勝出結果及現行判定重算，避免改標／清除時累加狀態漂移。
- **本機時鐘及網路**：瀏覽器顯示使用伺服器提供的剩餘秒數更新；瀏覽器時鐘不參與收件截止判定。

## Post-Design Constitution Check

| 原則／Gate | Phase 1 設計證據 | 狀態 |
|---|---|---|
| I. 輸入驗證與清楚錯誤 | WebSocket 契約定義時限格式、角色／階段及勝者檢查與拒絕碼；匯入沿用原子驗證。 | PASS |
| II. 機敏資料 | 仍只從後端環境變數讀取 Sheets service account；不傳憑證、不記錄作答內容。 | PASS |
| III. 正常與邊界測試 | `quickstart.md` 列有單元、整合、瀏覽器正常及邊界流程，並記錄本次執行結果。 | PASS |
| IV. 伺服器權威 | 截止、階段、提交、成功結果及分數由後端決定；學生只收本組進度及已結束計分板。 | PASS |
| V. 文件一致性 | 四張 006 圖均對應 data model、WebSocket 契約及驗收流程；實作偏離需一起更新。 | PASS |
| VI. 分支與 PR | Feature 006 於目標分支實作；PR #6 已開啟並要求 `mini-duan` 審查，核准前不合併。 | PASS（等待審查核准） |
| VII. PlantUML 優先 | 藍圖表逐圖列出訊息順序、資料欄位及服務映射；四張 PNG 已由目前來源重新產生並檢視。 | PASS |
| 本機執行範圍 | 保持 loopback，Google Sheets API 只經既有後端 adapter。 | PASS |
| 開發流程 | tasks、analyze 與 implement 已完成；最新 main 上的 Vitest、Playwright、型別檢查、建置及圖表已驗證；PR 審查待完成。 | PASS（等待審查核准） |

**Post-implementation gate**: 實作與自動化驗證 PASS；四張圖已更新。PR #6 已開啟並要求審查；取得核准前不合併。

## Complexity Tracking

沒有憲章例外或新增應用程式／資料庫。新增計時控制及計分網域責任，使用既有活動、WebSocket、角色投影和測試工作區；SQLite 持久化不在 Feature 006 範圍。
