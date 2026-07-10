# SPEC — Scheduler（排程 + 自動接續 + 產出紀錄）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/server.js`（排程迴圈 + job）、`portal/index.html`（排程清單 UI）、`HARNESS_HOME`（持久化）
> 這是 `specs/SPEC-resilient-cli.md` 標記為「後續 Phase」的部分落地：**自動排程到 reset 自醒續跑 / 自主任務佇列 / 預算·煞車護欄**。
> Run／schedule 的**狀態語意**（success／failed／limited-waiting／`blocked` 受阻·待你…）與 agent 自報標記 `<run-outcome>` 定義於 `specs/SPEC-schedule-status.md`。
> 先求「**架構**」：網站上看得到排程清單（何時起、跑什麼、產出什麼）、沒開瀏覽器也能跑、且為之後接 Telegram 鋪好地基。

---

## 1. 核心原則：執行者 vs 觀看者分離（這是一切的根）

> **執行者**＝24h 常駐的 server（supervisor 擁有）；**觀看者**（網頁排程清單、Telegram、手機）只是去**讀**同一份持久化資料。

```
┌──────── 執行者（不需要瀏覽器）────────┐
│ Supervisor / Server（24h 常駐）        │
│   Scheduler Loop：到點 → 起 Job        │
│     └ 用指定 provider::model 跑任務     │
│     └ 撞 5h 限額 → 記 resetAt → 自醒續  │
│   全程寫入持久化資料（HARNESS_HOME）   │
└───────────────┬────────────────────────┘
                │ 讀同一份資料 + API
   ┌────────────┴───────────────┐
   │ 觀看者（缺席不影響執行）     │
   │  • 網頁「排程」清單          │
   │  • Telegram bot（後續）      │
   │  • 手機 / email              │
   └────────────────────────────┘
```

「沒開網頁也能跑」就是因為**執行與紀錄都在 server 端、且持久化**——跟現有「server 託管的 job 關掉瀏覽器也不死」同一招。

---

## 2. 資料模型（定義 → 執行 → 產出）

三層，對應「何時起／跑什麼／產出什麼」。**檔案式、與執行者無關**（之後要把執行搬到獨立 worker 也不用改）。

### 2.1 Schedule（排程定義）
```
{
  id, name, enabled,
  trigger: { type: 'cron'|'interval'|'once', expr|intervalMs|atISO },
  task:    { kind: 'prompt'|'skill', prompt?|skill?+args? },
  model:   'provider::model',          // 固定模型（如 claude::sonnet / gemini::pro）
  workspace,                           // 在哪個工作區跑
  guardrails: { maxCalls, maxRuntimeMs, maxResumes, failureBreakAfter },
  delivery: ['web'|'telegram'|'email'...],
  createdAt, nextRunAt
}
```

### 2.2 Run（執行紀錄；每跑一次一筆）
```
{
  id, scheduleId,
  startedAt, finishedAt,
  status: 'running'|'success'|'failed'|'limited-waiting'|'aborted'|'interrupted',
  trigger: 'auto'|'manual',            // B6：'auto'=排程到點/限額續跑；'manual'=/run 立即執行
  model, resolvedPrompt,
  usage,                               // 呼叫次數/時間（餵護欄與成本）
  jobId,                               // 對應 server 的 job
  interrupted?: { reason, resetAt, partial },   // 銜接 Part C
  artifactIds: [...], error?
}
```
- **狀態機（B6）**：`running` 為唯一非終態；終態為 `success`/`failed`/`limited-waiting`/`aborted`/`interrupted`。
  `interrupted` 由開機對帳 `reconcileOrphanRuns()` 寫入 —— 上一個行程殘留的 `running` run（被佈署/重啟打斷、永遠等不到 `finishedAt`）一律改記 `interrupted`，避免清單顯示幽靈「執行中」或卡住手動觸發。
- **防重入（B6）**：`triggerNow` 偵測 `getRunningRun(scheduleId)`（最新一筆 `running`），有則回 `409 {ok:false,error:'already-running'}`；前端「立即」按鈕同步 disabled。
- **清單即時狀態（B6）**：`GET /api/schedules` 每筆附 `running:{startedAt,trigger}|null`；UI 顯示「執行中」徽章＋開始時間＋自動/手動，並於有 run 執行中時輕量自動刷新。

### 2.3 Artifact（產出物；一個 Run → 0..n 個）
```
{ id, runId, kind: 'file'|'summary'|'transcript', path|content, createdAt }
```

### 2.4 持久化位置
- `HARNESS_HOME` 下（建議 `global-knowledge/schedules/`）：
  - `schedules.json`（定義）、`runs/<scheduleId>/<runId>.json`（執行）、產出檔放 `runs/<scheduleId>/<runId>/`。
- 跟 chat history 同精神（檔案式）→ **跨自癒重啟不丟、不綁分頁、不綁工作區**。

---

## 3. 執行架構：第一版「內建在 server」

### 3.1 決策：內建優先，不先拆 worker
- **「內建」不代表 server 自己算**：server 跟跑 chat 一樣是 **spawn CLI 子行程**去算，自己只做監督 + 接 I/O + 寫紀錄 → event loop 不被長任務卡。
- **排程任務 = 一種被時間觸發的 job**，直接複用現有 `jobs` Map、reattach、Part C 中斷/續跑。
- 最少零件、最本地優先：一個 supervisor、一個 server，不引入佇列/IPC/第二個 supervisor。

