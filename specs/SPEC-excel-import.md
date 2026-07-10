# SPEC — Excel 匯入（試算表瀏覽 → 可解析 → 線上編輯）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 開源
> 影響範圍：`portal/server.js`（import-tree 型別過濾、匯入 convert 派工、source 複本、asset MIME、type=`sheet` 分派）、`portal/index.html`（匯入樹 accept、擬真預覽 `_renderDocFidelity` 新增 sheet 分支、Phase 2 編輯器）、**新增** `portal/render-service/xlsx-convert.py`、各工作區 `.documents/`。
> 動機（2026-07-07 與 老闆）：客戶資料很多是 Excel。Excel 兩個麻煩：**有公式**、**多頁籤**。老闆要的最低標＝「即便不能編輯，也要能在畫面上瀏覽資料，且對應 `doc.md` 要能解析表格內文字，方便 Hana 快速查找」；再上一層才是線上編輯。
> 本 spec 是「文件管理」既有插槽（docx／pptx）的**第三種型別**：走一模一樣的匯入 → 轉 doc.md → 擬真預覽 → 版本歷史管線，不動容器層架構。相依 `SPEC-document-registry`、`SPEC-doc-convert`。
> ⚠️ 文件內任何 HTML 樣式標籤一律用反引號包。

---

## 1. 核心原則（沿用既有插槽，不重造）

Excel 接進來走的是和 docx/pptx **完全相同的插槽**——只是多一個 `type` 與一支 convert：

| 插槽 | docx | pptx | **xlsx（本 spec）** | 位置 |
|---|---|---|---|---|
| import-tree 型別過濾 | `.docx` | `.pptx` | **`.xlsx`（＋`.xlsm`？見 §7）** | `server.js:2080` |
| convert 派工 | `docx-convert.py` | `pptx-convert.py` | **`xlsx-convert.py`（新）** | `server.js:2163` |
| source 工作複本 | `source.docx` | `source.pptx` | **`source.xlsx`** | `server.js:2153` |
| registry `type` | `doc` | `pptx` | **`sheet`** | `server.js:2182` |
| 擬真預覽分支 | `docx.renderAsync` | `_renderPptxInto` | **`_renderSheetInto`（新）** | `index.html:_renderDocFidelity` |

> 一句話：**Phase 1 只是「多教系統認得一種副檔名」**——不碰 registry / 版本歷史 / 匯入對話框 / 工作區隔離等既有機制。

---

## 2. Storage 與資料模型

沿用 `SPEC-document-registry §2`，每份試算表一個 UUID 夾：

```
.documents/<uuid>/
  source.xlsx          ← 原始檔工作複本（先複製再解析；真身，Phase 2 回寫對象）
  doc.md               ← 可查找文字真身（多頁籤 → 多段 GFM 表格，見 §3.2）
  assets/              ← （少見）xlsx 內嵌圖片，如有則抽出
  history/             ← 版本歷史（J5/J8 既有機制；Phase 2 快照 source.xlsx）
```

registry（`.documents/index.json`）該筆：`type: "sheet"`、其餘欄位（`sourcePath`/`origin`/`bornAt`/`revisions`…）與既有一致。清單顯示名由 `sourcePath` 去副檔名推導（同既有規則）。

---

## 3. Phase 1 — 瀏覽 ＋ doc.md 可解析（低成本、正中最低標）

> 目標：老闆能在 portal 上瀏覽每個頁籤的資料（含公式的「結果值」看得到）；Hana 能用全文查找在 `doc.md` 命中表格文字。**唯讀，不寫回。**

### 3.1 `xlsx-convert.py`（機械轉換，openpyxl）

新增 `portal/render-service/xlsx-convert.py`，輸入 `source.xlsx`，輸出 `doc.md`（＋ manifest stdout，比照 docx/pptx-convert 慣例）：

