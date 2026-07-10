# SPEC — 文件轉換 pipeline（Word ⇄ Markdown，流程圖以 BPMN 呈現）

> **狀態**：P1+P2 已落地（機械轉換 + 圖片分類）；P3 分頁、P4 匯出 docx 為後續。
> **動機**：客戶情境/解決方案多為 Word，且數量多、需批次轉。絕大多數是文字、只有少數「圖/效果」在 Word 上 → 轉成 Markdown 後用瀏覽器渲染 ≈ 在 Word 上看，但**檔案小非常多、可版控、可被 AI 處理、可排程批次轉**。

## 1. 架構：機械轉換（腳本）與 AI 判斷（skill）分離 + 流程圖以「關聯為真相」

```
情境流程_md/
  <name>.md                       ← 主目錄只留乾淨的 .md
  素材/<name>/                    ← 每個 md 一個素材夾（命名空間：不同 word 同名流程圖不打架）
    imageN.png  /  _media_all/    ← docx-convert.py 抽的圖（EMF/WMF→PNG）
    <流程圖名>.flow.json          ← 【真相來源】節點＋from/to 關聯（AI 寫；小、省 token）
    <流程圖名>.bpmn               ← 【投影】flow-bpmn.js 從 flow.json 生成（無 DI；portal 自動排版）

.docx ─[docx-convert.py 機械]→ <name>.md ＋ 素材/<name>/imageN.png ＋ stdout manifest
      ─[word-to-md skill：AI]→ 逐張看圖：
          • 流程圖 → 寫 <流程圖名>.flow.json → `flow-bpmn.js to-bpmn` 產 .bpmn → md 換成 ```bpmn
          • 純圖   → 保留 ![](素材/<name>/imageN.png)
