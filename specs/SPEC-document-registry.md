# SPEC — Document Registry / Viewer / Import（文件登錄表・檢視器・匯入）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/index.html`（文件檢視器：清單/預覽/搜尋/型別、匯入對話框）、`portal/server.js`（registry API、匯入端點）、`portal/render-service/docx-convert.py`（被匯入呼叫）、各工作區 `.documents/`
> 動機（2026-06-26~27 與 老闆）：客戶 docx 散在工作區多個資料夾（情境流程／專案進度報告／PM管理…），用目錄管理「檔案一多就忘」、同名檔放不同地。需求：用一個**像 AI 對話的「文件檢視器」**（左清單＋右預覽）統一管理；轉檔後的 md/素材**交給系統控管**，使用者不必管 md 長怎樣、放哪。
> 這是「文件管理」的**容器層**，把 import（`SPEC-doc-convert`）、每文件動作列（`SPEC-document-framework`）、B+C 預覽/交付（`SPEC-doc-editing`）串起來。
> ⚠️ 文件內任何 HTML 樣式標籤一律用反引號包（見 `TASK.md H1`）。

---

## 1. 核心原則
1. **用 registry 管理，不靠目錄**：文件由一張索引（registry）管理；使用者跟「檢視器 + registry」互動，不 navigate 檔案系統。同名不同地 → 用「實際位置」區分。
2. **真身 md 由系統控管**：轉檔後的 md + 素材放在**系統管理的隱藏目錄**，使用者不直接碰（用檢視器）；但 git 照樣追蹤。
3. **資料屬於擁有者**：客戶文件＝專案資料 → 放**各工作區**、各工作區 git。**絕不放 _harness**（工具、且公開 repo）。
4. **原始檔放哪都行**：docx 散在工作區任何資料夾;registry 記住它在哪。

---

## 2. Storage 與 git 模型
工作區內的系統管理目錄（**`.` 開頭、視為系統、使用者勿直接碰**；git **追蹤**，**不**放進已 gitignore 的 `.harness/runtime/`）：

```
<workspace>/
  情境流程/  專案進度報告/  PM管理/  …        ← 使用者自己的資料夾，原始 docx 散落於此
  .documents/                                ← 系統管理（隱藏/勿碰）；git 追蹤
    index.json                               ← registry（索引）
    <uuid>/                                  ← 每文件一個 UUID 資料夾（解同名衝突）
      doc.md                                 ← 轉檔後真身（純文字，git diff 清楚）
      assets/                                ← 該文件素材（圖片…）
      source.docx                            ← 原始檔的「工作複本」（先複製再解析→不咬住原檔、較安全）
      exports/                               ← 生成的 docx/pdf（可 gitignore）
```

- **UUID 解同名衝突**：每文件用 UUID 資料夾（`<uuid>/`），所以「不同目錄、相同檔名」的兩份 docx（如 `情境流程/工單.docx` 與 `PM管理/工單.docx`）各自進不同 UUID 夾，**md/素材/source.docx 都不會撞名**；registry 的 `sourcePath` 記住各自的原始位置以資區分。**不需要在 `.documents` 裡複製原目錄結構。**
- **git**：專案 repo 追 `.documents/`（md 文字 diff 一清二楚改了哪些字 + registry）。`_harness`（工具/公開）永遠乾淨。
- 交付產物 → `.documents/<uuid>/exports/`，可 gitignore。

> 命名：採 **`.documents/`**（與 `.harness`/`.worktable` 一致的 `.` 慣例，已定）。

---

## 3. Registry 資料模型（`.documents/index.json`）
```
{
  "documents": [
    {
      "id": "<uuid>",                           // UUID；對應 .documents/<uuid>/
      // ⚠️ 無 title 欄：Word 自由格式無可靠「文件標題」，title 又是標準詞、易誤解。
      //    顯示名稱一律由 sourcePath（原始檔名去副檔名）推導 → 單一真相來源。
      "sourcePath": "情境流程/工單BOM管理_UnderReview_0420.docx",  // 原始檔在工作區的相對路徑（＝清單顯示名＋下方小字位置）
      "mdPath": ".documents/doc_xxx/doc.md",
      "type": "doc",                            // doc | block-deck | …（與 front-matter.type 一致）
      "origin": "imported",                     // imported（匯入）| generated（Hana 生成）；＝出生事件，清單快取（見 §3a）
      "bornAt": "2026-04-20T...",               // 出生時間（imported ＝ convertedAt；generated ＝ doc-new 完成時）
      "revisions": 0,                           // 出生後的編輯次數；0 ＝ 原始(第一版)、>0 ＝ 已修改（清單快取，免掃 log）
      "convertedAt": "2026-04-20T...",
      "updatedAt": "2026-06-27T...",
      "exports": ["pdf", "docx"]
    }
  ]
}
```
- 與 `SPEC-document-framework` 的 **front-matter 一致**：md 檔頭也寫 `source`/`type`（**不寫 title**；registry 與 front-matter 互為備援；registry 給清單快取，front-matter 給單檔自描述）。
- `origin`/`revisions` 為**清單快取**：真相是 §3a 的版本日誌（`history/log.json`）；快取讓清單免掃 log 即可上 badge / 過濾。

---

## 3a. 狀態與版本歷史（出生 + 歷次修改，合為同一條時間軸）

