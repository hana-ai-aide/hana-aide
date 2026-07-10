/**
 * PresentationPlayer - 一個自包含的 HTML 簡報播放框架核心
 * 
 * 設計原則：
 * 1. 獨立無依賴：純 Vanilla JS，不依賴任何外部框架或函式庫。
 * 2. 結構與表現分離：核心邏輯不寫死樣式，由外部 CSS 控制。
 * 3. 容易擴充：提供豐富的生命週期事件 (slideChange, load, error 等)，方便複製到其他專案後自行加入語音、頭像或縮圖。
 */
class PresentationPlayer {
  /**
   * @param {Object} options 
   * @param {HTMLElement} options.container - 播放器掛載的 DOM 容器
   * @param {string} [options.aspectRatio='16/9'] - 投影片的寬高比，預設 16:9
   */
  constructor(options) {
    if (!options || !options.container) {
      throw new Error('PresentationPlayer requires a container element.');
    }

    this.container = options.container;
    this.aspectRatio = options.aspectRatio || '16/9';
    
    this.slides = []; // 解析後的投影片陣列 [{ id, title, content, notes, element }]
    this.currentIndex = -1;
    this.listeners = {}; // 事件訂閱器
    this.isFullscreen = false;

    // 內部 DOM 參照
    this.dom = {
      wrapper: null,
      stage: null,
      controls: null,
      prevBtn: null,
      nextBtn: null,
      indicator: null,
      progressBar: null,
    };

    this._initLayout();
    this._initEvents();
    this._initTTS();
  }

  /**
   * 初始化 TTS 語音設定檔與瀏覽器偵測
   * @private
   */
  _initTTS() {
    this.synth = window.speechSynthesis;
    if (!this.synth) return;

    const getBrowserKey = () => {
      const ua = navigator.userAgent;
      if (ua.includes('Edg/')) return 'edge';
      if (ua.includes('Chrome/')) return 'chrome';
      if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'safari';
      if (ua.includes('Firefox/')) return 'firefox';
      return 'default';
    };

    const applyConfig = (config) => {
      // Sync speed
      let speedVal = parseFloat(localStorage.getItem('hana_tts_speed') || config.speed || '1.2');
      const browserKey = getBrowserKey();
      const browserConfig = config.browsers && config.browsers[browserKey];
      if (browserConfig && typeof browserConfig === 'object') {
        speedVal = typeof browserConfig.speed === 'number' ? browserConfig.speed : speedVal;
      }
      const speedInput = document.getElementById('voiceSpeed');
      if (speedInput) {
        speedInput.value = speedVal;
        speedInput.dispatchEvent(new Event('change'));
        speedInput.dispatchEvent(new Event('input'));
      }

      // Sync voice
      const trySelect = () => {
        const voices = this.synth.getVoices();
        if (voices && voices.length) {
          let matched = null;
          const savedVoiceName = localStorage.getItem('hana_tts_voice');
          if (savedVoiceName) {
            matched = voices.find(v => v.name === savedVoiceName);
          }
          if (!matched && browserConfig) {
            if (typeof browserConfig === 'object') {
              matched = voices.find(v => v.name === browserConfig.voice);
            } else if (typeof browserConfig === 'string') {
              matched = voices.find(v => v.name === browserConfig);
            }
          }
          if (!matched && config.voice) {
            matched = voices.find(v => v.name === config.voice);
          }
          if (!matched) {
            const ua = navigator.userAgent;
            const isEdge = ua.includes('Edg/');
            const isChrome = ua.includes('Chrome/') && !isEdge;
            const isSafari = ua.includes('Safari/') && !ua.includes('Chrome/') && !isEdge;
            const isFirefox = ua.includes('Firefox/');
            
            if (isEdge) {
              matched = voices.find(v => /Microsoft Xiaoxiao/i.test(v.name)) ||
                        voices.find(v => /Microsoft Hanhan/i.test(v.name)) ||
                        voices.find(v => /Microsoft/i.test(v.name) && /zh/i.test(v.lang));
            } else if (isChrome) {
              matched = voices.find(v => /Google 國語/i.test(v.name)) ||
                        voices.find(v => /Google/i.test(v.name) && /zh/i.test(v.lang));
            } else if (isSafari) {
              matched = voices.find(v => /Tingting/i.test(v.name)) ||
                        voices.find(v => /Sinji/i.test(v.name)) ||
                        voices.find(v => /zh/i.test(v.lang));
            } else if (isFirefox) {
              matched = voices.find(v => /zh[-_]TW/i.test(v.lang)) ||
                        voices.find(v => /zh/i.test(v.lang));
            }
            if (!matched) {
              matched = voices.find(v => /Microsoft Yating/i.test(v.name)) ||
                        voices.find(v => /Yating/i.test(v.name)) ||
                        voices.find(v => /zh[-_]TW/i.test(v.lang)) ||
                        voices.find(v => /zh/i.test(v.lang)) ||
                        voices[0] || null;
            }
          }
          
          if (matched) {
            window.selectedVoice = matched;
            const sel = document.getElementById('voiceSelect');
            if (sel) {
              Array.from(sel.options).forEach(opt => {
                 let text = opt.textContent;
                 if (text.startsWith('🌸 Hana - ')) {
                   opt.textContent = text.replace('🌸 Hana - ', '');
                 }
                 if (text.startsWith('Hana - ')) {
                   opt.textContent = text.replace('Hana - ', '');
                 }
                 if (opt.value === matched.name) {
                   opt.textContent = '🌸 Hana - ' + opt.textContent;
                 }
              });
              sel.value = matched.name;
              sel.dispatchEvent(new Event('change'));
            }
          }
        }
      };

      trySelect();
      if (this.synth.onvoiceschanged !== undefined) {
        const orig = this.synth.onvoiceschanged;
        this.synth.onvoiceschanged = () => {
          if (typeof orig === 'function') orig();
          trySelect();
        };
      }
    };

    fetch('/api/voice-config')
      .then(res => res.json())
      .then(config => {
        if (config) applyConfig(config);
      })
      .catch(err => console.error('[PresentationPlayer] Failed to load voice config:', err));
  }

