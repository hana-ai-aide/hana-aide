# SPEC — Document Templates / Generate-from-Template / Image Embed Editor（範本・範本生成・圖片嵌入編輯）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/index.html`（文件檢視器：新增文件入口、圖片 hover 編輯/更換、假圖佔位）、`portal/server.js`（範本/新文件/圖片上傳 API）、`global-knowledge/commands/`（`doc-template`、`doc-new` 兩支 skill）、各工作區 `.documents/.templates/`
> 動機（2026-06-28 老闆）：客戶解決方案文件有固定「家族」（如**情境流程**），每份結構大同小異。老闆要：① 讓 Hana **分析該家族所有文件、歸納出一個能涵蓋全部格式的範本**；② 之後給 Hana **一段說明**就能產出一份新文件——**全新從範本開始**或**從某份複製改寫**，Hana 依說明寫內容、**畫流程圖**；③ 文件編輯畫面能**插入/更換插圖**，互動比照現在的流程圖（hover → 右上浮現編輯鈕）；**空的「假圖」**可滑鼠移過去換成真圖，**真圖**也可移過去換掉。
> 串接：建立在 `SPEC-document-registry`（.documents 容器）、`SPEC-document-framework`（型別/動作列）、`SPEC-doc-editing`（md 為真身）、`doc-flowchart` skill（flow.json→bpmn）之上。
> ⚠️ 文件內任何 HTML 樣式標籤一律用反引號包（見 `TASK.md H1`）。

---

## 0. 三個部分（可分階段獨立做）
- **A. 範本系統**：Hana 分析某「家族」文件 → 產出**範本骨架**（`doc-template` skill）。
- **B. 範本驅動建立文件**：UI「新增文件」+ `doc-new` skill → 依說明從**範本**或**複製**生成新文件（含流程圖）。
- **C. 圖片嵌入編輯器**：編輯畫面 hover 換圖、假圖佔位（純前端 + 一支上傳 API，**不需 AI**，最先做、最快有價值）。

---

## 1. A — 範本系統

### 1.1 範本是什麼
**範本 = 一份「骨架 doc.md」**（延續 md 為真身的原則）：front-matter + 章節標題 + **佔位流程圖** + **假圖佔位** + **章節說明註解**（給 Hana 看的、告訴她每段該寫什麼）。不是死板 schema，是「填空題」。

### 1.1a 情境流程家族——真實歸納（來源：範例專案工作區 40 份 `doc.md` 結構統計）
章節順序固定、出奇地一致。核心 9 章（括號＝40 份中的出現次數）：

| 章節 | 出現 | 處理 |
|---|---|---|
| 目的 | 40 | 核心，必列 |
| 方案效益 | 40 | 核心，必列 |
| 應用情境流程與解決方案 | 40 | 核心；內含 `## 流程` + `## 解決方案說明` |
| 實施前提條件 | 39 | 核心，必列 |
| 變革點 | 40 | 核心，必列 |
| 驗收條件 | 40 | 核心，必列 |
| 其他系統對接需求 | 39 | 核心，必列 |
| 硬體需求 | 40 | 核心，必列（用詞分歧「硬體 30／硬件 10」→**統一「硬體」**） |
| 附錄 | 40 | 核心，必列 |

「應用情境流程與解決方案」內部：`## 流程`（35）或 `## 整體流程`（2）→ ```` ```bpmn ```` 流程圖 → `## 解決方案說明`（編號步驟，內嵌示意圖 `![](...)`，偶有子流程圖）。

**老闆拍板（2026-06-28）**：
1. **流程預設形狀**：**單一流程 + 註明「可複製成多段」**（多數文件是單一流程；要多段就複製該小節）。
2. **章節涵蓋**：**核心 9 章一律保留**，即使某文件該章沒有內容也**留標題、內文填 `N/A`**（不刪章節，維持家族結構一致）。
3. **用詞**：一律**正體中文慣例**——統一「硬體需求」「流程」。
4. **慣例 notes**：**要**（先只針對情境流程家族；其他文件家族未來再議）。

