# SPEC — Document Round-trip（docx／pptx 真身回寫・run 級逐段 diff）

> Status: DRAFT for discussion ｜ Owner: 老闆 + Hana ｜ 影響範圍：`portal/render-service/docx-convert.py`（改用自走訪 walker 生 doc.md ＋ 注入 paraId）、`portal/render-service/`（新增回寫器 docx-writeback.py / pptx 平行）、`portal/server.js`（編輯存檔端點：md → 回寫 source.docx）、`portal/index.html`（文件化編輯送出）、各工作區 `.documents/<uuid>/source.docx`
> 動機（2026-06-29 與 老闆）：客戶文件的真身是 docx（含 header／頁碼／頁首 logo／樣式），交付物要原檔級保真。先前 `SPEC-doc-editing.md` v0.1 走「md 為真身、docx 為生成交付物」，但生成的 docx 永遠回不到原檔的版面。老闆與 Hana 重新評估後翻轉：**source.docx 才是真身，編輯（在 md 面板）逐段 diff 後 run 級回寫進 source.docx**——保留原檔一切不被碰的部分，只動被改的字。
> ⚠️ 本 spec **修訂** `SPEC-doc-editing.md` v0.1 的核心決策「md 為真身 / 不做能回存的 docx 編輯器」。見 §7。
> ⚠️ 文件內任何 HTML／XML 標籤一律用反引號包（見 `TASK.md H1`）。

---

## 1. 核心原則（真身翻轉）

1. **真身 = source.docx**（已實體存在於 `.documents/<uuid>/source.docx`，匯入時複製、見 `server.js:1865`）。doc.md 是**它的可讀投影**，供閱讀與「文字校修」編輯；圖／流程圖另循既有 bpmn 機制。
2. **編輯只回寫被改的字，原檔其餘原封不動**：header、頁碼、頁首 logo、未被編輯段落的所有行內格式 → **一個 byte 都不碰**。這正是 md 生成式 docx 給不了的保真。
3. **不自造脆弱 ID**：對齊用 docx **原生隱形錨點**（`w14:paraId`、`wp:docPr id`），Word 看不到、能安全 round-trip。
4. **對齊靠「同一支程式同一趟」生 md＋錨點**：唯一可靠的對齊保證（見 §3）。
5. **md 是有損投影**：只承載「保留／文字」，不承載「新增顏色／字級」——這是接受的上限（老闆拍板，§5 決策 2）。

---

## 2. 注入標記：用 docx 原生錨點，不自造 ID

| doc.md 的一塊 | 對應 docx 原生錨點 | 說明 |
|---|---|---|
| 段落（文字塊） | `<w:p w14:paraId="7F3A2B1C">` | Word 共同編輯用的段落 ID，8 碼 hex；Word 本來就會打、但非每段都有 → 匯入時把缺的補滿 |
| 圖／流程圖 | `<wp:docPr id=…>` | 每個 drawing 物件自帶 ID |
| 表格 | 表格內第一段的 paraId（或補 bookmark） | |

- **「注入」= 匯入時對 source.docx 走一遍，補齊缺 paraId 的段落、其餘原封不動，存回 source.docx**。`paraId` 是 OOXML 標準屬性，不影響版面、Word 不顯示 → 最安全的注入。
- pptx 平行：段落同樣可用 `a:p`（無原生 paraId 時補一個自管屬性或以 shape+段序定位）；shape 用 `p:nvSpPr/p:cNvPr id`。詳見 §6。

---

## 3. 對齊：改用自走訪 walker 生 doc.md（取代 mammoth）

**問題**：現行 doc.md 由 mammoth 走 `docx → html → md`，**mammoth 把 paraId 整個丟掉** → 光有 paraId 也接不回去。

**設計**：以 python-docx 自走訪（同一趟）同時吐出：
- **可讀的 md**（給人看、給人編輯）；
- **每塊的錨點標記**，寫成 **HTML 註解** `<!-- el:7F3A2B1C -->`（不污染閱讀、md 渲染時不顯示）。

因為 md 與錨點是**同一支程式、同一趟走訪**生出來的，對齊是**天生保證**——不會被 mammoth 合併／拆分清單、巢狀表格時錯位。這是放棄 mammoth 的唯一理由，也是整套回寫可靠的前提。

