# SPEC — Document Editing / Preview / Deliver（B+C 方案）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/render-service/`（docx-convert 批量、md-to-docx 品質、paged 預覽、pdf）、`portal/index.html`（文件化預覽、預覽真產出按鈕，掛在 `SPEC-document-framework` 的動作列）、`portal/server.js`（既有匯出 API + 批量端點）
> 動機（2026-06-26 與 老闆）：客戶解決方案文件原為 docx（含 Visio 流程圖、內嵌物件、複雜排版）。需求：**(1)「編輯中」要接近實際產出**（現在 md 流動式渲染離 Word 太遠）；**(2) 交付物要 client-ready**（現在 md→docx 不能直接給客戶）；**(3) 流程圖要可改、可精準版本追溯**。
> 決策（已評估，見對話）：**不做能回存的 docx 線上編輯器**（OOXML 反向對映＝整個 Word 難題，viewer 加不上去）；**不上重型 ONLYOFFICE**（二進位 docx 失去 git 精準追溯、Visio 仍卡）。改走 **B+C**：md 為真身、文件化預覽 + 預覽真產出。
> ⚠️ 文件內任何 HTML 樣式標籤一律用反引號包（見 `TASK.md H1`）。

---

## 1. 核心原則 / 工作流
**真身 = md（+ 流程圖 bpmn）；docx/pdf = 生成的交付物。** 編輯永遠在 md，git 精準追溯改了哪些字；流程圖真身是 `flow.json`/```bpmn（portal bpmn 編輯器可改）。

```
客戶 docx ──(import: doc-convert，可批量)──▶  md（+ ```bpmn 流程圖）  ◀── 編輯（portal；git 追 md/flow.json）
                                                  │
                          ┌───────────────────────┼───────────────────────┐
                    B. 文件化預覽            C. 預覽真產出             交付物
                  (paged.js + Word CSS)   (生成 docx → docx-preview)   docx（高品質）/ pdf（B 的列印）
```

---

## 2. 現況痛點
- **md 渲染不像文件**：流動式 HTML，無頁面/邊界/字體/分頁 → 看起來離 Word 很遠。
- **md→docx 不 client-ready**：`md-to-docx.py` 產出陽春（樣式弱、bpmn 只放文字佔位、圖片硬塞 5 吋）。
- **流程圖**：客戶原檔是 Visio（線上不可編）；已於 doc-convert 重建成 ```bpmn（可編、git 可追）。

---

## 3. B — 文件化預覽（編輯中接近產出）
- md 檢視器加一個 **「文件檢視」模式**：用 **paged.js**（CSS 分頁）+ **Word 風 CSS**（A4/Letter 頁面、邊界、字體、標題層級、表格樣式、分頁符）渲染 → 看起來是「一份有頁的文件」，而非流動網頁。
- 流程圖在此模式以 **SVG**（bpmn 渲染）內嵌，向量清晰。
- 與 `DOC-P3-01`（分頁檢視）合流：原本就要 paged.js，這裡把它升級成「Word 風文件樣式」。
- **這個 render 一物兩用**：既是「編輯中預覽」，也是下面 pdf 交付物的來源（列印同一份 render）。

## 4. C — 預覽真產出（看交付的 docx 長怎樣）
- 動作列加 **「預覽 docx」**：呼叫 md→docx 生成 → 用 **docx-preview**（JS，唯讀高保真）在 portal 內渲染那份 docx → 看到接近實際交付物的樣子。
- 唯讀；要改回去改 md。用於「交付前確認 docx 版面」。

## 5. 交付物（client-ready）
兩種，依客戶是否要自己改：
- **pdf（推薦給「只看」的客戶）**：把 B 的 paged.js render **列印成 pdf**（Playwright/無頭 Chrome，比照 `render-service/screenshot.js`）→ **跟你預覽看到的一模一樣、最高保真、universal**。
- **docx（給「要自己改」的客戶）**：**升級 `md-to-docx.py` 品質**——套乾淨文件範本樣式、**bpmn→SVG 真嵌入**（見 `DOC-P4-01` 修正）、圖片依原尺寸等比、表格樣式。目標：**直接可交付**。

## 6. 批量轉檔工具（import）
- `docx-convert.py` 包一層「**資料夾批量**」：給一個目錄 → 逐一 docx→md（含素材抽取、流程圖→```bpmn 的既有流程）→ 輸出到指定資料夾。
- 入口：CLI + portal 一個「批量轉檔」按鈕/面板（選來源資料夾 → 進度 → 完成清單）。
- 流程圖：批量時 Visio/圖片流程圖→```bpmn 仍需 AI 判斷（沿用 `word-to-md` skill 的逐圖分類）；批量先做「機械轉換 + 圖片抽取」，流程圖重建可標記待人工/Hana 補。

## 7. pptx 平行（先回答、暫不主攻）
- pptx 的「真身」= **block deck（.blocks.json）**。**新簡報**用 block deck 寫＝乾淨（可編 + 匯出可編輯 pptx + 網頁預覽，見 `SPEC-block-deck.md`）。
- **舊客戶 pptx → block deck import 很有損**（pptx 自由佈局 vs 7 種固定版型）→ 不自動化，個案手動。
- 要忠實編輯任意客戶 pptx＝ONLYOFFICE（重型，不在本案範圍）。
- 預覽：block deck 用網頁 render（`block-deck-player`）；要看真 pptx 用 pptx viewer（如 pptxjs，C 的 pptx 版，後續）。
- ⚠️ pptx 擬真預覽的**渲染引擎健壯性需求與根因分析見 §12**（L1 落地後反覆炸掉的真正原因與重新設計）。

---

## 8. 與既有 spec 的關係
- `SPEC-doc-convert.md`：import（docx→md）+ 批量是它的延伸。
- `SPEC-document-framework.md`：B/C/交付的按鈕掛在「每文件動作列」。
- `SPEC-block-deck.md`：pptx 真身。
- `DOC-P3-01 / DOC-P4-01`（TASK E）：paged.js、md→docx 品質、bpmn→SVG 在本案被升級。

## 9. 待拍板（遇到先採預設、記錄，勿卡住）
1. 頁面尺寸預設 A4 vs Letter？→ 先 A4，可設定。
2. pdf 引擎：Playwright（已有）vs 其他？→ 用 Playwright（已用於簡報截圖）。
3. docx 範本：自製乾淨樣式 vs 套客戶 CI？→ 先自製乾淨範本。
4. 批量流程圖：自動重建 bpmn vs 標記待補？→ 先標記待補，避免批量誤判。

---

## 11. L2 擬真上編輯 — 拍板 **A**（2026-06-30 老闆）

> ⚠️ **本節（Path A）已於 2026-07-02 被 §13 取代（老闆重開 C＝擬真上就地編輯）。** §11.1–11.3 保留供追溯；`DOC-L2-01/02/03/04` 的成果（並排雙欄、run 級回寫、換圖回寫 source）**仍然有效、被 §13 複用**，只是「編輯發生在哪一欄」由「左邊 md 投影」改成「右邊擬真畫面就地」。§11.3「不在渲染結果上 inline 編輯」這條**明確被 §13 推翻**。
> 承 §9 開放決策與 `TASK.md §L2`：「在擬真預覽上編輯」兩條路 A／B，**老闆拍板 A**。

**A＝編輯落在 md 投影、擬真預覽並排對照、送出走已完成的 §K（`SPEC-doc-roundtrip`）回寫到 source。** 不做 B（在 pptxjs／docx-preview 渲染結果上 inline 編輯再反向對映＝近 Word/PowerPoint 難題），成本高、本案不採。

### 11.1 版面與分工
- **並排雙欄**：左＝**md 投影編輯**（寫）、右＝**擬真預覽**（讀，docx→docx-preview／pptx→pptxjs，即 `L1`）。一鍵切換或同框並列。
- **文字**：由 Hana 改（老闆提需求、Hana 編 md）→ 送出走 **§K run 級回寫**到 `source.docx`／`source.pptx`（只動被改的字，原檔其餘 byte 不碰）→ 回預覽即見最新真身。
- **圖片**：老闆自己換。**換圖 UX 完全沿用既有「docx 線上編輯更換圖片」那套**（`J1`：hover 圖片→「更換圖片」→上傳→`POST /api/documents/:id/image`，改寫 doc.md 第 N 個 `![]`、存進 `.documents/<uuid>/assets/`、記版本歷史 `change:'image'`）。**不另造一套換圖介面。**

### 11.2 換圖要落到 source（真身一致性）
- 現況落差：`J1` 的 `/image` 只改 **doc.md 投影**；§K 的 `docx-writeback.py` 是**純文字回寫、不碰圖**。在「source 為真身」前提下，換完圖**真身（source）裡的圖沒換** → 預覽（讀 source）看不到、交付物還是舊圖。
- 解法（沿用 §K 既有錨點，不發明新對映）：換圖時除了改 doc.md，**把新圖塞回 source 對應的圖元**——
  - **docx**：用 `K1-02` 注入的圖錨點 `wp:docPr id` 定位該 `<w:drawing>`／`a:blip r:embed` 指向的 media part → 換掉 `word/media/<x>`（保留原 part 名與關聯，只換 binary）。
  - **pptx**：`K4` 已宣告「圖／流程圖走既有換圖路徑」（shape 用 `p:cNvPr id` 定位）→ 換 `ppt/media/<x>` binary。
- 流程圖（```bpmn）走既有 bpmn 編輯器存檔路徑，不在「換圖」範圍。