> 動機（2026-06-28 與 老闆）：清單要能**一眼看出**(1) 來源——匯入 vs Hana 生成、(2) 狀態——原始(第一版) vs 已修改；且要有**入口看「歷次修改的內容」**（原本設想用 git）。

**設計：app 管的「版本日誌 + 快照」，鋪在 git 之上**（不直接拿 git log 當 UI）。
- 為何不直接讀 git：git 由人類手動 commit（Hana 不自動 commit），一次 commit 常綁多份文件/多次編輯，給不出「第幾版、那次改了什麼、能否還原」。快照檔仍在 `.documents/`、git 照樣追蹤——git 是底層耐久備份，app 日誌是上層細粒度檢視。
- **出生 = 第 0 筆事件；已修改 = 有第 0 筆以後的事件**。一條時間軸同時涵蓋「怎麼出生」與「歷次怎麼改」。

**儲存**（每文件）：
```
.documents/<uuid>/history/
  log.json                ← 事件日誌（陣列，見下）
  doc.<rev>.md            ← 各版快照（doc.0.md ＝ 出生版；rev 遞增）
```
`log.json` 每筆：
```
{ "rev": 0, "ts": "...", "kind": "born",
  "origin": "imported",            // born 專屬：imported | generated
  "by": "老闆",                 // 匯入＝指揮官；生成/編輯＝Hana
  "summary": "匯入自 情境流程/工單BOM管理_0420.docx",
  "snapshot": "doc.0.md" }
{ "rev": 3, "ts": "...", "kind": "edit",
  "by": "Hana", "summary": "插入圖片（第 3 張）",   // 人話摘要：插入圖片／更換圖片／編輯流程圖／覆蓋匯入／還原至第 N 版
  "snapshot": "doc.3.md" }
```

**寫入點**：一個 helper `appendDocHistory(id, { kind, by, summary })`——先把當下 `doc.md` 存成 `doc.<nextRev>.md`、append log、registry 同步 `revisions`/`updatedAt`。所有會改 `doc.md` 的端點都要呼叫它：
- 匯入（`SPEC-doc-convert`）：建檔寫 `rev0 born:imported`（`origin=imported`）；覆蓋已存在 → 一筆 `edit:覆蓋匯入`。
- `doc-new`（`SPEC-document-templates` / J3）：建檔寫 `rev0 born:generated`（`origin=generated`，`by:Hana`）。
- 圖片插入/更換（J1 `POST /api/documents/:id/image`）：一筆 `edit`。
- 流程圖編輯存檔、未來 B/C 編輯：各一筆 `edit`。

**API**：
- `GET /api/documents/:id/history` → `log.json`（含每版快照大小，供時間軸）。
- `GET /api/documents/:id/history/:rev` → 該版快照（md / 渲染），供唯讀預覽與 diff。
- `POST /api/documents/:id/restore/:rev` → 把該版寫回 `doc.md`，並記一筆 `edit:還原至第 N 版`（還原本身也是一次編輯，不抹掉中間版本）。

**回填既有文件**：寫 `rev0 born:imported`、`doc.0.md` ＝當下 `doc.md`、`origin=imported`、`revisions=0`。**歷史從此版起算**（過去未經 app 的編輯無法回溯，誠實標示）。

### 3a-1. 資產快照（流程圖 `.bpmn`／圖片）— 看得出改了什麼、能還原（J8）

> 動機（2026-06-28 與 老闆）：§3a 只快照 `doc.md` 純文字。但**流程圖與圖片的真身住在 `doc.md` 旁的獨立檔**，造成版本歷史「看不出也救不回」：
> - **流程圖（`.bpmn`）**：編輯時就地覆寫（`/api/file/save`）→ `doc.md` 文字沒變 → 該版 `doc.<rev>.md` 與前版相同 → **時間軸有列但 diff 一片空白、還原等於沒作用、舊 XML 已遺失**。
> - **圖片**：J1 換圖用「唯一命名不覆蓋」寫新檔 + 改寫第 N 個 `![]` → 舊 binary 仍在 `assets/`（故還原其實可行），但**時間軸分不出這列是圖的變更、diff 也只看到檔名那行字變了、看不到圖**。
>
> 結論：版本歷史的「快照」要從「只存 `doc.md`」擴成「**`doc.md` ＋ 本次被改動的 sibling 資產**」。

**事件 schema 增補**（`log.json` 每筆）：
```
{ "rev": 5, "ts": "...", "kind": "edit", "by": "Hana",
  "change": "flow",                                  // NEW: text | flow | image（born 仍看 origin）→ 驅動時間軸圖示與空文字 diff 提示
  "summary": "編輯流程圖（採購流程）",
  "snapshot": "doc.5.md",
  "assets": [                                         // NEW: 本次被改動、已快照的 sibling 檔（多數編輯只一個）
    { "type": "flow",  "path": "assets/採購流程.bpmn", "snapshot": "assets/5/採購流程.bpmn" }
  ] }
```

**儲存**（每文件，疊加在既有 `history/` 上）：
```
.documents/<uuid>/history/
  log.json
  doc.<rev>.md            ← doc.md 快照（既有）
  assets/<rev>/<file>     ← NEW：該 rev 改動的 sibling 檔，存「改完後」的內容
```

**Copy-on-write 基線（關鍵、避免肥大）**：**第一次要改動某 sibling 檔之前**，先把它「改之前」的內容存成一份基線快照（掛在最近一筆已有它的 rev、或補一筆出生基線）。如此：
- 第一次編輯流程圖的 diff 就有「前」可比、**還原回出生版也不失真**；
- 又**不必在出生時整包複製所有未改過的資產**（範例專案單份文件圖很多）→ 儲存有界：每個資產只在「出生（首次被碰時補拍）＋每次被改」各存一份。

