# SPEC — Document Framework（每文件動作列 + 型別驅動框架）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/index.html`（檢視器：md 動作列、global header 清理、block deck 入口）、`portal/server.js`（既有匯出 API，不新增）
> 動機（2026-06-26 與 老闆）：簡報是「特殊框架」，它的動作按鈕（匯出 pptx／錄製影片）長在**頁面內的工具列**；但 md 是純內容，動作被丟到**最上層 global header**（匯出 docx），且 header 還混了 某工作區專用的「編譯部署」等。老闆要：**動作按鈕做在「文件頁面」裡、依文件型別決定**，而非 global。並預見：若 md 也像簡報有「框架」，未來 docx↔md 與各種文件專屬功能會更順。
> ⚠️ 文件內任何 HTML 樣式標籤一律用反引號包（見 `TASK.md H1`）。

---

## 1. 核心原則
1. **動作跟著文件走，不污染 global**：每份文件依其「型別」自帶一條工具列（per-document action bar），放它專屬的動作（匯出、播放…）。global header 只留跨文件的通用項。
2. **型別驅動**：同一個檢視器，依文件型別（先用副檔名、後用 front-matter）渲染不同的動作列。
3. **與簡報一致**：簡報（`.html` deck）已有頁面內工具列；md／block deck 比照，整個系統統一成「文件＝內容＋專屬工具列」。
4. **漸進**：先做「副檔名驅動的動作列」（馬上滿足需求），再長成「front-matter 文件框架」（更通用）。

---

## 2. 現況（problem）
- **簡報 `.html`**：`renderHtmlPreview()` 在頁面內渲染工具列：全螢幕播放／匯出 pptx／錄製影片／新分頁開啟。✅ 已是「頁面內」模式。
- **md `.md`**：`renderMarkdown()`（index.html ~3708）只渲染內容；動作「匯出 docx」(`btn-export-docx` / `exportDocx()` ~2058) 掛在 **global header**。
- **block deck `.blocks.json`**：只有 API（`/api/block-decks/:name/export`）+ 獨立播放器，**完全沒有 UI 入口**。
- **global header 污染**：~1002 編譯部署（某工作區專用、呼叫 `1_Build_And_Launch_Profile.ps1`、有 bug）、~1008 討論此檔、~1013 在 VS Code 開啟、~1023 匯出 docx——混在一起。

---

## 3. 設計：per-document action bar

### 3.1 位置與外觀
- 在檢視器內容區**上方**渲染一條 sticky 工具列（位 `#wiki-panel` 內、`#content-area` 之上），樣式比照簡報預覽那條（右對齊、小膠囊按鈕）。
- 內容捲動時工具列**置頂可見**（sticky），方便長文件隨時匯出。
- 文件**沒有任何專屬動作時**，不渲染這條（純內容文件不長工具列）。

### 3.2 型別 → 動作 對照（Phase 1：副檔名驅動）
| 文件型別 | 判定 | 動作列按鈕 | 接到 |
|---|---|---|---|
| 一般文件 | `.md` | **匯出 docx** | `POST /api/doc/export-docx` |
| Block deck | `.blocks.json` | **匯出可編輯 pptx**、**網頁播放** | `POST /api/block-decks/:name/export`、開 `block-deck-player.html?deck=<name>` |
| 簡報 | `.html`（presentations/） | （維持現有 `renderHtmlPreview` 工具列） | 既有 |

### 3.3 匯出交付（save path 慣例）
- 所有「匯出」動作統一用 **File System Access API `showSaveFilePicker()`** 讓使用者**選存檔路徑**（Chrome/Edge）；不支援時 fallback 回瀏覽器下載。（呼應 老闆對 docx「想選路徑」的要求。）

### 3.4 global header 清理
- 「匯出 docx」**移入** md 動作列 → global header 該按鈕移除。
- 「編譯部署」**隱藏**（某工作區專用、有 bug；理想上只在 該 workspace 顯示，先隱藏）。
- 「討論此檔」「在 VS Code 開啟」：先隱藏（floating chat 已可由頭像 💬 開）。保留元素、用 class 隱藏以便日後復原。
- global header 之後只留真正跨文件的通用項。

---

## 4. 文件框架（Phase 2：front-matter 驅動）
> 把「型別與可用動作」從硬編碼副檔名，升級成由文件**自己宣告**——這就是 老闆說的「md 也有框架」。

- md 檔頭 front-matter（YAML）宣告型別與動作：
  ```
  ---
  type: doc            # doc | block-deck | spec | …
  source: 情境流程/工單管理.docx   # 原始檔（顯示名由檔名推導；不寫 title）
  export: [docx, pdf]  # 這份文件支援哪些匯出
  actions: []          # 額外自訂動作（未來）
  ---
  ```
- 檢視器讀檔頭 → 動態生對應動作列（不再只看副檔名）。
- **docx → md 轉換時可寫入這種檔頭**（`docx-convert.py` 加 front-matter）→ 轉出來的 md 一進 portal 就帶正確型別與匯出選項，整條 Word↔md 更順（呼應 老闆的預見）。
- 與既有 spec 的關係：`SPEC-doc-convert.md`（Word↔md）、`SPEC-block-deck.md`（block deck）、`SPEC-presentation-core.md`（簡報）各自的「型別」都登記到本框架的 registry。

---

## 5. 動作 registry（前端資料結構，給實作參考）
```
// 型別 → 動作清單；新增文件型別只在這裡加一筆
const DOC_ACTIONS = {
  'md':          [{ label: '匯出 docx', icon: 'file-down', run: exportDocx }],
  'blocks.json': [{ label: '匯出可編輯 pptx', icon: 'file-down', run: exportBlockPptx },
                  { label: '網頁播放', icon: 'play', run: openBlockPlayer }],
};
// Phase 2：型別改由 front-matter.type 決定，動作由 front-matter.export[] 對應。
```

---

## 6. 分階段路線
- **P1（先做，滿足現需求）**：副檔名驅動的 per-document action bar；匯出 docx 移入；block deck 加「匯出可編輯 pptx + 網頁播放」；匯出統一走 `showSaveFilePicker`；global header 清理。
- **P2（框架化）**：front-matter `type`/`export` 驅動動作列；`docx-convert.py` 轉出時寫入檔頭。
- **P3（可選，統一）**：把簡報的 `renderHtmlPreview` 工具列也收編進同一套 action-bar 機制（目前各自一套，先不動）。

---

## 7. 待拍板（遇到先採預設、記錄，勿卡住）
1. 動作列位置：內容區頂端 sticky（預設）vs 浮動右上？→ 先 sticky 頂端。
2. front-matter 解析：自己 parse YAML 還是引入輕量套件？→ P2 再定，先副檔名。
3. 「討論此檔」要不要留在某處？→ 先靠頭像 💬；需要再加回文件動作列。
4. block deck 是否需要獨立「清單頁」（像簡報清單）？→ 先靠開 `.blocks.json` 檔觸發動作列即可。

---

## 8. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-26 | v0.1 | 老闆 + Claude | 初版。per-document action bar（型別驅動、頁面內、不污染 global header）；副檔名→動作對照（md→docx、block deck→可編輯 pptx+網頁播放、簡報維持現有）；匯出統一 showSaveFilePicker 選路徑；global header 清理（隱藏 某工作區的編譯部署等）；Phase 2 front-matter 文件框架（docx-convert 寫檔頭，呼應 老闆「md 也有框架」直覺）。 |
