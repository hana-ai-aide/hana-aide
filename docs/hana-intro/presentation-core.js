/* presentation-core.js — 共享簡報播放引擎
 *
 * 來源：以 ep2 (presentation-hana-episode2.html) 的 proven 內嵌引擎為基準抽出成共享模組。
 * 配對：presentation-core.css（外殼樣式）、hana-overlay.js（浮動頭像 + 語音覆寫，由 server 注入）。
 * 規格：specs/SPEC-presentation-core.md
 *
 * Deck 合約（deck 只需提供這些，其餘外殼由本檔建立）：
 *   <div class="presentation-viewport" id="viewport" [data-subtitle="..."]>
 *     <header>...brand + meta...</header>            (可選；不提供則無頁首)
 *     <main class="slides">
 *       <section class="slide [title-slide]" data-transcript="逐字稿（給 TTS 朗讀）"> ...內容... </section>
 *       ...
 *     </main>
 *   </div>
 *   <link rel="stylesheet" href="/raw?path=portal/presentation-player/presentation-core.css">
 *   <script src="/raw?path=portal/presentation-player/presentation-core.js"></script>
 *
 * 本檔自動建立：grid / progress / timer / footer(控制列) / tech-panel(語音面板) / drawer(逐字稿) / overlay(開始播放)。
 * 語音實際發聲交給瀏覽器 speechSynthesis；hana-overlay.js 會 hook speak 套用全域語音設定並驅動頭像 talk/idle。
 */
