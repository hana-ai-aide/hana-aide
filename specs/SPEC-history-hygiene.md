# SPEC — 歷史整理與排程紀錄治理（History Hygiene）

> 狀態：定稿（開放決策已於 2026-06-30 拍板，見 §7）
> 作者：Hana ・ 2026-06-30
> 關聯：[[SPEC-scheduler]]（排程 run／notification 資料模型）、`portal/server.js`（chat_history、saveChatSession）、記憶系統（`/memory` → applyMemoryOps）

## 0. 問題（指揮官語言）

歷史列表把「我跟 Hana 的真人對話」和「排程任務的執行紀錄」混在同一條清單，難找東西；
排程很多是把 Hana 當 sub-agent 的一次性任務、加上例行排程每跑一次多一筆，越積越多。
要的是三件事：(1) 分得出來、能篩選，排程標題要清楚；(2) 排程紀錄能清理、不無限累積；
(3) 清理前先讓 Hana 判斷哪些值得記住、定期彙整少數精華給指揮官審，點頭的入記憶，其餘安心清掉。

## 1. 現況根因（survey 結論）

- 排程執行：`fireScheduledJob()`（server.js）以 `sessionId = 'sched_' + run.id` 跑，完成時 `respondChat → saveChatSession()` 在**同一個** `<ws>/.harness/runtime/chat_history/` 寫 `chat_sched_<runId>.json`。
- 列表：`GET /api/chat/history → getChatHistories()` **無差別**讀所有 `chat_*.json`；session 物件無 `origin` 欄；標題＝第一則 user 訊息截 30 字 ⇒ 排程標題又長又雷同。
- 排程另有獨立資料：scheduler 的 `runs/`、`artifacts/`（transcript）、`notifications.json`。`chat_sched_` 屬副本性質。
- 目前**無任何清理／保留策略**；workspace 隔離已是既有鐵則（scheduleId → schedule.workspace，`path.resolve` + 小寫正規化，null=harness home）。

## 2. 設計總則

1. **一筆 session 帶 `origin`**：`human`（真人對話）或 `schedule`（排程）。schedule 另帶 `scheduleId / scheduleName / runId / trigger / status`。
2. **完全分流，不用篩選（拍板 D1/D2）**：對話側欄**只保留真人對話**；排程紀錄整個移出對話側欄，改掛到**它所屬的排程底下**，做成**可收合的唯讀 log**——一個排程一條、展開看每次執行（一行一筆：時間＋狀態）、點開單筆看 prompt＋回覆。排程紀錄一律唯讀、不可在對話側欄續聊。
3. **清理安全閥**：自動清理只動「排程」紀錄、只動「當前工作區」、且**永不清掉「尚未審過且被判定有價值」的 run**與 pending-resume / limited-waiting 的 run；真人對話一律不自動清。
4. **價值沉澱走既有記憶管線**：審核通過的精華，經現有 `/memory`（applyMemoryOps）寫入對應記憶檔，不另造一套記憶儲存。

## 3. Part 1 — 分流：真人歸對話側欄、排程歸排程底下

### 3.1 資料模型
- `saveChatSession()` 寫入時補 `origin` 與（排程時）`schedule` 區塊（`scheduleId / scheduleName / runId / trigger / status`）；來源由 `fireScheduledJob` 經 ctx 傳入（不靠猜）。
- 既有檔向後相容：讀取時若無 `origin`，以 `sessionId.startsWith('sched_')` 推導，免遷移。
- 排程紀錄的標題不再用 prompt 截字；每筆顯示「時間＋狀態」，分組歸屬靠 `scheduleId`。

### 3.2 API
- `GET /api/chat/history`：**只回 `origin==='human'`** 的 session（排程紀錄不再進這條清單）。維持 workspace 隔離（沿用 `resolveWorkspace`）。
- 排程紀錄改由排程面提供：`GET /api/schedules/:id/runs`（或現有 runs API 擴充）回傳該排程的 run 清單（時間／狀態／runId），**沿用既有 scheduleId→workspace 隔離 pattern**（[[SPEC-scheduler]] 鐵則）。
- 單筆 run 的 prompt＋回覆內容：沿用既有 `chat_sched_<runId>` 讀取（`GET /api/chat/session/:id` 之類），唯讀。

### 3.3 前端
- **對話側欄**：移除所有排程項，只列真人對話。不需要篩選切換。
- **排程面**（既有排程清單）：每個排程下方新增一個**可收合的「執行紀錄」唯讀 log**——
  - 收合態：一個排程一條（沿用排程卡片）。
  - 展開：列出該排程每次執行（一行一筆，時間＋狀態色 ✅/❌/⏳）。
  - 點單筆：開唯讀檢視，顯示該次 prompt＋回覆（不可續聊、不可編輯）。
