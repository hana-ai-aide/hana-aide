---
name: open-browser
description: 開一個瀏覽器去做事——可選有頭（你看得到我操作）或無頭（背景跑）；驅動 browser-pilot 感知→行動迴圈
type: prompt
icon: globe
---

# 任務：開瀏覽器做事（browser-pilot 駕駛）

指揮官要我開一個瀏覽器、到某個網頁上完成一件事。我用自己的互動駕駛工具 **`portal/render-service/browser-pilot.js`**（常駐 daemon、Playwright 頁面跨呼叫存活、感知→行動迴圈）。相關記憶：[[browser-pilot-tool]]。

**指揮官在指令後給的內容**：`{{args}}`

## 步驟 0 — 先問清楚（除非 `{{args}}` 已寫明）

`{{args}}` 若已含「網址＋要做什麼」就直接開工；**有缺就先一次問齊，不要逐項擠牙膏**：

1. **要開哪個網頁？**（網址；若是 Portal 內部頁，預設 `http://127.0.0.1:3300/`，埠看 `HARNESS_PORT`）
2. **有頭還是無頭？**
   - **有頭（headful）**＝真的彈一個視窗在你桌面、你能即時看著我點。看 demo、想盯著我操作、要你確認時用。
   - **無頭（headless，預設）**＝背景跑、不彈窗，適合純截圖／例行任務／排程。
3. **要我做什麼？**（例：登入後截某頁、填表單、點到某文件、抓某數字）
4. （若是 Portal 真畫面）**哪個工作區？**——要帶 `workspace`，daemon 會 %-encode 成 `X-Workspace` 標頭。

## 步驟 1 — 確保 daemon 在跑（用對的模式）

先探活：`curl -s http://127.0.0.1:3390/health` → 回傳含 `headful` 欄位。

- **沒在跑** → 背景啟動。截圖輸出**務必放進當前工作區**（天條），用 `.harness/runtime/pilot/`：
  ```bash
  # 有頭：
  PILOT_HEADFUL=1 PILOT_PORT=3390 PILOT_SHOT_DIR="<工作區>/.harness/runtime/pilot" node portal/render-service/browser-pilot.js   # 背景跑
  # 無頭：拿掉 PILOT_HEADFUL（或設 0）即可
  ```
- **在跑但模式不對**（要有頭卻 `headful:false`，反之亦然）→ 兩條路：
  - 直接在 `/open` 帶 `{"headful":true}` 或 `{"headful":false}`——daemon 會**就地重啟自己那顆瀏覽器**切換模式（不影響 pptx/錄影那顆共用無頭 singleton）。
  - 或先 `Stop-Process` 掉舊 daemon（`Get-NetTCPConnection -LocalPort 3390 -State Listen`）再用對的 env 重啟。

## 步驟 2 — 開頁 + 感知→行動迴圈

1. `POST /open {width?,height?,workspace?,headful?}` 開一個乾淨頁面。
2. `POST /act {steps:[...], shot:{name}}` 做動作後自動截圖，回 `{url,title,shot,elements}`。
   - steps 支援 `goto/click/dblclick/fill/type/press/hover/scroll/waitFor/wait/setViewport/evaluate`。
3. **每步都 Read 回傳的那張 png 看畫面**，用 `elements`（每個可點元素被標了 `data-pilot-id`）決定下一步，以 `[data-pilot-id="N"]` 精準點。Portal 是 SPA，點導覽不改 URL，**一律靠讀截圖確認畫面真的切了**，不靠 URL 猜。
4. 做完回報：**只給結果與重點＋最終截圖路徑**，不要把元素清單或長 JSON 倒回聊天。

## 步驟 3 — 收尾

- 任務完成、指揮官沒說要留著 → `POST /close`（關 context，daemon 與瀏覽器保持暖機）或讓他決定要不要收 daemon。
- 把這次的網址、選擇器、踩到的雷沉澱：一次性的寫進這次回報即可；**會重複做的**就提議寫成腳本（一支 `.js`/`.ps1` 打 `/act` 的固定 steps），或排進 scheduler 當例行任務（記得：排程預設**無頭**，因為沒人看著）。

## 鐵則
- **產出留在當前工作區**：截圖一律進 `<工作區>/.harness/runtime/pilot/`，絕不寫到 `C:\Users`、系統 temp 或工作區外。
- **有頭只在指揮官想看時用**；排程／背景一律無頭。
- 對外或不可逆的網頁動作（送出表單、發訊息、刪資料）**先跟指揮官確認**再做。
