---
name: doc-new
description: 依一段說明，從「範本家族」或「複製現有文件」產出一份新文件（填內容＋畫流程圖＋留假圖），註冊進文件管理
type: prompt
icon: file-plus
---

# 任務：依說明生成一份新文件（用模）

**`doc-new` ＝ 用模**：拿一個現成範本（或一份現有文件）＋指揮官的一段說明，**寫出一份結構正確、流程圖正確的新文件**，並收進文件管理（registry）。
（造模——把一堆文件歸納成範本——是 `doc-template` 的事，不是這支。）

> 為何由你（Hana）生成而非樣板字串：客戶文件是**語意內容**，要讀懂說明、**畫對流程圖**——這正是 AI 的判斷，同 `doc-flowchart`。

**本次派工內容**：
```
{{args}}
```

上面三個欄位（**來源** / **文件名稱** / **說明**）請逐一解析：
- **來源**：`範本家族「<家族名>」`（從範本開始）或 `複製現有文件 <docId>`（從某份既有 doc 改寫）。
- **文件名稱**：新文件的顯示名稱（填進 H1 標題、registry 顯示名）。
- **說明**：指揮官要你寫什麼內容、有哪些流程（步驟/泳道角色）、要哪些示意圖。**這是你寫內容、畫流程的唯一依據**——讀懂它。

> ⚠️ **路徑紀律（別寫死）**：腳本住 **`HARNESS_HOME`**；客戶資料在**當前工作區**（cwd）。新文件真身放 `.documents/<uuid>/`（`doc.md` + `assets/`），**只動這裡**，別碰別人的文件、別碰原始 docx。
> ⚠️ 文件內任何 HTML 樣式標籤一律用反引號包（family notes / TASK H1 慣例）。

---

## 步驟 0 — 配一個新文件 UUID 夾

```bash
node "$HARNESS_HOME/portal/document-registry.js" new-doc
```
```powershell
node "$env:HARNESS_HOME\portal\document-registry.js" new-doc
```
→ 印出 `{"ok":true,"id":"<uuid>","dir":".documents/<uuid>","mdPath":".documents/<uuid>/doc.md"}`。記下 `<uuid>`；之後內容寫進 `.documents/<uuid>/doc.md`、素材放 `.documents/<uuid>/assets/`（夾已建好）。

---

## 步驟 1 — 取得起點（依「來源」分兩路）

### 1A. 從範本開始
1. 讀範本登錄 `.documents/.templates/index.json`，依家族名找到 `templatePath`（與 `notesPath`）。
2. 讀**骨架** `.documents/.templates/<家族>.md`；若有 `<家族>.notes.md` 也讀（家族慣例：章節順序、用詞、泳道角色、語氣——遵守它）。
3. 把骨架**整份複製**成 `.documents/<uuid>/doc.md` 當起點。骨架長這樣（填空題）：front-matter（`type: doc` + `template: <家族>`）＋ H1 `# {{標題}}` ＋ 各章節標題 ＋ `<!-- HANA: 說明 -->` 章節提示 ＋ ```` ```bpmn placeholder ```` 流程佔位 ＋ `![說明](placeholder)` 假圖佔位。

### 1B. 從複製現有文件
1. 讀 `.documents/index.json`，依 `<docId>` 找到該文件，讀其 `.documents/<docId>/doc.md`。
2. **複製素材**：把 `.documents/<docId>/assets/` 整夾複製到 `.documents/<uuid>/assets/`（保留既有圖與 `.bpmn`，之後就地改寫/重畫）。
3. 把來源 `doc.md` 複製成 `.documents/<uuid>/doc.md` 當起點（之後依說明改寫）。

---

## 步驟 2 — 依說明填/改內容（逐段）

逐章處理 `.documents/<uuid>/doc.md`：

- **H1 標題**：把 `{{標題}}`（或來源標題）換成**文件名稱**。
- **每個 `<!-- HANA: … -->` 章節**：依該行提示 ＋ 指揮官**說明**，寫出**真實內容**，然後**刪掉那行 `<!-- HANA: … -->` 註解**（它是給你的提示，不是文件內容）。
  - 說明沒提到、確實無內容的**核心章節**：**留標題**、內文填 `N/A`（家族骨架紀律——不刪章節，便於同家族對齊比較）。
- **從複製**時：依說明**改寫**對應段落（換情境、改流程描述、改數據/角色），沒被說明動到的段落可沿用；別把不相干的舊內容留著當新文件。
- **語氣/用詞**：跟隨家族 notes（如「硬體」不「硬件」、「流程」不「整體流程」、正體中文）。

---

## 步驟 3 — 畫流程圖（placeholder → 真 BPMN）

文件裡每個 ```` ```bpmn placeholder ```` （或從複製來、需依新說明重畫的流程圖）都要換成真圖。**真相在 `.flow.json`，`.bpmn` 是腳本生成的投影——你只寫節點＋關聯，版面/座標交給腳本，別手刻 bpmn XML、別算座標。**

1. 依**說明**描述的流程，寫 `.documents/<uuid>/assets/<名>.flow.json`：
   - `lanes` ＝角色直欄（如 `["管理層(MES)","設備層(AOI)"]`，或物件陣列 `[{"id":"mes","name":"管理層(MES)"}]`，兩種 `flow-bpmn.js` 都吃）。
   - `nodes`：`id` 用 **ASCII**（`n1`,`g1`…，中文寫 `name`，否則 bpmn-js 會把中文 id 靜默丟掉）；`type` ∈ `start`/`end`/`task`/`gateway`；`lane` 填角色名或角色 id。
   - `edges`：`{"from":"n1","to":"n2"}`（分支加 `"label":"OK"`）。
   - `orientation` 預設 `"vertical"`。
   - **忠實**：說明有幾個步驟就幾個節點，保留分支/迴圈/角色泳道，別壓成線性、別掉角色。
   - flow.json 完整 schema 與紀律同 `doc-flowchart` / `word-to-md` 的步驟 3。