### 3.2 唯一權衡（已被 Part C 解掉）
自癒重啟（deploy）時若剛好有排程 job 在跑 → 子行程被收 → 這正是 Part C 場景：**存半成品 → 之後自醒續**。耦合會優雅降級，不是災難。

### 3.3 何時才拆獨立 worker（出現具體需求才做，非破壞性）
- 有任務長到**絕對不能被 deploy 打斷**；或
- 要在 **server 重啟/沒開時也照跑**；或
- 要**大量平行**排程（需 worker pool）。
- 因資料模型與執行者無關，屆時只換「誰跑迴圈」，UI/API/資料不動。

### 3.4 機器必須醒著（獨立議題，但別漏）
不管內建或 worker，**排程時間點該機器要是醒的**。要可靠「凌晨 2 點」跑，需 OS 層喚醒（Windows 工作排程器 wake timer／設不睡眠）。Scheduler 啟動時也要做 **missed-run 補跑判斷**（睡醒後發現錯過的排程要不要補）。

---

## 4. 自動接續（限額自醒續跑，銜接 Part C）

- Run 撞 5h 限額 → 狀態 `limited-waiting` + 記 `resetAt`（`detectRateLimit` 已會解析）。
- Scheduler 在 `resetAt` 自動排一個「續跑」：把 Part C 存的半成品 + 硬碟現況餵回**同一顆模型**接續（同模型才省 token、語意連續）。
- 受 `guardrails.maxResumes` 限制，避免無限自醒。

---

## 5. 護欄（自主執行的安全閥，非可選）

排程＝在你不看著時自動花共用 quota。第一版就要有：
- 每條排程：`maxCalls`（最多幾次模型呼叫）、`maxRuntimeMs`（單次最長）、`maxResumes`（最多自醒幾次）、`failureBreakAfter`（連續失敗 N 次 → 停用 + 通知，不無限重試）。
- 全域可加「每日總預算」上限（跨排程）。

---

## 6. Delivery sinks（為 Telegram/手機鋪路）

- 每條 Schedule 可掛 `delivery` 目標：`web`（站內動態）/ `telegram` / `email`。
- Run 完成 → 把摘要 + 產出連結投到各 sink。
- **Telegram 只是「另一個讀同一份資料的消費端 + 通知器」**：跑完推一則、或你問「今天做了什麼」回今日 Run 摘要。核心邏輯不因加 Telegram 而改。

---

## 7. UI（網頁「排程」清單，借用歷史對話版型）

- 側邊欄一個「📅 排程」區：列出各 Schedule（名稱、**下次何時起**、模型、啟用開關、最近一次狀態）。
- 點一條 → 詳情：任務內容（prompt/skill）、**Run 歷史**（時間/狀態/用量）、每次的**產出物**（可點開看報告/transcript，如同點開一段歷史對話）。
- 新增/編輯排程：名稱、觸發、任務、固定模型、工作區、護欄、delivery。

---

## 8. Hana 自我感知（Run log 也是 Hana 的記憶）

- Run 歷史不只給 UI 看，也要能**餵回 Hana / 可查詢**：讓 Hana 能回答「我今天做了什麼」、避免重複做、跨排程引用先前產出。
- 提供查詢介面（如 `/api/schedules/runs?since=...`）兼供 UI、Telegram、Hana 自身使用。

---

## 9. API 介面（草案）

| 端點 | 用途 |
|---|---|
| `GET /api/schedules` | 列出排程（含 nextRunAt、最近狀態、`running` 執行中狀態） |
| `POST /api/schedules` / `PUT /api/schedules/:id` / `DELETE` | 建/改/刪排程 |
| `POST /api/schedules/:id/run` | 立即手動觸發一次 |
| `GET /api/schedules/:id/runs` | 某排程的 Run 歷史 |
| `GET /api/runs/:runId` | 單次 Run 詳情 + 產出 |

---

## 10. 待拍板的開放問題
1. cron 表達式自己解析，還是引入輕量套件？（避免重型依賴）
2. `missed-run`：睡醒後錯過的排程要補跑、跳過、還是只補最近一次？
3. delivery 第一版只做 `web`（站內），Telegram 留下一階段？
4. 護欄的「每日總預算」用「呼叫次數」還是「時間」計？（CLI 查不到精確 token）
5. 排程任務的工作區：固定綁一個，還是可選 `_harness` 自身（自我診斷類）？

---

## Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-20 | v0.1 | 老闆 + Claude | 初版架構草案。執行者/觀看者分離、三層資料模型（Schedule/Run/Artifact）、內建優先（何時拆 worker）、限額自醒續跑銜接 Part C、護欄、delivery sinks、排程清單 UI、Hana 自我感知。 |
| 2026-06-27 | v0.2 | 老闆 + Claude | B6：Run 增 `trigger`（auto/manual）與 `interrupted` 終態；狀態機、防重入（triggerNow 守衛 + 409）、開機 orphan 對帳、清單即時「執行中」狀態（`GET /api/schedules` 附 running）。 |
