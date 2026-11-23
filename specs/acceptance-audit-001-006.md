# Features 001–006 合併與審查稽核

**盤點日期：** 2026-11-23（Asia/Taipei）

**範圍：** main 上的 Feature 001–006 任務狀態與相關 PR 的 GitHub 審查紀錄。

本文件補記驗收期間發現的歷史審查紀錄缺口，不改寫已合併 PR 的事件，也不將事後紀錄當成合併前核准。各功能的行為與測試證據仍以各自的 `specs/00x-*/quickstart.md` 為準。

## 合併狀態

- [PR #1](https://github.com/ncuyvonne/speckit-buzzer/pull/1)–[PR #8](https://github.com/ncuyvonne/speckit-buzzer/pull/8) 均已合併至 main。
- main 上 Feature 001–006 的 `tasks.md` 任務均已完成；Feature 004 的 T039 範本測試透過 PR #8 合併。
- PR #3–#6 與 [PR #8](https://github.com/ncuyvonne/speckit-buzzer/pull/8) 可查得合併前的 `APPROVED` review。
- [PR #7](https://github.com/ncuyvonne/speckit-buzzer/pull/7) 在最終文件提交前已有 `APPROVED` review；最後增加的提交只更新 Feature 006 的 T048 完成註記，之後合併。

## 歷史審查例外

專案憲章第 VI 原則要求子功能經 PR 審查後合併，詳見 [`constitution.md`](../.specify/memory/constitution.md#vi-子功能以獨立分支與-pull-request-合併)。

| PR | GitHub 可見紀錄 | 稽核處置 |
|---|---|---|
| [#1](https://github.com/ncuyvonne/speckit-buzzer/pull/1) | 2026-11-11 合併（`28e3633`）；GitHub review submissions 為空。 | 記錄為缺少正式審查紀錄。沒有證據可宣稱曾核准。 |
| [#2](https://github.com/ncuyvonne/speckit-buzzer/pull/2) | 2026-11-11 合併（`b170384`）；2026-11-11 09:07 UTC 有一筆 `CHANGES_REQUESTED`，未見後續 `APPROVED` review。該審查列出合併前待處理項目。 | 記錄為缺少最終核准證據；這不等同於證明修正未完成。 |

這兩筆是歷史流程例外。合併後新增的核准不能補成合併前核准，因此本稽核不建立或暗示事後核准。若課程或團隊要求所有 PR 都有合併前核准，應按例外處理並改善後續流程，而非回填審查狀態。

## 查核限制

本次 GitHub 整合無權讀取 main 的 branch protection（API 回傳 403），因此只確認 GitHub 可見的 PR review submissions；不對當時是否存在平台層級的分支保護規則作推斷。