- **多頁籤 → 多段**：`wb.worksheets` 逐個 sheet → 一段 `## <頁籤名>` ＋ 一張 GFM 表格。多頁籤天生對應 md 多段落，Hana 查找時可依段落定位到哪個 sheet。
- **公式的兩種讀法**（openpyxl，關鍵取捨）：
  - `data_only=True` → 取 **Excel 上次存檔時算好的快取值**（顯示用；老闆看得到「結果數字」）。
  - `data_only=False` → 取 **公式原文**（如 `=SUM(A1:A9)`；備查用）。
  - **策略**：一次開兩份（或一份切換）。儲存格若是公式 → md 表格填「快取值」；**在該儲存格值旁或表格後，附一份「公式對照」小區塊**（`儲存格 → 公式原文`），使結果與公式都可被查找、又不汙染主表可讀性。細節見 §7 待拍板 #2。
  - **快取值缺失**（該檔從未在 Excel 存過、或以程式產生）→ openpyxl `data_only` 讀到 `None` → 顯示公式原文並標「（未計算）」。Phase 1 **不自行重算**（重算屬 Phase 2）。
- **範圍界定**：只轉「有內容的範圍」（`ws.dimensions` / `min_row..max_row`），避免把百萬空列灌進 md。空白 sheet → 標「（空白頁籤）」。
- **型別呈現**：日期/數字依 openpyxl 的 value 直接字串化；合併儲存格取左上值、其餘留空（Phase 1 不還原跨欄合併版面，屬預覽層 §3.3）。
- **內嵌圖片**：如 sheet 有圖片，抽到 `assets/`（比照 docx-convert），md 以 `![]()` 引用；多數資料表無圖，此步常無輸出。
- **相依**：`openpyxl`（`pip install openpyxl`；純 Python、跨平台，老闆 venv 現成生態）。**不新增人工安裝負擔即 `/setup` 影響**見 §6。

### 3.2 `doc.md` 結構（範例）

```markdown
## 工令主檔

| 工令號 | 品名 | 數量 | 單價 | 金額 |
|---|---|---|---|---|
| WO-001 | 軸承 | 100 | 12.5 | 1250 |
| … |

<!-- 公式對照（工令主檔）
E2 = C2*D2
E3 = C3*D3
-->

## BOM 明細
| … |
```

> 公式對照放 HTML 註解或摺疊區塊（見 §7 #2）：**渲染時不干擾閱讀，但仍是 `doc.md` 純文字 → Hana grep 得到、版本歷史也 diff 得到**。

### 3.3 唯讀多頁籤預覽（前端）

擬真預覽 `_renderDocFidelity`（`index.html`）新增 `type==='sheet'` 分支 → `_renderSheetInto(buf, area)`：

- **底部頁籤列**（每個 sheet 一個 tab，點擊切換），對齊 Excel 觀感。
- 每個 sheet 渲染成唯讀表格：**凍結首列**、可捲動、儲存格 hover 顯示「公式原文」（若是公式）。
- **技術選型（Phase 1）**：**SheetJS `xlsx`（Apache-2.0）** 的 `sheet_to_html` 直出唯讀 HTML，最輕；純前端讀 `source.xlsx` arraybuffer（比照 `_renderPptxInto` 取 buffer 的方式，經 `GET …/asset` 或既有 source 端點）。→ 前端不必自己算公式，SheetJS 讀 xlsx 內的快取值即可顯示。

### 3.4 匯入整合點（逐一，最小改動）

