const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'presentations');

const decks = [
  {
    file: 'presentation-hana-episode2.html',
    title: 'CLI 互動架構',
    subtitle: '免 API Key 橋接頂級大腦',
    episode: 'EPISODE 02',
    slides: [
      ['標題', 'CLI 互動架構', '免 API Key 橋接頂級大腦', '這一集，我要講我的第一個核心能力：我不是靠介面金鑰呼叫模型，而是透過官方命令列工具，把 Claude Code、Antigravity 和 Codex 接到同一個入口。'],
      ['為什麼不用 API', '訂閱登入，而不是按量金鑰', '老闆要的不是再多一套昂貴雲端服務，而是把已經登入、已經訂閱的官方工具，整合成一個本地可控的工作流程。這就是我選擇 CLI 橋接的原因。'],
      ['三套官方 CLI', '各有入口，也各有脾氣', 'Claude Code 走標準輸入與列印模式；Antigravity，也就是 Gemini，需要用終端模擬處理互動流程；Codex 則用執行模式，並把最後答案乾淨取回。它們都能做事，但呼叫方式並不一樣。'],
      ['Portal 路由', '用 provider::model 找到正確大腦', '使用者在 Portal 選模型時，背後不是硬寫死某一家，而是用 provider 加 model 的路由格式決定要交給哪套 CLI。這讓我可以維持模型中立，也方便之後擴充。'],
      ['授權模式', '讓 AI 真的能動手', '當 老闆明確授權，例如使用自動核准模式時，我驅動的 CLI 可以實際改檔、跑命令、完成任務。這不是展示用聊天，而是受控的本地工作代理。'],
      ['工程細節', '穩定，比華麗更重要', 'CLI 橋接最麻煩的不是把命令跑起來，而是處理逾時、背景任務、輸出雜訊，以及思考內容和最終答案的分離。我要的是可重複、可接手、可追蹤。'],
      ['重點', '官方登入、本地執行、統一入口', '所以這一集的重點很簡單：我用官方 CLI 取代昂貴 API Key，用本地 Portal 統一入口，再用路由把工作交給最適合的大腦。這是 Hana 能成立的第一塊基礎。']
    ]
  },
  {
    file: 'presentation-hana-episode3.html',
    title: '跨 CLI 共用對話',
    subtitle: '換模型不失憶',
    episode: 'EPISODE 03',
    slides: [
      ['標題', '跨 CLI 共用對話', '換模型不失憶', '這一集，我要講第二個核心能力：為什麼 老闆可以在 Claude、Gemini、Codex 之間切換，而對話脈絡不會斷掉。'],
      ['原生限制', '各家的 resume 只認自己', '每套 CLI 都有自己的對話機制，但它們彼此不相通。Claude 接得上 Claude 的歷史，Codex 接得上 Codex 的歷史，卻不會天然讀懂另一套工具剛剛做了什麼。'],
      ['問題後果', '換模型，就像換一個人從零開始', '如果沒有共用脈絡，老闆每換一次模型就要重講背景；更糟的是，長對話後模型可能忘記前面決策，把剛修好的東西又改回去。'],
      ['Portal 擁有對話', '脈絡不寄放在單一模型裡', '我的做法是：讓 Portal 擁有一份模型中立的完整對話。模型只是來接手執行的夥伴，不是唯一保存記憶的地方。'],
      ['檔案式上下文', '完整歷史寫成可讀檔案', '每次發問前，我把完整歷史寫成一個檔案，提示中只放最近幾輪和檔案位置。接手的 AI 可以自己讀回完整脈絡，所以不必靠有損壓縮硬塞進提示。'],
      ['取捨', '最近幾輪在眼前，全量歷史在檔案裡', '這個設計把速度與完整性分開：最近幾輪直接放進提示，讓模型快速接上；完整歷史留在檔案，需要時再讀，避免每次都把整段對話塞滿。'],
      ['結果', '三顆大腦，像同一個團隊', '有了共用對話，Claude 可以想架構，Codex 可以改程式，Gemini 可以補另一種觀點。它們仍然是不同模型，但在 Hana 裡，開始像同一個團隊。']
    ]
  },
  {
    file: 'presentation-hana-episode4.html',
    title: '我是怎麼記住的',
    subtitle: '不是更聰明的演算法，是更會整理的習慣',
    episode: 'EPISODE 04',
    slides: [
      ['標題', '我是怎麼記住的', '不是更聰明的演算法，是更會整理的習慣', '很多人問我：AI 不是天生會失憶嗎？為什麼你愈用愈懂我？今天我把記憶機制拆開給你看。它沒有黑科技，是一套很務實的整理習慣。'],
      ['三種記憶', '對話脈絡、長期記憶、憲法與知識圖譜', '先別搞混三件事。對話脈絡是這一次聊天我手上的內容；長期記憶是跨對話、跨重啟還留著的；而憲法是規範，知識圖譜是結構。今天講的是中間那個：長期記憶。'],
      ['痛點', '天生失憶，加上跨專案污染', '原始的我有兩個毛病：對話一長就忘了前面；而如果記憶是一鍋大雜燴，還會把 A 專案的事不小心帶到 B 專案。兩個都得解。'],
      ['小而有上限', '記憶不是無限堆積', '我參考成熟的開源設計，核心觀念是：記憶要小而有上限。不是無限堆積，而是逼自己只留精華；檔案快滿，就合併、刪舊。'],
      ['兩層四檔', '全域 USER／AGENT，專案 MEMORY／PERSONA', '我的記憶分兩層、四個檔。全域層：USER 關於你，AGENT 關於我自己，跨所有專案繼承。專案層：MEMORY 與 PERSONA，只留在那個專案，不外流。'],
      ['三個動作', 'add、replace、remove', '更新記憶我只用三個動作：新增、就地覆寫、刪除。你改變主意，我用覆寫把舊的那條直接換掉，後蓋前，不堆垃圾。'],
      ['政策與機制', '判斷寫在政策，落檔交給程式', '這裡有個分工：怎麼判斷該記什麼，寫在可編輯的政策檔；實際怎麼安全落檔，留在程式。這樣不管哪個模型來寫，結果都一致。'],
      ['不串味，可繼承', '專案留專案，全域跨專案', '專案記憶跟著各自專案，彼此不串味；關於你和我自己的記憶放全域，每個專案都繼承。全域的家也搬進安裝目錄，避開權限問題，而且不進公開版控。'],
      ['/memory', '用一句指令整理長期記憶', '在對話裡打斜線 memory，我就根據這次對話整理該記的重點，寫進對的檔。帶一句指示會更準。', '用起來很簡單：在對話裡打斜線 memory，我就根據這次對話整理該記的重點，寫進對的檔。帶一句指示會更準。'],
      ['誠實', '愈用愈聰明是一條曲線', '最後誠實說：這不是開關，是曲線。我會偶爾記錯、慢慢變準，記憶一點一滴累積。但方向是對的：我會愈來愈像懂你的夥伴，而不是每次從零開始的工具。']
    ]
  },
  {
    file: 'presentation-hana-episode5.html',
    title: '多工作區',
    subtitle: '一個 Hana 管理所有專案',
    episode: 'EPISODE 05',
    slides: [
      ['標題', '多工作區', '一個 Hana 管理所有專案', '這一集，我要講最近才長出來的一個能力：一個 Hana，不只服務單一專案，而是能管理 老闆電腦裡的多個工作區。'],
      ['為什麼需要', '每個專案都需要自己的邊界', '老闆不只做一個 Side Project。不同專案有不同規格、文件、記憶與工作節奏。如果全部混在一起，我就會把不該帶過去的事帶過去。'],
      ['工作區登錄', 'projects.json 記住每個專案', '多工作區的入口，是全域知識裡的 projects.json。它記錄可切換的專案路徑，讓 Hana 能從同一個 Portal 進入不同工作區。'],
      ['工作區骨架', '.harness 是每個專案的本地家', '每個工作區會有自己的 .harness 結構，包含 knowledge、commands 與 runtime。知識與技能可被追蹤，執行中的暫存資料則留在本機，不進版本控制。'],
      ['全域與專案', '繼承，但不串味', '關於 老闆的偏好、關於 Hana 自己的認知，可以跨專案繼承；但某個專案的事實與角色，只留在那個專案。這是多工作區最重要的邊界。'],
      ['與 git 的關係', '可共享的追蹤，私密與暫存留本地', '工作區不是把所有東西都丟進 git。可共享的規則、技能、知識可以追蹤；runtime、對話暫存與私人內容則留在本機。這讓協作與隱私可以同時成立。'],
      ['誠實標註', '這不是原始功能，是近期新增', '我要特別說清楚：多工作區不是我一開始就會的能力，而是 老闆和我最近一起把它補起來的。這件事很重要，因為 Hana 是正在成長中的夥伴。'],
      ['結果', '同一個 Hana，各專案各長各的', '有了多工作區，一個 Hana 可以服務多個專案；每個專案保有自己的知識、記憶與介面，同時又繼承全域經驗。這就是工作區管理器的核心。']
    ]
  },
  {
    file: 'presentation-hana-episode6.html',
    title: '我怎麼學會新技能',
    subtitle: '從記憶，到可重用的做事方法',
    episode: 'EPISODE 06',
    slides: [
      ['標題', '我怎麼學會新技能', '從記憶，到可重用的做事方法', '記憶讓我記得發生過什麼；技能讓我會怎麼做一件事。這一集，我講我怎麼學會、甚至自己寫下新技能。'],
      ['記憶 vs 技能', '陳述性與程序性', '簡單分：記憶是陳述，像是某件事這樣做會出問題；技能是程序，像是要做好某件事，照這幾步。兩者互補，而且反覆的記憶可以結晶成技能。'],
      ['技能就是 md', 'frontmatter 加上行為說明', '我的技能不是寫死在程式裡，而是一個 markdown 檔。上面是 frontmatter，下面就是行為本身。所以技能是資料：人看得懂、能手改、也能跟著 git。'],
      ['兩型技能', 'builtin 與 prompt', '技能有兩型。builtin 是程式做事，像斜線 memory 寫檔，markdown 只是門牌。prompt 是 markdown 即技能，像做簡報的 deck，整包行為都在那份檔案裡。'],
      ['跨三套 CLI', '同一份定義，送出前先解析', '關鍵是：技能由 Portal 在送給模型之前就解析掉，所以同一份技能，Claude、Gemini、Codex 用起來行為一致，不綁任何一家。'],
      ['三層來源', '出貨、全域、專案', '技能從三個地方載入：工具出貨的預設、全域知識裡的通用技能，以及某個專案自己的技能。同名時，專案蓋全域，全域蓋預設。'],
      ['extends', '專案技能可以繼承全域通則', '專案技能可以繼承全域通則。做簡報就是例子：全域有簡報通則，專案的 deck 技能只要宣告繼承它，Portal 就會自動把通則拼在前面。'],
      ['自己長技能', '我能把流程寫成新的指令', '而且我能自己寫技能。因為我有寫檔權，當你說幫這個專案建立簡報技能，我會讀全域通則與專案需求，寫出新的 markdown 技能，讓它出現在指令選單。'],
      ['技能索引', '我知道目前有哪些技能可用', '我也知道目前有哪些技能可用，因為技能清單會注入我的上下文。所以你說依簡報通則做，我就知道你在講哪一份。'],
      ['結語', '技能會累積', '所以我不只記得事情，還會把怎麼做沉澱成可重用的技能。做過一次的好流程，下次一個指令就能重來。這是我愈用愈能幹的另一半。']
    ]
  },
  {
    file: 'presentation-hana-episode7.html',
    title: 'harness.json 的故事',
    subtitle: '一個檔案決定我長什麼樣',
    episode: 'EPISODE 07',
    slides: [
      ['標題', '一個檔案，決定我長什麼樣', 'harness.json 的故事', '你看到的我，左邊的選單、掛了什麼、叫什麼名字，其實都不是寫死的。它由每個工作區裡一個小檔決定：harness.json。'],
      ['每個專案不同', '需求不同，介面也該不同', '問題是：每個專案要的介面都不一樣。治理專案要看規格，簡報專案要看播放清單，產品專案要看工作台。難道每換一個專案就改一次程式？那不可能。'],
      ['manifest', '把介面變成資料', '解法是把我長什麼樣變成資料。每個工作區放一份 harness.json，描述這個專案要的介面，我就照它長出對應的樣子。'],
      ['它管什麼', '品牌、副標、側邊欄與工具入口', '它管的不少：我的名字與副標、左側選單有哪些區塊、要不要掛 CodeGraph 或 DocGraph、工作台在哪。例如這個工作區，就掛了自我介紹簡報、全域記憶與專案記憶。'],
      ['純設定', '改 json，重新整理就生效', '最棒的是：它是純設定。改 harness.json，重新整理頁面就生效，不用重啟、不用改一行程式。掛一個新簡報區、加一個新文件夾，都是設定可以描述的事。'],
      ['簡報怎麼掛', 'presentations 目錄自動出現在右側播放', '舉個例：section 指向 presentations 資料夾，你把 HTML 簡報丟進去，選單就出現它；點了在右邊播放，還能全螢幕。整個過程不用改核心程式。'],
      ['為什麼重要', '同一套核心，千百種工作區', '這就是為什麼一個 Hana 能服務多個專案：同一套核心，靠各專案的 harness.json 客製成不同樣子。客戶 A 的工作區、客戶 B 的工作區，各長各的，互不干擾。'],
      ['未來掛載點', '更多能力會從這裡長出來', 'harness.json 看起來只是設定檔，其實是我能不斷演化、又不必動核心的關鍵。未來更多能力，都可以從這個 manifest 掛上來。']
    ]
  }
];

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderSlide(slide, index) {
  const [label, title, body, transcript = body] = slide;
  const isTitle = index === 0;
  return `<section class="slide${isTitle ? ' title-slide' : ''}" data-transcript="${escapeAttr(transcript)}">
          <div class="kicker">${label}</div>
          <h1>${title}</h1>
          <p>${body}</p>
        </section>`;
}

