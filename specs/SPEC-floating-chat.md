# SPEC — Floating Chat + Voice Input（浮動對話 + 語音輸入）

> Status: READY for build ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/index.html`（浮動 chat、面板互斥、麥克風鈕）、`portal/server.js`（chat session `filePath`、`/api/stt`）、`portal/telegram.js`（語音訊息）、`portal/render-service/stt.py`（共用，見 `SPEC-meeting-transcriber.md` §3）
> 對應 TASK.md **F 系列**。
> **決策（老闆已拍板）**：語音輸入用 **server Whisper（與會議記錄共用 `stt.py`）**，非瀏覽器 Web Speech。

---

## 1. 核心原則

1. **邊看檔邊聊**：開著某個檔時，Hana 就在旁邊的**浮動視窗**可對話/請她改檔——取代現有「開對話後再開檔變成上下分隔」的爛體驗。
2. **對話即記憶**：浮動 chat 與整頁 chat **寫同一份 `chat_history`**，且帶上「這段對話在聊哪個檔」→ 可被 `/memory` 蒸餾。
3. **檔案脈絡自動注入**：Hana 知道「現在」開的是哪個檔（路徑 + 內容），不用使用者重貼。
4. **麥克風是「使用者的輸入工具」**：做在 **chat 輸入框旁**（像一般 AI 網站），**不碰 Hana 頭像**。
5. **共用引擎**：語音辨識走 `stt.py`（與 `SPEC-meeting-transcriber.md` F 同一套 server Whisper）。

---

## 2. 現況錨點（Hana 動工前先定位這些真實位置）

- chat session 檔：`<workspace>/.harness/runtime/chat_history/chat_<sessionId>.json`；欄位現有 `sessionId, updatedAt, messages, trace, title`。
- chat API（`server.js`）：`GET /api/chat-histories`(~965)、`GET/PUT/DELETE /api/chat-session/:id`(~978/1018/1042)、`POST /api/chat`(~1216, body `{sessionId, messages, model, jobId}`、`activeSessionId = sessionId || session_<ts>`、`writeContextFile`、`buildChatPrompt(messages, contextFilePath, wctx)`）。
- 面板（`index.html`，皆 `flex-1` 兄弟）：`#wiki-panel`(1008)、`#chat-panel`(1459, 預設帶 `hidden`)、`#codegraph-panel`、`#docgraph-panel`、`#schedule-panel`、`#telegram-panel`，加上本批要新增的 `#meeting-panel`。
- `#hana-float-widget` 已有 `.avatar-hidden` CSS（415-426）。
- **F3 的 bug 實證**：`loadFile()`(2285) 在 2347-2351 / 2404-2408 只 `add('hidden')` 給 codegraph/docgraph/schedule/telegram，**獨漏 `#chat-panel`** → 開著對話再開檔就上下疊。

---

## 3. F1 — 浮動 Chat 視窗

- 一個**浮動、可拖曳、可縮放**的視窗（如錨定右下角，可收合），**疊在 `#wiki-panel` 之上**（不走面板互斥，因為要「一面看檔一面聊」）。**與 `#hana-float-widget`（頭像）是不同元件**。
- 內含：訊息流 + 輸入框 + 送出鈕 + **麥克風鈕（見 §6）**。
- **重用現有送出管線**：呼叫 `POST /api/chat`，渲染沿用現有 chat 訊息渲染。
- 綁定前端全域 `currentFilePath`（由 `loadFile` 設定，見 §5）。浮動 chat 開啟時，其 session 帶此 `filePath`。
- 「改這段」類請求：Hana 透過既有檔案儲存路徑改檔後，前端收到「檔已變」→ 重載 `#wiki-panel`（沿用現有 reload）。

---

## 4. F2 — 對話 ↔ 檔案關聯（接續 / 開新）

- **資料**：chat session JSON 新增 `filePath` 欄位（值＝該檔相對 workspace 的路徑＝既有穩定 id；**不用對話名稱勾稽**）。
- **POST /api/chat** 接受 optional `filePath` → 持久化到該 session。
- 新端點 **`GET /api/chat-sessions?filePath=<path>`**：回該檔關聯的 sessions（依 `filePath` 過濾現有清單）。
- **前端流程**：在某檔開啟浮動 chat →
  - 查該 `filePath` 的 sessions：**0 條** → 自動開新 session；**≥1 條** → 跳小選單「**接續上次 / 開新對話**」（一檔可對多對話）。
  - 新 session 自動命名（用現有 `title`）：`<basename> · 對話N`（N＝該檔現有對話數+1）。
- **檔案脈絡注入**：`buildChatPrompt`（或 POST handler）若 session 有 `filePath` → 讀該檔內容，作為 system context 前置（讓 Hana 知道在聊哪個檔、看得到內容）。內容過大時截斷並註明。
- 注意：檔案改名/搬移會斷此連結（路徑為鍵）；現階段檔名穩定先不處理（記入待拍板）。

---

## 5. F3 — 面板互斥（修上下分隔 + 對話視圖隱藏頭像）

