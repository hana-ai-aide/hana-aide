# SPEC — Resilient CLI Execution（誠實偵測 / 限流感知 / 中斷續跑）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍: portal/server.js（chat 執行層、job manager）、portal/index.html（狀態指示器）
> 本規格只涵蓋「讓單次任務在 agy 不穩 / quota 撞牆 / 中途被砍時仍可靠且可續」。
> **不含**自主心跳、自動排程續跑、多 LLM 接力（列為後續 Phase，但本規格會鋪好它們的地基）。

---

## 背景與三條鐵則（事實依據）

1. **三顆 CLI 都查不到「剩餘 quota」**（agy/codex/claude 皆無此指令）。唯一誠實的訊號是呼叫當下的「成功 / 限流(+重置時間)」。→ **絕不捏造 %、絕不定時輪詢。**
2. **agy `--print` 冷啟動 auth 內部不穩**：log 每次都先出現 `not logged into Antigravity` 再（有時）`authenticated via keyring`。常駐 agy 也救不了（已實測）。→ 這是 agy 本身的重試毛病，我們在 portal 層補「誠實偵測 + 自動重試」。
3. **記憶在 portal、不在 CLI**：每次都是無狀態 `--print`/`exec`，上下文由 portal 的 v2a context file 餵入。→ 續跑 = 把「歷史 + 半成品 + 硬碟現況」餵回任一顆 CLI；**這也是多 LLM 接力的前提**。

---

## Part A — agy 誠實偵測 + 自動重試

**問題**：`extractAgyError` 去 log grep `not logged into Antigravity`，但這行每次啟動都會出現 → 任何空答案都被誤報成「尚未登入」，訊息還叫使用者去登入（其實已登入）。

**A1. 誠實分類（取代現行偵測）**：解析 agy log，分成三類——
- `auth_failed`：**整份 log 都沒有**後續成功標記（`authenticated successfully` / `via keyring`）→ 真的沒登入 → 提示登入。
- `rate_limited`：含 `RESOURCE_EXHAUSTED` → 交給 Part B，附帶解析 `Resets in …`。
- `transient`：有成功標記、但答案空 → 冷啟動暫時失敗 → 進 A2 重試。

**A2. 自動重試**：`transient` 時，**同顆 CLI、同 prompt、同上下文**自動重試（預設上限 2 次，遞增退避 ~1s/2s）。因為失敗在「進門前」、沒做任何事，重試無副作用、無續跑問題。

**A3. 訊息誠實化**：不再無腦顯示「尚未登入」。`auth_failed` 才提示登入；`transient` 顯示「agy 暫時取用失敗，已自動重試 N 次」；`rate_limited` 顯示限流與重置時間。

**驗收**：重現先前會跳「尚未登入」的情境 → portal 靜默重試後給出答案；「尚未登入」只在真的沒登入時出現。

---

## Part B — 限流感知狀態（反應式、誠實、不輪詢）

**原則**：只反映「呼叫當下觀察到的真相」，沒有假 %、沒有 poller。

**B1. 狀態模型（server 端，每個 provider+model 一筆）**：
```
{ provider, model, status: 'ok'|'limited'|'unknown',
  lastUsedAt, resetAt|null, lastError|null, updatedAt }
```

**B2. 被動更新（搭便車，零成本）**：每次**真實** chat 呼叫結束就更新該模型——
- 成功 → `ok`，更新 `lastUsedAt`。
- 撞牆（agy `RESOURCE_EXHAUSTED` / Claude·Codex 的 rate-limit 錯誤）→ `limited` + 解析 `resetAt`。
- 工作中每派一次工就刷新 → **永遠最新**；閒置不呼叫 → 自然不更新（= 自動降頻）。

**B3. 介面**：模型下拉旁一顆狀態鈕；點開浮動小面板列出各 CLI：
- `✅ OK（最後使用 14:32）` 或 `⛔ 限流中，約 15:10 重置（倒數 38m）` 或 `❔ 未知（本視窗尚未使用）`。
- 鈕只是「顯示目前已知狀態 + 最後更新時間」；**不主動打 API**（避免耗額度與 agy 冷啟動）。可保留一個「手動探測」選項，但需使用者明確點擊。