  /**
   * 初始化播放器的 DOM 結構
   * @private
   */
  _initLayout() {
    this.container.classList.add('pres-player-container');

    // 建立外部包裝，用來處理全螢幕與比例縮放
    const wrapper = document.createElement('div');
    wrapper.className = 'pres-player-wrapper';
    wrapper.style.aspectRatio = this.aspectRatio;
    this.dom.wrapper = wrapper;

    // 建立投影舞台 (Slides Viewport)
    const stage = document.createElement('div');
    stage.className = 'pres-player-stage';
    this.dom.stage = stage;
    wrapper.appendChild(stage);

    // 建立控制列 (預設 UI，可透過 CSS 隱藏)
    const controls = document.createElement('div');
    controls.className = 'pres-player-controls';
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pres-btn pres-prev';
    prevBtn.innerText = '‹';
    prevBtn.setAttribute('aria-label', 'Previous slide');
    this.dom.prevBtn = prevBtn;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pres-btn pres-next';
    nextBtn.innerText = '›';
    nextBtn.setAttribute('aria-label', 'Next slide');
    this.dom.nextBtn = nextBtn;

    const indicator = document.createElement('span');
    indicator.className = 'pres-indicator';
    this.dom.indicator = indicator;

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'pres-btn pres-fullscreen';
    fullscreenBtn.innerText = '⛶';
    fullscreenBtn.setAttribute('aria-label', 'Toggle fullscreen');
    this.dom.fullscreenBtn = fullscreenBtn;

    controls.appendChild(prevBtn);
    controls.appendChild(indicator);
    controls.appendChild(nextBtn);
    controls.appendChild(fullscreenBtn);
    
    wrapper.appendChild(controls);

    // 建立進度條
    const progressBar = document.createElement('div');
    progressBar.className = 'pres-progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'pres-progress-fill';
    progressBar.appendChild(progressFill);
    this.dom.progressBar = progressFill;
    wrapper.appendChild(progressBar);

    this.container.appendChild(wrapper);
  }

