# SPEC — Chat 多模態附件（貼圖 / 貼檔 → Hana 直接判讀）

> Status: READY（開放決策已由 老闆拍板，見 §8）｜ Owner: 老闆 + Hana
> 登錄 TASK.md **系列 M（Multimodal）**；分 4 個獨立 task＋4 個手動排程（無排定時間，指揮官手動觸發）。
> 影響範圍：`portal/index.html`（chat 輸入框：貼上 / 拖放 / 迴紋針、附件縮圖列）、`portal/server.js`（新 `POST /api/chat/upload`、`POST /api/chat` 帶 `attachments`、`buildChatPrompt` 注入、`DELETE /api/chat/history/:id` 連動刪附件、STT 複用）、`portal/render-service/stt.py`（語音轉逐字稿，現成）
> 建議登錄 TASK.md **新系列（例如 M — Multimodal；若已占用由指揮官指定）**。
> **核心洞見**：真身 Claude Code CLI 的 `Read` 本來就吃圖片 / PDF / txt / Word / Excel（原生多模態）。所以**不重造判讀能力**，只補「接檔進來 → 落地工作區 → 把路徑帶進 prompt / 依型別前處理」這一段。

---

## 1. 核心原則

1. **貼上即判讀**：使用者在 chat 直接 `Ctrl+V` 貼截圖、拖放檔、或按迴紋針選檔，無需另存檔、無需報路徑。
2. **用現成的、不重造**：圖片 / PDF / 文字 / Office → 落地後把路徑帶進 prompt，Hana 用既有 `Read` 原生看；語音 → 走**現有 `stt.py`**（會議記錄 / Telegram 語音已在用）轉逐字稿。只有影片需新增 ffmpeg 前處理。
3. **附件離 chat 最近、與對話同生共死**（老闆拍板）：附件存在該 session 專屬資料夾，**刪除對話時一併刪除其附件**。
4. **天條**：附件只寫在**當前工作區底下**，絕不寫到 `C:\Users`、系統暫存或工作區外。
5. **工作區隔離**：附件路徑內含 workspace，`POST /api/chat/upload` 一律經 `resolveWorkspace(req)` 落到該工作區的 `chat_history` 下（沿用既有 `wctx.chatHistoryDir`）。

---

## 2. 現況錨點（Hana 動工前先定位這些真實位置）

- chat session 檔：`<workspace>/.harness/runtime/chat_history/chat_<sessionId>.json`（欄位：`sessionId, updatedAt, messages, trace, title, filePath, origin`）。工作區目錄由 `resolveWorkspace(req).chatHistoryDir` 給。
- `POST /api/chat`（server.js ~1462）：body `{ sessionId, messages, model, jobId, filePath, meetingId }`；`activeSessionId = sessionId || 'session_'+Date.now()`；建 `ctx` → `buildChatPrompt(...)` → `chatViaClaude/Gemini/Codex`。
- `buildChatPrompt`（~5479）：已有「注入目前開啟檔案內容（≤8KB、防 `../` 逃逸）」與「注入會議脈絡」的**成熟 pattern**——附件注入照抄這套。
- `DELETE /api/chat/history/:id`（~1292）：目前只 `fs.unlinkSync(chat_<id>.json)`。**這裡是連動刪附件的唯一改點。**
- STT：`sttTranscribe({ audio, lang, model, beamSize })`（~3896）、`POST /api/stt`（~3797）——語音判讀直接複用，不新造。
- 前端 chat 輸入 / 送出管線與訊息渲染在 `portal/index.html`（浮動 chat 與整頁 chat 共用 `POST /api/chat`，見 `SPEC-floating-chat.md`）。
- **Telegram 收圖已現成**：`portal/telegram.js` C6（~L423–533）已能收 `photo` / image-type `document` → `getFile` 下載 → 注入本地路徑「請用 Read 判讀」→ 走 `chatFn`/`taskFn`；語音（voice/audio）走 F5 → `stt.py`。故 **D2 對「圖片」而言已完成**，本 spec 不重做（僅 §8-D2 記可選延伸：Telegram 非圖片檔如 PDF/文字，未來如需再開一支）。

---

## 3. 落地位置（附件存哪）— **已定案**

```
<workspace>/.harness/runtime/chat_history/
  chat_<sessionId>.json            # 既有：對話本體
  context_<sessionId>.md           # 既有：注入用歷史
  attachments/<sessionId>/         # 新增：這個對話的所有附件
    <ts>_<safeName>.png
    <ts>_<safeName>.pdf
    ...
```

