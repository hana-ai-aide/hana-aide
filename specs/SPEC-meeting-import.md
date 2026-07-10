# SPEC — 會議匯入（Meeting Import：音檔／字幕 → 會議記錄分析）

> Status: Draft v1.0 ｜ 開源（隨公開版出貨）
> 關聯：[[SPEC-meeting-transcriber]]（錄製→逐字稿）、[[SPEC-meeting-summary]]（MTG-SUM 多模型摘要）、[[SPEC-setup]]（§13 依賴完整性鐵律）

## 0. 目的

Hana 目前的 AI 會議功能只能「即時錄製」（含電腦音訊 loopback）→ 地端 STT → 分析。本規格新增一條**匯入**路徑：讓使用者把**既有的音檔（mp3 / mp4）或字幕（vtt / srt）**丟進來，一樣產出會議記錄與多模型摘要。

因為 Hana 是**本地端**助理，檔案取得方式同時支援：
1. **HTTP 上傳**（portal 會議頁的「匯入」鈕，multipart）——小檔方便。
2. **本地路徑**（填絕對路徑，server 直接讀）——大 mp4 免上傳。

## 1. 核心原則：最大重用，最少新碼

匯入的產物只要是一個**標準 meeting 目錄**，現有機制就會自動接手。現況（已探勘確認）：

- 會議實體：`<workspace>/.harness/runtime/meetings/<meetingId>/`，含 `meta.json` + `transcript.txt`（格式 `[HH:MM:SS] 文字\n`）。
- `stt.py` 已有 **`transcribe_file(audio_path, lang, model_size, ...)`**：底層 `faster_whisper` 用 **PyAV 解碼**，**本來就吃檔案路徑**，mp3、mp4 都能直接丟（PyAV 自動抽 mp4 音軌），**不需要另裝 ffmpeg**。
- `server.js` 的 **`finalizeMeetingSummary(meetingId, meetingDir, wctx)`**（`portal/server.js:3143`）＋ **MTG-SUM-04 lazy backfill**（`:3486`「transcript 存在但沒 summary.md → 自動跑摘要」）會自動完成多模型摘要。
- 會議列表／逐字稿／摘要 UI 皆讀該目錄——匯入的會議天生就能顯示。

→ 所以本功能 = 「生一個含 `transcript.txt` 的 meeting 目錄 + 觸發 finalize」，**分析零新碼**。

## 2. 依賴檢查（SPEC-setup §13 鐵律）

| 格式 | 需要的東西 | 是否新增人工安裝依賴 |
|:--|:--|:--|
| mp3 / mp4 | 現成 `faster_whisper`（PyAV 隨附）＋ GPU STT | ❌ 無（STT 裝好就會） |
| vtt / srt | 純 Python 解析 | ❌ 零依賴、不用 GPU |

**結論：不新增任何要人工安裝的依賴，`/setup` 不需改。**（僅若未來要支援冷門編碼才需 ffmpeg，屆時才依 §13 註冊；v1 不做。）

## 3. 匯入流程（新端點）

### 3.1 `POST /api/meeting/import`
兩種輸入擇一：
- **multipart 上傳**：欄位 `file`（mp3/mp4/vtt/srt）＋ 選填 `title`、`lang`、`model`。
- **JSON `{ path, title?, lang?, model? }`**：`path` 為 server 可讀的本地絕對路徑。

處理：
1. 依副檔名判類型（audio: `.mp3/.mp4/.m4a/.wav`；subtitle: `.vtt/.srt`），不認得 → `400`。
2. 上傳檔存到暫存（`meetingDir/source.<ext>`）；本地路徑則直接讀（**不複製大檔到別處，只讀**）。
3. 建 meetingDir（同 `/api/meeting/start` 慣例）：`meetingId = 'meeting_' + Date.now()`，寫 `meta.json`（`source: 'import'`、`origin: <原始檔名或路徑>`、`title`、`createdAt`、`status: 'importing'`）。
4. 依類型產 `transcript.txt`（見 §4／§5）。
5. 完成後 `meta.status = 'done'`，呼叫既有 `finalizeMeetingSummary(meetingId, meetingDir, wctx)`（**完全重用**）。
6. 回 `{ ok:true, meetingId }`；前端導到該會議詳情（摘要由 lazy-backfill/finalize 產出）。