### 11.3 不做（明確排除）
- 不在預覽渲染結果上 inline 點字編輯（B）。
- 不做圖片裁切／縮放／位置編輯（只換 binary，位置版面沿用原檔錨點）。

## 12. pptx 擬真預覽渲染引擎 — 根因與健壯性重新設計（2026-07-02）

> ⚠️ **路線變更（2026-07-02，老闆拍板）：本節 §12.1–12.5 描述的 Path A（硬化 `pptx2html.js` / PPTXjs fork）已被 §12.6 取代。**
> §12.1–12.5 保留供**追溯**（含根因分析與 `DOC-L1-FIX02` 的健壯性地板成果），但**渲染引擎不再繼續押在 PPTXjs 老 fork 上**——改採新世代 **aiden0z/pptx-renderer** 整個汰換（見 §12.6、落地 `TASK.md DOC-L1-04`）。`DOC-L1-FIX02` 的防呆成果視為「汰換完成前的過渡地板」，新引擎驗證通過並上線後 `pptx2html.js` 退役。

> 承 L1（`DOC-L1-01/02/03` 已上線）與 `TASK.md DOC-L1-FIX01`。實測範例專案 `kic.pptx`：按「擬真預覽」反覆在**不同位置**炸掉（`getSchemeColorFromTheme`、`thisTblStyle['a:firstRow']`、`warpObj.slideMasterTextStyles`、`JSZip 3.0 asArrayBuffer`……）。逐行補一個炸點只是打地鼠——本節定性真根因、重列渲染需求、給出重新設計與開放決策。

### 12.1 真正的根因（一句話：脆弱的第三方渲染器 + 逐行防呆無界）
- pptx 擬真預覽用 `portal/vendor/pptx2html.js`——一個 **PPTXjs 的老 fork**（~9,166 行、已停止維護、預先轉譯含 `regeneratorRuntime`）。
- 它把 pptx 的 OOXML 沿 **slide → layout → master → theme** 鏈做**大量深層節點取值**，且**假設 pptx 結構「典型且完整」**，對數十處巢狀節點**未做空值防呆**就直接取值：
  - `getSchemeColorFromTheme(...)`（主題缺配色）— 已補過一次
  - `thisTblStyle['a:firstRow']` / band 樣式（表格缺 `tblStyle`）— 已補過一次
  - `warpObj['slideMasterTextStyles']`←`p:sldMaster/p:txStyles`（master 無 txStyles）— 本次炸點
  - ……檔案內尚有**上百處**同型深取值，都是潛在炸點。
- 真實客戶 pptx（節點變體／缺省，如 master 無 `txStyles`、表格無 `tblStyle`、主題缺某 scheme color）→ **每次都在不同的未防呆處炸**。**逐行補一個是無界的打地鼠**，這才是「此功能從未穩定可用」的根因，而非某一支 API 的問題。
- **另一支獨立症狀（同屬脆弱面）**：vendor 的 `jszip.min.js` 為 **3.10.1**（為 docx-preview 裝），但 `pptx2html.js` 抽圖仍用 **JSZip 2.x 同步 API**（`zip.file(x).asArrayBuffer()`，3.x 已移除）→ 幾乎每張有圖的片都炸（原 `DOC-L1-FIX01`）。**不可降回 2.x**（會弄壞共用同一全域 `JSZip` 的 docx 擬真預覽）。

### 12.2 關鍵不對稱（為什麼 import 從不炸、預覽一直炸）
- pptx **import（pptx→md，`render-service/pptx-convert.py`）用 python-pptx**：成熟、維護中、伺服器端解析——**從不因客戶檔變體而崩**。
- 只有**視覺擬真預覽**用客戶端的 `pptx2html.js`——脆弱面全集中在這裡。→ 問題**不在 pptx 檔本身**，而在**選了一個對真實檔不夠健壯的渲染器**。

### 12.3 渲染需求（重新設計的驗收標準）
1. **預覽永不整體硬失敗（健壯性地板）**：單張投影片渲染出錯 → **該片降級為佔位卡**（例：「⚠️ 此片渲染失敗（缺 XXX 節點），其餘正常」），**其餘片照常渲染**。絕不再出現「一片炸、整個預覽白掉」。
2. **取值鏈一律容忍缺節點**：master/layout/theme/table 的深取值鏈，缺節點時**回退合理預設**（預設字體/字色/對齊/無框），不 throw。
3. **JSZip 統一 3.x async**：抽圖改 `await zip.file(x).async('arraybuffer')`（連帶把呼叫鏈改 async）；**全域 JSZip 維持 3.x**，與 docx-preview 共存。
4. **誠實標示**：有片降級時，預覽頂部橫幅提示「N 張投影片以佔位呈現（渲染器對此檔部分結構不支援）」——符合誠實原則，不假裝完美。

### 12.4 兩條路（**已拍板 A**，老闆 2026-07-02）
| | **Path A — 硬化現有客戶端渲染器（建議、本次採）** | **Path B — 伺服器端 soffice 高保真（記錄為後備）** |
|:--|:--|:--|
| 做法 | ① **per-slide `try/catch` 隔離**（地板，§12.3-1）② master/layout/theme/table **取值鏈空值防呆**（§12.3-2）③ **JSZip 3.x async**（§12.3-3）④ 降級橫幅（§12.3-4） | LibreOffice `soffice --headless --convert-to pdf`（或每片 png），portal 內用 pdf.js／`<img>` 呈現（比照 §5 docx→pdf 交付的無頭列印思路） |
| 保真 | 中等（沿用 pptx2html.js 版面能力） | **最高**（LibreOffice 對真實 pptx 解析遠勝任何 JS fork） |
| 健壯 | per-slide 隔離後**不再硬失敗**；防呆鏈仍非「一次補完」，但傷害被單片隔離封頂 | 極穩、幾乎不崩 |
| 成本／代價 | **低**；離線、零新增相依、不動架構 | 主機需裝 LibreOffice；**破壞零安裝離線原則**（`L3` 決策 1「vendor 自帶、離線可用」）；伺服器端較重、非 live DOM |
| 風險 | 在 9,000 行老程式上做防呆掃描需判斷力，但 per-slide 隔離讓風險可控 | 部署環境相依（老闆機器未必有 soffice） |

**Hana 建議**：本次採 **Path A**——per-slide 隔離是**立即解痛的健壯性地板**（把「硬失敗」變「大致可用、個別片降級」），且**不預先封死 Path B**。Path B（soffice）**記錄為升級後備**：僅在 A 硬化後「保真仍不足以給客戶對照」時再評估，屆時另立 spec。
**拍板（老闆 2026-07-02）**：**採 Path A**。**Path B 不排入 `TASK.md §L`**——僅保留於本表作後備，待 A 落地後若「保真仍不足以給客戶對照」再另立 spec 評估，屆時不預設一定要做。

### 12.5 落地任務（Path A，已上線；被 §12.6 取代）
→ `TASK.md §L1` 的 **`DOC-L1-FIX02`**（取代原僅涵蓋 JSZip 的 `DOC-L1-FIX01`，將其收編為子項）。此為**自我修改（self-heal）平台程式**，走 `Deploy_Harness.ps1` 上線（自動冒煙＋失敗回滾），git 由人類掌控。**已於 v179 上線**——但僅為健壯性地板，保真天花板仍受限於 PPTXjs 老 fork，故後續改走 §12.6 汰換整個引擎。

### 12.6 路線變更 — 改採 aiden0z/pptx-renderer 取代 PPTXjs（2026-07-02，老闆拍板）

> 承 §12.1–12.5：`DOC-L1-FIX02`（Path A）讓範例專案 `kic.pptx` 不再整體白掉，但**per-slide 隔離＋防呆只是「不硬失敗」的地板，不是保真的天花板**。真正想給客戶看的「合併儲存格表格、字級繼承」在 PPTXjs 老 fork（9,166 行、已停維護）上依舊崩壞。與其在老 fork 上無止盡打補丁（Path A 的續作）或立刻走重量級 Path B（soffice），先評估**同物種但新世代**的替代引擎。

