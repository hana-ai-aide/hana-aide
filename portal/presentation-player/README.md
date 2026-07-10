# 簡報播放框架 (Presentation Player Framework)

> ⚠️ **已淘汰（DEPRECATED）：本檔以下說明的 `presentation-player.js`（`PresentationPlayer` class）不再使用。**
> 實務上把它「套到已有自帶播放的 deck」會造成雙引擎打架（見 `specs/SPEC-presentation-core.md` 的教訓）。
>
> **現行做法**：deck 寫純內容，載入注入式共享模組——
> - `presentation-core.js` + `presentation-core.css`：播放引擎 + 外殼（取自 ep2 proven 引擎）
> - `hana-overlay.js`：浮動頭像 + 語音（由 server 注入到所有 presentation HTML）
>
> **做新簡報請看 → [`specs/SPEC-presentation-core.md`](../../specs/SPEC-presentation-core.md)（deck 合約在第 3 節）。**
> 下面舊文件僅留作歷史參考。

---

這是一個自包含、無依賴且高度可擴充的「純 HTML 簡報播放框架」骨架。它不屬於系統底層，專為能夠在不同專案之間輕鬆複製、貼上並獨立調整而設計。

## 📦 檔案結構

該模組的所有檔案均包含在同一個資料夾中，不與系統底層相依：

```
portal/presentation-player/
├── README.md               # 本文件（說明書與複製步驟）
├── presentation-player.js  # 播放器核心邏輯類別 (Vanilla JS)
├── presentation-player.css # 播放器基礎樣式與過渡特效 (CSS Variables)
├── demo-presentation.html  # 範例簡報資料檔 (純 HTML 格式)
└── index.html              # 測試沙盒 / Demo 頁面 (展示如何載入與監聽)
```

---

## 🛠️ API 介面定義 (API Reference)

播放器以一個 JavaScript 類別 `PresentationPlayer` 提供服務，其實體化與核心方法定義如下：

### 初始化

```javascript
const player = new PresentationPlayer({
  container: document.getElementById('player-container'), // 必填：掛載的 DOM 元素
  aspectRatio: '16/9'                                    // 選填：預設投影片寬高比
});
```

### 核心方法 (Methods)

- **`async loadFromUrl(url)`**
  從特定的網址（例如 `demo-presentation.html`）以非同步 fetch 方式獲取 HTML，解析投影片並載入舞台。
- **`loadFromHtml(htmlText)`**
  直接解析傳入的 HTML 字串並載入舞台。
- **`goTo(index)`**
  跳轉到指定索引的投影片頁面（從 0 開始）。
- **`next()`**
  播放下一頁。如果已是最後一頁，會觸發 `ended` 事件。
- **`prev()`**
  播放上一頁。
- **`toggleFullscreen()` / `enterFullscreen()` / `exitFullscreen()`**
  切換、進入或退出播放器全螢幕模式。
- **`on(eventName, callback)`**
  訂閱播放器的生命週期事件。

### 事件鉤子 (Events)

| 事件名稱 | 觸發時機 | 回傳資料欄位 |
| :--- | :--- | :--- |
| `loading` | 開始載入 HTML 時 | `{ url }` |
| `load` | 解析投影片完成時 | `{ slides: [...] }` |
| `slidechange` | 投影片切換時 | `{ index, slide, previousIndex, total }` |
| `ended` | 在最後一頁嘗試往下一頁時 | `void` |
| `fullscreenchange` | 全螢幕狀態改變時 | `{ isFullscreen }` |
| `error` | 載入或解析失敗時 | `Error` 物件 |

---

## 📄 簡報 HTML 格式規範

簡報本身是一份乾淨的 HTML 檔案，其中每一頁投影片由 `<section class="slide">` 元素包裹，並支援以下屬性：

```html
<!-- slide-source.html -->
<section 
  class="slide" 
  id="slide-unique-id" 
  data-title="投影片標題" 
  data-notes="這是一段會被當作講師講稿或 TTS 朗讀的文字內容。"
>
  <div class="slide-content">
    <h2>投影片內部 HTML</h2>
    <p>可自由編排文字、清單、圖片等。</p>
  </div>
</section>
```

---

## 🚀 其他專案複製它的步驟

如果您想在其他專案中使用本播放框架，請按照以下步驟操作：

### 步驟 1：複製檔案
將 `portal/presentation-player/` 目錄中的下列兩個核心檔案複製到您的專案中（放置於您的靜態資源目錄，如 `assets/` 或 `js/`）：
1. `presentation-player.js`
2. `presentation-player.css`

### 步驟 2：在專案 HTML 中引用資源
在您的 HTML 頁面（例如 `index.html`）的 `<head>` 與 `<body>` 尾端分別引入樣式檔與腳本檔：

```html
<!-- 在 head 中引入樣式 -->
<link rel="stylesheet" href="/raw?path=portal/presentation-player/presentation-player.css">

<!-- 在 body 尾端引入腳本 -->
<script src="/raw?path=portal/presentation-player/presentation-player.js"></script>
```

### 步驟 3：建立掛載容器與控制版面
在專案中建立一個專門放置播放器的 `div`，並可以視需要加入其他的 UI 板面（例如講稿面板、頭像面板等）：

```html
<div class="my-layout">
  <!-- 簡報播放器的掛載點 -->
  <div id="my-presentation-player"></div>
  
  <!-- 講師講稿顯示區 (選填) -->
  <div id="my-speaker-notes"></div>
</div>
```

### 步驟 4：編寫初始化與事件邏輯
在專案的 JavaScript 中初始化播放器，並監聽事件來實作您專案特有的需求（如 TTS 播放或大綱渲染）：

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('my-presentation-player');
  const notesEl = document.getElementById('my-speaker-notes');

  // 初始化
  const player = new PresentationPlayer({
    container: container,
    aspectRatio: '16/9'
  });

  // 監聽換頁，同步更新講稿，並可在此觸發 Web Speech API (TTS) 唸出講稿
  player.on('slidechange', (data) => {
    notesEl.innerText = data.slide.notes || '（無講稿）';
    
    // 範例：若想整合 TTS 朗讀講稿，可加入以下程式碼：
    // if (data.slide.notes) {
    //   window.speechSynthesis.cancel(); // 停止上一頁的朗讀
    //   const utterance = new SpeechSynthesisUtterance(data.slide.notes);
    //   window.speechSynthesis.speak(utterance);
    // }
  });

  // 載入簡報 HTML
  player.loadFromUrl('path/to/your-slides.html');
});
```

---

## 🔮 未來預留功能提示

此骨架已定義好核心生命週期事件，後續開發可在此基礎上逐步疊加：
1. **語音朗讀 (TTS)**：在換頁時調用 Web Speech API 朗讀 `slide.notes`。
2. **AI 虛擬頭像**：換頁時，頭像元件可訂閱 `slidechange` 事件，依據講稿長度或指令做出對應的表情。
3. **縮圖導覽列**：在 `load` 事件中，讀取所有 slides 的內容並將其以 `scale(0.1)` 縮小比例渲染成縮圖按鈕，供點擊跳轉。