- 新增 helper **`function showPanel(id)`**：對「所有 flex-1 面板」清單（`wiki/chat/codegraph/docgraph/schedule/telegram/meeting`）逐一 `add('hidden')`，只對 `id` `remove('hidden')`。
- **`loadFile` 改用 `showPanel('wiki-panel')`**（取代散落的多個 add/remove，**順手補上漏掉的 `#chat-panel`**）→ 根治上下分隔。
- 開整頁對話（既有開 `#chat-panel` 的入口）改用 `showPanel('chat-panel')`。
- **頭像隱藏**：`showPanel('chat-panel')` 時對 `#hana-float-widget` `add('avatar-hidden')`；切到其他面板時 `remove`（整頁對話視圖內，頭像功能多餘）。
- 注意：**浮動 chat（§3）不受此互斥**（它是 overlay，不在面板清單內）。

---

## 6. F4 — 語音輸入（麥克風在 chat 輸入框旁，server Whisper）

- 在 chat 輸入框旁（浮動 chat 與整頁 chat 皆有）加**麥克風鈕**。按下 → 開始錄音；再按 → 停止。
- **瀏覽器端**：用 `MediaRecorder` 錄成 blob（webm/opus）→ `POST /api/stt`（multipart 或 raw body）。
- **Server `/api/stt`**：把音訊存暫存檔 → spawn `stt.py`（venv 絕對路徑，見 §8）→ 取回文字 → 回 JSON `{text}` → 前端**把文字填進輸入框**（使用者可再編輯後送出，不自動送）。
- 語言：預設 `zh`（輸出繁體，stt.py 已處理）；可加 UI 切換 `en`（印度客戶等）。
- **不碰 `#hana-float-widget`**（麥克風是使用者輸入工具，與頭像無關）。
- **狀態（2026-06-25 起已落地）**：麥克風來源已上線 —— `index.html` 麥克風鈕 → `voiceToggle(...)`（整頁與浮動 chat 共用同一支）→ `MediaRecorder` → `POST /api/stt` → 常駐 whisper worker（`sttTranscribe`，無每次重載模型）→ 回填輸入框；語言切換鈕（zh/en）已有。**F6 在此之上加「電腦音訊」來源。**

---

## 6b. F6 — 語音輸入來源：麥克風 vs 電腦音訊（loopback）

> **需求**：老闆開線上會議時要 Hana「聽到電腦另一端的人講的話」→ chat 語音輸入除了麥克風（自己），要能收**電腦正在播的聲音**（＝會議對方）。整頁與浮動 chat 皆需支援。
> **前提結論（已 survey）**：底層零件都現成、不需新技術。缺的只是把來源接上 chat 輸入框。

### 6b.1 為何「電腦音訊」不走瀏覽器、改走 server loopback
- 瀏覽器 `getUserMedia` 只給**麥克風**，拿不到系統音訊。
- `getDisplayMedia({audio:true})` 雖能帶系統聲，但：① 每次強制跳「分享螢幕/分頁」選擇視窗；② Windows/Chrome 下只有分享「整個螢幕或某分頁」才附系統聲、分享視窗常無聲；③ 開會情境每則都要重選 → 體驗差、不穩。**列為備援，不採用。**
- **既有真身**：`portal/render-service/meeting_record.py` 的 `resolve_devices(p, source)` 已在 server 端用 **PyAudioWPatch** 解析 `loopback`（`get_default_wasapi_loopback()`，後援掃 `[Loopback]` 裝置名）+ `make_reader()` 收音 → **重用它**，穩、無彈窗、已在會議轉錄驗證過。

### 6b.2 UI 形態：雙輸入框承載「說話者身分」（老闆已拍板 — 採方案 (2)）
> **決策理由**：核心需求是「Hana 要分得清是**我**還是**會議對方**在講」。若電腦音訊填回同一個輸入框（方案 (1)），你的話與對方的話會混在一起、說話者邊界消失。改用**兩個實體輸入框＝兩個說話者**，身分由「框的位置」天然承載，最直接命中需求。

- **主輸入框 + 麥克風鈕**：維持 F4 現況，代表 **`我`（老闆）**。**不動。**
- **新增「電腦音訊（來賓）」切換鈕**（icon＝筆電＋音波/麥克風複合圖，hover 顯示標籤）：按下 → **主輸入框下方展開第二個輸入框**，**只收電腦音訊**。整頁與浮動 chat 皆有。
- **【2026-07-01 老闆拍板 — 說話者「取名」】** 第二框左上的靜態標籤改成一個**可打字的名字輸入框（textbox）**：老闆可輸入這位說話者是誰（如「王老師」「客戶 A」），Hana 就用這個名字認人。**留空時顯示 placeholder `來賓（Guest）`，送出與回填標記也一律用「來賓」。** 名字框永遠可編輯（收音中也可改），與收音狀態脫鉤。
- **【2026-07-01 老闆拍板 — 即時逐字＋收音中唯讀】** 第二框（來賓話語框）先做**即時逐字顯示**：按下收音鈕 → 該框變**唯讀**、辨識到的片段**逐段滾動回填**（不是收完才一次出字）；再按停止 → 該框變**可寫**，老闆可自行補打/修字（例如來賓不方便講話、改用打字貼給你的情形）。名字框不受此唯讀切換影響。
- **【2026-07-01 老闆拍板 — 送出模型】** **預設「合併送」**：一次送出把「我」框＋「來賓」框各自貼說話者標籤，合成**單則**給 Hana（來賓段以引用/標籤區塊呈現、你在主框的字當提問，格式見待拍板 #9）。**另加兩個小連結**「**只發我這段**」／「**只發來賓這段**」，供這回合只有一方在講、或誤填時單獨送。**不用 switch 互斥、兩框都保持可（依上條收音狀態）編輯。**
- 「來賓」框可**累積多段**擷取（收好幾輪來回再一起問），不是每次覆蓋（見待拍板 #11）。

