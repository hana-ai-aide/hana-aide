# SPEC — Block Deck 版型區塊內容模型

> Status: ACTIVE ｜ Phase: A Phase 3 ｜ Created: 2026-06-21
> Owner: Hana ｜ 影響範圍：`portal/render-service/block-export.js`、`portal/presentation-player/block-renderer.js`、`presentations/*.blocks.json`

## 1. 目的

讓同一份結構化 JSON（`.blocks.json`）同時驅動：
- **網頁播放**：`block-renderer.js` 渲染成 `.slide` DOM 節點 → `presentation-core.js` 自動接管
- **可編輯 pptx**：`block-export.js` 用 PptxGenJS 產原生圖元（文字可選取/編輯），`custom` layout 目前以文字佔位（未來可改截圖 fallback）

Hana 填 JSON 即可生 deck，不需手寫 HTML，且強制 action-title 紀律。

---

## 2. 根結構

```json
{
  "meta": {
    "title": "簡報標題",
    "subtitle": "副標題（顯示於開始播放遮罩）",
    "brand": "HANA / HARNESS",
    "episode": "EP01",
    "theme": "dark",
    "accent": "#22D3EE"
  },
  "slides": [ ...SlideBlock[] ]
}
```

### meta 欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `title` | ✅ | 簡報標題（用於頁首 meta 欄位） |
| `subtitle` | 否 | 開始播放遮罩副文字 |
| `brand` | 否 | 左上品牌文字，預設 `HANA / HARNESS` |
| `episode` | 否 | 右上 meta 標籤，例如 `EP01 · 標題` |
| `theme` | 否 | `dark`（預設）或 `light`（保留，目前僅 dark） |
| `accent` | 否 | 強調色 hex，預設 `#22D3EE` |

---

## 3. SlideBlock（投影片物件）

每張投影片是一個物件，必填 `layout` 欄位決定版型：

```json
{
  "layout": "bullets",
  "kicker": "前言標籤（mono 字體，所有版型均支援）",
  "transcript": "TTS 旁白逐字稿（無則靜音）",
  ...版型專屬欄位...
}
```

---

## 4. 版型定義

### 4.1 `title` — 標題頁

```json
{
  "layout": "title",
  "title": "大標題",
  "subtitle": "副標題",
  "kicker": "可選前言標籤",
  "transcript": "旁白"
}
```

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | `.title-slide` + `h1` + `p`（置中） |
| pptx | 置中大標（54pt bold）+ 副標（26pt muted） |

---

### 4.2 `bullets` — 條列頁（最常用）

```json
{
  "layout": "bullets",
  "title": "Action Title（一句話結論）",
  "bullets": [
    { "text": "主項目", "level": 1 },
    { "text": "次項目（縮排）", "level": 2 }
  ],
  "transcript": "旁白"
}
```

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | `.block-action-title`（有左邊框）+ `.block-bullets` |
| pptx | addTitleBar（左邊青色條）+ addText bullets |

`level` 目前支援 1 或 2；level 1 為主條列、level 2 縮排顯示。

---

### 4.3 `table` — 表格頁

```json
{
  "layout": "table",
  "title": "表格標題",
  "table": {
    "headers": ["欄一", "欄二", "欄三"],
    "rows": [
      ["值A", "值B", "值C"]
    ]
  },
  "transcript": "旁白"
}
```

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | `<table>` 用 core.css 樣式（th/td 深色主題） |
| pptx | `addTable()` 含 header row 加深底色 |

---

### 4.4 `image` — 圖片頁

```json
{
  "layout": "image",
  "title": "圖片標題（可選）",
  "imagePath": "presentations/assets/my-image.png",
  "imageAlt": "替代文字",
  "caption": "說明文字（可選）",
  "transcript": "旁白"
}
```

`imagePath` 為相對 `HARNESS_HOME` 的路徑。

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | `<img src="/raw?path=...">` contain 填滿 |
| pptx | `addImage({ path: absolutePath })` sizing contain |

---

### 4.5 `split` — 兩欄頁

```json
{
  "layout": "split",
  "title": "兩欄標題（可選）",
  "left": {
    "heading": "左欄標題",
    "items": ["項目一", "項目二"]
  },
  "right": {
    "heading": "右欄標題",
    "items": ["項目A", "項目B"]
  },
  "transcript": "旁白"
}
```

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | `.split` CSS grid（1fr 1fr）|
| pptx | 兩個並排文字方塊 + 矩形背景 |

---

### 4.6 `quote` — 引言頁

```json
{
  "layout": "quote",
  "quote": "引言內容",
  "attribution": "— 姓名，職稱",
  "kicker": "可選標籤",
  "transcript": "旁白"
}
```

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | `.block-quote-text`（italic 大字）+ `.block-quote-attr` |
| pptx | 置中大字 36pt italic + 屬名 20pt muted |

---

### 4.7 `custom` — 自訂 HTML

```json
{
  "layout": "custom",
  "html": "<div class='compare-grid'>...</div>",
  "transcript": "旁白"
}
```

| 媒材 | 渲染方式 |
|---|---|
| 網頁 | 原生 innerHTML 插入（可用 core.css 設計系統 class） |
| pptx | 文字佔位「Custom Slide」+ HTML 內容存入備忘稿；未來可改截圖 fallback |

---

## 5. 檔案位置

```
HARNESS_HOME/
  presentations/
    <deckName>.blocks.json      ← 結構化內容（主格式）
    block-deck-player.html      ← 通用網頁播放外殼
    exports/
      <deckName>-editable.pptx  ← 可編輯 pptx 輸出
```

---

## 6. API

| Method | Path | 說明 |
|---|---|---|
| `GET` | `/api/block-decks` | 列出 `presentations/` 下所有 `.blocks.json` |
| `GET` | `/raw?path=presentations/<name>.blocks.json` | 取得 JSON（供前端 fetch） |
| `POST` | `/api/block-decks/:name/export` | 產可編輯 pptx |

### 匯出 Response
```json
{ "ok": true, "path": "presentations/exports/<name>-editable.pptx", "slides": 7 }
```

---

## 7. 網頁播放 URL

```
/raw?path=presentations/block-deck-player.html&deck=<deckName>
```

block-deck-player.html 從 `location.search` 讀取 `deck` 參數，fetch 對應 `.blocks.json`，交由 `block-renderer.js` 渲染 DOM 後再載入 `presentation-core.js`。

---

## 8. 設計約束

- **不要手寫 HTML**：使用 block deck 的目的是讓 Hana 填 JSON 即可，Hana 不應退回到手寫整頁 HTML。
- **action-title 紀律**：`bullets` / `table` / `split` 的 `title` 欄位必須是「一句話結論」（action title），不是描述性標題。
- **pptx 可編輯 ≠ 像素一致**：可編輯 pptx 失去自訂 CSS/動畫，設計系統 class（如 compare-grid）在 custom 版型截不到；這是已知 trade-off。

---

## Changelog

| Date | Version | Author | Note |
|---|---|---|---|
| 2026-06-21 | v1.0 | Hana | Phase 3 初版；7 種版型、根結構、API、設計約束 |