1. `server.js:2080` import-tree 過濾正則 `/\.(docx|pptx)$/i` → 加 `xlsx`。
2. `index.html` 匯入對話框 accept 與圖示 → 認 `.xlsx`（試算表圖示）。
3. `server.js:2153/2163/2182` convert 派工三處 → `.xlsx` → `source.xlsx` ＋ `xlsx-convert.py` ＋ `type:'sheet'`。
4. `server.js:2432` 附近 asset/預覽 MIME → `.xlsx` 補 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`（別落 `octet-stream`，比照 W1/J8FIX 的 pptx/docx 正名）。
5. `index.html` `_renderDocFidelity` → 加 sheet 分支呼叫 `_renderSheetInto`。
6. 文件動作列（`DOC_ACTIONS`）：sheet 型別暫時**隱藏「編輯／回寫／匯出 docx」等不適用鈕**，只留「版本歷史」等通用鈕（Phase 2 再開編輯鈕）。

---

## 4. Phase 2 — 線上編輯 ＋ 公式重算 ＋ 寫回（重、視需求）｜🚫 **捨棄（老闆 2026-07-08）**

> 🚫 **本整節（網頁內建試算表編輯器）取消。** 老闆 2026-07-08 拍板：改用 **桌面編輯（`open-desktop` 開 source.xlsx 工作複本，用 Excel 本尊改）＋「更新AI記憶」一鍵回讀**（見 `.worktable/TASK.md §Z2`）取代網頁內線上編輯。理由：桌面端由 Excel 自己處理公式/樞紐/圖表＝零失真，回讀只需重跑 `xlsx-convert.py`（存檔已含快取值），比 Univer overlay 更乾淨，且完全繞開下方 §4.1 的 OSS Univer 授權糾結。§7 #4/#7 待拍板決策一併作廢。以下 §4.x 保留為歷史記錄。
> ~~目標：在 portal 直接改儲存格、公式即時重算、存檔後寫回 `source.xlsx`。~~

### 4.1 編輯器（前端）

以能「多頁籤 ＋ 公式重算 ＋ 編輯」為準，候選（見 §5）：
- **Univer（dream-num，Apache-2.0）**：最接近 Excel——多 sheet、內建公式引擎、儲存格編輯；體積較重。**建議首選**（授權乾淨、功能到位）。
- 備案 **x-spreadsheet（MIT）＋ HyperFormula**：輕但 HyperFormula 是 **GPL/商用雙授權**（見 §5 授權評估），採用前須確認能接受 GPL 或改用其社群版條款。

> ⚠️ **落地時修正的重要前提（2026-07-08 XLSX-05 實作發現，取代舊「編輯器讀 source.xlsx arraybuffer」的假設）**：
> **OSS 版 Univer（Apache-2.0）並不能直接匯入/匯出 `.xlsx` 二進位**——xlsx exchange（檔案↔Univer snapshot 的轉換）是 **Univer Pro（`@univerjs-pro`，商用授權）** 的功能，且需搭配伺服器端轉換服務。OSS Univer 只吃自家的 `IWorkbookData` snapshot JSON。
> 因此若要同時滿足「用 Univer」＋「§5 零授權風險（純 Apache-2.0/MIT）」，**必須加一層橋接**：用**已 vendored 的 SheetJS（Apache-2.0）**把 `source.xlsx` arraybuffer 讀成工作表資料 → 轉成 Univer snapshot 餵給編輯器；存檔時**不靠 Univer 重新序列化 xlsx**（那才是失真來源），而是收集「變更集」交給後端 openpyxl 回寫（§4.3，天然滿足「只改被動格」）。
> 這是**架構層的新增**（原 spec 未預期），也修正 §5 對「Univer 讀 source.xlsx 零授權風險」的隱含錯誤（直接 xlsx exchange 屬 Pro）。**待拍板見 §7 #7。**

編輯器資料流（Apache-2.0/MIT 全程）：`source.xlsx` arraybuffer ──SheetJS──▶ Univer snapshot ──編輯/重算──▶ 收集變更集（sheet/cell→值或公式＋重算值）──▶ 後端 openpyxl 回寫。

### 4.2 公式重算

- Univer 自帶公式引擎 → 改一格即時重算相依格（Excel 體感）。
- 支援範圍以「常用函式」為界（SUM/IF/VLOOKUP/算術…）；**罕見函式、樞紐、巨集（VBA）不支援**，誠實標示（見 §6）。

### 4.3 寫回 `source.xlsx`（後端）── 已實作（XLSX-06）

`portal/render-service/xlsx-writeback.py`（openpyxl）：
- 前端送「變更集」→ openpyxl 打開 `source.xlsx`、**只改被動的儲存格**、其餘（格式/其他 sheet/圖表）由 openpyxl round-trip 保存、存回。
- **變更集契約**（前端→ `POST /api/documents/:id/sheet-writeback`）：
  ```json
  { "changes": [ {"sheet":"工令主檔","cell":"E2","formula":"=C2*D2","value":"1875"},
                 {"sheet":"工令主檔","cell":"C2","value":150} ],
    "values":  {"工令主檔":{"E2":"1875","E3":"600"}},   // 編輯器重算值，供 doc.md overlay（見下）
    "baseMtime": 1720000000000 }                          // 開編輯器時 source.xlsx 的 mtime（樂觀鎖）
  ```
  - `formula`（以 `=` 開頭）→ 寫公式原文（Excel 開檔自行重算，openpyxl 不重算）；否則寫 `value`（自動判型）。
- **CLI**：`python xlsx-writeback.py --edits <edits.json> <source.xlsx>` → `{ok,changed,skipped,errors,sheets}`。
- **樂觀鎖（取代舊「mtime 新於投影先重生」設計）**：後端比對 `baseMtime` 與現在 `source.xlsx` mtime，若被外部（Excel）改過 → **回 409**，要求先重開編輯器再送，避免蓋掉 Excel 端改動（對齊 §K 安全紀律的意圖）。
- **回寫後重生 doc.md（值 overlay）**：openpyxl 重存**不保留任何公式快取值** → 若直接重生，doc.md 的公式格會全變「（未計算）」。故回寫成功後用 `xlsx-convert.py --values <editor值.json>` 重生：公式格快取為 None 時**以編輯器重算值補位**，保住 doc.md 文字真身可查找。
- **取捨（誠實）**：openpyxl 重存 xlsx 不保證位元保真；實測失真清單見 §6，UI 對高風險檔（樞紐/巨集）警告或降級唯讀（XLSX-08）。

### 4.4 版本歷史整合（延伸 J8 / K）── 後端已實作（XLSX-07）

- 每次回寫（sheet-writeback 端點）記一筆 `edit` 事件並**快照 `source.xlsx`**（`assets:[{type:'source', path:'source.xlsx', beforeContent:<舊 buffer>}]`，與 §K 對 source.docx/pptx 完全相同的 `appendDocHistory` 機制）＋ `setDocDirty(true)`。
- 版本歷史「放大比對」對 sheet：無 bpmn 語意層 → **擬真並排**（前後兩版以既有 `_renderSheetInto` 唯讀渲染）＋ `doc.md` 快照逐行 diff（比照 W1）。動作列的「版本歷史／與上一版差異」鈕 Phase 1 已對 `type:'sheet'` 開放，沿用即可。

### 4.5 風險偵測端點（XLSX-08）── 已實作

- `GET /api/documents/:id/sheet-risk` → 跑 `xlsx-writeback.py --detect <source.xlsx>`，回
  `{ok, risks:{charts,pivots,conditionalFormats,vbaMacros,dataValidations,mergedCells,definedNames,images},
     highRisk, reasons:[…], warnings:[…], sourceMtime}`。
- 前端進「編輯」前呼叫：`highRisk`（樞紐/巨集）→ 建議**降級唯讀**或強警告；`warnings`（圖表/條件式格式…）→ 提示可續。`sourceMtime` 供前端 pin `baseMtime` 做樂觀鎖。

---

## 5. 套件與授權決策

| 套件 | 授權 | 定位 | 採用 |
|---|---|---|---|
| **openpyxl** | MIT | 後端讀/寫 xlsx、公式原文＋快取值、多 sheet | ✅ Phase 1＋2 後端 |
| **SheetJS `xlsx`** | Apache-2.0 | 前端唯讀多頁籤 `sheet_to_html` | ✅ Phase 1 預覽 |
| **Univer**（dream-num） | Apache-2.0 | 前端 Excel 級編輯＋公式重算 | ✅ Phase 2 首選 |
| x-spreadsheet（myliang） | MIT | 輕量可編輯試算表（無公式引擎） | ⚪ 備案（需搭公式引擎） |
| HyperFormula | **GPL / 商用雙授權** | 純公式引擎 | ⚠️ 採用前須確認可接受 GPL |
| Handsontable | **非商用免費 / 商用收費** | 成熟表格 UI | ❌ 授權有商用限制，避開 |
| Luckysheet | MIT | 功能多但已轉維護 Univer | ❌ 不採新專案 |

### 授權結論（老闆 2026-07-07 提問：Apache-2.0 會不會侵權？）

- **Apache-2.0 是寬鬆授權（permissive），不是「非商用授權」**：允許商用/非商用/閉源/開源/販售全部用途。本專案「開源、非商用、不販售」是它最沒爭議的情境，**不會侵權**。
- **義務只有文書層**：保留原專案的授權條款副本與著作權聲明；若原專案帶 NOTICE 檔一併保留；改了它的原始碼要在改動處註明。附帶好處：Apache-2.0 含**明確專利授權**，比 MIT 更能防原作者拿專利反咬。
- **要留意的是別的類型，不是 Apache-2.0**：① **copyleft（GPL）有傳染性**（HyperFormula）——用了它整包也要 GPL 開源；② **「商用收費」型**（Handsontable）——非商用免費、商用要授權金。→ 本 spec 主線（openpyxl / SheetJS / Univer）**全避開這兩種風險**，可安心採用。

> 收斂：Phase 1＝openpyxl ＋ SheetJS；Phase 2＝openpyxl ＋ Univer。三者皆 MIT/Apache-2.0，對本專案零授權風險。

---

## 6. 限制（誠實）＋ 回寫失真清單（XLSX-08 實測，openpyxl 3.1.5）

- **Phase 1 不重算公式**：只顯示 Excel 存檔時的快取值；檔案若從未在 Excel 存過，公式格顯示原文＋「（未計算）」。重算屬 Phase 2。
- **超大表**：百萬列會拖慢 md 與預覽 → 只轉有內容範圍；超限時分段或標示截斷（不靜默吞）。
- **相依安裝**：`openpyxl`（pip，跨平台，venv 現有 3.1.5）＋前端 SheetJS（已 vendored `portal/vendor/xlsx.full.min.js`）＋ Univer（待 vendored，見 §7 #7）。openpyxl 非 `/setup` 目前列管依賴 → 隨公開版出貨須評估納入 `/setup`。

**回寫失真清單（實測 `load_workbook → save → reload`，非套用「圖表一定遺失」的過時傳言）**：

| 結構 | 實測結果（openpyxl 3.1.5） | 分級 | 處置 |
|---|---|---|---|
| **公式快取值** | openpyxl 重存**不寫入任何公式快取** → 非 Excel 讀取者（含 doc.md）見公式格為「未計算」；Excel 開檔會自動重算補回 | 固定行為 | doc.md 用編輯器重算值 overlay 補位（§4.3）；Excel 端無感 |
| **圖表 chart** | 簡單長條圖 round-trip **可保留**（series/標題存活）；但複雜樣式/資料標籤/次座標軸不保證，且跨 openpyxl 版本行為不一 | ⚠️ 警告 | 續行，橫幅提示「圖表可能微失真」 |
| **條件式格式** | 基本 `CellIsRule` round-trip **可保留** | ⚠️ 警告 | 續行；色階/資料橫條/圖示集等進階規則可能降級 |
| **資料驗證** | 基本清單/範圍 round-trip **可保留** | ⚠️ 警告 | 續行；跨表引用可能失真 |
| **合併儲存格** | round-trip 可保留 | ✅ | — |
| **樞紐分析表 pivot** | openpyxl 對樞紐支援薄弱，回寫易失效/需重整 | 🔴 高風險 | **建議降級唯讀**或強警告 |
| **VBA 巨集（.xlsm）** | 回寫可能破壞/無法保留，且巨集不執行；本 spec 預設只收 `.xlsx`（§7 #1） | 🔴 高風險 | **建議降級唯讀**；巨集邏輯永不支援 |

> `highRisk = 樞紐 OR 巨集`（這兩類 openpyxl 最易破壞）→ 前端降級唯讀/強警告；圖表/條件式格式/資料驗證＝可續的 `warnings`。判定由 `xlsx-writeback.py --detect` 實測該檔實際含哪些結構後回報，非硬編。

---

## 7. 決議 / 待拍板（先採預設、記錄，勿卡住）

- ✅ **走既有插槽**：`type:'sheet'` ＋ `xlsx-convert.py`，不動容器層。
- ✅ **Phase 1 唯讀**：openpyxl 轉 doc.md（多頁籤 GFM ＋ 公式快取值）＋ SheetJS 唯讀預覽。
- ✅ **授權**：openpyxl(MIT)/SheetJS(Apache-2.0)/Univer(Apache-2.0) 對本開源非商用專案零風險；避開 GPL(HyperFormula) 與商用收費(Handsontable)。
- 待拍板 #1：`.xlsm`（含巨集）是否也收（預設**先只收 `.xlsx`**，巨集不執行）。
- 待拍板 #2：公式在 doc.md 的呈現——HTML 註解 vs 摺疊區塊 vs 表格內「值｜公式」雙行（預設**HTML 註解式公式對照**，可查找又不擾閱讀）。
- 待拍板 #3：Phase 1 預覽用 SheetJS `sheet_to_html`（預設）vs 自畫表格；是否還原合併儲存格版面（預設**先不還原、取左上值**）。
- 🚫 **待拍板 #4 作廢**：Phase 2 線上編輯整條捨棄（改走桌面編輯＋更新AI記憶，見 §4 頂註／TASK §Z2），編輯器選型無需再定。
- ✅ **待拍板 #5 已定（XLSX-08 實測）**：`highRisk = 樞紐 OR VBA 巨集` → 前端降級唯讀/強警告；圖表/條件式格式/資料驗證＝可續的 warnings（見 §6 清單）。
- 待拍板 #6：openpyxl 是否納入 `/setup` 列管依賴（隨公開版出貨才需要）。
- 🚫 **待拍板 #7 已作廢（老闆 2026-07-08 拍板整條線上編輯捨棄）**：原問「OSS Univer 不能直接讀寫 .xlsx，要用 (A) SheetJS 橋接 Univer／(B) 更輕的可編輯表格／(C) Univer Pro」——三案皆不採，因為**不再做網頁內編輯器**，改走桌面編輯＋更新AI記憶（§4 頂註／TASK §Z2）。後端（XLSX-06/07/08：回寫、版本快照、風險偵測、端點）曾實作並部署，現隨線上編輯退役、保留在庫不刪、暫不接線。

---

## 8. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-07-07 | v0.1 | 老闆 + Hana | 初版。Excel 匯入走既有 docx/pptx 插槽（`type:'sheet'`＋`xlsx-convert.py`）。Phase 1＝唯讀瀏覽＋doc.md 可解析（openpyxl 多頁籤 GFM＋公式快取值＋公式原文對照；SheetJS 唯讀多頁籤預覽；五處整合點）。Phase 2＝線上編輯＋公式重算（Univer）＋寫回 source.xlsx（openpyxl，誠實標失真風險）＋版本歷史快照。含套件比較與 Apache-2.0 授權澄清（對本開源非商用專案零風險；避開 GPL/商用收費類）。 |