**衍生查詢規則**（純由 `assets[]` + rev 推導，不另存）：
- **某版 N 的某資產內容** ＝ `path` 相同、`rev ≤ N` 的**最後一筆**快照。
- **某次編輯的 diff「前」版** ＝ `path` 相同、`rev <`本次的**最後一筆**快照（有 copy-on-write 基線保證一定找得到）。

**還原 rev N**（擴充 §3a 的 restore）：寫回 `doc.N.md` 之外，**把 N 版引用到的每個資產，用上述規則解析出的快照複製回它的 sibling 路徑**（流程圖回寫 `.bpmn`、圖片回寫該檔），再記一筆 `edit:還原至第 N 版`（還原本身也快照被它改回的資產）。**中間版本一律不抹。**

**空文字 diff 提示**：當某版 `doc.md` 文字與前版相同（純流程圖／圖片變更），diff 區不再留白，改顯示一句「**本次為流程圖變更（非文字），文字內容無差異**」（圖片同理）。

**API 增補**：
- `GET /api/documents/:id/history/:rev/asset?path=<rel>` → 回該版（依解析規則）該資產的快照（`.bpmn` XML／圖片 binary，正確 content-type），供時間軸渲染「該版的流程圖／圖片」與並排 diff。
- `GET …/history`：每筆事件附 `change` 與 `assets` 摘要。
- `POST …/restore/:rev`：連同資產一起還原（如上）。

**回填既有 log**（pre-J8 的事件無 `change`/`assets`）：依 `summary` 推 `change`（含「圖片」→ `image`、含「流程圖」→ `flow`、否則 `text`）；`assets` 留空（過去未拍的資產無法回溯，**誠實標示歷史從此起算**）。

### 3a-2. 放大比對檢視器 ＋ 流程圖結構 diff（J8）

> 動機（2026-06-28 與 老闆）：流程圖／圖片常只改一點點，抽屜裡的小並排看不清；且圖有直有橫。要：(1) **放大到接近滿版**比對、(2) 版面可在**左右並排 ⇄ 上下並排**切換、(3) 兩圖可**一起或各自 zoom/pan** 看局部、(4) 流程圖**直接點出「關聯」的差異**並能**上下箭頭逐處跳轉**。

**(A) 放大比對檢視器（lightbox，流程圖＋圖片共用）**
- 入口：時間軸某版 diff 的「放大比對」、或預覽最新版工具列的「**與上一版差異**」→ 彈出**接近滿版 modal**（取代抽屜內小並排）。
- **版面切換**：一顆鈕在「左右並排」與「上下並排」間切；**預設依資產長寬比自動挑**（直圖／portrait → 左右用滿寬；橫圖／landscape → 上下用滿高）。流程圖以其 SVG 外接框長寬比同理判定。
- **縮放／平移**：每一窗各自 zoom-in/out ＋ 拖曳平移；外加「**同步鎖**」toggle——鎖上時兩窗 zoom/pan 連動（對照同一局部），解鎖各自獨立。`image` 與 `flow` 皆適用。
- 純前端（操作既有 SVG／`<img>`，CSS transform 縮放平移）；不需新 API。

**(B) 流程圖「結構 diff」（節點／連線關聯比對）**
- 用既有 `bpmnToFlow()`（`render-service/flow-bpmn.js`）把**前後兩版 `.bpmn` 各還原成 `{nodes, edges}`**（語意，不含版面雜訊），做集合比對：
  - **節點**：新增／刪除／改名／換 lane／改 type；**對齊用 `id`**（`bpmnToFlow` 保留 BPMN element id，對 portal 編輯通常穩定），id 對不上時 fallback 以 `name` 比對。
  - **連線**：新增／刪除／改標籤（label）／改起訖（from/to）。
- **視覺**：在最新版 SVG 上以顏色疊層標示——**新增綠／刪除紅／修改黃**；「**與上一版差異**」按鈕 toggle 此疊層。
- **導覽**：側欄列出變更清單；提供「**上下箭頭**」逐處跳轉——點「下一處」→ SVG 自動 **置中＋highlight** 對應的節點或連線（pan/zoom 帶過去），讓 老闆不必自己找改在哪。
- 結構 diff 即時由兩版 `.bpmn` 推導（重用 `GET …/history/:rev/asset`），**不另存**。

> 範圍備註：圖片無「結構」，只有放大比對檢視器（A）；流程圖兩者皆有（A＋B），B 是 flow 專屬的精準 diff。

