# SPEC — 排程狀態語意（Schedule / Run Status Semantics）

> 規格版本 v0.1（2026-07-08 起草，待指揮官拍板）
> 關聯：`specs/SPEC-scheduler.md`（排程系統本體）、`.worktable/TASK.md §Y`
> 觸發事件：Excel 匯入 Phase 2 那筆 run 只跑 58s、依前置護欄「Phase 1 未驗收就停」空手回報，
> 卻在網站排程面板顯示**綠色 ✅ 成功** → 指揮官誤以為「做完且成功」。**綠色成功不該涵蓋「跑完但沒動工」。**

---

## 1. 問題（根因）

`portal/server.js` 的 `onComplete` 目前用**二元判定**決定 run 狀態：

```js
const isFailed = !ctx.result || ctx.result.startsWith('❌');
const status   = isFailed ? 'failed' : 'success';
```

只要 agent 有產出、且開頭不是 ❌ → 一律 `success`（綠 ✅）。

但 agent 可能**乾淨地跑完、卻刻意沒做任何事**——例如撞到自己 prompt 裡的前置護欄
（「相依的上游任務未驗收 → 停下回報、不硬做」）。這種「合法的不動工」產出的是一份**非 ❌ 的說明文字**，
於是被判成 `success`。結果：**面板綠燈、看板像完工，指揮官不知道它其實停在那等你。**

一句話：**目前的狀態機分不出「做完了」與「跑完但沒做」。**

---

## 2. 現有狀態盤點（改動前的事實）

Run 層狀態（`onComplete` / `_fireJob` 寫入 run 記錄）與 UI 呈現：

| status | 中文 label | 顏色（`STATUS_BADGE` / `statusIcon`） | 語意 |
|---|---|---|---|
| `running` | 執行中 | 藍 · 🔄 | 進行中 |
| `success` | 成功 | **綠** · ✅ | 完成、有產出 |
| `failed` | 失敗 | 紅 · ❌ | 崩潰／`❌` 開頭／無產出 |
| `limited-waiting` | 等待續跑 | 黃 · ⏳ | 撞 API 限額，**系統會自醒續跑，不用你動** |
| `interrupted` | 中斷 | 橘 | 伺服器重啟把 run 砍掉（機器問題） |
| `aborted` | 中止 | 🛑 | 你手動按停 |

Schedule 層 `lastRunStatus` = 最後一次 run 的 status，經 `STATUS_BADGE[lastRunStatus]` 上色。

UI 落點（實作要一起改的地方）：
- `portal/index.html` `STATUS_BADGE`（≈ line 7026）— 徽章底色/字色
- `portal/index.html` `statusIcon`（≈ line 6987）— emoji 圖示
- `portal/index.html` schedule 卡片 `lastRunStatus` 徽章（≈ line 7078、7157）
- `portal/server.js` `onComplete`（≈ line 5501）— 狀態判定
- `portal/scheduler.js` `recordRunOutcome`（line 419）— 熔斷計數
- `portal/telegram.js` — 回報摘要文案（若有依 status 分流）

---

## 3. 設計：新增狀態 `blocked`（受阻·待你）

### 3.1 語意
> **agent 跑完、沒崩，但刻意沒完成任務**——因為前置條件／相依任務／核准未滿足，
> 它依約定停下、等一個人類決定或上游完成。**不是成功（沒有交付產出）、也不是失敗（什麼都沒壞）。需要你看一眼並做決定。**

典型場景：
- 前置護欄擋下（本次 Excel Phase 2）
- 等指揮官核准才能繼續的破壞性動作
- 相依的上游排程尚未完成／未驗收

### 3.2 顏色與標籤（本規格要指揮官拍板的重點）
| 屬性 | 值 | 理由 |
|---|---|---|
| status key | `blocked` | |
| 中文 label | **「⚠ 受阻·待你」**（徽章）／動態列「未動工·待處理」 | 一眼看出「要你介入」 |
| 圖示 | ⚠️ | 警告，非成功 |
| **字色** | **琥珀 amber**：`text-amber-600 dark:text-amber-400` | 見下方色彩推理 |
| 底色 | `bg-amber-100 dark:bg-amber-900/30` | |

**為什麼選 amber ⚠ 而不是別的顏色**（回答指揮官「什麼顏色比較合理」）：
- **不能是綠**：綠 = 完成／成功，正是要打掉的誤導。
- **不用紅**：紅 = 出錯／崩潰。這裡什麼都沒壞，用紅會讓人以為系統爆了、也會不必要地觸發「失敗」焦慮。
- **不用黃（limited-waiting 已佔）**：黃在本系統代表「系統會自己續跑、你不用動」——語意相反（那是不用理它，這是**要你動**）。
- **不用橘（interrupted 已佔）**：橘 = 伺服器重啟中斷（機器問題）。blocked 是**流程刻意停下等人**，不是崩潰。
- **選 amber + ⚠**：琥珀是通用「警告／待處理」色，配 ⚠ 圖示與粗體 label，在一排徽章裡最能喊「看我、我在等你」，且與黃/橘語意清楚切開。

