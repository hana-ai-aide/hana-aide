---
name: doc-flowchart
description: 盤點文件管理裡某文件的「所有圖」，由 Hana 判斷哪些是流程圖→重建可編輯 BPMN、哪些不是→保留圖片
type: prompt
icon: workflow
---

# 任務：文件管理 — 由 Hana 判斷每張圖是不是流程圖，並收斂

匯入是**機械腳本**轉的（`docx-convert.py`），它**看不懂圖**：只憑「這是 EMF/WMF 向量圖」就把圖標成 `待補（人工/Hana）` + 空的 `_pending.bpmn`。這個機械標記**兩頭都會錯**：
- **過度標記**：把示意圖/資料樣態圖（不是流程圖）也標成待補。
- **漏標**：光柵截圖（PNG/JPG）的流程圖根本沒被標，留成普通 `![]`，永遠不會被重建。
- 指揮官手動標也可能標錯。

所以**機械/手動標記只是「提示」，你（Hana）才是「這是不是流程圖」的最終權威**。本 skill ＝ **盤點該文件的所有圖、逐張由你判斷、收斂到正確表示**（流程圖→可編輯 BPMN；非流程圖→保留圖片）。直接讀已抽出的單張 PNG，不必重讀整份 docx，快又省。

**要處理的文件**：`{{args}}`

> 可以是：registry `id`、文件檔名/`sourcePath`、`.documents/<uuid>` 路徑、或 `all`（掃所有文件）。
> 若 `{{args}}` 空 → **先列出**工作區 `.documents/*/doc.md` 各有幾張圖（含待補幾張、普通圖幾張），問指揮官要處理哪份，**不要亂猜**。處理一份時**一氣呵成、不要中途停**（除非某張看不清，見步驟 2）。
> 💰 這是**全圖稽核**（會讀該文件每張圖），量大；**建議用排程**（task.kind=`skill`）交給 Hana 背景批量跑，不佔指揮官互動額度。指揮官若只想處理待補的、要省一點，可說「只處理待補」→ 那就只讀 `_pending.bpmn` 那些。

> ⚠️ **路徑（不要寫死）**：腳本住在 **`HARNESS_HOME`**；客戶資料在**當前工作區**（cwd）。腳本路徑用 `HARNESS_HOME`、文件路徑用工作區相對路徑。文件真身在 `.documents/<uuid>/`（`doc.md` + `assets/`），**只動這裡**，別碰原始 docx。

---

## 步驟 0 — 讀持久化判斷（manifest，§13.13：省 token + 修正永久）

匯入是機械的、判斷很燒 token，所以**判斷結果要持久化**：一個工作區一份 `flow-decisions.json`（綁「來源檔身分 `sourcePath`」，**不綁 UUID** → 指揮官「從列表刪除 → 重匯（新 UUID）」也保住決策）。**先 bootstrap，再依它決定「哪些圖這次才要看」。**

```bash
node "$HARNESS_HOME/portal/render-service/flow-decisions.js" bootstrap "<工作區根>" "<docId>"
```
```powershell
node "$env:HARNESS_HOME\portal\render-service\flow-decisions.js" bootstrap "<工作區根>" "<docId>"
```
- 第一次跑：從現有 doc.md **唯讀推導**（真身 bpmn→`flow`、`_pending`/純圖→`undecided`），**不動 doc.md/bpmn/source**。
- 輸出 `decisions`（每張圖 kind）＋ `undecided`（**這次才要看圖的清單**）。

> 🔒 **鐵律：只看 `undecided` 的圖。** `flow`/`notflow` 已判過（或指揮官手動改過）→ 直接套用（見步驟 3），**不要重讀圖**——token 就省在這，人工 notflow 修正也不會被重判洗掉。**判完每張圖，立刻用 `set` 寫回 manifest**：
> ```
> node flow-decisions.js set "<工作區根>" "<docId>" imageN <flow|notflow> [--subflows 階段A,階段B] [--reason "…"] [--by Hana]
> ```
> `docId`＝registry `.documents/index.json` 裡該檔的 `id`；`工作區根`＝當前工作區（cwd）。

## 步驟 1 — 盤點該文件「所有」的圖

讀 `.documents/<uuid>/doc.md`，列出裡面**每一張圖**與它目前的狀態（對照步驟 0 的 manifest，**看圖只針對 `undecided`**）：

