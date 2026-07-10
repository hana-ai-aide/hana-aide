# SPEC — 擬真＋BPMN 文件交付匯出（Fidelity Export with live BPMN）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/render-service/doc-pdf.js`（新增擬真列印路徑）、`portal/index.html`（`?print=doc-fidelity` bootstrap、匯出鈕接線、BPMN→PNG 光柵化）、`portal/server.js`（新匯出端點）、`portal/render-service/`（新增 `docx-bpmn-bake.py` OOXML 影像置換器）、各工作區 `.documents/<uuid>/exports/` 與 `source.docx`
> 動機（2026-07-09 與 老闆）：`/doc-flowchart` 讓客戶 docx 的流程圖在 portal 上以可編輯 BPMN 呈現，但**改完後不論匯出或直接開 `source.docx` 都看不到 BPMN**——匯出走的是「舊的、非擬真」路徑（md 投影重排／md→docx 重建），source.docx 真身也從未被寫入 BPMN。老闆要的是「**擬真格式 ＋ BPMN 流程圖**」的 docx／pdf 交付物。
> ⚠️ 文件內任何 HTML／XML 標籤一律用反引號包（見 `TASK.md H1`）。

---

## 1. 診斷：為什麼「網頁看得到、匯出／開檔看不到」

BPMN 只活在 portal 的**擬真預覽渲染層**（`_renderDocFidelity` → `_synthDocFlowSvg`，`portal/index.html`）——它讀 `source.docx` 真身用 docx-preview 渲染，再把使用者編輯過的 `assets/*.bpmn` 即時合成 svg 貼回原圖框位（依 `doc.md` 的 `` ```bpmn `` fence 對位，見 `SPEC-doc-editing.md §13.11`）。**這是純前端「呈現層」，不動真身、也沒有落到任何交付檔。**

匯出／開檔卻走**另外三條、都不經過擬真層**：

| 動作 | 端點 / 檔 | 走哪條 | 擬真？ | 有 BPMN？ |
|---|---|---|---|---|
| 匯出 PDF（docx） | `POST /api/doc/export-pdf` → `?print=doc` → `mdToPdf` | `_renderDocPaged`（**md 分頁投影**，非 source 真身） | ❌ | 有，但在 md 重排版面裡（bpmn-js 渲 md 的 fence） |
| 匯出 docx | `md-to-docx.py`（`/api/doc/export-docx`） | 從 `doc.md` **重建**一份 docx | ❌ | ❌（只放文字佔位／或有損嵌入） |
| 直接開 `source.docx` | — | 原始真身 | ✅（原檔） | ❌（裡面仍是舊 EMF/Visio 圖，從未被寫入 BPMN） |

**對照**：pptx／workbook 的 PDF 匯出（`DV-05/06`，`?print=pptx`／`?print=workbook` → `officeToPdf`）**已經是擬真**（渲 source 真身）。**唯獨 docx 的 PDF 還押在 md 投影上**，且 docx／開檔兩頭從沒被寫入 BPMN。這就是 老闆看到「舊的、非擬真」的全部根因。

---

## 2. 方案總覽（A／B／C 三階段）

```
             ┌── A. 擬真＋BPMN 的 PDF（純呈現層列印，低風險，先做）
             │      Playwright 印「_renderDocFidelity + _synthDocFlowSvg」的擬真畫面 → page.pdf()
擬真＋BPMN ──┤
   交付      ├── B. 擬真 docx 交付檔（OOXML 影像置換，輸出 exports/，不動真身）
             │      以 source.docx 為底 → 把流程圖圖元換成 BPMN 光柵 → 寫到 .documents/<id>/exports/
             │
             └── C. 烤進 source.docx 真身（同 B 引擎，覆寫真身 ＋ 版本快照 ＋「已變更」語意）
                    用 Word 打開即見 BPMN；屬「手動寫回真身」範疇
