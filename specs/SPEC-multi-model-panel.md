# SPEC — 深度思考合議（Multi-Model Deep-Think Panel）

> **Status**: Draft v1.0 ｜ **Owner**: 老闆 + Claude(Opus) ｜ **Date**: 2026-07-02
> **Series**: O（見 `.worktable/TASK.md §O`）
> **Relates**: `SPEC-resilient-cli.md`（本規格是其 Phase 2「multi-LLM relay」的實體化）、`SPEC-scheduler.md`、`SPEC-history-hygiene.md`（value-harvest）

---

## 1. 動機與一句話定義

一般對話 = Hana 用**一個**模型回答。但有些「判斷型／深度」問題，換個模型、甚至換個思考模式，答案就不一樣。**深度思考模式**讓 Hana 用**三種完全不同的思路**各想一次，再由指定模型把「共識核心 + 分歧點」用 **Hana 的第一人稱**整合出來，**分歧交由指揮官仲裁**。

**核心定位**：對指揮官而言，永遠是在跟**一個 Hana** 對話；三種模型只是她的三種內在思考模式。整合的目的**不是製造假共識，而是攤開分歧**（diff，不是 merge）。

---

## 2. 設計決策（討論已拍板，逐條為實作紅線）

| # | 決策 | 理由（勿在實作時擅自推翻） |
|---|---|---|
| D1 | **人是最終仲裁者**，系統不做自動裁決 | 砍掉最易出錯的「機器裁判 / 拜占庭加權 quorum」；把裁決交給可信神諭（人），放寬了中間每一步的精度要求 |
| D2 | **每個 CLI 只問一次、單輪**，不做辯論回合 | 回合制會引發 LLM 的「群體盲從（sycophancy）」，把要保留的多樣性洗成一團；且不封頂的回合在「查不到額度 + 會 FREEZE + agy 冷啟動不穩」的底座上不可靠 |
| D3 | **全程序列執行**，同一時刻只有一個 CLI 活著 | 真正的技術瓶頸是**並發**（搶 auth／負載觸發 FREEZE），不是模型數量。序列化幾乎消除該瓶頸；代價是牆鐘變慢，對「手動勾選、少用」的深度思考可接受 |
| D4 | 整合者只做 **diff**，**禁止調解成共識**，且**必附原始三份答案** | 整合的價值是「幫指揮官省閱讀量、直指斷層線」，不是把分歧藏起來 |
| D5 | 整合輸出用 **Hana 第一人稱**；對外隱藏模型品牌，對內保留歸屬 | 對話對象是一個 Hana；品牌對指揮官無意義，且會造成偏袒。內部歸屬保留供除錯／慣性離群降權 |
| D6 | 預設 3 個思路（可選 4）；不強制湊滿 | 3f+1=4 的拜占庭容錯是為了讓**機器**扛叛徒；既然人來裁決，3 個就夠 |

### 2.1 拜占庭將軍問題（BGP）借用的三條規則
本設計借用 BGP 的**特徵**（部分節點會自信地答錯、需在不可靠參與者中做可靠決策），但因 D1 把裁決交給人，只保留三條有用的：
- **BR-BGP-1 獨立來源加權**：若兩個思路來自**同家族模型**（例：Claude CLI 的 Opus + Antigravity 的 Claude Opus 4.6），它們可能產生**相關性錯誤**，整合時視為 ~1 個獨立意見，不得讓「同家族兩票一致」自動壓過異質模型的異議。
- **BR-BGP-2 高風險觸發外部驗證，而非再投一輪**：可驗證的事實分歧（能跑測試／查文件的），優先用外部驗證當「可信神諭」，勝過任何投票。
- **BR-BGP-3 慣性離群降權**：長期追蹤「哪個模型老是離群」（靠對內保留的歸屬），逐步降權。（v1 只記錄歸屬，降權為 Phase 2。）

---

## 3. 執行流程（全序列，4 次呼叫）

以指揮官預設組合 Opus / Gemini / Codex 為例（**剛好一 CLI 各一個 → 思考階段零「同 CLI 雙叫」**）：

```
1. Opus  思考   → answer_O    (Claude CLI)   ← 必須先獨立完成，勿在看到別人前作答
2. Gemini 思考  → answer_G    (agy)          ← 序列，不與上一步並發
3. Codex 思考   → answer_C    (codex CLI)
4. Opus  整合   → Hana 口吻：共識核心 + 分歧地圖   (Claude CLI，第二趟)
   ├─ 三份原始答案存後台，UI 可展開
   └─ 順帶輸出 memory 候選（worthy? + frontmatter 草稿，等指揮官核准）
   → 交給指揮官仲裁
```