範本骨架（`.documents/.templates/情境流程.md`）：
```
---
type: doc
template: 情境流程            # 「情境流程」家族範本
---
# {{標題}}

## 目的
<!-- HANA: 一段話描述此情境要解決的問題與範圍；無內容則填 N/A -->

## 方案效益
<!-- HANA: 條列預期效益；無內容則填 N/A -->

## 應用情境流程與解決方案

### 流程
> ⚠️ 依說明繪製泳道流程圖。單一流程；若有多個流程，複製本「### 流程」小節成多段。
```bpmn
placeholder
```

### 解決方案說明
<!-- HANA: 編號步驟逐步說明；需示意圖處插假圖 ![說明](placeholder) -->
![畫面/產線示意圖](placeholder)

## 實施前提條件
<!-- HANA: 無內容則填 N/A -->

## 變革點
<!-- HANA: 無內容則填 N/A -->

## 驗收條件
<!-- HANA: 無內容則填 N/A -->

## 其他系統對接需求
<!-- HANA: 無內容則填 N/A -->

## 硬體需求
<!-- HANA: 無內容則填 N/A -->

## 附錄
<!-- HANA: 無內容則填 N/A -->
```

> **N/A 原則**：核心章節是家族的「骨架」，缺內容也不抽掉標題——讀者一眼看出「這份在此面向無特別需求」，也讓同家族文件可逐章對齊比較。

### 1.2 `doc-template` skill（歸納範本）
- 指揮官指定一個**家族**（給一組文件、或一個 sourcePath 目錄 pattern，如「情境流程_範例專案/」下全部）。
- Hana 讀那批 `.documents/<uuid>/doc.md`，**比對章節結構**，歸納出**涵蓋全部的超集**（某些文件有的章節也要納入，標為選填），輸出：
  - 範本骨架 `.documents/.templates/<家族>.md`（含上述佔位 + `<!-- HANA: … -->` 說明註解）。
  - （選填）`<家族>.notes.md`：家族慣例摘要（用詞、章節順序、流程圖泳道角色慣例…）給 `doc-new` 參考。
- 寫入 `.documents/.templates/index.json`（範本登錄）。

### 1.3 儲存
```
<workspace>/.documents/
  .templates/
    index.json                 ← 範本登錄（家族名、骨架路徑、產自哪些文件、時間）
    情境流程.md                 ← 骨架
    情境流程.notes.md           ← 家族慣例（選填）
```
- per-workspace（範本屬於該專案家族）。git 追蹤。

---

## 2. B — 範本驅動建立文件

### 2.1 入口（UI）
文件檢視器左上「**＋ 新增文件**」按鈕 → 對話框：
1. **來源**：◎ 從範本開始（選一個家族範本） / ◎ 從現有文件複製（選一份既有 doc，當作起點改寫）。
2. **文件名稱**（新檔名）。
3. **說明**（多行）：要 Hana 寫什麼內容、有哪些流程（描述流程步驟/泳道）、要哪些示意圖。
4. 送出 → 派工給 Hana（`doc-new` skill；可背景/排程跑，省互動額度）。

### 2.2 `doc-new` skill（生成）
輸入：來源（範本家族 or 既有 docId）、新檔名、指揮官說明。產出：新的 `.documents/<uuid>/`：
- **從範本**：複製骨架 → 依 `<!-- HANA: … -->` 與指揮官說明，**逐段填內容**；`placeholder` 流程圖**依說明用 flow.json→bpmn 畫出來**（複用 `doc-flowchart` 的 flow.json→`flow-bpmn.js` 流程）；需要示意圖處留**假圖佔位**（指揮官之後用 C 換圖）或依說明標注。
- **從複製**：複製來源 doc.md + assets → 依說明**改寫**（換情境、改流程、改數據）；流程圖同理重畫。
- 寫 front-matter（`type: doc`、`source`/`template` 來源註記）、註冊 registry、回報。
- **版本歷史**：建檔時呼叫 `appendDocHistory(id, { kind:'born', origin:'generated', by:'Hana', summary:'由範本 <家族> 生成' })`（`SPEC-document-registry §3a`）→ 清單顯示「生成」來源膠囊。圖片插入/更換（§2.3）等任何改 `doc.md` 的端點，亦各 append 一筆 `edit` 事件。

> 為何 Hana 生成而非樣板字串：客戶文件是語意內容，需理解說明、畫對流程——這正是 AI 的事（同 `doc-flowchart` 的判斷）。

---

## 3. C — 圖片嵌入編輯器（最先做，純前端 + 1 API）

> 互動比照現有 **流程圖嵌入**（`renderBpmnEmbedsIn` / 我新加的 `doc-pending-flow`）：hover → 右上浮現按鈕。

### 3.1 兩種圖、一致互動
| md 寫法 | 渲染 | hover 右上按鈕 |
|---|---|---|
| **假圖佔位** `![<說明>](placeholder)` | 虛線「假圖」框 + 顯示 `<說明>`（給人看「這裡要放什麼圖」） | **「插入圖片」** |
| **真圖** `![alt](assets/imageN.png)` | 正常 `<img>`（已有，走 `/raw`） | **「更換圖片」** |

