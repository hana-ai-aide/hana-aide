# SPEC-browser-pilot — 互動瀏覽器駕駛 daemon

## 用途

`portal/render-service/browser-pilot.js` 是 Hana 的感知→行動迴圈工具。
與一次性的 `screenshot.js`（只認 `.slide` 做簡報匯出）不同：它是**常駐 daemon**，
Playwright 頁面跨呼叫存活，讓 Hana 一步步點、截圖、看、再決定下一步。

典型使用場景：截 Portal 真畫面、填表單、驗證 UI 改動、更新自我介紹簡報素材。

---

## 埠（為何是 3390）

| 埠   | 用途                                  |
|------|---------------------------------------|
| 3300 | Harness Portal（prod，`HARNESS_PORT`） |
| 3399 | `Deploy_Harness.ps1` 冒煙測試         |
| **3390** | **browser-pilot daemon（本服務）** |

3399 原是 pilot 預設埠，但 `Deploy_Harness.ps1` 會 `Stop-HarnessOnPort 3399` ——
部署一跑 pilot 就被砍。2026-06-30 改 3390，三埠互不衝突。
可用 `PILOT_PORT` env 覆寫。

---

## 控制 API（mini http server，無 express）

```
POST /open   { width?, height?, workspace?, headful? }
POST /act    { steps:[...], shot?:{...} }
POST /shot   { fullPage?, selector?, clip?, name? }
POST /close  {}
GET  /health
```

所有 POST 回傳 JSON；`/act` 與 `/shot` 回傳：

```json
{ "ok": true, "url": "...", "title": "...", "shot": "<abs png path>", "elements": [...] }
```

`elements`：可見互動元素清單（cap 50），每個帶 `pid/tag/text/onScreen`；
頁面上已標 `data-pilot-id`，Hana 用 `[data-pilot-id="N"]` 精準點。

### Step 形式（`steps[]` 元素）

```
{ goto: "<url>", waitUntil?: "networkidle"|"load"|"domcontentloaded" }
{ click: "<sel>" }   { dblclick: "<sel>" }
{ fill: ["<sel>", "<text>"] }   { type: ["<sel>", "<text>"] }
{ press: "<key>" }  |  { press: ["<sel>", "<key>"] }
{ hover: "<sel>" }
{ scroll: "<sel>" }  |  { scroll: [x, y] }
{ waitFor: "<sel>" }   { wait: <ms> }
{ setViewport: [w, h] }
{ evaluate: "<js expr>" }
```

### Shot 選項（`shot` 物件）

```
{ fullPage?: bool, selector?: "<sel>", clip?: {x,y,width,height}, name?: "<basename>" }
```

---

## 截圖落點（天條 + 覆寫出口）

截圖目錄在**截圖當下**動態解析，優先順序：

1. `PILOT_SHOT_DIR` env → 用它（指揮官明確指定才存別處的唯一出口）
2. `_workspace`（最後一次 `/open` 帶的 workspace）存在 → `<workspace>/.harness/runtime/pilot/`
3. 連 workspace 也沒有 → `<HARNESS_HOME 或 cwd>/.harness/runtime/pilot/`

**絕不再用 `os.tmpdir()`**（違反「產出留在當前工作區」天條）。

`/open` 呼叫時 daemon 把 `body.workspace` 存進 `_workspace`，
讓後續不帶 workspace 的 `/act`、`/shot` 也能落到正確工作區。

`/health` 與 `/open` 回傳的 `shotDir` 反映當下實際使用的目錄（動態）。

---

## 有頭 / 無頭

- **預設無頭**（`PILOT_HEADFUL` 未設）：背景跑，無視窗，適合排程、截圖。
- `PILOT_HEADFUL=1` 或 `/open { "headful": true }` → 彈出真實視窗，指揮官可即時看著操作。
- pilot **自己擁有一顆瀏覽器**（`_browser`），與 `./index getBrowser()` 的 pptx/錄影共用無頭 singleton **完全隔離**；切有頭/無頭只重啟 pilot 自己那顆，不影響後臺管線。
- `/open { "headful": false }` 可就地切回無頭（daemon 重啟自己那顆 browser）。

---

## 與 index.js 共用 singleton 脫鉤

`screenshot.js` 呼叫 `index.js` 的 `getBrowser()` 共用 singleton。
pilot **不呼叫 `getBrowser()`**，自己維護 `_browser`。
因此：部署時 `index.js` 重啟、pptx 管線重啟，都不影響 pilot；
pilot daemon 可在不部署的情況下長時間跑。

---

## 相關技能 / 記憶

- **技能**：`global-knowledge/commands/open-browser.md`（包裝完整流程：問清需求→探活→啟動→迴圈→收尾）
- **記憶**：`memory/browser-pilot-tool.md`（埠說明、截圖落點、有頭/無頭）

---

## 分階段進化（現況）

| Phase | 狀態 | 內容 |
|-------|------|------|
| v1 | ✅ 完成 2026-06-30 | 感知→行動迴圈、有頭/無頭、工作區 X-Workspace |
| v1.1 | ✅ 完成 2026-06-30 | 守天條截圖落點（動態 getShotDir）、埠 3390、補 SPEC |
| v2 | 待規劃 | 多分頁並行、錄影模式 |