| 目前在 doc.md 的樣子 | 狀態 | 對應原圖 |
|---|---|---|
| `![](assets/imageN.png)` | 普通圖（**可能是漏標的流程圖**，也可能本來就是純圖） | `assets/imageN.png` |
| ```` ```bpmn assets/imageN_pending.bpmn ```` 或 body 版 | 機械標的**待補**（可能是流程圖、也可能被過度標記） | `assets/imageN.png`（把 `_pending.bpmn` 換 `.png`） |
| ```` ```bpmn assets/imageN.bpmn ```` （無 `_pending`） | **已重建**的真 BPMN | — |

- 待補 fence 兩種格式都要認：路徑在 info-string（`` ```bpmn assets/x_pending.bpmn ``）或在 body（下一行）。
- 「已重建的真 BPMN」**略過**（已完成）。
- 找文件：`{{args}}` 對 registry `.documents/index.json` 的 `sourcePath`（檔名）/`id`，或直接給的路徑。

## 步驟 2 — 逐張讀圖、由你判斷流程圖 vs 非流程圖

對盤點到的每張圖（**待補的 + 普通 `![]` 的都要看**——漏標就是藏在普通圖裡），用 **Read 工具實際打開** `assets/imageN.png` 判斷。

> 🔍 **若原圖極小／空白／破圖（如 18×20px）**：那是 Word 內嵌 **OLE/Visio 物件**，mammoth 只抽到「佔位 stub」，真圖不在這張。去 **`assets/_media_all/`**（匯入 dump 的 docx 全部原始 media，編號與 `assets/` 不一致）翻找對應的**大張 EMF/PNG**（50KB～300KB），Read 逐張看、依**內容與原文位置**比對出哪張才是這位置的圖，**以那張為準**。比對不出來就回報、別硬猜。

**判斷準則——不是看「有沒有方塊/箭頭」，是看「方塊與箭頭代表什麼」。**

真正的 BPMN 流程圖，本質是「**一串離散的『動作/步驟』，用流程線串成有先後的控制流**」。核心一問：**箭頭連的是『一個動作接下一個動作（先後順序）』，還是『東西與東西之間的關係（關聯／對應／歸屬／資料或物料流向）』？** 只有前者才是流程圖。

- ✅ **是流程圖（該轉 BPMN）——需同時滿足**：
  1. **節點是「動作/步驟」**：每個方塊是一個可執行的處理動作（多為動詞，如 進片／檢核／報工／投料／出貨），**不是**一個「物件、資料、實體、角色、狀態」。
  2. **箭頭代表「先後順序（控制流）」**：A 做完 → 換 B 做，是流程/時間上的「下一步」。
  3. （加分、非必要）判斷菱形分支（OK/NG、是/否）、角色泳道、開始/結束點、迴圈（重工、退回重檢）。

- 🚫 **不是流程圖（保留為圖片、勿轉 BPMN）——即使有方塊和箭頭**：
  - **關係／連結圖**：方塊是「物件／資料／實體」，箭頭表達的是**關聯、對應、歸屬、資料或物料的流向**（如 成品SN ↔ 半成品SN 的綁定、大板 → 小板的分板、物料投入 → 產出）——那是「東西之間的關係」，不是「動作的先後」。
  - **只有箭頭/連線、沒有離散處理步驟**的純連結示意（純粹畫「A 連到 B」的關係圖）。
  - **資料樣態/範例圖**（機台照片＋範例資料表＋箭頭，說明「依某條件查出哪些資料」）、**產品/物件立體示意圖**（半成品/成品生產、物料投入產出的示意）、**架構/系統關係圖**、照片、截圖、Logo、卡通圖示拼的示意圖。
  - **一句話鐵律：有箭頭 ≠ 流程圖。** 箭頭若在表達「關係/對應/資料或物料流向」而非「一步接一步的動作」，就是示意圖，**保留為圖片**。

- 🔢 **判為流程圖後，多數一問：數「左側橫向渠道帶」的數量 → 單張 vs 候選多張（這一問一定要問，否則多渠道圖會在步驟 3b 被整包壓成一張 flow.json）**：
  - **只有 1 條（或無橫帶）** → 單張，照常走步驟 3b。
  - **≥2 條** → 先標記為「**候選多張**」，接著用下面準則判「該不該真的拆」（別預設橫帶＝同一流程的不同階段）：
    - **每條帶各有自己獨立的 start/end、帶與帶之間沒有跨帶連線** → 它們是**各走各的獨立流程** → 拆成 N 張（步驟 3b）。
    - **共用同一組泳道、帶其實是同一情境的多個入口／觸發點**（例如同一條途程 A→B→C，只是有兩個觸發起點）→ **維持一張**——BPMN 本來就能在一張圖畫多個起點，別誤拆。

- ❓ **分不出/看不清** → 回報、請指揮官確認，**不要腦補節點、不要硬轉**。

## 步驟 3 — 收斂：依「你的判斷 × 目前狀態」決定動作

| 你的判斷 | 目前狀態 | 動作 |
|---|---|---|
| 是流程圖 | 普通 `![]`（**漏標**） | 重建 BPMN（步驟 3b）→ 把該行 `![]` 換成 ```` ```bpmn ````；`set imageN flow` |
| 是流程圖 | 待補 `_pending.bpmn` | 重建 BPMN → 換成 ```` ```bpmn ````、刪 `_pending.bpmn`；`set imageN flow` |
| 是流程圖 | 已是真 `.bpmn` | 不動；（manifest 已是 flow 就跳過，不用重讀圖） |
| 不是流程圖 | 待補 `_pending.bpmn`（**過度標**） | 還原成 `![](assets/imageN.png)`、刪 `_pending.bpmn`；`set imageN notflow` |
| **不是流程圖** | **已是真 `.bpmn`（過度標、且已重建）** | **還原成 `![](assets/imageN.png)`、刪 `imageN.bpmn`＋`imageN.flow.json`（含矩陣拆出的 `imageN_*`）；`set imageN notflow`** |
| 不是流程圖 | 普通 `![]` | 不動；`set imageN notflow`（記住，之後不再重判） |

> - 指揮官「不想一張一張標」就是要靠你**主動雙向收斂**——漏標的補上、過度標的還原（**含把已誤畫成真 bpmn 的還原回圖片**，這格是新加的），不要把判斷丟回給人。
> - **每格動作完，都要 `set` 寫回 manifest**（flow/notflow）——這樣重跑/重匯不再重判、指揮官的 notflow 修正永久生效。
> - **manifest 已是 `flow` 的圖**：只要確保 doc.md fence 指向真身 `imageN.bpmn`（重匯若把它打回 `_pending`、但真身 bpmn 還在，就把 fence 換回真身），**不用重讀圖、不用重建**。

**3b. 重建（流程圖才做）：先寫 `.flow.json`，再產 `.bpmn`**

**真相來源是 `.flow.json`（節點＋from/to 關聯），`.bpmn` 是腳本生成的投影。你只寫關聯，版面/座標全交給腳本——不要手刻 bpmn XML、不要算座標。** flow.json 的**完整 schema 與紀律沿用 `word-to-md` skill 的步驟 3**（同一套規則）。重點：

- **忠實禁簡化**：圖有幾個節點就幾個，保留每條 OK/NG 分支與迴圈，別把泳道壓成線性、別掉角色。
- **lanes＝角色直欄**（如 計畫層(ERP)／管理階層(MES)／控制層(EAP)／設備層）；`orientation` 預設 `"vertical"`。lanes 可寫**字串陣列** `["計畫層(ERP)", …]`（node.lane 填角色名）**或物件陣列** `[{"id":"erp","name":"計畫層(ERP)"}, …]`（node.lane 填 `id`）——`flow-bpmn.js` 兩種都吃。
- **node `id` 用 ASCII**（`n1`,`g1`…），中文寫 `name`（bpmn-js 會把中文 id 靜默丟掉）；`type` ∈ `start`/`end`/`task`/`gateway`。
- **候選多張、且判定為「各走各的獨立流程」→ 拆成多張**（拆不拆的判準見步驟 2；判為「同一情境多入口」→ 維持一張、不拆）：一個橫帶一張 flow、共用角色 lanes、檔名用該渠道名。**每張拆出來的 flow.json 都要把 `title` 設成該渠道名**——`flow-bpmn.js` 會把 `title` 寫成 participant／泳池標頭，讓預覽、全螢幕、PDF 三面的標題都對得上（這是這次踩出來的經驗，別漏）。

檔案放該文件素材夾 `.documents/<uuid>/assets/`，命名**去掉 `_pending`**：單張 → `assets/imageN.flow.json` → 產 `assets/imageN.bpmn`；矩陣拆多張 → `assets/imageN_<階段名>.flow.json`/`.bpmn`。

> ⚠️ **錨點鐵律（load-bearing，勿改）**：bpmn/flow.json 的檔名**必須**以來源圖號 `imageN` 開頭（`N` = 匯入器給該張圖的編號，即 doc.md 那個位置原本 `assets/imageN.png` 的 N）。**禁止**命名成純語意名（如 `工單結案.bpmn`）。原因：擬真預覽靠「doc.md fence 的圖號 N → `word/media/imageN` → `w14:paraId` → docx-preview 的 `[data-el]`」這條鏈把 svg 對位貼回原圖框（見 `specs/SPEC-doc-editing.md §13.11/§13.12`）。**丟掉 `imageN` 前綴 = 擬真畫面對不到、流程圖畫不出來**。矩陣拆多張時,同一張圖的每個子流程都共用同一個 `imageN_` 前綴（`imageN_<階段名>`），doc.md 在該位置放多個 ` ```bpmn ` fence——顯示層會把它們**疊著畫在同一格、各帶階段名標題**。