**B4. 重置時間解析（每 provider 一個 parser）**：

| Provider | 偵測標記 | 重置時間解析 | 型態 |
|---|---|---|---|
| **codex** | `You've hit your usage limit`（Exit 1） | `try again at (.+?)\.` → 去序數 `(\d+)(st\|nd\|rd\|th)→$1` → `Date.parse("Jun 19, 2026 10:01 PM")` | **絕對時間**（可達數天後 = 週/月配額） |
| **agy** | log 含 `RESOURCE_EXHAUSTED` | `Resets in ([0-9hms]+)` → now + 相對時間 | **相對時間**（通常數小時） |
| **claude** | ⚠️ 待抓樣本（推測含 `usage limit` / `rate limit` / `resets at`） | 待樣本確認；先用通用 fallback | 待定 |

- `resetAt` 必須能容納「**數小時到數天**」的範圍（Codex 週/月配額可能 4 天後才重置）。
- 抓不到重置時間 → `limited, reset unknown` + 預設退避（例如 30 分後再試）。
- **Claude 樣本仍缺**：等下次撞到、或我設法觸發一次，把實際格式補上。

**B5. 持久化**：狀態寫進 `.harness/runtime/`（不要只放記憶體），這樣**自癒重啟後限流/重置資訊不丟**，續跑排程才接得上。

**驗收**：撞牆 → 指示器自動翻成「限流中，約 T 重置」，全程零輪詢；下一次成功呼叫翻回 OK。

---

## Part C — 中斷即保存 + 續跑（以硬碟現況為真相）

**問題**：一輪被中途砍掉（quota/timeout/使用者中止）時，portal 只在「乾淨跑完」才存最終回覆 → 半成品被丟掉 → 重送原對話會**從頭重跑**（你的「改到第 8 支、重試卻從第 1 支」情境）。

**C1. 中斷即保存半成品**：chat 助手本來就是**邊跑邊收串流**（agy PTY / Claude·Codex stdout）。新增「異常終止」處理：當 process 非正常結束（被殺 / 超時 / 偵測到限流錯誤 mid-stream），把**已收到的部分輸出**存成一則 assistant 訊息，標記：
```
meta: { interrupted: true, reason: 'limit'|'timeout'|'aborted'|'error', partial: true }
```
並寫進對話歷史與 v2a context。→「它做到哪、講了什麼」被保存，不再丟棄。

**C1.1. 超時與中斷時的進度殘留顯示 (Progress Residual Log)**：
若任務超時或被手動中斷，且模型尚未輸出 any 實質回覆內容時（最終回覆為空），系統應主動解析該次呼叫的終端機輸出流 (`allOutput`)，過濾掉 ANSI 控制字元與重複空白後，擷取最末尾 15 行的即時輸出（即超時前的最後操作痕跡，例如正在執行的 Tool Call 或編譯狀態），並以 Markdown 程式碼區塊附加於超時錯誤訊息下方。
* **超時層級設計 (Timeout Hierarchy)**：為了防止外層的 `server.js` 與內層的 `agy.exe` 的 5 分鐘計時器因啟動延遲而競爭，外層 `server.js` 的 `absoluteTimeout` 設為 **5 分 10 秒 (310s)**，內層 CLI 的 `--print-timeout` 設為 **5 分鐘 (300s)**。這 10 秒的緩衝能確保 CLI 優先觸發其自身超時、寫入超時日誌並優雅退場；若進程死鎖，外層計時器才會強殺並回傳 PTY 殘留。
* 輸出範例：`❌ 錯誤: Gemini CLI 執行超時（5 分鐘未回應）。\n\n**中斷前最後執行的步驟與終端畫面：**\n\`\`\`\n[Tool Call] run_command { CommandLine: "pnpm test" }\n...\n\`\`\``
* 效益：打破「超時黑盒」，讓使用者能立刻判斷是在哪一個具體步驟（如測試掛起、編譯超時）卡死。

**C2. 終止分類**：`classifyTermination(ctx, exitCode, output)` → `ok | limit | timeout | aborted | error`。
- `limit`：輸出含限流標記（同時餵 Part B 記 `resetAt`）。
- `aborted`：`ctx.aborted`。`timeout`：我方逾時殺掉。`error`：非 0 退出。