- **就在 chat_history 隔壁**，離對話最近、`git`-ignored（`.harness/runtime/` 已忽略、per-machine），符合「離 chat 近、省空間」。
- **鍵＝sessionId**：與對話檔同名對應 → 刪對話時刪掉整個 `attachments/<sessionId>/` 資料夾即可（見 §6）。
- 檔名 `<ts>_<safeName>`：時間戳避免同名覆蓋；`safeName` 過濾路徑分隔與非法字元，防路徑穿越。

---

## 4. 上傳（前端 + 端點）

### 4.1 前端（`index.html`，浮動 chat 與整頁 chat 皆適用）
- 輸入框三入口：**① `paste` 事件抓 `clipboardData.files`（貼截圖）② `drop` 拖放 ③ 迴紋針 `<input type=file multiple>`**。
- 選到檔 → 先 `POST /api/chat/upload`（帶 `sessionId` 與檔案），拿回相對路徑；在輸入框上方顯示**附件縮圖列**（可移除單顆）。
- 送出時 `POST /api/chat` 的 body 夾帶 `attachments: [{ path, name, kind }]`（連同文字一起）。
- **sessionId 一致性**：若對話尚未有 id，前端先產生 `session_<ts>`（與 server 慣例一致）並用於 upload 與後續 chat，避免附件落到孤兒資料夾。

### 4.2 端點 `POST /api/chat/upload`（server.js 新增）
- `wctx = resolveWorkspace(req)`；multipart 或 base64 皆可（實作挑一種，建議 multipart）。
- 落地到 `path.join(wctx.chatHistoryDir, 'attachments', sessionId, `${ts}_${safeName}`)`；`mkdir -p`。
- **防護**：① `sessionId` 與 `safeName` 皆正規化、拒 `..` / 路徑分隔；② 解析後的絕對路徑必須仍在 `chatHistoryDir` 內（同 `buildChatPrompt` 的 `startsWith(root+sep)` 檢查）；③ 單檔大小上限（見決策 D3）。
- 回傳 `{ path: <相對 workspace 路徑>, name, kind }`；`kind` 由副檔名/MIME 判為 `image|pdf|text|office|audio|video`。

---

## 5. 依型別轉交（`buildChatPrompt` 注入 / 前處理）

`POST /api/chat` 收到 `attachments` → 存進 `ctx.attachments`；`buildChatPrompt` 新增一段注入（**照抄現有「開啟檔案」注入的防逃逸寫法**）：

| kind | 處理 | 現成？ |
|---|---|---|
| `image` png/jpg、`pdf`、`text` txt/md | 只把**路徑**列進 prompt，指示 Hana「用 Read 直接看這些附件」（CLI 原生多模態） | ✅ 全現成 |
| `office` docx/xlsx | 同上（Read 可讀）；或先過既有 docx→md / xlsx 轉換器 | ✅ 現成 |
| `audio` mp3/m4a/wav | 後端先 `sttTranscribe()` → 逐字稿，注入為文字（附原檔路徑備查） | ✅ 現成、只是接線 |
| `video` mp4 | 抽音軌→STT（需 **ffmpeg**）；要看畫面再抽關鍵影格當 image | ⚠️ 需新增 ffmpeg 前處理（列 Phase 2） |

注入格式（示意，實作對齊既有段落風格）：
```
=== 使用者這則訊息附帶的檔案（請用 Read 工具直接判讀）===
1. 路徑：.harness/runtime/chat_history/attachments/<sid>/1720xxx_shot.png（圖片）
2. 路徑：…/spec.pdf（PDF）
（語音附件已代為轉成逐字稿如下：…）
--- 附件清單結束 ---
```
> **不把檔案內容塞進 prompt**（除語音逐字稿）——只給路徑，讓 Hana 用 Read 原生多模態看，省 token 且保真。

---

## 6. 刪除連動（老闆明確要求）

- 改 `DELETE /api/chat/history/:id`：`unlinkSync(chat_<id>.json)` 之後，`fs.rmSync(path.join(wctx.chatHistoryDir,'attachments',id), { recursive:true, force:true })`。
- 前端既有「刪對話」動作不變；一次呼叫同時清掉附件資料夾 → **對話沒了，它的附件也沒了**，不留孤兒、不佔空間。
- （可選，決策 D4）背景巡檢：清掉沒有對應 `chat_<id>.json` 的孤兒 `attachments/*` 資料夾，防止上傳後未送出就關頁留下的殘檔。