```

**為什麼這樣切**：① 機械、可重複（抽文字、抽圖、EMF→PNG、bpmn 座標）交給腳本；② 只有「這是不是流程圖、節點怎麼連」需要智能 → AI 寫**精簡關聯（flow.json）**即可，不碰座標、不手刻 bpmn XML。

**流程圖：flow.json 為真相、bpmn 為投影（雙向同步）**
- AI／指揮官要**讀流程** → 直接看 `.flow.json`（小、from/to 明確、省 token），不必載入整份 bpmn。
- 要**改流程** → 改 `.flow.json` → 跑 `flow-bpmn.js to-bpmn` 重產 bpmn。
- 在 portal 編輯器**手動改 bpmn 存檔** → server 的 `/api/file/save` hook 自動 `bpmnToFlow` 把語意**回寫 `.flow.json`**。
- 兩邊都只承載「語意」（節點/泳道/from-to），故互轉無損；版面（DI 座標）只活在 bpmn、由 portal 渲染時自動產生。**取捨**：純手動微調的座標在語意層再次編輯後會回到自動排版。

## 2. 元件

| 元件 | 職責 | 位置 |
|---|---|---|
| `docx-convert.py` | **mammoth→HTML→markdownify**（保留 GFM 表格、空格縮排清單；mammoth 的 md writer 會丟表格、巢狀清單用 Tab 被當程式碼區塊故改走 HTML）；圖抽成獨立檔到 `素材/<name>/`（不 base64、alt 留空）；**EMF/WMF→PNG**（Windows `System.Drawing`）；去封面/目錄 | `portal/render-service/docx-convert.py` |
| `flow-bpmn.js` | **`flowToBpmn`/`bpmnToFlow` 雙向轉換** + CLI（`to-bpmn`/`to-flow`）。flow.json↔bpmn 語意互轉（含 `notes`→textAnnotation/association 註解），無依賴、正則解析（容忍 `childLaneSet`） | `portal/render-service/flow-bpmn.js` |
| `word-to-md` skill | 跑腳本 → 逐圖分類（流程圖→寫 flow.json→產 bpmn／純圖→保留）→ 忠實性檢查 | `global-knowledge/commands/word-to-md.md` |
| bpmn→flow 反向同步 | `/api/file/save` 偵測 `.bpmn` 存檔 → `bpmnToFlow` 回寫同名 `.flow.json` | `portal/server.js` |
| BPMN id 消毒 | `sanitizeBpmnIds`：把非法 id（含中文）重映射成 ASCII，並改寫所有 ref（`sourceRef`/`targetRef`/`flowNodeRef`…） | `portal/index.html` |
| BPMN 泳道排版 | `layoutBpmnWithLanes`：對有 `<bpmn:lane>` 的圖自製泳道排版（lane→水平帶、節點依拓樸排 x、Pool 包覆、edge 正交路由）；無泳道才退回 `bpmn-auto-layout` | `portal/index.html` |
| ```bpmn 內嵌 | md 內 ```bpmn `<檔>` → 唯讀 SVG + 點「編輯」彈窗 | `portal/index.html` |

## 3. 關鍵技術決策

- **圖不內嵌 base64**：mammoth 預設把圖塞成 base64 data URI（這份 docx 因此一度 36MB）。改用 `convert_image` 把圖**存成檔**、md 只放 `![](assets/imageN.png)` → md 從 36MB 降到 ~4KB。
- **EMF→PNG**：Word 畫的流程圖常是 EMF/WMF 向量（OLE 物件），瀏覽器不顯示、AI 也看不到。用 `System.Drawing`（Windows 原生）轉 PNG → 可顯示、AI 可判讀重建。
- **流程圖 → BPMN（不是壓扁的 mermaid）**：保留所有節點/分支/迴圈、Pool+Lane 對應角色；**AI 只產語意、不算座標**，portal 自動排版。
- **泳道圖自製排版（`layoutBpmnWithLanes`）**：`bpmn-auto-layout` **不支援泳道**——餵泳道圖給它會丟掉 Pool/Lane 與全部連線、只剩重疊孤兒框（曾導致 16 節點只渲染出 3 個）。故凡有 `<bpmn:lane>` 一律走自製泳道排版，無泳道才退回 `bpmn-auto-layout`。
- **連線品質（`relayoutBpmnConnections`，渲染端）**：① 用 bpmn-js 自家繞線器重繞每條線（編輯器級貼齊）；② 偵測「同泳道長線穿過中間節點」→ 改走泳道淨空邊；③ 接點吸附：垂直/水平進出節點時把端點吸到該邊中心（manhattan-safe，2 點直線不動）。
- **直列為預設方向**：`orientation`（`vertical`/`horizontal`）是「渲染偏好」，不屬語意；skill 預設寫 `"vertical"`，`flow-bpmn.js` 轉檔時放 `<!-- harness:orientation=vertical -->` 註解標記，portal `ensureBpmnDi` 讀標記決定直/橫。首次在編輯器存檔後改由 DI 的 `isHorizontal` 接管；`bpmnToFlow` 會把方向讀回 flow.json。
- **id 必須 ASCII（`sanitizeBpmnIds`）**：bpmn-moddle/bpmn-js 的 `id` 規則是 ASCII NCName，**中文 id 會被當非法、整個元素在解析時靜默丟棄**（這是「只渲染 3 個節點」的更底層主因）。渲染前先消毒：非法 id→ASCII、同步改寫所有 ref；中文保留在 `name=""`。skill 也已要求 AI 直接產 ASCII id。

## 4. 限制（誠實）

- **像素級分頁不做**：md 是可重排的、沒有固定頁面。Word「自然排版到下一頁」無法精準複製（這也正是 md 小而靈活的原因）。→ P3 只做「保留明確分頁符 + 可分頁/不分頁檢視」。
- **DrawingML 畫的形狀**：若流程圖是直接用 Word 形狀畫（非 OLE/EMF），mammoth 抽不到圖檔 → AI 需請指揮官貼截圖。
- **EMF→PNG 限 Windows**（System.Drawing）；非 Windows 環境此步跳過。
- 轉換相依：`mammoth`（`pip install mammoth`）。

## 5. 後續 Phase

- **P3 分頁檢視**：偵測 Word 明確分頁符 → md 放分頁標記 → portal 用 paged.js 提供「分頁／不分頁」切換。
- **P4 匯出 docx**：md（含 bpmn 轉 SVG/PNG）→ docx，保留分頁符 + 超連結（pandoc 或 docx 庫）。原 D 系列「匯出 docx」併入此處。

## 6. 排程批次轉檔

`word-to-md` 是 skill，可被排程任務呼叫 → 一次轉一份；多份就排多個 once 任務或一個迴圈任務（注意：每份的圖片分類要 AI 看圖，會用 token）。
