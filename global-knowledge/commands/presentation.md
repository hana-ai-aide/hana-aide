---
name: presentation-rules
description: 簡報通則（所有 HTML 簡報必須遵循的規範，可被各專案的 deck 技能繼承）
icon: presentation
type: prompt
---
# 簡報通則（Presentation Rules）

製作任何新簡報前，先讀 `specs/SPEC-presentation-core.md`（deck 合約第 3 節）與 `specs/ARCHITECTURE-portal.md`（地雷區）。本文件是設計紀律與投放規則；技術接線看 SPEC，不在這裡重複。

---

## 1. 架構：一定要用 presentation-core

所有新 deck 一律採用「注入式共享框架」：

```html
<head>
  <!-- deck 專屬 <style>，在 core.css 前 -->
  <link rel="stylesheet" href="/raw?path=portal/presentation-player/presentation-core.css">
</head>
<body>
  <div class="presentation-viewport" id="viewport" data-subtitle="副標">
    <header>…</header>
    <main class="slides">
      <section class="slide title-slide" data-transcript="逐字稿">…</section>
      <!-- 更多 <section class="slide" data-transcript="…"> -->
    </main>
  </div>
  <script src="/raw?path=portal/presentation-player/presentation-core.js"></script>
</body>
```

**鐵則：一個 deck 只能有一套播放引擎。** 禁止在 deck 內自帶縮放、切片、TTS、全螢幕、浮動頭像或控制列 HTML——這些都由 `presentation-core.js` 與 `hana-overlay.js` 提供。`PresentationPlayer` class 已淘汰，勿再使用。

---

## 2. 設計紀律：一圖二表三文字

每張投影片的內容選型，按優先順序：

1. **一圖**：先理解要表達的概念，優先用架構圖、流程圖、關係圖或狀態圖。CSS 純文字圖也算（用 `<pre>` 或 ASCII art + 搭配 `monospace`）。
2. **二表**：有比較關係時優先用表格（如三個 LLM 特點對比、Hana 與其他 agent 的差異、功能對照）。
3. **三文字**：文字只作輔助標籤與關鍵句，不能把講稿直接拆成條列塞滿版。

### Action Title

每張投影片的 `<h2>`（或 `<h1>`）是行動標題（action title）——陳述這張投影片的**結論或論點**，而非只是話題標籤。

- ✅ `訂閱帳號橋接讓我不需要 API Key`
- ❌ `API Key 問題`

### 一圖一意

一張圖只傳遞一個概念。複雜概念拆成多頁，不要把三件事擠進一張圖。

---

## 3. 語音與發音規則

- **人名與工具名保留英文原文**，讓 TTS 以英文發音：老闆、Claude、Gemini、Codex、Hermes、OpenClaw、PilotDeck、CLI、API Key、Portal 等。
- **Hana 在講稿保留英文「Hana」**：Edge 的 TTS 發音自然，**不要**改寫成中文「哈娜」（改中文反而怪）。
- **第一人稱講稿**：`data-transcript` 一律用「我」或「Hana」當主詞，不要寫成「老闆想怎麼做」或「Hana 她……」。
- **盡量中文化**：講稿避免中英文夾雜（尤其是同一句話內中英交替），以免 TTS 語調混亂。英文詞若有確定好唸的中文替代，優先用中文。
- **標點符號不入講稿**：`data-transcript` 裡禁止出現會被唸出來的符號，尤其 `/` 與全形 `／`（TTS 會唸成「斜線」）。投影片**畫面上**要顯示 `portal/commands`、`/deck`、`R/F/SPEC` 都沒問題，但**講稿要改寫**：路徑說成「portal commands 資料夾」、斜線指令說成「deck 指令」、`A/B` 說成「A 或 B」「A 到 B」。同理避免講稿寫進 `\`、`|`、`~`、`*`、`#`、`>` 等會被唸出或干擾語調的符號。

---

## 4. 誠實標註靈感來源

介紹 Hana 的能力時，若某個超能力有借鑑既有工具或論文，在 comparison bar 或備忘稿中標明：

- 靈感來源（如 Hermes agent、PilotDeck、OpenClaw）
- 做了什麼改善或差異
- 若功能仍在進化（如長期記憶），誠實說明現況、不誇大。

---

## 5. 結尾預告慣例

每集最後一頁是「下一集預告」，包含：

- 下一集標題與一句話摘要
- TTS 旁白（`data-transcript`）導覽下一集內容
- 跳轉按鈕（`<a href="presentation-hana-episodeN.html">`），由 core 處理 iframe/raw/file 三種模式

每集播到最後一頁即停止，不自動從頭重播。

---

## 6. 輸出與命名

- **位置**：`presentations/` 資料夾，檔名 `presentation-<主題>.html` 或 `presentation-hana-episodeN.html`。
- **新檔免 Deploy**：`presentations/` 是 `/raw` 的 HARNESS_HOME fallback，放進去即出現在選單。
- **去識別化**：專案名稱若未授權公開，改稱「Side Project」或「測試專案」，不寫真實客戶或專案代號。

---

## 7. 交付前檢查清單

在回報任務完成前，逐項確認：

- [ ] deck 只有一套播放引擎（無 `PresentationPlayer`、無自帶 `adjustScale`、無自帶頭像）
- [ ] 每張 `<section class="slide">` 都有 `data-transcript`（空白頁可留空字串）
- [ ] 所有 TTS 旁白用中文通讀一遍，無明顯中英夾雜語調斷裂
- [ ] 每張投影片符合「一圖二表三文字」，無純條列牆
- [ ] 所有 `<h2>` 是 action title（陳述結論，不只是話題標籤）
- [ ] 結尾有下一集預告頁（若為系列簡報）——**下一集的集名與內容必須對照 `HANA_PRESENTATION_BRIEF.md` 的系列規劃表，嚴禁臆造**。（正確順序：EP8 從掙脫瀏覽器到走進你的手機（伺服器常駐＋Telegram，合併版）→ EP9 排程；雙圖譜 DocGraph／CodeGraph 在 EP10+。原獨立的 Telegram 集已併入 EP8。）
- [ ] 誠實標註借鑑來源（若有）
- [ ] 投影片總數合理（建議 8–15 頁；過多請拆集）
- [ ] 存至 `presentations/` 並確認在 Portal 選單正常顯示、播放外殼正常初始化

---

## 8. 繼承方式

各專案的簡報技能可在 frontmatter 加：

```yaml
extends: presentation-rules
```

再補該專案的特化（品牌色、客戶名、集數、主題語氣）。本文件的規則自動繼承，不需重複撰寫。

---

## Changelog

| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-20 | v2.0 | Hana(Claude) | 全面升級：從「inline 自包含」改為 presentation-core 合約架構；加入設計紀律（一圖二表三文字/action-title/一圖一意）、語音發音規則、誠實標註、結尾預告慣例、交付前檢查清單。 |
| 2026-06-19 | v1.0 | 老闆 + Hana(Claude) | 初版通則（格式/縮放/TTS/播放外殼）。 |