---

## 7. 分階段路線圖（已拍板：4 個獨立 task，各配一個手動排程、無排定時間）

> 對應 TASK.md 系列 M。每個 phase＝一個 task＝一個手動觸發排程；指揮官逐一手動執行。

**M1 · Phase 1（快贏、涵蓋 80% 需求）— 網頁 chat 圖片 + PDF + 文字檔**
- 前端三入口（貼上 / 拖放 / 迴紋針）+ 附件縮圖列；`POST /api/chat/upload`（工作區隔離＋防路徑穿越＋大小/數量上限）；`POST /api/chat` 夾帶 `attachments`；`buildChatPrompt` 注入路徑（照抄「開啟檔案」防逃逸 pattern）；`DELETE /api/chat/history/:id` 連動刪 `attachments/<id>/`。
- 🧑‍✈️ 指揮官手動驗證：貼一張截圖問「這畫面什麼問題」，Hana 看得到並判讀；刪該對話後附件夾消失。

**M2 · Phase 2 — 語音附件（mp3/m4a/wav）**
- 上傳後後端先走 `sttTranscribe()` 轉逐字稿注入為文字（附原檔路徑備查）。引擎現成，只接線。

**M3 · Phase 3 — 影片附件（mp4）+ Office 深度**
- 新增 ffmpeg：抽音軌→STT、必要時抽關鍵影格當圖片；Office 視需要先轉再讀。

**M4 · 孤兒附件清理 command（`/attachments-gc`）**
- 見 §9。不依賴 M1–M3，但實務上 M1 落地後才有孤兒可清；可獨立手動觸發。

---

## 8. 開放決策 — **已由 老闆拍板（2026-07-08）**

- **D1 範圍分期** → ✅ **分階段、各自獨立成 task＋手動排程**（M1 圖片+PDF+文字 → M2 語音 → M3 影片）。全部**不排定時間**，由指揮官手動觸發。
- **D2 Telegram 貼圖** → ✅ **已現成、無需開發**（`telegram.js` C6 收 photo/image document → 注入路徑請 Read 判讀；語音走 F5 STT）。非圖片檔（Telegram 傳 PDF/文字）為可選延伸，未來如需再單開一支，不在本批。
- **D3 單檔 / 單則上限** → ✅ **採建議值：單檔 25MB、單則最多 5 檔**（`POST /api/chat/upload` 強制；超過回 413 並前端提示）。
- **D4 孤兒附件處理** → ✅ **不做背景巡檢，改做一個手動 command `/attachments-gc`**（M4，見 §9）。已存對話的附件仍由 §6 的 DELETE 連動即時清除；command 只清「上傳了但對話從未存下」的殘檔。

---

## 9. 孤兒附件清理 command（M4 · `/attachments-gc`）

- **形式**：`.harness/commands/attachments-gc.md`（技能檔，帶 frontmatter），與既有 command 一致；使用者打 `/attachments-gc` 觸發。
- **語意**：掃當前工作區 `chat_history/attachments/*`，逐個 `<sessionId>` 資料夾檢查是否存在對應的 `chat_<sessionId>.json`：
  - **無對應對話檔** → 孤兒 → 列出（大小、修改時間、檔數）。
  - 預設**先報告、需確認才刪**（破壞性動作先確認的天條）；可帶 `--yes` 直接清、`--dry-run` 只看不刪。
- **工作區隔離**：只掃 `resolveWorkspace` / 當前工作區的 `chat_history`，不跨工作區（沿用排程隔離鐵則精神）。
- **誠實護欄**：跳過正在被寫入 / 今日剛建立（< 數分鐘）的資料夾，避免誤刪剛上傳還沒送出的檔；刪除逐筆記錄、回報清了幾個 / 釋出多少空間。

---

## 10. 非目標 / 注意

- 不改 Hana「大腦」或判讀能力——多模態是 CLI 本來就有的，本 spec 只做管線。
- 不引入資料庫；附件是純檔案，跟著 `.harness/runtime/` 走 per-machine、git-ignored。
- 檔名穩定即鍵：附件以 sessionId 分夾，不與對話標題勾稽（標題可改）。