### 6b.3 電腦音訊管線（loopback，即時逐字回填 + 靜音自動收尾）
- **【2026-07-01 老闆拍板 — 即時逐字（rolling）】** 來賓框改**邊收邊出字**，不再整段收完才一次辨識：
  - server 端收音迴圈**滾動切段**（如每 N 秒或偵測到句界的靜默）→ 每段丟 `sttTranscribe` → 產生「目前累積逐字」。
  - 前端在收音中**輪詢**（或 SSE）`GET /api/stt/loopback/partial?captureId=` 取回目前累積文字，**滾動回填**唯讀的來賓框（見 §6b.2 唯讀規則）。停止/自動收尾後回傳最終整段。
  - 實作重用同一顆常駐 whisper worker，避免每段重載模型。
- 瀏覽器抓不到系統音 → 走 server 端擷取：
  - 按「電腦音訊」框的開始 → `POST /api/stt/loopback/start` → server 用**重用的裝置解析**開一條 loopback stream、把音框收進暫存 wav、並開始滾動辨識 → 回 `{captureId}`。
  - 收尾（下列任一觸發）→ 收尾 wav → 丟現有 `sttTranscribe`（同一顆常駐 whisper worker）→ 回 `{text}`（最終整段）→ 前端**回填「來賓」框並解除唯讀**（不自動送給 Hana，最後提問由你按送出）：
    1. **手動停止**：`POST /api/stt/loopback/stop` body `{captureId}`。
    2. **靜音自動收尾（老闆已拍板）**：收音迴圈**逐框算音量能量**，**連續 10 秒低於靜音門檻**（對方講完）→ server 自動收尾該段、轉文字回填，你不用按停止。門檻/秒數見待拍板 #10。
    3. **硬上限兜底**：單次 loopback 擷取 **≤ 5 分鐘**自動收尾（VAD 失靈時的保險、防忘了停一直錄）。
  - 資源：擷取子行程/stream 登記於現有 jobs 管理；Windows WASAPI loopback teardown 的 segfault 收尾比照 `meeting_record.py` 既有處理。
- **語言 / 繁體輸出**：兩來源共用 `stt.py`（zh→OpenCC 繁體），沿用 F4 的 zh/en 切換。
- **【2026-07-01 老闆拍板 — STT 標點策略】** 現況中文辨識「字全黏成一串、無標點」是 Whisper 對中文的已知脾氣（OpenCC 只做簡→繁、不加標點；`--prompt` 目前預設空）。**預設打開 initial_prompt 標點誘導**：`stt.py`（whisper worker）辨識時餵一段**本身帶標點的中文提示語**（如「以下是一段會議對話，內容包含適當的標點符號。」）當 `initial_prompt`，Whisper 會模仿其書寫風格在輸出補逗號/句號/斷句——零額外成本、不換模型、對中文特別有效。提示語做成常數可調（見待拍板 #15）。
  - **模型大小**：維持現況 `small`；`medium` 標點/斷句更穩但變慢、拖累即時逐字，**不預設換**，留成可選（見待拍板 #15）。
  - **事後標點還原（最重、可選）**：真正要送給 Hana 的最終文字，可再過一次補標點；因需等整段完才好斷句、與即時逐字相衝，**只用於送出前的最終版、不套在即時來賓框**（見待拍板 #15）。
- **範圍**：先只做二選一來源（不做 `both` 混音，見待拍板 #7）。

### 6b.3 邊界：一次性語音輸入 vs「Hana 全程在會議裡」
- **F6 只做「一次性 push-to-talk」**：抓一段對方的話 → 轉文字 → 你補問題送給 Hana。與麥克風對稱、最小。
- **要 Hana「全程聽整場會議、隨時可問」不在 F6**：那是既有**「AI 會議」錄製流程**（`SPEC-meeting-transcriber.md`，source 選 `loopback`/`both`、即時逐字稿）＋ `SPEC-meeting-workspace.md W5`（浮動對話綁定會議、注入整場逐字稿/摘要）的組合 —— **不需新做**。F6 與它是互補的兩個入口，不重複收音邏輯。