(function () {
  'use strict';

  function boot() {
    var viewport = document.getElementById('viewport') || document.querySelector('.presentation-viewport');
    if (!viewport) { console.warn('[presentation-core] 找不到 #viewport，略過初始化'); return; }
    var slidesHost = viewport.querySelector('main.slides') || viewport.querySelector('.slides');
    if (!slidesHost) { console.warn('[presentation-core] 找不到 main.slides，略過初始化'); return; }
    if (viewport.dataset.coreInit === '1') return; // 冪等：避免重複初始化
    viewport.dataset.coreInit = '1';

    var subtitle = viewport.getAttribute('data-subtitle') || '本地優先 AI 開發夥伴 Hana';

    // ── 1. 建立外殼 DOM（deck 不必自帶） ─────────────────────────────
    if (!viewport.querySelector('.grid')) {
      var grid = document.createElement('div'); grid.className = 'grid';
      viewport.insertBefore(grid, viewport.firstChild);
    }
    if (!viewport.querySelector('.progress-wrap')) {
      viewport.insertAdjacentHTML('afterbegin',
        '<div class="progress-wrap"><div class="progress" id="progressBar"></div></div>' +
        '<div class="timer" id="timerBar"></div>');
    }

    var shellHTML =
      '<footer>' +
        '<div class="slide-number" id="slideNumber">Slide 1</div>' +
        '<div class="dots" id="dots"></div>' +
        '<div class="controls">' +
          '<button class="btn" id="prevBtn" title="上一頁">‹</button>' +
          '<button class="btn" id="mainPauseBtn" title="暫停/繼續">⏸</button>' +
          '<button class="btn" id="fullscreenBtn" title="全螢幕播放（全螢幕＋語音）">⛶</button>' +
          '<button class="btn" id="nextBtn" title="下一頁">›</button>' +
        '</div>' +
      '</footer>' +
      '<aside class="tech-panel">' +
        '<div class="tech-title">VOICE / PLAYBACK</div>' +
        '<div class="row"><span>語音</span><select id="voiceSelect"></select></div>' +
        '<div class="row"><span>速度</span><input id="voiceSpeed" type="number" value="1.2" min="0.5" max="1.5" step="0.05"></div>' +
        '<div class="row"><span>自動語音</span><label class="switch"><input id="voicePlayToggle" type="checkbox" checked><span class="slider"></span></label></div>' +
        '<div class="row"><span>自動換頁</span><label class="switch"><input id="autoPlayToggle" type="checkbox"><span class="slider"></span></label></div>' +
        '<div class="row">' +
          '<button class="action" id="btnPlaySpeech">播放語音</button>' +
          '<button class="action" id="btnPauseSpeech">暫停</button>' +
          '<button class="action stop" id="btnStopSpeech">停止</button>' +
        '</div>' +
      '</aside>' +
      '<aside class="drawer" id="transcriptDrawer">' +
        '<button class="drawer-toggle" id="drawerToggleBtn">☰</button>' +
        '<h2>逐字稿</h2><div class="transcript" id="transcriptText"></div>' +
      '</aside>' +
      '<div class="overlay" id="initOverlay">' +
        '<button id="btnStartPlay">開始播放</button>' +
        '<div class="meta">' + subtitle + '</div>' +
      '</div>';
    viewport.insertAdjacentHTML('beforeend', shellHTML);

    // ── 2. 取得元素 ─────────────────────────────────────────────────
    var slides = [].slice.call(slidesHost.querySelectorAll('.slide'));
    var dotsBox = document.getElementById('dots');
    var prevBtn = document.getElementById('prevBtn');
    var nextBtn = document.getElementById('nextBtn');
    var slideNumber = document.getElementById('slideNumber');
    var progressBar = document.getElementById('progressBar');
    var timerBar = document.getElementById('timerBar');
    var transcriptText = document.getElementById('transcriptText');
    var voiceSelect = document.getElementById('voiceSelect');
    var voiceSpeed = document.getElementById('voiceSpeed');
    var voicePlayToggle = document.getElementById('voicePlayToggle');
    var autoPlayToggle = document.getElementById('autoPlayToggle');
    var btnPlaySpeech = document.getElementById('btnPlaySpeech');
    var btnPauseSpeech = document.getElementById('btnPauseSpeech');
    var mainPauseBtn = document.getElementById('mainPauseBtn');
    var initOverlay = document.getElementById('initOverlay');
    var transcriptDrawer = document.getElementById('transcriptDrawer');

    var currentSlide = 0, totalSlides = slides.length, autoPlayInterval = null;
    var audioUnlocked = false, isPresentationMode = false, currentUtterance = null;
    var voices = [], selectedVoice = null, isSpeechPaused = false;
    var _animSkip = false; // guard: skip triggerSlideAnims when navigating backward
    var synth = window.speechSynthesis;

    // ── 3. 縮放 ─────────────────────────────────────────────────────
    function adjustScale() {
      var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      viewport.style.transform = 'scale(' + s + ')';
    }
    window.addEventListener('resize', adjustScale);
    adjustScale();

    // ── 4. 語音清單 ─────────────────────────────────────────────────
    function pickDefaultVoice(list) {
      return list.find(function (v) { return /Microsoft XiaoYi/i.test(v.name); }) ||
             list.find(function (v) { return /XiaoYi/i.test(v.name); }) ||
             list.find(function (v) { return /Microsoft Yating/i.test(v.name); }) ||
             list.find(function (v) { return /Yating/i.test(v.name); }) ||
             list.find(function (v) { return /zh[-_]TW/i.test(v.lang); }) ||
             list.find(function (v) { return /zh/i.test(v.lang); }) ||
             list[0] || null;
    }
    function populateVoiceList() {
      if (!synth) return;
      voices = synth.getVoices();
      voiceSelect.innerHTML = '';
      var zh = voices.filter(function (v) { return /zh/i.test(v.lang); });
      var all = zh.concat(voices.filter(function (v) { return !/zh/i.test(v.lang); }));
      selectedVoice = pickDefaultVoice(voices);
      all.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v.name;
        o.textContent = (selectedVoice && v.name === selectedVoice.name ? 'Hana - ' : '') + v.name + ' (' + v.lang + ')';
        o.selected = selectedVoice && v.name === selectedVoice.name;
        voiceSelect.appendChild(o);
      });
    }
    populateVoiceList();
    if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = populateVoiceList;
    function updateSelectedVoice() {
      selectedVoice = voices.find(function (v) { return v.name === voiceSelect.value; });
      stopSpeech();
    }

    // ── 5. 動畫鉤子（PRES-ANIM-01）────────────────────────────────
    // data-anim: 元素進場動畫（auto-reveal with stagger）
    // data-anim-step="N": 手動步進（右鍵依序揭露，不換頁）
    // data-anim-delay="ms": 覆蓋 auto-reveal 的延遲（預設 idx*150+100ms）
    function resetSlideAnims(slide) {
      [].slice.call(slide.querySelectorAll('[data-anim]')).forEach(function(el) {
        el.classList.remove('anim-visible');
      });
      slide._animStep = 0;
    }
    function revealAllAnims(slide) {
      [].slice.call(slide.querySelectorAll('[data-anim]')).forEach(function(el) {
        el.classList.add('anim-visible');
      });
      slide._animStep = getMaxAnimStep(slide);
    }
    function getMaxAnimStep(slide) {
      var steps = [].slice.call(slide.querySelectorAll('[data-anim-step]'))
        .map(function(el) { return parseInt(el.dataset.animStep, 10) || 1; });
      return steps.length ? Math.max.apply(null, steps) : 0;
    }
    function triggerSlideAnims(slide) {
      var autoEls = [].slice.call(slide.querySelectorAll('[data-anim]:not([data-anim-step])'));
      autoEls.forEach(function(el, idx) {
        var delay = parseInt(el.dataset.animDelay || String(idx * 150 + 100), 10);
        setTimeout(function() {
          if (slide.classList.contains('active')) el.classList.add('anim-visible');
        }, delay);
      });
      slide._animStep = 0;
    }
    function advanceAnimStep(slide) {
      var step = (slide._animStep || 0) + 1;
      slide._animStep = step;
      [].slice.call(slide.querySelectorAll('[data-anim-step]')).forEach(function(el) {
        if ((parseInt(el.dataset.animStep, 10) || 1) <= step) el.classList.add('anim-visible');
      });
    }

    // ── 6. 投影片切換 ───────────────────────────────────────────────
    slides.forEach(function (_, i) {
      var d = document.createElement('div');
      d.className = 'dot' + (i === 0 ? ' active' : '');
      d.addEventListener('click', function () { goToSlide(i); });
      dotsBox.appendChild(d);
    });
    var dots = [].slice.call(dotsBox.querySelectorAll('.dot'));
    function updateSlideUI() {
      slides.forEach(function (s, i) {
        s.classList.toggle('active', i === currentSlide);
        s.classList.toggle('previous-slide', i < currentSlide);
      });
      dots.forEach(function (d, i) { d.classList.toggle('active', i === currentSlide); });
      prevBtn.disabled = currentSlide === 0;
      nextBtn.disabled = currentSlide === totalSlides - 1;
      slideNumber.textContent = 'Slide ' + (currentSlide + 1) + ' of ' + totalSlides;
      progressBar.style.width = (totalSlides > 1 ? (currentSlide / (totalSlides - 1)) * 100 : 100) + '%';
      transcriptText.innerHTML = '<p>' + slideTranscript(currentSlide) + '</p>';
      if (!_animSkip) triggerSlideAnims(slides[currentSlide]);
      resetAutoPlayTimer();
      if ((voicePlayToggle.checked || isPresentationMode) && audioUnlocked) setTimeout(speakCurrentSlide, 350);
    }
    // 逐字稿來源：優先 data-transcript，相容舊 deck 的 data-notes
    function slideTranscript(i) { var s = slides[i]; return (s.dataset.transcript || s.dataset.notes || ''); }
    // 朗讀前淨化：把會被 TTS 唸出的分隔符號（半/全形 / \ |）換成空白，避免唸成「斜線」。
    // 只作用於「發聲文字」，不影響抽屜顯示的逐字稿；單次 regex/張，效能可忽略。
    // 委派給共用的發聲正規化器（符號 + 同音字表）；未載入時退回原本的符號淨化。
    function ttsSanitize(t) {
      if (typeof window !== 'undefined' && window.ttsNormalize) return window.ttsNormalize(t);
      return String(t || '').replace(/[\/／\\＼|｜]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    }
    function goToSlide(i) {
      if (i < 0 || i >= totalSlides) return;
      stopSpeech();
      resetSlideAnims(slides[currentSlide]);
      currentSlide = i;
      updateSlideUI();
    }
    function nextSlide() {
      var slide = slides[currentSlide];
      if ((slide._animStep || 0) < getMaxAnimStep(slide)) {
        advanceAnimStep(slide);
        return;
      }
      currentSlide < totalSlides - 1 ? goToSlide(currentSlide + 1) : (clearAutoPlayTimer(), stopSpeech());
    }
    function prevSlide() {
      if (currentSlide <= 0) return;
      stopSpeech();
      resetSlideAnims(slides[currentSlide]);
      currentSlide -= 1;
      revealAllAnims(slides[currentSlide]);
      _animSkip = true;
      updateSlideUI();
      _animSkip = false;
    }

    // ── 7. TTS ──────────────────────────────────────────────────────
    function speakCurrentSlide() {
      if (!synth) return;
      stopSpeech();
      var text = ttsSanitize(slideTranscript(currentSlide));
      if (!text) return;
      var u = new SpeechSynthesisUtterance(text);
      currentUtterance = u;
      if (selectedVoice) u.voice = selectedVoice;
      u.lang = selectedVoice ? selectedVoice.lang : 'zh-TW';
      u.rate = parseFloat(voiceSpeed.value || '1.2');
      btnPlaySpeech.textContent = '播放中';
      u.onend = function () {
        if (u !== currentUtterance) return;
        btnPlaySpeech.textContent = '播放語音';
        if ((autoPlayToggle.checked || isPresentationMode) && currentSlide < totalSlides - 1) startShortCountdown(1500);
      };
      u.onerror = function (e) {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        btnPlaySpeech.textContent = '播放語音';
      };
      synth.speak(u); // hana-overlay.js 會在此 hook，套用全域語音 + 頭像 talk/idle
    }
    function togglePauseSpeech() {
      if (!synth) return;
      if (synth.speaking && !isSpeechPaused) {
        synth.pause(); isSpeechPaused = true;
        if (btnPauseSpeech) btnPauseSpeech.textContent = '繼續';
        if (mainPauseBtn) mainPauseBtn.textContent = '⏵';
      } else if (isSpeechPaused) {
        synth.resume(); isSpeechPaused = false;
        if (btnPauseSpeech) btnPauseSpeech.textContent = '暫停';
        if (mainPauseBtn) mainPauseBtn.textContent = '⏸';
      }
    }
    function stopSpeech() {
      if (synth) synth.cancel();
      currentUtterance = null; isSpeechPaused = false;
      btnPlaySpeech.textContent = '播放語音';
      if (btnPauseSpeech) btnPauseSpeech.textContent = '暫停';
      if (mainPauseBtn) mainPauseBtn.textContent = '⏸';
    }

    // ── 8. 自動換頁 ─────────────────────────────────────────────────
    function resetAutoPlayTimer() {
      clearAutoPlayTimer();
      if (currentSlide === totalSlides - 1) return;
      if (!(autoPlayToggle.checked || isPresentationMode)) return;
      if ((voicePlayToggle.checked || isPresentationMode) && audioUnlocked) return; // 有語音時靠 onend 推進
      startShortCountdown(10000);
    }
    function startShortCountdown(ms) {
      clearAutoPlayTimer();
      timerBar.classList.add('active');
      var e = 0;
      autoPlayInterval = setInterval(function () {
        e += 50; timerBar.style.width = (e / ms * 100) + '%';
        if (e >= ms) { clearAutoPlayTimer(); nextSlide(); }
      }, 50);
    }
    function clearAutoPlayTimer() {
      if (autoPlayInterval) clearInterval(autoPlayInterval);
      autoPlayInterval = null;
      timerBar.style.width = '0%';
      timerBar.classList.remove('active');
    }

    // ── 9. 全螢幕 / 簡報模式 ────────────────────────────────────────
    function unlockAudioAndStart() {
      audioUnlocked = true;
      initOverlay.classList.add('hidden');
      updateSelectedVoice();
      speakCurrentSlide();
    }
    function toggleFullScreen() {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(function () {});
    }
    function enterPresentationMode() {
      isPresentationMode = true;
      document.body.classList.add('presentation-mode');
      audioUnlocked = true;
      initOverlay.classList.add('hidden');
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
      speakCurrentSlide();
      setTimeout(adjustScale, 100);
    }
    function exitPresentationMode() {
      isPresentationMode = false;
      document.body.classList.remove('presentation-mode');
      stopSpeech(); clearAutoPlayTimer();
      setTimeout(adjustScale, 100);
    }
    // ⛶ 一顆搞定：非全螢幕 → 進「全螢幕播放」(fullscreen ＋ 語音)；已全螢幕 → 退出。
    function togglePresentMode() {
      if (document.fullscreenElement || isPresentationMode) {
        if (document.fullscreenElement) document.exitFullscreen();
        else exitPresentationMode();
      } else {
        enterPresentationMode();
      }
    }
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && isPresentationMode) exitPresentationMode();
    });

    function toggleTranscriptDrawer() { transcriptDrawer.classList.toggle('open'); }

    // ── 10. 事件接線（無 inline onclick，無全域污染） ────────────────
    prevBtn.addEventListener('click', prevSlide);
    nextBtn.addEventListener('click', nextSlide);
    mainPauseBtn.addEventListener('click', togglePauseSpeech);
    document.getElementById('fullscreenBtn').addEventListener('click', togglePresentMode);
    voiceSelect.addEventListener('change', updateSelectedVoice);
    voicePlayToggle.addEventListener('change', resetAutoPlayTimer);
    autoPlayToggle.addEventListener('change', resetAutoPlayTimer);
    btnPlaySpeech.addEventListener('click', speakCurrentSlide);
    btnPauseSpeech.addEventListener('click', togglePauseSpeech);
    document.getElementById('btnStopSpeech').addEventListener('click', stopSpeech);
    document.getElementById('drawerToggleBtn').addEventListener('click', toggleTranscriptDrawer);
    document.getElementById('btnStartPlay').addEventListener('click', unlockAudioAndStart);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextSlide(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prevSlide(); }
      else if (e.key.toLowerCase() === 'f') toggleFullScreen();
      else if (e.key === 'Escape' && isPresentationMode) exitPresentationMode();
      else if (e.key.toLowerCase() === 'p') speakCurrentSlide();
      else if (e.key.toLowerCase() === 's') stopSpeech();
    });

    // 目前 deck 所在目錄：從自己被載入的 ?path= 反推（iframe / raw 模式都經 /raw?path=<dir>/<file>.html 載入），
    // 讓 v1（presentations/）與 v2（presentations-v2/）都能正確接續，不寫死目錄。
    function currentDeckDir() {
      try {
        var p = new URLSearchParams(window.location.search).get('path');
        if (p) {
          var idx = p.lastIndexOf('/');
          if (idx >= 0) return p.slice(0, idx + 1);
        }
      } catch (e) {}
      return 'presentations/';
    }

    // 「下一集」連結：iframe 模式用 parent.loadFile；raw 模式更新 query；否則直接跳轉
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a || !a.getAttribute('href')) return;
      var h = a.getAttribute('href');
      if (h.indexOf('presentation-hana-episode') !== 0) return;
      e.preventDefault();
      var dir = currentDeckDir();
      if (window.parent && typeof window.parent.loadFile === 'function') {
        window.parent.loadFile(dir + h);
      } else {
        var u = new URLSearchParams(window.location.search);
        if (u.has('path')) window.location.search = '?path=' + encodeURIComponent(dir + h);
        else window.location.href = h;
      }
    });

    updateSlideUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
