# SPEC — Chain Executor（任務鏈：序列相依執行）

> Status: APPROVED（決策已鎖定）｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/scheduler.js`（Chain Runner）、`portal/server.js`（API）、`portal/index.html`（UI）、`HARNESS_HOME/global-knowledge/schedules/`（持久化）
> 建在 §B 排程系統（SPEC-scheduler.md）之上。Chain 是排程層的新概念，不取代 Schedule，而是把多個 Schedule 串成有序的執行序列。

---

## 1. 動機與核心概念

**問題**：K1→K2→K3 這類「後一步靠前一步的產出」的任務，目前只能一步一步手動觸發，完成一步才能去按下一步。若中途系統重啟，就要從頭數起。

**解法**：引入 `Chain`（任務鏈）作為 Schedule 層之上的協調者。

```
Chain（協調者）
  └─ Step 1 → Schedule A → Run → success
  └─ Step 2 → Schedule B → Run → success
  └─ Step 3 → Schedule C → Run → success
  └─ ...
  └─ [整鏈完成] → 一次部署 → 一則通知
```

**四個核心承諾**：
1. **序列等待**：Step N 的 Run 達到 `success` 終態，才啟動 Step N+1。
2. **Fail-fast**：任一步驟的 Run 達到 `failed`（或其他非成功終態），整條鏈停止並通知。
3. **斷點續跑**：ChainRun 狀態逐步持久化；重啟後 `reconcileOrphanChainRuns()` 自動從中斷的步驟接回（已成功的步驟不重做）。
4. **中途不部署、最後才部署**：步驟在鏈中執行時收到「請勿部署」指令（prompt 注入）；所有步驟完成後，由 Chain Executor 統一呼叫一次 Deploy_Harness.ps1。

---

## 2. 資料模型

### 2.1 Chain（定義；存 `chains.json`）

```json
{
  "id": "chain_<nanoid>",
  "name": "K系列：完整文件回寫",
  "steps": [
    { "scheduleId": "sched_k1", "label": "K1 walker" },
    { "scheduleId": "sched_k2", "label": "K2 回寫核心" },
    { "scheduleId": "sched_k3", "label": "K3 保真細節" }
  ],
  "deployAfterComplete": true,
  "delivery": ["web", "telegram"],
  "workspace": "D:/path/to/workspace",
  "createdAt": "2026-06-30T00:00:00Z"
}
```

- `steps[].scheduleId`：引用現有 Schedule（v1）。Schedule 本身的設定（model、workspace、prompt、guardrails）保持不變；Chain 只決定「何時觸發它、是否繼續下一步」。
- `deployAfterComplete`：整鏈成功完成後是否執行一次 Deploy_Harness.ps1（預設 `true`）。若鏈為純查詢/分析任務可設 `false`。
- `delivery`：整條鏈完成/失敗時的通知目標（步驟個別通知在鏈中被壓制，見 §3.4）。

### 2.2 ChainRun（執行紀錄；存 `chain-runs/<chainId>/<chainRunId>.json`）

```json
{
  "id": "chainrun_<nanoid>",
  "chainId": "chain_<nanoid>",
  "startedAt": "...",
  "finishedAt": "...",
  "status": "running | success | failed | interrupted",
  "trigger": "manual",
  "currentStepIndex": 2,
  "steps": [
    { "scheduleId": "sched_k1", "label": "K1", "runId": "run_aaa", "status": "success", "finishedAt": "..." },
    { "scheduleId": "sched_k2", "label": "K2", "runId": "run_bbb", "status": "success", "finishedAt": "..." },
    { "scheduleId": "sched_k3", "label": "K3", "runId": null,      "status": "pending", "finishedAt": null }
  ],
  "failedAt": null,
  "failReason": null
}
```

**狀態機**：
- `running`：鏈正在執行（有步驟進行中或等待步驟完成）
- `success`：所有步驟均成功完成（已觸發部署 + 通知）
- `failed`：某步驟失敗，鏈已停止（已通知）
- `interrupted`：開機對帳時發現上一個行程的孤兒 ChainRun，自動重設以觸發續跑

步驟本身的 status：`pending | running | success | failed`

### 2.3 持久化位置

沿用 SPEC-scheduler.md §2.4 的目錄結構：
```
HARNESS_HOME/global-knowledge/schedules/
  chains.json                       ← Chain 定義清單
  chain-runs/<chainId>/<runId>.json ← ChainRun 記錄