### 6b.4 說話者身分「結構化」（icon 區分 ＋ Hana 認人）｜老闆 2026-07-01 拍板（v0.6）
> **背景（兩個症狀同一個根）**：指揮官實測發現 ① chat 的訊息 icon 分不出「我」還是「來賓」；② 送出後 Hana 不認得「是誰在跟她講話」，把來賓那段當成「你自己講了段怪話」在回（尤其只發來賓、主框空白時更發散）。
> **根因**：目前來賓身分只是一段**脆弱的引用文字前綴**（`> 名字：…`，`buildGuestQuote` 合成、`buildChatPrompt` 只當純文字塞進「使用者問題」）——**整條鏈沒有任何結構化資料告訴 Hana「這個區塊是另一個真實在場的人對你講話」**；前端渲染也只認得 `role:'user'`（永遠畫同一顆 user 圖示）。
> **修法（共同地基）**：把「說話者身分」從文字前綴**升級成訊息上的結構化資料**——一次送出仍是同一個 API 回合，但 body 帶一個**有序回合陣列** `turns:[{speaker:'me'|'guest', name, text}]`。前端照序畫、後端照序組 prompt，icon 區分與 Hana 認人**都建在這個結構上、不再靠認 `> 名字：`**。

- **【拍板 A — 兩顆獨立泡泡（非同泡泡上下分區）】** 畫面上來賓與我**各一顆獨立泡泡**（不是一顆泡泡內上下兩區）。渲染邏輯與現有訊息泡泡一致 → 好做、也讓「兩個人各講一段」一眼清楚。
- **【拍板 B — 排序固定「來賓在前、我在後」（不用時間戳）】** turns 一律**來賓段在前、我的主框段在後**。
  - **理由（寫進 spec 當設計依據，勿再改成時間戳）**：時間戳不可靠——來賓走 loopback 即時轉錄、可能講了幾秒才吐第一個字；我可能在他講完後才打字、或打錯字改讓來賓先講、或來賓不便講話由我代貼他的話 → **「起算點」根本無法界定**，硬排時間戳只會亂。而**按下「電腦音訊（來賓）」＝來賓要開始講**，此時我在主框打的字通常只是**備註／提問框架**、不是這回合的重點。正常會話本就是一問一答（來賓問我→我直接答；或來賓問 Hana→Hana 答；我頂多加一句註解說明來賓的意思）→ **固定來賓在前**最貼近實情、最穩、也免除「保留順序」的所有邊界情形。
- **【前端 — icon 區分】** 有了結構欄位後，渲染 user 回合時：
  - **我的話** → 維持現有 `我` user 圖示／泡泡。
  - **來賓的話** → 獨立泡泡，用**琥珀色系**（沿用來賓輸入框那個 amber，視覺一致），avatar＝**來賓名字第一個字**（Jason→「J」、王老師→「王」；留空＝「來賓」），旁標全名。**不同來賓以名字雜湊出不同顏色** → Jason 與客戶 A 一眼分得出。
  - 兩處渲染都要改：**整頁 chat**（`appendMessageToUI`）＋**浮動 chat**（其 render）。
- **【後端 — Hana 認人】** `buildChatPrompt` 偵測到 turns 含 guest 段 → 注入一段**隱藏框架**（指揮官看不到、只有 Hana 看到），大意：
  > 「本則含現場另一位真實說話者 `<名字>`（透過電腦音訊 loopback 即時轉錄，逐字可能有辨識誤差，抓語意即可）。請把他當成對話的另一方、**直接稱呼他的名字回應**（如『Jason 你好，針對你的問題…』）。主框才是指揮官 老闆對你說的（通常是備註或提問框架）。」
  - 讀的是**結構欄位**，不會和一般 Markdown 引用搞混，也不怕主框空白。
- **【與送出模型銜接（6b.2 三顆鈕）】** 合併／只發我／只發來賓**都改帶 turns**：合併＝turns 有兩段（來賓在前、我在後）；只發來賓＝turns 只含 guest 段；只發我＝只含 me 段。名字取值規則同前（名字框留空＝「來賓」）。**取代**原本 `buildGuestQuote` 合成單則純文字的做法。

### 6b.5 影響範圍（F6 增量）
- `portal/index.html`：加「電腦音訊（來賓）」切換鈕（筆電＋音波 icon）→ 展開第二框，含 **① 說話者名字 textbox**（placeholder `來賓（Guest）`，留空即用「來賓」）＋ **② 來賓話語框**（收音中唯讀、停止後可寫，見 §6b.2）；`voiceToggle` 依來源分派（麥克風＝現況；電腦音訊＝呼叫 loopback start/stop、**收音中輪詢 partial 端點滾動回填**）；送出區三顆：**合併送（預設）／只發我這段／只發來賓這段**，合成時用名字框的值（空＝來賓）當說話者標籤。整頁與浮動 chat 共用。
- `portal/server.js`：新增 `POST /api/stt/loopback/start`、`POST /api/stt/loopback/stop`、**`GET /api/stt/loopback/partial?captureId=`（即時逐字輪詢）**；stop 回應帶 `{text, endedBy: manual|silence|maxDuration}`（最終整段）。**重用** `venvPython()` + `sttTranscribe` + jobs 管理。
- `portal/render-service/`：一支小的一次性 loopback 擷取器（可為 `loopback_capture.py`，或給 `meeting_record.py` 加輕量模式）—— **重用 `resolve_devices` / `make_reader`，不另寫收音**；收音迴圈內：**① 滾動切段做即時逐字**（每 N 秒/句界靜默 → 辨識一段、累積輸出供 partial 端點讀）＋ **② 逐框能量 VAD**（連續 10 秒靜音自動收尾）。

