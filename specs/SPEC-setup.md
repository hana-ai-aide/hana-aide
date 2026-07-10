# SPEC — Setup / Onboarding（一鍵基礎安裝 + 顧問式選配安裝）

> Status: DRAFT v0.3 for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：**新增** `install.ps1`、`global-knowledge/commands/setup.md`；**小改** `Start_Harness.ps1`（開機前檢查）、`README.md`（Install 段）、`server.js`（**只**加「存取安全預設」§12：預設綁 `127.0.0.1`＋選配 `PORTAL_TOKEN` gate＋對外無 token 開機警告，**全部預設關、向後相容**，不碰既有請求邏輯）。**不動** `index.html`。
> 目的：補上一個本來就缺的環節。Harness 至今**從未為「全新 clone」打包過**——它一直跑在開發機上（`node_modules` / `.venv` / `global-knowledge` 都是手動弄好的）。要做開源／內部分享，必須讓「clone → 跑起來」對全新機器成立。

---

## 1. 背景：現況沒有任何 install（這是要補的洞）

盤點結果（2026-06）：

- 頂層 `.ps1` 只有 `Deploy / Restart / Rollback / Start / Stop` + release-lib —— **全是執行期/版本用途，沒有一個負責裝相依套件**。
- 沒有 `install.ps1` / `setup.ps1` / bootstrap；`package.json` 沒有 `postinstall`；README 沒有安裝步驟。
- `.gitignore` 排除了 `node_modules/`、`.venv/`、`global-knowledge/`、`.releases/` —— **全新 clone 拿不到這些**。

所以 README 寫「clone → 跑 `Start_Harness.ps1`」對新機器**不成立**：第一次跑就會因缺 `node_modules`（`node-pty` 等）而開不起來。

---

## 2. 架構：兩層 + 一個開機前檢查（這是一切的根）

```
clone 專案
  │
  ├─【Layer A】./install.ps1     ← 自動化、確定性、可重複跑的「基礎安裝」
  │      • 檢查 Node 22+
  │      • portal/ 底下 npm install
  │      • 建出 global-knowledge/ 骨架目錄（伺服器開機要讀）
  │      • 印出狀態摘要 → 指向 /setup
  │
  ├─ ./Start_Harness.ps1         ← 加「開機前檢查」：缺 node_modules / global-knowledge
  │                                 → 明確提示「先跑 ./install.ps1」並優雅退出（不半殘啟動）；
  │                                 否則照舊當監督者
  │
  └─ 在 Hana 裡：/setup          ←【Layer B】顧問式技能（advisory）
         偵測現況 → ✅/⬜/⚠️ 狀態表 → 每項給「可複製貼上的指令清單」
         → 你自己跑 → 它幫你驗證。**不自動去動系統**。
```

**為什麼 install 不併進 `Start_Harness.ps1`**：那是監督者 forever-loop，每次自癒重啟都會重跑它。`npm install` 不該被塞進 relaunch 迴圈。`install`（一次性、可能要網路/權限）與 `run`（反覆執行）責任分離。

**為什麼 `/setup` 是顧問、不是自動安裝器**：選配項目（CUDA、驅動、build tools、第三方 token）需要判斷、硬體偵測與授權，無法盲目腳本化；而且一個會自動去動陌生人系統的技能，正是開源時**不該**散出去的東西。Advisory = 偵測 + 給該機器專屬的指令清單 + 驗證。

---

## 3. Layer A：`install.ps1`（自動化基礎安裝）

確定性、**冪等（可重複跑不出錯）**、符合 **PowerShell 5.1 語法**（禁用 `??` `?.` `?:` `&&` `||`）。

| 步驟 | 動作 | 失敗時 |
|:--|:--|:--|
| 1 | 檢查 `node -v` ≥ 22（伺服器用 `node:sqlite` 實驗特性） | 印連結 https://nodejs.org，中止 |
| 2 | 在 `portal/` 執行 `npm install` | `node-pty` 是原生編譯：通常有預編譯二進位直接成功；失敗 → **明確告知需要 VS Build Tools**，不假裝沒事 |
| 3 | 建 `global-knowledge/` 骨架空目錄：`secrets/`、`telegram/`、`commands/`、`knowledge/`（伺服器現有程式碼會去讀這些路徑） | — |
| 4 | 印「基礎完成」摘要 + 下一步：`./Start_Harness.ps1`，選配請進 Hana 用 `/setup` | — |

