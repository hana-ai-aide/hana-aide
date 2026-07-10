# SPEC — 多模型會議摘要 + 可對話修正（Multi-Model Meeting Summary）

> **Status**: Draft v1.0 ｜ **Owner**: 老闆 + Claude(Opus) ｜ **Date**: 2026-07-03
> **Relates**: `SPEC-meeting-transcriber.md`（STT/diarization 上游）、`SPEC-multi-model-panel.md`（共用「跑 N 模型」原語）、`cli-providers.json`（模型選單）

---

## 1. 動機

現行會議摘要（`meetingSummarizeToFiles` → `summary.md`+`actions.json`）有兩個問題：
1. **靜默失敗**：自動摘要是結束錄製時 **fire-and-forget**（`server.js` `finalizeMeetingSummary`），若當下 server 重啟（自癒部署打斷）、逐字稿未就緒、或 Claude 呼叫失敗 → **靜默跳過、無重試、無提示**。實測有場**逐字稿 1440 bytes 完整、卻連 `summary.md` 都沒有**。
2. **單一模型單一角度**：不同模型整理會議的角度不同（有的抓決議準、有的待辦全、有的條理清楚），單模型會漏。

**一個功能同時解**：把摘要升級成「**多模型集成 + 可靠 on-demand**」——多模型摘要本身就是新的摘要機制，順手把「沒摘要」的洞補掉。

---

## 2. 設計決策（與「深度思考」的關鍵區別）

**這是「交付物」不是「判斷題」** → 不需要深度思考那套（拜占庭、quorum、仲裁分歧）。摘要有「好壞」但不對立，多模型的價值只是**不同角度的整理** → **挑一版 or 彙整**即可。

| # | 決策 | 理由 |
|---|---|---|
| D1 | 多模型**集成**，不做分歧仲裁 | 摘要不是投票決定真相；並排看、挑或合就夠 |
| D2 | 兩種收尾：**挑一版** / **彙整**（主模型參考各版之長） | 彙整＝Mixture-of-Agents 的好處，但無仲裁複雜度 |
| D3 | **顯示模型品牌**（與深度思考的去標籤相反） | 你就是要比較它們，品牌是有用資訊 |
| D4 | 序列跑 N 模型（不並發） | 避開 CLI 並發搶 auth（同 `SPEC-multi-model-panel` D3） |
| D5 | 保留「結束自動跑一版預設模型」+「打開會議若無摘要就自動補」 | 保底：永遠至少一版，補掉靜默失敗 |

---

## 3. 共用原語：「跑 N 模型」（與 SPEC-multi-model-panel 共用）

深度思考與本功能**共用同一個底層**：對一個 prompt，**序列跑 N 個模型、回傳 N 份結果**。差別只在收尾（深度思考 diff 分歧；摘要挑/彙整）。

- 介面（建議）：`runModelsSequential({ prompt, models[], perTimeoutMs, wsRoot }) → [{ model, ok, output, elapsedMs }]`。
- 每個模型獨立 timeout、失敗棄權不重試（回 `ok:false`），湊到 ≥1 份即可收尾。
- 模型清單來源＝`cli-providers.json`（重用現有選單）。
- **本 spec 要求把這個原語抽成共用函式**（`render-service/` 或 server 內），deep-think 與 meeting-summary 都接它。

---

## 4. P1 — 多模型摘要（核心）

### 4.1 流程
1. 會議詳情「摘要」區的按鈕 → **多選模型**（cli-providers 選單；預設帶 1 個，可加選）。
2. `runModelsSequential` 對逐字稿各出一版 → 存 **`summary.<modelKey>.md`**（每模型一檔）。
   - prompt 沿用現行格式（`## SUMMARY` 三段【重點】【決議】【待辦】+ `## ACTIONS_JSON`）。
3. **UI 並排/分頁顯示 N 版**，各標**模型名 + 產生時間**。
4. **收尾（擇一）**：
   - **挑一版**：指揮官選最合的 → 該版寫入 `summary.md`+`actions.json`。
   - **彙整**：指定一個主模型（如 Opus）讀完 N 版 → 產出「參考各版之長」的最佳摘要 → 寫入 `summary.md`；`actions.json` = **N 版待辦的聯集去重**（最完整、漏項最少）。

