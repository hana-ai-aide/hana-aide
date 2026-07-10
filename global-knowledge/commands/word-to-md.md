---
name: word-to-md
description: 把 Word(.docx)轉成 Markdown，並把裡面的流程圖以 BPMN（可編輯泳道）呈現
type: prompt
icon: file-text
---

# 任務：Word → Markdown（流程圖以 BPMN 呈現）

把指定的 .docx 轉成忠實的 Markdown；文件裡的**流程圖**先寫成 **`.flow.json`（節點＋from/to 關聯）**、再由腳本生成 **`.bpmn`** 內嵌；**純圖片**直接內嵌。
規格見 `$HARNESS_HOME/specs/SPEC-doc-convert.md`。**機械轉換（抽文字/圖）交給腳本、版面（bpmn 座標）交給腳本；你只做「看圖判斷 + 寫流程關聯」。**

**要轉的檔（指揮官在指令後給的）**：`{{args}}`

> 這是相對「當前工作區」的 .docx 路徑或檔名。若 `{{args}}` 是空的 → 列出工作區內的 `*.docx` 問指揮官要轉哪個，**不要自己亂猜**。整個流程**一氣呵成、不要中途停下來問**（除非遇到看不清的圖，見步驟 2）。

> ⚠️ **路徑重點（不要寫死）**：轉換腳本與規格住在 **Hana 的安裝目錄**，由環境變數 **`HARNESS_HOME`** 指向（伺服器啟動時自動設定、跟著安裝位置走）。你目前的工作區（cwd）是客戶專案（如範例專案），所以**用 `HARNESS_HOME` 組腳本路徑**；`{{args}}` 與輸出目錄則是相對「當前工作區」的路徑。

## 步驟 1 — 先跑機械轉換腳本（不要自己手刻文字）

**🚫 鐵則：所有 `.md` 平鋪在「同一個共用輸出資料夾」裡，素材放該資料夾的 `素材/<name>/` 子夾。絕對不要每個檔開一個 `<name>_md` 子資料夾**（那是已廢除的舊做法，會把 md 跟素材包在一起、結構很亂）。

- **輸出資料夾**：指揮官/任務有指定就用那個（例如「情境流程_md」）；沒指定才用 **docx 所在的資料夾**。
- **`docx-convert.py` 的第 2 個參數＝那個共用資料夾本身**（例如 `情境流程_md`），**不要**在後面再接 `<name>_md`。

```powershell
# PowerShell
$doc = "{{args}}".Trim('"',' ')                              # 要轉的 docx
$out = [IO.Path]::GetDirectoryName($doc); if (-not $out) { $out = "." }  # 預設＝docx 同資料夾
# ↑ 指揮官若指定了輸出資料夾（如「情境流程_md」），把 $out 改成它
python "$env:HARNESS_HOME\portal\render-service\docx-convert.py" "$doc" "$out"
```
```bash
# bash（指揮官指定輸出資料夾時，把第 2 個參數換成它，如 "情境流程_md"）
doc="{{args}}"; out="$(dirname "$doc")"
python "$HARNESS_HOME/portal/render-service/docx-convert.py" "$doc" "$out"
```

它會產出：① `<name>.md`（文字/表格/清單，忠實、小檔）② `素材/<name>/imageN.png`（抽出的圖，EMF/WMF 已轉 PNG）③ stdout 印出**圖片清單**。md 裡每張圖先是 `![](素材/<name>/imageN.png)`。**這個 md 的所有素材（圖片、流程圖的 `.flow.json`/`.bpmn`）都集中在 `素材/<name>/` 子資料夾**，主目錄只留乾淨的 `.md`。

> 缺套件就先 `python -m pip install mammoth markdownify`。腳本走 mammoth→HTML→markdownify，所以**表格會保留成 GFM 表格**、清單用空格縮排、圖片 alt 留空（避免多行圖說弄壞 ![]）。腳本只負責「文字＋表格＋抽圖＋EMF→PNG＋去封面/目錄」，**不判斷哪張是流程圖**。

## 步驟 2 — 逐張看圖分類（這才是你的工作）

對清單裡的每一張 PNG，**實際打開看**（用 Read 工具讀圖），判斷。