- 在 `_resolveDocAssets`（或新增 `renderImageEmbedsIn`）渲染後處理：把每個 `<img>` 包進 `.doc-image-embed`（relative group），加 hover 浮現的按鈕；`src=placeholder` 的渲染成假圖框。
- 樣式沿用 `.bpmn-embed` 那套（`group relative` + `opacity-0 group-hover:opacity-100` 的右上鈕）。

### 3.2 換圖流程
1. 點「插入/更換圖片」→ `showOpenFilePicker`（圖片）或 `<input type=file accept=image/*>`（fallback）。
2. 上傳 `POST /api/documents/:id/image`（multipart 或 base64）：
   - 存進該文件 `.documents/<uuid>/assets/`，**唯一命名**（如 `img_<時間>.png`；不覆蓋既有）。
   - **改寫 doc.md**：把該位置的 `![…](placeholder)` 或 `![…](assets/舊.png)` 換成 `![<原說明/alt>](assets/<新檔>)`（伺服器端、用「第 N 張圖」定位，比照 flowchart-dismiss 的 doc.md 改寫）。
   - 回傳更新後 md → 前端重渲染。
3. 舊圖：更換後舊檔可保留（git 有歷史）或標記待清；預設保留。

### 3.3 定位（哪一張）
前端把每個 embed 標 `data-img-index`（doc 內第幾個圖，含 placeholder），上傳時帶 index + 目前 src；伺服器以「第 N 個 `![]`」在 md 定位改寫（同 `flowchart-dismiss` 的單張定位思路），避免同名/重複誤改。

---

## 4. 與既有 spec / skill 的關係
- `SPEC-document-registry`：新文件/範本都進 `.documents/`；範本在 `.documents/.templates/`。
- `SPEC-document-framework`：「新增文件」入口 + 圖片動作屬文件框架的一部分。
- `SPEC-doc-editing`：md 為真身；範本=骨架 md、生成=填 md、換圖=改 md。
- `doc-flowchart` skill：`doc-new` 畫流程圖複用其 flow.json→`flow-bpmn.js` 機制與泳道紀律。
- `doc-convert`：匯入仍是既有路徑；本案是「無中生有/從範本」這條新路徑。

---

## 5. 待拍板（先採預設、記錄，勿卡住）
1. **家族怎麼指定**：給一組文件 vs sourcePath 目錄 pattern？→ 先支援「指揮官在 `doc-template` 指令給 pattern 或清單」。
2. **範本佔位語法**：`{{變數}}` + `<!-- HANA: … -->` + `![](placeholder)` + ```` ```bpmn placeholder ```` → 先採此約定。
3. **新文件流程圖**：`doc-new` 當下就畫，還是先留 placeholder 再跑 `doc-flowchart`？→ 先**當下畫**（指揮官說明裡就有流程）；畫不出再留 placeholder。
4. **圖片上傳格式**：multipart vs base64？→ 先 base64（與既有 bpmnImages 一致、簡單）；大圖再轉 multipart。
5. **換圖後舊檔**：保留 vs 刪？→ 先保留（git 有歷史）。
6. **範本是否跨工作區共用**：先 per-workspace；要共用再加全域層。

---

## 6. 分階段路線（建議順序）
- **P1（✅ 已實作 2026-06-28，待部署）**：C 圖片嵌入編輯器——假圖佔位 `![說明](placeholder)`（虛線框 +「插入圖片」）+ 真圖 hover「更換圖片」+ `POST /api/documents/:id/image`（存進 assets/、改寫 doc.md 第 N 個 `![]`、保留 alt）。前端以全文 `![]` 序號定位、換完重渲染。
- **P2**：A `doc-template` skill——Hana 歸納「情境流程」範本骨架。
- **P3**：B 新增文件——「＋ 新增文件」UI（範本/複製 + 說明）+ `doc-new` skill（生成內容 + 畫流程圖）。

---

## 7. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-28 | v0.1 | 老闆 + Claude | 初版。三部分：A 範本系統（`doc-template` skill 歸納家族骨架，存 `.documents/.templates/`）、B 範本驅動建立文件（「＋新增文件」UI＋`doc-new` skill，從範本/複製＋說明生成內容與流程圖）、C 圖片嵌入編輯器（假圖佔位 `![](placeholder)`＋真圖 hover 更換，比照 bpmn 嵌入互動，`POST /api/documents/:id/image` 改寫 doc.md）。範本=骨架 md（填空題，含 `<!-- HANA: -->` 說明）。建議先做 C。 |
