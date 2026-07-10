# SPEC — Presentation Export（保真 pptx 匯出）

> Status: DRAFT ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/server.js`、`portal/render-service/`、`presentations/exports/`
> 目的：用無頭瀏覽器把 presentation-core deck 的每張投影片截成高解析 PNG，再用 PptxGenJS 組成保真 pptx，每頁是圖（無法編輯，但像素級一致）、旁白逐字稿存入備忘稿。

---

## 1. 設計原則

- **保真優先**：pptx 是衍生檔，不是主格式——每頁一張圖、像網頁一模一樣、不做可編輯版。可編輯版屬 Phase 3，本 SPEC 不涵蓋。
- **共用底層**：無頭瀏覽器（render service）同時支援 pptx 截圖、未來錄影（Phase 2）與 PDF 匯出，不要各自起各自的 headless 實例。
- **Portal 內建**：render service 整合進 `portal/` 生態系，不獨立部署，複用 `HARNESS_HOME` 環境變數與現有 server lifecycle。

---

## 2. 無頭引擎選型

| | Playwright | Puppeteer |
|---|---|---|
| **語言/生態** | Node，多瀏覽器（Chromium/Firefox/WebKit） | Node，主 Chromium |
| **截圖品質** | `page.screenshot({ type: 'png', fullPage: false })` | 同 |
| **錄影支援** | ✅ `page.video()` 原生錄影（Phase 2 預備） | ❌ 需外掛或 CDP |
| **套件體積** | 較大（含多瀏覽器 binary，可只裝 Chromium） | 較小 |
| **維護狀態** | Microsoft 維護，活躍 | Google 維護，活躍 |

**決策：選 Playwright**。主因是 Phase 2 錄影需求——Playwright 有原生錄影 API（`context.newPage()` + `recordVideo`），避免未來再引入第二套無頭套件。安裝時只下載 Chromium 以控制體積：

```bash
npm install playwright
npx playwright install chromium
```

---

## 3. Render Service 位置

```
portal/
  render-service/
    index.js          ← getBrowser() / getPage() / closeBrowser() 單例
    screenshot.js     ← slidesToPngs(deckUrl, opts) → [{ index, pngBuffer, transcript }]
    recorder.js       ← 待 Phase 2（錄影 + wav 合成）
```

- **單例 browser**：`getBrowser()` 懶啟動；`closeBrowser()` 掛在 `process.on('exit')` 清理。
- **整合點**：`portal/server.js` 在匯出 API handler 中 `require('./render-service/screenshot')`，不需獨立 process。

---

## 4. 截圖流程（`screenshot.js`）

### 4.1 輸入

```js
slidesToPngs(deckUrl, { width: 1920, height: 1080, waitMs: 300 })
```

- `deckUrl`：`http://localhost:<PORT>/raw?path=presentations/<deck>.html`（raw 模式，server 注入 core + overlay）
- `width/height`：預設 1920×1080
- `waitMs`：每頁截圖前等待 CSS transition 完成（預設 300 ms）

### 4.2 流程

```
1. page.goto(deckUrl, { waitUntil: 'networkidle' })
2. 等 #viewport[data-core-init] 出現（core 初始化完成）
3. 讀取 slides = page.$$('.slide')，取得總頁數 N
4. for i in 0..N-1:
   a. page.evaluate( 把第 i 張設為 active、其餘移除 active )
   b. await page.waitForTimeout(waitMs)
   c. pngBuffer = await page.screenshot({ clip: { x:0, y:0, width:1920, height:1080 } })
   d. transcript = await page.$eval('.slide.active', el => el.dataset.transcript || '')
   e. results.push({ index: i, pngBuffer, transcript })
5. return results
```

**重點**：
- 截圖時隱藏 core 注入的播放外殼（progress bar / footer / drawer），只保留 `#viewport` 內容。在 `evaluate` 步驟加 `document.body.classList.add('exporting')` 並在 `core.css` 補 `.exporting .core-shell { display:none }` 即可。
- deck 頁面不播 TTS（`data-autoplay` 不觸發）——raw 模式本就無自動播放需使用者手勢，無頭環境沒手勢故不觸發。

---

## 5. PptxGenJS 流程（`export.js`）

### 5.1 依賴

```bash
npm install pptxgenjs
```

### 5.2 流程