> **不做的事**：不裝 `.venv`（多 GB、CUDA 分支）、不裝 playwright 瀏覽器、不寫 global-knowledge 的「內容」（記憶/政策的預設內容**這版先擱置**，只建空目錄讓伺服器開得起來）。這些都歸 `/setup`。

---

## 4. `Start_Harness.ps1` 的開機前檢查（小改）

在現有 `node -v` 檢查之後、bootstrap release 之前，加一段：

```
若 portal/node_modules 不存在 或 global-knowledge/ 不存在：
    印「偵測到尚未完成基礎安裝，請先執行： ./install.ps1」
    優雅退出（不要半殘啟動，避免伺服器讀不到相依而崩在監督者迴圈裡）
```

讓「直接跑 Start_Harness」大致仍成立，只是在跑不動時給出**明確的下一步**，而不是一個看不懂的錯誤。

---

## 5. Layer B：`/setup` 技能（顧問契約）

**位置**：`global-knowledge/commands/setup.md`（出貨層技能，tracked → clone 的人一開始就有；與 deck / doc-flowchart 等現有技能**同目錄**）。
**動作範圍**：鎖定 `HARNESS_HOME`（安裝目錄本身）—— setup 是關於平台自己，不是關於當下載入的某個專案；在只載入專案時自然是個說明/no-op。
**部署註記**：出貨層技能是從**正在跑的 release 快照**讀的，所以**已在跑舊 release 的本機要看到 `/setup` 需 deploy 一次**（純帶入新技能檔，無 server 行為改動）；可搭既有待部署清單一起出。全新 clone 無此問題。

**契約（advisory）**：
1. **偵測** —— 跑第 7 節的探針，建出每項能力的 ✅ ready / ⬜ 未裝 / ⚠️ 半裝 狀態表。
2. **報告** —— 把狀態表給指揮官看。
3. **選擇** —— 用互動式選單問「要處理哪幾項」（不替他決定、不亂猜）。
4. **給清單** —— 對選的每一項，輸出**可複製貼上的指令**（見第 6 節 runbook），指揮官自己跑。
5. **驗證** —— 跑完後做 smoke check（第 9 節），誠實回報成功/失敗與原因。

`/setup` **不**自動執行安裝、**不**自動改系統環境變數、**不**自動裝驅動。除非指揮官明確說「幫我跑這條」，Hana 才跑那條安全指令。

### 5.1 互動模型：對話式 + 漸進揭露（指揮官裁示）

`/setup` 是**技能（skill），不是 builtin**。對照 `/use`：`/use` 是寫死在 `telegram.js` 的 builtin，能組 Telegram `inline_keyboard` 出可點選按鈕；技能的輸出**只是一則聊天訊息，無法生出按鈕**。因此 `/setup` 一律用**對話**表達，且**跨介面一致**（web 與 Telegram 同一套文字流程）。

避免「一執行就吐一面指令牆」靠兩招：

1. **偵測優先、清掉雜訊**：已完成的標 ✅；不適用的（如無 GPU）不顯示或降級為灰。實際要選的清單通常遠短於「全部能力」。
2. **漸進揭露**：選單**只列「能力名 + 狀態」，不貼 runbook**；指揮官選了哪一項，才展開**那一項**的指令。一次只面對一項。

**選擇方式**：回編號（可多選，如「1 4」）或直接說名字（「語音辨識」）—— 純文字，不依賴按鈕。每弄完一項做驗證（§9），再問「還要弄別的嗎？」回到選單。

> 取捨：此法零程式改動、advisory、跨介面一致；代價是 Telegram 上以「打字回編號」取代「點按鈕」。若日後要 Telegram 點選手感，需把上層選單做成 builtin（程式 + callback 維護，且 web 仍無按鈕）—— **不在本版**。

---

## 6. 能力項目與 runbook（顧問清單）

### 6.0 基礎健檢（先報告，不是安裝）
| 項目 | 偵測 | 缺了怎麼辦 |
|:--|:--|:--|
| Node 22+ | `node -v` | 去 nodejs.org |
| `portal/node_modules` | 路徑存在？ | 跑 `./install.ps1` |
| `global-knowledge/` 骨架 | 路徑存在？ | 跑 `./install.ps1` |

### 6.1 核心：讓 Hana 能對話（必裝，否則沒有聊天）
聊天靠外部 AI CLI（`server.js` 支援 **claude / codex / agy**）。至少要有一個且完成登入。