```

- **A** 只印「你在 portal 看到的擬真畫面」，不動任何真身、不做 OOXML 手術 → **最痛需求、最低風險，先做**。
- **B／C 共用同一段 OOXML 影像置換手術**（`docx-bpmn-bake.py`），差別只在**輸出到交付檔**還是**覆寫真身**。B 先於 C（C 是 B 引擎接上「覆寫真身＋快照」的薄差量）。

---

## 3. A — 擬真＋BPMN 的 PDF（先做）

**目標**：匯出的 PDF ＝「portal 擬真預覽 ＋ 合成 BPMN」的像素級複製（等同 pptx/workbook 那條已驗證的路，只是換 docx 引擎）。

### 3.1 做法（重用現成，不新造渲染器）
1. **新列印模式 `?print=doc-fidelity`**（`portal/index.html`）：比照既有 `initOfficePrintMode()`（`?print=pptx`）——把 `source.docx` 用 `_renderDocFidelity()` 的 docx-preview 分支（`docx.renderAsync(buf, root, { breakPages:true, renderHeaders:true, … })`）渲進 `#doc-print-root`，接著呼叫 `_synthDocFlowSvg(root)` 把 `assets/*.bpmn` 合成 svg 貼回圖框（與螢幕上同一支函式），最後翻 `window.__docPrintReady`。
2. **頁面幾何**：docx-preview 的 `breakPages:true` 產出 `section.docx`（每段一頁、帶原檔頁面尺寸）。**沿用 DV-09 已踩平的 Chromium 地雷解法**——量測第一個 `section` 的實際渲染尺寸 → 動態注入 `@page { size:<w> <h>; margin:0 }` → 後端 `page.pdf({ preferCSSPageSize:true })`，**不传 explicit `width`/`height`**（否則與全域 `@page` 規則並存會被 Chromium 互換方向，`SPEC 記憶`已三次確認）。
3. **後端**：`doc-pdf.js` 加 `docFidelityToPdf(printUrl)`（比照 `officeToPdf`：`goto` → 等 `__docPrintReady` → 檢查 `__docPrintError` → `page.pdf`）；`server.js` 加 `POST /api/doc/export-pdf-fidelity`（比照 `export-pdf-pptx`），body `{ docId | mdFilePath }`，用 `source.docx` 路徑組 `?print=doc-fidelity`。
4. **前端接線**：文件動作列的「匯出（PDF）」對 docx 改走 `docExportDocFidelityPdf()`（見 §6 開放決策 1：是否保留舊 md-paged PDF 為「更多 ▾」進階選項）。

### 3.2 已知風險（給執行者）
- **bpmn-js 在列印頁必須以真尺寸渲染**：display:none 祖先下 bpmn-js 會渲成 0×0（`initDocPrintMode` 已註記此坑）→ 列印根需**先可見再渲染**，渲完再隱藏其餘 chrome。
- **`_synthDocFlowSvg` 目前綁在 `_renderDocFidelity` 內**：抽出成可獨立傳容器呼叫（它已支援 `areaEl` 參數，見全螢幕路徑 `12861`），列印 root 直接傳入。
- 只影響**呈現／列印**，完全不碰 source.docx 真身。

---

## 4. B — 擬真 docx 交付檔（OOXML 影像置換，輸出 exports/）

**目標**：產一份**以 `source.docx` 為底**的 docx——原檔 header／頁碼／logo／樣式一個 byte 不碰，**只把「被辨識為流程圖」的那張圖元換成 BPMN 成品**——輸出到 `.documents/<uuid>/exports/`，**不動真身**。用 Word 打開就看得到 BPMN。

