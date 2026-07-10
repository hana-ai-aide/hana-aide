# 架構地圖 — Harness Portal（Hana 自癒導航用）

> **這份是什麼**：portal 的「高層地圖」。Hana 要自我修改前**先讀這份**，定位「該改哪個子系統、有什麼不變量、哪裡有地雷」，再用 codegraph 查具體符號、再動手。
> **刻意保持高層**（子系統 + 不變量 + 地雷 + 指標），不寫逐行細節——細節會漂移，用 `codegraph query/impact` 即時查。
> 程式幾乎全在 `portal/server.js`（後端，~2600 行、單一大 HTTP handler）和 `portal/index.html`（前端 SPA）。

---

## 0. 自我修改前必看的「全域不變量」（踩到就出事）

- **`.ps1` 限 PowerShell 5.1 語法**：禁用 `??` `?.` `?:` `&&` `||`（這些是 PS7+）。
- **HARNESS_HOME（資料）vs 釋出目錄（程式）分離**：跨版本共享的「資料」（global-knowledge、registry、limit-state、.releases 指標）走 `HARNESS_HOME`；「程式」走 `__dirname`（每個 release 各一份）。改路徑時別把這兩類混在一起。
- **只改開發區、絕不碰 `.releases/`**：見 `portal/policy/self-modification.md`。
- **聊天回覆不准吐整段 HTML/程式碼**：要產生就寫成檔案、回覆只給路徑（`buildChatPrompt` 的前言有強制；前端 `sanitizeRenderedHtml` 也會擋）。
- **server.js 是「一個大 `http.createServer((req,res)=>{…})`」**：大多數 API 是裡面的 `if (pathname === '/api/…')` 內聯區塊。**這代表 `codegraph callers` 對「被 handler 呼叫的函式」只會回到 file 層級**（粒度粗），這類 call site 要靠讀碼 + `grep` 補。

---

## 1. 子系統地圖

| 子系統 | 主要符號 / 位置 | 一句話 | 細部 spec |
|---|---|---|---|
| **HTTP 路由** | `http.createServer` 內的 `if (pathname===…)` | 所有 `/api/*` 都在這個大 handler 裡（內聯） | — |
| **多 CLI 聊天路由** | `parseChatModel` → `chatViaClaude` / `chatViaGemini` / `chatViaCodex`；`buildChatPrompt`、`respondChat` | 依 `provider::model` 選 CLI；無狀態 `--print`/`exec`，上下文由 portal 餵 | — |
| **v2a 檔案式上下文** | `writeContextFile`、`buildChatPrompt`（注入 context_*.md + 最近幾輪） | 對話記憶在 portal 不在 CLI → 這是「跨 CLI 接力」的前提 | — |
| **Job 管理（server 持有）** | `jobs` Map、`snapshotWctx`、`listRunningJobs`、`abortJob`；`/api/jobs*` | 任務歸 server 託管，關瀏覽器不死、重開可 reattach | — |
| **多工作區** | `resolveWorkspace(req)`、`WORKSPACE_ROOT`(legacy 全域)、registry(`projects.json`/`reg.active`)、`setActiveProject`、`getManifest`、`harness.json` | 每請求依 `X-Workspace` header 解析工作區 | — |
| **長期記憶（兩層四檔）** | `injectMemoryBlock`、`MEMORY_SPECS`、`parseMemoryOps`、`applyMemoryOps`；`/memory` | USER/AGENT 全域、MEMORY/PERSONA 專案 | `portal/policy/memory-policy.md` |
| **指令/技能（3 層）** | `loadCommands`、`detectCommand`、`commandsIndexForPrompt` | ship(`portal/commands`) < global(`global-knowledge/commands`) < project(`.harness/commands`)；`extends` 繼承 | — |
| **自癒（不可變版本＋監督者）** | `.ps1` 腳本 + `_harness-release-lib.ps1`；server 端 `/api/restart`、`BOOT_ID`、`RUNNING_VERSION`、`RELEASES_DIR` | 每版唯讀 `.releases/vN`，監督者迴圈擁有 server | `portal/policy/self-modification.md` |
| **韌性 CLI（v1）** | `detectRateLimit`、`agyAuthStatus`、`recordLimitOutcome`、`limitState`；`/api/limits` | agy 誠實偵測+重試、限流感知、中斷續跑 | `specs/SPEC-resilient-cli.md` |
| **codegraph / docgraph** | `/api/codegraph*`（`execFile('codegraph', {cwd: root})`）、`/api/docgraph*` | 對 active workspace 的程式/文件知識圖 | `[[project-harness-docgraph]]` |
| **簡報系統（注入式共享模組）** | `portal/presentation-player/presentation-core.js`+`.css`（播放引擎/外殼）、`hana-overlay.js`（浮動頭像+語音，server 在 `/raw` 服務 presentation HTML 時注入 `<script src>`）；deck 在 `presentations/` | deck=純內容；播放/縮放/TTS/全螢幕由 core 提供、頭像/語音由 overlay 注入；**fix-once、所有 deck 共享** | `specs/SPEC-presentation-core.md` |
| **Telegram C&C** | `portal/telegram.js`：`TelegramBot` class（長輪詢 loop + auth whitelist + /bind + sink + console log）；server.js 初始化 `telegramBot`；API `/api/telegram/*` | 全域指揮控制台：outbound sink（C1）+ inbound polling+auth（C2）；token 機密存 `HARNESS_HOME/global-knowledge/secrets/telegram.json` | `specs/SPEC-telegram.md` |
| **前端 SPA** | `portal/index.html`：tabs、聊天 UI、avatar widget、簡報播放器、sidebar、工作區選單、限流狀態鈕、`sanitizeRenderedHtml`、全域 `fetch` 包裝（帶 `X-Workspace`） | 單檔 SPA | — |