| 需要 | runbook（範例） |
|:--|:--|
| 安裝一個 CLI | claude：`npm i -g @anthropic-ai/claude-code`（或 codex / Antigravity `agy`） |
| 登入授權 | `claude login`（憑證寫到 `~/.claude/.credentials.json`，`server.js:3570` 會檢查） |

### 6.2 選配能力
> 依賴關係：**語者分離 / GPU 加速** 建立在「語音辨識」之上（先有 `.venv`）；**語音回覆錄製 / 簡報影片** 都需要 `ffmpeg`（共用偵測）。

**A. 簡報匯出（pptx / PNG / 影片）**
```powershell
npx playwright install chromium      # 截圖/匯出用的瀏覽器
winget install Gyan.FFmpeg           # 影片/音訊（錄製 deck、wav/mp4）
```

**B. 語音辨識 / 會議記錄（CPU 預設）**
```powershell
py -3.12 -m venv .venv               # 在 harness 根目錄建 venv（64-bit py3.12）
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install faster-whisper edge-tts OpenCC PyAudioWPatch
# 模型於首次辨識時自動從 HuggingFace 下載；OpenCC 供簡→繁
```

**C. GPU 加速（進階，偵測 + 指引為主，不自動裝驅動）**
```powershell
nvidia-smi                           # 先確認有 NVIDIA GPU 與驅動
# 接著依 ctranslate2 / torch 對應版本，自行安裝相容的 CUDA + cuDNN（連結由 /setup 提供）
```

**D. 語者分離（pyannote + HuggingFace token）**
```powershell
.\.venv\Scripts\python.exe -m pip install "pyannote.audio" torch
# 1) 到 HuggingFace 同意 pyannote/speaker-diarization-3.1 的 gated 條款
# 2) 產生 Access Token
# 3) 設成「使用者環境變數」（把 hf_你的token 換成你自己的）：
[Environment]::SetEnvironmentVariable('HF_TOKEN', 'hf_你的token貼這裡', 'User')
# 4) 重開 Start_Harness 的 console 才會帶進去（環境變數只有新程序繼承）
```

**E. 語音回覆 TTS**
```powershell
.\.venv\Scripts\python.exe -m pip install edge-tts   # 雲端免費，已含在 B
winget install Gyan.FFmpeg                            # 同 A，共用
```

**F. Telegram 指揮控制台（填設定，不是裝套件）**
```powershell
# 跟 BotFather 拿 botToken，並取得你的 chatId，寫進 secrets 檔（local-only、永不入庫）：
# global-knowledge/secrets/telegram.json
# { "botToken": "你的token", "chatId": "你的chatId" }
```

**G. 遠端存取 / 對外曝露（選配，opt-in；預設不需要）**
> 預設綁 `127.0.0.1`＝只給本機、網路連不到、天生安全、零設定。**只有你想從別台機器/手機連回來時**才需要這項。偵測目前 bind 與 `PORTAL_TOKEN` 是否已設（**只查有無，絕不印出 token 值**）。
```powershell
# 1) 產一組強通行碼並存成「使用者環境變數」（自癒重啟也帶得到）
$tok = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
[Environment]::SetEnvironmentVariable('PORTAL_TOKEN', $tok, 'User')
Write-Host "你的通行碼（開啟時用一次）: $tok"
# 2) 選曝露方式（擇一）：
#    〔推薦〕Tailscale 私網 —— 不 port-forward、只有你自己的裝置連得到：
#            https://tailscale.com/download  裝好登入後，用 100.x 內網 IP 存取即可（bind 維持預設）
#    〔次選〕直接開 0.0.0.0（同網段/公網可達，務必先設好上面的 PORTAL_TOKEN）：
[Environment]::SetEnvironmentVariable('PORTAL_BIND', '0.0.0.0', 'User')
# 3) 重開 Start_Harness 的 console 讓環境變數生效；首次用  http://<主機>:3300/?token=<剛才的通行碼>  開一次，
#    server 會種 cookie，之後同瀏覽器免再帶 token。
```

---

## 7. 偵測探針（`/setup` 用來判斷狀態）

> **可靠性鐵律（v0.3 補）**：探針必須是**強制執行的確定性指令**，技能要求模型**實際跑**下表命令並依真實輸出判定，**不得由模型自行猜測狀態**。實測同一台機器：Claude／Codex 真的執行探針 → 全部正確；Gemini Flash 未確實執行、憑範例文字腦補 → 誤報多項「未裝」。→ `setup.md` 須明列「先跑指令、再讀輸出」，並在偵測不到時誠實標「未知」而非猜「未裝」。

