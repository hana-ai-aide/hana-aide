# SPEC — Meeting Workspace（會議管理 / 回顧 / 編輯 UX）

> Status: READY for build ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/index.html`（會議清單/摘要/Action UI、浮動對話）、`portal/server.js`（會議 API + git audit + 摘要 spawn）、各 workspace `.harness/runtime/meetings/`
> 建立在 `SPEC-meeting-transcriber.md`（錄製/轉錄/語者分離核心）之上，新增「會議像 AI 對話一樣可管理、可回顧、可編輯、可追蹤變更」的上層。
> **語者分離準度（人數提示）已併入 `SPEC-meeting-transcriber.md §6.1`**，本 spec 不重複。
> ⚠️ 文件中任何 HTML 樣式標籤（`<title>` 等）一律用反引號包，避免打斷 portal 清單渲染（見 `TASK.md H1`）。

---

## 1. 核心原則
1. **會議＝可管理的物件**：像「AI 對話」一樣有清單、標題、Tag、搜尋、刪除。
2. **會後加值**：Hana 自動產「重點摘要 + Action Item」，可人工修正。
3. **可對話、可編輯**：浮動 Hana 對話看得到會議內容，能問、能改（逐字稿錯字 / 摘要 / Action）。
4. **改了什麼查得到**：所有編輯走**本地 git**留痕（不推遠端、不進資料庫）。

---

## 2. W1 — Menu 改名「AI 會議」（⑥，最小）
- [ ] `index.html` 側邊欄「🎙️ 會議記錄」文字改為「**🎙️ AI 會議**」。純文字、要 deploy。

---

## 3. W2 — 會議清單 UI（②，比照「AI 對話」版型）
- **資料現成**：`meta.json` 已有 `title / startedAt / finishedAt`。
- **清單每列**：標題（可留空 → 顯示日期）＋「**錄製起 ~ 迄**」（`startedAt`~`finishedAt`，本地時區）＋ Tag chips ＋ 垃圾桶 icon。
- **Tag**：`meta.json` 新增 `tags: []`；列上可加/刪標籤（呼叫 W-API 的 meta 更新）。
- **搜尋**：前端過濾（標題 + tags），沿用現有 AI 對話清單的搜尋框邏輯。
- **刪除**：垃圾桶 icon → 二次確認 → `DELETE /api/meeting/:id` 砍掉整個 meetingDir（含 git 記錄需一併處理，見 W3）。
- **沿用**：盡量重用 `chat` 清單元件樣式（左側列表 + 點入詳情）。

---

## 4. W3 — 變更留痕（⑤，本地 git audit）
- **儲存庫**：`<workspace>/.harness/runtime/meetings/` 設為**一個本地 git repo**（`git init`，**無 remote、永不 push**）。位 runtime 下（已被主 repo gitignore），與主 repo 不衝突。
- **自動 commit**：任何寫入（轉錄定稿、語者 remap、摘要、Action 編輯、逐字稿修正）→ `git add -A && git commit -m "<meetingId>: <動作> by <Hana|老闆>"`。
- **歷史 UI**：會議詳情加「變更歷史」→ 顯示該會議檔案的 `git log`（時間/訊息）+ 點開看 `git diff`。
- **API**：`GET /api/meeting/:id/history`（log）、`GET /api/meeting/:id/diff?commit=`（diff）。
- **刪除一致性**：W2 刪會議 → 刪目錄 + commit「removed <meetingId>」（保留刪除紀錄於 git，目錄不在但 log 有痕）。
- **注意**：commit 不含祕密；git 操作用 `child_process` spawn `git`，路徑指 meetings repo。

---

## 5. W4 — 會後摘要 + Action Item（③，可編輯）
- **觸發**：會議結束（或詳情頁按「Hana 整理」）→ 把 `transcript`（優先 labeled）餵 Hana（claude spawn，沿用 chat/task 管線）。
- **結構化輸出**（存 meetingDir）：
  - `summary.md`：重點摘要（條列）。
  - `actions.json`：`[{ id, item, owner, due, done:false, source:'extracted'|'manual' }]`。**找得到就填 owner/due，找不到留空**。
- **可編輯**：詳情頁渲染摘要（markdown）+ Action 表格（item/owner/due 可改、可新增/刪除/打勾）→ `PUT` 存回 → **W3 自動 commit**。
- **沿用 G3**：升級既有 `finalizeMeetingSummary`（原只寫 chat_history）→ 改吐結構化 summary + actions。
- **注意**：吃 Claude 額度（每次整理一次）；品質受逐字稿錯字影響（可先用 W5 修字再整理，或整理後人工修）。

---

## 6. W5 — 浮動 Hana 對話綁定會議（④，問答 + 編輯）
> **相依**：需 `SPEC-floating-chat.md F1`（浮動 Chat）先落地。F1 的「檔案脈絡注入」在此擴成「**會議脈絡注入**」。
- 開著某會議 → 浮動 Hana 對話把該會議的 **逐字稿 + 摘要 + Action** 當 context 注入 → 可問（「這場結論是什麼」）、可改（「把『揮達』改成『輝達』」「Action 3 的 owner 設成李工」）。
- **編輯落地**：Hana 的修改透過 W4/W3 的 `PUT` 端點寫回對應檔（transcript / summary / actions）→ 前端重載 → **W3 自動 commit**（留痕）。
- 對話本身寫進 `chat_history`（帶會議關聯），可被 `/memory` 蒸餾。

---

## 7. 資料模型（meetingDir 增量）
| 檔 | 內容 |
|---|---|
| `meta.json`（增量） | 加 `tags: []`、`speakers?`（人數提示，給 §6.1 diarization）、`summarizedAt?` |
| `summary.md` | Hana 重點摘要（W4，可編輯） |
| `actions.json` | Action Item 陣列（W4，可編輯） |
| （git） | `runtime/meetings/.git` — 變更留痕（W3） |

---

## 8. API 介面（新增，接 `SPEC-meeting-transcriber §7`）
| 端點 | 用途 |
|---|---|
| `DELETE /api/meeting/:id` | 刪會議目錄 + git commit（W2/W3） |
| `PUT /api/meeting/:id/meta` | 改 `title` / `tags` / `speakers`（W2） |
| `POST /api/meeting/:id/summarize` | spawn Hana → 產 `summary.md` + `actions.json`（W4） |
| `PUT /api/meeting/:id/summary` | 存編輯後摘要 → commit（W4/W3） |
| `PUT /api/meeting/:id/actions` | 存編輯後 Action → commit（W4/W3） |
| `PUT /api/meeting/:id/transcript` | 存逐字稿修正（錯字）→ commit（W5/W3） |
| `GET /api/meeting/:id/history` | git log（W3） |
| `GET /api/meeting/:id/diff?commit=` | git diff（W3） |

---

## 9. 待拍板（遇到先採預設、記錄，勿卡住）
1. git repo 範圍：整個 `meetings/` 一個 repo（預設）vs 每場一個？→ 先整個一個，簡單。
2. 摘要模型：用哪顆？→ 沿用會議 lang/預設 claude；可後續加選項。
3. Action `due` 格式：自由文字 vs 日期選擇器？→ 先自由文字（找不到留空）。
4. 刪除會議：硬刪目錄（預設）vs 軟刪（標記）？→ 先硬刪 + git 留痕。

---

## 10. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-25 | v0.1 | 老闆 + Claude | 初版。會議清單 UI（標題/起迄/Tag/搜尋/刪除）、本地 git 變更留痕、會後摘要+Action Item（可編輯）、浮動 Hana 對話綁會議（問答+編輯，依賴 F1）、Menu 改名。語者分離人數提示見 SPEC-meeting-transcriber §6.1。 |