**選定替代**：**[aiden0z/pptx-renderer](https://github.com/aiden0z/pptx-renderer)**——與 PPTXjs 同物種（純前端解析 OOXML → 畫成 HTML/SVG、可選字、可嵌 iframe、零外部相依），但成熟度高一大截：
- **TypeScript**、**Apache-2.0**（可商用內嵌，比照 PPTXjs 的 MIT 才敢 vendor）；
- **活躍維護**（v1.2.3，2026-07-01）——非停維護的 fork；
- **白紙黑字對症本案兩大痛點**：明確宣稱支援「**表格合併儲存格**」與「**完整 master→layout→shape→paragraph→run 字級繼承鏈**」；
- 明講短板：不支援動畫/轉場/3D/公式(OMML)/完整 EMF-WMF、且 **browser-only**（Node 端不可跑）——本案擬真預覽在瀏覽器唯讀渲染，此短板不影響。

**GitHub 調查對照（同類存活套件）**：
| 套件 | Stars | 維護 | 技術 | 授權 | 選字 | 表格合併格 | 字級繼承 | 採用 |
|---|---|---|---|---|---|---|---|---|
| `aiden0z/pptx-renderer` | 63 | **活躍 v1.2.3 (2026-07)** | TS · HTML/SVG | Apache-2.0 | ✅ | ✅ 宣稱 | ✅ 宣稱全繼承鏈 | **✅ 本次採** |
| `501351981/pptx-preview` | 123（同類最紅） | 有更新 | 前端 TS/JS | **原始碼付費**（黑箱） | ✅ | 未載明 | 未載明 | ✗（不可讀改，違反 vendor＋自癒式修改用法） |
| `gptsci/pptxviewjs` | 15 | 1 commit | **Canvas** | MIT | ❌（canvas 不能選字） | 宣稱 | 未載明 | ✗（不能選字、未經考驗） |
| 現用 `pptx2html.js`（PPTXjs fork） | — | **停維護** | jQuery 時代 | MIT | ✅ 但畫壞 | 崩 | 壞 | 退役 |

（`PptxGenJS` 是**產生** pptx 非預覽、方向不對，排除。）

**決策紅線**：
1. **驗證先行、眼見為憑**——不信 README。落地任務第一步＝把 pptx-renderer 拉下來、**單獨拿範例專案 `kic.pptx` 離線試畫**，截圖檢查**合併格表格**與**「編號」字級**是否真畫對。
2. **通過才換**：試畫對症 → vendor 進 `portal/vendor/`（離線自帶、比照 `TASK.md L3` 決策 1）、把 `docPreviewPptx()`／renderPptx 引擎換成 pptx-renderer（**保留同一「擬真預覽」動作位與 modal，不動使用者 UX**）、沿用 §12.3 健壯性合約（單片降級＋誠實橫幅，若新引擎內建容錯則對接之）；換成功後 `pptx2html.js` 及僅為它引入的 `jquery.min.js` **退役、自 vendor 移除**並清載入。
3. **不通過就 STOP、不私自換方向**：若表格照樣崩 → 觸發 `[SPEC-BLOCKER]` 回報指揮官，證明「HTML 啟發式引擎」這條路整個到頂，改評估 §12.4 **Path B（soffice 出圖，放棄選字換最高保真）**——屆時另立決策，勿擅自實作 Path B。

**落地**：`TASK.md §L1 DOC-L1-04`（取代 §12.5 續作 Path A 的方向）。**自我修改平台程式**：走 `Deploy_Harness.ps1`（冒煙＋回滾），git 由人類掌控。

**✅ 已落地（v180，2026-07-02）**：驗證先行通過（範例專案 kic.pptx 離線 Playwright 試畫：18 片全渲染、49 個合併儲存格乾淨畫出、字級繼承正確，截圖佐證）→ vendor `@aiden0z/pptx-renderer@1.2.3` esbuild 打包成自帶 IIFE（jszip/echarts 內嵌、不碰全域 JSZip）進 `portal/vendor/pptx-renderer.js`、`docPreviewPptx()`＋split-view 兩處改用 `PptxViewer.open()`（首次預覽才 lazy-load）→ `pptx2html.js`＋`jquery.min.js` 退役移除。新引擎內建 slide 級容錯（§12.3-1 的 per-slide 硬失敗隔離由引擎自身滿足），whole-render 以 try/catch＋誠實錯誤面板包住。真套件名＝`@aiden0z/pptx-renderer`（npm 光名 `pptx-renderer` 為 3.8KB 空殼、非此物，避坑記錄）。

## 13. L2′ 擬真上「就地編輯」 — 路線變更：重開 C（2026-07-02 老闆拍板，取代 §11 的 A）

> 承 §11（拍板 A：編輯落在左邊 md 投影、擬真只讀對照）。老闆 2026-07-02 **重開當初被排除的路（在擬真渲染結果上 inline 編輯、反向對映回 source）**，但**縮到「只改文字＋換圖＋改流程圖」**——縮到這個範圍後它從「近乎自造 Word/PowerPoint」變成**有界、可做**（回寫 source 那半邊 §K 已完成，唯一要新造的是「渲染 DOM → source XML 精準錨定」）。

### 13.1 決策翻轉（重開 C 的界線）
- **編輯發生在右邊擬真畫面本身**（就地 hover→編輯），不再是左邊 md 投影。§11.3「不在渲染結果上 inline 編輯」**作廢**。
- 範圍嚴格限 **① 文字（就地改字）② 換圖 ③ 改流程圖（bpmn）**。不做字級/顏色/位置/裁切等版面編輯（要動版面仍回桌面 App，見 §13.5）。
- **§11 的既有成果全部複用、不重造**：`DOC-L2-02` 的 run 級回寫（`docx-writeback.py`／`pptx-writeback.py`）、`DOC-L2-04` 的換圖回寫 source（`image-writeback.py`）、mtime 防覆寫——只是觸發點從「md 投影送出」改成「擬真畫面就地送出」。

### 13.2 擬真預覽成為「預設檢視」（取消「擬真預覽」按鈕）
- **從清單點檔案 → 右欄預設直接渲染 source 真身的擬真畫面**（docx→docx-preview／pptx→pptx-renderer）。不再需要 `DOC_ACTIONS` 的「擬真預覽」動作鈕與 modal 開關（`docPreviewSourceDocx`／`docPreviewPptx` 的「按鈕才開」入口退役；渲染函式本身複用）。
- 既有 split-view（`DOC-L2-01`，左 md｜右擬真）保留為**可選對照/來源檢視**，但**預設落地就是擬真**。

### 13.3 錨定驗證（2026-07-02，PASS——動手前先驗，見對話）
- **docx ✅ 乾淨**：source 內 `w14:paraId` 存在（§K 回寫已依賴）。自帶可讀的 `docx-preview.js` 目前**未把 paraId 帶出**（`parseParagraph` 不讀 `<w:p>` 屬性、`renderParagraph` 不掛身分）→ **兩行 patch**：parse 讀 `paraId`、render `setAttribute('data-el', paraId)`，每個 `<p>` 即帶真身錨點。**不需位置對映。**
- **pptx ✅（需重 build 一次）**：`@aiden0z/pptx-renderer` 已 emit `data-slide-index`（片級）；shape `cNvPr id` 已 parse 進 `BaseNode.id`、`renderShape(node)` 出 DOM 時 `node.id` 在手邊。它是 minified bundle 不能手 patch，但**我們已有 `.tmp/pptx-eval` 的 esbuild 重打包管線**（v180 就是它）→ 小 patch：render 時把 `node.id`→`data-pptx-shape-id`、文字帶段序 → 重打包進 `portal/vendor/pptx-renderer.js`。段落級用「shape＋段序」＝**與 `SPEC-doc-roundtrip §6` 現有 pptx 錨定（`<shapeId>/<paraIndex>`）一致**，非新增脆弱點。

### 13.4 三種就地編輯（都回寫 source 真身）

> **⚠️ 互動前置（§13.9 開關模型）**：以下三種編輯**只在「線上編輯」模式下才可用**。唯讀（預設）時擬真畫面**完全沒有任何編輯 affordance**（見 §13.9）。

- **文字**：進「線上編輯」模式後，block（docx `<p>`／pptx shape 內段落）**頁內就地 `contentEditable`**（**不彈窗**——所見即所得、連續改多段最順）→ 送出用該 DOM 的 `data-el`／`data-pptx-shape-id`＋段序，走 **§K run 級回寫**（`docx-writeback.py`／`pptx-writeback.py`），只動被改的字、其餘 byte 不碰。
- **換圖**：線上編輯模式下，**雙擊圖 or hover 到圖右上角浮現「編輯」鈕**（兩種手勢皆可）→ 「更換圖片」→ 沿用 `DOC-L2-03/04`（`POST /api/documents/:id/image` ＋ `image-writeback.py`），**只換 media binary、保留原圖框錨點尺寸**（換圖不跑版，`docx` extent／`pptx` shape 框吃原尺寸；新圖長寬比差太多才提醒，不強制同尺寸）。
- **流程圖（bpmn）**：線上編輯模式下，**雙擊 or hover 右上角「編輯」鈕**點「被辨識為流程圖」的那張圖 → 開既有 bpmn 編輯器改 → 存回 md 層 `assets/*.bpmn`。**bpmn 編輯器維持彈窗**（它較大，塞進頁內連續彈窗體驗差、也較不好做）。**擬真畫面上流程圖的呈現方式分階段**，見 §13.7 P3 與 §13.8 開放決策。

### 13.5 表格：只做「格內文字」；加列/欄→桌面 App 開 source 工作複本
- 線上就地編輯**只做表格格子內的文字**（跟段落文字同一套 run 級回寫，docx `<w:tc>` 內段落 paraId／pptx 表格 cell shape＋段序）。
- **加列/加欄＝改結構**（動 OOXML `<w:tr>/<w:tc>`），**不做線上**；改走「**用桌面 App 開啟**」：一鍵在 Word／PowerPoint 開 **source 工作複本**（`.documents/<id>/source.docx`／`.pptx`，即保留原版面的可編輯真檔）讓 老闆直接改結構、存檔即成新真身。
  - ⚠️ **待確認（§13.8-1）**：老闆原話「開的都是乙，也就是 source 的複本」與先前 甲/乙 定義（乙＝bpmn→svg 交付版）不符；此處**按「開 source 工作複本」實作**，待 老闆確認。

### 13.6 「已變更」狀態 + 手動寫回真身（甲/乙 選項，預設 bpmn）
- **編輯 ≠ 立即動原始 gitlab 路徑**：任何就地編輯（改字／換圖／改流程圖）先落在 Hana 的 **source 工作複本**（`.documents/<id>/source.*`）。
- **清單出現「已變更」樣式**：只要該文件被編輯過，文件清單該筆亮一個 `已變更` 標記，提示「尚未寫回真身」。
- **手動「寫回真身」**：由 老闆手動觸發才把工作複本同步回 **registry 記錄的原始路徑 `sourcePath`**（相對工作區根、原檔在工作區內）。**不做匯入後 hash/mtime 防呆擋下**——真身被別人在 gitlab 改過就「拉回來重匯入＝重來」（老闆拍板：真身才是重點，gitlab 有版本史可救）。
- **寫回時給兩顆選項**（甲/乙，差別只在流程圖）：
  - **乙（預設）＝交付版**：流程圖用 **bpmn→svg** 的成品。
  - **甲＝原始格式**：保留原本的 Visio 流程圖。
  - 文字、圖片在甲乙都已是替換後的最新版；**唯一差異是流程圖**。
- **git 由 老闆掌控**：Hana **只寫檔案回原始路徑、不自動 commit**；是否 commit gitlab 全由 老闆決定（自己下或叫 Hana 下）。

### 13.7 分階段 — **docx / pptx 拆成獨立 track（老闆 2026-07-02 拍板）**

> **拆分原則**：P1（錨定地基）已對 docx＋pptx 兩者同時完成。之後的「就地編輯」按格式**拆成兩條獨立 track、各自一個 task＋一個 schedule**（規格先寫齊、schedule 全設**手動模式**、由 老闆手動觸發）。理由：docx（docx-preview DOM／`data-el`）與 pptx（pptx-renderer DOM／`data-pptx-shape-id`＋段序）錨點與渲染引擎本就不同，逐一落地、各自驗收較穩，也避免一次動兩套渲染面。

- **P1（錨定地基，已完成 v181，docx＋pptx 皆備）**：docx-preview patch 帶出 `data-el`；pptx-renderer 重 build 帶出 `data-pptx-shape-id`＋段序。擬真畫面設為預設檢視、退役「擬真預覽」按鈕。
- **P2-DOCX（docx 就地編輯，獨立 task＋手動 schedule）**：`線上編輯`開關（§13.9）＋頁內 `contentEditable` 就地改字（含表格格內）→§K docx 回寫 source；雙擊/hover→換圖→§K 換 media；「已變更」狀態＋手動寫回真身（甲/乙 選項）＋桌面 App 開 source 工作複本（加列/欄）；**docx 流程圖 (a) hover 開 bpmn**（源自 Word Visio，§13.4）。
- **P2-PPTX（pptx 就地編輯，獨立 task＋手動 schedule）**：同 P2-DOCX 的開關＋就地改字（pptx shape 段落，含表格 cell）＋換圖＋已變更/寫回＋桌面開啟，只是走 pptx 錨點與 `pptx-writeback.py`／pptx media。
- **共享件**：`線上編輯`開關與「唯讀完全無 affordance」的編輯態框架是兩 track 共用的一顆 UI 控制——**先跑的那條 track 建立它、後跑的複用**（§13.9）。
- **P3-b（合成 bpmn-svg 進擬真畫面，後續評估、暫不排 schedule）**：把 bpmn→svg 合成貼進擬真畫面對應圖框位置（好看、工程較重，尤其 EMF Visio 常畫不出→破圖框時 (b) 才有好體驗）。§13.8-2 開放決策。

### 13.8 待拍板/待確認（先採預設、記錄，勿卡住）
1. **桌面 App 開哪一份**（§13.5）：預設「開 source 工作複本 `.documents/<id>/source.*`」（可編輯真檔、能改結構）。待 老闆確認是否即他說的「乙」。
2. **流程圖在擬真畫面的呈現**（§13.7 P3）：P3-a 顯示原圖＋hover 開 bpmn（預設先做）vs P3-b 合成 bpmn-svg 貼進畫面（後續，EMF 破圖框時才必要）。
3. ~~**就地編輯的觸發手勢**：hover 顯示「編輯」鈕點入 vs 直接 `contenteditable`？~~ → **已拍板（老闆 2026-07-02，見 §13.9）**：加一顆文件級**「線上編輯」開關**，**唯讀（預設）完全無 hover／雙擊／contentEditable**；進編輯態後**文字＝頁內 `contentEditable`**（不彈窗）、**圖／流程圖＝雙擊 or hover 右上角「編輯」鈕**（bpmn 編輯器維持彈窗）。
4. **換圖尺寸語意**：只在長寬比差太多時提醒、不強制同尺寸（老闆已定，§13.4）。
5. **⛔ docPr↔bpmn 對應不存在（2026-07-02 P2-DOCX 落地時發現，待拍板）**：§13.4／§13.6 假設「匯入時記錄了圖↔bpmn 對應」，但 `docx-convert.py:633` 把流程圖 `![]` 換成 ```bpmn 區塊時，用 regex `(\s*<!--[^>]*-->)?` **連 docPr 錨點一起 strip**，```bpmn 區塊也不帶 docPr → **無法由擬真畫面上某張流程圖（docPr id）反查對應的 `assets/*.bpmn`**。這擋住 **DOC-P2D-03**（hover 開對應 bpmn）與 **DOC-P2D-04 乙**（bpmn→svg 換回 source 圖框）。**提議修法**：匯入時多寫 sidecar `.documents/<id>/flowmap.json`＝`{docPrId:"assets/<x>.bpmn"}`（additive、不改 md 格式），既有文件以重匯入補上。**待 老闆同意（動到 import＋隱含重匯入）再實作。** P2-DOCX 其餘（P2D-00/01/02/05＋04 的 dirty＋甲寫回）已 v185 上線。

### 13.9 唯讀↔線上編輯 開關模型（2026-07-02 老闆拍板，取代 §13.8-3 暫定）

> 承 §13.8-3 開放決策（原暫定「先 hover 顯示編輯鈕」）。老闆拍板改成**文件級的明確模式開關**，讓「看」與「改」乾淨切開。

**1. 一顆文件級「線上編輯」開關**
- 文件動作列一顆「線上編輯」切換鈕。**預設＝唯讀**。
- **唯讀時擬真畫面完全沒有任何編輯 affordance**——不 hover 高亮、不可雙擊、不 `contentEditable`、不出現任何「編輯」鈕。純看，杜絕誤觸。
- 按下「線上編輯」→ 全文件進入**編輯態**；再按一次退回唯讀。

**2. 編輯態下的三種手勢（皆只在編輯態生效）**
- **文字＝頁內就地 `contentEditable`（不彈窗）**：block（docx `<p>`／pptx shape 段落，含表格 cell）直接在擬真畫面上改字，所見即所得。**理由（老闆）**：bpmn 編輯器已是彈窗、且較大，文字若也走彈窗＝連續彈窗、體驗差、也較不好做；文字量大、就地改最順。
- **換圖／改流程圖＝雙擊 or hover 右上角浮現「編輯」鈕**（兩種手勢皆可，實作擇一或並存）→ 換圖走 `image-writeback.py`、bpmn 走既有 bpmn 編輯器。
- **bpmn 編輯器維持彈窗**（不塞進頁內）——它較大，彈窗是目前既有且合用的形態。

**3. 兩 track 共用一顆開關**
- 這顆「線上編輯」開關＋「唯讀完全 inert／編輯態才有 affordance」的框架是 **docx 與 pptx 兩條 track 共用**的 UI 機制。**先跑的 track 建立它，後跑的複用**（不各造一套）。各 track 差異只在渲染引擎與錨點（docx-preview `data-el`／pptx-renderer `data-pptx-shape-id`＋段序）與回寫腳本。

> ⚠️ **共用機制不可打破（2026-07-02 補；pptx track 動工前必讀）**
> 這顆開關的實作已被**多個功能同時依賴**，`index.html` 的三處是**共用基座，只能「擴充/append」、禁止「重寫/relocate」**，否則會弄壞已上線的 docx 流程圖顯示與編輯（§13.12-A）：
> 1. **`_ensureP2dStyles()`**（樣式注入，單一字串串接）— 內含 docx 文字/圖片 affordance 樣式 **＋ 流程圖編輯鈕 `.doc-flow-synth .flow-edit-btn` 樣式**。pptx 樣式**接在字串尾端**（`+ '…'`），**不要重寫整個 `st.textContent`**（會吃掉流程圖編輯鈕 → 鈕永遠 `display:none`）。
> 2. **`_applyDocEditAffordances(on)`**：它把 **`.doc-online-edit` class 掛在 `#doc-content-area`**——`.doc-flow-synth .flow-edit-btn` 與所有編輯態 CSS 都靠這個 class 才生效。pptx 支援請**在此函式內加 pptx 分支**（對 `[data-pptx-shape-id]` 掛 contentEditable/換圖鈕），**`.doc-online-edit` 必須仍掛在 `#doc-content-area`、不可改掛別的元素**。
> 3. **`toggleDocOnlineEdit()`** 的 `if (_docActiveType==='pptx') return` guard 是 pptx track 的入口——**移除/替換成 pptx 分支即可，勿改動 docx 路徑**。
> 4. **`openBpmnModal`/`closeBpmnModal`**：docx 流程圖框存檔後走 **`box.__reflow`** 只重畫該框（`closeBpmnModal` 已有 `if __reflow … else if .bpmn-embed-svg` 分支）。pptx 若也用 `openBpmnModal` 開流程圖，**沿用 `box.__reflow` 模式**（否則存檔後不會刷新）。
> **一句話：pptx 只在既有共用函式裡「加分支/接字串」，不要重寫它們、不要搬 `.doc-online-edit`。** 動前先 codegraph 看這四處的現有引用。

### 13.10 P3-b 修正 — 擬真流程圖改以 **doc.md 為錨**，退掉 flowmap.json 依賴（2026-07-02 老闆拍板）

> **背景**：`DOC-P3-02`（P3-b，v188）上線後，老闆實測——他打開的每一份 docx，**舊「文件檢視」都畫得出 bpmn 流程圖，換到新「擬真預覽」卻一片空**。老闆判斷（正確）：資料結構沒變、錨點一直在，只是換了前端渲染工具，理應找得到錨點做替換；畫不出＝我沒找到真根因。查證後確認就是如此。**此節取代 §13.7 P3-b／§13.8-2 中「擬真流程圖靠 flowmap.json 對位」的作法。**

**根因（已查證）**

- **舊「文件檢視」為什麼永遠畫得出來**（`renderBpmnEmbedsIn` → `renderBpmnSvgInto`）：它渲染的是 **`doc.md`**。匯入時 `docx-convert.py`（約 802–808）每遇一張流程圖，就在 md 裡**那張圖原本的位置**寫下一段 fence：`` ```bpmn `` ＋內文 `assets/imageN(_pending).bpmn`。**fence 的位置＝錨點，fence 內文＝該流程圖對應的 .bpmn 路徑。** 舊檢視只是讀 `code.textContent` 拿路徑、用 bpmn-js 畫成 svg。這份對應**寫在 doc.md 裡、對全部文件都在** → 舊檢視永遠畫得出來。
- **新「擬真預覽」為什麼畫不出來**（`_renderDocFidelity` → `_synthDocFlowSvg`，`portal/index.html` 約 11104–11109）：它**不讀 doc.md**，改讀後建的 **`flowmap.json`**，讀不到就 `return`、什麼都不畫。而 `flowmap.json` 由 `extract_flow_anchors`／`backfill_flowmap`（約 534）**靠「數 docx 裡 EMF 向量圖的數量」再與 fence 數比對**來建；數量不相等即整份 skip。真實客戶檔「流程圖不一定是 EMF、EMF 不一定是流程圖」，46 份只建出 2 份 → 其餘全 `return`，畫面全空。
- **一句話**：擬真層重造了一個**比較差的**對應機制（flowmap.json＝靠 docx EMF 數量猜），而**真正可靠的對應早就存在於 doc.md**（舊檢視在用的那組有序 fence）。先前 `DOC-FLOWMAP`／`DOC-P3-02` 一直在修那個爛錨（EMF 計數配對），**方向本身錯了**。

**正解：擬真層改用 doc.md 當錨（與舊檢視同一份資料）**

- `docx-preview` 是**照文件順序**把圖片渲染成 DOM；`doc.md` 也是照文件順序、把每張圖記成 `![](assets/imageN.*)`（純圖）或 `` ```bpmn `` fence（流程圖）。所以：**擬真 DOM 裡第 k 張圖 ↔ doc.md 順序上第 k 個圖／fence。**
- 做法：並排走一遍——凡 doc.md 對應到 bpmn fence 的那張圖，就用 fence 裡的路徑，經**與舊檢視同一支**渲染函式（`renderBpmnSvgInto`／`_renderBpmnXmlInto`）換成 svg 貼回原圖框位、吃原框尺寸不跑版。
- **好處**：不必重新匯入、不必 `flowmap.json`、不必數 EMF；流程圖是 EMF 或 PNG 都能對；混進來的 logo（EMF）不會被誤判，因為 doc.md 明確標了哪個位置才是流程圖；用的就是舊檢視在用、且對全部文件都存在的那份真身資料。
- **一併修掉現行第二個限制**：`_synthDocFlowSvg` 目前**只在「圖框破掉」（`img.complete && naturalWidth===0`）時才貼**。改用 doc.md 對位後，**只要該位置在 doc.md 是 bpmn 就採用重建的 svg**，不再受「EMF 恰好破框與否」左右。

**邊界與誠實降級**
- **只影響擬真呈現層、不動 source.docx 真身**；純前端 `portal/index.html`，不需改 server／py。
- doc.md 讀不到、或 DOM 圖數與 doc.md 圖序對不上（客戶在 Word 端大改造成不同步）→ 誠實標「需人工確認」、退回顯示原圖，**不硬猜對位**。
- `flowmap.json` **不刪**：`DOC-P2D-03`（hover 開對應 bpmn）／`DOC-P2D-04 乙`（bpmn→svg 換回 source 真身）仍可用它或改走 doc.md（另案評估）。本節只把**擬真「顯示」層**的對位來源從 flowmap 換成 doc.md。

**待拍板（先採預設、記錄，勿卡住）**
1. `_pending.bpmn`（尚未重建的佔位流程圖）在擬真畫面上要**顯示佔位骨架** vs **退回原始 PNG**？→ 預設**退回原始 PNG**（同時修好破 EMF 框、並誠實標「未重建」），骨架留待指揮官拍板。

### 13.11 定案 — 擬真流程圖改以 **paraId 身分** 對位（2026-07-02，取代 §13.10 的位置對位）

> **背景**：§13.10 落地後 老闆實測**仍失敗**——每份都跳「圖片數與 doc.md 圖序對不上」。§13.10 雖改讀 doc.md，**但配對法本質還是「位置對位」**（擬真 DOM 第 k 張圖 ↔ doc.md 第 k 個圖/fence），只要 docx-preview 渲出 doc.md 沒有的圖（頁首 logo、內文重複圖、mammoth 丟的圖）或 EMF 是否破框有差，序位就整體錯開 → 真實客戶檔幾乎必然對不上。**這才是一路失敗的貫穿線：每次都在「事後用比較弱的訊號重新推導對應」（EMF 計數→位置），而非「把匯入當下就確定的身分帶過去」。**

**真根因（已用程式碼＋範例專案實檔逐項查證）**
- 客戶流程圖是 **Visio/OLE 物件**（`w:object`+`v:imagedata`，無 `wp:docPr`），但匯入時 `inject_para_ids` 已對**每個 `<w:p>` 打了 `w14:paraId`**（實檔 126 個）。
- `extract_flow_anchors`（`docx-convert.py:412`）**早就**算出每張圖的 `{paraId, sourceMedia: word/media/imageN}`（文件順序）——**可靠的身分鍵一直都在，只是沒接到擬真層。**
- docx-preview 的 `renderParagraph`（`vendor/docx-preview.js:3369`）**已對每個段落（含只放物件的段）印出 `[data-el]=paraId`**；線上編輯的文字回寫早就靠它逐段對位成功。
- 但 `_synthDocFlowSvg`**完全不碰 paraId**，用圖數/破框數的 Case A/B/C 位置對位 → 對不上就整份放棄。

**正解：以「圖號 N → paraId」三方串接，逐流程圖按唯一 ID 對位（不靠圖數/序位）**
- ① doc.md 的 `` ```bpmn `` fence 給流程圖圖號 N（`assets/imageN.bpmn`）＋ bpmn 路徑。
- ② 新增 **唯讀端點** `GET /api/documents/:id/flow-anchors`（呼叫 `docx-convert.py --flow-anchors`）→ 回每個 `word/media/imageN` 的 `paraId`。
- ③ 擬真 DOM 用 `area.querySelector('[data-el=paraId]')` 找到該流程圖所在段落 → 換掉該段圖框為 bpmn-svg（沿用同一支 `_placeFlowFrame`/`renderBpmnSvgInto`）。
- **為什麼這次不會再破**：只對「流程圖段落」逐一按 `w14:paraId`（唯一結構 ID）對位——頁首 logo、重複圖、被丟的圖、EMF 是否破框，**全部無關**；數量天生相等（doc.md fence 與 extract_flow_anchors 同一次匯入偵測）。
- **邊界**：純前端＋一個唯讀端點＋py 一個唯讀子命令，**不動 source 真身、不重匯入、不改重建成果**；查不到 paraId 的流程圖才誠實降級。落地＝擬真層 `_synthDocFlowSvg` 重寫（已完成，待部署）。

**待辦（本節未含）**：re-import 資料安全（`create_pending_bpmn` 無條件覆寫會洗掉重建 bpmn，`docx-convert.py:226`）另立「刀 1」處理；本節只解「既有好檔在擬真畫面顯示流程圖」。

---

### 13.12 擬真流程圖「渲染合約」＋ 匯入/AI 架構真相（2026-07-02，防再犯）

> **為什麼有這節**：流程圖在擬真畫面反覆出問題（畫不出、沒顏色、沒長大、不能編輯），每次都是**同一類錯**——擬真層的流程圖渲染走了一條「比較精簡的新路徑」（`_synthDocFlowSvg` → `_placeFlowFrame` → `_renderBpmnXmlInto`），卻**漏抄舊「文件檢視」路徑（`renderBpmnEmbedsIn` → `renderBpmnSvgInto` → `.bpmn-embed` + `openBpmnModal`）早就做好的事**。本節把「兩條路徑必須對齊的合約」與「匯入/AI 的架構事實」白紙黑字定死，任何動到這塊的人先讀這節。

#### A. 渲染合約：擬真流程圖框（`.doc-flow-synth`）必須具備的四件事
`_placeFlowFrame` 產出的每個流程圖框，**必須**與舊 `renderBpmnSvgInto` 對齊，缺一即為回歸：

1. **對位＝paraId 身分，不是圖數/序位**（見 §13.11）。錨 = doc.md fence 圖號 N → `/api/documents/:id/flow-anchors`（`extract_flow_anchors`）取 `paraId` → 擬真 DOM `[data-el=paraId]`。**禁止**再用「第 k 張圖對第 k 個」的數量/位置對位。
2. **上色＝`applyBpmnDefaultColors(modeler)`**。顏色**不存在 .bpmn 檔裡**（`flow-bpmn.js` 不上色），是 runtime 用 `modeling.setColor()` 依類型套（DIAG-P2：Task 藍 `#dbeafe`／Gateway 黃 `#fef9c3`／Event 綠 `#dcfce7`／Lane 淺）。**任何 `saveSVG()` 前都要呼叫 `applyBpmnDefaultColors`**，否則圖是素色。`_renderBpmnXmlInto` 曾漏掉這步 → 「顏色不見」。（已有存自訂色的圖：`applyBpmnDefaultColors` 會跳過已有 `di.fill/stroke` 者，保留自訂色。）
3. **尺寸＝撐滿 Word 內文欄寬**，高度依 BPMN 長寬比等比。**禁止**繼承「被取代的破 EMF 圖框」尺寸（破框量到很小 → 流程圖不會長大）。做法：框 `display:block;width:100%`；svg `width:100%;height:auto` + 保留 `viewBox`（沒 viewBox 用 `getBBox()` 補）。
4. **編輯＝接 `openBpmnModal(editPath, box)`**，且**嚴格 gate 在線上編輯態**（§13.9：唯讀**完全無** hover/雙擊/編輯鈕）。`editPath = docDir + '/' + tryRef`（＝`resolveBpmnPath('/'+docDir+'/'+tryRef)`，`/api/file` load+save 用，X-Workspace 由全域 fetch wrapper 自動帶）。存檔後**只重畫該框**（`box.__reflow`，重讀真檔），**不可**整份重跑 `_synthDocFlowSvg`（會產生重複框）。CSS 用 `.doc-online-edit .doc-flow-synth .flow-edit-btn` gate，唯讀 `display:none`。

#### B. 匯入/AI 架構真相（別再誤判「匯入壞了」）
1. **匯入（`docx-convert.py --import` / `convert_import`）＝純機械**：抽圖、EMF/WMF→PNG、把向量圖機械地標成 `_pending.bpmn` 骨架、寫 `flowmap.json`。**它看不懂圖、不叫 AI**。
2. **「AI 看圖 → 判斷是不是流程圖 → 畫 BPMN」＝ `/doc-flowchart` skill**（用 Read 工具實際打開 `assets/imageN.png` → 判斷 → 寫 `.flow.json` → `flow-bpmn.js to-bpmn` 產 `.bpmn` → 回填 doc.md fence）。**`.flow.json` 就是 AI 跑過的指紋。** 這步**刻意獨立、token 重、手動/排程觸發**，不焊進匯入。
3. **不需要在匯入解析 OLE**：Word 內嵌 OLE/Visio 物件的預覽 PNG 一定會被 dump 進 `assets/_media_all/`（`emf_to_png`）。AI 直接看 `_media_all` 的圖即可（`/doc-flowchart` step 45），**不用解析 `<w:object>`**。
4. **re-import 是「可復原」不是「永久毀損」**：覆蓋匯入時 server 會存 `doc.<ts>.bak.md` 備份（`server.js` 約 2062）；`imageN.bpmn`/`.flow.json` 是不同檔、**不會被 `create_pending` 覆蓋**（它只寫 `imageN_pending.bpmn`），被重置的只是 **doc.md 的 fence 引用**。跑一次 `/doc-flowchart`（比對 `.bak.md` + `flowmap.json`）即可把 fence 接回真身。**所以「重匯後流程圖消失」= doc.md fence 被重置，不是資料被刪。**

#### C. 一句話鐵律
**動擬真流程圖渲染，先對照舊 `renderBpmnSvgInto` 把 A 的四件事補齊；動匯入，先認清 B 的兩步分工（機械匯入 vs `/doc-flowchart` AI），別把「該跑 skill」誤判成「匯入壞了」。**

### 13.13 P2-PPTX 落地紀錄（2026-07-02，v193）＋ 兩個誠實工程決策

> pptx track（DOC-P2P-00~04）落地。**共用件複用**：`/source-image`、`/writeback-truth`、`/open-desktop` 三端點本就格式無關（source.docx｜source.pptx 擇存者），只有文字回寫要新增 pptx 路徑。開關框架照 §13.12-A「只加分支、不重寫」。

**pptx 錨定鏈**（對齊 `SPEC-doc-roundtrip §6`）：擬真 DOM `data-slide-index`（0-based）→ shape `data-pptx-shape-id`（＝`p:cNvPr id`，對齊 python-pptx `shape.shape_id`）→ 段落 `data-para-idx`（框內段序）。回寫 composite key＝`<slide>:<shapeId>/<paraIdx>`（slide 1-based，對齊 `enumerate(prs.slides, start=1)`）；表格 cell＝`<slide>:<shapeId>/<row>/<col>/<paraIdx>`。`pptx-writeback.py --edits`（`writeback_edits`）複用 `_rewrite_pptx_para` char-diff→run 重組，只動被改字。

**誠實決策 1 — 表格 cell 只對「無合併格」表格開放就地改字。** `shapeId/paraIdx` 對 table cell 會撞（同表格所有 cell 共用一個 graphicFrame shapeId、各 cell 段序都從 0 起）→ key 擴充 r/c。但 pptx 合併格（gridSpan/rowSpan）下，擬真 DOM 的 `<td>` 座標≠python-pptx 邏輯格座標（合併會少 `<td>`）→ 前端 `_pptxTableIsMerged` 一偵測到 colspan/rowspan＞1 就**讓該表格所有 cell 保持唯讀**（不掛 contentEditable），避免誤寫到別格；合併表格的格內文字改走「桌面 App 開 source.pptx」（§13.5）。非合併表格 DOM r/c＝邏輯 r/c，安全開放。

**誠實決策 2 — pptx 換圖錨點必須帶 slide 消歧。** pptx 的 `p:cNvPr id` **只在單片內唯一**（PowerPoint 每片從小數字重新編號、跨片會撞——實測兩片各一張圖、shape id 都是 2）。原 `image-writeback.py replace_image_pptx` 只找「所有片第一個匹配 shapeId」會誤換到別片的圖 → 錨點改帶 slide（`<slide>:<shapeId>/image`，向後相容 legacy `<shapeId>/image`），且 `_ordered_slide_files` 依 **presentation.xml `sldIdLst` 真實片序**（對齊 python-pptx／renderer 的片序，非 `slideN.xml` 檔名序）過濾。文字回寫本就用 (slide, shape_id) 定位、無此問題。

**單元測試**（`.tmp/test_pptx_edits.py`／`.tmp/test_pptx_img.py`）：文字框＋2×2 表格 cell 改字→只該段/格變、鄰段 bold 格式保留、越界 skip；`<slide>:<id>/image` 命中正確片、legacy 命中第一片、錯 shapeId 誠實 not-found 不誤寫。**UI 佈線**（開關/affordance/送出/換圖鈕）＝inline JS parse＋Deploy 冒煙驗證，實機 hover/切換畫面待指揮官驗收。

### 13.13 流程圖判斷持久化（decision manifest）＋ 分類/重建合一（2026-07-03 老闆拍板）

> **痛點**：`/doc-flowchart` 每次都重看每張圖、重判「是不是流程圖」→ token 爆（原本 40 檔排 40 個排程、每 10 分鐘一個）；而且**判斷結果（含指揮官「不是流程圖」的人工修正）沒有被存下來** → 重跑/重匯就重判、修正消失、同一張示意圖反覆被誤畫成 bpmn。**根源＝判斷結果沒持久化。**

**決策**
1. **不拆兩趟兩模型**（先前提議 haiku 分類＋opus 重建）→ **合併回一支 `doc-flowchart`、用 Sonnet**。理由：40 份實測 Sonnet 畫 bpmn 已夠好、用不到 Opus；且「看圖」一次就同時判斷＋重畫，比拆兩趟（同一張圖被讀兩次）**更省**。真正省 token 的是下面的 manifest（跳過已判過的圖），不是拆模型。
2. **判斷結果持久化到 manifest**，doc-flowchart **只碰 `undecided` 的圖**。

**Manifest 設計**
- **工作區一份** `flow-decisions.json`，keyed by **來源檔身分 `sourcePath`**（**不是 UUID**）→ `imageN` → 決策。
- **為什麼綁 `sourcePath` 不綁 UUID**：指揮官修正誤判的常用手法是「從列表刪除 → 重匯（產生**新 UUID**）」；若綁 UUID，決策會隨舊目錄一起刪掉、新 UUID 從零重判。綁 `sourcePath` → 同一份檔重匯（不論覆蓋同 UUID 或刪除後新 UUID）都撈得回先前決策。`imageN` 對同一份 `source.docx` 的抽取順序穩定，故 `sourcePath + imageN` 是穩定鍵。
- schema：
```json
{ "version": 1, "docs": {
  "Documents/情境流程_範例專案/PCS生產管理.docx": {
    "image2": { "kind": "flow", "subflows": ["工單結案","工單強制結案"], "by": "Hana", "at": "…" },
    "image5": { "kind": "notflow", "reason": "產品關係示意圖", "by": "老闆", "at": "…" }
  }
}}
```
- `kind` ∈ `flow` / `notflow` / `undecided`（未列＝undecided）。

**流程（pipeline）**
1. **匯入（機械，不變）**：產 doc.md ＋ `_pending` fence ＋ `_media_all`。**不寫 manifest**（維持純機械）。
2. **`/doc-flowchart`（Sonnet，一支，判＋畫合一）**：讀 manifest（依 `sourcePath`）→ 逐圖：**已決策直接套用、不重看圖**（`flow` 跳過；`notflow` → 確保是 `![]`，被機械標 pending 就還原刪 bpmn）；`undecided` → 依步驟 2 原則判準看圖 → flow：重建 bpmn（＋矩陣拆子流程、寫 `subflows`）／notflow：還原圖片＋記 `reason` → 把新判斷寫回 manifest。
3. **人工修正**：檢視器「不是流程圖」動作 → 寫 `notflow` 進 manifest → **永久生效**。**含「已是真 bpmn 的還原」**（fence→`![]`、刪 `imageN.bpmn`/`.flow.json`）——目前 skill 動作表只涵蓋 `_pending`，缺這格，本節要求補上。

**硬性約束（防實作走偏）**
- **舊檔零影響、禁止為 manifest 重匯**：doc-flowchart 第一次跑到沒 manifest 的舊檔時，**從現有 doc.md 唯讀推導**（`assets/imageN.bpmn` 真身→`flow`；`_pending`／純 `![]`→`undecided`），只多寫一個 manifest，**不動 doc.md/bpmn/source**。
- **只碰 `undecided`**：已決策的圖一律不重看圖——token 省在這。
- **模型 = Sonnet**；**錨點鐵律**（bpmn 檔名 `imageN` 前綴 load-bearing，見 §13.11/§13.12）；**判準原則式**（動作先後 vs 東西關係、有箭頭≠流程圖，見 doc-flowchart／word-to-md 步驟 2）。

**落地**：doc-flowchart skill 加 manifest 讀寫 ＋「notflow＋已是真 bpmn → 還原」動作；排程模型 sonnet。依 dispatch 派 Hana 實作。

## 10. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-07-03 | v1.3 | 老闆 + Claude(Opus) | **流程圖判斷持久化（新增 §13.13）＋ 判準改原則式 ＋ 匯入標題回歸修正 ＋ 多子流程/顏色/同寬/編輯器顯示補強。** ① §13.13 decision manifest：`flow-decisions.json` 綁 `sourcePath`（非 UUID，故「刪除→新 UUID 重匯」也保住決策），doc-flowchart 合併回一支 **Sonnet**（判＋畫合一，不拆 haiku/opus），**只碰 undecided**→重跑近 0 token、人工 notflow 修正永久生效；硬約束「舊檔唯讀推導、禁止為 manifest 重匯」。② doc-flowchart／word-to-md 步驟 2 判準改**原則式**（正面：節點＝動作、箭頭＝先後控制流；反面：關係/連結/資料/產品示意圖，有箭頭≠流程圖），不綁個案。③ doc-flowchart 步驟 3 加**錨點鐵律**（bpmn 檔名 `imageN` 前綴 load-bearing）。④ 匯入器 `_para_to_md_block` 標題回歸修正：改用樣式 `outlineLvl` 判標題（數字 styleId「1/2」名為 heading 1/2 者原本 miss→掉 bullet）；全量健檢 42/43 標題正常、僅 AOI 需重匯。⑤ 擬真顯示補：多子流程疊畫＋子流程標題、`applyBpmnDefaultColors` 上色、同 Word 內文欄寬、線上編輯開 bpmn 編輯器。 |
| 2026-07-02 | v1.2 | 老闆 + Hana(Opus) | **P2-PPTX track 落地（新增 §13.13，v193）。** docx track 的三端點（`/source-image`、`/writeback-truth`、`/open-desktop`）本就格式無關、複用即可；只新增文字回寫 pptx 路徑（`pptx-writeback.py --edits`，composite key `slide:shapeId/paraIdx`）＋開關框架 pptx 分支（§13.12-A 只加不重寫）。**兩個誠實工程決策**：① 表格 cell 只對「無合併格」表格開放就地改字（合併時 DOM 座標≠python-pptx 邏輯格、會誤寫→保持唯讀走桌面 App）；② 換圖錨點必須帶 slide 消歧（`p:cNvPr id` 只在單片唯一、跨片會撞——實測兩片圖 id 都是 2，原 `replace_image_pptx` 取「所有片第一個匹配」會誤換別片 → `<slide>:<shapeId>/image`＋依 `sldIdLst` 真實片序過濾）。單元測試 PASS、Deploy v193 冒煙通過。 |
| 2026-07-02 | v1.1 | 老闆 + Claude(Opus) | **擬真流程圖「渲染合約」＋匯入/AI 架構真相定死（新增 §13.12，防再犯）。** 一路的錯都同源：擬真層流程圖走精簡新路徑（`_synthDocFlowSvg`→`_placeFlowFrame`→`_renderBpmnXmlInto`），漏抄舊 `renderBpmnSvgInto` 路徑早有的東西。§13.12-A 定死「擬真流程圖框必備四件事」＝①paraId 對位 ②`applyBpmnDefaultColors` 上色（顏色是 runtime setColor、不在檔裡；`_renderBpmnXmlInto` 曾漏→「顏色不見」，已補）③撐滿內文欄寬、不繼承破 EMF 框（曾「沒長大」，已修）④接 `openBpmnModal` 且嚴格 gate 在編輯態、存檔走 `box.__reflow` 只重畫該框（線上編輯流程圖，已接）。§13.12-B 定死匯入/AI 分工：匯入=純機械只產 `_pending`＋`_media_all` dump PNG；`/doc-flowchart` skill=AI 看圖產 `.flow.json`/`.bpmn`（獨立手動/排程，不焊進匯入）；不需解析 OLE；re-import 可復原（`.bak.md`+`flowmap.json`，被重置的只是 doc.md fence，不是刪資料）。本輪已實作＋部署：顏色、同寬、編輯器接線。 |
| 2026-07-02 | v1.0 | 老闆 + Claude(Opus) | **定案：擬真流程圖改以 `w14:paraId` 身分對位（新增 §13.11，取代 §13.10 的位置對位）。** §13.10 的「doc.md 第 k 圖 ↔ DOM 第 k 圖」仍是位置對位，真實客戶檔（docx-preview 多渲出 doc.md 沒有的圖）幾乎必然對不上 → 每份跳警告。**真根因**：一路失敗都在「事後用弱訊號（EMF 計數→位置）重推對應」，而可靠身分鍵 `paraId` 匯入時就打進每個 `<w:p>`、`extract_flow_anchors` 早算好、docx-preview 早印成 `[data-el]`，只是沒接到擬真層。**正解**：doc.md fence 圖號 N →（新增唯讀端點 `/flow-anchors`）paraId → 擬真 DOM `[data-el=paraId]` → `_placeFlowFrame` 貼 svg。逐圖按唯一 ID，不靠圖數/序位。純前端＋唯讀端點＋py 唯讀子命令，不動真身、不重匯入。已實作於 dev（`docx-convert.py --flow-anchors`、`server.js` 端點、`index.html _synthDocFlowSvg` 重寫），待部署。re-import 洗掉重建 bpmn 的資料安全另立「刀1」。 |
| 2026-07-02 | v0.9 | 老闆 + Hana | **P3-b 修正：擬真流程圖改以 `doc.md` 為錨、退掉 `flowmap.json` 依賴（新增 §13.10）。** 實測發現舊「文件檢視」每份都畫得出 bpmn、新「擬真預覽」卻全空。**真根因**：擬真層 `_synthDocFlowSvg` 不讀 `doc.md`、改讀後建的 `flowmap.json`，而 flowmap 靠「數 docx EMF 數量」配對、真實客戶檔多不成立 → 46 份只建 2 份、其餘一片空。可靠對應**一直在 `doc.md`**（舊檢視用的有序 `` ```bpmn `` fence，位置＝錨點、內文＝bpmn 路徑）。**正解**：擬真 DOM 第 k 張圖 ↔ doc.md 第 k 個圖/fence，凡 fence 者用同一支 `renderBpmnSvgInto`/`_renderBpmnXmlInto` 換 svg 貼回原框——**不重匯入、不用 flowmap、不數 EMF**，且移除「只在破圖框才貼」限制（只要 doc.md 是 bpmn 就採用）。純前端、不動 source 真身；對不齊誠實降級。待拍板：`_pending.bpmn` 顯示佔位骨架 vs 退回原始 PNG（預設退 PNG）。落地＝`TASK.md DOC-P3-03`。 |
| 2026-07-02 | v0.8 | 老闆 + Hana | **就地編輯互動模型定案 + docx/pptx 拆 track（新增 §13.9、改寫 §13.4/§13.7、解掉 §13.8-3）。** ① 文件級「線上編輯」開關：**唯讀（預設）完全無 hover/雙擊/contentEditable/編輯鈕**（純看、杜絕誤觸），按鈕才進編輯態；② 編輯態下**文字＝頁內 `contentEditable`（不彈窗）**、**圖/流程圖＝雙擊 or hover 右上角「編輯」鈕**（**bpmn 編輯器維持彈窗**，因較大、連續彈窗差）；③ P2 之後**按 docx／pptx 拆成兩條獨立 track、各一 task＋一手動 schedule**（規格先寫齊、schedule 全手動由 老闆觸發），共用同一顆「線上編輯」開關（先跑者建、後跑者複用）；P3-b 合成 bpmn-svg 暫不排。落地＝`TASK.md §P`（P2-DOCX／P2-PPTX）。 |
| 2026-07-02 | v0.7 | 老闆 + Hana | **路線變更：重開 C＝擬真上「就地編輯」，取代 §11 的 A（新增 §13、§11 標為被取代但成果複用）。** 編輯從「左 md 投影」改到「右擬真畫面就地」，範圍嚴限文字＋換圖＋改 bpmn（縮到此範圍才有界可做）。**擬真預覽成為預設檢視、退役「擬真預覽」按鈕**（點清單即渲染 source 真身）。**錨定驗證 PASS**：docx＝2 行 patch 讓 docx-preview 帶出 `data-el`(paraId)、不需位置對映；pptx＝shape id 已 parse 進 `BaseNode.id`，用 `.tmp/pptx-eval` esbuild 管線小 patch 重打包帶出 `data-pptx-shape-id`＋段序（與 `SPEC-doc-roundtrip §6` 錨定一致）。回寫全複用 §K（`docx/pptx-writeback.py`、`image-writeback.py`）。表格只做格內文字，加列/欄→桌面 App 開 source 工作複本。「已變更」狀態＋手動寫回真身（甲=保留 Visio／乙=bpmn→svg，預設乙）；不做 hash 防呆（真身被改就重匯入）；git 由 老闆掌控。落地＝`TASK.md §M`。 |
| 2026-07-02 | v0.6 | 老闆 + Hana | **路線變更：pptx 擬真預覽引擎汰換 PPTXjs → aiden0z/pptx-renderer（新增 §12.6，§12.1–12.5 Path A 標為被取代、保留追溯）。** `DOC-L1-FIX02`（Path A 硬化 `pptx2html.js`）雖已 v179 上線，但只是「不硬失敗」的地板、保真仍卡在停維護的 PPTXjs 老 fork（合併格表格／字級繼承崩）。GitHub 調查後選定 aiden0z/pptx-renderer（TS、Apache-2.0、活躍 v1.2.3、明確支援表格合併格＋完整字級繼承鏈）整個汰換。紅線：①驗證先行拿範例專案 kic.pptx 離線試畫（不信 README）②通過才 vendor 換引擎、舊 `pptx2html.js`/`jquery.min.js` 退役③不通過則 `[SPEC-BLOCKER]` 回報、改評估 Path B soffice、勿私自換向。落地＝`TASK.md DOC-L1-04`。 |
| 2026-07-02 | v0.5 | 老闆 + Hana | **新增 §12：pptx 擬真預覽渲染引擎根因與健壯性重新設計。** 定性真根因＝`pptx2html.js`（停維護的 PPTXjs fork）對 slide→layout→master→theme 上百處深取值未防呆、假設 pptx 結構典型，真實客戶檔每次在不同處炸＝無界打地鼠（`getSchemeColorFromTheme`／`a:firstRow`／`slideMasterTextStyles`／JSZip 3.x 皆同一類）。重列渲染需求（**預覽永不整體硬失敗**：單片出錯降級佔位、其餘照常＋降級橫幅）。開放決策 Path A（硬化客戶端：per-slide 隔離＋取值鏈防呆＋JSZip 3.x async；建議、本次採）vs Path B（伺服器端 soffice 高保真；記錄為後備）。落地＝`TASK.md DOC-L1-FIX02`（收編原 FIX01）。 |
| 2026-06-26 | v0.1 | 老闆 + Claude | 初版。B+C 方案：md 為真身、paged.js+Word CSS 文件化預覽（B，與 DOC-P3-01 合流）、docx-preview 預覽真產出（C）；交付物＝pdf（B 列印，最高保真給只看的客戶）+ 升級的 docx（給要改的客戶，含 bpmn→SVG）；批量 docx→md 工具；pptx 平行（block deck 為真身、舊 pptx import 有損個案處理）。決策：不做 docx 回存編輯器、不上 ONLYOFFICE。 |
| 2026-06-30 | v0.4 | 老闆 + Hana | **L2 擬真上編輯拍板 A**：編輯落在 md 投影＋擬真預覽並排，送出走已完成的 §K 回寫到 source（不採 B inline 編輯）。文字由 Hana 改；**換圖沿用既有 `J1` docx 線上換圖那套 UX（`/api/documents/:id/image`），但需補一步把新圖回寫進 source（docx 用 `wp:docPr id`／pptx 用 `p:cNvPr id` 錨點換 media binary），使真身一致**。詳見新增 §11。 |
| 2026-06-30 | v0.3 | 老闆 + Hana | **優先序拍板：擬真預覽先於編輯。** §7 的 pptx 擬真預覽（pptxjs）從「後續」升為實作，補上 pptx 唯一缺的預覽一塊（docx 已有 §4 C／docx-preview）；「在擬真預覽上直接編輯」獨立為更大新能力、排在預覽之後並待拍板 A（md 投影編輯＋預覽並排，複用 K 回寫）/B（pptxjs/docx-preview 上 inline 編輯）。路線圖見 `TASK.md §L`。 |
| 2026-06-29 | v0.2 | 老闆 + Hana | **核心決策被 `SPEC-doc-roundtrip.md` 修訂**：真身由「md」翻轉回 **source.docx**，並**做 run 級回寫**（原 v0.1 寫「不做能回存的 docx 編輯器」已不成立）。原因：生成式 docx 回不到原檔版面（header／頁碼／logo／樣式），而 source.docx 本就保留、原生 paraId 讓安全回寫可行。本 spec 的 **B（文件化預覽）／C（預覽真產出）／pdf 交付** 仍有效，只是「真身與交付來源」改為 source.docx。round-trip 細節與路線圖以 `SPEC-doc-roundtrip.md` 為準。 |