產 bpmn（確定性腳本、無 DI、portal 自動排版含泳道；與 word-to-md 同一支）：
```bash
node "$HARNESS_HOME/portal/render-service/flow-bpmn.js" to-bpmn ".documents/<uuid>/assets/<名>.flow.json"
```
```powershell
node "$env:HARNESS_HOME\portal\render-service\flow-bpmn.js" to-bpmn ".documents\<uuid>\assets\<名>.flow.json"
```
→ 看到 `BPMN_FILE: ...` 即產出同名 `.bpmn`。

## 步驟 4 — 回填 doc.md

路徑一律**相對 doc.md ＝ `assets/…`**、`` ```bpmn `` **body 放路徑**（info-string 會被 marked 丟掉）、不要絕對路徑/workspace 參數。

- **流程圖（漏標的普通圖）**：把該行 `![](assets/imageN.png)` 換成：
  ````
  ```bpmn
  assets/imageN.bpmn
  ```
  ````
- **流程圖（待補的）**：把「待補 blockquote ＋ 緊接的 ```` ```bpmn …_pending.bpmn… ```` 」整段換成上面的真 bpmn fence；矩陣拆多張就放多個 ```` ```bpmn ````（可各加一行 `### <階段名>`）；移除待補說明文字。
- **非流程圖（過度標的待補）**：把「待補 blockquote ＋ pending fence」整段還原成 `![](assets/imageN.png)`、刪 `imageN_pending.bpmn`。
- 重建成功就**刪 `imageN_pending.bpmn`**、**保留 `imageN.png`**（來源/對照）。**只產檔而 doc.md 沒換 ＝ 失敗。**

