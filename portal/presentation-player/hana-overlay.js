// hana-overlay.js — Hana avatar overlay + drag + hide/restore + TTS/voice widget,
// injected into presentation pages by portal/server.js (/raw .html handler).
// Extracted from server.js into a STATIC file so it is served verbatim and is NOT
// subject to template-literal escape collapsing (the ' bug that broke avatar+voice).
// Self-runs on load via the IIFE; no separate init call needed.

(function() {
  function getBrowserKey() {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/')) return 'edge';
    if (ua.includes('Chrome/')) return 'chrome';
    if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'safari';
    if (ua.includes('Firefox/')) return 'firefox';
    return 'default';
  }

  let ttsVoiceName = localStorage.getItem('hana_tts_voice') || '';
  let ttsSpeed = parseFloat(localStorage.getItem('hana_tts_speed') || '1.2');

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'HANA_PORTAL_AVATAR_VISIBLE_CHANGED') {
      if (window.toggleHanaAvatarVisible) {
        window.toggleHanaAvatarVisible(event.data.visible);
      }
    }
  });

  // Pose mapping function based on mode
  function mapPoseByMode(pose, mode) {
    const p = pose.replace(/_(left|right)$/, '');
    if (mode === 'mic') {
      if (p.startsWith('headset_')) return p;
      if (p.startsWith('glasses_think')) return 'headset_think';
      if (p.startsWith('sit_smile')) return 'headset_idle';
      if (p.startsWith('laptop_talk')) return 'headset_talk';
      if (p.startsWith('tablet_read')) return 'headset_think';
      if (p.startsWith('hips_confident')) return 'headset_smile';
      if (p.startsWith('wave_hi')) return 'headset_smile';
      return 'headset_idle';
    } else {
      if (p.startsWith('headset_idle')) return 'sit_smile';
      if (p.startsWith('headset_smile')) return 'sit_smile';
      if (p.startsWith('headset_talk')) return 'laptop_talk';
      if (p.startsWith('headset_think')) return 'glasses_think';
      if (p.startsWith('headset_cheer')) return 'wave_hi';
      if (p.startsWith('headset_idea')) return 'glasses_think';
      return p;
    }
  }

  const isIframe = window.parent && window.parent !== window;

  function initHanaUpgrades() {
    // ── iframe (embedded deck) mode: do NOT spawn our own avatar widget ──
    // The OUTERMOST page (portal index.html) owns the single global avatar. A widget
    // built here would be trapped inside the scaled iframe. We only keep pose/TTS sync
    // to the parent's avatar (the speechSynthesis hook below calls updateAvatarPoseAndDir).
    if (isIframe) {
      window.updateAvatarPoseAndDir = function(pose) {
        if (!pose) return;
        var parentWin = window.parent;
        if (!parentWin || typeof parentWin.updateHanaFloatPose !== 'function') return;
        var mode = parentWin.hanaTTSMode || 'notebook';
        var cleanPose = pose.replace(/_(left|right)$/, '');
        parentWin.updateHanaFloatPose(mapPoseByMode(cleanPose, mode));
      };
      return;
    }

    const oldEl = document.getElementById('hanaAvatarFloat');
    const oldImg = document.getElementById('hanaAvatarImg');
    if (oldEl) {
      oldEl.style.setProperty('display', 'none', 'important');
    }

    // Build hana-float-widget dynamically unconditionally (both iframe and standalone)
    const widgetHTML = 
      '<div id="hana-float-widget" style="position: fixed; bottom: 24px; right: 24px; z-index: 9999; cursor: grab; user-select: none; display: flex; align-items: flex-end; gap: 8px;">' +
      '  <button id="hana-float-restore-btn" onclick="toggleHanaAvatarVisible(true)" title="顯示 Hana" style="display: none; width: 38px; height: 38px; border-radius: 50%; background: rgba(15, 23, 42, 0.85); border: 1.5px solid rgba(6, 182, 212, 0.4); box-shadow: 0 4px 12px rgba(6, 182, 212, 0.2); color: #06b6d4; font-size: 18px; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s ease; margin-bottom: 22px;">🙋‍♀️</button>' +
      '  <div style="position: relative;">' +
      '    <div id="hana-float-circle">' +
      '      <img id="hana-float-img" src="/raw?path=portal/avatar/hana_wave_hi_left.png" alt="Hana" draggable="false" onerror="this.style.opacity=\'0\'" />' +
      '    </div>' +
      '    <div id="hana-think-bubble" style="position: absolute; top: -22px; left: 50%; transform: translateX(-50%); font-size: 20px; opacity: 0; line-height: 1; pointer-events: none;">💭</div>' +
      '    <div id="hana-mode-badge" style="position: absolute; bottom: 6px; right: 2px; font-size: 16px; line-height: 1; pointer-events: none; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.7));">📝</div>' +
      '    <button id="hana-float-close-btn" onclick="toggleHanaAvatarVisible(false)" title="隱藏 Hana" style="position: absolute; top: -8px; right: -8px; width: 22px; height: 22px; border-radius: 50%; background: rgba(15, 23, 42, 0.9); border: 1.5px solid rgba(255, 255, 255, 0.25); color: #94a3b8; font-size: 16px; line-height: 1; text-align: center; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; transition: all 0.2s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.5); padding: 0; z-index: 10;">×</button>' +
      '  </div>' +
      '  <div id="hana-icon-panel" style="position: relative; display: flex; flex-direction: column; gap: 8px; padding-bottom: 22px;">' +
      '    <button id="hana-mode-btn-mic" class="hana-mode-btn" onclick="setHanaTTSMode(\'mic\')" title="麥克風模式：回覆完成自動朗讀" style="width: 38px; height: 38px; border-radius: 50%; border: 1.5px solid rgba(34,211,238,0.3); background: rgba(15, 23, 42, 0.82); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 17px;">🎙️</button>' +
      '    <button id="hana-mode-btn-notebook" class="hana-mode-btn" onclick="setHanaTTSMode(\'notebook\')" title="筆記本模式：純文字輸出" style="width: 38px; height: 38px; border-radius: 50%; border: 1.5px solid rgba(34,211,238,0.9); background: rgba(8,145,178,0.5); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 17px;">📓</button>' +
      '    <button id="hana-gear-btn" class="hana-mode-btn" onclick="toggleHanaSettings(event)" title="語音設定" style="width: 38px; height: 38px; border-radius: 50%; border: 1.5px solid rgba(148,163,184,0.3); background: rgba(15, 23, 42, 0.82); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 17px;">⚙️</button>' +
      '    <div id="hana-settings-panel" style="display: none; position: absolute; bottom: 0; right: 46px; width: 210px; background: rgba(15,23,42,0.95); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(34,211,238,0.25); border-radius: 14px; padding: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); z-index: 10001;">' +
      '      <div style="color: #94a3b8; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 10px;">語音設定</div>' +
      '      <div style="margin-bottom: 10px;">' +
      '        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">' +
      '          <label style="color: #64748b; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">語音選擇</label>' +
      '          <button onclick="testHanaVoice()" style="background: rgba(34,211,238,0.15); border: 1px solid rgba(34,211,238,0.3); border-radius: 6px; padding: 1px 6px; color: #22d3ee; font-size: 9px; font-weight: 600; cursor: pointer; transition: all 0.2s;">測試播放 🔊</button>' +
      '        </div>' +
      '        <select id="hana-voice-select-float" class="hana-voice-select-input" onchange="changeHanaVoice(this.value)" style="width: 100%; background: rgba(30,41,59,0.8); border: 1px solid rgba(100,116,139,0.3); border-radius: 8px; padding: 5px 8px; color: #e2e8f0; font-size: 11px; cursor: pointer; outline: none;">' +
      '          <option value="">載入語音中…</option>' +
      '        </select>' +
      '      </div>' +
      '      <div>' +
      '        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">' +
      '          <label style="color: #64748b; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">語速 (<span id="hana-tts-speed-val-float" class="hana-tts-speed-val-display">1.2</span>x)</label>' +
      '          <button onclick="resetHanaSpeed()" style="color: #22d3ee; font-size: 10px; font-weight: 600; background: none; border: none; cursor: pointer; padding: 0;">重設</button>' +
      '        </div>' +
      '        <input type="range" id="hana-tts-speed-slider-float" class="hana-tts-speed-slider-input" min="0.5" max="1.5" step="0.1" value="1.2" oninput="changeHanaSpeed(this.value)" style="width: 100%; height: 4px; background: rgba(100,116,139,0.3); border-radius: 4px; appearance: none; -webkit-appearance: none; cursor: pointer; accent-color: #22d3ee;" />' +
      '      </div>' +
      '      <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 10px;">' +
      '        <div style="display: flex; justify-content: space-between; align-items: center;">' +
      '          <label style="color: #64748b; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">顯示動漫形象</label>' +
      '          <input type="checkbox" id="hana-avatar-visible-toggle" checked onchange="toggleHanaAvatarVisible(this.checked)" style="width: 14px; height: 14px; cursor: pointer; accent-color: #22d3ee;" />' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    const div = document.createElement('div');
    div.innerHTML = widgetHTML.trim();
    const widgetNode = div.firstElementChild;
    // Explicitly enable pointer events on the widget so it remains interactive
    // even though the overlay layer below has pointer-events:none
    widgetNode.style.pointerEvents = 'auto';

    // Build a fixed overlay layer directly on body so it is NEVER inside a
    // transformed ancestor (#viewport uses transform:scale which would re-root
    // any position:fixed child, making the widget invisible or misplaced).
    const overlayLayer = document.createElement('div');
    overlayLayer.id = 'hana-overlay-layer';
    overlayLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    document.body.appendChild(overlayLayer);
    overlayLayer.appendChild(widgetNode);

    // Keep overlay visible during fullscreen.
    // Move the overlay layer (not the widget) into the fullscreen element when it
    // is NOT already a descendant of it (e.g. a sub-div goes fullscreen instead of
    // document.documentElement). On exit always return to body.
    document.addEventListener('fullscreenchange', () => {
      const fs = document.fullscreenElement;
      if (fs) {
        if (!fs.contains(overlayLayer)) {
          fs.appendChild(overlayLayer);
        }
      } else {
        document.body.appendChild(overlayLayer);
      }
    });

    // Drag behavior
    (function() {
      let dragging = false, ox = 0, oy = 0, sx = 0, sy = 0;
      widgetNode.addEventListener('mousedown', function(e) {
        if (e.target.closest('button') || e.target.closest('#hana-settings-panel')) return;
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        const rect = widgetNode.getBoundingClientRect();
        ox = rect.left; oy = rect.top;
        widgetNode.style.right = 'auto'; widgetNode.style.bottom = 'auto';
        widgetNode.style.left = ox + 'px'; widgetNode.style.top = oy + 'px';
        widgetNode.style.cursor = 'grabbing';
        e.preventDefault();
      });
      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        widgetNode.style.left = (ox + e.clientX - sx) + 'px';
        widgetNode.style.top = (oy + e.clientY - sy) + 'px';
      });
      document.addEventListener('mouseup', function() {
        if (dragging) {
          dragging = false;
          widgetNode.style.cursor = 'grab';
          if (window.updateAvatarPoseAndDir) window.updateAvatarPoseAndDir();
        }
      });
    })();

    // Setup window settings helper functions
    window.toggleHanaSettings = function(e) {
      if (e) e.stopPropagation();
      const panel = document.getElementById('hana-settings-panel');
      if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    };
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('hana-settings-panel');
      const btn = document.getElementById('hana-gear-btn');
      if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== btn) {
        panel.style.display = 'none';
      }
    });

    window.setHanaTTSMode = function(mode) {
      window.hanaTTSMode = mode;
      localStorage.setItem('hana_tts_mode', mode);
      const micBtn = document.getElementById('hana-mode-btn-mic');
      const nbBtn = document.getElementById('hana-mode-btn-notebook');
      const badge = document.getElementById('hana-mode-badge');
      
      if (mode === 'mic') {
        if (micBtn) micBtn.classList.add('active');
        if (nbBtn) nbBtn.classList.remove('active');
        if (badge) badge.textContent = '🎙️';
      } else {
        if (nbBtn) nbBtn.classList.add('active');
        if (micBtn) micBtn.classList.remove('active');
        if (badge) badge.textContent = '📝';
      }
      
      if (window.updateAvatarPoseAndDir) window.updateAvatarPoseAndDir();
      saveVoiceConfigToServer();
    };

    window.changeHanaVoice = function(voiceName) {
      ttsVoiceName = voiceName;
      localStorage.setItem('hana_tts_voice', voiceName);
      const synth = window.speechSynthesis;
      if (synth) {
        const v = synth.getVoices().find(x => x.name === voiceName);
        if (v) {
          window.selectedVoice = v;
          const mainSelect = document.getElementById('voiceSelect');
          if (mainSelect) mainSelect.value = voiceName;
        }
      }
      saveVoiceConfigToServer();
      setTimeout(window.testHanaVoice, 100);
    };

    window.changeHanaSpeed = function(val) {
      ttsSpeed = parseFloat(val);
      localStorage.setItem('hana_tts_speed', val);
      const display = document.getElementById('hana-tts-speed-val-float');
      if (display) display.textContent = val;
      const speedInput = document.getElementById('voiceSpeed');
      if (speedInput) {
        speedInput.value = val;
      }
      saveVoiceConfigToServer();
    };

    window.resetHanaSpeed = function() {
      const slider = document.getElementById('hana-tts-speed-slider-float');
      if (slider) slider.value = '1.2';
      window.changeHanaSpeed('1.2');
    };

    window.toggleHanaAvatarVisible = function(visible) {
      localStorage.setItem('hana_avatar_visible', visible ? '1' : '0');
      const widget = document.getElementById('hana-float-widget');
      if (widget) {
        widget.classList.toggle('avatar-hidden', !visible);
      }
      const chk = document.getElementById('hana-avatar-visible-toggle');
      if (chk) chk.checked = !!visible;

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'HANA_PORTAL_AVATAR_VISIBLE_CHANGED',
          visible: visible
        }, window.location.origin);
      }
    };

    window.testHanaVoice = function() {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance("你好，我是哈娜 Hana");
      if (window.selectedVoice) {
        u.voice = window.selectedVoice;
        u.lang = window.selectedVoice.lang;
      } else {
        u.lang = 'zh-TW';
      }
      u.rate = ttsSpeed;
      
      u.onstart = () => { if (window.updateAvatarPoseAndDir) window.updateAvatarPoseAndDir('headset_talk'); };
      u.onend = () => { if (window.updateAvatarPoseAndDir) window.updateAvatarPoseAndDir('headset_idle'); };
      u.onerror = () => { if (window.updateAvatarPoseAndDir) window.updateAvatarPoseAndDir('headset_idle'); };
      synth.speak(u);
    };

    function saveVoiceConfigToServer() {
      const browserKey = getBrowserKey();
      fetch('/api/voice-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          browser: browserKey,
          voice: ttsVoiceName,
          speed: ttsSpeed
        })
      })
      .then(r => r.json())
      .then(resData => {
        if (resData && resData.ok) {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({
              type: 'HANA_VOICE_CONFIG_CHANGED',
              config: resData.config
            }, window.location.origin);
          }
        }
      })
      .catch(e => console.error('Failed to save config:', e));
    }

    function populateInjectedVoiceList() {
      const sel = document.getElementById('hana-voice-select-float');
      if (!sel) return;
      const synth = window.speechSynthesis;
      if (!synth) return;
      const list = synth.getVoices();
      sel.innerHTML = '';
      const zh = list.filter(v => /zh/i.test(v.lang));
      const other = list.filter(v => !/zh/i.test(v.lang));
      const sorted = [...zh, ...other];
      sorted.forEach(v => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = v.name + ' (' + v.lang + ')';
        if (v.name === ttsVoiceName) o.selected = true;
        sel.appendChild(o);
      });
      if (ttsVoiceName) {
        const match = list.find(v => v.name === ttsVoiceName);
        if (match) window.selectedVoice = match;
      }
    }

    // Initialise voice configurations
    window.hanaTTSMode = localStorage.getItem('hana_tts_mode') || 'notebook';
    window.setHanaTTSMode(window.hanaTTSMode);
    window.toggleHanaAvatarVisible(localStorage.getItem('hana_avatar_visible') !== '0');
    populateInjectedVoiceList();
    
    const synth = window.speechSynthesis;
    if (synth && synth.onvoiceschanged !== undefined) {
      const orig = synth.onvoiceschanged;
      synth.onvoiceschanged = function() {
        if (typeof orig === 'function') orig();
        populateInjectedVoiceList();
      };
    }

  let lastSetPose = 'headset_idle';

  window.updateAvatarPoseAndDir = function(pose, dir) {
    if (pose) lastSetPose = pose;
    
    const mode = isIframe ? (window.parent.hanaTTSMode || 'notebook') : (window.hanaTTSMode || 'notebook');
    const cleanPose = lastSetPose.replace(/_(left|right)$/, '');
    const mappedPose = mapPoseByMode(cleanPose, mode);

    // Synchronize to parent if inside iframe
    if (isIframe && window.parent && typeof window.parent.updateHanaFloatPose === 'function') {
      window.parent.updateHanaFloatPose(mappedPose);
    }

    const localImg = document.getElementById('hana-float-img');
    if (!localImg) return;

    if (!dir) {
      const widget = document.getElementById('hana-float-widget');
      if (widget) {
        const rect = widget.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        dir = cx < window.innerWidth / 2 ? 'right' : 'left';
      } else {
        dir = 'left';
      }
    }

    const targetSrc = '/raw?path=portal/avatar/hana_' + mappedPose + '_' + dir + '.png';
    const currentSrc = localImg.getAttribute('src');
    if (currentSrc !== targetSrc) {
      const circle = document.getElementById('hana-float-circle');
      if (circle) circle.classList.add('switching');
      setTimeout(() => {
        localImg.setAttribute('src', targetSrc);
        localImg.dataset.pose = mappedPose;
        if (circle) circle.classList.remove('switching');
      }, 150);
    }
  };

  // Setup proxy setters for the old image element to intercept slide frame changes
  if (oldImg) {
    let currentSrc = oldImg.src;
    Object.defineProperty(oldImg, 'src', {
      get() { return currentSrc; },
      set(val) {
        if (!val) return;
        currentSrc = val;
        const match = val.match(/hana_(.+?)(?:_left|_right)?\.png/);
        let pose = match ? match[1] : 'headset_idle';
        window.updateAvatarPoseAndDir(pose);
      },
      configurable: true
    });

    const initialMatch = oldImg.src.match(/hana_(.+?)(?:_left|_right)?\.png/);
    if (initialMatch) {
      oldImg.src = oldImg.src;
    }
  }
}