### 3.3（開放決策，B 項）可選的第二個狀態 `noop`／`skipped`
有一種「跑完沒做事」是**良性**的：agent 正確判斷本來就沒事可做（例：每日 Gmail 掃到 0 封垃圾、沒有新 issue）。
- 這不該是綠（避免假裝有做事），但也不是 amber 警告（不用你動）。
- 建議：**灰/slate**（`text-slate-500 bg-slate-100 dark:bg-slate-800`）、圖示 「—」或 「∅」、label「無事可做」。
- **是否本期一起做，請指揮官拍板**（見 §7）。先把 `blocked` 做起來就能解決當前痛點；`noop` 是加分項。

---

## 4. 偵測機制：agent 自我標記（`<run-outcome>`）

系統**無法**自行分辨「跑完有做」與「跑完沒做」——兩者都產出非 ❌ 文字。
必須由 **agent 在輸出裡自報**。沿用既有 `<memory-candidate>` 區塊在 `onComplete` 被解析的**同款 pattern**（server.js:5524-5529），零新機制。

### 4.1 標記格式
agent 在「刻意沒動工就停下」時，於報告**最後**附一行機器可讀標記：

```
<run-outcome status="blocked" reason="Phase 1 尚未經指揮官驗收，依前置護欄停止、未動工" />
```

- `status`：`blocked`（或未來的 `noop`）。
- `reason`：一句話，會存進 run 記錄、顯示在面板/回報摘要，讓指揮官不點開就懂為何卡住。

### 4.2 server 端解析（`onComplete`）
在 `onComplete` 內、**算 `isFailed` 之前**（緊接現有 `<memory-candidate>` 剝除段）新增：
1. 用 regex 抓 `<run-outcome status="…" reason="…" />`，抓到就從 `ctx.result` 剝掉（不進存檔 transcript）。
2. 若 `status ∈ {blocked, noop}` → **覆蓋**原本算出的 `success`（`failed` 不覆蓋——真的壞了優先）。
3. 把 `reason` 寫進 `runPatch.error`? 不——另存 `runPatch.outcomeReason`（`error` 語意是錯誤）；delivery summary 用 reason。

### 4.3 熔斷計數（`recordRunOutcome`）
`blocked` / `noop` **不是失敗**：
- 不歸零 `consecutiveFailures`（它沒成功，不該假裝進度）。
- 也**不累加** `consecutiveFailures`（它沒壞，不該推向熔斷）。
- 即把 `blocked`/`noop` 加入現有 `limited-waiting` 那條「不計入熔斷」分支（scheduler.js:427）。

### 4.4 慣例落點（讓 agent 真的會標）
- `/task` skill、以及任何「前置護欄 → 停下回報」的 prompt 慣例：加一句
  「**當你沒做事就停下時，報告結尾務必附 `<run-outcome status="blocked" reason="…" />`**」。
- 本規格與 `SPEC-scheduler.md` 互相連結，作為日後所有排程 prompt 的共同約定。

---

## 5. 回溯修正：把 Excel Phase 2 那筆改成 `blocked`

觸發本規格的那筆 run（schedule `sched_1783434829644_x0bd`「Excel 匯入 · Phase 2」的最近一次 run）目前存成 `success`。實作時一併：
- 找到該 run 記錄，`status` `success → blocked`、補 `outcomeReason`「Phase 1 未經指揮官驗收，依前置護欄停止、未動工」。
- 該 schedule 的 `lastRunStatus` `success → blocked`（用 `recordRunOutcome` 或直接改 `schedules.json`，注意 workspace 欄位不動）。
- 讓面板/動態列該筆立刻顯示 amber ⚠「受阻·待你」，指揮官一看就懂它其實沒做。

---

## 6. 驗收（DoD）

- [ ] 造一筆會「自我護欄停下」的測試 run（或用 mock `ctx.result` 帶 `<run-outcome status="blocked">`）→ run 記錄 `status=blocked`、非 success。
- [ ] 面板/動態列該筆顯示 **amber ⚠「受阻·待你」**，**不是綠色成功**；hover/展開看得到 reason。
- [ ] `<run-outcome>` 標記**不出現在**存檔 transcript / 回報摘要正文。
- [ ] `blocked` **不動** `consecutiveFailures`（不歸零、不累加）——不誤觸熔斷、也不假裝成功。
- [ ] 一般成功 run（無標記、非 ❌）仍照舊綠 ✅；真失敗仍紅 ❌ ——**未回歸**。
- [ ] Excel Phase 2 那筆回溯改成 blocked、面板正確顯示。
- [ ] `Deploy_Harness.ps1` 冒煙通過。

---

## 7. 開放決策（等指揮官拍板）

1. **`blocked` 顏色**：採本規格建議的 **amber ⚠**？（預設 yes）
2. **是否本期一起做 `noop`（灰·無事可做）**？還是只先做 `blocked`、`noop` 之後再說？（預設：先只做 blocked）
3. **中文 label 用詞**：徽章「⚠ 受阻·待你」／動態列「未動工·待處理」——用詞可換（例：受阻／待處理／已停下等你）。
4. **Telegram 回報**：blocked 的推播要不要**特別醒目**（例：標題加 ⚠、或只在 web 顯示不吵手機）？（預設：照 schedule.delivery，摘要文案改成「⚠ 未動工：<reason>」）