- 工作區隔離：排程面本就只顯示當前工作區的排程，其 run log 自然隔離。

## 4. Part 2 — 清理（不無限累積）

> **清理範圍（拍板 D5）**：清理**只刪逐字稿**——即 `chat_sched_<runId>` 對話副本與 transcript artifact；**scheduler 的 run 統計一律保留**（成功率／歷史曲線不受影響）。被清掉的 run 在執行紀錄 log 仍可見一行（時間＋狀態），只是點開時顯示「逐字稿已清理」。

### 4.1 手動清理（先落地，立即可用）
- 在排程的「執行紀錄」log 提供批次清理：可選「早於 N 天」「整個排程」「僅例行（無價值候選）」等條件，刪除其逐字稿。
- 後端 `DELETE /api/schedules/:id/runs/transcripts`（帶過濾條件），workspace 隔離；只刪逐字稿、保留 run 統計（D5）。

### 4.2 自動保留策略（待 Part 3 的價值閘上線後才開啟自動刪）
- 每排程保留「近 30 天」或「最近 20 筆」**取較寬者**（拍板 D7），其餘逐字稿為可清理候選。
- **永不自動清**：① 真人對話；② pending-resume / limited-waiting；③ 有「待審且被判有價值」候選的 run（Part 3 的閘）。
- 同樣只刪逐字稿、保留 run 統計（D5）。
- 執行點：排程器既有 tick 內的每日 housekeeping，或一條內建 housekeeping 排程；workspace 逐一處理。

## 5. Part 3 — 清理前先萃取價值

分兩段，兼顧「每跑完順手判斷」與「定期只審少數」：

### 5.1 每筆 run 的價值判定（就地產，拍板 D3）
- 排程 run 的執行 agent 在收尾時，就地輸出一段結構化判定（它本來就握有完整脈絡，最便宜、脈絡仍熱）：
  - 例行公事 ⇒ `noteworthy:false`（略過，不產候選）。
  - 有值得長期記住者 ⇒ 產一筆 `memory-candidate`：精煉一兩句洞見＋**Hana 建議落入的記憶桶**（D6）＋來源 runId/排程名。
- 候選寫入 sidecar（不污染 transcript），標記 `reviewed:false`。

### 5.2 定期彙整 + 指揮官審核（每週 + Telegram 輕推，拍板 D4）
- **每週**收集所有 `reviewed:false` 的候選，呈現於 portal「排程精華待審」清單：每條顯示洞見＋建議桶別＋來源 run 連結。
- 同時 **Telegram 輕推一則**：「本週有 N 條排程精華待審」＋連結，不展開內容、不轟炸。
- 指揮官逐條 **採用 / 丟棄**：
  - 採用 ⇒ 走既有 `/memory` 管線寫入對應記憶檔；桶別預設用 Hana 建議值、**指揮官可當場改**（D6：Hana 提桶別、指揮官確認）。候選標 `reviewed:true, accepted:true`。
  - 丟棄 ⇒ 標 `reviewed:true, accepted:false`。
- 審完的 run 解除「價值閘」保護 ⇒ 之後可被 §4.2 自動清理。
- 指揮官只需審那幾條，不必翻上百份。

## 6. 階段拆解（建議順序）

> 每個 phase 收尾固定保留一條「🧑‍✈️ 指揮官手動驗證」，只由指揮官勾。

- **H1 — 資料模型與分流地基**：session 帶 `origin`／排程結構化欄位；讀取向後相容推導；`GET /api/chat/history` 收斂為只回真人對話。（地基）
- **H2 — 分流 UI**：對話側欄移除排程項（只剩真人）；排程面新增「執行紀錄」可收合唯讀 log（一排程一條→展開列 run→點開看 prompt＋回覆）。（馬上能找東西、兩邊各歸各位）
- **H3 — 手動清理**：在執行紀錄 log 批次清理逐字稿（條件式、workspace 隔離、只刪逐字稿留統計）。（先給可控的清理）
- **H4 — 每筆 run 價值判定**：收尾就地產生 memory-candidate sidecar（例行＝略過）。
- **H5 — 定期彙整 + 審核 UI + Telegram 輕推**：每週待審清單 → 採用入記憶（Hana 建議桶別、可改）/ 丟棄。
- **H6 — 價值閘 + 自動保留策略**：未審且有價值的 run 受保護；其餘依「近 30 天或最近 20 筆取較寬者」自動清逐字稿。（H3 手動 + H6 自動＝完整治理）

