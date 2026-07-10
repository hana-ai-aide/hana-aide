# SPEC — Presentation Core（注入式共享簡報框架）

> Status: ACTIVE ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/presentation-player/`、`presentations/*.html`、`portal/server.js`（/raw 注入）
> 目的：讓「未來很多簡報」共用同一套播放引擎，**deck 只寫內容，播放/語音/頭像 fix-once**。

---

## 1. 為什麼要這份（背景與教訓）

每個 deck 各自內嵌一份播放程式（ep2–ep8 的舊做法）＝ 改一個播放 bug 要改 N 個檔。但「把框架硬套到已有自帶播放的 deck 上」更糟——`ep1-v2` 曾同時跑：
1. `PresentationPlayer` 框架，
2. deck 自帶 `adjustScale` + viewport transform，
3. deck 自帶浮動頭像，

三套互相打架（transform 衝突讓 `position:fixed` 頭像被縮放容器吃掉、雙引擎搶 `resize`、頭像路徑被污染）。

**鐵則：一個 deck 只能有「一套」播放引擎。** 正解是把 ep2 那套 proven 引擎抽成「server 注入式共享模組」，跟 `hana-overlay.js`（頭像/語音）同一個模式——deck 維持純內容。

---

## 2. 架構

```
deck (presentations/*.html)  =  純內容（投影片 + 視覺設計）
        │  載入 / 由 server 注入
        ▼
presentation-core.js   ← 播放引擎：縮放 / 切片 / dots / 進度 / autoplay / TTS / 全螢幕 / 逐字稿 / 鍵盤
presentation-core.css  ← 外殼 + 共用設計系統樣式
hana-overlay.js        ← 浮動頭像 + 語音覆寫（hook speechSynthesis.speak）；由 server 於 /raw 注入到所有 presentation HTML
```

- **core 與 overlay 互補、不重疊**：core 負責「投影片播放 + 朗讀觸發」；overlay 負責「全域語音設定 + 頭像 talk/idle」。core 呼叫 `speechSynthesis.speak(u)`，overlay 的 hook 在發聲當下套用全域語音並驅動頭像。
- **檔案位置**：`portal/presentation-player/`（與 `hana-overlay.js` 同目錄）。
- **上線方式**：`presentation-core.*` 是 `portal/` 下的「新檔」，走 `/raw` 的 HARNESS_HOME fallback **免 Deploy 即時生效**（見 ARCHITECTURE-portal.md 地雷區）。

---

## 3. Deck 合約（做新簡報照這個寫）

deck 只需提供以下骨架，其餘外殼（progress / timer / footer 控制列 / tech-panel 語音面板 / drawer 逐字稿 / overlay 開始鈕）由 `presentation-core.js` 自動建立：

```html
<head>
  <!-- 字型 -->
  <!-- (可選) deck 專屬的內容設計樣式 <style>…</style> -->
  <link rel="stylesheet" href="/raw?path=portal/presentation-player/presentation-core.css">
</head>
<body>
  <div class="presentation-viewport" id="viewport" data-subtitle="副標（顯示於開始播放遮罩）">
    <header>
      <div class="brand">HANA / HARNESS</div>
      <div class="meta">EPISODE 0X · 標題</div>
    </header>
    <main class="slides">
      <section class="slide title-slide" data-transcript="這一頁的旁白逐字稿（給 TTS 朗讀）">
        …投影片內容（可用 core.css 提供的設計系統 class：kicker / mini-card / compare-grid / table / pipeline / split …）…
      </section>
      <!-- 更多 <section class="slide" data-transcript="…"> -->
    </main>
  </div>
  <script src="/raw?path=portal/presentation-player/presentation-core.js"></script>
</body>
```

**合約要點**：
- 每張投影片是 `<section class="slide">`，標題頁加 `title-slide`。
- 旁白放 `data-transcript`（相容舊欄位 `data-notes`）。沒有旁白的頁不朗讀。
- `#viewport` 的 `data-subtitle` 顯示在「開始播放」遮罩。
- 「下一集」連結用 `<a href="presentation-hana-episodeN.html">`（只寫檔名、不寫目錄），core 會自動處理（iframe 用 `parent.loadFile`／raw 模式更新 query／否則跳轉）。**core 從自己被載入的 `?path=`（`/raw?path=<dir>/<file>.html`，iframe 與 raw 模式皆經此載入）反推所在目錄再接檔名，不寫死目錄**——因為同一套引擎要同時服務 `presentations/`（v1）與 `presentations-v2/`（v2）等多個目錄；曾因寫死 `presentations/` 前綴，v2 deck 點下一集載到不存在的路徑而黑屏（2026-07-01 修復，見 Changelog）。
- **deck 不要自帶**：縮放、投影片切換、TTS、全螢幕、浮動頭像、控制列 HTML——這些都由 core/overlay 提供。

---

## 4. presentation-core.js 提供的行為

| 功能 | 說明 |
|---|---|
| 縮放 | 1920×1080 等比 `scale` 到視窗，`resize` 重算 |
| 切片 | prev/next、dots、鍵盤（→/空白=下一頁、←=上一頁、F=全螢幕、P=朗讀、S=停止、Esc=退出簡報模式） |
| 進度/計時 | 頂部 progress bar；autoplay 倒數 timer bar |
| TTS | `data-transcript` → `speechSynthesis`；預設語音挑選優先序 `Microsoft Yating → Yating → zh-TW → zh → 第一個`；速度預設 1.2 |
| 自動換頁 | 有語音時靠朗讀 `onend` 推進；無語音時用倒數計時 |
| 全螢幕 / 簡報模式 | `全螢幕播放` 進入沉浸模式（隱藏面板、自動朗讀） |
| 逐字稿抽屜 | 右側 drawer 顯示當前頁 `data-transcript` |
| 開始遮罩 | 首次需使用者點「開始播放」解鎖音訊（瀏覽器 autoplay 政策） |

冪等：`#viewport[data-core-init]` 防重複初始化。

---

## 5. CSS 共存規則（deck 自帶樣式 + core.css）

- **載入順序**：deck 專屬 `<style>` 先、`core.css` 後 → 共享選擇器（`body` / `.presentation-viewport` / `.slide` 基底 / 外殼）由 core 覆寫；deck 專屬 class（內容版面）保留。
- core.css 定義 `.slide` 基底（卡片 + 進出場 transition）與 `.slide h1` / `.slide p`、外殼、共用設計系統。
- deck 若有自己的標題排版習慣（如舊 ep1 綁在 `.pres-slide`），在 core.css 之後補 `.slide h2/h3/...` 覆寫即可。

---

## 6. Block Deck 整合（Phase 3）

Phase 3 新增「版型區塊模型」：Hana 填 JSON（`.blocks.json`）即可生 deck，不必手寫 HTML。
- **規格**：`specs/SPEC-block-deck.md`
- **網頁渲染**：`portal/presentation-player/block-renderer.js` 把 JSON → `.slide` DOM，再由本 core 接管
- **播放外殼**：`presentations/block-deck-player.html`（`?deck=<name>` 參數指定 deck）
- **可編輯 pptx**：`portal/render-service/block-export.js`（PptxGenJS 原生圖元）
- **API**：`GET /api/block-decks`、`POST /api/block-decks/:name/export`

block deck 的 `.slide` 節點完全符合本 SPEC §3 的 deck 合約，presentation-core.js 無需修改即可接管。

---

## 7. 已知約束 / 待辦

- **瀏覽器 autoplay**：`speechSynthesis` 需使用者手勢後才出聲 → 用「開始播放」遮罩解鎖；沉浸/簡報模式按鈕本身即手勢。
- **每瀏覽器預設語音**：`hana-overlay.js` 目前只 POST 寫入 voice-config，缺 GET 載入「Edge 等瀏覽器的已存預設語音」→ 全新分頁會用瀏覽器預設音。屬語音「對不對」非「有沒有」，列待補。
- **遷移**：ep1 已轉為本架構（試刀）。ep2–ep8 仍各自內嵌引擎，後續可逐一瘦身改用 core。新簡報一律照本 SPEC。
- **server 注入自動化（可選、需 Deploy）**：目前 deck 自行用 `<script src>`/`<link>` 載入 core；若要像 hana-overlay 一樣由 server 自動注入到所有 presentation，於 server.js 的 /raw 注入點加一行即可（屬 `server.js` 變更 → 需 Deploy）。

---

## Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-19 | v1.0 | 老闆 + Hana(Claude) | 初版。從 ep2 proven 引擎抽出 `presentation-core.js`+`.css` 注入式共享模組；定義 deck 合約；ep1-v2 轉為本架構試刀。 |
| 2026-07-01 | v1.1 | 老闆 + Hana(Claude) | 修「下一集」跳轉黑屏：`presentation-core.js` 新增 `currentDeckDir()` 從 `?path=` 反推目錄，取代寫死的 `'presentations/'` 前綴，讓同一套引擎正確服務 v1（`presentations/`）與 v2（`presentations-v2/`）。順帶補 `portal/index.html` `presentationTitles` 缺的 v2 EP2–EP8 中文標題。 |