```

---

## 3. 執行架構

### 3.1 ChainRunner（`scheduler.js` 內）

```
triggerChain(chainId, trigger='manual')
  → 防重入：getRunningChainRun(chainId) → 存在回 {ok:false, error:'already-running'}
  → createChainRun(chain)           ← 寫 chain-runs/*.json
  → _runNextStep(chainRun)
      ↳ 找 currentStepIndex 的步驟
      ↳ 更新步驟 status = 'running'（持久化）
      ↳ 呼叫 _fireSchedule(schedule, 'auto', {onComplete, inChain: true})
          ↳ inChain=true 觸發 §3.3 suppress 行為
          ↳ onComplete(run) 回調：
              if run.status === 'success'      → 更新步驟 success → currentStepIndex++
                                                → _runNextStep 或 finalizeChain('success')
              if run.status === 'failed'       → finalizeChain('failed', run)
              if run.status === 'aborted'      → finalizeChain('failed', run)
              if run.status === 'limited-waiting' → 靜候（SCHED-07 自醒後重觸 onComplete）
      ↳ 每次狀態更新都 updateChainRun（寫磁碟）
  → finalizeChain(status, failedRun?)
      ↳ 寫 finishedAt + status
      ↳ 若 status==='success' 且 chain.deployAfterComplete：spawn Deploy_Harness.ps1（§3.5）
      ↳ deliver(chain.delivery, {chainId, chainRunId, status, steps, …})（§3.4）
```

### 3.2 等待步驟完成

`_fireSchedule` 現有流程加鉤子——`_fireSchedule(schedule, trigger, {onComplete?, inChain?})` 可選傳入 callback；Run 達到任一終態時呼叫它。Chain 的 `_runNextStep` 透過此 callback 推進。

- 若步驟 Run 進入 `limited-waiting`（限流等待）：`onComplete` 不立即觸發；等 SCHED-07 的自醒邏輯把 run 續跑到最終終態後再觸發。Chain 靜默等待，不視為失敗。
- 若步驟 Run 是「multi-resume」場景（限流多次自醒）：Chain 一樣靜候，直到最終 success/failed。

### 3.3 步驟 Suppress（中途不部署、不通知）

當 `inChain: true` 時，`_fireSchedule` 在觸發步驟前做兩件事：

**① prompt 注入（suppress-deploy 指令）**：在步驟 prompt 最前面加入以下系統提示：
```
⚠️ 此任務在「任務鏈」中執行。
請勿呼叫 Deploy_Harness.ps1 或進行任何部署操作；
整條鏈的所有步驟完成後，將由鏈統一執行一次部署。
```

**② 跳過 run-level delivery**：步驟的 Run 完成後不觸發 `deliver()`（壓制 web/telegram 通知）。
整鏈完成或失敗才發一則通知（見 §3.4）。

> **幂等性說明**：步驟被重跑（斷點續跑）時，AI 會再次執行同一個任務。步驟 prompt 設計應使任務可安全重跑（例如「檢查 X 是否已完成、若已完成則跳過；若未完成則執行」）。這是 prompt 設計原則，不由執行框架強制。

### 3.4 鏈級通知

`finalizeChain` 送出一則整鏈通知，內容包含：
- 整鏈 status（success / failed）
- 哪一步失敗（若有）
- 各步驟完成時間摘要

通知目標：`chain.delivery`（使用者在建鏈時設定，沿用 H7 checkbox 設計）。

### 3.5 整鏈完成後部署

若 `chain.deployAfterComplete === true`（預設）且所有步驟均 success：
- `finalizeChain` 在送通知前，先 `spawn('pwsh', ['Deploy_Harness.ps1'], …)`
- 部署完成（冒煙測試通過）後才算整鏈 success；部署失敗視為整鏈 failed，通知時附帶說明
- 部署期間 ChainRun status 保持 `running`（finishedAt 尚未寫入）

### 3.6 防重入

同一條鏈只能有一個 `running` 的 ChainRun。`triggerChain` 先查 `getRunningChainRun(chainId)`，存在則回 `{ok:false, error:'already-running'}`，UI 按鈕同步 disabled。

---

## 4. 斷點續跑（重啟後自動接回）

**場景**：鏈跑到步驟 3 時，步驟 3 的任務因某種原因使 server 重啟 → 步驟 3 的 Run 被 `reconcileOrphanRuns()` 標為 `interrupted`。

> 注意：因為步驟在鏈中跑時已注入「請勿部署」指令，正常情況下步驟本身不會觸發部署/重啟。但若有其他原因（OS crash、電源問題等）仍可能發生，斷點續跑保護這些情況。

**開機流程**（接在現有 `reconcileOrphanRuns` 之後）：

```
reconcileOrphanChainRuns()
  → 讀所有 status==='running' 的 ChainRun
  → 對每筆：
      找 currentStepIndex 的 step
      找那個 step 的 runId → 確認 Run 狀態
      若 run.status === 'interrupted'（孤兒）
        → 把 ChainRun 的 currentStep 改回 status='pending'
        → 把 ChainRun 本身保持 status='running'
        → 排進 pendingResume 佇列（延遲幾秒後 re-fire，等 server 完全就緒）
      若 run.status === 'success'（意外：run 完成但 ChainRun 沒更新）
        → 視為完成，直接推進 _runNextStep
      若 run.status === 'failed'
        → finalizeChain('failed', run)（補送通知）
```

**結果**：重啟後，已成功的步驟（status='success'）不重做；被打斷的步驟重新從頭執行那一步。

---

## 5. API 草案

| 端點 | 用途 |
|---|---|
| `GET /api/chains` | 列出所有 Chain（含每條「是否執行中」狀態） |
| `POST /api/chains` | 建立 Chain |
| `PUT /api/chains/:id` | 修改 Chain（名稱/步驟順序/delivery/deployAfterComplete） |
| `DELETE /api/chains/:id` | 刪除 Chain（執行中不可刪） |
| `POST /api/chains/:id/run` | 手動觸發 ChainRun（防重入：已跑中回 409） |
| `GET /api/chains/:id/runs` | 某 Chain 的 ChainRun 歷史 |
| `GET /api/chain-runs/:id` | 單次 ChainRun 詳情（步驟狀態＋每步 runId） |

Workspace 隔離：沿用 `resolveWorkspace(req)` + chain.workspace 過濾，與 Schedule 同 pattern。

---

## 6. 決策摘要（已全數鎖定）

| # | 問題 | 決定 |
|---|---|---|
| Q1 | 步驟來源 | **v1 只引用現有 Schedule**；inline 任務未來再加 |
| Q2 | 部署策略 | **Defer-deploy**：步驟執行時注入「請勿部署」prompt；整鏈完成後統一部署一次（`deployAfterComplete` 預設 true） |
| Q3 | 觸發方式 | **手動觸發（v1）**；Chain cron 未來再加 |
| Q4 | 限流等待 | **靜候**，等 SCHED-07 自醒後繼續；不視為失敗 |
| Q5 | 失敗處理 | **全鏈 fail-fast**；v1 無「on-failure: continue」例外 |
| Q6 | 通知策略 | **步驟通知壓制**（inChain=true 時跳過 run delivery）；整鏈完成/失敗才發一則整體通知 |

---

## 7. UI 草案（網頁）

排程面板旁新增「🔗 任務鏈」分頁（或在排程面板下方新增區塊）：

**清單**：名稱 ｜ 步驟數 ｜ 最近一次執行狀態 ｜「執行」按鈕（執行中 disabled + 脈動徽章）

**建立/編輯 Chain**：
1. 名稱
2. 步驟列表：從現有 Schedule 選取並拖拉排序
3. 「完成後部署」勾選框（`deployAfterComplete`，預設勾）
4. 整鏈完成通知（delivery，沿用 H7 的 checkbox 設計）

**執行進度**：
- ChainRun 詳情 modal：垂直時間軸，每步顯示 label ｜ 狀態圖示（⏳/✅/❌/—） ｜ 對應 Run 的開始/結束時間
- 步驟圖示可點→連結到該 Run 的逐字稿（沿用 M2 唯讀 log 設計）

---

## Changelog

| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-30 | v0.1 | 老闆 + Hana | 初版設計草案。資料模型（Chain/ChainRun）、執行架構（onComplete callback 推進）、斷點續跑、重啟策略兩選項、API 草案、UI 草案、6 個開放決策。 |
| 2026-06-30 | v1.0 | 老闆 + Hana | 決策全數鎖定。採 Defer-deploy：步驟注入 suppress-deploy/suppress-delivery；整鏈完成後統一部署一次（deployAfterComplete）。步驟通知壓制、鏈級單一通知。幂等性設計原則加入。 |