### 3.2 大檔非同步
STT 大檔可能數分鐘。端點採「先建目錄回 `meetingId`、背景轉錄」；`meta.status`（`importing`→`transcribing`→`summarizing`→`done`／`error`）供前端輪詢，比照現有錄製中 tail 的作法。

## 4. 音檔路徑（mp3 / mp4）→ transcript.txt

新增一支 STT CLI 包裝（比照 `stt.py` 既有模式，走 venv）：
- 呼叫現成 `transcribe_file(path, lang, model_size)`，拿回帶時間戳的 segments。
- **輸出格式必須與 `meeting_record.py` 一致**：`[HH:MM:SS] 文字\n`（`fmt_ts(seconds)` 同款），逐段 append + flush，確保與現有逐字稿 UI／摘要 prompt 相容。
- 繁中沿用 `stt.py` 既有 OpenCC 轉繁 + `DEFAULT_PUNCT_PROMPT_ZH`。
- mp4 直接丟路徑給 `transcribe_file`（PyAV 抽音軌）；不需先抽 wav。

## 5. 字幕路徑（vtt / srt）→ transcript.txt

新增純 Python 解析（零依賴）：
- 解析 cue：起始時間 + 文字（vtt `WEBVTT`/`HH:MM:SS.mmm --> ...`；srt 序號 + `HH:MM:SS,mmm --> ...`）。
- 若含 speaker/`<v 名字>` 標記，保留為前綴（利於後續 diarize 對齊；無則略）。
- 每 cue 轉成 `[HH:MM:SS] 文字\n`（時間戳取 cue 起始、去毫秒），連續同秒可合併。
- 去除 vtt 樣式標籤（`<c>`、`<00:00:00.000>` inline timing 等），只留純文字。
- **不經 STT、不用 GPU、秒完成。**

## 6. UI

會議頁（`portal/index.html` 會議面板）新增「**匯入**」鈕：
- 檔案選擇（accept `.mp3,.mp4,.m4a,.wav,.vtt,.srt`）→ multipart 上傳。
- 或「本地路徑」輸入框（大檔）→ JSON 送 `path`。
- 送出後顯示 `meta.status` 進度（轉錄中／摘要中），完成導到會議詳情。
- 選填：語言、STT 模型大小（沿用現有錄製設定的選項）。

## 7. 邊界與安全

- 副檔名／MIME 白名單；非白名單一律 `400`，不試圖解碼未知格式。
- 本地路徑模式：僅讀、不寫回原檔、不刪原檔；路徑走 workspace 感知（`wctx`），比照現有端點。
- 上傳大小上限（建議可設，預設寬鬆，因本地端）。
- 匯入的會議與錄製的會議在列表中可辨識來源（`meta.source: 'import'` + `origin`）。

## 8. 部署註記

本功能改到 **`server.js`（新端點）+ `index.html`（UI）** → **需要 Deploy**（走 `Deploy_Harness.ps1`），與 FB 那批「standalone 模組免 Deploy」不同。STT CLI 包裝與字幕 parser 為新檔（render-service 下）。

## 9. 驗收（AC）

1. 匯入一個 **mp3** → 產生 meeting 目錄、`transcript.txt` 格式正確、自動出現多模型摘要。
2. 匯入一個 **mp4** → 音軌被 PyAV 正確抽出轉錄（無需 ffmpeg），流程同上。
3. 匯入一個 **vtt** 與一個 **srt** → 不經 STT，秒轉出 `transcript.txt`、摘要正常。
4. 本地路徑模式與 HTTP 上傳模式皆可用；大檔（>30 分鐘）不阻塞 UI（背景轉錄 + status 輪詢）。
5. `/setup` 無需新增項目（確認未引入人工安裝依賴）。
6. `node --check` + Deploy smoke 通過。

## 10. 任務對照（見 `.worktable/TASK.md` §V）

| Task | 內容 |
|:--|:--|
| MTG-IMP-01 | 字幕 parser（vtt/srt → transcript.txt），零依賴、單測 |
| MTG-IMP-02 | STT CLI 包裝（音檔→transcript.txt，重用 `transcribe_file`，格式對齊 meeting_record） |
| MTG-IMP-03 | `POST /api/meeting/import` 端點（上傳＋本地路徑、建目錄、分派、觸發 finalize、status 輪詢） |
| MTG-IMP-04 | 會議頁「匯入」UI |
| MTG-IMP-05 | 端到端驗證（mp3/mp4/vtt/srt 各一）＋ Deploy；確認 /setup 免動 |