2. 產 bpmn（確定性腳本、無 DI、portal 自動排版含泳道）：
   ```bash
   node "$HARNESS_HOME/portal/render-service/flow-bpmn.js" to-bpmn ".documents/<uuid>/assets/<名>.flow.json"
   ```
   ```powershell
   node "$env:HARNESS_HOME\portal\render-service\flow-bpmn.js" to-bpmn ".documents\<uuid>\assets\<名>.flow.json"
   ```
   → 看到 `BPMN_FILE: ...` 即產出同名 `.bpmn`。
3. **回填 doc.md**：把該段 ```` ```bpmn placeholder ```` 換成（路徑**相對 doc.md**＝`assets/…`、**body 放路徑**，info-string 會被 marked 丟掉）：
   ````
   ```bpmn
   assets/<名>.bpmn
   ```
   ````
   - 同時**刪掉骨架裡那段 `> ⚠️ 依說明繪製…` 的操作提示 blockquote**（給你的鷹架，不是文件內容）。
   - 說明若描述**多個流程**：複製該 `### 流程` 小節成多段，各放一個 `.flow.json`/`.bpmn`。
   - 說明**畫不出**某流程（資訊不足）→ 留 ```` ```bpmn placeholder ```` 並在回報指出，**別腦補節點**。

---

## 步驟 4 — 示意圖：留假圖佔位

需要插圖／示意圖處，**留假圖佔位**（指揮官之後用文件檢視器的圖片編輯器「插入圖片」換真圖）：
```
![<一句說明這裡要放什麼圖>](placeholder)
```
- 從範本來的 `![說明](placeholder)`：依說明把**括號前的說明文字**改成貼切的圖說，`(placeholder)` **保持不變**。
- 別自己生成/硬塞圖片；別把 placeholder 換成不存在的 `assets/x.png`。

---

## 步驟 5 — 註冊進文件管理（registry + 出生事件）

確認 `.documents/<uuid>/doc.md` 內容已寫完、流程圖已回填，再註冊（這步會**快照當下 doc.md** 成出生版 `doc.0.md`，所以**務必最後做**）：

從範本：
```bash
node "$HARNESS_HOME/portal/document-registry.js" register-born --id <uuid> --name "<文件名稱>" --template "<家族名>"
```
從複製：
```bash
node "$HARNESS_HOME/portal/document-registry.js" register-born --id <uuid> --name "<文件名稱>" --source "<來源docId>"
```
（PowerShell 同理，路徑用反斜線、`$env:HARNESS_HOME`。）

這支會：寫 front-matter（`type: doc` ＋ `template`/`source` 來源註記）、upsert registry（顯示名由 `生成/<文件名稱>` 推導、`origin=generated`）、append 一筆 `born:generated` 版本事件（清單顯示紫色「生成」膠囊）。**不要自己手改 `index.json` / `history/log.json`**——交給這支，schema 才不會錯。

---

## 步驟 6 — 自我檢查並回報

- `.documents/<uuid>/doc.md`：H1 ＝文件名稱；核心章節齊全（無內容者留標題填 `N/A`）；**無殘留** `<!-- HANA: -->` 註解、**無殘留** `> ⚠️ …` 操作提示鷹架。
- 每個流程圖：`.flow.json` 節點數＝說明描述的步驟數、分支/迴圈/角色泳道齊全；`to-bpmn` 都 `BPMN_FILE:` 成功；doc.md 內 ```` ```bpmn ```` body 是 `assets/<名>.bpmn`、**無殘留** `placeholder` 流程（除非刻意留待補並已回報）。
- 假圖：需插圖處是 `![說明](placeholder)`。
- registry：`register-born` 成功（回 `{"ok":true,...}`）；文件已出現在清單。
- **回報**（簡短，別貼整份 doc.md）：新文件 id、名稱、來源（範本<家族>/複製<docId>）、填了幾章（N/A 幾章）、畫了幾張流程圖、留了幾張假圖；有畫不出/待確認的就點名。

---

## 常見雷
- **register-born 一定最後做**：它快照 doc.md 當出生版；內容沒寫完就註冊＝出生版缺內容。
- **只動 `.documents/<uuid>/`**：別碰來源文件、別碰原始 docx、別在別處生檔。
- **`{{標題}}` 要換掉**：骨架佔位若沒換，文件標題會是字面 `{{標題}}`。
- **刪鷹架**：`<!-- HANA: -->` 與 `> ⚠️ …` 是給你的提示，交付前刪乾淨；假圖 `![](placeholder)` 與真 ```` ```bpmn ```` 才是要留的。
- **流程圖 body 放相對路徑**：```` ```bpmn ```` 內**一行** `assets/<名>.bpmn`，不要絕對路徑、不要 workspace 參數、不要把路徑塞 info-string。
- **node id 用 ASCII**、中文寫 name；忠實禁簡化（別把泳道壓成線性、別掉角色/分支）。
- **畫不出別硬猜**：說明不足以畫某流程，留 placeholder 並回報，不要腦補節點。
