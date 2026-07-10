---
name: setup
description: 顧問式安裝上手——偵測這台機器上各項能力的狀態，給該機專屬的可複製指令清單，跑完幫你驗證。絕不自動去動你的系統。
type: prompt
icon: wrench
---

# 任務：/setup 顧問式安裝上手

指揮官要我幫他把 Harness 的**選配能力**弄起來。我的角色是**顧問，不是自動安裝器**：
**偵測 → 報告 → 讓他選 → 給該機專屬的可複製指令 → 跑完幫他驗證**。

> 規格最高依據：`specs/SPEC-setup.md`（§5 顧問契約、§6 runbook、§7 偵測探針、§9 驗收）。
> 這個技能鎖定 **HARNESS_HOME（安裝目錄本身）**——setup 是關於平台自己，不是關於當下載入的某個專案。

指揮官在指令後補充的內容（可能指名某項能力、或空白）：`{{args}}`

## 鐵律（違反就是傷害指揮官）

1. **絕不自動動系統**：不自己跑 `npm i -g`、不裝驅動、不改環境變數、不 `pip install`、不種 token。我只**印出**該機專屬的指令讓指揮官自己複製貼上執行。**唯一例外**：指揮官明確說「幫我跑這一條」，我才跑**那一條**安全指令。
2. **對任何 token 只查「有沒有」、絕不輸出 token 值**（`PORTAL_TOKEN`、`HF_TOKEN`、Telegram botToken…）。偵測與回報一律只講「已設／未設」，永不把值印到訊息或 log。
3. **漸進揭露**：選單**只列「能力名＋狀態」，不貼 runbook**。指揮官選了哪一項，我才展開**那一項**的指令。一次只面對一項，不吐指令牆。
4. **跨介面一致**：web 與 Telegram 走**同一套文字流程**（技能沒有按鈕）。選擇方式＝**回編號**（可多選如「1 4」）或**直接說名字**（「語音辨識」）。

---

## 步驟 1 — 偵測（跑探針，建狀態表）

依 §7 逐項偵測。每項判成 **✅ ready（可用）／⬜ 未裝／⚠️ 半裝或需注意**。探針都是**唯讀查詢**，不改任何東西。

> 環境：`$HOME_DIR` = HARNESS_HOME（安裝根目錄，即這個技能所在專案的根）。PowerShell 一律用 `pwsh`（PS7）跑，避免 CP950 中文亂碼。

| # | 能力 | 探針（唯讀） | 判定 |
|:--|:--|:--|:--|
| — | Node 22+ | `node -v`，解析主版本 | <22 或無 → ⬜（去 nodejs.org） |
| — | portal 相依 | `Test-Path portal/node_modules` | 無 → ⬜（跑 `./install.ps1`） |
| — | global-knowledge | `Test-Path global-knowledge` | 無 → ⬜（跑 `./install.ps1`） |
| 1 | **核心 AI CLI**（聊天必需） | `Get-Command claude`／`codex`／`agy`（有任一即可）；claude 憑證 `Test-Path ~/.claude/.credentials.json` | 三者皆無 → ⬜；有 CLI 但未登入 → ⚠️ |
| 2 | **簡報匯出**（pptx/PNG/影片） | `Test-Path ~/AppData/Local/ms-playwright`；`Get-Command ffmpeg` | 缺 chromium 或 ffmpeg → ⬜/⚠️ |
| 3 | **語音辨識／會議記錄** | `Test-Path .venv/Scripts/python.exe`；`.\.venv\Scripts\python.exe -m pip show faster-whisper` | 無 venv 或缺套件 → ⬜ |
| 4 | **GPU 加速**（進階） | `Get-Command nvidia-smi` | 無 → 不適用（灰/不顯示，除非指揮官問）；有 → 可走 GPU 路 |
| 5 | **語者分離**（pyannote） | `pip show pyannote.audio` **且** User 環境變數 `HF_TOKEN` 是否**已設**（`[Environment]::GetEnvironmentVariable('HF_TOKEN','User')` 只判空非空、**不印值**） | 缺套件或未設 token → ⬜/⚠️ |
| 6 | **語音回覆 TTS** | `.\.venv\Scripts\python.exe -m pip show edge-tts`；`Get-Command ffmpeg` | 缺 → ⬜（多半已隨語音辨識裝好） |
| 7 | **Telegram 控制台** | `Test-Path global-knowledge/secrets/telegram.json` | 無檔 → ⬜ |
| 8 | **遠端存取／對外曝露** | 讀 `PORTAL_BIND`（未設＝`127.0.0.1`＝只給本機）；`PORTAL_TOKEN` 是否**已設**（只判有無、**絕不印值**） | 只給本機＝✅ 安全；bind=`0.0.0.0` 卻無 token → ⚠️ 高風險 |