**(C) `source`（pptx／docx 真身）版本比對 — J8-FIX（2026-07-06 補正）**
> 缺口：§3a-1 原只定義 `change: text|flow|image` 三型，(A) 只為 **flow＋image** 設計。但 §K 文字回寫（K2/K4）與桌面 App 手動改 source.pptx／source.docx 後，歷史事件記的是 **`assets: [{ type:'source', path:'source.pptx|source.docx' }]`**（`server.js`）——這是**整份 Office 真身二進位、不是圖片**。前端 lightbox 對非 `flow` 一律當 image 走 `<img src=…/asset?path=source.pptx>`，而 asset 端點對 `.pptx/.docx` 回 `application/octet-stream` → **`<img>` 破圖**（時間軸也誤標「🖼️ 圖片」）。
>
> 修正（重用既有擬真渲染，不新造）：
- **型別新增**：lightbox 除 `flow`／`image` 外，正式支援 **`source`**（pptx／docx）。徽章顯示 **📄 文件**（非「🖼️ 圖片」）。
- **渲染方式**：前後兩窗**不用 `<img>`**，改**擬真渲染真身**——`fetch('…/history/:rev/asset?path=source.pptx|docx')` 取 **arraybuffer**，餵給既有渲染函式（pptx → `_renderPptxInto(buf, area)`；docx → `window.docx.renderAsync(buf, area, …)`，即 `_renderDocFidelity` 用的同兩支）進到 `j8-lb-panel0/1`。zoom／pan／左右⇄上下版面切換沿用 (A)。
- **後端**：asset 端點對 `.pptx`／`.docx` 補正確 MIME（`application/vnd.openxmlformats-officedocument.presentationml.presentation`／`…wordprocessingml.document`）；`arrayBuffer` 讀取本就與 MIME 無關，但仍應正名、勿留 `octet-stream`。
- **結構 diff（B）不適用** source（無 bpmn 語意層）：source 版本比對只有 (A) 擬真並排。文字層差異另由既有 `text` 逐行 diff（doc.md 快照 `GET …/history/:rev`）承擔——兩者互補（視覺看版面搬移、文字看字句校修）。
- **降級**：某版無 source 快照（pre-J8 或回填事件）→ 該窗顯示「無此版真身快照，改看文字差異」並連到 text diff，不留破圖。

> 範圍備註（更新）：`image` 只有 (A)；`flow` 有 (A＋B)；**`source`（pptx/docx）只有 (A)，以擬真渲染真身並排**。

---

## 4. 匯入流程（老闆描述的操作順序）
入口：文件檢視器上一顆「**匯入文件 / 轉檔**」。
1. 開**檔案樹對話框**（file picker）：顯示**目前工作區**的資料夾/檔案（情境流程／…），**只列可轉的型別**（docx/pptx）；每筆可**勾選（複選）**。
2. 勾完按 **確定 / 開啟** → 開始轉檔程序（批量；呼叫 `docx-convert`，見 `SPEC-doc-convert` / `J1`）。
3. **已轉過的偵測**：逐檔比對 registry 的 `sourcePath`。若已存在 → 提示「**該檔已存在**」→ 選 **略過 / 覆蓋**（+「全部略過 / 全部覆蓋」）。**覆蓋預設為關（false）＝安全預設**；勾覆蓋時**警告「將丟失對該 md 的編輯」**，並**自動備份舊版**（`.documents/<uuid>/doc.<timestamp>.bak.md`；git 本來也有歷史）。
4. 轉檔：docx→md（含素材抽取、流程圖→```bpmn 的既有流程）→ 寫進 `.documents/<docId>/`、寫 front-matter（含 `source`）、更新 registry。
5. **進度 + 完成清單**（成功/略過/失敗）。
- 流程圖：批量先做機械轉換 + 圖片抽取；Visio/圖片流程圖→```bpmn 重建標「待補（人工/Hana）」，避免批量誤判（同 `J1`）。

---

## 5. 文件檢視器 UI（像 AI 對話）
- **左：文件清單**（借「AI 對話」清單版型）
  - 每列：**檔名（由 `sourcePath` 推導）** + 下方**小字＝實際位置（`sourcePath`）**（解同名不同地）；兩者太長截斷時 hover 顯示完整。
  - **badge（極簡，與檔名同列）**：① **型別**膠囊（doc / block-deck，已有）；② **來源**膠囊兩字（`匯入` 藍 / `生成` Hana 紫，由 `origin`）；③ **已修改**＝一顆**琥珀小圓點**（`revisions>0` 才顯示，hover「已修改 N 次」）；原始(第一版)**不顯示點**→ 清單乾淨。
  - **過濾（不佔版面）**：頂部只放**搜尋框**（過濾檔名 + 位置）＋ 旁邊一顆 **「篩選 ▾」**按鈕 → 點開**浮動下拉 popover**（絕對定位、外點即收，不佔固定空間），內含三組多選 chips：**型別**（doc / block-deck）、**來源**（匯入 / 生成）、**狀態**（原始 / 已修改）；可組合、預設全不選＝全部；有套用時按鈕顯示數字 badge + 提供「清除」。
- **右：預覽**（接 `SPEC-doc-editing` 的 B 文件化預覽；動作列接 `SPEC-document-framework`：匯出 docx/pdf、預覽真產出…）。
  - **動作列加「版本歷史」**：開**歷史抽屜**——時間軸（出生事件 → 歷次編輯，由 `GET …/history`）；點某版唯讀預覽 + 與目前 diff；可「還原此版」（`POST …/restore/:rev`）。
  - **時間軸每列依 `change` 標類型圖示**（J8）：✨ 出生／🔀 流程圖／🖼️ 圖片／📝 文字 → 一眼分得出這版動的是什麼。
  - **diff 依類型可視化**（J8）：`flow` → 前後 `.bpmn` 渲染成 **SVG 並排**（重用既有 bpmn viewer）；`image` → 前後**縮圖並排**；`text` → 沿用逐行 diff；文字無差異時顯示「本次為〈流程圖／圖片〉變更，文字內容無差異」（取代空白）。
  - **放大比對 ＋ 流程圖結構 diff**（J8，§3a-2）：抽屜小並排旁一顆「放大比對」、最新版工具列一顆「與上一版差異」→ 開**接近滿版 lightbox**（左右⇄上下版面切換、各自/同步 zoom-pan）；流程圖另疊**結構 diff**（節點/連線 新增綠/刪除紅/修改黃）＋變更清單＋「上下箭頭」逐處置中跳轉。