### 6b.6 影響範圍（v0.6 說話者身分結構化增量）
- `portal/index.html`：**送出改帶有序 `turns:[{speaker,name,text}]`**（來賓在前、我在後），取代 `buildGuestQuote` 合成單則；三顆送出鈕各組對應 turns（合併=兩段／只發我=me／只發來賓=guest）。**渲染分兩處改**：整頁 chat `appendMessageToUI` ＋ 浮動 chat render —— user 回合依 `speaker` 畫不同泡泡：`me`＝現有 `我` 圖示；`guest`＝琥珀色泡泡、avatar=名字首字、名字雜湊配色、留空顯「來賓」。
- `portal/server.js`：`POST /api/chat`（及浮動 chat 對應入口）接受 `turns`；`buildChatPrompt` 偵測 guest 段 → **注入隱藏框架**（見 §6b.4：來賓是現場真實說話者、loopback 轉錄可能有誤、請直接稱呼其名回應；主框才是 老闆的話）。持久化到 chat_history 時保留 turns 結構，供 icon 重繪與 `/memory` 蒸餾。

### 6b.7 通話簡短回話模式（concise call reply）｜老闆 2026-07-03 拍板（v0.7）
> **需求**：通話時電腦另一頭的人**沒耐心聽完長篇**——Hana 回話要**精準、扼要、直接講重點但重點要在**，像口語對答、不是寫報告。
> **現況問題**：guest 段雖已讓 Hana「稱呼來賓名」（§6b.4），但回話仍是**完整書面風**——大量鋪陳、對查不到的數字長篇免責、末尾附「Sources:」清單。實例：對方問「今天星期幾？明天台南會不會下雨？」，Hana 回了一整段「今天 vs 明天」辨析＋免責＋三條來源連結。
> **期望輸出（同一題）**：「Puma 您好，明天是星期六，我查到明天台南的天氣是陰天，下雨機率 35%」——一句話、稱呼名、直接給答案。

- **觸發**：**自動**——`buildChatPrompt` 偵測到本回合含 guest 段（§6b.4 已在偵測）時，除了原本的「稱呼來賓名」框架，**再疊加一段「通話簡短模式」指令**。無 guest 段的一般開發對話**完全不受影響**（維持詳盡）。
- **簡短模式指令內容（注入 Hana 的隱藏框架，指揮官看不到）**，大意：
  > 「這是**即時通話**，對方在線上等你口頭回覆、沒耐心讀長文。請**精準扼要**：先稱呼對方名字，直接給**結論與關鍵數字**，一般 1–3 句話。**不要**：逐點鋪陳、重述問題、對查不到的資料長篇免責、附『Sources:』來源清單、加免責聲明。若資料不確定，用一句話點出即可（如『數字僅供參考』），不展開。」
- **Sources 處理**：簡短模式下**不附來源清單**（那是給對方「聽」的，不是閱讀）。若指揮官事後要出處，可在一般（非 guest）對話再問。
- **仍保正確**：簡短 ≠ 亂答——重點與關鍵數字要對；只是去掉多餘鋪陳／免責／來源。
- **可選關閉（待拍板 #17）**：預設「有 guest 段就簡短」，本版不做 UI 開關。

### 6b.8 語音辨識模型可選（chat STT model selector）｜老闆 2026-07-03 拍板（v0.7）
> **需求**：像「AI 會議」那樣，讓 chat 語音輸入也能**自己選 STT 模型**（`small`/`medium`），按「速度 vs 準度」調整，也方便日後換更強 GPU 時升級。
> **現況**：chat 的 `/api/stt`（F4 麥克風）與 loopback（F6 來賓）目前**寫死 `medium`**（`server.js` `opts.model||'medium'`）。AI 會議已有現成選單（`index.html:1750`，`small/medium/large-v3`）可照抄。

- **UI**：在 chat 語音區（麥克風鈕／來賓面板旁，整頁與浮動 chat 皆有）加一個小 `<select>`，**照抄會議選單樣式**，選項 `small（快）`／`medium（準）`（可含 `large-v3` 備日後 GPU）。**預設 `small`**（對齊 2 秒內回填目標；使用者可自行調 `medium` 換準度）。
- **持久化**：選擇存 `localStorage`（比照其他偏好），重開沿用。
- **套用範圍**：**F4 麥克風**（`/api/stt?model=`）**與 F6 來賓 loopback**（loopback start 帶 `model`）**共用同一個選擇**。
- **順帶修速度**：loopback 互動路徑目前 `beam_size` 吃預設 5 → 互動情境改 **1**（F4 麥克風已是 1），再快一截，對齊 2 秒目標。
- **影響範圍**：`index.html`（加 select ＋ localStorage ＋ 兩處送出帶 model）；`server.js`（`/api/stt` 與 loopback start 讀前端傳的 model、非寫死；loopback 互動 beam 1）。**模型都已在 venv、GPU 已驗證，純參數化，不動 stt.py 核心。**