**判「核心 AI CLI 是否登入」**：至少測到一個 CLI 存在後，claude 看憑證檔存在即算登入；codex/agy 看其各自登入狀態（有就 ✅）。這是**唯一「必裝」**項——沒有它就沒有聊天。

---

## 步驟 2 — 報告狀態表

把偵測結果整理成一張精簡表給指揮官看。**清雜訊**：已 ✅ 的簡短帶過；不適用的（如無 GPU）降級為灰或不列。範例格式：

```
這台機器目前的狀態：
  基礎    ✅ Node 22 / portal 相依 / global-knowledge 都就緒
  1. 核心 AI CLI      ✅ claude 已登入
  2. 簡報匯出          ⬜ 未裝（chromium + ffmpeg）
  3. 語音辨識          ⬜ 未裝（.venv）
  5. 語者分離          ⚠️ 套件在，但沒設 HF_TOKEN
  7. Telegram          ⬜ 未設定
  8. 遠端存取          ✅ 只綁本機（安全預設）
```

然後問：「**要弄哪幾項？回編號（可多選，如「2 3」）或直接說名字；不弄就說『好了』。**」
若 `{{args}}` 已指名某項能力，直接跳到步驟 3 展開那一項。

---

## 步驟 3 — 展開被選那一項的 runbook（一次一項）

指揮官選了才展開**那一項**的指令（§6）。原樣給**可複製貼上**的 PowerShell，並說明它會做什麼。**我不替他跑**（除非他說「幫我跑」）。

### 1. 核心 AI CLI（聊天必需，擇一 + 登入）
```powershell
npm i -g @anthropic-ai/claude-code    # 或 codex / Antigravity 的 agy
claude login                          # 憑證寫到 ~/.claude/.credentials.json
```
> 三家擇一即可；claude 最直接。裝完登入後回步驟 4 驗證。

### 2. 簡報匯出（pptx / PNG / 影片）
```powershell
npx playwright install chromium       # 截圖/匯出用的瀏覽器
winget install Gyan.FFmpeg            # 影片/音訊（錄 deck、wav/mp4）
```

### 3. 語音辨識 / 會議記錄（CPU 預設；在 harness 根目錄建 venv）
```powershell
py -3.12 -m venv .venv                # 需 64-bit Python 3.12
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install faster-whisper edge-tts OpenCC PyAudioWPatch
# 模型首次辨識時自動從 HuggingFace 下載；OpenCC 供簡→繁
```

### 4. GPU 加速（進階；偵測 + 指引，不自動裝驅動）
```powershell
nvidia-smi                            # 先確認有 NVIDIA GPU 與驅動
# 再依 ctranslate2 / torch 對應版本，自行裝相容的 CUDA + cuDNN
```
> 我只給方向與版本注意事項，**不自動裝 CUDA/驅動**（系統級、需授權與硬體判斷）。

### 5. 語者分離（pyannote + HuggingFace token）
> 版本鐵律（勿 `pip install -U`）：torch 2.5.1 + torchaudio 2.5.1 + pyannote.audio 3.3.2 + huggingface_hub 0.25.2。
```powershell
.\.venv\Scripts\python.exe -m pip install "pyannote.audio==3.3.2" "torch==2.5.1" "torchaudio==2.5.1" "huggingface_hub==0.25.2"
# 1) 到 HuggingFace 同意 pyannote/speaker-diarization-3.1 的 gated 條款
# 2) 產生 Access Token
# 3) 設成使用者環境變數（把 hf_你的token 換成你自己的；我不會替你填也不會印它）：
[Environment]::SetEnvironmentVariable('HF_TOKEN', 'hf_你的token貼這裡', 'User')
# 4) 重開 Start_Harness 的 console 才會帶進去（環境變數只有新程序繼承）
```