```js
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';  // 13.33" × 7.5"

for (const { index, pngBuffer, transcript } of slides) {
  const slide = pptx.addSlide();

  // 滿版圖（保真）
  slide.addImage({
    data: `data:image/png;base64,${pngBuffer.toString('base64')}`,
    x: 0, y: 0, w: '100%', h: '100%',
  });

  // 備忘稿（逐字稿）
  if (transcript) {
    slide.addNotes(transcript);
  }
}

const outputPath = path.join(HARNESS_HOME, 'presentations/exports', `${deckName}.pptx`);
await pptx.writeFile({ fileName: outputPath });
return outputPath;
```

### 5.3 命名規則

- `deckName` 取自 deck HTML 檔名（去 `.html`），例：`presentation-hana-episode1-v2`。
- 輸出目錄：`presentations/exports/`（相對 `HARNESS_HOME`）；目錄不存在時自動建立。

---

## 6. API Endpoint

```
POST /api/presentations/:name/export
```

### Request

```json
{ "format": "pptx" }
```

`:name` 為 deck 檔名（不含副檔名），如 `presentation-hana-episode1-v2`。

### Response（成功）

```json
{
  "ok": true,
  "path": "presentations/exports/presentation-hana-episode1-v2.pptx",
  "slides": 12
}
```

### Response（失敗）

```json
{ "ok": false, "error": "..." }
```

### 流程

```
1. 確認 presentations/<name>.html 存在（否則 404）
2. 呼叫 slidesToPngs(url)
3. 呼叫 buildPptx(slides, name)
4. 回傳 path + slide 數
```

---

## 7. Portal 前端匯出入口

在 portal 簡報列表（`/`）每個 deck 卡片加一個「匯出 pptx」按鈕：

```
[▶ 播放]  [↓ 匯出 pptx]
```

- 點擊後 `POST /api/presentations/:name/export`；顯示 loading 狀態。
- 成功後顯示「已匯出：presentations/exports/xxx.pptx」並提供下載連結（`GET /raw?path=presentations/exports/xxx.pptx`）。
- 失敗顯示錯誤訊息（常見：deck 未轉成 core 架構、port 被佔用）。

---

## 8. 輸出路徑

```
$HARNESS_HOME/
  presentations/
    exports/
      <deckName>.pptx      ← 保真 pptx（每頁一圖）
      <deckName>.pdf        ← 未來 Phase 2 延伸
```

- `exports/` 目錄由 export API handler 自動 `mkdir -p`。
- `/raw` endpoint 已支援靜態檔服務，無需額外設定即可下載。

---

## 9. Phase 2 延伸接點（錄影 + 旁白 wav）

本 SPEC 只做 Phase 1（pptx 截圖）。Phase 2 延伸：

| 接點 | Phase 1 預留 | Phase 2 實作 |
|---|---|---|
| Render service 單例 | `getBrowser()` 單例已建 | 同一 browser 實例供錄影用 |
| `recorder.js` | 空殼佔位 | Playwright `recordVideo` + ffmpeg 合成旁白 wav |
| 逐字稿 | 已從 `data-transcript` 取得並存 pptx 備忘稿 | 送離線/雲端 TTS 轉 wav，再嵌進 pptx / 合成影片 |
| API | `POST /api/presentations/:name/export` | 加 `"format": "video"` 分支 |
| 輸出目錄 | `presentations/exports/` | 同目錄加 `.mp4` / `.wav` |

---

## 10. 依賴套件彙整

| 套件 | 用途 | 安裝 |
|---|---|---|
| `playwright` | 無頭截圖（+ Phase 2 錄影） | `npm install playwright && npx playwright install chromium` |
| `pptxgenjs` | 組 pptx | `npm install pptxgenjs` |
| `ffmpeg`（系統） | Phase 2 音影合成（非 npm） | 系統安裝，exec 呼叫 |

---

## 11. 實作驗收標準（Phase 1）

- ep1-v2 匯出的 pptx，每頁視覺與網頁瀏覽一致（允許字型反鋸齒細微差異）。
- 每頁備忘稿欄位顯示對應 `data-transcript` 內容，無亂碼。
- 匯出 12 張 slide 的 deck 在 5 秒內完成（本機 Chromium，無網路瓶頸）。
- 匯出失敗時 API 回傳明確錯誤訊息，前端顯示原因。

---

## Changelog

| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-20 | v1.0 | Hana(Claude) | 初版。無頭引擎選 Playwright、截圖 1920×1080、PptxGenJS 保真匯出、Phase 2 接點說明。 |