---

## 7. F5 — Telegram 語音訊息對講（非即時）

- `telegram.js`：收到 `message.voice` → 既有 `getFile`（目前用在圖片）下載 .ogg → 存暫存 → `stt.py`（lang 視設定）→ 得文字 → 餵現有 Hana chat 流程處理。
- 回覆：用既有 edge-tts（`render-service/tts-edge.js` / `tts.js`）合成語音 → Telegram `sendVoice` 回一段語音；同時可回文字。
- **真・即時通話 Bot API 做不到** → 即時語音留在 portal（F4）。

---

## 8. node ↔ python（與 G 共用）

- 沿用 `SPEC-meeting-transcriber.md` §8 的 `venvPython()` helper（`process.env.HARNESS_VENV` 否則 `<harnessRoot>/.venv/Scripts/python.exe`）。
- spawn 帶 `env: { ...process.env, PYTHONUTF8: '1' }`。
- `stt.py` 必須**先於 F4/F5 完成**（它住在 G spec，是共用前提）。

---

## 9. 驗證（DoD）

- [ ] F3：開整頁對話 → 再 `loadFile` → **只剩檔案面板，無上下分隔**；整頁對話視圖時頭像隱藏。
- [ ] F1/F2：開檔 A → 浮動 chat → 送一則 → `chat_<id>.json` 出現且帶 `filePath=A`；重開檔 A 的浮動 chat → 跳「接續/開新」；開新 → `title='<A> · 對話2'`。Hana 回覆能引用該檔內容（脈絡注入生效）。
- [ ] F4：點麥克風講話 → 文字填入輸入框（**用 edge-tts 合成音檔走同一 `/api/stt` 自動驗證鏈路**；真人麥克風＝手動）。
- [ ] F5：Telegram 傳語音 → Hana 文字理解正確 → 回一段 sendVoice。
- [ ] F6a：按「電腦音訊（來賓）」→ 主框下方展開第二框（名字 textbox ＋ 來賓話語框）；電腦正在播的聲音轉文字**回填到「來賓」框**（非主框）。**自動驗證**：以程式播一段 edge-tts 到預設輸出，同時 loopback 擷取 start/stop → 回文字內容相符（比照 `SPEC-meeting-transcriber §10`）。整頁與浮動 chat 皆通。
- [ ] F6a2（即時逐字＋唯讀切換）：按收音 → 來賓框**變唯讀**且辨識片段**滾動回填**（收音中就看到字長出來，非收完才出）；按停止 → 來賓框**變可寫**、可手動補打。**自動驗證**：收音中輪詢 partial 端點，文字隨播放進度增長。
- [ ] F6a3（說話者取名）：名字框留空 → 顯示/標記用「來賓（Guest）」；輸入「王老師」→ 送給 Hana 的來賓段標籤改用「王老師」。
- [ ] F6b（說話者身分＋送出模型）：主框＋「來賓」框各有內容 → **合併送** → 單則能區分兩位說話者（來賓段有名字標籤/引用），Hana 回覆能正確指涉「來賓說的」與「你問的」；**「只發我這段」/「只發來賓這段」**各自只送對應框內容。
- [ ] F6c（靜音自動收尾）：loopback 收音中，播放停止後**連續 10 秒靜音** → server 自動收尾並回填「來賓」框、解除唯讀（不需手按停止）；播放 > 5 分鐘 → 到硬上限自動收尾。
- [ ] F6d（STT 標點）：辨識一段多句中文 → 輸出**帶標點、有斷句**（非整段黏一串）；比對開啟 initial_prompt 前後，同一段音的標點明顯改善。
- [ ] F6e-icon（v0.6 泡泡區分）：合併送含來賓段 → 整頁 chat **與** 浮動 chat 都畫出**兩顆獨立泡泡**，來賓泡泡為琥珀色、avatar=名字首字、留空顯「來賓」；換不同名字 → 配色不同（Jason 與客戶 A 一眼可辨）。
- [ ] F6e-認人（v0.6 Hana 認人）：只發來賓、主框空白 → Hana 回覆**直接稱呼來賓名開場**（如「Jason 你好…」），不把來賓段當「你自己講的怪話」；主框有備註時，Hana 把主框當 老闆的框架、來賓段當對方的話，指涉正確。**自動驗證**：以帶 guest turn 的 body 打 `/api/chat`，檢查注入的 prompt 含來賓身分框架、且 turns 順序為來賓在前。
- [ ] F6e-order（v0.6 排序）：turns 一律**來賓在前、我在後**（不論前端輸入先後、不看時間戳）。
- [ ] F6f（v0.7 通話簡短回話）：有 guest 段送出 → Hana 回覆**稱呼來賓名 + 1–3 句直接給結論／關鍵數字**，**無**鋪陳／免責／Sources 清單；同一題無 guest 段（一般對話）→ 維持詳盡。**自動驗證**：以含 guest turn 的 body 打 `/api/chat`，檢查注入 prompt 含「通話簡短模式」框架；無 guest turn 則不含。
- [ ] F6g（v0.7 STT 模型可選）：chat 語音區出現 small/medium 選單、預設 small；選 medium → `/api/stt` 與 loopback start 都帶 `model=medium`；選擇存 localStorage 重開沿用；loopback 互動 beam=1。
- [ ] 🧑‍✈️ **指揮官手動驗證**（真人麥克風、真實線上會議收對方聲音、真實 Telegram 語音、真實多說話者對話下 Hana 認人與泡泡區分，此關只由 老闆勾）。