### 4.1 手術步驟（新 `portal/render-service/docx-bpmn-bake.py`）
1. **BPMN → 可嵌入影像**：`assets/*.bpmn` → svg（bpmn-js 是前端；伺服器端出圖見 §6 開放決策 2：① 前端 Playwright 把 bpmn 渲成 svg→PNG 光柵回傳給 py；② py 端用 headless 光柵；③ 直接嵌 svg（現代 Word 支援 `<asvg>`＋PNG fallback）。**先採**：前端已有 bpmn-js，於匯出時把每張 bpmn 渲成高解析 PNG（＋原 svg 備嵌）POST 給後端。
2. **定位目標圖元**：找到 docx 裡那張流程圖的 `<w:drawing>` / `a:blip r:embed` 指向的 media part。**錨點來源＝ `doc.md` 的 `` ```bpmn `` fence 身分**（與 `SPEC-doc-editing.md §13.11` 擬真層對位同一份資料、同一套 paraId／docPr 身分），**不自造新對映**。⚠️ 見 §6 開放決策 3（docPr↔bpmn 對應在匯入時被 strip 的既有 blocker）。
3. **置換 media binary ＋ 修正尺寸**：沿用 `image-writeback.py` 的「換 `word/media/<x>` binary、保留 part 名與關聯」機制；**但流程圖長寬比常與原 Visio 圖差很多** → 需同步改該 drawing 的 `wp:extent` / `a:ext`（等比吃「原圖框寬、BPMN 比例定高」，比照擬真層 `_placeFlowFrame` 的作法），避免變形。
4. **輸出**：寫到 `.documents/<uuid>/exports/<title>.fidelity.docx`，經 `showSaveFilePicker` 交付；**真身不動**。

### 4.2 邊界
- 純圖（非流程圖）、文字、表格、版面**一律不碰**——只換被 doc.md 標為 fence 的那幾張圖。
- `_pending.bpmn`（尚未重建）→ 保留原圖、誠實標「未重建」（同擬真層降級策略）。
- 對不齊（DOM 圖序與 doc.md 對不上、客戶在 Word 端大改）→ 該圖**跳過不換、誠實回報**，不硬猜。

---

## 5. C — 烤進 source.docx 真身（同 B 引擎 ＋ 覆寫 ＋ 快照）

**目標**：用 Word 打開 **`source.docx` 真身**就看得到 BPMN。**與 B 共用 `docx-bpmn-bake.py`，唯一差別是輸出目標＝覆寫 source.docx（而非 exports/）**，並補「寫回真身」的安全語意（屬手動、破壞性動作）。

### 5.1 差量（B 之上）
- **覆寫前先快照**：走既有 registry/round-trip 的資產快照機制（`SPEC-document-registry.md §3a`／`SPEC-doc-roundtrip`）記一筆 `edit`（或 `bake`）事件並快照舊 `source.docx` → 可還原。
- **「已變更」語意**：比照 `SPEC-doc-editing.md §13.6`——烤進真身＝真身被改，文件清單亮「已變更」；是否再「寫回原始 `sourcePath`（工作區內原檔）」由 老闆手動觸發。
- **甲／乙選項**（同 §13.6，差別只在流程圖呈現）：**乙（預設）＝ bpmn→svg 成品**烤入；**甲 ＝ 保留原始 Visio**（即不烤、維持原檔）。
- **git 由人類掌控**：Hana 只寫檔、不自動 commit。
- **破壞性動作先確認**：覆寫真身前顯式提示「將改寫 source.docx 真身（已自動快照可還原）」。

---

## 6. 待拍板（先採預設、記錄，勿卡住）

1. **A 的匯出鈕語意**：擬真＋BPMN PDF **取代**現行 docx PDF 匯出（預設）vs 舊 md-paged PDF 降為「更多 ▾」保留？→ **先取代**（老闆的痛點就是舊那條沒用），舊路徑保留在「更多 ▾」當退路。
2. **BPMN 光柵化管線**：① 前端 bpmn-js→PNG POST 後端（**預設**，重用既有前端引擎、零新增後端相依）／② 後端 headless 光柵／③ 直接嵌 `<asvg>`＋PNG fallback（Word 2016+ 才吃）。→ **先採 ①**；③ 列為後續畫質升級。
3. **⛔ docPr↔bpmn 對應 blocker（既有）**：`docx-convert.py` 把流程圖 `![]` 換成 `` ```bpmn `` fence 時 regex 連 docPr 錨點一起 strip（見 `SPEC-doc-editing.md §13.8-5`）→ B/C 需要「擬真畫面某張流程圖 ↔ `assets/*.bpmn`」的可靠對應。**預設沿用 §13.11 定案的 paraId／doc.md fence 身分對位**（擬真層已在用、對全部文件都在）；若該對位對某檔不成立，該圖**跳過不烤、誠實回報**，不自造脆弱對映。是否需補 `flowmap.json` sidecar（動到 import＋隱含重匯入）留待 老闆拍板。
4. **BPMN 尺寸**：等比吃「原圖框寬、BPMN 比例定高」（預設，同擬真層 `_placeFlowFrame`）；長寬比差太多可能影響後續版面流，接受（正式版可再於 Word 微調）。
5. **多子流程一圖**：一張原圖被拆成多個子流程 bpmn（擬真層 `entry.label` 已處理）→ 烤入時依序堆疊、各帶子流程名。