### 4.2 可靠性（補掉「沒摘要」）
- **重跑允許**：已有摘要也能重跑，**覆蓋** `summary.md` 並更新時間戳（不因已存在而跳過）。
- **結束自動跑**：`finalizeMeetingSummary` 仍在，但改為跑**一版預設模型**（穩、便宜），確保永遠至少一版。
- **打開即自動補**：詳情開啟時偵測「有逐字稿但無 `summary.md`」→ 自動觸發一版預設模型摘要（lazy），並顯示「自動補摘要中…」。→ 舊的「有逐字稿沒摘要」會議一打開就補上。

### 4.3 來源與時間戳（provenance）
- `meta.json` 記 `summary` 區塊：`{ summarizedAt, models: [...], mode: 'single'|'pick'|'merge', chosenModel? }`。
- UI 明確顯示「**摘要於 <時間>、由 <模型> 產生（挑選/彙整）**」；每個 `summary.<model>.md` 也各自標時間，隨時能回去重看、重挑。

---

## 5. P2 — 對話式修正（Hana 頭像）

摘要/待辦/錯別字的微調常需人來改，且**改一處可能牽動整體** → 交給對話。

- 會議詳情加「**跟 Hana 討論此會議**」按鈕 → 開浮動頭像對話（`hana-overlay`），**把該會議的 context 帶入**：逐字稿 + 現行 `summary.md` + `actions.json`。
- 指揮官口語講「這裡錯別字、這個待辦改成…、決議寫錯」→ Hana 改 `summary.md`/`actions.json` 回寫。
- 因為改一處可能影響整體 → Hana 能**重新順一遍**（re-flow）整份摘要。
- 需要：一個「把會議 context 注入頭像對話 + 允許 Hana 回寫該會議 summary/actions」的通道（skill 或 chat 端的 meeting-scope）。

---

## 6. 資料模型
```
.harness/runtime/meetings/<meetingId>/
  transcript.txt / transcript.labeled.txt      # 上游（不變）
  summary.<modelKey>.md                          # 每模型一版（新）
  summary.md                                     # 收尾選定/彙整的版本（＝目前對外的摘要）
  actions.json                                   # 收尾的待辦（彙整＝聯集去重）
  meta.json → { …, summary: { summarizedAt, models[], mode, chosenModel? } }
```

## 7. 落地觸點
- **server.js**：`runModelsSequential` 共用原語；`meetingSummarizeToFiles` 升級成多模型（產 `summary.<model>.md`）+ 挑/彙整；新端點 `POST /api/meeting/:id/summarize`（帶 `{models[], mode, chosenModel?}`）；`finalizeMeetingSummary` 改預設單模型 + 保底。
- **index.html**：摘要區加模型多選 + 並排/分頁 N 版 + 挑/彙整鈕 + provenance 顯示 + 「跟 Hana 討論此會議」(P2)；詳情開啟 lazy 補摘要。
- **cli-providers.json**：重用（模型選單）。

## 8. 任務分解（對應 `.worktable/TASK.md`）

### P1
- `MTG-SUM-01` 共用原語 `runModelsSequential`（序列跑 N 模型、獨立 timeout、失敗棄權）。
- `MTG-SUM-02` `meetingSummarizeToFiles` 多模型化：產 `summary.<model>.md`；端點收 `{models[],mode,chosenModel?}`。
- `MTG-SUM-03` 收尾：挑一版 / 彙整（主模型參考各版）+ actions 聯集去重 → `summary.md`+`actions.json`+meta provenance。
- `MTG-SUM-04` 可靠性：重跑覆蓋+更新時間；`finalizeMeetingSummary` 預設單模型保底；詳情開啟 lazy 補摘要。
- `MTG-SUM-05` UI：模型多選、並排/分頁 N 版、挑/彙整鈕、「摘要於 X 由 Y 產生」provenance。
- 🧑‍✈️ 指揮官手動驗證（此關只由指揮官勾）

### P2
- `MTG-SUM-06` 「跟 Hana 討論此會議」：把逐字稿+現摘要+待辦注入頭像對話。
- `MTG-SUM-07` Hana 回寫 summary/actions + re-flow（改一處可重順全份）。
- 🧑‍✈️ 指揮官手動驗證（此關只由指揮官勾）

---

## Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-07-03 | v1.0 | 老闆 + Claude(Opus) | 初版。多模型會議摘要＝交付物集成（非判斷題，無仲裁/拜占庭）：選 N 模型→序列各出一版→挑一版/彙整（主模型參考各版、待辦聯集）；同時補掉「靜默失敗沒摘要」（重跑覆蓋+時間戳、結束保底單模型、打開 lazy 補）；與 SPEC-multi-model-panel 共用「跑 N 模型」原語；P2 對話式修正（頭像帶會議 context、Hana 回寫+re-flow）。 |