**判斷準則——不是看「有沒有方塊/箭頭」，是看「方塊與箭頭代表什麼」。** 核心一問：**箭頭連的是『一個動作接下一個動作（先後順序）』，還是『東西與東西之間的關係（關聯／對應／歸屬／資料或物料流向）』？** 只有前者才是流程圖。

- ✅ **是流程圖／泳道圖 → 重建**（步驟 3：先寫 `.flow.json` 再產 `.bpmn`，並把 md 裡那張 `![](...imageN.png)` 整行換成 ```bpmn 區塊）。**需同時滿足**：① 節點是「**動作/步驟**」（動詞：進片／檢核／報工／投料…），不是「物件/資料/實體/角色/狀態」；② 箭頭代表「**先後順序（控制流）**」：A 做完→換 B 做；③（加分）判斷菱形分支、角色泳道、開始/結束點、迴圈。
- 🚫 **不是流程圖 → 保留** `![](素材/<name>/imageN.png)` 不動——**即使有方塊和箭頭**：**關係／連結圖**（方塊是物件/資料/實體，箭頭表達關聯／對應／歸屬／資料或物料流向，如 成品SN↔半成品SN、大板→小板、物料投入→產出）、**只有箭頭沒有離散處理步驟的純連結**、資料樣態/範例圖、產品/物件立體示意圖、架構/關係圖、照片、Logo、卡通圖示拼的示意圖。**鐵律：有箭頭 ≠ 流程圖**；箭頭若表達「關係/流向」而非「動作先後」，就是示意圖，保留為圖片。
- **看不清楚或抽不到的圖**（Word 用形狀直接畫的、腳本抽不到）→ 先跟指揮官說、請他貼截圖，**不要腦補節點**。
- **也看 `ALL_EMBEDDED_IMAGES`（`素材/<name>/_media_all/`）**：docx 內全部內嵌圖。若這裡有流程圖但 `IMAGES_IN_MD` 沒有（mammoth 漏放，常見於頁首頁尾或某些 Visio/OLE 預覽），**對照原文位置自己補進 md**。

## 步驟 3 — 流程圖 → 先寫 flow.json，再產 bpmn（重點）

**真相來源是 `.flow.json`（精簡的節點＋from/to 關聯），`.bpmn` 是從它生成的「畫面投影」。** 你只寫關聯、版面（座標）全交給腳本——**不要手刻 bpmn XML、不要算座標**。

> 🧩 **矩陣泳道要「拆成多張」**：若一張流程圖是「**直向＝角色泳道，但左側橫帶是不同流程/階段的標籤**」（例如左欄寫著 材料上機／材料下機／參數採集），那是把**多個各自獨立的流程**疊在一張省空間——**不要**硬做成 2D 矩陣。請**一個橫帶拆成一張流程圖**，每張沿用**相同的角色直欄（lanes）**，`title`/檔名用該流程名（如 `材料上機.flow.json`、`材料下機.flow.json`、`參數採集.flow.json`）。md 的那個位置就放**多個 ```bpmn**、各指向一張。

