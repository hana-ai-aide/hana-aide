---
name: task
description: 執行 worktable 路線圖的一個任務（讀 spec → 做 → 自測 → 該 Deploy 就 Deploy → 依勾選協定收尾）。
icon: check-square
type: prompt
---
你要執行 worktable 裡的任務：**{{args}}**

這是把「執行一個任務」的標準做法固化成技能。請嚴格照這套流程，不要憑感覺亂做。

## 1. 定位
- 讀 `.worktable/TASK.md`，找到 `{{args}}` 這條任務：確認它屬哪個 phase、要產出什麼、驗收條件。
- 讀它對應的 `specs/SPEC-*.md`（任務描述通常會指）。
- **判斷類型**：
  - **純內容**（改 `presentations/`、docs、skill、`.md` 等）→ **免 Deploy**（存檔即生效）。
  - **平台程式**（改 `portal/server.js`、`portal/index.html`、`*.ps1` 等）→ **要 Deploy**；先讀 `specs/ARCHITECTURE-portal.md` 的「已知地雷」，並用 codegraph/grep 定位符號。

## 2. 做
- 守鐵律：只改開發區（`portal/`、`docgraph/`、`*.ps1`、`specs/`、`presentations/`…），**絕不碰 `.releases/`**；**git 由人類掌控**（不自行 commit／push／branch，除非指揮官明確要求）；別把大段瀏覽器 JS 寫進 `server.js` 的 template literal（跳脫地雷）。
- 規格不清或自相矛盾 → **停下來問**，不要猜了亂做。
- **前置護欄擋下、沒動工就停**（相依上游未驗收、等核准的破壞性動作…）：這是合法的「受阻」，不是失敗也不是完成。**報告結尾務必附一行機器可讀標記**，讓排程面板顯示 amber ⚠「受阻·待你」而非綠色成功（見 `specs/SPEC-schedule-status.md`）：
  `<run-outcome status="blocked" reason="一句話說明卡在哪、要指揮官做什麼決定" />`

## 3. 自測
- 平台 JS：`node --check`；前端 inline script 可用 `new Function()` 檢查；必要時本地手測。
- 內容（簡報等）：實際 render／播放確認、F12 console 乾淨。

## 4. 上線（僅平台程式需要）
- 跑 `Deploy_Harness.ps1`（快照 → 獨立 port 冒煙 → 監督者重啟 → 失敗自動回滾）。**不要手動重啟正式區、不要搬檔案套用。** 純內容免 Deploy。

## 5. 收尾（依「任務勾選協定」）
- 自測通過後，把 `.worktable/TASK.md` 的 `{{args}}` 由 `[ ]` 改成 `[x]`。
- 在 `.worktable/DASHBOARD.md` 記一行成果（做了什麼、驗證結果、版本）。
- 該 phase 結尾的「🧑‍✈️ 指揮官手動驗證」**留空、不可自勾**（那是指揮官驗收用）。
- **結構自檢（fail-closed，不靠記性）**：只要這次動過 `TASK.md`，收尾前**強制跑**
  `python portal/render-service/worktable-archive.py --lint`。
  - **紅了（exit 1）＝不准收尾**：錯位／段被切斷／孤兒階段當場修到綠（通常是把階段搬回 ID 前導字母所屬的 `# 代號.` 段——絕不接檔尾；規則見 `global-knowledge/worktable-convention.md §1.1`），再重跑 lint 確認 ✅ 才算完成。
  - 這步是「寫入即自檢」：錯位是在改 TASK 的當下造成的，所以就在當下擋掉，不留到日後 `/task-archive` 才發現。

## 6. 回報
- 只說：改了哪些檔、為什麼、影響面、驗證結果。**不要把整段程式碼貼進對話。**
- 學到新地雷／慣例 → 提醒指揮官用 `/memory` 記下，或更新 `specs/` 與架構地圖。