- 使用者**不需要知道 md 長怎樣、放哪**——一切透過檢視器。
- 顯示「**目前 active 工作區**」的 registry（沿用既有工作區切換）；未來要「跨專案總覽」再加聚合層，**儲存仍 per-workspace**。

---

## 6. 與既有 spec 的關係
- `SPEC-doc-convert.md`：轉檔引擎（被匯入流程呼叫）。
- `SPEC-document-framework.md`：每文件動作列（右側預覽的按鈕）+ front-matter schema。
- `SPEC-doc-editing.md`：B（文件化預覽）+ C（預覽真產出）+ 交付（pdf/docx）。
- `SPEC-block-deck.md`：`type: block-deck` 的文件。
- 本 spec＝把上述收進「文件管理容器」+ 定 storage/git/registry/匯入。

---

## 7. 決議 / 待議
- ✅ **系統目錄名 `.documents/`**（隱藏、git 追蹤）。
- ✅ **每文件 UUID 資料夾**（`<uuid>/` 內含 doc.md / assets / source.docx / exports）→ 解同名衝突；registry `sourcePath` 記原始位置，不複製原目錄結構。
- ✅ **原始 docx 複製進 `<uuid>/source.docx`**（先複製再解析→不咬住原檔、較安全）。
- ✅ **覆蓋預設關（false）**；勾覆蓋 → 警告丟失編輯 + 自動備份舊版。
- ✅ **跨工作區總覽先不做**，per-workspace。
- ✅ **版本歷史用 app 管的快照＋日誌（§3a）**，不直接拿 git log 當 UI（git 仍是底層備份）。出生+歷次修改合為一條時間軸；歷史從導入此機制起算（既有文件回填為匯入・第一版）。
- ✅ **清單 badge 極簡**：型別膠囊＋來源兩字膠囊＋已修改琥珀圓點；過濾用搜尋框旁「篩選 ▾」浮動下拉（型別／來源／狀態多選），不佔固定版面。
- ✅ **版本歷史含資產快照（§3a-1 / J8）**：快照從「只存 `doc.md`」擴成「`doc.md` ＋ 本次被改動的 sibling 資產（流程圖 `.bpmn`／圖片）」；用 **copy-on-write 基線**避免出生時整包複製；時間軸標類型圖示、diff 依類型可視化（流程圖 SVG 並排／圖片縮圖並排）、還原連資產一起回寫。老闆拍板：**圖片 binary 也一併快照**（即使 J1 唯一命名已使舊檔存活，仍快照以求自足與穩健）。
- 待議：registry 與 front-matter 衝突以誰為準？→ 暫定 **front-matter 為真身、registry 為快取**（掃描可重建）。
- 待議：`history/doc.<rev>.md` 與 `history/assets/<rev>/` 快照長期成長 → 未來可加保留策略（如保留最近 N 版 + 出生版）；先不做。
- ✅ **放大比對檢視器 ＋ 流程圖結構 diff（§3a-2 / J8）**：lightbox 接近滿版、左右⇄上下版面切換（預設依長寬比自動）、各自/同步 zoom-pan（同步鎖）；流程圖用 `bpmnToFlow()` 兩版還原 `{nodes,edges}` 做結構 diff（節點/連線 新增綠/刪除紅/修改黃）、變更清單＋「上下箭頭」逐處置中 highlight、最新版「與上一版差異」toggle。老闆拍板（2026-06-28）。
- 待議（J8 開放，先採預設）：① 圖片 diff 縮圖大小／是否標「同尺寸覆蓋 vs 不同尺寸」；② 流程圖 diff 是否再加「XML 文字 diff」分頁（先只做 SVG 並排＋結構 diff）；③ 一次編輯同時動到文字＋流程圖時 `change` 取單一主類型或陣列（先單一主類型）；④ 結構 diff 節點對齊用 `id`（fallback `name`）——若日後發現 portal 編輯會重洗 id，再改以 `name`+lane 啟發式對齊。

---

## 8. 文件型別正名 `sheet`→`workbook`（v0.5，worktable Z1）
- **決策（老闆 2026-07-08）**：匯入 xlsx 的文件型別值由 `'sheet'` 正名為 `'workbook'`——一份檔含多張 sheet，本質是 workbook（活頁簿），常見套件（SheetJS/openpyxl）亦用此詞；**連程式型別值一起改**（不只顯示名），避免日後出現「單張 sheet」語意時混淆。
- **界線**：只改「**文件型別**」語意的 `sheet`。worksheet 層級的 `sheet`（`wb.SheetNames`/`wb.Sheets`、`_renderSheetInto`、`hana-sheet-*` CSS、xlsx-convert/writeback 內指單張工作表者）**保留**。
- **遷移**：一次性把 `.documents/*` registry 與 doc.md front-matter 的 `type: sheet` 就地改寫為 `type: workbook`；讀取入口加向後相容容忍（舊 `'sheet'` 視同 `'workbook'`）。
- **顯示名**：面向使用者顯示「活頁簿 / Workbook」，icon 維持試算表。

