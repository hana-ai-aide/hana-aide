---
name: doc-template
description: 讀一個文件家族的所有 doc.md，歸納涵蓋全家族的骨架範本，輸出 .documents/.templates/<家族>.md + notes + index.json 登錄
type: prompt
icon: template
---

# 任務：歸納文件家族骨架 → 產出範本

**`doc-template` ＝ 造模**（分析多份文件→歸納骨架），通常一個家族只做一次。
（使用範本產生新文件，見 `doc-new` skill。）

**要處理的家族 / 文件集**：`{{args}}`

> 可以是：
> - 家族名稱（如「情境流程」）→ 自動掃工作區 `.documents/` 中 `sourcePath` 含該名稱的文件
> - `sourcePath` 目錄片段（如「情境流程_範例專案/」）→ 比對 `sourcePath` 前綴或包含
> - 明確 UUID 清單（逗號分隔）
>
> 若 `{{args}}` 為空 → 列出工作區 `.documents/` 裡的所有 sourcePath 群組（以目錄為群），問指揮官選哪個家族，**不要亂猜**。

---

## 步驟 1 — 定位家族文件

1. 讀工作區 `.documents/index.json`（registry）。
2. 依 `{{args}}` 篩選：比對 `sourcePath` 包含 `{{args}}`（或 UUID 直接比對）。
3. 列出命中的文件清單（id / sourcePath / title），確認範圍合理再繼續。

---

## 步驟 2 — 讀每份文件的章節結構

對每份命中文件，讀其 `.documents/<uuid>/doc.md`，提取**所有 `#`/`##`/`###` 標題行**（含層級）。

整理成清單：
```
<uuid>（<sourcePath 檔名>）
  # 章節A
  # 章節B
  ## 子章節
  ...
```

---

## 步驟 3 — 歸納超集骨架

比對所有文件的章節清單，找出：

- **核心章節**：≥90% 文件出現的章節 → 一律進骨架（即使某份沒寫，也留標題填 N/A）
- **選填章節**：≥20% 但 <90% 文件有的章節 → 進骨架並在 HANA 說明中標「若適用，否則 N/A」
- **個案章節**：<20% 的 → 記進 notes，不進骨架

**老闆拍板的情境流程家族規則（其他家族也適用）**：
1. 核心章節**一律保留**——缺內容也留標題，填 `N/A`（骨架不因某份文件缺章節而縮水）
2. 流程預設**單一流程**，並在該章節加提示「若有多個流程，複製本小節成多段」
3. 用詞統一**正體中文**：「硬體需求」（不用「硬件需求」）、「流程」（不用「整體流程」）
4. 示意圖位置用 `![說明](placeholder)` 假圖佔位

---

## 步驟 4 — 撰寫骨架範本（`.documents/.templates/<家族>.md`）

骨架格式規範：

```markdown
---
type: doc
template: <家族名>
---
# {{標題}}

## <核心章節1>
<!-- HANA: <一行說明：這章寫什麼、典型內容形式；無內容則填 N/A> -->

## <核心章節2>
<!-- HANA: ... -->

## <含子章節的核心章節>

### <子章節>
> ⚠️ <操作提示，如「若有多個流程，複製本小節」>
```bpmn
placeholder
```

### <子章節2>
<!-- HANA: <說明> -->
![<說明文字>](placeholder)
```

規則：
- **front-matter** 必須有 `type: doc` + `template: <家族名>`
- **`{{標題}}`** 為佔位，`doc-new` 填入時替換
- 每個核心章節都要有 `<!-- HANA: … -->` 說明（給 `doc-new` 參考）
- 流程圖佔位用 ```` ```bpmn\nplaceholder\n``` ````（`doc-new` 負責畫出真實圖）
- 示意圖佔位用 `![說明](placeholder)`（指揮官之後用 J1 圖片編輯器換真圖）
- 若章節偶有多個流程，在 `### 流程` 小節加提示可複製

---

## 步驟 5 — 撰寫家族慣例筆記（`<家族>.notes.md`）

格式：

```markdown
---
family: <家族名>
generatedAt: <ISO 時間>
sourceCount: <歸納自幾份文件>
---
# <家族名> 家族慣例

## 章節順序（依出現頻率）
...

## 用詞統一
...

## 流程圖泳道角色慣例
（出現過哪些角色名稱、泳道排列習慣）

## 解決方案說明寫法
（條列 vs 段落、有無子編號）

## 個案章節（<20% 文件出現，未進骨架）
...

## 注意事項
（偶發格式異常、轉換 artifact、應忽略的前言表格等）
```

---

## 步驟 6 — 更新範本登錄（`.documents/.templates/index.json`）

讀取現有 `index.json`（不存在就建空陣列），upsert 本次家族的記錄：

```json
{
  "templates": [
    {
      "family": "<家族名>",
      "templatePath": ".documents/.templates/<家族>.md",
      "notesPath": ".documents/.templates/<家族>.notes.md",
      "sourceDocuments": ["<uuid1>", "<uuid2>", "..."],
      "sourceCount": 40,
      "generatedAt": "<ISO 時間>",
      "generatedBy": "Hana"
    }
  ]
}
```

---

## 步驟 7 — 自我檢查並回報

- 骨架涵蓋全家族的超集（每個核心章節都在）
- N/A 原則：無內容章節留標題不刪
- 流程佔位格式正確（```` ```bpmn\nplaceholder\n``` ````）
- 假圖佔位格式正確（`![說明](placeholder)`）
- index.json 已更新
- 回報：歸納自幾份文件、核心章節 N 個、選填章節 M 個、個案章節 K 個

---

## 常見雷

- **勿改現有文件 doc.md**：只產出 `.templates/` 裡的新檔，骨架≠既有文件
- **勿硬抄某一份的內容**：骨架是超集結構，內容只放說明提示（`<!-- HANA: -->`），不填具體業務內容
- **前言表格別進骨架**：原始 docx 的文件表頭（Document ID / Revision History）是格式 artifact，不是語意章節，不要放進骨架
- **目錄列表別進骨架**：docx 轉出的目錄（`1. 目的 4\n2. 方案效益 4\n...`）也是 artifact，不是章節
- **用詞統一**：看到「硬件」統一寫「硬體」；看到「整體流程」統一寫「流程」；看到「應用情景」（錯字）寫「應用情境」