| 能力 | 探針 |
|:--|:--|
| Node | `node -v`（解析主版本 ≥ 22） |
| npm 套件 | `Test-Path portal/node_modules` |
| global-knowledge | `Test-Path global-knowledge` |
| AI CLI | `Get-Command claude/codex/agy`；claude 憑證 `Test-Path ~/.claude/.credentials.json` |
| playwright 瀏覽器 | `Test-Path ~/AppData/Local/ms-playwright` |
| ffmpeg | `Get-Command ffmpeg` |
| venv | `Test-Path .venv/Scripts/python.exe`；關鍵套件 `pip show faster-whisper` |
| GPU | `Get-Command nvidia-smi`（有才視為可走 GPU 路） |
| 語者分離 | `pip show pyannote.audio` **且** User 環境變數 `HF_TOKEN` 已設（只查有無，**絕不印出值**） |
| Telegram | `Test-Path global-knowledge/secrets/telegram.json` |
| 綁定介面 | 讀 `PORTAL_BIND`（未設＝`127.0.0.1` 安全預設）；報告目前「只給本機」或「已對外」 |
| 存取通行碼 | User 環境變數 `PORTAL_TOKEN` 是否已設（**只查有無、回報存在性，絕不輸出值**）；若 bind＝`0.0.0.0` 卻未設 → ⚠️ 高風險 |

---

## 8. Secret 引導原則（依現況，不改程式）

兩類 secret 的「家」不同，`/setup` 照現況引導即可：

| Secret | 現況的家 | `/setup` 引導方式 |
|:--|:--|:--|
| Telegram token | 有檔：`global-knowledge/secrets/telegram.json` | 給 JSON 範本，自己填、自己存檔 |
| **HF token** | **沒有檔——只認環境變數 `HF_TOKEN`**（`diarize.py` 鐵律：只從 `os.environ` 讀，絕不寫進任何檔/log） | 給一行 `[Environment]::SetEnvironmentVariable(...)`，**自己換掉 API key 後執行**，再重開 console |

**設計取捨（指揮官裁示）**：HF token **不另做設定檔**。理由——語者分離本就是進階功能：連 API key 怎麼申請都不會的人，本來就無法啟用；而會申請 token 的人，自己存檔、執行一行 `env` 指令並不構成障礙。所以 `/setup` 只負責**把確切的 ps1 指令打出來**讓他複製改用，**不為此改 `diarize.py` / `server.js`**。

**鐵律**：`/setup` 在偵測與報告時，對任何 token **只查「有沒有設」、回報長度或存在性，永不輸出 token 值**到訊息或 log。

---

## 9. 驗收（每項裝完的 smoke check）

| 能力 | 驗證 |
|:--|:--|
| 基礎 | `Start_Harness.ps1` 能起到 portal 應答 `/api/ping` |
| AI CLI | portal 聊天能得到回覆（或 `claude --version` + 憑證存在） |
| 簡報匯出 | 對一份 deck 匯出 1 頁 PNG / pptx 成功 |
| 語音辨識 | 跑一段短音檔過 `stt.py`，得到逐字稿 |
| GPU | 辨識時 log 顯示走 CUDA（非 CPU fallback） |
| 語者分離 | 對含多人音檔送一次 `/api/meeting/:id/diarize`，回傳人員分段（`server.js:2619` 先檢查 `HF_TOKEN`） |
| TTS | Hana 產生一段語音回覆 ogg |
| Telegram | bot 收到 `/start` 並回應；`server.js` 偵測到 `botToken` 後開始 polling |

---

## 10. 非目標（Out of Scope）

- **應用程式改動極小**：`index.html` 不動；`server.js` **只**加 §12「存取安全預設」（預設綁 `127.0.0.1`＋選配 `PORTAL_TOKEN` gate＋對外無 token 開機警告，全部預設關/向後相容，不碰既有請求邏輯）。其餘只新增腳本/技能/文件 + `Start_Harness.ps1` 一段檢查。
- **不自動裝系統級相依**：CUDA / cuDNN / NVIDIA 驅動 / VS Build Tools 一律偵測 + 指引 + 驗證，不自動安裝。
- **HF token 不做設定檔**（見第 8 節裁示）。
- **不寫 global-knowledge 的內容**：這版只建空骨架目錄；「預設記憶/政策內容」之另案再議。
- **未來（不在本版）**：`requirements-*.txt` 以利重現、Ollama 本地嵌入 / GraphRAG（README Phase 2）、把 `/setup` 從顧問升級成可選的自動安裝模式。