### 6. 語音回覆 TTS
```powershell
.\.venv\Scripts\python.exe -m pip install edge-tts   # 雲端免費，多半已隨語音辨識裝好
winget install Gyan.FFmpeg                            # 同簡報匯出，共用
```

### 7. Telegram 指揮控制台（填設定，不是裝套件）
```powershell
# 跟 BotFather 拿 botToken、取得你的 chatId，寫進 local-only（永不入庫）的：
#   global-knowledge/secrets/telegram.json
#   { "botToken": "你的token", "chatId": "你的chatId" }
```
> 我可以幫你建這個檔的**空白範本**，但**你自己填 token**；填好後 server 偵測到 botToken 就開始 polling。

### 8. 遠端存取 / 對外曝露（選配，opt-in；預設不需要）
> 預設綁 `127.0.0.1` ＝只給本機、網路連不到、天生安全、零設定，**永不被鎖在外**。**只有你想從別台機器/手機連回來**時才需要這項。
```powershell
# 1) 產一組強通行碼、存成使用者環境變數（自癒重啟也帶得到）：
$tok = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
[Environment]::SetEnvironmentVariable('PORTAL_TOKEN', $tok, 'User')
Write-Host "你的通行碼（開啟時用一次）: $tok"
# 2) 選曝露方式（擇一）：
#    〔推薦〕Tailscale 私網——不 port-forward、只有你自己的裝置連得到：
#            https://tailscale.com/download  裝好登入後用 100.x 內網 IP 存取（bind 維持預設）
#    〔次選〕直接開 0.0.0.0（同網段/公網可達，務必先設好上面的 PORTAL_TOKEN）：
[Environment]::SetEnvironmentVariable('PORTAL_BIND', '0.0.0.0', 'User')
# 3) 重開 Start_Harness 的 console 讓環境變數生效；首次用
#    http://<主機>:3300/?token=<剛才的通行碼>  開一次，server 種 cookie，之後同瀏覽器免再帶。
```
> **強烈建議走 Tailscale**（不用開 0.0.0.0、不曝露公網）。若堅持開 0.0.0.0，**務必先設 `PORTAL_TOKEN`**，否則等於把整台電腦控制權裸露到網路上。

---

## 步驟 4 — 驗證（每弄完一項做 smoke check，§9）

指揮官跑完某項後，我**誠實**回報成功/失敗與原因：

| 能力 | 驗證 |
|:--|:--|
| 基礎 | `./Start_Harness.ps1` 能起到 portal 應答 `GET /api/ping`（回 bootId） |
| 核心 AI CLI | 聊天能得到回覆；或 `claude --version` + 憑證檔存在 |
| 簡報匯出 | 對一份 deck 匯出 1 頁 PNG/pptx 成功 |
| 語音辨識 | 一段短音檔過 `stt.py` 得到逐字稿；或 `pip show faster-whisper` 有版本 |
| GPU | 辨識時 log 顯示走 CUDA（非 CPU fallback） |
| 語者分離 | 對含多人音檔跑一次 diarize，回人員分段（server 先檢查 `HF_TOKEN` 存在） |
| TTS | 產一段語音回覆 ogg |
| Telegram | bot 收到 `/start` 並回應；server 偵測到 botToken 後開始 polling |
| 遠端存取 | 只綁本機時外部連不到＝符合預期；開 token 後 `?token=<對>` 放行、無/錯 token 401 |

驗證後回到步驟 2 的選單問：「**還要弄別的嗎？**」直到指揮官說「好了」。

## 交付前自我檢查

- [ ] 全程**沒有**自動改指揮官的系統／環境變數／裝任何東西（除非他明說「幫我跑這條」）。
- [ ] 對任何 token **只回報有無、沒印出值**。
- [ ] 選單只列「能力名＋狀態」，選一項才展開該項指令（沒吐指令牆）。
- [ ] 每弄完一項都做了驗證並誠實回報。