- **總呼叫數 = N + 1**（3 思路 = 4 次；4 思路 = 5 次）。這是達成目的的理論最小值。
- **Opus 跑兩趟**：第 1 趟是「思考者」（它的一票，須先獨立完成並存檔）；第 4 趟是「整合者」。**不可**把「作答＋看別人＋整合」壓成一次呼叫，否則 Opus 失去獨立觀點，退化成兩票＋一整理員。
- **整合去標籤**：第 4 趟給整合者三份答案時，**不標明哪份是它自己寫的**，逼它憑內容 diff（緩解球員兼裁判偏誤）。
- **優雅降級**：任一思路 timeout／agy 冷啟動失敗 → 當該票**棄權**，湊到 ≥2 份仍可整合，**不重試迴圈**（接 `SPEC-resilient-cli.md` 的 honest-detection）。
- **同 CLI 若被選兩次**（例：agy 同時跑 Gemini + Claude Opus 4.6）：該 CLI 的兩次呼叫**排隊序列化**，不得並發搶 auth。

---

## 4. 資料模型（向後相容，零遷移）

### 4.1 現況（已支援「逐訊息記模型」）
`chat_<sessionId>.json` = `{ sessionId, title, origin, filePath, updatedAt, messages[], trace }`（`server.js` `saveChatSession`）。
每則 assistant 訊息 = `{ role:'assistant', content, meta:{ provider, model, elapsedMs, ... } }`。**model 存在每則訊息的 `meta` 裡**，「目前用哪個模型」由最後一則 assistant 訊息推導（`index.html` 約 L7747）。

> **結論**：同一對話裡「切模型 / 切深度思考 / 再切回單模型」**現在就已支援**——每則訊息各自記模型。深度思考只是**多一種訊息形態**混在同一個扁平 `messages[]` 裡。

### 4.2 深度思考訊息 = 一則 assistant 訊息，額外資料塞進 `meta`
**紅線：`messages[]` 保持扁平、不新增巢狀層級**；深度思考的一切額外資料放進 `meta`（舊程式忽略的物件）→ 向後相容。

```jsonc
{
  "role": "assistant",
  "content": "（Hana 第一人稱整合：共識核心 + 分歧地圖）",   // ← 舊渲染器只讀這個，照樣顯示
  "meta": {
    "provider": "claude", "model": "opus", "elapsedMs": 12345,  // ← 沿用現有欄位（= 整合者）
    "mode": "deepthink",                                         // ← 判別旗標；缺此欄 = 一般單模型 turn
    "panel": [                                                   // ← 三種思路全記在檔（D4 要求）
      { "angle": 1, "provider": "claude", "model": "opus",           "content": "...", "status": "ok" },
      { "angle": 2, "provider": "agy",    "model": "gemini-3.5-pro",  "content": "...", "status": "ok" },
      { "angle": 3, "provider": "codex",  "model": "gpt-5.5",         "content": "...", "status": "abstained" }
    ],
    "divergence": [ { "topic": "...", "positions": [ { "angle": 1, "stance": "..." }, { "angle": 3, "stance": "..." } ] } ],
    "integrator": { "provider": "claude", "model": "opus" },
    "memoryCandidate": { "worthy": true, "draft": "---\nname: ...\n---\n..." }
  }
}
```

- **無 `meta.mode`** = 一般單模型 turn（現況）→ 舊資料自動歸此類，**零遷移**。
- **`meta.mode==='deepthink'`** = 新渲染器才觸發特殊呈現。
- **對話層旗標**：`chat_<sessionId>.json` 頂層加 `deepThink: true`（存檔時算好，側欄列表 O(1) 不用掃 messages）；真值來源可由「任一訊息 mode==='deepthink'」推導。

---

## 5. 兩條「隱形但會弄壞」的規則

### R1 — 回灌 context 時只放整合結果，不放三份 panel
下一輪對話會把前文寫進 `context_<sessionId>.md` 再餵回模型（`writeContextFile`）。深度思考 turn 若把三份 panel 全灌回去 → token 爆炸 + 噪音。
**規則**：`writeContextFile` 序列化深度思考訊息時**只取 `content`（整合結果）**；`panel` 只為「檔案存證 + UI 展開」存在，不進未來輪次。

### R2 — 只在整輪完成才落檔；進行中顯示進度但不寫半截
深度思考是 4 次序列呼叫、耗時較久。
**規則**：UI 顯示「思路 1/3…」進度，但 **history 只在 4 步全完成後存一則完整訊息**（沿用現有「clean finish 才 save」）。中途中斷不可污染 history；partial 捕捉接 `SPEC-resilient-cli.md`。