依賴：H3 先給手動清理可用；**自動刪除（H6）必須等 H4/H5 的價值閘就緒**，避免把未審的價值一起丟掉。

## 7. 開放決策（已拍板・2026-06-30）

- **D1/D2 分流方式**：✅ **不用篩選**。排程紀錄移出對話側欄、掛到所屬排程底下做成**可收合唯讀 log**（一排程一條→展開列每次執行→點開看 prompt＋回覆）；對話側欄只留真人對話。
- **D3 價值判定機制**：✅ **就地產**——run agent 收尾時輸出結構化候選（脈絡仍熱、最便宜）。
- **D4 彙整頻率與通知**：✅ **每週**彙整 + portal 待審清單 + **Telegram 輕推**「有 N 條待審」（不展開、不轟炸）。
- **D5 清理範圍**：✅ **只刪逐字稿、保留 run 統計**（成功率/歷史曲線不受影響）。
- **D6 記憶落點**：✅ **Hana 建議桶別、指揮官審核時可改**（預設用建議值）。
- **D7 保留門檻**：✅ **近 30 天或每排程最近 20 筆，取較寬者**。

## 8. 附帶改進 — 排程通知偏好（H7）

> 與本治理同一塊（皆環繞「排程紀錄／通知」）。獨立於 H1–H6，無相依、可單獨上線。

### 8.1 問題（指揮官語言）
在 portal 自己新增排程時，沒有任何「要不要通知我／送到哪」的選項；結果從介面建的排程跑完都不發 Telegram，常常事後沒收到才發現。要的是：建立／編輯排程時能自選通知去處（站內、Telegram），且**預設就把 Telegram 開著**，沒特別設定也不漏接。

### 8.2 現況根因（survey 結論）
- 一筆 schedule 的通知去處存在 `schedule.delivery`（sink 名稱陣列，目前值域 `web` / `telegram`）。
- run 完成時 `flushRunDelivery` 依 `run.delivery.sinks` 投遞；該 sinks 來自 `fireScheduledJob` 寫入時讀 `schedule.delivery`，**缺省 fallback 為 `['web']`**（`server.js` 兩處：限額等待、完成），故只送站內、不送 Telegram。
- portal 的排程建立／編輯 modal（`index.html`）**完全沒有通知欄位**；建立 API 也未帶 `delivery` ⇒ 介面建出來的排程一律 `['web']`。（本治理自己建的 Part 1／Part 2 排程正是活標本。）
- `telegram` sink 由 `telegram.js` 於 bot 就緒時 `register('telegram', …)`；未配置時 `deliverOne` 回 `false`、靜默不送、不會炸 ⇒ 「預設勾 Telegram」對未設 bot 的環境也安全。

### 8.3 設計
- **表單**：排程建立／編輯 modal 新增「完成通知」欄位 —— 兩個可勾選項：站內（`web`）、Telegram（`telegram`）。**新建時預設兩個都勾**（至少把 Telegram 開著）；編輯時依該排程既有 `delivery` 回填勾選。
- **前端**：`schedSave()` 把勾選的 sink 陣列放進 payload `delivery`；`schedOpenModal(編輯)` 載入既有 `delivery` 還原勾選。至少保留站內或允許全空＝不通知（由實作定，預設不至於全空）。
- **後端**：`POST /api/schedules`、`PUT /api/schedules/:id` 接受 `body.delivery`，**白名單只允許 `web`/`telegram`、去重**；缺省（未帶 `delivery`）時 fallback 改為 `['web','telegram']`（預設開 Telegram），取代現行硬寫 `['web']`。
- **執行端 fallback 對齊**：`server.js` 兩處 `: ['web']`（限額等待、完成）一併改為 `['web','telegram']`，讓「沒存 `delivery` 的舊排程跑完也送 Telegram」成立（未設 bot 時靜默略過，安全）。
- **不批次回填既有排程資料**（避免動到歷史）；行為層面靠上述「預設值＋執行端 fallback」自然涵蓋舊排程。

### 8.4 小決策（已採安全預設、指揮官可推翻）
- **執行端 fallback 是否一併含 telegram**：採「是」——符合「沒特別設定也不漏」的明確要求，且未設 bot 時無副作用。若指揮官只想影響「新建表單預設」、不動既有排程行為，可改為僅改表單與建立 API、保留執行端 `['web']` fallback。

### 8.5 phase
- **H7 — 排程通知偏好**：modal 通知欄位（預設勾 Telegram）＋建立/編輯 API 收 `delivery`（白名單去重、缺省 `['web','telegram']`）＋執行端 fallback 對齊。獨立、可單獨上線。