## 9. 桌面編輯回讀「更新AI記憶」（v0.5，worktable Z2）
- **情境**：`open-desktop` 開的是 `.documents/<id>/source.*` **工作複本**（非原始真身）。使用者在 Word/Excel/PPT 桌面編輯存檔後，工作複本已含新內容，但 doc.md（Hana 的可讀真身投影）尚未跟上。
- **機制**：doc / pptx / workbook 動作列各一顆「**更新AI記憶**」→ `POST /api/documents/:id/refresh-from-source` → 讀工作複本 `source.*` → 依 `type` 重跑轉檔器（`docx-convert.py`／`pptx-convert.py`／`xlsx-convert.py`，`--import <工作複本> <docDir>`）→ 重生 doc.md → `appendDocHistory` 記一筆 `edit`（快照 source.*）→ `setDocDirty`。
- **鐵則**：只碰**工作複本**、**絕不 re-copy 原始真身**（會蓋掉桌面改動）；**不自動寫回真身**（維持既有「寫回真身」手動鈕各司其職，老闆拍板手動）；讀回用**程式**（確定性轉檔器）非 AI prompt。
- **防呆**：source.* mtime 未新於 doc.md → 回「桌面端沒有新變更」不重生。
- **workbook 註**：Excel 存檔已寫入公式快取值 → xlsx-convert.py 直讀即得值，不需線上編輯的 Univer 重算 overlay。

## 11. 三型共用「全螢幕唯讀檢視器」（v0.6，worktable DV1）— ✅ 已上線 v212
- **動機（老闆 2026-07-08）**：想要「像自我介紹簡報那種播放感」——純網頁、無需開 Office，就能把 doc／pptx／workbook 的**真身**當簡報一樣全螢幕翻看。三型行為一致、皆可 −/＋ 縮放。
- **定位**：**唯讀展示**（不含編輯；編輯仍走「線上編輯／桌面開啟」）。
- **入口**：doc／pptx／workbook 動作列各一顆「**全螢幕**」（`maximize` icon，`docFullscreenView`）。
- **實作（重用既有擬真引擎，不新造）**：進原生 `requestFullscreen` 的乾淨 overlay → `fetch('/raw?path=<docDir>/source.*')` 取 arraybuffer → 依型別餵給**與面板相同的**擬真渲染函式：pptx→`_renderPptxInto`、workbook→`_renderSheetInto`、doc→`window.docx.renderAsync`（`breakPages`）。**非有損投影、是 source 真身**。
- **操作**：頂欄 −／＋ 縮放（`zoom` CSS，範圍 0.3–3）＋「100%」重設；`✕` 或系統 **Esc** 離開（`fullscreenchange` 監聽同步收 overlay）。workbook 在全螢幕內**底部頁籤即翻頁**（`_renderSheetInto` 自帶）。
- **純前端**，不需新 API（`/raw` 既有）。

### 11a. pptx 全螢幕改用「投影片翻頁」引擎路徑（v0.6.1，手動改善 2026-07-09）— ✅ 已上線 v219
- **根因**：pptx 擬真引擎 `@aiden0z/pptx-renderer` 的 `list` 模式把所有投影片直向堆疊成一條唯讀 flow、且自帶 `ResizeObserver` 依容器寬把每片撐滿。於是全螢幕出兩個病：(a) 我們對 `doc-fs-body` 套的 **CSS `zoom` 被它的 ResizeObserver 即時抵銷**（−／＋ 沒反應）；(b) **沒有一頁一頁翻頁**。docx/workbook 無此問題（無自我重排）故維持 §11 舊路徑。
- **修法（僅 pptx，docx/workbook 不動）**：全螢幕開 pptx 改用引擎的 **`renderMode:'slide'`（單頁翻頁）＋ `fitMode:'none'`**。`PptxViewer.open()` 回傳 viewer 實例，握著它用原生 API 驅動：
  - **可調比例**：−／＋ 改打引擎原生 **`setZoom()`**（不再跟它搶 CSS `zoom`，故 ResizeObserver 不會把縮放彈回）。
  - **翻頁**：**`goToSlide()`** ＋頁碼（`slideCount`／`currentSlideIndex`）＋底部浮動翻頁列（‹ ›）＋左右方向鍵／空白鍵，一次一整頁，手感對齊自我介紹簡報播放器。
  - **真滿版（contain，寬高一起算）**：引擎自帶的 `fitMode:'contain'` 只用**寬度**定標（`getDisplayMetrics` 內 `scale = 容器寬/頁寬`），在很寬/很矮的螢幕會超出高度被裁。故改用 `fitMode:'none'`（此時 `scale ≡ zoomFactor`），由前端 `_fsPptxFit()` 自算 **`base = min(可用寬/頁寬, 可用高/頁高)`**、乘使用者縮放後 `setZoom(base*userZoom*100)` → 整頁完整可見、置中不裁切；`window.resize` 時重算（`fitMode:'none'` 下引擎自身 ResizeObserver 不會替我們重 fit）。
  - **收場**：離開時 `viewer.destroy()`（斷開引擎 ResizeObserver）、收翻頁列、還原 `doc-fs-body` 樣式，避免殘留污染下一次 docx/workbook 檢視。
- **自測（3 種螢幕長寬比＋原始碼比對通過，v219）**：wide/tall/square 三比例全部 `contained && centered`（wide 轉為高度定標、填滿垂直）；−／＋ 真能改變顯示比例、不被彈回；‹ ›／方向鍵翻頁與頁碼正確；docx/workbook 全螢幕不退化（仍走 §11 CSS zoom）。
- **仍純前端**，不需新 API。

