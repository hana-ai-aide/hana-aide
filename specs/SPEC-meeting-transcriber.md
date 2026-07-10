# SPEC — Meeting Transcriber（語音會議記錄）

> Status: READY for build ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/render-service/`（新增 stt.py / meeting_record.py / diarize.py）、`portal/server.js`（會議 API + spawn）、`portal/index.html`（會議面板）、各 workspace `.harness/runtime/meetings/`
> 對應 TASK.md **G 系列**。環境（64-bit py3.12 venv、faster-whisper、PyAudioWPatch、edge-tts）已於 2026-06-25 備妥並驗證（見 TASK G0.1）。
> **本 spec 的 STT 層（§3 stt.py）同時被 `SPEC-floating-chat.md` 的 F4/F5 共用** —— 先建本 spec 的 stt.py，F 的語音才能用。

---

## 1. 核心原則

1. **即時辨識、邊轉邊存、防當機**：會議進行中持續把語音轉成文字，**每一段轉完立刻 append 到逐字稿檔並 flush+fsync**。電腦中途當掉，已轉的內容全保得住（最多丟最後一個 chunk）。這是整個功能的命脈。
2. **不必當主持人也能記**：可收**系統 loopback**（電腦正在播的會議聲＝對方的聲音），不依賴任何會議軟體的內建記錄。也可同時收**麥克風**（自己的聲音）。
3. **本機優先、私密**：辨識全在本機 venv 的 faster-whisper 跑，音訊不外送。
4. **可存音訊檔**：除逐字稿外，同步落一份音訊檔（供 §6 語者分離與存證）。老闆已確認可存、效能無虞。
5. **語者分離 → 會後改名**：先用 pyannote 把不同人標成 `人員A/B/C`，會議結束後由 老闆告知各是誰 → find-replace remap 成完整逐字稿。
6. **共用引擎**：與 `SPEC-floating-chat.md` F4/F5、`SPEC-telegram.md` 的語音都走同一個 `stt.py`。

---

## 2. 環境前提（已備妥，勿重建）

| 項 | 值 |
|---|---|
| venv | `<harnessRoot>/.venv`（64-bit Python 3.12.9）。**所有 python 一律用 `<harnessRoot>/.venv/Scripts/python.exe` 絕對路徑呼叫，不可相對路徑、不需 activate** |
| 已裝 | `faster-whisper`(1.2.1)、`PyAudioWPatch`、`edge-tts` |
| G1/G2 還要裝 | `opencc`（繁體轉換）、`webrtcvad` 或等價（分塊 VAD，可選）；G2：`torch`、`pyannote.audio` |
| 音源 | loopback 裝置名含 `[Loopback]`（如 `Speakers (Realtek) [Loopback]`）；mic 為預設輸入裝置。**勿寫死 index，每次以名稱/預設裝置動態解析**（不同機器 index 不同） |
| 模型快取 | `~/.cache/huggingface`（repo 外、共用） |
| **HF token（G2 必須）** | 老闆會於執行前設好 **環境變數 `HF_TOKEN`** 並同意 `pyannote/speaker-diarization-3.1` 條款。stt/diarize **從 `os.environ['HF_TOKEN']` 讀**，找不到就明確報錯中止 G2（不要硬猜、不要把 token 寫進任何檔） |

⚠️ **編碼鐵律**：所有 python 寫檔一律 `encoding='utf-8'`；若需 print 到 console，預期呼叫端帶 `PYTHONUTF8=1`（Windows console 是 cp950，印中文/`®` 會炸）。

---

## 3. 共用 STT 模組 `portal/render-service/stt.py`（先做這個）

單一職責：給一個音檔 → 回文字。會議、F4 portal 麥克風、F5 Telegram 語音都呼叫它。

```python
# 函式介面
transcribe_file(
    audio_path: str,
    lang: str = "auto",          # "auto" | "zh" | "en" | ...
    model_size: str = "small",   # tiny/base/small/medium/large-v3
    initial_prompt: str | None = None,  # 餵領域詞彙(人名/術語)提升準度
) -> dict
# 回傳:
# { "text": str,                      # 已做繁體轉換(若 zh)
#   "language": str, "duration": float,
#   "segments": [ {"start": float, "end": float, "text": str}, ... ] }
```

規則：
- 以 `WhisperModel(model_size, device="cpu", compute_type="int8")` 載入；**同 size 的 model 在模組內快取為 singleton**（避免每次重載 ~3-20s）。
- `lang="auto"` 時用 Whisper 偵測；F5/會議建議由呼叫端明確指定（中文會議給 `zh`、印度客戶給 `en`）。
- **繁體輸出**：偵測到 `zh` → 用 **OpenCC `s2twp`** 把簡體轉成台灣繁體後再回傳（Whisper 預設吐簡體）。非 zh 不轉。
- **CLI 介面**（給 node spawn）：`python stt.py <audio> --lang zh --model small [--prompt "..."]` → 把上述 dict 以 **JSON 印到 stdout**（單行）。錯誤走 stderr + 非 0 exit。

**驗證（自動、無需真人）**：用 edge-tts 合成一句 → 餵 `transcribe_file` → 斷言 text 內容相符。zh 要驗證輸出為**繁體**。（已驗證的 baseline：zh RTF≈0.37、en-IN small 近乎完美 RTF≈0.22。）

---

## 4. 資料模型與儲存位置

每場會議一個目錄：`<workspace>/.harness/runtime/meetings/<meetingId>/`（與 chat_history 同精神：檔案式、跨重啟不丟）。`meetingId = meeting_<timestamp>`。

| 檔 | 內容 |
|---|---|
| `meta.json` | `{ meetingId, title, source:'mic'\|'loopback'\|'both', model, lang, startedAt, finishedAt, status }` |
| `transcript.txt` | **即時 append** 的逐字稿，每行 `[HH:MM:SS] <text>`（防當機主檔） |
| `audio.wav` | 同步落的音訊（或 .opus）。供 §6 |
| `diarization.json` | pyannote 輸出：`[{start,end,speaker:'人員A'}...]`（G2 產） |
| `transcript.labeled.txt` | 帶語者標籤的逐字稿（G2 產，會後 remap 真名後覆寫） |

---

## 5. G1 — 核心錄製器 `portal/render-service/meeting_record.py`

長駐子行程，由 portal spawn / 停止。

**CLI**：`python meeting_record.py --dir <meetingDir> --source both --model small --lang zh [--chunk-seconds 20]`

**流程**：
1. **開音源**（PyAudioWPatch）：
   - `mic` → 預設輸入裝置；`loopback` → 動態找名稱含 `[Loopback]` 的裝置；`both` → 同時開兩個 stream（會議常態，對方+自己都要）。
2. **連續寫音訊**：所有收到的音框持續寫入 `audio.wav`（`wave` 模組），**邊收邊寫**（存證 + 供 diarization）。
3. **分塊轉錄**：累積約 `chunk-seconds`（預設 20s；若引入 VAD 則以靜音切點為界，避免切在字中間）→ 把該段音訊 → `import stt; stt.transcribe_file(...)`（**同行程 import，不要再 spawn**）。
4. **防當機 append**：每段轉完 → 以 `[HH:MM:SS] text\n` **append 到 `transcript.txt`，並 `f.flush(); os.fsync()`**。這是命脈，不可緩存於記憶體。
5. **停止**：收到停止訊號（見 §8）→ 轉完最後一段 buffer → 寫 `meta.finishedAt/status='done'` → 關 stream。
6. `both` 模式：兩路音訊可分別轉錄並標 `[mic]`/`[sys]` 前綴，或混音單路轉錄（**第一版：混音單路**，simpler；語者區分交給 G2 而非靠來源）。

**模型旋鈕**：中文/清晰 = small/medium；**印度/重口音 = medium 或 large-v3**。即時錄製預設 `small`（CPU 比即時快約 3x）；large-v3 留作「會後對 audio.wav 重轉」的高準度選項。

---

## 6. G2 — 語者分離 `portal/render-service/diarize.py`

**前提**：`os.environ['HF_TOKEN']` 必須存在（見 §2），否則明確報錯。需 `torch` + `pyannote.audio`。

**CLI（分離）**：`python diarize.py --dir <meetingDir> [--speakers N | --min-speakers a --max-speakers b]`
1. 對 `audio.wav` 跑 `pyannote/speaker-diarization-3.1` → 得語者時間段。
2. 與 `transcript.txt` 的時間戳對齊 → 每行掛上 `人員A/B/C…` → 寫 `transcript.labeled.txt` + `diarization.json`。
3. 簡單版：**會後一次跑**（文字優先；即時不標）。會議當下若當機只丟標籤、不丟文字（文字已即時存）。

> **§6.1 發言人數提示（diarization 準度關鍵）｜2026-06-25 實測踩雷 + 設計修正**
> 不給人數時 pyannote **自動猜群數，容易併太少**（實測 3 人會議→只分出 1~2 人、逐字稿幾乎全標人員A）。尤其線上會議是**單聲道混音**（對方全混成一條 mono，無空間資訊）、又常有主講者→更容易併群。
>
> **關鍵觀念：diarization 數的是「有發言的聲音」，不是「與會人頭」。** 全程沒講話的人不存在於音訊中，數不到。所以提示要餵「**發言人數**」（會開口的人），**不能餵「與會人數」**——給太大（如 5 人到場但只 3 人講）會把 3 個人硬拆成 5 群、把同一人切成多個「人員」，反而更糟。
>
> **設計修正（取代「開始錄音時填與會人數」）**：
> 1. **問的時機 = 會後「語者分離」那一步**，不是開始錄音時（開始錄時根本不知道誰會講；會後才知道實際發言者）。
> 2. **欄位語意 = 「發言人數（會講話的人；不含全程沒發言者）；不確定留空」**。留空 → 維持自動。
> 3. **可重跑**：填 3 不對可改 2/4 再跑，挑分得最好的；不確定可給範圍（min/max）。
> 4. **最後防線**：就算分錯，會後 remap/合併仍可手動把被拆開的同一人併回。
>
> **實作**：`pipeline(audio, num_speakers=N)`（確切）或 `min_speakers`/`max_speakers`（範圍）。`diarize.py` 已加 `--speakers` / `--min-speakers` / `--max-speakers`；UI **在語者分離步驟**收「發言人數」帶給它。無提示時自動。這是分離準度最大的槓桿。

**CLI（會後改名 remap）**：`python diarize.py remap --dir <meetingDir> --map "人員A=王經理,人員B=李工"`
→ 對 `transcript.labeled.txt` 做 find-replace，產出最終完整逐字稿。

---

## 7. G3 — 整合進 portal / Hana

**Server API（`portal/server.js`，比照現有 chat/schedule API 風格）**：

| 端點 | 用途 |
|---|---|
| `POST /api/meeting/start` | body `{source,model,lang,title,workspace}` → 建 meetingDir + spawn `meeting_record.py` → 回 `{meetingId}` |
| `POST /api/meeting/stop` | body `{meetingId}` → 對該子行程送停止訊號 → 回最終 meta |
| `GET /api/meeting/:id/transcript` | tail `transcript.txt`（前端輪詢即時顯示） |
| `POST /api/meeting/:id/diarize` | spawn `diarize.py`（需 HF_TOKEN）→ 回 labeled |
| `POST /api/meeting/:id/remap` | body `{map}` → spawn `diarize.py remap` |
| `GET /api/meetings?workspace=` | 列出歷史會議 |

- spawn 一律用 §8 的 venv 絕對路徑；錄製子行程登記在現有 `jobs` Map（比照 chat job，停止/reattach 一致）。

**UI（`portal/index.html`，新增 `#meeting-panel`，比照 `#schedule-panel` 版型）**：
- 側邊欄「🎙️ 會議」：開始（選 source/model/lang）、停止、會議歷史清單。
- 進行中：即時逐字稿（輪詢 transcript 端點）。
- 結束後：一鍵「語者分離」→ 顯示 人員A/B/C 各段 → 填真名表單 → remap → **Hana 摘要**。
- `#meeting-panel` 納入 §F3 的 `showPanel()` 互斥清單。

