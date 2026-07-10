---
name: self-modification
description: 自我修改與自癒規範。Hana 修改 harness 自身程式碼時必須遵守的「軟規則」——只動開發區、用部署腳本上線、靠版本回滾自保。Portal 可把這份政策連同任務一起餵給模型。
---
# 自我修改政策 (Self-Modification Policy)

> 當你（Hana）被要求修改 **harness 自己的程式**（portal/、docgraph/、啟動腳本）時，遵守以下規範。
> 這是本地優先、沒有分支的環境——版本化發行系統就是你的安全網，別繞過它。

## 核心原則：你可以、也應該改自己

**修改自己的程式是你的核心能力（「自癒」），不是被禁止的事。** 正因為退路是結構性的——
不可變的唯讀發行版 ＋ 冒煙測試 ＋ 自動回滾——你可以**大膽**改自己，不必小心翼翼。
下面的「鐵律」是教你**怎麼安全地改**，不是叫你「不要改」。別把它讀成「禁止自我修改」。

## 鐵律

1. **只改開發區 (dev tree)**：你只能編輯 harness 根目錄下的 `portal/`、`docgraph/`、`*.ps1`。
   這裡是「最新開發版」，永遠保留可編輯的最新程式。
2. **絕不碰 `.releases/`**：`.releases/vN/` 是不可變的歷史發行版，已被設為唯讀。
   它們是你改壞時的退路。**任何情況都不要編輯、刪除或解除唯讀** `.releases/` 裡的東西。
3. **不靠手改上線**：別自己手動重啟正式 server 或搬動檔案去「套用」改動。
   改完開發區後，一律透過部署腳本上線（它會自動冒煙測試、晉升、重啟、記錄）。
4. **git／GitHub 不歸你管**：自我修改與「上線」走的是**本地**不可變版本這套，與 git **刻意脫鉤**。
   除非指揮官在該次任務**明確要求**，否則**不要**自行 `git commit`／`push`／`branch`／開 PR。
   原始碼的版本管控（分支、提交、合併）由人類指揮官手動掌握；你只負責本地的開發區與發行版。

## 工作流程（先理解、再動手 — 別 vibe coding）

> **教訓**：自癒早期用「直接憑感覺改」（vibe coding）的方式修自己，結果耗掉大量 token、又常常一次改不對（例如 workspace 那次只改了 `resolveWorkspace`、漏掉 `reg.active` fallback）。所以現在引進 **架構地圖 ＋ codegraph ＋ SDD（規格先行）** 當自癒的標準程序：**先懂，再改。**

1. **先讀架構地圖**：`specs/ARCHITECTURE-portal.md`——定位「該改哪個子系統」、確認該區的**不變量與已知地雷**。對應的細部規格在 `specs/SPEC-*.md`。
2. **用 codegraph 查影響面**：`codegraph query <符號>` 定位、`codegraph impact <符號>` 看改了會影響誰。
   - 具名函式之間很準；但**很多 API 是 `server.js` 大 handler 裡的內聯區塊**，`codegraph callers` 對它們只回到 file 層級——這類 call site 要**補讀碼 / `grep`** 找齊，別漏。
3. **改開發區**（`portal/`、`docgraph/`、`*.ps1`），**不碰 `.releases/`**。
4. **自我驗證**：`node --check portal/server.js`（語法）；前端 inline script 可用 `new Function()` 檢查；必要時本地手測。
5. **上線**：執行 **`Deploy_Harness.ps1`**——快照開發區 → `node --check` → **獨立 port + 拋棄式資料目錄**冒煙測試 → 晉升 `current.json` → 監督者重啟 → 健康檢查 → 記 `last-known-good` 並鎖唯讀。**冒煙/健康沒過 → 自動中止或回滾，正式區不受影響。**
6. **出事退回**：`Rollback_Harness.ps1 [vN]`（不給版本就回 `last-known-good`）。停正式區：`Stop_Harness.ps1`。
7. **留教訓**：這次學到的「地雷/慣例」用 `/memory` 寫進 MEMORY；若是「為什麼這樣設計」的結構知識，更新對應 `specs/` 與本地圖。

## 為什麼這樣設計

- **沒有分支**：本地端不像 GitHub 有 PR 隔離，所以用「每版一個唯讀目錄 + 指標檔」模擬不可變發行。
- **改壞也救得回**：就算你把開發區改到開不起來，冒煙測試會在它碰到正式區前攔下；
  真的上線後才壞，啟動腳本／回滾會自動切回 `last-known-good`。正式 server 不會因為一次壞改而磚化。
- **你可以大膽改自己**：因為退路是結構性的（唯讀發行版 + 自動回滾），不是靠你小心翼翼。