---

## 11. 影響檔案與部署

| 檔案 | 動作 | 需部署？ |
|:--|:--|:--|
| `specs/SPEC-setup.md` | 新增（本檔） | 否（純文件） |
| `install.ps1` | 新增 | 否（從 dev tree 直接跑） |
| `Start_Harness.ps1` | 小改（開機前檢查） | 否（改完下次執行生效） |
| `README.md` | 改（Install 段：clone → install → setup） | 否 |
| `global-knowledge/commands/setup.md` | 新增 | **是，一次**（出貨層技能從 release 快照讀；可搭既有待部署清單一起出。全新 clone 無此問題） |
| `server.js` | 小改（§12 存取安全預設：預設綁 127.0.0.1＋選配 token gate＋開機警告＋收 CORS） | **是**（server 行為改動，需部署一次；未設 `PORTAL_TOKEN` 者行為不變） |

---

## 12. 存取安全預設（Security-by-default）｜v0.3 新增

> 動機：Hana 能讀寫整台電腦、spawn CLI、跑 agent＝**等同給連上的人一個 shell**。現況 `server.js` 綁 `0.0.0.0`＋**零認證**（grep 全檔無任何 login/token）＝任何連得到 port 的人現在就有本機完整控制權。開源必須「安全的預設剛好也是零設定的預設」，且**首次安裝不設 token 也不能被鎖在外**。解法：預設只綁本機，token 只在對外曝露時才需要。

### 12.1 核心原則
| 情境 | 綁定 | 需要 PORTAL_TOKEN | 結果 |
|:--|:--|:--|:--|
| 開源新手（預設） | `127.0.0.1` | 否 | 只給本機、網路連不到、天生安全、零設定；**永不被鎖在外** |
| 想遠端（手機/外地） | Tailscale / `0.0.0.0` | 是（opt-in） | 這時才設 token；runbook 見 §6.2-G |

### 12.2 server.js 改動（最小、預設關、向後相容）
1. **預設綁本機**：`server.listen(PORT, BIND)`，`BIND = process.env.PORTAL_BIND || '127.0.0.1'`（原本硬寫 `'0.0.0.0'`）。想對外者自行設 `PORTAL_BIND=0.0.0.0`。
2. **選配 token gate**：`PORTAL_TOKEN` 未設/空 → gate 完全關閉（與現狀 100% 相同）。設了才啟用：
   - 在請求入口（`http.createServer` handler 最前、pathname 解析後）呼叫 `passAuth(req,res,parsedUrl,pathname)`，回 false 時已寫好 401/403，呼叫端 `return`。
   - token 來源三選一：`?token=`（登入用）、cookie `portal_token`、header `X-Portal-Token`；比對用 `crypto.timingSafeEqual`（先比長度避免 throw）。
   - `?token=` 命中 → `Set-Cookie: portal_token=…; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`（之後同瀏覽器免再帶；cookie 涵蓋圖片/iframe/下載/導頁，**前端零改動**）。
   - **Host 白名單**：只認 `localhost`/`127.0.0.1`/`::1`（+ 選配 `PORTAL_ALLOWED_HOSTS`）→ 擋 DNS-rebinding。
   - **豁免** `/api/ping`（啟動器健康檢查/前端輪詢用，只回 bootId、無敏感資料）。
3. **對外無 token 開機警告**：若 `BIND==='0.0.0.0'` 且 `!PORTAL_TOKEN` → console 印醒目紅字：「⚠ 你正把完整電腦控制權暴露到網路上，且未設 PORTAL_TOKEN。請設 PORTAL_TOKEN 或改用 Tailscale／PORTAL_BIND=127.0.0.1。」（只警告、不阻擋，尊重使用者選擇）。
4. **收 CORS**：`Access-Control-Allow-Origin` 由 `'*'` 收成同源（`http://localhost:<PORT>`），`Allow-Headers` 補 `X-Portal-Token`。

### 12.3 前端
**零改動**：cookie 隨同源請求自動帶（含 `<img>`/iframe/下載/導頁）。可選加固（本版不做）：在既有全域 fetch 攔截器（`index.html:2613`）一併帶 `X-Portal-Token`。

### 12.4 驗收（smoke check）
| 情境 | 期望 |
|:--|:--|
| 未設 PORTAL_TOKEN | 行為與現狀完全相同（gate off）；預設只綁 `127.0.0.1` |
| 設了 token、無憑證打 `/api/*` | 401 |
| `?token=<對>` 開頁 | 種 cookie、放行；之後同瀏覽器免帶 token |
| `?token=<錯>` | 401 |
| 非 localhost 的 Host header | 403 Forbidden host |
| `/api/ping` | 永遠放行 |
| bind=0.0.0.0 且無 token | 開機印紅字警告，但仍啟動 |