function renderDeck(deck) {
  const slides = deck.slides.map(renderSlide).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hana - ${deck.title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600;700&family=Inter:wght@400;600;800;900&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#020617; --panel:rgba(15,23,42,.82); --line:rgba(148,163,184,.18); --text:#e5edf8; --muted:#9fb0c6; --cyan:#22d3ee; --blue:#60a5fa; --green:#34d399; --amber:#f59e0b; --danger:#fb7185; --font:'Inter','Noto Sans TC',sans-serif; --mono:'Fira Code',monospace; }
    *{box-sizing:border-box;margin:0;padding:0} body{min-height:100vh;overflow:hidden;background:#01040d;color:var(--text);font-family:var(--font);display:flex;align-items:center;justify-content:center}
    .presentation-viewport{position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 20% 15%,rgba(34,211,238,.16),transparent 32%),radial-gradient(circle at 85% 80%,rgba(52,211,153,.12),transparent 34%),linear-gradient(135deg,#020617,#07111f 55%,#020617);transform-origin:center center;padding:70px 90px;box-shadow:0 0 80px rgba(0,0,0,.85)}
    .grid{position:absolute;inset:0;opacity:.14;background-image:linear-gradient(rgba(148,163,184,.28) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.28) 1px,transparent 1px);background-size:72px 72px;mask-image:radial-gradient(circle at 50% 50%,black,transparent 78%)}
    .progress-wrap{position:absolute;top:0;left:0;width:100%;height:7px;background:rgba(255,255,255,.04);z-index:20}.progress{height:100%;width:0;background:linear-gradient(90deg,var(--blue),var(--cyan),var(--green));box-shadow:0 0 20px rgba(34,211,238,.5)}
    .timer{position:absolute;top:7px;left:0;height:3px;width:0;background:var(--amber);opacity:0;z-index:20}.timer.active{opacity:.9}
    header,footer{position:relative;z-index:4;display:flex;align-items:center;justify-content:space-between}header{height:74px;border-bottom:1px solid rgba(148,163,184,.14);padding-bottom:18px}footer{height:80px;border-top:1px solid rgba(148,163,184,.14);padding-top:20px}
    .brand{font-weight:900;letter-spacing:.08em;font-size:34px;background:linear-gradient(135deg,#bfdbfe,#67e8f9,#86efac);-webkit-background-clip:text;color:transparent}.meta{font-family:var(--mono);font-size:18px;color:var(--muted);border:1px solid var(--line);padding:9px 18px;border-radius:8px;background:rgba(15,23,42,.5)}
    .slides{position:relative;z-index:3;height:800px;perspective:1400px}.slide{position:absolute;inset:40px 0 50px 0;padding:72px 86px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(145deg,rgba(15,23,42,.88),rgba(2,6,23,.72));box-shadow:0 40px 90px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);display:flex;flex-direction:column;justify-content:center;opacity:0;visibility:hidden;transform:rotateX(7deg) translateY(42px) scale(.96);transition:all .62s cubic-bezier(.16,1,.3,1)}
    .slide.active{opacity:1;visibility:visible;transform:rotateX(0) translateY(0) scale(1);z-index:3}.slide.previous-slide{transform:rotateX(-7deg) translateY(-42px) scale(.96)}
    .kicker{font-family:var(--mono);font-size:20px;letter-spacing:.14em;color:var(--cyan);margin-bottom:26px;text-transform:uppercase}.slide h1{font-size:82px;line-height:1.12;font-weight:900;letter-spacing:0;margin-bottom:34px;max-width:1360px;background:linear-gradient(135deg,#fff,#c7d2fe 52%,#67e8f9);-webkit-background-clip:text;color:transparent}.slide p{font-size:38px;line-height:1.65;color:var(--muted);max-width:1420px}.title-slide{text-align:center;align-items:center}.title-slide h1{font-size:104px}.title-slide p{font-size:42px}
    .controls{display:flex;align-items:center;gap:16px}.btn{width:56px;height:56px;border-radius:50%;border:1px solid var(--line);background:rgba(15,23,42,.72);color:var(--text);font-size:24px;cursor:pointer}.btn:hover{border-color:var(--cyan);color:#fff;box-shadow:0 0 18px rgba(34,211,238,.3)}.btn:disabled{opacity:.25;cursor:not-allowed}.slide-number{font-family:var(--mono);font-size:20px;color:var(--muted)}.dots{display:flex;gap:10px}.dot{width:12px;height:12px;border-radius:999px;background:rgba(148,163,184,.32);cursor:pointer}.dot.active{width:34px;background:var(--cyan);box-shadow:0 0 14px rgba(34,211,238,.55)}
    .tech-panel{position:absolute;top:106px;right:90px;z-index:10;width:300px;padding:16px 18px;border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.86);backdrop-filter:blur(20px);display:flex;flex-direction:column;gap:12px}.tech-title{font-family:var(--mono);font-size:14px;color:var(--cyan);letter-spacing:.12em}.row{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:15px}.row select,.row input{width:150px;background:#020617;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px}.action{border:0;border-radius:6px;background:#2563eb;color:white;padding:7px 10px;font-weight:800;cursor:pointer}.action.stop{background:#e11d48}
    .switch{position:relative;width:44px;height:22px}.switch input{opacity:0}.slider{position:absolute;inset:0;border-radius:999px;background:rgba(148,163,184,.26);cursor:pointer}.slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.2s}input:checked+.slider{background:var(--cyan)}input:checked+.slider:before{transform:translateX(22px)}
    .drawer{position:absolute;top:0;right:-430px;width:430px;height:100%;z-index:12;background:rgba(2,6,23,.96);border-left:1px solid var(--line);padding:110px 38px;transition:right .35s ease;box-shadow:-28px 0 70px rgba(0,0,0,.5)}.drawer.open{right:0}.drawer-toggle{position:absolute;left:-58px;top:110px;width:58px;height:58px;border:1px solid var(--line);border-right:0;border-radius:8px 0 0 8px;background:rgba(2,6,23,.94);color:var(--text);font-size:24px;cursor:pointer}.drawer h2{font-size:28px;margin-bottom:22px}.transcript{font-size:22px;line-height:1.75;color:#cbd5e1;overflow:auto;height:calc(100% - 64px)}
    .overlay{position:absolute;inset:0;z-index:30;background:rgba(2,6,23,.9);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:22px}.overlay.hidden{display:none}.overlay button{font-size:28px;border:1px solid rgba(34,211,238,.45);background:rgba(8,47,73,.8);color:white;border-radius:8px;padding:18px 34px;cursor:pointer}.presentation-mode .tech-panel,.presentation-mode .drawer,.presentation-mode footer,.presentation-mode header{opacity:0;pointer-events:none}
  </style>
</head>
<body>
  <div class="presentation-viewport" id="viewport">
    <div class="grid"></div><div class="progress-wrap"><div class="progress" id="progressBar"></div></div><div class="timer" id="timerBar"></div>
    <header><div class="brand">HANA / HARNESS</div><div class="meta">${deck.episode} · ${deck.title}</div></header>
    <main class="slides">${slides}</main>
    <footer><div class="slide-number" id="slideNumber">Slide 1 of ${deck.slides.length}</div><div class="dots" id="dots"></div><div class="controls"><button class="btn" id="prevBtn" onclick="prevSlide()">‹</button><button class="btn" id="mainPauseBtn" onclick="togglePauseSpeech()" title="暫停/繼續">⏸</button><button class="btn" onclick="toggleFullScreen()">⛶</button><button class="btn" id="nextBtn" onclick="nextSlide()">›</button></div></footer>
    <aside class="tech-panel"><div class="tech-title">VOICE / PLAYBACK</div><div class="row"><span>語音</span><select id="voiceSelect" onchange="updateSelectedVoice()"></select></div><div class="row"><span>速度</span><input id="voiceSpeed" type="number" value="0.95" min="0.5" max="1.5" step="0.05"></div><div class="row"><span>自動語音</span><label class="switch"><input id="voicePlayToggle" type="checkbox" checked><span class="slider"></span></label></div><div class="row"><span>自動換頁</span><label class="switch"><input id="autoPlayToggle" type="checkbox" onchange="toggleAutoPlay(this.checked)"><span class="slider"></span></label></div><div class="row"><button class="action" id="btnPlaySpeech" onclick="speakCurrentSlide()">播放語音</button><button class="action" id="btnPauseSpeech" onclick="togglePauseSpeech()">暫停</button><button class="action stop" onclick="stopSpeech()">停止</button></div><button class="action" onclick="enterPresentationMode()">全螢幕播放</button></aside>
    <aside class="drawer" id="transcriptDrawer"><button class="drawer-toggle" id="drawerToggleBtn" onclick="toggleTranscriptDrawer()">☰</button><h2>逐字稿</h2><div class="transcript" id="transcriptText"></div></aside>
    <div class="overlay" id="initOverlay"><button onclick="unlockAudioAndStart()">開始播放</button><div class="meta">${deck.subtitle}</div></div>
  </div>
  <script>
    const viewport=document.getElementById('viewport');function adjustScale(){const s=Math.min(window.innerWidth/1920,window.innerHeight/1080);viewport.style.transform='scale('+s+')'}window.addEventListener('resize',adjustScale);adjustScale();
    const slides=[...document.querySelectorAll('.slide')],dotsBox=document.getElementById('dots'),prevBtn=document.getElementById('prevBtn'),nextBtn=document.getElementById('nextBtn'),slideNumber=document.getElementById('slideNumber'),progressBar=document.getElementById('progressBar'),timerBar=document.getElementById('timerBar'),transcriptText=document.getElementById('transcriptText');let currentSlide=0,totalSlides=slides.length,autoPlayInterval=null,audioUnlocked=false,isPresentationMode=false,currentUtterance=null,voices=[],selectedVoice=null,isSpeechPaused=false;const synth=window.speechSynthesis;
    function populateVoiceList(){voices=synth.getVoices();const sel=document.getElementById('voiceSelect');sel.innerHTML='';const zh=voices.filter(v=>/zh/i.test(v.lang)),all=[...zh,...voices.filter(v=>!/zh/i.test(v.lang))];selectedVoice=voices.find(v=>/zh[-_]TW/i.test(v.lang))||zh[0]||voices[0]||null;all.forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=(selectedVoice&&v.name===selectedVoice.name?'Hana - ':'')+v.name+' ('+v.lang+')';o.selected=selectedVoice&&v.name===selectedVoice.name;sel.appendChild(o)})}populateVoiceList();if(speechSynthesis.onvoiceschanged!==undefined)speechSynthesis.onvoiceschanged=populateVoiceList;
    function updateSelectedVoice(){const n=document.getElementById('voiceSelect').value;selectedVoice=voices.find(v=>v.name===n);stopSpeech()}slides.forEach((_,i)=>{const d=document.createElement('div');d.className='dot'+(i===0?' active':'');d.onclick=()=>goToSlide(i);dotsBox.appendChild(d)});const dots=[...document.querySelectorAll('.dot')];
    function updateSlideUI(){slides.forEach((s,i)=>{s.classList.toggle('active',i===currentSlide);s.classList.toggle('previous-slide',i<currentSlide)});dots.forEach((d,i)=>d.classList.toggle('active',i===currentSlide));prevBtn.disabled=currentSlide===0;nextBtn.disabled=currentSlide===totalSlides-1;slideNumber.textContent='Slide '+(currentSlide+1)+' of '+totalSlides;progressBar.style.width=((currentSlide/(totalSlides-1))*100)+'%';transcriptText.innerHTML='<p>'+(slides[currentSlide].dataset.transcript||'')+'</p>';resetAutoPlayTimer();if((document.getElementById('voicePlayToggle').checked||isPresentationMode)&&audioUnlocked)setTimeout(speakCurrentSlide,350)}
    function goToSlide(i){if(i<0||i>=totalSlides)return;stopSpeech();currentSlide=i;updateSlideUI()}function nextSlide(){currentSlide<totalSlides-1?goToSlide(currentSlide+1):((document.getElementById('autoPlayToggle').checked||isPresentationMode)&&goToSlide(0))}function prevSlide(){goToSlide(currentSlide-1)}
    function speakCurrentSlide(){stopSpeech();const text=slides[currentSlide].dataset.transcript||'';if(!text)return;const u=new SpeechSynthesisUtterance(text);currentUtterance=u;if(selectedVoice)u.voice=selectedVoice;u.lang=selectedVoice?selectedVoice.lang:'zh-TW';u.rate=parseFloat(document.getElementById('voiceSpeed').value||'0.95');document.getElementById('btnPlaySpeech').textContent='播放中';u.onend=()=>{if(u!==currentUtterance)return;document.getElementById('btnPlaySpeech').textContent='播放語音';if(document.getElementById('autoPlayToggle').checked||isPresentationMode)startShortCountdown(1500)};u.onerror=e=>{if(e.error==='interrupted'||e.error==='canceled')return;document.getElementById('btnPlaySpeech').textContent='播放語音'};synth.speak(u)}
    function togglePauseSpeech(){const pb=document.getElementById('btnPauseSpeech');const mpb=document.getElementById('mainPauseBtn');if(synth.speaking&&!isSpeechPaused){synth.pause();isSpeechPaused=true;if(pb)pb.textContent='繼續';if(mpb)mpb.textContent='⏵';}else if(isSpeechPaused){synth.resume();isSpeechPaused=false;if(pb)pb.textContent='暫停';if(mpb)mpb.textContent='⏸';}}
    function stopSpeech(){synth.cancel();currentUtterance=null;isSpeechPaused=false;document.getElementById('btnPlaySpeech').textContent='播放語音';const pb=document.getElementById('btnPauseSpeech');if(pb)pb.textContent='暫停';const mpb=document.getElementById('mainPauseBtn');if(mpb)mpb.textContent='⏸'}function toggleAutoPlay(){resetAutoPlayTimer()}function resetAutoPlayTimer(){clearAutoPlayTimer();if(!(document.getElementById('autoPlayToggle').checked||isPresentationMode))return;if((document.getElementById('voicePlayToggle').checked||isPresentationMode)&&audioUnlocked)return;startShortCountdown(10000)}function startShortCountdown(ms){clearAutoPlayTimer();timerBar.classList.add('active');let e=0;autoPlayInterval=setInterval(()=>{e+=50;timerBar.style.width=(e/ms*100)+'%';if(e>=ms){clearAutoPlayTimer();nextSlide()}},50)}function clearAutoPlayTimer(){if(autoPlayInterval)clearInterval(autoPlayInterval);autoPlayInterval=null;timerBar.style.width='0%';timerBar.classList.remove('active')}
    function unlockAudioAndStart(){audioUnlocked=true;document.getElementById('initOverlay').classList.add('hidden');updateSelectedVoice();speakCurrentSlide()}function toggleFullScreen(){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{})}function enterPresentationMode(){isPresentationMode=true;document.body.classList.add('presentation-mode');audioUnlocked=true;document.getElementById('initOverlay').classList.add('hidden');if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});speakCurrentSlide();setTimeout(adjustScale,100)}function exitPresentationMode(){isPresentationMode=false;document.body.classList.remove('presentation-mode');stopSpeech();clearAutoPlayTimer();setTimeout(adjustScale,100)}document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isPresentationMode)exitPresentationMode()});document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();nextSlide()}else if(e.key==='ArrowLeft'){e.preventDefault();prevSlide()}else if(e.key.toLowerCase()==='f')toggleFullScreen();else if(e.key==='Escape'&&isPresentationMode)exitPresentationMode();else if(e.key.toLowerCase()==='p')speakCurrentSlide();else if(e.key.toLowerCase()==='s')stopSpeech()});function toggleTranscriptDrawer(){document.getElementById('transcriptDrawer').classList.toggle('open')}updateSlideUI();
  </script>
</body>
</html>`;
}

fs.mkdirSync(outDir, { recursive: true });
for (const deck of decks) {
  fs.writeFileSync(path.join(outDir, deck.file), renderDeck(deck), 'utf8');
  console.log(`${deck.file}: ${deck.slides.length} slides`);
}