### 11b. workbook 全螢幕頁籤固定在底排（不隨頁籤筆數上下跳）（v0.6.2，手動改善 2026-07-09）
- **根因**：`_renderSheetInto`（index.html）把 `body`（`.hana-sheet-body`，內含 `max-height:70vh` 的 `.hana-sheet-scroll`）與 `tabBar`（`.hana-sheet-tabs`）**依序 append 進容器、兩者皆在常規文件流**。tabBar 緊貼在 body 之下 → **它的垂直位置跟著 body 的高度走**；不同頁籤資料筆數不同 → body 高度不同 → **每切一次頁籤、底部那排頁籤就上下跳**。面板檢視時（body 有 70vh 上限、外層可捲）尚不明顯，但**全螢幕**把整片撐開後跳動很擾眼。
- **修法（僅全螢幕，面板檢視維持 §11 舊行為不動）**：讓 `_renderSheetInto` 接受一個「頁籤固定」旗標（如 `_renderSheetInto(buf, container, { pinnedTabs:true })`），全螢幕的 workbook 分支帶上：
  - 容器（`#doc-fs-body`）改 **`display:flex; flex-direction:column`**；
  - 表格區（`.hana-sheet-scroll`）改 **`flex:1; max-height:none`、自身 `overflow:auto`** → 撐滿頁籤列以上的所有空間、內部捲動；
  - 頁籤列（`.hana-sheet-tabs`）設 **`flex-shrink:0`**，作為欄狀容器的最後一個子元素**永遠貼在底排、不隨內容高度移動**（等同 Excel 底部頁籤列的定位）。
  - 面板檢視**不帶旗標** → 仍是「body（70vh 上限）＋其下頁籤」原樣，零回歸。
- **收場**：全螢幕離開時 `#doc-fs-body` 的行內樣式已由 `docFullscreenView` 的非 pptx 分支重置（`display/padding/zoom` 還原），本次只需確保重置涵蓋新增的 `flex-direction` 等，不殘留污染下一次 docx/pptx 檢視。
- **自測**：同一份「多頁籤、各頁籤筆數差異大」的 xlsx 全螢幕開啟 → 逐一切換頁籤，**底部頁籤列位置紋風不動**（只有上方表格內容換）；長表格在頁籤列以上區域內部捲動、頁籤列不被推走；面板（非全螢幕）檢視觀感與捲動照舊不變。動 `index.html` 走 `Deploy_Harness.ps1` 上線（自動回滾武裝）。
- **仍純前端**，不需新 API。

## 12. 動作列收斂 ＋ 匯出統一成 PDF（照 Office 標準）（v0.6，worktable DV2）— ✅ 已上線 v213
> 動機（老闆 2026-07-08）：三型動作列鈕過多、且「匯出」語意不一（doc 有 pdf/docx 兩顆、pptx 只 pptx、workbook 沒有）。要：① 每型**一顆「匯出」、預設 PDF、照 Word/PowerPoint/Excel 標準版面**；② 動作列**收斂**、三型一致、次要動作收進「更多 ▾」。

**(A) 匯出統一成 PDF（後端，重用既有 doc 的 Playwright 列印機制）**
- **doc → PDF**：已有（`POST /api/doc/export-pdf`，Playwright 列印 I5 分頁的 Word 風版面，逐頁對齊 Word）。維持。
- **pptx → PDF**（新）：**每張投影片一頁、橫向（16:9 landscape）**——照 PowerPoint「匯出成 PDF」標準；把 source.pptx 用 `_renderPptxInto` 渲進列印頁、每片一個 `page-break` → `page.pdf()`。
- **workbook → PDF**（新）：**整本活頁簿、每個 sheet 依序、sheet 間插分頁**——照 Excel「匯出整本活頁簿成 PDF」標準；把 source.xlsx 用 `_renderSheetInto` 逐 sheet 渲進列印頁（每 sheet 間 `page-break`）→ `page.pdf()`。屬「表格列印視圖」，非像素級 Excel 版面（凍結窗格/列印區域不保留）——對 CheckList／資料表夠用；像素級報表版面留待日後（LibreOffice headless）再議。
- **一律不引 LibreOffice**、沿用 doc 那條同一套 Playwright，方便共用冒煙測試。
- 匯出交付沿用既有 `_docSaveBlob`（`showSaveFilePicker` 選路徑、fallback 下載）。

**(B) 動作列收斂（三型一致）**
- **常駐核心**（精簡）：**桌面開啟 ／ 更新AI記憶 ／ 全螢幕 ／ 版本歷史 ／ 匯出（PDF）／ 刪除**。
- **收進「更多 ▾」浮動選單**：線上編輯・寫回真身・並排編輯・文件檢視（doc 專屬）・**匯出原生格式**（doc→docx、pptx→pptx，進階選項）。workbook 的線上編輯本就 P2、一併收。
- **移除獨立「與上一版差異」鈕**：其「放大比對」功能保留在**版本歷史抽屜**內（§3a-2），不另佔動作列一格。
- 三型 `DOC_ACTIONS` 依此收斂；`更多` 選單為外點即收的浮動 popover（比照清單「篩選 ▾」）。