---

## 2. 已知地雷（自癒最容易在這裡翻車）

- **工作區作用域**：`resolveWorkspace(req)` 沒帶 `X-Workspace` header 時會 fallback 去讀**全域 `reg.active`**；而 `/api/workspace/activate` 會寫 `reg.active`。新分頁的第一個 `/api/status` 在 sessionStorage 設定前送出（沒 header）→ 會吃到別的分頁的 active。**修這塊要：① 別讓 activate 改會影響別分頁的全域；② 前端保證每個請求都帶 header（含第一個）；③ 前端用 `sessionStorage` 不可用 `localStorage`（後者跨分頁共享）。** ← 這就是目前待修的 bug。
- **`respondChat` 只在「乾淨跑完」存檔**：中途被砍（限流/逾時/中止）原本會丟掉半成品；Part C 已改成標 `meta.interrupted` 保存（見 SPEC-resilient-cli）。改聊天流程別退回這個雷。
- **agy `--print` 冷啟動 auth 不穩**：log 每次都先印 `not logged into Antigravity` 再（通常）keyring 成功 → 只在「整份 log 都沒成功標記」才算真失敗（`agyAuthStatus`）。別 grep 到那行就報「尚未登入」。
- **CLI 查不到剩餘 quota**：只能觀測「成功 / 撞牆+重置時間」，別捏造 %。
- **部署上線等待**：慢但健康的開機（負載重/掃大工作區）可能 >30s；`Wait-HarnessRestarted` 已放寬到 90s。別調回太短，否則會誤判失敗→回滾→震盪。
- **簡報：一個 deck 只能有「一套」播放引擎**。ep1-v2 曾同時跑 `PresentationPlayer` 框架＋自帶 `adjustScale`＋自帶浮動頭像，三套互相打架（transform 衝突、頭像被縮放容器吃掉、雙引擎搶 resize）→ 一路出包。正解：deck 純內容，只靠注入式 `presentation-core` + `hana-overlay`。**舊的 `presentation-player.js`（`PresentationPlayer` class）已淘汰、無 deck 使用，勿再叫 deck 套它。**
- **`portal/` 內「新增」的檔可免 Deploy 即時生效**：`/raw` 對 `portal/` 路徑的解析順序是 `__dirname/..`（= release 快照）→ fallback `HARNESS_HOME`（= 開發區）。已在 release 的檔會服務 release 版（改它要 Deploy）；release 沒有的「新檔」會走 HARNESS_HOME fallback 服務開發區版（免 Deploy）。新增共享資產（如 `presentation-core.*`）可即時上線；改既有 `server.js`/`hana-overlay.js` 等才需 Deploy。
- **注入腳本的跳脫地雷**：別把大段「瀏覽器 JS」寫進 server.js 的 `` `…` `` template literal 再 emit——裡面的 `\'` 會被求值收斂成 `'`，破壞 emit 出去的單引號字串（`node --check`＋冒煙測試都驗不到）。要內聯就改成「靜態 .js 檔 + `<script src>`」（如 `hana-overlay.js`），可被 `node --check` 真正驗到。
- **三顆 CLI 的 timeout 要一致、改一個記得改全部**：agy/Claude/Codex 各有獨立逾時（`chatViaGemini`/`chatViaClaude`/`chatViaCodex`）。曾發生 agy 調到 60min，但 Claude/Codex 漏改、仍是 4min 硬上限 → 自癒這類長任務每次被計時器砍，**即使已產出完整答案仍被誤標 `interrupted:timeout`、跳假的「可接續」**。慣例：① Claude/Codex 用 60min absolute（agy 另有 5min idle，因它 scrape PTY 有增量輸出；Claude `--print` 多半到結尾才吐，故不加 idle 以免誤殺正在思考的任務）；② 中斷判定要 `timedOut && code !== 0`——程序乾淨結束（exit 0）不可標逾時。
- **render-service 對 `presentations/` 的存取要釘 `workspace=HARNESS_HOME`**：匯出 pptx／錄影是在 **server 端**用 Playwright 載 `http://localhost:PORT/raw?path=presentations/<deck>.html`。這個 server-side 請求**沒有 `X-Workspace` header** → `/raw` 用 portal 的「預設工作區」解析；指揮官一旦切到別的工作區（如客戶案範例專案），`presentations/` 不在那 → **404** → Playwright 載到 404 頁 → 0 個 `.slide` → 報**誤導的「找不到 .slide」**（deck 其實沒問題）。正解：deckUrl 一律帶 `&workspace=${encodeURIComponent(HARNESS_HOME)}`（deck 本就住 `_harness/presentations/`）；`screenshot.js` 也加了 `page.goto` 的 HTTP 狀態檢查，404 直接報「deck 載入失敗」。**通則：凡 server 端 fetch 自家 `/raw` 取 `presentations/` 或任何 HARNESS_HOME 資產，都要明確帶 workspace，別靠預設。**

---

## 3. 自我修改流程（摘要，完整見 self-modification.md）

1. **讀本地圖** 定位子系統 + 確認不變量/地雷。
2. **`codegraph`** 查符號位置與 `impact`（具名函式很準；handler 內聯的 call site 要補讀碼）。
3. 改**開發區**（`portal/`、`docgraph/`、`*.ps1`），**不碰 `.releases/`**。
4. **自我驗證**：`node --check portal/server.js`；前端 inline script 可用 `new Function()` 語法檢查。
5. **`Deploy_Harness.ps1`** 上線（快照→獨立 port 冒煙→晉升→監督者重啟→失敗自動回滾）。
6. **git 由人類掌控**（除非明確要求，不自行 commit/push）。

---

## 4. 維護本檔
- 子系統有增減、或新發現一個「地雷」時，更新這份（保持高層）。
- 一句話的「教訓」放 MEMORY；「為什麼這樣設計」的細節放對應的 `specs/SPEC-*.md`；本檔只當索引與地雷清單。
