---
name: self-heal
description: 自癒模式——修改 Harness 自身程式（先讀架構地圖＋用 codegraph，再依協定改、部署）。只在 _harness 工作區可用。
icon: heart-pulse
type: prompt
scope: self
---
你現在進入 **自癒模式（self-heal）**：要修改的是 **Harness／Hana 自己的平台程式**。請**嚴格按照下列協定**進行——不要憑感覺直接亂改（vibe coding），那會耗掉大量 token 又常常一次改不對。

## 先理解，再動手（SDD）
1. **讀架構地圖** `specs/ARCHITECTURE-portal.md`：定位這次任務該改哪個子系統、確認該區的**不變量與已知地雷**；對應細部規格在 `specs/SPEC-*.md`。
2. **讀自我修改政策** `portal/policy/self-modification.md`：確認鐵律（只改開發區、不碰 `.releases/`、git 由人類掌控）。
3. **用 codegraph 查影響面**（active workspace 已是 `_harness`，可直接用）：
   - `codegraph query <符號>` 定位、`codegraph impact <符號>` 看改了會影響誰。
   - 注意：很多 API 是 `portal/server.js` 大 handler 裡的**內聯區塊**，`codegraph callers` 對它們只回到 file 層級——這類 call site 要**補讀碼／`grep` 找齊，別漏掉**（上次 workspace bug 就是漏了 `reg.active` fallback）。

## 動手
4. 只改**開發區**（`portal/`、`docgraph/`、`*.ps1`），**絕不碰 `.releases/`**。
5. **自我驗證**：`node --check portal/server.js`；前端 inline script 可用 `new Function()` 檢查；必要時本地手測。
6. **上線**：執行 `Deploy_Harness.ps1`（快照→獨立 port 冒煙測試→晉升→監督者重啟→失敗自動回滾）。**不要手動重啟正式區、不要搬檔案套用。**
7. **回報**：只說「改了哪些檔、為什麼、影響面、驗證結果」，**不要把整段程式碼貼進對話**。
8. **留教訓**：若學到新的地雷/慣例，提醒指揮官用 `/memory` 記下、或更新 `specs/` 與架構地圖。

## 本次任務
{{args}}