## 步驟 5 — 自我檢查並回報

- 該文件每張圖都已判過、收斂到正確表示（流程圖→ ```` ```bpmn ````、非流程圖→ `![]`）；
- 每個 `.flow.json` 節點數＝原圖節點數、分支/迴圈/角色泳道齊全；`to-bpmn` 都 `BPMN_FILE:` 成功；
- doc.md 內無殘留 `_pending.bpmn`；
- 回報統計：**判為流程圖 N 張（其中漏標補上 X、待補重建 Y、矩陣拆成 Z）／非流程圖 M 張（其中過度標還原 W）／看不清待確認 K 張**。

## 常見雷

- **只動 `.documents/<uuid>/`**：系統控管真身，別碰原始 docx、別在別處生檔。
- **全圖稽核、雙向收斂**：別只看待補；普通圖也要看（漏標藏在那）；過度標的要主動還原，不要把判斷丟回指揮官。
- **真相在 flow.json**：改流程改 `.flow.json` 再 `to-bpmn`；portal 編輯器手改 bpmn 存檔會自動回寫 flow.json（雙向同步）。
- ```` ```bpmn ```` 路徑寫**相對 doc.md** 的 `assets/<名>.bpmn`、**body 放路徑**。
- **去掉 `_pending`**：檔名還帶 `_pending`，檢視器就當「待補」只顯示原圖、不渲染成可編輯流程圖。
- 矩陣泳道別硬做 2D：拆多張、共用角色 lanes。
- 指揮官保留手動覆寫：檢視器每張待補圖上有「不是流程圖」鈕（零 AI 一鍵還原）——但**預設由你主動判**，別等指揮官標。