---

## 10. 待拍板（遇到先採預設、記錄，勿卡住）
1. 浮動 chat 位置/大小記憶（localStorage）？→ 先記憶位置即可。
2. 檔案改名導致 `filePath` 斷連 → 未來加 doc-id sidecar，現階段不處理。
3. 脈絡注入的檔案內容上限 → 先 ~8KB 截斷。
4. F4 語言切換 UI → 先預設 zh + 一個 en 切換鈕。
5. **【F6】電腦音訊擷取路徑**：server loopback（推薦；已驗證、無彈窗、重用會議收音）vs 瀏覽器 `getDisplayMedia`（免 server code 但每次跳分享視窗、Windows 上常無系統聲）。→ 先採 **server loopback**。
6. **【F6】電腦音訊進 chat 的形態**：一次性 push-to-talk（推薦；F6 範圍）vs「Hana 全程在會議裡」（＝既有 AI 會議錄製＋W5 綁定，不在 F6 另做）。→ **老闆已拍板：F6 只做一次性。**
7. **【F6】chat 要不要給 `both`（同時麥克風＋電腦音訊）**？→ **老闆已拍板：先只給二選一；`both` 混音留給會議錄製。**
8. **【F6】loopback 單次擷取硬上限**（防忘按停止）→ **老闆已拍板：5 分鐘自動收尾（當 VAD 兜底）。**
9. **【F6】送 Hana 時「我／來賓」的合成格式** → **老闆已拍板**：來賓段包成引用區塊、前綴用**名字框的值**（留空＝「來賓」）；你的主框字當提問附後；單則送出。**另提供「只發我這段」/「只發來賓這段」單獨送**（不用 switch 互斥）。
10. **【F6】靜音自動收尾的門檻/秒數** → 先採：連續 **10 秒**能量低於門檻自動收尾；門檻沿用/比照 `meeting_record.py` 的靜音判定，都做成常數可調。
11. **【F6】「來賓」框多段擷取行為** → 先採：**累積 append**（可收好幾輪來回再一起問），提供「清空」；非每次覆蓋。
12. **【F6・新】即時逐字的滾動切段策略**（每 N 秒 vs 句界靜默）→ 先採：**每 ~3–5 秒或偵測到 ~0.6 秒靜默切一段**辨識、累積輸出；partial 端點回目前累積文字。做成常數可調。
13. **【F6・新】partial 回填用輪詢還是 SSE** → 先採**輪詢**（前端每 ~1 秒 GET partial），與現有簡單、避免多開 SSE 連線；日後量大再換 SSE。
14. **【F6・新】收音中來賓框唯讀、停止後可寫**（老闆已拍板）→ 名字框不受此限、永遠可編輯。
15. **【F6・新】STT 標點改善**（老闆已拍板方向）→ **預設用 initial_prompt 標點誘導**（帶標點的中文提示語當常數、可調）；模型維持 `small`（`medium` 留可選、不預設換）；**事後標點還原**只當送出前最終版的可選加工、不套即時來賓框。開放子題（先採預設、勿卡）：提示語文字、事後補標點用專用模型或一次輕量 LLM。
16. **【v0.6】說話者身分結構化** → **老闆已拍板**（§6b.4）：改帶有序 `turns` 結構、**兩顆獨立泡泡**、**排序固定來賓在前**（不用時間戳）、後端注入來賓身分隱藏框架讓 Hana 認人。開放子題（先採預設、勿卡）：名字雜湊配色的色盤、chat_history 舊資料（無 turns 的既有訊息）向後相容顯示（無 turns → 照舊當單一 user 泡泡）。
17. **【v0.7】通話簡短模式是否要 UI 開關** → 先採**自動**（有 guest 段即簡短）、不做開關；日後若需「通話中也要詳盡」的例外再加。
18. **【v0.7】chat STT 模型選單選項** → 先採 `small`(預設)／`medium`；`large-v3` 可比照會議選單一起列（GPU 夠再用）。模型選擇 localStorage 持久化；順帶把 loopback 互動 `beam_size` 5→1。

---

## Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-25 | v0.1 | 老闆 + Claude | 初版。浮動 chat（overlay、綁 currentFilePath、重用 /api/chat）、對話↔檔案以 `filePath` 勾稽（接續/開新+自動命名）、檔案脈絡注入、`showPanel()` 修上下分隔 bug + 整頁對話隱藏頭像、麥克風鈕在輸入框旁走 server Whisper `/api/stt`、Telegram 語音訊息（getFile→stt.py→Hana→sendVoice）。決策：語音用 server Whisper 共用 stt.py（非 Web Speech）。 |
| 2026-07-01 | v0.2 | 老闆 + Hana | 新增 **F6 — 語音輸入來源：麥克風 vs 電腦音訊(loopback)**（開線上會議讓 Hana 聽對方聲音）。結論：既有技術足夠、不需新技術。電腦音訊不走瀏覽器（getDisplayMedia 不穩），改**重用 `meeting_record.py` 的 server 端 loopback 收音**（`resolve_devices`/`make_reader`）做一次性 push-to-talk → 同一顆 whisper worker → 回填輸入框；新增 `/api/stt/loopback/start`+`/stop`。整頁與浮動 chat 共用來源切換。「Hana 全程在會議裡」界定為既有 AI 會議流程＋W5、不在 F6 重做。4 條待拍板均附預設。 |
| 2026-07-01 | v0.3 | 老闆 + Hana | 老闆拍板 F6 UI＋行為：**採雙輸入框方案**（主框＋麥克風＝`我`；切換鈕展開下方「對方」框只收電腦音訊）——用「框的位置」承載說話者身分，送 Hana 時對方段加標籤/引用，讓 Hana 分得清誰講的。新增**靜音自動收尾**：loopback 收音逐框能量 VAD，連續 10 秒靜音自動收尾轉文字回填（5 分鐘硬上限降為兜底）。DoD 拆 F6a/b/c。新增待拍板 9–11（合成格式、VAD 門檻、對方框多段累積）。決策 6–8 標記已拍板。 |
| 2026-07-01 | v0.5 | 老闆 + Hana | 老闆拍板 **STT 標點改善**（§6b.3）：中文辨識無標點/黏一串是 Whisper 已知脾氣（OpenCC 不加標點、`--prompt` 預設空）。**預設打開 initial_prompt 標點誘導**（餵帶標點的中文提示語當常數、可調），模型維持 `small`（`medium` 留可選）、**事後標點還原**只當送出前最終版可選加工、不套即時來賓框。新增 DoD F6d、待拍板 #15。 |
| 2026-07-01 | v0.6 | 老闆 + Hana | 老闆拍板 **說話者身分結構化**（§6b.4）。**根因**：來賓身分只是脆弱的 `> 名字：` 引用文字前綴，整條鏈無結構化資料告訴 Hana「這是另一位真實在場者對你講話」→ ① icon 分不出我/來賓、② Hana 把來賓段當「你自己講的怪話」。**修法**：升級成訊息上的**有序 `turns:[{speaker,name,text}]`** 結構。拍板：**A** 兩顆獨立泡泡（非同泡泡上下分區）；**B** 排序固定**來賓在前、我在後**（不用時間戳——loopback 轉錄有延遲、代貼、起算點無法界定；按電腦音訊＝來賓要講、我的話多為備註）；前端 `appendMessageToUI`＋浮動 chat render 依 speaker 畫琥珀色來賓泡泡（avatar=名字首字、名字雜湊配色、空=來賓）；後端 `buildChatPrompt` 偵測 guest 段注入隱藏框架讓 Hana 直接稱呼來賓回應。取代 `buildGuestQuote` 單則合成。新增 §6b.6 影響範圍、DoD F6e、待拍板 #16。 |
| 2026-07-01 | v0.4 | 老闆 + Hana | 老闆拍板 F6 三項精修：**①「對方」框改「來賓」＋即時逐字**：收音鈕按下該框變**唯讀**、辨識片段**滾動回填**（邊收邊出字），停止後變**可寫**可手打；新增 `GET /api/stt/loopback/partial` 即時逐字輪詢、收音迴圈滾動切段。**② 說話者「取名」**：第二框標籤改成**名字 textbox**，老闆打誰在講→Hana 用該名認人，**留空顯示/標記為「來賓（Guest）」**；名字框永遠可編輯。**③ 送出模型**：**合併送為預設**＋「只發我這段」/「只發來賓這段」兩單獨送小連結（不用 switch 互斥）。DoD 增 F6a2/F6a3；待拍板 9 標記已拍板、新增 12–14。全文「對方」統一為「來賓」。 |
| 2026-07-03 | v0.7 | 老闆 + Claude(Opus) | 新增兩項語音精修（§6b.7／6b.8）：**① 通話簡短回話模式**——通話對方沒耐心聽長文，`buildChatPrompt` 偵測到 guest 段時，除既有「稱呼來賓名」再疊加「精準扼要」框架（1–3 句、直接給結論／關鍵數字，去掉鋪陳／免責／Sources 清單）；無 guest 的一般對話不受影響；預設自動觸發、不做開關。**② chat STT 模型可選**——比照 AI 會議選單，chat 語音輸入加 small/medium 選單（預設 small、localStorage 持久化），F4 麥克風＋F6 loopback 共用、不再寫死 medium；順帶把 loopback 互動 beam_size 5→1。實測確認 STT 現況＝faster-whisper medium 跑在 GPU（cuda/float16，非誤掉 CPU）。新增 DoD F6f/F6g、待拍板 #17/#18。 |