---

## 6. 前端 / UX

### 6.1 觸發
- 聊天輸入區一個「🧠 深度思考」toggle。勾起後跳出模型選單（即現有模型下拉的多選版），**選 3 或 4 個思路**（預設帶一個「多樣性優先」preset：Claude 家族 / GPT・Codex 家族 / Gemini 家族至少各一）；可存自訂 preset。
- 送出後，該 turn 走深度思考流程；下一則訊息若關掉 toggle，即回到單模型——**同對話可自由混用**。

### 6.2 渲染（`appendMessageToUI(role, text, trace, meta, turns)`，`index.html` 約 L8335）
`meta.mode==='deepthink'` 時新增分支：
1. **🧠 高亮**：訊息氣泡加 badge + 有色邊框（要「一眼可見」，不只換字色）。
2. **主氣泡**顯示 `content`（Hana 整合）。
3. **可展開區塊**：顯示 `meta.panel` 三種思路，**對外標「角度一/二/三」**（或性格化：務實／嚴謹／發散），**隱藏模型品牌**；棄權的思路標「（此角度未回應）」。
4. **分歧點**視覺強調（供指揮官仲裁）。

### 6.3 側欄
用過深度思考的對話（`deepThink:true`）在歷史列表加 **🧠 記號**。

### 6.4 回歸測試（不可破版）
- ① 純舊對話（無 `meta.mode`）。
- ② 單模型與深度思考 **混在同一對話**。
- ③ 對話**中途切模型**。
三者渲染都不得破版。

---

## 7. 完成後 → memory 候選（接 value-harvest）
整合者（第 4 趟）在**同一次**輸出裡多帶：① 一句話結論 ② memory-worthiness 判定（yes/no + 若 yes，附建議 frontmatter 草稿）。
**memory 不自動寫入**——列為候選，等指揮官核准（沿用 `SPEC-history-hygiene.md` 的「指揮官核准少數」紀律）。

---

## 8. 已知邊界 / 待決
- `chat_history` 目錄 **git-ignored、per-machine**（`server.js` 約 L3196）。三份思路記在該 json 檔 = 符合「記在檔案裡」，但**不進 git、換機不帶走**。若要可攜/長期保存，需另落到 workspace 內可追蹤位置（**Phase 2 決策**）。
- BR-BGP-3 慣性離群降權 = **Phase 2**（v1 只保留歸屬、不降權）。
- 4 思路且含同家族時的 BR-BGP-1 加權，v1 僅在整合 prompt 以文字約束；正式加權演算法為 Phase 2。

---

## 9. 任務分解（對應 `.worktable/TASK.md §O`）

### O1. 後端：序列合議引擎
- `DTP-O1-01` 深度思考 job runner：接收 N 個模型 + prompt → **序列**跑 N 次思考（獨立 timeout、失敗棄權不重試、同 CLI 序列化）→ 收集 `panel[]`。
- `DTP-O1-02` 整合步：以指定整合者（預設 Opus）跑第 (N+1) 趟，輸入三份**去標籤**答案 → 產出 Hana 口吻 `content` + `divergence[]` + `memoryCandidate`。
- `DTP-O1-03` 落檔：組出 §4.2 的 `meta`（含 `mode/panel/divergence/integrator/memoryCandidate`）+ 頂層 `deepThink:true`；**只在整輪完成才存**（R2）。
- `DTP-O1-04` `writeContextFile` 只序列化整合 `content`（R1）。

### O2. 前端：觸發 + 渲染
- `DTP-O2-01` 「🧠 深度思考」toggle + 多選模型選單（3/4 選，preset）。
- `DTP-O2-02` `appendMessageToUI` 深度思考分支：高亮 + 可展開三思路（去品牌）+ 分歧強調。
- `DTP-O2-03` 進行中進度「思路 k/N…」（不污染 history）。
- `DTP-O2-04` 側欄 `deepThink` 🧠 記號。
- `DTP-O2-05` 回歸測試三情境（§6.4）不破版。

### O3. memory 候選串接
- `DTP-O3-01` 整合輸出的 `memoryCandidate` → 依 value-harvest 列為待核准候選（不自動寫）。

---

## Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-07-02 | v1.0 | Claude(Opus) | 初版。序列單輪合議 + Hana 第一人稱 diff 整合 + 人工仲裁；資料模型向後相容（meta 擴充、零遷移）；兩條隱形規則（R1 context 只回灌整合、R2 完成才落檔）；BGP 借用三規則。 |
