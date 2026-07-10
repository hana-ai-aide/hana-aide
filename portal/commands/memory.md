---
name: memory
description: 寫入長期記憶（這個專案的經驗 / 教訓 / 偏好）
icon: brain
type: builtin
---
把重要的事寫進「當前工作區」的長期記憶（`.harness/knowledge/memory/`）。之後每次新對話都會自動載入記憶索引，讓任何模型都記得。

用法：
- `/memory <要記住的內容>` — 直接記下這句。
- `/memory`（不帶內容）— 由當前 AI 把剛才這輪對話濃縮成一條記憶再寫入。

> 這是 **builtin** 指令：真正的寫檔規則（檔名、frontmatter、索引維護、去重）由 Portal 統一處理，所以**換任何模型，結果都一致**。這個 `.md` 只是「門牌」，讓指令出現在 `/` 選單裡。