---

## 7. 與既有 spec 的關係

- `SPEC-doc-editing.md`：§13.10/§13.11（擬真層以 doc.md／paraId 為錨合成 BPMN）是 A 列印與 B/C 定位的**同一份對位資料**；§13.6（已變更／寫回真身／甲乙）是 C 的語意來源；§13.8-5 是 B/C 的 blocker。
- `SPEC-document-registry.md`：§11/§12（三型全螢幕＋統一 PDF 匯出）——A 補上 docx 那條「擬真 PDF」，與 pptx/workbook（DV-05/06）對齊；§3a（資產快照）供 C 覆寫真身前快照。
- `SPEC-doc-roundtrip.md`：C 覆寫真身沿用其快照／版本事件機制。
- `SPEC-doc-convert.md`：§6 開放決策 3 的 docPr strip 發生在此匯入層。
- `image-writeback.py`：B/C 的 media binary 置換沿用它，不重造。

---

## 8. 分階段路線（對應 `TASK.md §FX`）

- **A（先做，Sonnet）**：`?print=doc-fidelity` bootstrap ＋ `doc-pdf.js` 擬真列印 ＋ `export-pdf-fidelity` 端點 ＋ 前端接線。驗收：改過 BPMN 的 docx 匯出 PDF ＝ portal 擬真畫面（含最新 BPMN）。
- **B（Opus，OOXML 手術）**：`docx-bpmn-bake.py` 影像置換 → exports/ 交付 docx；BPMN 光柵化管線；paraId/doc.md 對位定位；extent 尺寸修正。驗收：Word 開交付 docx 見 BPMN、其餘版面不變、真身不動。
- **C（Sonnet，B 之上薄差量）**：同引擎輸出改覆寫 source.docx 真身 ＋ 快照 ＋「已變更」語意 ＋ 甲/乙選項 ＋ 破壞性確認。驗收：Word 開 source.docx 真身見 BPMN、可經快照還原。

---

## 9. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-07-09 | v0.1 | 老闆 + Hana | 初版。診斷「網頁看得到、匯出/開檔看不到」根因（BPMN 只活在擬真呈現層，匯出走 md 投影／md→docx 重建、真身從未寫入 BPMN；pptx/workbook PDF 已擬真、獨缺 docx）。三階段：A 擬真＋BPMN PDF（列印擬真呈現層，低風險先做，Sonnet）／B 擬真 docx 交付檔（OOXML 影像置換→exports/，不動真身，Opus）／C 烤進 source.docx 真身（同 B 引擎＋快照＋已變更語意，Sonnet）。B/C 共用 `docx-bpmn-bake.py`，對位沿用 §13.11 paraId/doc.md fence 身分、置換沿用 `image-writeback.py`。老闆拍板：先做 A，B/C 後續、spec 先寫齊、三 task＋手動 schedule 全設好待手動執行。 |
