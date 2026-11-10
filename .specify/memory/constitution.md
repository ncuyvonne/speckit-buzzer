<!--
Sync Impact Report
- Version change: uninitialized template → 1.0.0
- Modified principles: template placeholders → seven principles from the project instruction list
- Added sections: Project Scope and Security; Development Workflow and Quality Gates
- Removed sections: none
- Follow-up TODOs: confirm the original ratification date
-->

# 課堂搶答系統 Constitution

## Core Principles

### I. 輸入驗證與清楚錯誤
所有功能 MUST 驗證外部輸入及操作前提，涵蓋正常格式、缺漏值、範圍與狀態限制。驗證失敗時 MUST 回傳能指出問題及修正方向的清楚錯誤訊息，不得靜默忽略或以不相關的成功訊息掩蓋錯誤。這能讓使用者理解如何恢復，也能避免無效資料進入共享狀態。

### II. 機敏資料不得進入程式碼與版本庫
金鑰、token、密碼及其他機敏憑證 MUST 僅由環境變數提供；MUST NOT 寫入程式碼、一般文件、log 或 repo。專案 MUST 提供不含真實憑證的 `.env.example`，並將 `.env` 列入 `.gitignore`。log MUST 遮蔽機敏值。這能降低憑證外洩及誤提交風險。

### III. 每項功能須有正常與邊界案例測試
每項功能至少 MUST 有一個正常案例及一個邊界案例測試。功能完成時，負責者 MUST 執行相關測試，並回報可重現的測試指令與實際結果；未執行的測試 MUST 明確標示未執行，不得宣稱通過。測試範圍須對應該功能的輸入、狀態轉換及錯誤情況。

### IV. 共享狀態與時間以伺服器為準
多人共享的狀態、事件順序與時間判定 MUST 由伺服器決定。伺服器 MUST 驗證用戶端提出的操作與狀態轉換，不得信任用戶端提供的時間或成功結果作為權威依據。這能讓所有連線使用者看到一致且可判定的結果。

### V. 程式碼與文件保持一致
規格、設計文件、操作說明與實際程式行為 MUST 一致。若實作與文件不符，合併前 MUST 修正實作或更新文件，並在審查中核對一致性。文件不得將未實作、未驗證的行為描述為已完成。

### VI. 子功能以獨立分支與 Pull Request 合併
每個子功能 MUST 在獨立 branch 開發，並透過 Pull Request（PR）審查後合併。PR MUST 說明變更內容及測試結果；合併前 MUST 確認變更符合本憲章及該功能規格。這讓功能變更可追蹤，也便於團隊檢查與回復。

### VII. PlantUML 設計優先
每個子功能在 `speckit.specify` 階段 MUST 使用 PlantUML 產生組件圖、類別圖及時序圖，`.puml` 原始檔 MUST 存放於 `./diagrams/`，並在檔名前加上子功能編號。圖檔建立後 MUST 使用 PlantUML CLI `java -jar plantuml.jar "./diagrams/*.puml"` 產生 PNG，並與原始檔存放於同一目錄。`speckit.plan` MUST 以這些圖表作為架構與組件規劃的主要藍圖；`speckit.implement` 完成後 MUST 驗證程式碼與圖表一致，若不一致 MUST 更新相應設計或實作。圖表讓規格、規劃與程式碼之間有可檢查的共同依據。

## Project Scope and Security

本系統為學生專題，MUST 僅在本機執行。專案功能、資料處理及開發方式 MUST 符合本憲章；若後續需求與憲章衝突，須先依 Governance 程序修訂憲章，或調整需求，不得默默偏離原則。

## Development Workflow and Quality Gates

每個子功能 MUST 依序完成規格、釐清、規劃、任務拆解、跨文件分析、實作及收斂檢查。進入實作前，必須確認需求、設計圖與計畫相符；合併前須完成適用測試、圖表一致性檢查、文件一致性檢查及 PR 審查。完成狀態與測試結果 MUST 根據實際證據回報。

## Governance

本憲章是本專案規格、規劃、實作與審查的治理依據。任何成員均可提出修訂；修訂 MUST 透過 PR 說明理由、影響的原則及相應版本變更，經專題團隊審查同意後合併。涉及原則或流程的變更 MUST 在合併前更新本文件。

版本採語意化版本 `MAJOR.MINOR.PATCH`：移除或重新定義既有原則、造成向後不相容的治理變更時升 MAJOR；新增原則／章節或實質擴充規範時升 MINOR；不改變治理含義的澄清、措辭或錯字修正時升 PATCH。每次修訂 MUST 更新版本與最後修訂日期。

所有規格、計畫、實作與 PR MUST 檢查是否符合本憲章。審查者 MUST 核對適用原則的證據，包括測試結果、憑證處理、伺服器權威性、文件一致性、分支與 PR 流程，以及 PlantUML 圖表與實作的一致性；不符合項目須在合併前修正或先完成憲章修訂。

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): 請確認憲章原始核准日期 | **Last Amended**: 2026-11-10