// Hook window.speechSynthesis.speak to override voice/rate with global settings and change pose
const synth = window.speechSynthesis;
if (synth) {
  const originalSpeak = synth.speak;
  synth.speak = function(utterance) {
    const isIframe = window.parent && window.parent !== window;
    const mode = isIframe ? (window.parent.hanaTTSMode || 'notebook') : (window.hanaTTSMode || 'notebook');
    
    // Check localStorage first
    const savedVoiceName = localStorage.getItem('hana_tts_voice');
    const savedSpeed = parseFloat(localStorage.getItem('hana_tts_speed') || '1.2');
    
    let matchVoice = null;
    if (savedVoiceName) {
      matchVoice = synth.getVoices().find(v => v.name === savedVoiceName);
    }
    if (!matchVoice && isIframe && window.parent && window.parent.selectedVoice) {
      matchVoice = window.parent.selectedVoice;
    }
    if (!matchVoice && window.selectedVoice) {
      matchVoice = window.selectedVoice;
    }
    
    if (matchVoice) {
      utterance.voice = matchVoice;
      utterance.lang = matchVoice.lang;
    }
    
    const speedInput = document.getElementById('voiceSpeed');
    if (speedInput) {
      utterance.rate = parseFloat(speedInput.value || savedSpeed);
    } else {
      utterance.rate = savedSpeed;
    }

    const speakPose = mode === 'mic' ? 'headset_talk' : 'laptop_talk';
    const idlePose = mode === 'mic' ? 'headset_idle' : 'sit_smile';

    const origStart = utterance.onstart;
    utterance.onstart = function() {
      if (window.updateAvatarPoseAndDir) {
        window.updateAvatarPoseAndDir(speakPose);
      }
      if (typeof origStart === 'function') origStart.apply(this, arguments);
    };

    const origEnd = utterance.onend;
    utterance.onend = function() {
      if (window.updateAvatarPoseAndDir) {
        window.updateAvatarPoseAndDir(idlePose);
      }
      if (typeof origEnd === 'function') origEnd.apply(this, arguments);
    };

    const origError = utterance.onerror;
    utterance.onerror = function() {
      if (window.updateAvatarPoseAndDir) {
        window.updateAvatarPoseAndDir(idlePose);
      }
      if (typeof origError === 'function') origError.apply(this, arguments);
    };

    return originalSpeak.call(synth, utterance);
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initHanaUpgrades();
  });
} else {
  initHanaUpgrades();
}

// Fullscreen controls hover show/hide
let controlsTimeout = null;
function showFullscreenControls() {
  const footer = document.querySelector('footer');
  if (!footer) return;
  if (document.body.classList.contains('presentation-mode')) {
    footer.classList.add('visible');
    document.body.style.cursor = 'default';
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      if (document.body.classList.contains('presentation-mode')) {
        footer.classList.remove('visible');
        document.body.style.cursor = 'none';
      }
    }, 2500);
  } else {
    footer.classList.remove('visible');
    document.body.style.cursor = 'default';
  }
}
document.addEventListener('mousemove', showFullscreenControls);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    document.body.style.cursor = 'default';
    const footer = document.querySelector('footer');
    if (footer) footer.classList.remove('visible');
  }
});
})();