> 代價：要重寫 import 的轉換層（mammoth → 自走訪 walker），中等工程，但這是唯一可靠的對齊方式。`docx-convert.py` 既有的「素材抽取、流程圖 → ```bpmn」流程沿用。

---

## 4. 回寫演算法：run 級・逐段 paraId 錨定 diff

編輯送出時，拿「**新 doc.md**」對「**上次生成的 doc.md（投影 base）**」做回寫。base 來源是**投影檔本身**（`.documents/<uuid>/` 內最近一次生成的 doc.md），不依賴 git（git 只是恰好也存著）。

### 4.1 三步

1. **逐段對齊（非整檔 diff）**：每段帶 `<!-- el:paraId -->` 錨點 → **同一 paraId 的「舊 md 段」對「新 md 段」**做字元級 diff。diff 範圍鎖在單一段落內，不會被「文字搬移／重複句」騙到——這是可靠的關鍵前提。
2. **字元 → run 重新指派**：一段 docx 是一串 run（每個 run = 一段格式一致的文字）。把該段 runs 攤平成「每個字帶它的格式」，用 difflib 的 opcode：
   - **未變的字** → 沿用原字的 run 格式（粗體／顏色／字級全保住）；
   - **被取代／新增的字** → 繼承格式（規則見 §5 決策 1）。
   再把「連續且格式相同」的字併回 run，寫回該 `<w:p>`。**未被動到的 run 原封不動。**
3. **新段落**：找「相同邏輯類型的鄰段」當 style donor 複製樣式，插在對應 paraId 之間。

### 4.2 工具與相依

- **零安裝**：difflib（標準庫）＋ python-docx／python-pptx（既有）。
- 新增 `portal/render-service/docx-writeback.py`（pptx 平行檔或同檔分支）。

---

## 5. 已拍板決策（老闆，2026-06-29）

1. ✅ **被取代字繼承誰的格式** → 繼承**該段第一個被取代字**的原格式。落差無妨，重點是文字。
2. ✅ **md 無損上限** → 接受。md 表達不出顏色／字級／上標 → 在 md 面板**只能保留、不能新增**這類格式；要設顏色等仍回 Word。以**文字生成為主**，正式輸出前 老闆再於 Word 補正確格式即可。
3. ✅ **pptx 也要一份投影、且沿用 `doc.md` 這個名字** → 不另立 `deck.md`／結構檔，維持「每份文件都有一份 `doc.md`」的鐵則、文件管理面不為 pptx 開特例。投影的**角色**與 docx 相同（可讀＋編輯面＋diff base），只是**內部排版依片分區**：用 `## Slide N` 標頭切片，每片下列各文字框的段落、每段照樣帶錨點註解（見 §6）。

---

## 6. pptx 平行（同一模型，投影依片分區）

- **真身** = 客戶 pptx 的工作複本（比照 source.docx，存 `.documents/<uuid>/source.pptx`）。
- **投影** = 同樣以自走訪 walker（python-pptx）生 `doc.md`，但**依片分區**（決策 3）：
  - 每張投影片一個 `## Slide N` 標頭（pptx 無線性順序，必須靠分區與錨點把文字定回「哪張片、哪個框」）。
  - 該片下逐文字框、逐段列出文字；每段帶錨點註解，形如 `<!-- el:<shapeId>/<paraIndex> -->`（shape 用 `p:nvSpPr/p:cNvPr id`，段落以框內段序定位——pptx 段落無原生 paraId）。
- **回寫** = 與 docx 同一套：用 `## Slide N` ＋錨點逐段對齊「新投影段 vs base 投影段」→ 字元 diff → run（`a:r`）級回寫，只動改到的字、保住其餘 run 格式；圖／流程圖照既有換圖路徑（`docPr`／圖片 part）。
- **對外仍是同一條規則**：每份文件 = 一份 `doc.md` 投影 ＋ 錨點 ＋ run 級回寫；只有投影「內部排版」隨來源型別不同（docx 流式、pptx 依片分區）。技能與文件管理面不必為 pptx 分叉。
- **與 `SPEC-block-deck.md` 的分工**：**新簡報**用 block deck（乾淨真身）；**舊客戶 pptx 的文字校修回寫**走本 spec。兩者不衝突，前者建立、後者修補。

---

## 7. 與既有 spec 的關係（含修訂聲明）