  /**
   * 綁定 UI 互動與快速鍵事件
   * @private
   */
  _initEvents() {
    // 按鈕點擊
    this.dom.prevBtn.addEventListener('click', () => this.prev());
    this.dom.nextBtn.addEventListener('click', () => this.next());
    this.dom.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

    // 鍵盤快速鍵
    window.addEventListener('keydown', (e) => {
      // 只有在播放器位於可見區域或被聚焦時響應（這裡先做全域簡化，視專案需求調整）
      if (!this.container.isConnected) return;
      
      switch (e.key) {
        case 'ArrowRight':
        case 'Space':
        case ' ':
          // 如果焦點在按鈕上，讓預設的 click 觸發，避免重複執行
          if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
          e.preventDefault();
          this.next();
          break;
        case 'ArrowLeft':
          if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
          e.preventDefault();
          this.prev();
          break;
        case 'Escape':
          if (this.isFullscreen) {
            this.exitFullscreen();
          }
          break;
      }
    });

    // 監聽全螢幕變化事件
    document.addEventListener('fullscreenchange', () => {
      this.isFullscreen = (document.fullscreenElement === this.dom.wrapper);
      if (this.isFullscreen) {
        this.dom.wrapper.classList.add('is-fullscreen');
      } else {
        this.dom.wrapper.classList.remove('is-fullscreen');
      }
      this.trigger('fullscreenchange', { isFullscreen: this.isFullscreen });
      setTimeout(() => this._handleResize(), 100);
    });

    // 視窗縮放事件，處理 1920x1080 scale-to-fit
    this._handleResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._handleResize);
    // 初始呼叫
    setTimeout(() => this._handleResize(), 0);
  }

  /**
   * 處理視窗大小改變，將 stage 固定在 1920x1080 並進行 scale-to-fit
   * @private
   */
  _handleResize() {
    if (!this.dom.stage || !this.dom.wrapper) return;
    
    const targetW = 1920;
    const targetH = 1080;
    
    // 取得容器實際大小
    let containerW = this.dom.wrapper.clientWidth;
    let containerH = this.dom.wrapper.clientHeight;
    
    if (containerW === 0 || containerH === 0) {
      containerW = window.innerWidth;
      containerH = window.innerHeight;
    }
    
    const scale = Math.min(containerW / targetW, containerH / targetH);
    
    this.dom.stage.style.width = targetW + 'px';
    this.dom.stage.style.height = targetH + 'px';
    this.dom.stage.style.position = 'absolute';
    this.dom.stage.style.left = '50%';
    this.dom.stage.style.top = '50%';
    this.dom.stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this.dom.stage.style.transformOrigin = 'center center';
  }

  /**
   * 載入並解析 HTML 字串
   * @param {string} htmlText - 包含 slides 的 HTML 原始碼
   */
  loadFromHtml(htmlText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      
      // 尋找所有的 <section class="slide"> 或指定 class
      const slideElements = doc.querySelectorAll('.slide');
      if (slideElements.length === 0) {
        throw new Error('No elements with class "slide" found in the HTML content.');
      }

      this.slides = Array.from(slideElements).map((el, index) => {
        return {
          id: el.id || `slide-${index + 1}`,
          title: el.getAttribute('data-title') || `Slide ${index + 1}`,
          content: el.innerHTML,
          notes: el.getAttribute('data-notes') || '',
          element: null // 待渲染時建立
        };
      });

      this._renderSlides();
      this.goTo(0);
      this.trigger('load', { slides: this.slides });
    } catch (err) {
      this.trigger('error', err);
      console.error('[PresentationPlayer] Failed to load HTML:', err);
    }
  }

  /**
   * 從指定的 URL 獲取 HTML 簡報並載入
   * @param {string} url 
   */
  async loadFromUrl(url) {
    this.trigger('loading', { url });
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const htmlText = await response.text();
      this.loadFromHtml(htmlText);
    } catch (err) {
      this.trigger('error', err);
      console.error(`[PresentationPlayer] Failed to fetch presentation from ${url}:`, err);
    }
  }

  /**
   * 渲染投影片到舞台 DOM 中
   * @private
   */
  _renderSlides() {
    this.dom.stage.innerHTML = ''; // 清空舞台
    
    this.slides.forEach((slideData, index) => {
      const slideDiv = document.createElement('div');
      slideDiv.className = 'pres-slide';
      slideDiv.id = slideData.id;
      slideDiv.innerHTML = slideData.content;
      
      // 預設先隱藏，或套用 CSS 狀態 class
      slideDiv.classList.add('is-hidden');
      
      this.dom.stage.appendChild(slideDiv);
      slideData.element = slideDiv;
    });
  }

  /**
   * 跳轉到特定頁面的投影片
   * @param {number} index - 投影片的索引 (0-based)
   */
  goTo(index) {
    if (this.slides.length === 0) return;
    if (index < 0 || index >= this.slides.length) return;
    
    const previousIndex = this.currentIndex;
    this.currentIndex = index;

    // 更新各投影片的 CSS class 來觸發轉場效果
    this.slides.forEach((slide, idx) => {
      const el = slide.element;
      if (!el) return;

      el.classList.remove('is-active', 'is-prev', 'is-next', 'is-hidden');

      if (idx === index) {
        el.classList.add('is-active');
      } else if (idx < index) {
        el.classList.add('is-prev');
      } else {
        el.classList.add('is-next');
      }
    });

    this._updateUI();
    this._handleResize();
    
    // 觸發投影片變更事件，提供給外部擴充（如語音、縮圖、AI Avatar 等）
    this.trigger('slidechange', {
      index: index,
      slide: this.slides[index],
      previousIndex: previousIndex,
      total: this.slides.length
    });
  }

  /**
   * 下一頁
   */
  next() {
    if (this.currentIndex < this.slides.length - 1) {
      this.goTo(this.currentIndex + 1);
    } else {
      this.trigger('ended');
    }
  }

  /**
   * 上一頁
   */
  prev() {
    if (this.currentIndex > 0) {
      this.goTo(this.currentIndex - 1);
    }
  }

  /**
   * 更新 UI 元件狀態 (進度條、按鈕禁用狀態、頁數指示)
   * @private
   */
  _updateUI() {
    const total = this.slides.length;
    const currentNum = this.currentIndex + 1;
    
    // 更新頁數文字
    this.dom.indicator.innerText = `${currentNum} / ${total}`;

    // 更新按鈕狀態
    this.dom.prevBtn.disabled = (this.currentIndex === 0);
    this.dom.nextBtn.disabled = (this.currentIndex === total - 1);

    // 更新進度條百分比
    const percentage = total > 0 ? (currentNum / total) * 100 : 0;
    this.dom.progressBar.style.width = `${percentage}%`;
  }

  /**
   * 切換全螢幕模式
   */
  async toggleFullscreen() {
    if (!this.isFullscreen) {
      await this.enterFullscreen();
    } else {
      await this.exitFullscreen();
    }
  }

  /**
   * 進入全螢幕
   */
  async enterFullscreen() {
    try {
      if (this.dom.wrapper.requestFullscreen) {
        await this.dom.wrapper.requestFullscreen();
      }
    } catch (err) {
      console.error('[PresentationPlayer] Fullscreen request failed:', err);
    }
  }

  /**
   * 退出全螢幕
   */
  async exitFullscreen() {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
  }

  /**
   * 註冊事件監聽
   * @param {string} event - 事件名稱
   * @param {Function} callback - 回呼函式
   */
  on(event, callback) {
    const evtName = event.toLowerCase();
    if (!this.listeners[evtName]) {
      this.listeners[evtName] = [];
    }
    this.listeners[evtName].push(callback);
  }

  /**
   * 觸發事件
   * @param {string} event - 事件名稱
   * @param {any} data - 傳遞給回呼的資料
   */
  trigger(event, data) {
    const evtName = event.toLowerCase();
    if (this.listeners[evtName]) {
      this.listeners[evtName].forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[PresentationPlayer] Error in event listener for "${event}":`, err);
        }
      });
    }
  }
}

// 如果是 Node.js 環境（例如測試或模組打包），匯出類別
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PresentationPlayer };
} else {
  // 瀏覽器全域變數
  window.PresentationPlayer = PresentationPlayer;
}