---

## 13. 維護鐵律：/setup 完整性（Setup Completeness Invariant）｜v0.4 新增

> `/setup` = 「所有**非基本可運行**、需人手動安裝或註冊的東西」的**單一權威清單**。核心（Node + 一個 CLI）之外，凡額外擴充依賴，都要能在此被偵測與指引。

### 13.1 新依賴必須同步登記進 /setup（DoD 條款）
任何新功能只要引入**需人手動安裝/註冊的依賴**——外部執行檔（`ffmpeg`、`playwright`/chromium…）、系統/Python 套件、或需註冊取得 token 的帳號（HuggingFace `HF_TOKEN`、Telegram botToken…）——**必須在同一次變更內**把它補進 `/setup`：
1. **偵測探針**（§7）：判斷「已裝/未裝」的指令（`Get-Command ffmpeg`、`pip show <pkg>`、env 有無…）；對 token 只判有無、**絕不印值**。
2. **runbook**（§6）：該機可複製貼上的安裝指令。
3. **能力清單**：在 `/setup` 狀態表新增一列。

**未登記＝該功能未完工（DoD 未達）。** 此條對 Hana 自我修改與人工開發一體適用。

### 13.2 選配依賴的 UI 必須優雅降級
`/setup`（及 Hana 本人）能在對話中「偵測→提示」，但**一顆按鈕不會自己提示**。凡依賴選配安裝的**按鈕/端點**：
- 執行前**先偵測依賴**，缺失時回**明確、可行動、且指向 `/setup`** 的訊息（例：「匯出影片需要 ffmpeg，請在 Hana 執行 `/setup` 取得安裝指令」），不得丟原始錯誤/500。
- 前端以 toast/提示呈現；理想上已知缺依賴時，按鈕加註「需額外安裝」或停用。
- **現況參考**：`POST /api/presentations/:name/record` 已先查 `ffmpegAvailable()` 回明確訊息（`server.js:1970`）——把這類訊息**統一改成指向 `/setup`**，並套用到其他選配依賴功能。

---

## Changelog
| Date | Version | Author | Description |
|:--|:--|:--|:--|
| 2026-06-29 | v0.1 | 老闆 + Hana | 初版 DRAFT。兩層架構（install.ps1 自動化基礎 + /setup 顧問式選配）+ Start_Harness 開機前檢查。能力項目、偵測探針、secret 引導（HF token 依現況用環境變數 + 可複製指令，不做設定檔、不改程式）、驗收與非目標。 |
| 2026-06-29 | v0.2 | 老闆 + Hana | 新增 §5.1 互動模型：`/setup` 為技能（非 builtin，無按鈕），採對話式 + 漸進揭露（偵測優先清雜訊、選單只列能力名+狀態、選一項才展開該項指令、回編號/說名字選擇）。釐清與 `/use`（builtin inline_keyboard）的機制差異。 |
| 2026-07-03 | v0.3 | 老闆 + Claude(Opus) | 新增 §12 存取安全預設（開源 security-by-default）：`server.js` 預設綁 `127.0.0.1`＋選配 `PORTAL_TOKEN` cookie gate（未設＝關、向後相容）＋Host 白名單＋對外無 token 開機警告＋收 CORS；新增 §6.2-G 遠端存取選配 runbook（Tailscale 優先）＋§7 探針（bind/token 只查有無、絕不印值）。修正 setup.md 路徑 `portal/commands/` → `global-knowledge/commands/`（與現有技能同目錄）。釐清「首次安裝不設 token 也不被鎖在外」＝預設綁本機。 |
| 2026-07-04 | v0.4 | 老闆 + Claude(Opus) | 新增 §13 維護鐵律：`/setup` 完整性。①（DoD）任何新功能引入「需人手動安裝/註冊的依賴」（ffmpeg、playwright、系統/Python 套件、HF_TOKEN／Telegram token…）必須在**同一次變更內**補進 /setup（探針 §7＋runbook §6＋能力清單），未登記＝未完工；②選配依賴的 **UI 按鈕/端點必須優雅降級**——先偵測、缺失回**明確且指向 /setup** 的訊息（非原始錯誤/500），`record` 端點的 `ffmpegAvailable()` 為現況範本。 |