- **修訂 `SPEC-doc-editing.md` v0.1**：該版核心決策為「md 為真身、docx 為生成交付物、**不做能回存的 docx 編輯器**」。本 spec 將真身改回 **source.docx、做 run 級回寫**。原因：生成式 docx 回不到原檔版面（header／頁碼／logo／樣式），而原檔本就被保留、且原生 paraId 讓安全回寫可行。`SPEC-doc-editing.md` 的 **B（文件化預覽）／C（預覽真產出）／pdf 交付** 仍有效，只是「真身與交付來源」由 md 改成 source.docx；待 老闆確認後，於 `SPEC-doc-editing.md` 補一條 changelog 指向本 spec。
- `SPEC-document-registry.md`：source.docx 的儲存、版本歷史（§3a/§3a-1）已就位；本 spec 的「編輯」會新增一筆 `edit` 事件並快照 source.docx（資產快照機制延伸到 source.docx）。
- `SPEC-doc-convert.md`：import 轉換層由 mammoth 改為自走訪 walker（§3）是它的修改。
- `SPEC-document-framework.md`：編輯／送出動作掛在每文件動作列。

---

## 8. 分階段路線

- **P1（地基）**：自走訪 walker 取代 mammoth，生 doc.md ＋ `<!-- el:paraId -->` 錨點；匯入時補滿 paraId 並注入 source.docx。產出與現行 md 閱讀體驗對齊（錨點為註解、不可見）。
- **P2（回寫核心）**：`docx-writeback.py`——逐段 paraId 字元 diff → run 重組 → 寫回 source.docx；接 server 編輯送出端點；每次回寫記 `edit` 事件 + 快照 source.docx。
- **P3（保真細節）**：新段落 style donor 複製；表格／清單段落的錨定強化。
- **P4（pptx 平行）**：source.pptx 同模型回寫。

---

## 9. 待拍板（遇到先採預設、記錄，勿卡住）

1. 新段落 style donor 找不到「同類鄰段」時 → 用前一段樣式（預設）vs Normal？→ 先用前一段。
2. 段落被整段刪除（新 md 該 paraId 消失）→ 直接刪 `<w:p>`（預設）vs 標記待確認？→ 先直接刪，靠版本歷史可還原。
3. paraId 注入發生在「匯入時一次補滿」（預設）vs「每次回寫前確保」？→ 先匯入時補滿；回寫前做一次校驗補漏。
4. base（舊 md）以「最近一次生成的 doc.md」為準（已定，§4）——但若使用者在 Word 端改了 source.docx 造成 md/docx 不同步 → 偵測到 source.docx mtime 新於投影時，先重生 md 再讓編輯（避免回寫蓋掉 Word 端改動）。先採此保護，細節 P2 定。

---

## 10. Changelog
| Date | Version | Author | Description |
|:-----|:--------|:-------|:------------|
| 2026-06-29 | v0.1 | 老闆 + Hana | 初版。真身翻轉：source.docx 為真身、doc.md 為可讀投影，編輯經 **run 級・逐段 paraId 錨定字元 diff** 回寫 source.docx（保留 header／頁碼／logo／未改段落格式）。三機制：① 原生 `w14:paraId`／`wp:docPr id` 錨點，匯入時補滿並注入、不自造 ID；② 自走訪 walker 取代 mammoth、同趟生 md＋`<!-- el:paraId -->` 註解保證對齊；③ difflib 字元 diff → run 重組回寫（零安裝）。已拍板：被取代字繼承「該段第一個被取代字」格式、md 無損投影（只保留不新增顏色/字級，正式輸出前回 Word 補）。pptx 平行同模型。**修訂 `SPEC-doc-editing.md` v0.1「md 為真身/不回存」決策**。分 P1 walker＋注入 / P2 回寫核心 / P3 保真 / P4 pptx。 |
| 2026-06-29 | v0.2 | 老闆 + Hana | 補拍板決策 3：pptx 也要投影、且**沿用 `doc.md`** 不另立型別（維持「每份文件都有 doc.md」鐵則）；投影內部依 `## Slide N` 分區、每段帶 `<!-- el:<shapeId>/<paraIndex> -->` 錨點（§6 寫清）。對外仍是「一份 doc.md 投影 ＋ 錨點 ＋ run 級回寫」單一規則，只有投影內部排版隨型別不同。 |