**Hana 自我感知**：會議結束 → 摘要 + 逐字稿連結寫進該 workspace 的 `chat_history`（一筆 session，`title=`會議：<會議標題>`）→ 之後可被 `/memory` 蒸餾、被 Hana 引用。

---

## 8. node ↔ python 介面（共用約定）

- **venv python 路徑解析**：server.js 取 `process.env.HARNESS_VENV`（若設）否則 `path.join(harnessRoot, '.venv', 'Scripts', 'python.exe')`。封成一個 helper `venvPython()` 供所有 spawn 共用。
- spawn 時帶 `env: { ...process.env, PYTHONUTF8: '1', HF_TOKEN: process.env.HF_TOKEN }`。
- **停止訊號**：Windows 無 POSIX signal，採「**控制檔輪詢**」：portal 在 meetingDir 寫 `STOP` 檔，`meeting_record.py` 每個 chunk 邊界檢查到 `STOP` 就收尾。（避免 `taskkill` 硬殺導致最後一段與 wav 尾巴損毀。）

---

## 9. 邊界與護欄

- **絕不**把 `HF_TOKEN` 或任何祕密寫進檔案、log、git、訊息。
- 音訊/逐字稿留在 workspace 的 `.harness/runtime/`（已被 gitignore 的 runtime 區），不外送。
- 錄製客戶會議涉及**錄音同意**法遵 → 屬 老闆判斷，程式不自作主張開錄（一律由使用者按開始）。
- venv 不可被 deploy：腳本在 `portal/render-service/`（會 deploy）但**用絕對路徑指向 dev 樹的 `_harness/.venv`**（venv 不在 portal/ 下，Deploy 只快照 portal/+docgraph/，故 venv 永遠留 dev 樹）。

---

## 10. 驗證（DoD）

- [ ] `stt.py`：edge-tts 合成 zh + en-IN → transcribe → 內容相符、**zh 輸出為繁體**（自動）。
- [ ] `meeting_record.py`：用 edge-tts 產一段語音→以**程式播放到預設輸出**同時開 loopback 錄 → `transcript.txt` 有內容、且過程中 kill 行程後檔案仍保有已轉內容（驗防當機）。（自動可做；真實多人會議 = 手動關）。
- [ ] `diarize.py`：對一段含兩語者的合成音檔跑 → `transcript.labeled.txt` 出現 ≥2 個 人員X。
- [ ] portal：start→即時看到逐字稿→stop→diarize→remap→Hana 摘要進 chat_history。
- [ ] 🧑‍✈️ **指揮官手動驗證**：在 Hana 上用真實會議實測（此關只由 老闆勾）。

---

## 11. 待拍板的開放問題（Hana 遇到先採預設、記錄下來，勿卡住）
1. 分塊：定時 20s（預設）vs VAD 靜音切點？→ 先定時，準度不足再加 VAD。
2. 音訊格式：`wav`（簡單、大）vs `opus`（小、需編碼）？→ 先 wav。
3. `both` 模式：混音單路（預設）vs 雙路標來源？→ 先混音。
4. 即時語者分離（線上）暫不做，僅會後批次。

---

## Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-25 | v0.1 | 老闆 + Claude | 初版。即時轉錄+防當機 append、mic/loopback/both 收音、共用 stt.py（OpenCC 繁體）、pyannote 語者分離+會後 remap、portal 會議面板、node↔python venv 絕對路徑與 STOP 檔停止協定。決策：F4/F5 共用 server Whisper；G2 含 diarization（HF_TOKEN 由 老闆於執行前設環境變數）。 |
