# Quickstart: 006 計時搶答與計分板

此文件提供 Feature 006 的本機驗收路徑。人工驗收步驟仍供課堂情境走查；自動化命令的實際結果記錄於本文末尾。

## Prerequisites

- Windows 本機 checkout，Node.js 24 LTS 及 npm；依 repo 根目錄使用 `npm install` 安裝 workspace 套件。
- 依 `.env.example` 設定本機 `GROUP_IDS` 與教師密碼。需要驗收 Google Sheets 匯入／匯出時，將 `GOOGLE_SERVICE_ACCOUNT_JSON` 設在後端環境；不要將憑證放進前端、WebSocket 訊息或版本庫。
- 不需 SQLite；Feature 006 活動只存在目前後端程序。
- 使用至少 3 個題目（含一個題組）及數字組別 `1,2,10`；可用多個瀏覽器分頁加入組別。端對端匯入沿用 Feature 002 disposable worksheet 流程。

## Start locally

在 repo 根目錄以兩個終端機執行：

```powershell
npm run dev --workspace @speckit-buzzer/backend
```

```powershell
npm run dev --workspace @speckit-buzzer/frontend
```

開啟 loopback 前端；老師登入後匯入測試學習單，學生分頁加入不同組別。Google Sheets 測試使用 disposable 學習單，避免修改正式課堂資料。

## Acceptance walkthrough

1. **準備及時限輸入**：老師輸入 0、1、3600 秒皆接受；負數、小數及 3601 顯示可理解錯誤，原設定不變。0 顯示不限時且搶答中不倒數。
2. **倒數與自動結束**：設定短時限開始搶答。老師與學生均收到倒數更新；期限到達後 1 秒內看到活動已結束。重新連線在 BUZZING 時從快照恢復正確剩餘秒數。
3. **截止邊界**：以後端注入時鐘分別在 deadline 前 1 ms、等於 deadline、及 deadline 後 1 ms 提交同一組有效答案。前者依正常規則接受；等於及之後皆拒絕且不新增鎖定、順位或 N。此驗收不以瀏覽器時鐘作權威。
4. **老師手動結束**：在倒數中由老師結束；已接受答案保留、timer 停止、後續提交被拒絕。單元測試模擬取消後舊 callback 已排隊、重設並開始新一輪，確認舊 callback 不會結束新一輪。
5. **人工判定及排行榜**：活動結束且有 winners 後，老師將一題標對得 1 分、改錯減回 0、再標對、取消至未標記；每次老師與學生計分板都只反映最新判定。無 winner 題及未結束階段拒絕標記。
6. **平手排序**：建立分數與成功題數均相同的組別，確認按組別編號作最後排序；數字字串 `2` 排在 `10` 前。所有名冊組別含 0 分組都出現一次。
7. **本組進度與隱私**：BUZZING 時確認畫面文字為「本組已送出 N / 總題數」；已接受單題加 1，題組只加 1，空白／重複／逾時提交不增加 N。檢查學生初始快照、廣播、拒絕訊息都沒有其他組資料；PREPARING／ENDED 隱藏進度提示。
8. **重設確認及取消**：老師選擇重設時確認對話說明保留學習單／題目及會清除的答案、勝出、標記、分數與時限。取消後所有資料及 ENDED 不變；確認後回 PREPARING、保留學習單／題目，清空本場作答與計分且時限歸零。
9. **重新匯入**：重設後成功匯入另一份學習單，確認題號與總題數換新、時限為 0、舊標記及作答不再出現。用無效／不可讀學習單匯入失敗，確認目前學習單及狀態沒有部分替換或清除。

## Automated validation commands

在 repo 根目錄執行：

```powershell
npm run test --workspace @speckit-buzzer/backend
npm run test --workspace @speckit-buzzer/frontend
npm run test:e2e
npm run typecheck
npm run build
```

deadline 邊界、計時回呼與手動結束競態、改標／取消及平手排序由 Vitest 驗證；WebSocket 授權／投影／重新匯入由 backend integration tests 驗證；確認／取消重設、計時畫面及學生可見性由 Playwright 驗證。下方記錄自動化結果；第 1–9 項課堂走查仍須使用實際學習單完成。

## 實際自動化驗證結果

執行日期：2026-11-22。以下為本次 Feature 006 實作分支的實際結果：

| 命令 | 結果 |
|---|---|
| `npm run test` | 退出碼 0；基於最新 main 的前端 6 個測試檔、33 個測試通過（含匯入後前端狀態清除回歸測試）；後端 37 個測試檔、219 個測試通過。整合測試需允許 loopback WebSocket 連線。 |
| `npm run test:e2e` | 退出碼 0；Playwright 48/48 通過。合併 004/005 後，將兩處受倒數狀態影響的連線測試改為精確文字定位，再完整重跑通過。 |
| `npm run typecheck` | 退出碼 0；前後端 TypeScript 檢查通過。 |
| `npm run build` | 退出碼 0；Vite 前端產物及後端 TypeScript 編譯通過。 |
| PlantUML 圖表重產 | PlantUML 1.2026.10 搭配 Java 21；四張 Feature 006 PNG 由目前 `.puml` 來源產生並檢視。 |

Google Sheets 的實際外部匯入仍使用 disposable worksheet 由課堂管理者走查；自動化整合測試以 adapter stub 驗證成功與失敗時的清除邊界。