**開放（先採預設、不卡住）**：① 「更多 ▾」用下拉還是 overflow icon → 先下拉；② workbook PDF 若某 sheet 欄過寬 → 先自動縮放/換頁（不做列印區域設定）；③ pptx PDF 是否含備忘稿頁 → 先不含（純投影片頁，與現有 pptx 匯出一致）。

## 13. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-07-09 | v0.6.2 | 老闆 + Hana | §11b workbook 全螢幕頁籤固定底排——`_renderSheetInto` 加 `pinnedTabs` 旗標，全螢幕改欄狀 flex（表格區 `flex:1` 內捲、頁籤列 `flex-shrink:0` 永貼底），解決「切頁籤時因各頁筆數不同、底部頁籤列上下跳」；僅全螢幕，面板檢視零回歸。對應 worktable DV1c。 |
| 2026-07-08 | v0.6 | 老闆 + Hana | §11 三型共用「全螢幕唯讀檢視器」（doc/pptx/workbook 動作列各一顆「全螢幕」，重用擬真引擎渲 source 真身進原生全螢幕 overlay、−/＋ 縮放＋Esc、workbook 底部頁籤翻頁）——**✅ 已上線 v212**；§12 動作列收斂＋匯出統一 PDF（照 Office 標準：doc 逐頁對齊 Word［已有］、pptx 每片一頁橫向、workbook 整本每 sheet 依序插分頁，皆沿用 doc 的 Playwright 列印、不引 LibreOffice；動作列三型一致收斂成 6 顆核心＋「更多 ▾」、移除獨立「與上一版差異」鈕）——**✅ 已上線 v213**（pptx 頁面尺寸改「量測實際渲染框動態注入 `@page size`」而非寫死 16:9，過程中發現並修掉一個 Chromium 怪癖：`page.pdf({width,height})` 與頁面同時存在的全域 `@page{size:A4}` 並存時會把傳入尺寸互換，故統一改走 CSS `@page` + `preferCSSPageSize:true`，見 render-service/doc-pdf.js 註解）。對應 worktable §DV。 |
| 2026-07-08 | v0.5 | 老闆 + Hana | §8 文件型別正名 `sheet`→`workbook`（連程式型別值＋一次性資料遷移＋向後相容，worktable Z1）；§9 桌面編輯回讀「更新AI記憶」按鈕——doc/pptx/workbook 各一顆，讀工作複本重跑轉檔器重生 doc.md＋記一版 `edit`，不自動寫回真身、用程式非 AI（worktable Z2）。兩者分兩筆排程依序自主執行。 |
| 2026-06-28 | v0.4 | 老闆 + Hana | 加 §3a-2「放大比對檢視器 ＋ 流程圖結構 diff」：(A) 流程圖／圖片共用的接近滿版 lightbox——左右⇄上下版面切換（預設依長寬比自動）、各自或同步 zoom/pan（同步鎖）、入口含時間軸「放大比對」與最新版「與上一版差異」；(B) 流程圖專屬結構 diff——用 `bpmnToFlow()` 兩版還原 `{nodes,edges}` 比對節點（新增/刪除/改名/換 lane）與連線（新增/刪除/改標籤/改起訖），SVG 疊色（綠/紅/黃）＋變更清單＋「上下箭頭」逐處置中 highlight，皆即時推導不另存。§5 UI、§7 決議同步。對應 worktable J8（新增 06~08）。 |
| 2026-06-28 | v0.3 | 老闆 + Hana | 加 §3a-1「資產快照（流程圖 `.bpmn`／圖片）」：解決版本歷史「看不出也救不回流程圖／圖片變更」——快照從只存 `doc.md` 擴成「`doc.md` ＋ 本次被改動的 sibling 資產」，事件加 `change`(text/flow/image)＋`assets[]`，存 `history/assets/<rev>/`，用 **copy-on-write 基線**避免出生整包複製；衍生規則（某版資產＝`rev≤N` 最後快照）；還原連資產一起回寫、中間版本不抹；新 API `GET …/history/:rev/asset?path=`；回填舊 log 依 summary 推 `change`。UI（§5）：時間軸類型圖示（✨/🔀/🖼️/📝）＋ diff 依類型可視化（流程圖 SVG 並排／圖片縮圖並排／空文字 diff 提示）。對應 worktable J8。 |
| 2026-06-28 | v0.2 | 老闆 + Hana | 加「狀態與版本歷史」（§3a）：registry 加 `origin`/`bornAt`/`revisions`；每文件 `history/`（快照＋`log.json`），出生+歷次修改合一條時間軸（app 管、鋪在 git 之上，不直接讀 git log）；`appendDocHistory()` helper 接所有編輯入口；history API（list/get-rev/restore）；既有文件回填。UI（§5）：清單極簡 badge（型別＋來源兩字膠囊＋已修改琥珀圓點）、搜尋框旁「篩選 ▾」浮動下拉（型別／來源／狀態多選）、動作列加「版本歷史」抽屜。對應 worktable J5/J6/J7。 |
| 2026-06-27 | v0.1 | 老闆 + Claude | 初版。文件以 registry 管理、檢視器（左清單＋右預覽，像 AI 對話，含實際位置小字、搜尋、型別分類）；真身 md/素材由系統控管於各工作區 `.documents/`（git 追蹤，`_harness` 不碰客戶資料）；匯入＝檔案樹複選 → 確定 → 批量轉檔，已存在則提示略過/覆蓋；registry schema 與 front-matter 一致；storage/git 模型（資料屬於專案工作區）。串起 doc-convert/document-framework/doc-editing/block-deck。 |