> 📁 下面寫的 `素材/<name>/…` 都在**步驟 1 的輸出目錄底下**（docx-convert.py 已建好這個夾、圖片也在裡面）。寫檔／跑 CLI 時請用**實際路徑**＝`<輸出目錄>/素材/<name>/…`（例：`情境流程_md/素材/AOI機聯網/參數採集流程.flow.json`）。而 md 裡的 ```bpmn 路徑是**相對 md 檔**，所以只寫 `素材/<name>/<流程圖名>.bpmn`。

**3a. 寫 `素材/<name>/<流程圖名>.flow.json`**（流程圖名用簡短語意，如 `參數採集流程`）：

- **忠實、禁止簡化**：圖有幾個節點就幾個；保留**每個 OK/NG 分支、每條迴圈**（如「擦除→重印→回送料重檢」）。⚠️ 別把多節點泳道壓成線性、別掉角色泳道。
- **`lanes`＝角色泳道**：列出每個負責角色（如 計畫層(ERP)／管理層(MES)／控制層(EAP)／設備層(AOI)／檢測人員），順序＝你要的排列。
- **`orientation`＝`"vertical"`（預設，直列泳道）**：泳道並排成直欄、流程由上往下。請一律寫 `"vertical"`，除非流程節點很少、橫排明顯更好才用 `"horizontal"`。
- **`nodes`**：`id` 用簡短 **ASCII**（`n1`,`g1`,`feed`…，英數＋底線；中文放 `name`）；`type` ∈ `start`/`end`/`task`/`gateway`（省略＝task）；`lane` 填角色名（要在 `lanes` 裡）。
- **`edges`**：`{from,to}`，判斷分支加 `label`（如 "OK"/"NG"）。
- **`notes`（選填）＝便利貼註解**：圖裡那種「掛在某步驟旁、說明方法/設定的框（常是不同顏色）」——不是流程步驟本身——寫成 `{ "text":"...", "attachTo":"<節點 id>" }`。會畫成 BPMN 文字註解（便利貼框 + 虛線連到該步驟），自動擺在泳道外側、不擋流程。

格式範本：

```json
{
  "title": "參數採集流程",
  "orientation": "vertical",
  "lanes": ["設備層(AOI)", "控制層(EAP)", "管理層(MES)", "檢測人員"],
  "nodes": [
    { "id": "n1", "name": "開始", "type": "start", "lane": "設備層(AOI)" },
    { "id": "n2", "name": "進片", "lane": "設備層(AOI)" },
    { "id": "g1", "name": "初判結果", "type": "gateway", "lane": "管理層(MES)" },
    { "id": "e1", "name": "帳務往下一站", "type": "end", "lane": "管理層(MES)" }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "g1", "to": "e1", "label": "OK" },
    { "from": "g1", "to": "n2", "label": "NG" }
  ],
  "notes": [
    { "text": "說明：此步驟依上機方式挑功能", "attachTo": "n2" }
  ]
}
```

**3b. 從 flow.json 產 bpmn**（確定性腳本、無 DI、portal 自動排版含泳道）：

```powershell
# PowerShell
node "$env:HARNESS_HOME\portal\render-service\flow-bpmn.js" to-bpmn "素材\<name>\<流程圖名>.flow.json"
```
```bash
node "$HARNESS_HOME/portal/render-service/flow-bpmn.js" to-bpmn "素材/<name>/<流程圖名>.flow.json"
```
→ 看到 `BPMN_FILE: ...` 代表產出了同名 `素材/<name>/<流程圖名>.bpmn`。

**3c. 在 md 內嵌**（缺一不可）：把原本那張 `![](...)` 整行換成（路徑＝**相對 md 的相對路徑**，不要絕對路徑／workspace 參數）：
````
```bpmn
素材/<name>/<流程圖名>.bpmn
```
````
**只產檔而 md 沒有 ```bpmn ＝ 失敗。**

> 為什麼這樣：之後要「讀流程」直接看 `.flow.json`（小、省 token）；要「改流程」改 `.flow.json` 再跑 3b 重產 bpmn；在 portal 編輯器手動改 bpmn 存檔，server 會**自動把語意回寫 `.flow.json`**——雙向同步。

## 步驟 4 — 自我檢查並回報

- md 每張流程圖都換成 ```bpmn、純圖都保留 ![]；
- 每個 `.flow.json` 的節點數＝原圖節點數、分支與迴圈都在、泳道角色齊全；
- `to-bpmn` 有成功（看到 `BPMN_FILE:`），且 `.bpmn` 在 `素材/<name>/`；
- 文字無漏段／漏表格。

## 常見雷

- **真相在 flow.json**：要改流程改 `.flow.json` 再跑 `to-bpmn`；手改 bpmn 也行（存檔會自動回寫 flow.json），但語意層以 `.flow.json` 為準。
- **素材都進 `素材/<name>/`**：圖片、`.flow.json`、`.bpmn` 都放這，主目錄只留 `.md`。
- ```bpmn 路徑寫**相對 md 的相對路徑**，不要絕對路徑／workspace 參數。
- 簡單線性流程可用 ```mermaid；真正的角色泳道一律走 flow.json→bpmn。
- **別動 `harness.json`**：要掛側邊欄就改**檔名正是 `harness.json`**、格式 `{ "sidebar": { "sections": [{ "label","icon","path","filter" }] } }`。不要自創格式。