**C3. 續跑（以硬碟為真相）**：可續跑 = 最後一則 assistant 被標 `interrupted`。續跑時在 prompt 前面加 **RESUME 前綴**：
> 你上次執行到一半被〔原因〕中斷。以下是你當時的部分輸出：〔partial〕。
> **已變更的檔案在硬碟上是事實依據——請先檢查實際狀態，判斷哪些已完成，再從未完成處接續，不要重做已完成的部分。**

讓 AI **以硬碟現況為準**判斷進度，免疫於文字記憶的模糊。

**C4. 觸發方式（v1）**：被中斷的那則訊息上出現「▶ 繼續」按鈕，由**使用者手動**觸發續跑（同顆或換顆 CLI 皆可，因為上下文是 portal 餵的）。
- 與 Part B 銜接：若中斷原因是 `limit`，續跑按鈕可顯示「約 T 後可續」。**自動排程到 T 自醒續跑** = 後續 Phase（心跳/自主），v1 先手動。

**C5. 即時執行日誌與狀態回饋 (Live Output Streaming)**：
為避免模型在執行複雜或長時任務（例如自癒、大型編譯、多次重構等）時，介面僅顯示靜態載入動畫而產生「黑盒掛起」之疑慮：
* **移除過期之硬超時限制**：將 `agy` 的 `--print-timeout` 調整至 **60 分鐘 (60m)**，外層的 `absoluteTimeout` 調整至 **60 分鐘 (3600000ms)**，將無資料輸出的怠速超時 (`IDLE_TIMEOUT_MS`) 設為 **5 分鐘 (300000ms)**。
* **即時日誌曝光 (Live Logs API)**：在 `ptyProcess.onData` 中，將 ANSI 清理後的 stdout 即時儲存於 Job Context 變數 `ctx.liveOutput`。GET `/api/jobs/:jobId` 應額外返回 `liveOutput` 屬性。
* **前端輪詢與渲染**：在聊天載入中狀態（Thinking Loader）下方，嵌入一個摺疊式的即時執行日誌終端（Terminal View）。當 `inFlight` 為真時，前端以 2 秒間隔非同步輪詢 `/api/jobs/:jobId`，並將最新輸出渲染至終端中（限制為最後 40 行，以防 DOM 效能膨脹）。

**驗收**：砍掉一個改多支檔的任務 → 中斷訊息含半成品被保存 → 按「繼續」→ AI 先檢查硬碟、從未完成處接續，而非重來。

---

## 不在本規格（後續 Phase，但已鋪好地基）

- **自主心跳**（OpenClaw 式遞減詢問）、**自動排程到 reset 自醒續跑**、**自主任務佇列 + 預算/煞車護欄**。
- **多 LLM 接力**（長任務跨模型交棒）：靠 Part C 的「半成品 + 硬碟真相 + portal 上下文」即可換模型續，本規格已使其可行。
- **步驟級 checkpoint**（我方編排的長任務每步落進度）：讓續跑粒度細到「單一步驟」，是 C 的強化版。

---

## 需要你拍板的開放問題

1. **A 的重試上限**：2 次夠嗎？要不要「重試仍失敗就自動降級提示改用 Claude」？
2. **B 的「手動探測」**：要不要保留一個「主動戳一下測試是否解除限流」的按鈕（會耗一點額度 + 可能踩 agy 冷啟動）？還是純被動就好？
3. **Claude / Codex 的限流錯誤格式**：需要實際撞一次（或翻 log）抓樣本才能寫 parser；要不要我先想辦法取一個樣本？
4. **續跑的「半成品」要存多完整**：完整原始串流（可能很長、含雜訊）還是先做輕度清理？權衡「忠實 vs context 膨脹」。
5. **誰來實作**：A/B/C 全是 portal/server 改動（沒碰 Start_Harness）。要 Hana 做（我 review 三個重點：偵測誤判、限流狀態持久化、中斷保存）還是我直接做？
6. **v1 範圍**：是否同意 v1 = A + B + C1~C4（手動續跑）；自動排程/心跳留 Phase 2？
