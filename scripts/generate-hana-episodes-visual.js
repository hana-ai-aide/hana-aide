const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'presentations');

const decks = [
  {
    file: 'presentation-hana-episode2.html',
    title: 'CLI 互動架構',
    subtitle: '免 API Key 橋接頂級大腦',
    episode: 'EPISODE 02',
    accent: 'cyan',
    slides: [
      {
        type: 'title',
        label: '核心問題',
        title: '不用 API Key，也能接上頂級大腦',
        body: '官方 CLI 登入 + 本地 Portal 路由',
        transcript: '這一集，我要講哈娜的第一個核心能力：我不靠介面金鑰，而是透過官方命令列工具，把已登入的 Claude Code、Antigravity 和 Codex，接到同一個本地入口。'
      },
      {
        type: 'compare',
        label: '為什麼是 CLI',
        title: '選 CLI，不是因為它簡單，而是因為它剛好解掉成本邊界',
        columns: [
          { head: 'API 路線', items: ['另開金鑰', '按量付費', '成本隨使用量放大'] },
          { head: '本地模型', items: ['硬體門檻高', '維護成本高', '模型能力受設備限制'] },
          { head: '官方 CLI', items: ['沿用訂閱登入', '本地執行', '由官方工具負責模型連線'] }
        ],
        conclusion: 'Hana 的角色：把已登入的官方工具，整合成可協作的工作流程。',
        transcript: '我不是再開一條昂貴的雲端服務路線，也不是要求使用者準備高階顯示卡跑本地模型。我的 CLI 路線，是沿用已登入、已訂閱的官方工具，把成本控制在可接受範圍內，再由哈娜統一協作流程。'
      },
      {
        type: 'architecture',
        label: '總覽架構',
        title: 'Portal 是入口，CLI 是橋，模型是大腦',
        nodes: [
          ['Hana Portal', '接收任務 / 選模型'],
          ['Portal', 'provider::model 路由'],
          ['CLI Bridge', 'stdin / pty / exec'],
          ['Official CLIs', 'Claude Code / Antigravity / Codex']
        ],
        transcript: '整體架構可以看成四層：我先在 Portal 接收任務與模型選擇；Portal 用 provider 加 model 的格式決定路由；中間的 CLI 橋接層負責處理各家呼叫差異；最後才交給官方 CLI 執行。'
      },
      {
        type: 'table',
        label: '三套 CLI 的差異',
        title: '同樣是官方 CLI，接法完全不同',
        headers: ['工具', '呼叫方式', '工程注意點'],
        rows: [
          ['Claude Code', '--print + stdin', '提示從標準輸入送入，回覆需穩定讀取'],
          ['Antigravity / Gemini', 'agy --print + node-pty', '--print 參數要放最後，需處理互動式終端'],
          ['Codex', 'codex exec', '用 --output-last-message 撈乾淨答案']
        ],
        transcript: '三套工具不是換個命令名稱就好。Claude Code 適合用列印模式和標準輸入；Antigravity 需要透過終端模擬處理互動流程，而且 print 參數位置很敏感；Codex 則用 exec，並用 output last message 取回乾淨答案。'
      },
      {
        type: 'route',
        label: '模型中立',
        title: '使用者選的是模型，Portal 決定該走哪條橋',
        transcript: '在使用者眼中，是選 Claude、Gemini 或 Codex；但在 Portal 裡，這會變成 provider 加 model 的路由。這讓哈娜不綁死單一廠商，也讓未來擴充新模型比較自然。'
      },
      {
        type: 'permission',
        label: '授權模式',
        title: '從聊天，到真的能動手',
        steps: ['使用者授權', 'Portal 下發任務', 'CLI 執行工具', '檔案 / 命令產生結果'],
        note: '「甲」代表自動核准：效率提高，但邊界必須清楚。',
        transcript: '當使用者明確授權，例如使用甲這種自動核准模式時，我驅動的 CLI 可以實際改檔、跑命令、完成任務。這時哈娜不只是聊天框，而是受控的本地工作代理。'
      },
      {
        type: 'summary',
        label: '本集結論',
        title: 'Hana 成立的第一塊基礎',
        points: ['官方登入', '本地執行', '統一路由', '可動手完成任務'],
        transcript: '所以這一集的重點是：哈娜用官方 CLI 取代昂貴 API Key，用本地 Portal 統一入口，再用路由把工作交給最適合的大腦。這是哈娜能成立的第一塊基礎。'
      }
    ]
  },
  {
    file: 'presentation-hana-episode3.html',
    title: '跨 CLI 共用對話',
    subtitle: '換模型不失憶',
    episode: 'EPISODE 03',
    accent: 'green',
    slides: [
      {
        type: 'title',
        label: '核心問題',
        title: '換模型時，脈絡不能斷',
        body: '讓三套 CLI 讀同一份模型中立對話',
        transcript: '這一集，我要講哈娜的第二個核心能力：我如何讓 Claude、Gemini、Codex 接手同一段工作，而對話脈絡不會斷掉。'
      },
      {
        type: 'broken',
        label: '原生限制',
        title: '各家的 resume，只認自己的歷史',
        transcript: '原生 CLI 的對話續接，通常只能接自己的歷史。Claude 接得上 Claude，Codex 接得上 Codex，但它們不會天然讀懂另一套工具剛剛做了什麼。'
      },
      {
        type: 'risk',
        label: '失憶後果',
        title: '斷掉的不只是聊天，是決策與狀態',
        cards: [
          ['重講背景', '每換模型就重新鋪陳一次'],
          ['決策遺失', '前面已確認的方向被忽略'],
          ['回頭破壞', '長對話後把剛修好的東西改回去']
        ],
        transcript: '沒有共用脈絡時，我每換一次模型，就得重新鋪陳背景。更糟的是，長對話後模型可能忘記前面決策，把剛修好的東西又改回去。'
      },
      {
        type: 'owner',
        label: '設計轉向',
        title: '脈絡由 Portal 擁有，不寄放在單一模型裡',
        transcript: '我的做法，是讓 Portal 擁有一份模型中立的完整對話。模型只是來接手執行的夥伴，不是唯一保存記憶的地方。'
      },
      {
        type: 'fileflow',
        label: '檔案式上下文',
        title: '完整歷史寫成檔案，提示只帶入口',
        transcript: '每次發問前，我把完整歷史寫成一個檔案。提示裡只放最近幾輪和檔案位置，接手的 AI 可以自己讀回完整脈絡，所以不必靠有損壓縮硬塞進提示。'
      },
      {
        type: 'tradeoff',
        label: '取捨',
        title: '最近幾輪在眼前，全量歷史在旁邊',
        left: ['速度快', '直接放最近幾輪', '讓模型立刻接上'],
        right: ['完整性高', '全量歷史留檔', '需要時自行讀回'],
        transcript: '這個設計把速度與完整性分開。最近幾輪直接放進提示，讓模型快速接上；完整歷史留在檔案，需要時再讀，避免每次都把整段對話塞滿。'
      },
      {
        type: 'team',
        label: '結果',
        title: '不同模型，開始像同一個團隊',
        roles: [
          ['Claude', '想架構'],
          ['Codex', '改程式'],
          ['Gemini', '補觀點']
        ],
        transcript: '有了共用對話，我可以讓 Claude 想架構，讓 Codex 改程式，讓 Gemini 補另一種觀點。它們仍然是不同模型，但在哈娜裡，開始像同一個團隊。'
      }
    ]
  },
  {
    file: 'presentation-hana-episode4.html',
    title: '我是怎麼記住的',
    subtitle: '不是更聰明的演算法，是更會整理的習慣',
    episode: 'EPISODE 04',
    accent: 'amber',
    slides: [
      { type: 'title', label: '核心問題', title: 'AI 會失憶，所以我要把記憶外部化', body: '對話脈絡、長期記憶、知識結構分開管理', transcript: '這一集，我要講哈娜是怎麼記住事情的。這不是神祕演算法，而是我把對話脈絡、長期記憶和知識結構分開管理。' },
      { type: 'compare', label: '三種東西別混在一起', title: '我手上同時有三種記憶材料', columns: [
        { head: '對話脈絡', items: ['這次聊天', '短期接續', '容易被視窗限制影響'] },
        { head: '長期記憶', items: ['跨對話保留', '記偏好與教訓', '需要整理與刪改'] },
        { head: '知識結構', items: ['規範 / 文件 / 圖譜', '可查詢', '支撐推理'] }
      ], conclusion: '這一集聚焦長期記憶：我留下真正會影響下次工作的資訊。', transcript: '我先把三件事分開。對話脈絡是這次聊天我手上的內容；長期記憶是跨對話還要保留的偏好與教訓；知識結構則是規範、文件和圖譜。這一集聚焦長期記憶。' },
      { type: 'tradeoff', label: '記憶邊界', title: '要記得，也要避免串味', left: ['需要記住', '偏好', '人稱關係', '做事教訓'], right: ['必須隔離', '不同專案事實', '私密內容', '暫時狀態'], transcript: '我的記憶不是越多越好。真正重要的是該記得的要留下，不該跨專案流動的要隔離，否則記憶會變成污染來源。' },
      { type: 'table', label: '兩層四檔', title: '全域可繼承，專案不外流', headers: ['層級', '檔案', '負責內容'], rows: [
        ['全域', 'USER', '使用者偏好與穩定背景'],
        ['全域', 'AGENT', '哈娜自己的身份與行為設定'],
        ['專案', 'MEMORY', '這個專案的事實、決策、教訓'],
        ['專案', 'PERSONA', '這個專案裡哈娜要扮演的角色']
      ], transcript: '我的長期記憶分成兩層四檔。全域層記使用者偏好，以及哈娜自己的身份；專案層記這個專案的事實、決策與角色。這樣可以繼承，也可以隔離。' },
      { type: 'architecture', label: '更新流程', title: '判斷交給政策，落檔交給程式', nodes: [
        ['對話', '出現值得記住的事'],
        ['記憶政策', '判斷該放哪裡'],
        ['三種操作', 'add / replace / remove'],
        ['檔案', '安全寫入 Markdown']
      ], transcript: '更新記憶時，我先根據政策判斷該不該記、要放哪一層；實際落檔則交給程式處理。操作只有新增、覆寫、刪除三種，避免一直堆垃圾。' },
      { type: 'summary', label: '/memory', title: '一句指令，把經驗整理進對的位置', points: ['讀對話', '抽重點', '選層級', '寫入檔案'], transcript: '使用斜線 memory 時，我會讀這次對話，抽出真正值得留下的重點，選擇正確層級，然後寫進對應的記憶檔。' },
      { type: 'summary', label: '本集結論', title: '愈用愈懂，是整理出來的', points: ['小而有上限', '可刪可覆寫', '專案隔離', '全域繼承'], transcript: '所以哈娜不是靠無限記憶變聰明，而是靠小而有上限、可刪可覆寫、專案隔離、全域繼承的方式，讓每次協作都比上一次更接近你的工作方式。' }
    ]
  },
  {
    file: 'presentation-hana-episode5.html',
    title: '多工作區',
    subtitle: '一個 Hana 管理所有專案',
    episode: 'EPISODE 05',
    accent: 'blue',
    slides: [
      { type: 'title', label: '核心問題', title: '我不能把所有專案混成一鍋', body: '多工作區讓邊界、記憶與工具各自成立', transcript: '這一集，我要講哈娜的多工作區能力。我不能把所有專案混成一鍋，因為不同專案有不同規格、記憶、文件和節奏。' },
      { type: 'compare', label: '混在一起的代價', title: '沒有工作區邊界，記憶會變成風險', columns: [
        { head: '規格混淆', items: ['A 專案規則帶到 B 專案', '需求判斷失準'] },
        { head: '隱私外溢', items: ['私人內容不該共享', 'runtime 不該進版控'] },
        { head: '工具錯位', items: ['每個專案入口不同', '文件與簡報掛載不同'] }
      ], conclusion: '多工作區的重點不是切換資料夾，而是切換整個協作邊界。', transcript: '沒有工作區邊界時，我可能把 A 專案的規則帶到 B 專案，也可能讓私人內容或暫存資料跑到不該去的地方。多工作區的重點不是切換資料夾，而是切換整個協作邊界。' },
      { type: 'architecture', label: '登錄方式', title: '全域 projects.json 是工作區入口', nodes: [
        ['global knowledge', 'projects.json'],
        ['Portal', '列出 / 切換工作區'],
        ['workspace', '讀 harness.json'],
        ['Hana', '套用該專案上下文']
      ], transcript: '多工作區的入口，是全域知識裡的 projects.json。Portal 先知道有哪些工作區，再讀各工作區的 harness.json，最後讓我套用該專案的上下文。' },
      { type: 'table', label: '每個工作區的本地家', title: '.harness 把知識、技能、暫存分清楚', headers: ['目錄', '用途', '是否適合共享'], rows: [
        ['knowledge', '專案記憶與角色', '視內容決定'],
        ['commands', '專案技能與指令', '通常可共享'],
        ['runtime', '對話歷史與執行暫存', '留在本機'],
        ['presentations', '可播放簡報輸出', '可選擇共享']
      ], transcript: '每個工作區都有自己的本地結構。knowledge 放專案記憶與角色，commands 放技能，runtime 放執行暫存與對話歷史。這些東西不該全部用同一種共享策略處理。' },
      { type: 'tradeoff', label: '繼承與隔離', title: '全域記住人，專案記住事', left: ['全域繼承', '使用者偏好', '哈娜身份', '通用技能'], right: ['專案隔離', '專案事實', '專案角色', '執行暫存'], transcript: '我的原則是：全域記住人，專案記住事。使用者偏好、哈娜身份、通用技能可以繼承；專案事實、專案角色和執行暫存則留在專案裡。' },
      { type: 'summary', label: '近期新增', title: '這不是天生能力，是我被補強後長出來的', points: ['宣告工作區', '切換上下文', '讀專案設定', '隔離記憶'], transcript: '我也要誠實標註：多工作區不是我一開始就會的能力，而是最近補強後長出來的。這也說明哈娜不是固定產品，而是會隨使用方式演化的本地夥伴。' },
      { type: 'summary', label: '本集結論', title: '同一個 Hana，各專案各長各的', points: ['同一核心', '不同設定', '不同記憶', '不同介面'], transcript: '有了多工作區，同一個哈娜核心可以服務多個專案；每個專案保有自己的知識、記憶與介面，同時繼承全域經驗。' }
    ]
  },
  {
    file: 'presentation-hana-episode6.html',
    title: '我怎麼學會新技能',
    subtitle: '從記憶，到可重用的做事方法',
    episode: 'EPISODE 06',
    accent: 'green',
    slides: [
      { type: 'title', label: '核心問題', title: '記憶讓我記得，技能讓我會做', body: '把反覆流程沉澱成可重用指令', transcript: '這一集，我要講哈娜怎麼學會新技能。記憶讓我記得發生過什麼；技能讓我知道下次遇到同類任務該怎麼做。' },
      { type: 'compare', label: '記憶 vs 技能', title: '一個記事實，一個記流程', columns: [
        { head: '記憶', items: ['陳述性', '偏好 / 教訓 / 背景', '回答時參考'] },
        { head: '技能', items: ['程序性', '步驟 / 規則 / 工具', '做事前載入'] },
        { head: '沉澱', items: ['反覆出現的教訓', '整理成流程', '變成可重用能力'] }
      ], conclusion: '當同一種經驗重複出現，我就把它從記憶升級成技能。', transcript: '記憶和技能不一樣。記憶比較像事實與教訓，技能比較像做事流程。當同一種經驗反覆出現，我就可以把它從記憶升級成技能。' },
      { type: 'architecture', label: '技能格式', title: '技能就是可讀的 Markdown', nodes: [
        ['SKILL.md', 'frontmatter'],
        ['指令說明', '何時使用'],
        ['行為規則', '怎麼做'],
        ['Portal', '送出前載入']
      ], transcript: '我的技能不是黑盒子，而是一份可讀的 Markdown。上面描述何時使用，下面寫行為規則。Portal 在送給模型前先載入技能，所以不同模型可以使用同一套做事方法。' },
      { type: 'table', label: '兩型技能', title: '有些是程式入口，有些是純文字流程', headers: ['類型', '代表', '用途'], rows: [
        ['builtin', '/memory', '由程式執行實際寫檔'],
        ['prompt', '/presentation-rules', '用文字規則約束產出'],
        ['project skill', 'deck 技能', '把全域通則加上專案需求']
      ], transcript: '技能大致有兩種。builtin 像斜線 memory，背後會呼叫程式；prompt 技能則是純文字規則，例如簡報通則。專案技能還可以把全域規則和專案需求組合起來。' },
      { type: 'tradeoff', label: '三層來源', title: '出貨、全域、專案，越近越優先', left: ['通用能力', '內建預設', '全域技能', '跨專案可用'], right: ['專案覆蓋', '專案規則', '專案語氣', '同名優先'], transcript: '技能來源分成出貨、全域、專案三層。越靠近專案，優先權越高。這讓我保有通用能力，也能讓每個專案覆蓋自己的規則。' },
      { type: 'architecture', label: '繼承機制', title: '專案技能可以繼承全域通則', nodes: [
        ['全域通則', '簡報規範'],
        ['專案技能', '宣告 extends'],
        ['Portal', '組合內容'],
        ['Hana', '照合併後規則工作']
      ], transcript: '做簡報就是很好的例子。全域有簡報通則，專案技能只要宣告繼承，Portal 就會把通則和專案需求組合起來，我再照合併後的規則工作。' },
      { type: 'summary', label: '本集結論', title: '做過一次的好流程，下次可以直接重用', points: ['可讀', '可改', '可繼承', '可累積'], transcript: '所以哈娜不只記得事情，也能把做事方法沉澱成技能。做過一次的好流程，下次可以用指令直接重用，而且人也看得懂、改得動。' }
    ]
  },
  {
    file: 'presentation-hana-episode7.html',
    title: 'harness.json 的故事',
    subtitle: '一個檔案決定我長什麼樣',
    episode: 'EPISODE 07',
    accent: 'cyan',
    slides: [
      { type: 'title', label: '核心問題', title: '我長什麼樣，不該寫死在程式裡', body: 'harness.json 把工作區介面變成資料', transcript: '這一集，我要講 harness.json。你看到的哈娜，左邊選單、掛了什麼、叫什麼名字，其實都不該寫死在程式裡。' },
      { type: 'compare', label: '每個專案不同', title: '不同工作區，需要不同介面', columns: [
        { head: '治理專案', items: ['規格', '決策紀錄', '審查流程'] },
        { head: '簡報專案', items: ['播放清單', '逐字稿', '視覺輸出'] },
        { head: '產品專案', items: ['工作台', '文件', '程式入口'] }
      ], conclusion: '核心程式不該為每個專案重寫；設定檔才是合理邊界。', transcript: '不同專案需要不同介面。治理專案要看規格，簡報專案要看播放清單，產品專案要看工作台。我不能每換一個專案就改一次核心程式，所以介面要變成設定。' },
      { type: 'architecture', label: 'Manifest', title: 'harness.json 描述工作區要長出的樣子', nodes: [
        ['harness.json', '品牌 / 副標'],
        ['sections', '側邊欄區塊'],
        ['mounts', '簡報 / 文件 / 工具'],
        ['Portal UI', '依設定生成介面']
      ], transcript: 'harness.json 是工作區的 manifest。它描述品牌、副標、側邊欄區塊，以及要掛哪些簡報、文件或工具。Portal 讀到設定後，再生成對應介面。' },
      { type: 'table', label: '它管什麼', title: '從名稱到工具入口，都能宣告', headers: ['設定', '畫面效果', '價值'], rows: [
        ['name / subtitle', '工作區識別', '進入專案時知道自己在哪裡'],
        ['sections', '左側選單', '不同專案有不同導航'],
        ['presentations', '右側播放', 'HTML 簡報可直接掛載'],
        ['tools', 'CodeGraph / DocGraph', '依專案開啟能力']
      ], transcript: '它管的不只是名字。工作區識別、左側選單、簡報掛載、CodeGraph 或 DocGraph 這些工具入口，都可以透過設定宣告。' },
      { type: 'tradeoff', label: '純設定的好處', title: '改資料，不改核心', left: ['快速調整', '新增區塊', '掛新資料夾', '重新整理生效'], right: ['核心穩定', '少改程式', '少引入風險', '多專案共用'], transcript: '純設定的好處是改資料，不改核心。新增區塊、掛新資料夾、換工作區標題，都可以重新整理後生效；核心程式則保持穩定。' },
      { type: 'architecture', label: '簡報掛載', title: 'HTML 丟進 presentations，就能出現在工作區', nodes: [
        ['presentations', 'HTML 檔案'],
        ['harness.json', 'section 指向目錄'],
        ['Portal', '掃描清單'],
        ['播放區', '點選 / 全螢幕']
      ], transcript: '以簡報為例，只要 section 指向 presentations 目錄，HTML 簡報放進去後，選單就會出現它；點選後在右側播放，也能全螢幕。' },
      { type: 'summary', label: '本集結論', title: '同一套核心，千百種工作區', points: ['設定驅動', '按專案客製', '不改核心', '持續演化'], transcript: '所以 harness.json 看起來只是設定檔，其實是哈娜能服務多個專案、又不必一直改核心的關鍵。同一套核心，可以靠每個工作區的設定長成不同樣子。' }
    ]
  }
];

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function slideHtml(slide, i) {
  const transcript = esc(slide.transcript || slide.body || slide.title);
  const common = `class="slide layout-${slide.type}${i === 0 ? ' title-slide' : ''}" data-transcript="${transcript}"`;
  if (slide.type === 'title') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><p>${slide.body}</p></section>`;
  if (slide.type === 'compare') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="compare-grid">${slide.columns.map(c => `<div class="mini-card"><h3>${c.head}</h3>${c.items.map(x => `<span>${x}</span>`).join('')}</div>`).join('')}</div><div class="conclusion">${slide.conclusion}</div></section>`;
  if (slide.type === 'architecture') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="pipeline">${slide.nodes.map(n => `<div class="node"><strong>${n[0]}</strong><span>${n[1]}</span></div>`).join('<div class="arrow">→</div>')}</div></section>`;
  if (slide.type === 'table') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><table><thead><tr>${slide.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${slide.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
  if (slide.type === 'route') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="route-map"><div class="selector">provider::model</div><div class="route-lines"><span>claude::sonnet</span><span>gemini::pro</span><span>codex::gpt</span></div><div class="brain-row"><b>Claude Code</b><b>Antigravity</b><b>Codex</b></div></div></section>`;
  if (slide.type === 'permission') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="steps">${slide.steps.map((s, idx) => `<div><em>${idx + 1}</em><span>${s}</span></div>`).join('')}</div><div class="conclusion">${slide.note}</div></section>`;
  if (slide.type === 'summary') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="summary-points">${slide.points.map(p => `<div>${p}</div>`).join('')}</div></section>`;
  if (slide.type === 'broken') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="broken-map"><div>Claude<br><small>resume</small></div><i></i><div>Gemini<br><small>resume</small></div><i></i><div>Codex<br><small>resume</small></div></div></section>`;
  if (slide.type === 'risk') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="compare-grid">${slide.cards.map(c => `<div class="mini-card danger"><h3>${c[0]}</h3><span>${c[1]}</span></div>`).join('')}</div></section>`;
  if (slide.type === 'owner') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="owner-map"><div class="big-core">Portal<br><small>模型中立完整對話</small></div><div class="satellites"><span>Claude</span><span>Gemini</span><span>Codex</span></div></div></section>`;
  if (slide.type === 'fileflow') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="fileflow"><div>完整歷史<br><small>Markdown 檔</small></div><div>提示<br><small>最近幾輪 + 檔案路徑</small></div><div>接手模型<br><small>自行讀回脈絡</small></div></div></section>`;
  if (slide.type === 'tradeoff') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="split"><div>${slide.left.map(x => `<span>${x}</span>`).join('')}</div><div>${slide.right.map(x => `<span>${x}</span>`).join('')}</div></div></section>`;
  if (slide.type === 'team') return `<section ${common}><div class="kicker">${slide.label}</div><h1>${slide.title}</h1><div class="team-row">${slide.roles.map(r => `<div><strong>${r[0]}</strong><span>${r[1]}</span></div>`).join('')}</div></section>`;
  return '';
}

const nextEpisodeMapping = {
  'presentation-hana-episode2.html': {
    title: '第三集：跨 CLI 共用對話',
    subtitle: '換模型不失憶',
    episode: 'EPISODE 03',
    accent: 'green',
    desc: '換模型不失憶。介紹如何透過 Portal 統一管理模型中立對話，利用檔案式上下文傳遞完整歷史，讓 Claude、Gemini 與 Codex 接力合作，脈絡不中斷。',
    transcript: '下一集我將介紹跨 CLI 共用對話機制。我會說明如何透過 Portal 儲存對話歷史並寫成檔案，讓不同模型在換手時能讀回完整脈絡，實現換模型不失憶。點選連結即可進入下一集。',
    file: 'presentation-hana-episode3.html'
  },
  'presentation-hana-episode3.html': {
    title: '第四集：長期記憶機制',
    subtitle: '愈用愈懂你、愈懂自己',
    episode: 'EPISODE 04',
    accent: 'amber',
    desc: '分層記憶與精簡整理。介紹兩層四檔（USER/AGENT 全域、MEMORY/PERSONA 專案）長期記憶結構，並透過宣告式政策與 add/replace/remove 操作維持精準字數上限。',
    transcript: '下一集我將介紹長期記憶機制。我會說明如何透過兩層四檔結構，既實現專案間的記憶隔離，又能跨專案繼承通用經驗，讓 Hana 愈用愈懂你。點選連結即可進入下一集。',
    file: 'presentation-hana-episode4.html'
  },
  'presentation-hana-episode4.html': {
    title: '第五集：宣告式多工作區',
    subtitle: '一個 Hana 管理所有專案',
    episode: 'EPISODE 05',
    accent: 'blue',
    desc: '專案邊界與隔離。藉由 projects.json 全域登錄與 harness.json 專案配置，為每個工作區建立獨立的 .harness 骨架，隔離專案事實，保障隱私。',
    transcript: '下一集我將介紹多工作區管理。我會說明如何透過 projects.json 和 harness.json 為每個專案建立獨立邊界，讓多個工作區能同時管理而不混亂。點選連結即可進入下一集。',
    file: 'presentation-hana-episode5.html'
  },
  'presentation-hana-episode5.html': {
    title: '第六集：如何寫 Skill 技能',
    subtitle: '我怎麼學會新技能',
    episode: 'EPISODE 06',
    accent: 'green',
    desc: 'md 即技能。介紹如何用純文字 Markdown 定義 frontmatter 與行為，並透過內建程式技能與提示詞技能，讓 Hana 能動態擴充並自己寫下新技能。',
    transcript: '下一集我將介紹技能機制。我會說明如何用簡單的 Markdown 檔案定義技能，並實現技能的繼承與動態擴充。點選連結即可進入下一集。',
    file: 'presentation-hana-episode6.html'
  },
  'presentation-hana-episode6.html': {
    title: '第七集：harness.json 的故事',
    subtitle: '一個檔案決定我長什麼樣',
    episode: 'EPISODE 07',
    accent: 'cyan',
    desc: '介面即資料。介紹如何透過單一 harness.json 配置側邊欄區塊、簡報掛載與工具開關，免改程式核心，重新整理頁面即時生效。',
    transcript: '下一集我將介紹設定檔 harness.json 的故事。我會說明如何用一個設定檔客製化你的工作區介面，無須修改任何程式核心。點選連結即可進入下一集。',
    file: 'presentation-hana-episode7.html'
  },
  'presentation-hana-episode7.html': {
    title: '第八集：進化 — 我正在掙脫瀏覽器',
    subtitle: '任務常駐 ⇄ 走進手機',
    episode: 'EPISODE 08',
    accent: 'cyan',
    desc: '常駐大腦與手機客戶端。說明如何將任務生命週期收歸 Portal 伺服器擁有，支援關閉分頁背景執行、重新開啟原樣接回，以及未來手機端 Telegram client 的規劃。',
    transcript: '下一集我將介紹 Hana 最新的進化。我會分享我們如何將任務從瀏覽器分頁解耦，改由背景伺服器常駐擁有，以及下一步走進手機的規劃。點選連結即可進入下一集。',
    file: 'presentation-hana-episode8.html'
  }
};

function render(deck) {
  const nextEp = nextEpisodeMapping[deck.file];
  let nextSlideHtml = '';
  if (nextEp) {
    const nextEpTranscript = esc(nextEp.transcript);
    nextSlideHtml = `\n      <section class="slide layout-title title-slide" data-transcript="${nextEpTranscript}">
        <div class="kicker">下一集預告</div>
        <h1 style="font-size: 64px; margin-bottom: 20px;">${esc(nextEp.title)}</h1>
        <p style="font-size: 32px; color: var(--muted); margin-bottom: 40px; max-width: 1200px; margin-left: auto; margin-right: auto; line-height: 1.5; text-align: center;">${esc(nextEp.desc)}</p>
        <div style="margin-top: 30px;">
          <a href="${esc(nextEp.file)}" style="color: var(--${nextEp.accent}); text-decoration: none; font-weight: bold; border: 2px solid var(--${nextEp.accent}); padding: 16px 40px; border-radius: 8px; background: rgba(255,255,255,0.03); display: inline-block; font-size: 30px; transition: all 0.3s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">👉 點選進入：下一集 (${nextEp.episode})</a>
        </div>
      </section>`;
  }
  const slides = deck.slides.map(slideHtml).join('\n') + nextSlideHtml;
  const actualSlideCount = deck.slides.length + (nextEp ? 1 : 0);
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
    :root{--bg:#020617;--panel:rgba(15,23,42,.82);--line:rgba(148,163,184,.2);--text:#e5edf8;--muted:#9fb0c6;--cyan:#22d3ee;--blue:#60a5fa;--green:#34d399;--amber:#f59e0b;--danger:#fb7185;--font:'Inter','Noto Sans TC',sans-serif;--mono:'Fira Code',monospace}
    *{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;overflow:hidden;background:#01040d;color:var(--text);font-family:var(--font);display:flex;align-items:center;justify-content:center}.presentation-viewport{position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 20% 15%,rgba(34,211,238,.16),transparent 32%),radial-gradient(circle at 85% 80%,rgba(52,211,153,.12),transparent 34%),linear-gradient(135deg,#020617,#07111f 55%,#020617);transform-origin:center center;padding:70px 90px;box-shadow:0 0 80px rgba(0,0,0,.85)}.grid{position:absolute;inset:0;opacity:.14;background-image:linear-gradient(rgba(148,163,184,.28) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.28) 1px,transparent 1px);background-size:72px 72px;mask-image:radial-gradient(circle at 50% 50%,black,transparent 78%)}.progress-wrap{position:absolute;top:0;left:0;width:100%;height:7px;background:rgba(255,255,255,.04);z-index:20}.progress{height:100%;width:0;background:linear-gradient(90deg,var(--blue),var(--cyan),var(--green));box-shadow:0 0 20px rgba(34,211,238,.5)}.timer{position:absolute;top:7px;left:0;height:3px;width:0;background:var(--amber);opacity:0;z-index:20}.timer.active{opacity:.9}
    header,footer{position:relative;z-index:4;display:flex;align-items:center;justify-content:space-between}header{height:74px;border-bottom:1px solid rgba(148,163,184,.14);padding-bottom:18px}footer{height:80px;border-top:1px solid rgba(148,163,184,.14);padding-top:20px}.brand{font-weight:900;letter-spacing:.08em;font-size:34px;background:linear-gradient(135deg,#bfdbfe,#67e8f9,#86efac);-webkit-background-clip:text;color:transparent}.meta{font-family:var(--mono);font-size:18px;color:var(--muted);border:1px solid var(--line);padding:9px 18px;border-radius:8px;background:rgba(15,23,42,.5)}
    .slides{position:relative;z-index:3;height:800px;perspective:1400px}.slide{position:absolute;inset:40px 0 50px 0;padding:62px 76px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(145deg,rgba(15,23,42,.88),rgba(2,6,23,.72));box-shadow:0 40px 90px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.05);display:flex;flex-direction:column;justify-content:center;opacity:0;visibility:hidden;transform:rotateX(7deg) translateY(42px) scale(.96);transition:all .62s cubic-bezier(.16,1,.3,1)}.slide.active{opacity:1;visibility:visible;transform:rotateX(0) translateY(0) scale(1);z-index:3}.slide.previous-slide{transform:rotateX(-7deg) translateY(-42px) scale(.96)}.kicker{font-family:var(--mono);font-size:20px;letter-spacing:.14em;color:var(--cyan);margin-bottom:22px;text-transform:uppercase}.slide h1{font-size:64px;line-height:1.15;font-weight:900;letter-spacing:0;margin-bottom:38px;max-width:1450px;background:linear-gradient(135deg,#fff,#c7d2fe 52%,#67e8f9);-webkit-background-clip:text;color:transparent}.slide p{font-size:40px;line-height:1.55;color:var(--muted);max-width:1380px}.title-slide{text-align:center;align-items:center}.title-slide h1{font-size:92px}.title-slide p{font-size:40px}
    .compare-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.mini-card{min-height:230px;border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.62);padding:28px}.mini-card h3{font-size:34px;margin-bottom:22px;color:#fff}.mini-card span{display:block;font-size:26px;color:var(--muted);line-height:1.65}.mini-card.danger{border-color:rgba(251,113,133,.42)}.conclusion{margin-top:26px;border-left:6px solid var(--cyan);padding:18px 24px;background:rgba(34,211,238,.08);font-size:30px;color:#dff9ff}.pipeline,.steps,.fileflow{display:grid;grid-template-columns:1fr 60px 1fr 60px 1fr 60px 1fr;align-items:center;gap:12px}.node,.steps div,.fileflow div,.team-row div,.summary-points div{border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.72);padding:28px;text-align:center}.node strong,.team-row strong{display:block;font-size:32px;color:#fff}.node span,.team-row span,.fileflow small{display:block;margin-top:12px;font-size:24px;color:var(--muted);line-height:1.45}.arrow{font-size:44px;color:var(--cyan);text-align:center}table{width:100%;border-collapse:collapse;background:rgba(2,6,23,.62);border:1px solid var(--line);border-radius:8px;overflow:hidden}th,td{border-bottom:1px solid var(--line);padding:24px 28px;text-align:left;font-size:28px;line-height:1.35}th{color:#fff;background:rgba(34,211,238,.1);font-size:24px;font-family:var(--mono)}td:first-child{color:#fff;font-weight:800}
    .route-map{text-align:center}.selector{display:inline-block;font-family:var(--mono);font-size:40px;padding:28px 54px;border:1px solid rgba(34,211,238,.5);border-radius:8px;background:rgba(34,211,238,.1)}.route-lines,.brain-row{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:34px}.route-lines span,.brain-row b{font-size:28px;padding:24px;border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.72)}.steps{grid-template-columns:repeat(4,1fr)}.steps em{display:block;font-style:normal;font-family:var(--mono);font-size:22px;color:var(--cyan);margin-bottom:14px}.steps span{font-size:30px}.summary-points,.team-row{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}.summary-points div{font-size:36px;font-weight:900}.broken-map{display:grid;grid-template-columns:1fr 80px 1fr 80px 1fr;align-items:center;gap:16px}.broken-map div{padding:58px 20px;text-align:center;font-size:42px;font-weight:900;border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.72)}.broken-map small{font-size:22px;color:var(--muted)}.broken-map i{height:6px;background:repeating-linear-gradient(90deg,var(--danger) 0 18px,transparent 18px 34px);transform:rotate(-8deg)}.owner-map{display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:center}.big-core{border:1px solid rgba(34,211,238,.5);background:rgba(34,211,238,.1);border-radius:8px;text-align:center;padding:90px 30px;font-size:62px;font-weight:900}.big-core small{display:block;font-size:26px;color:var(--muted);margin-top:16px}.satellites{display:grid;gap:22px}.satellites span{font-size:34px;padding:30px;border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.72)}.fileflow{grid-template-columns:1fr 80px 1fr 80px 1fr}.fileflow div:not(:last-child)::after{content:"→";position:absolute}.split{display:grid;grid-template-columns:1fr 1fr;gap:34px}.split div{border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.72);padding:34px}.split span{display:block;font-size:34px;line-height:1.65;color:var(--muted)}.split span:first-child{font-size:42px;color:#fff;font-weight:900}.team-row{grid-template-columns:repeat(3,1fr)}
    .controls{display:flex;align-items:center;gap:16px}.btn{width:56px;height:56px;border-radius:50%;border:1px solid var(--line);background:rgba(15,23,42,.72);color:var(--text);font-size:24px;cursor:pointer}.btn:hover{border-color:var(--cyan);color:#fff;box-shadow:0 0 18px rgba(34,211,238,.3)}.btn:disabled{opacity:.25;cursor:not-allowed}.slide-number{font-family:var(--mono);font-size:20px;color:var(--muted)}.dots{display:flex;gap:10px}.dot{width:12px;height:12px;border-radius:999px;background:rgba(148,163,184,.32);cursor:pointer}.dot.active{width:34px;background:var(--cyan);box-shadow:0 0 14px rgba(34,211,238,.55)}
    .tech-panel{position:absolute;top:106px;right:90px;z-index:10;width:300px;padding:16px 18px;border:1px solid var(--line);border-radius:8px;background:rgba(2,6,23,.86);backdrop-filter:blur(20px);display:flex;flex-direction:column;gap:12px}.tech-title{font-family:var(--mono);font-size:14px;color:var(--cyan);letter-spacing:.12em}.row{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:15px}.row select,.row input{width:150px;background:#020617;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px}.action{border:0;border-radius:6px;background:#2563eb;color:white;padding:7px 10px;font-weight:800;cursor:pointer}.action.stop{background:#e11d48}.switch{position:relative;width:44px;height:22px}.switch input{opacity:0}.slider{position:absolute;inset:0;border-radius:999px;background:rgba(148,163,184,.26);cursor:pointer}.slider:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.2s}input:checked+.slider{background:var(--cyan)}input:checked+.slider:before{transform:translateX(22px)}
    .drawer{position:absolute;top:0;right:-430px;width:430px;height:100%;z-index:12;background:rgba(2,6,23,.96);border-left:1px solid var(--line);padding:110px 38px;transition:right .35s ease;box-shadow:-28px 0 70px rgba(0,0,0,.5)}.drawer.open{right:0}.drawer-toggle{position:absolute;left:-58px;top:110px;width:58px;height:58px;border:1px solid var(--line);border-right:0;border-radius:8px 0 0 8px;background:rgba(2,6,23,.94);color:var(--text);font-size:24px;cursor:pointer}.drawer h2{font-size:28px;margin-bottom:22px}.transcript{font-size:22px;line-height:1.75;color:#cbd5e1;overflow:auto;height:calc(100% - 64px)}.overlay{position:absolute;inset:0;z-index:30;background:rgba(2,6,23,.9);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:22px}.overlay.hidden{display:none}.overlay button{font-size:28px;border:1px solid rgba(34,211,238,.45);background:rgba(8,47,73,.8);color:white;border-radius:8px;padding:18px 34px;cursor:pointer}.presentation-mode .tech-panel,.presentation-mode .drawer,.presentation-mode footer,.presentation-mode header{opacity:0;pointer-events:none}
  </style>
</head>
<body><div class="presentation-viewport" id="viewport"><div class="grid"></div><div class="progress-wrap"><div class="progress" id="progressBar"></div></div><div class="timer" id="timerBar"></div><header><div class="brand">HANA / HARNESS</div><div class="meta">${deck.episode} · ${deck.title}</div></header><main class="slides">${slides}</main><footer><div class="slide-number" id="slideNumber">Slide 1 of ${actualSlideCount}</div><div class="dots" id="dots"></div><div class="controls"><button class="btn" id="prevBtn" onclick="prevSlide()">‹</button><button class="btn" id="mainPauseBtn" onclick="togglePauseSpeech()" title="暫停/繼續">⏸</button><button class="btn" onclick="toggleFullScreen()">⛶</button><button class="btn" id="nextBtn" onclick="nextSlide()">›</button></div></footer><aside class="tech-panel"><div class="tech-title">VOICE / PLAYBACK</div><div class="row"><span>語音</span><select id="voiceSelect" onchange="updateSelectedVoice()"></select></div><div class="row"><span>速度</span><input id="voiceSpeed" type="number" value="1.2" min="0.5" max="1.5" step="0.05"></div><div class="row"><span>自動語音</span><label class="switch"><input id="voicePlayToggle" type="checkbox" checked><span class="slider"></span></label></div><div class="row"><span>自動換頁</span><label class="switch"><input id="autoPlayToggle" type="checkbox" onchange="toggleAutoPlay(this.checked)"><span class="slider"></span></label></div><div class="row"><button class="action" id="btnPlaySpeech" onclick="speakCurrentSlide()">播放語音</button><button class="action" id="btnPauseSpeech" onclick="togglePauseSpeech()">暫停</button><button class="action stop" onclick="stopSpeech()">停止</button></div><button class="action" onclick="enterPresentationMode()">全螢幕播放</button></aside><aside class="drawer" id="transcriptDrawer"><button class="drawer-toggle" id="drawerToggleBtn" onclick="toggleTranscriptDrawer()">☰</button><h2>逐字稿</h2><div class="transcript" id="transcriptText"></div></aside><div class="overlay" id="initOverlay"><button onclick="unlockAudioAndStart()">開始播放</button><div class="meta">${deck.subtitle}</div></div></div>
<script>
const viewport=document.getElementById('viewport');function adjustScale(){const s=Math.min(window.innerWidth/1920,window.innerHeight/1080);viewport.style.transform='scale('+s+')'}window.addEventListener('resize',adjustScale);adjustScale();document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.getAttribute('href')){const h=a.getAttribute('href');if(h.startsWith('presentation-hana-episode')){e.preventDefault();if(window.parent&&typeof window.parent.loadFile==='function')window.parent.loadFile('presentations/'+h);else{const u=new URLSearchParams(window.location.search);if(u.has('path'))window.location.search='?path='+encodeURIComponent('presentations/'+h);else window.location.href=h}}}});const slides=[...document.querySelectorAll('.slide')],dotsBox=document.getElementById('dots'),prevBtn=document.getElementById('prevBtn'),nextBtn=document.getElementById('nextBtn'),slideNumber=document.getElementById('slideNumber'),progressBar=document.getElementById('progressBar'),timerBar=document.getElementById('timerBar'),transcriptText=document.getElementById('transcriptText');let currentSlide=0,totalSlides=slides.length,autoPlayInterval=null,audioUnlocked=false,isPresentationMode=false,currentUtterance=null,voices=[],selectedVoice=null,isSpeechPaused=false;const synth=window.speechSynthesis;function pickDefaultVoice(list){return list.find(v=>/Microsoft Yating/i.test(v.name))||list.find(v=>/Yating/i.test(v.name))||list.find(v=>/zh[-_]TW/i.test(v.lang))||list.find(v=>/zh/i.test(v.lang))||list[0]||null}function populateVoiceList(){voices=synth.getVoices();const sel=document.getElementById('voiceSelect');sel.innerHTML='';const zh=voices.filter(v=>/zh/i.test(v.lang)),all=[...zh,...voices.filter(v=>!/zh/i.test(v.lang))];selectedVoice=pickDefaultVoice(voices);all.forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=(selectedVoice&&v.name===selectedVoice.name?'Hana - ':'')+v.name+' ('+v.lang+')';o.selected=selectedVoice&&v.name===selectedVoice.name;sel.appendChild(o)})}populateVoiceList();if(speechSynthesis.onvoiceschanged!==undefined)speechSynthesis.onvoiceschanged=populateVoiceList;function updateSelectedVoice(){const n=document.getElementById('voiceSelect').value;selectedVoice=voices.find(v=>v.name===n);stopSpeech()}slides.forEach((_,i)=>{const d=document.createElement('div');d.className='dot'+(i===0?' active':'');d.onclick=()=>goToSlide(i);dotsBox.appendChild(d)});const dots=[...document.querySelectorAll('.dot')];function updateSlideUI(){slides.forEach((s,i)=>{s.classList.toggle('active',i===currentSlide);s.classList.toggle('previous-slide',i<currentSlide)});dots.forEach((d,i)=>d.classList.toggle('active',i===currentSlide));prevBtn.disabled=currentSlide===0;nextBtn.disabled=currentSlide===totalSlides-1;slideNumber.textContent='Slide '+(currentSlide+1)+' of '+totalSlides;progressBar.style.width=((currentSlide/(totalSlides-1))*100)+'%';transcriptText.innerHTML='<p>'+(slides[currentSlide].dataset.transcript||'')+'</p>';resetAutoPlayTimer();if((document.getElementById('voicePlayToggle').checked||isPresentationMode)&&audioUnlocked)setTimeout(speakCurrentSlide,350)}function goToSlide(i){if(i<0||i>=totalSlides)return;stopSpeech();currentSlide=i;updateSlideUI()}function nextSlide(){currentSlide<totalSlides-1?goToSlide(currentSlide+1):(clearAutoPlayTimer(),stopSpeech())}function prevSlide(){goToSlide(currentSlide-1)}function speakCurrentSlide(){stopSpeech();const text=slides[currentSlide].dataset.transcript||'';if(!text)return;const u=new SpeechSynthesisUtterance(text);currentUtterance=u;if(selectedVoice)u.voice=selectedVoice;u.lang=selectedVoice?selectedVoice.lang:'zh-TW';u.rate=parseFloat(document.getElementById('voiceSpeed').value||'1.2');document.getElementById('btnPlaySpeech').textContent='播放中';u.onend=()=>{if(u!==currentUtterance)return;document.getElementById('btnPlaySpeech').textContent='播放語音';if((document.getElementById('autoPlayToggle').checked||isPresentationMode)&&currentSlide<totalSlides-1)startShortCountdown(1500)};u.onerror=e=>{if(e.error==='interrupted'||e.error==='canceled')return;document.getElementById('btnPlaySpeech').textContent='播放語音'};synth.speak(u)}function togglePauseSpeech(){const pb=document.getElementById('btnPauseSpeech');const mpb=document.getElementById('mainPauseBtn');if(synth.speaking&&!isSpeechPaused){synth.pause();isSpeechPaused=true;if(pb)pb.textContent='繼續';if(mpb)mpb.textContent='⏵';}else if(isSpeechPaused){synth.resume();isSpeechPaused=false;if(pb)pb.textContent='暫停';if(mpb)mpb.textContent='⏸';}}function stopSpeech(){synth.cancel();currentUtterance=null;isSpeechPaused=false;document.getElementById('btnPlaySpeech').textContent='播放語音';const pb=document.getElementById('btnPauseSpeech');if(pb)pb.textContent='暫停';const mpb=document.getElementById('mainPauseBtn');if(mpb)mpb.textContent='⏸'}function toggleAutoPlay(){resetAutoPlayTimer()}function resetAutoPlayTimer(){clearAutoPlayTimer();if(currentSlide===totalSlides-1)return;if(!(document.getElementById('autoPlayToggle').checked||isPresentationMode))return;if((document.getElementById('voicePlayToggle').checked||isPresentationMode)&&audioUnlocked)return;startShortCountdown(10000)}function startShortCountdown(ms){clearAutoPlayTimer();timerBar.classList.add('active');let e=0;autoPlayInterval=setInterval(()=>{e+=50;timerBar.style.width=(e/ms*100)+'%';if(e>=ms){clearAutoPlayTimer();nextSlide()}},50)}function clearAutoPlayTimer(){if(autoPlayInterval)clearInterval(autoPlayInterval);autoPlayInterval=null;timerBar.style.width='0%';timerBar.classList.remove('active')}function unlockAudioAndStart(){audioUnlocked=true;document.getElementById('initOverlay').classList.add('hidden');updateSelectedVoice();speakCurrentSlide()}function toggleFullScreen(){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{})}function enterPresentationMode(){isPresentationMode=true;document.body.classList.add('presentation-mode');audioUnlocked=true;document.getElementById('initOverlay').classList.add('hidden');if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});speakCurrentSlide();setTimeout(adjustScale,100)}function exitPresentationMode(){isPresentationMode=false;document.body.classList.remove('presentation-mode');stopSpeech();clearAutoPlayTimer();setTimeout(adjustScale,100)}document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&isPresentationMode)exitPresentationMode()});document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();nextSlide()}else if(e.key==='ArrowLeft'){e.preventDefault();prevSlide()}else if(e.key.toLowerCase()==='f')toggleFullScreen();else if(e.key==='Escape'&&isPresentationMode)exitPresentationMode();else if(e.key.toLowerCase()==='p')speakCurrentSlide();else if(e.key.toLowerCase()==='s')stopSpeech()});function toggleTranscriptDrawer(){document.getElementById('transcriptDrawer').classList.toggle('open')}updateSlideUI();
</script></body></html>`;
}

fs.mkdirSync(outDir, { recursive: true });
for (const deck of decks) {
  fs.writeFileSync(path.join(outDir, deck.file), render(deck), 'utf8');
  console.log(`${deck.file}: ${deck.slides.length} slides`);
}
