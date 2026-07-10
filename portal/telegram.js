'use strict';
// Telegram 全域指揮控制台
//   C1: outbound sink (scheduler notifications)
//   C2: inbound long-polling + auth whitelist + /bind + read-only cmds + console log
//   C3: sticky context, /use, /here, expose context for web mirror
//   C4: task dispatch — intent classify → inline [確認] → job in workspace
//   C5: console log compression/delete + sendDocument + long-message split
// 機密：token 等存 HARNESS_HOME/global-knowledge/secrets/telegram.json
// 控制台日誌：HARNESS_HOME/global-knowledge/telegram/console.json
// 不用任何 npm 套件（純 Node built-in https）

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// C4: simple task-intent heuristic — true = likely a mutating task
// Matches common zh/en action verbs that imply file/system changes.
const TASK_RE_ZH = /[改修增刪建部執跑寫更移重複]/;
const TASK_RE_EN = /\b(create|modify|edit|delete|deploy|run|exec(?:ute)?|write|update|remove|fix|build|refactor|add|change)\b/i;
function looksLikeTask(text) { return TASK_RE_ZH.test(text) || TASK_RE_EN.test(text); }

class TelegramBot {
  constructor(harnessHome, schedulerManager, opts) {
    opts = opts || {};
    this._harnessHome      = harnessHome;
    this._schedulerManager = schedulerManager;
    this._chatFn           = opts.chatFn || null;          // (text, context, ctx) => Promise<string>
    this._taskFn           = opts.taskFn || null;          // C4: (prompt, workspaceRoot) => Promise<string>
    this._listProjectsFn   = opts.listProjectsFn || null;  // C3: () => [{name, root}]
    this._sttFn            = opts.sttFn || null;            // F5: (audioPath, lang) => Promise<string>
    this._ttsVoiceFn       = opts.ttsVoiceFn || null;      // F5: (text) => Promise<oggPath|null>
    this._voiceLang        = opts.voiceLang || 'zh';       // F5: STT language for inbound voice
    this._meetingsFn       = opts.meetingsFn || null;      // /meeting: (workspaceRoot) => [{meta}]
    this._meetingDetailFn  = opts.meetingDetailFn || null; // /meeting detail: (root, id) => {meta,transcript,summary}

    this._secretsDir  = path.join(harnessHome, 'global-knowledge', 'secrets');
    this._secretsPath = path.join(this._secretsDir, 'telegram.json');
    this._consolePath = path.join(harnessHome, 'global-knowledge', 'telegram', 'console.json');

    this._token             = null;
    this._authorizedChatIds = new Set();
    this._offset            = 0;
    this._polling           = false;
    this._contexts          = {};         // C3: String(chatId) -> { root, label }
    this._pendingConfirms   = new Map();  // C4: key -> { chatId, text, workspaceRoot, label, ts }

    // Generic extension points for optional plugins (no built-in command depends on these).
    //   _extraCallbackHandlers: async (data, chatId, bot) => boolean  — claim an inline-button callback
    //   _extraTextInterceptors: async (chatId, text, bot) => boolean  — claim a plain-text message pre-route
    // A handler returning true means "I handled this" → dispatch/routing stops.
    this._extraCallbackHandlers = [];
    this._extraTextInterceptors = [];

    this._loadConfig();
  }

  // ── Config ───────────────────────────────────────────────────────────────

  _loadConfig() {
    try {
      if (!fs.existsSync(this._secretsPath)) return;
      const cfg = JSON.parse(fs.readFileSync(this._secretsPath, 'utf8'));
      if (cfg.botToken)              this._token = cfg.botToken;
      if (cfg.authorizedChatIds)     this._authorizedChatIds = new Set(cfg.authorizedChatIds);
      if (cfg.pollingOffset != null) this._offset = cfg.pollingOffset;
      if (cfg.contexts && typeof cfg.contexts === 'object') this._contexts = cfg.contexts;
    } catch (e) { console.error('[Telegram] config load error:', e.message); }
  }

  _saveConfig() {
    try {
      fs.mkdirSync(this._secretsDir, { recursive: true });
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(this._secretsPath, 'utf8')); } catch (e) {}
      cfg.authorizedChatIds = [...this._authorizedChatIds];
      cfg.pollingOffset     = this._offset;
      cfg.contexts          = this._contexts;
      fs.writeFileSync(this._secretsPath, JSON.stringify(cfg, null, 2));
    } catch (e) { console.error('[Telegram] config save error:', e.message); }
  }

  isConfigured() { return !!this._token; }

  // The single bound commander chat, for server-side triggers that aren't replying to an
  // inbound update and so have no chatId of their own (same lookup as handleWebMessage's
  // chatId fallback). Used by optional server-initiated flows.
  getPrimaryChatId() {
    return this._authorizedChatIds.size > 0 ? [...this._authorizedChatIds][0] : null;
  }

  getStatus() {
    return {
      configured:      this.isConfigured(),
      polling:         this._polling,
      authorizedCount: this._authorizedChatIds.size,
      offset:          this._offset,
    };
  }

  // C3: sticky context accessors (also consumed by /api/telegram/context)
  getContext(chatId)            { return this._contexts[String(chatId)] || null; }
  getAllContexts()              { return this._contexts; }
  setContext(chatId, root, label) {
    this._contexts[String(chatId)] = { root, label: label || root };
    this._saveConfig();
  }

  // ── Telegram HTTPS API ────────────────────────────────────────────────────

  _apiPost(method, body, socketTimeoutMs) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const reqOpts = {
        hostname: 'api.telegram.org',
        path:     '/bot' + this._token + '/' + method,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      const req = https.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ ok: false }); }
        });
      });
      req.on('error', reject);
      if (socketTimeoutMs) {
        req.setTimeout(socketTimeoutMs, () => {
          req.destroy(new Error('socket timeout after ' + socketTimeoutMs + 'ms'));
        });
      }
      req.write(payload);
      req.end();
    });
  }

  // ── Outbound messages (C1 / C3 / C4 / C5) ────────────────────────────────

  async sendMessage(chatId, text) {
    if (!this._token) return;
    const chunks = this._splitMessage(String(text || ''));
    for (const chunk of chunks) {
      try { await this._apiPost('sendMessage', { chat_id: chatId, text: chunk }); }
      catch (e) { console.error('[Telegram] sendMessage error:', e.message); }
    }
  }

  // C4: send with inline keyboard (single row); keyboard attached only to last chunk
  async sendInlineKeyboard(chatId, text, buttons) {
    if (!this._token) return;
    const chunks = this._splitMessage(String(text || ''));
    for (var i = 0; i < chunks.length; i++) {
      const body = { chat_id: chatId, text: chunks[i] };
      if (i === chunks.length - 1 && buttons && buttons.length) {
        body.reply_markup = { inline_keyboard: [buttons] };
      }
      try { await this._apiPost('sendMessage', body); }
      catch (e) { console.error('[Telegram] sendInlineKeyboard error:', e.message); }
    }
  }

  // C4: send with multi-row inline keyboard; rows = [[{text,callback_data}], ...]
  async sendInlineRows(chatId, text, rows) {
    if (!this._token) return;
    const chunks = this._splitMessage(String(text || ''));
    for (var i = 0; i < chunks.length; i++) {
      const body = { chat_id: chatId, text: chunks[i] };
      if (i === chunks.length - 1 && rows && rows.length) {
        body.reply_markup = { inline_keyboard: rows };
      }
      try { await this._apiPost('sendMessage', body); }
      catch (e) { console.error('[Telegram] sendInlineRows error:', e.message); }
    }
  }

  // C4: acknowledge callback query (prevents Telegram loading spinner from hanging)
  async answerCallbackQuery(callbackQueryId, text) {
    if (!this._token) return;
    try {
      await this._apiPost('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
    } catch (e) { console.error('[Telegram] answerCallbackQuery error:', e.message); }
  }

  // C5: send a file as Telegram document (multipart/form-data, no npm deps)
  async sendDocument(chatId, filename, buffer) {
    if (!this._token) return;
    const boundary = 'TgBoundary' + Date.now();
    const head = [
      '--' + boundary,
      'Content-Disposition: form-data; name="chat_id"',
      '',
      String(chatId),
      '--' + boundary,
      'Content-Disposition: form-data; name="document"; filename="' + filename + '"',
      'Content-Type: application/octet-stream',
      '',
    ].join('\r\n') + '\r\n';
    const tail = '\r\n--' + boundary + '--\r\n';
    const body = Buffer.concat([Buffer.from(head, 'utf8'), buffer, Buffer.from(tail, 'utf8')]);
    return new Promise((resolve) => {
      const opts = {
        hostname: 'api.telegram.org',
        path:     '/bot' + this._token + '/sendDocument',
        method:   'POST',
        headers:  { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
      };
      const req = https.request(opts, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', (e) => { console.error('[Telegram] sendDocument error:', e.message); resolve(); });
      req.write(body); req.end();
    });
  }

  // F5: send a voice note (OGG/Opus) via sendVoice (multipart/form-data, no npm deps)
  async sendVoice(chatId, oggPath) {
    if (!this._token) return;
    let audio;
    try { audio = fs.readFileSync(oggPath); } catch (e) { console.error('[Telegram] sendVoice read error:', e.message); return; }
    const boundary = 'TgVoice' + Date.now();
    const head = [
      '--' + boundary,
      'Content-Disposition: form-data; name="chat_id"',
      '',
      String(chatId),
      '--' + boundary,
      'Content-Disposition: form-data; name="voice"; filename="reply.ogg"',
      'Content-Type: audio/ogg',
      '',
    ].join('\r\n') + '\r\n';
    const tail = '\r\n--' + boundary + '--\r\n';
    const body = Buffer.concat([Buffer.from(head, 'utf8'), audio, Buffer.from(tail, 'utf8')]);
    return new Promise((resolve) => {
      const opts = {
        hostname: 'api.telegram.org',
        path:     '/bot' + this._token + '/sendVoice',
        method:   'POST',
        headers:  { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
      };
      const req = https.request(opts, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', (e) => { console.error('[Telegram] sendVoice error:', e.message); resolve(); });
      req.write(body); req.end();
    });
  }

  async sendToAll(text) {
    if (!this._token) return;
    for (const id of this._authorizedChatIds) { await this.sendMessage(id, text); }
  }

  // C5: split long text into ≤4000-char chunks at newline boundaries
  _splitMessage(text) {
    const MAX = 4000;
    if (text.length <= MAX) return [text];
    const chunks = [];
    while (text.length > 0) {
      let cut = text.lastIndexOf('\n', MAX);
      if (cut <= 0) cut = MAX;
      chunks.push(text.slice(0, cut));
      text = text.slice(cut).replace(/^\n/, '');
    }
    return chunks;
  }

  // ── Sink registration (C1) ────────────────────────────────────────────────

  registerSink() {
    if (!this._schedulerManager) return;
    const self = this;
    this._schedulerManager.sinkManager.register('telegram', function (payload) {
      // Not configured / no recipients → nothing to send; resolve so the run is treated as delivered
      // (the sink only registers when configured, so this is just a defensive no-op, not retry-spam).
      if (!self.isConfigured() || self._authorizedChatIds.size === 0) return Promise.resolve();
      // RETURN the send promise (don't swallow errors). The scheduler awaits this and only marks
      // telegram delivered once Telegram has actually accepted the message. If a deploy-restart aborts
      // the in-flight send, the await never resolves, deliveredSinks isn't updated for telegram, and
      // B4 (flushPendingDeliveries) re-sends it on boot. A send failure rejects → stays undelivered → retried.
      return self.sendToAll(self._formatNotification(payload));
    });
    console.log('[Telegram] sink registered');
  }

  _formatNotification(payload) {
    const icon = payload.status === 'success' ? '✅' : (payload.status === 'failed' ? '❌' : (payload.status === 'blocked' ? '⚠️' : '⏳'));
    let text = icon + ' 排程完成：' + payload.scheduleName + '\n狀態：' + payload.status;
    if (payload.summary) text += '\n摘要：' + payload.summary;
    return text;
  }

  // ── Console log (C2 + C5) ─────────────────────────────────────────────────

  _logConsole(entry) {
    try {
      fs.mkdirSync(path.dirname(this._consolePath), { recursive: true });
      let log = [];
      try { log = JSON.parse(fs.readFileSync(this._consolePath, 'utf8')); } catch (e) {}
      if (!Array.isArray(log)) log = [];
      log.push(Object.assign({ ts: new Date().toISOString() }, entry));
      // C5: auto-compress when > 200 entries; collapse oldest into a sentinel
      if (log.length > 200) {
        const old = log.splice(0, log.length - 100);
        log.unshift({
          ts:         old[old.length - 1].ts,
          role:       'system',
          text:       '[已自動壓縮 ' + old.length + ' 則較舊記錄]',
          compressed: old.length,
        });
      }
      fs.writeFileSync(this._consolePath, JSON.stringify(log, null, 2));
    } catch (e) { console.error('[Telegram] console log error:', e.message); }
  }

  getConsoleLog(limit) {
    try {
      const log = JSON.parse(fs.readFileSync(this._consolePath, 'utf8'));
      return (Array.isArray(log) ? log : []).slice(-(limit || 100));
    } catch (e) { return []; }
  }

  clearConsoleLog() {
    try {
      fs.mkdirSync(path.dirname(this._consolePath), { recursive: true });
      fs.writeFileSync(this._consolePath, JSON.stringify([], null, 2));
      return true;
    } catch (e) { return false; }
  }

  // C5: delete a single log entry by absolute index
  deleteConsoleEntry(idx) {
    try {
      let log = [];
      try { log = JSON.parse(fs.readFileSync(this._consolePath, 'utf8')); } catch (e) {}
      if (!Array.isArray(log) || idx < 0 || idx >= log.length) return false;
      log.splice(idx, 1);
      fs.writeFileSync(this._consolePath, JSON.stringify(log, null, 2));
      return true;
    } catch (e) { return false; }
  }

  // ── Inbound long-polling (C2) ─────────────────────────────────────────────

  start() {
    if (!this.isConfigured()) {
      console.log('[Telegram] no botToken in secrets/telegram.json — polling skipped');
      return;
    }
    this.registerSink();
    this._polling = true;
    this._pollLoop();
    this._registerCommands();   // register the "/" command menu in the Telegram app (fire-and-forget)
    console.log('[Telegram] long-polling started (offset=' + this._offset + ')');
  }

  // Register the bot's slash-command menu so Telegram shows an autocomplete list when typing "/".
  // Fire-and-forget; a failure (e.g. offline) must not block polling. Keep in sync with _cmdHelp.
  async _registerCommands() {
    try {
      await this._apiPost('setMyCommands', {
        commands: [
          { command: 'today',     description: '今天的排程執行記錄' },
          { command: 'schedules', description: '排程清單（目前工作區）' },
          { command: 'status',    description: '系統狀態 + 目前脈絡' },
          { command: 'here',      description: '顯示目前工作區脈絡' },
          { command: 'use',       description: '切換工作區脈絡（/use 專案名）' },
          { command: 'meeting',   description: '查詢今日或指定日期的會議（/meeting 或 /meeting 6/25）' },
          { command: 'clear',     description: '清空控制台日誌' },
          { command: 'delete',    description: '刪除某則日誌（/delete 序號）' },
          { command: 'help',      description: '顯示指令說明' },
        ],
      });
      console.log('[Telegram] slash-command menu registered (setMyCommands)');
    } catch (e) {
      console.error('[Telegram] setMyCommands failed:', e.message);
    }
  }

  stop() {
    this._polling = false;
    console.log('[Telegram] polling stopped');
  }

  _pollLoop() {
    var self = this;
    function loop() {
      if (!self._polling) return;
      // C4: include callback_query in allowed_updates for inline keyboard handling
      self._apiPost(
        'getUpdates',
        { offset: self._offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
        40000
      ).then(function (result) {
        if (result && result.ok && Array.isArray(result.result) && result.result.length > 0) {
          for (var i = 0; i < result.result.length; i++) {
            self._offset = result.result[i].update_id + 1;
            self._handleUpdate(result.result[i]).catch(function (e) {
              console.error('[Telegram] handleUpdate error:', e.message);
            });
          }
          self._saveConfig();
        }
        if (self._polling) setImmediate(loop);
      }).catch(function (e) {
        if (self._polling) {
          console.error('[Telegram] poll error:', e.message);
          setTimeout(loop, 5000);
        }
      });
    }
    setImmediate(loop);
  }

  async _handleUpdate(update) {
    // C4: handle callback_query (inline keyboard button press)
    if (update.callback_query) {
      return this._handleCallbackQuery(update.callback_query);
    }

    const msg = update.message;
    if (!msg) return;

    // C6: handle photo or image-type document (no text required)
    const hasPhoto    = Array.isArray(msg.photo) && msg.photo.length > 0;
    const hasImageDoc = msg.document && msg.document.mime_type &&
                        msg.document.mime_type.startsWith('image/');
    if (hasPhoto || hasImageDoc) return this._handlePhoto(msg);

    // F5: handle voice note / audio (no text required) → STT → Hana → voice reply
    const hasVoice    = msg.voice || (msg.audio && msg.audio.file_id);
    const hasAudioDoc = msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('audio/');
    if (hasVoice || hasAudioDoc) return this._handleVoice(msg);

    if (!msg.text) return;
    const chatId = msg.chat.id;
    const text   = msg.text.trim();

    // /bind must be processed before auth check (needed for initial pairing)
    if (text === '/bind') return this._handleBind(chatId);

    // Authorization: silently ignore unknown chats
    if (!this._authorizedChatIds.has(chatId)) {
      console.log('[Telegram] unauthorized from chat_id=' + chatId + ' (ignored)');
      return;
    }

    this._logConsole({ role: 'user', chatId, text });

    // Generic extension point: optional plugins get first claim on a plain-text message
    // (e.g. a multi-step flow awaiting the user's next reply) before normal routing.
    // A slash command is left for the plugin to decide (it may treat "/" as an escape).
    for (const h of this._extraTextInterceptors) {
      try { if (await h(chatId, text, this)) return; }
      catch (e) { console.error('[Telegram] extra text interceptor error:', e.message); }
    }

    try {
      await this._route(chatId, text);
    } catch (e) {
      console.error('[Telegram] route error:', e.message);
      await this.sendMessage(chatId, '⚠️ 處理時發生錯誤：' + String(e.message).slice(0, 200));
    }
  }

  // C6: handle inbound photo or image document
  async _handlePhoto(msg) {
    const chatId = msg.chat.id;
    if (!this._authorizedChatIds.has(chatId)) {
      console.log('[Telegram] unauthorized photo from chat_id=' + chatId + ' (ignored)');
      return;
    }

    // Pick file_id: photo array (largest = last element) or image document
    var fileId, origExt;
    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      fileId  = msg.photo[msg.photo.length - 1].file_id;
      origExt = '.jpg';
    } else {
      fileId  = msg.document.file_id;
      var dn  = msg.document.file_name || '';
      origExt = dn.includes('.') ? dn.slice(dn.lastIndexOf('.')) : '.jpg';
    }

    const filename = 'tg_' + Date.now() + origExt;
    const caption  = (msg.caption || '').trim();

    this._logConsole({ role: 'user', chatId,
      text: '[圖片] ' + filename + (caption ? ' — ' + caption : ''),
      imageFilename: filename });

    await this.sendMessage(chatId, '📥 收到圖片，正在下載...');

    // Resolve Telegram file_path via getFile
    var fileRes;
    try {
      fileRes = await this._apiPost('getFile', { file_id: fileId });
      if (!fileRes.ok || !fileRes.result || !fileRes.result.file_path) {
        throw new Error('getFile 回傳失敗');
      }
    } catch (e) {
      console.error('[Telegram] getFile error:', e.message);
      await this.sendMessage(chatId, '⚠️ 無法取得圖片資訊：' + e.message.slice(0, 200));
      return;
    }

    const tgFilePath = fileRes.result.file_path;
    const imagesDir  = path.join(this._harnessHome, 'global-knowledge', 'telegram', 'images');
    try { fs.mkdirSync(imagesDir, { recursive: true }); } catch (e) {}
    const localPath = path.join(imagesDir, filename);

    try {
      await this._downloadTelegramFile(tgFilePath, localPath);
    } catch (e) {
      console.error('[Telegram] download error:', e.message);
      await this.sendMessage(chatId, '⚠️ 圖片下載失敗：' + e.message.slice(0, 200));
      return;
    }

    this._logConsole({ role: 'system', chatId, text: '[圖片已儲存] ' + localPath });

    // Build route text: inject local path so chatFn/taskFn can read the image
    const imageNote = '指揮官附了截圖，路徑：' + localPath + '（請用 Read 工具讀取後再回答）';
    const routeText = caption ? imageNote + '\n指揮官說：' + caption : imageNote;

    try {
      await this._route(chatId, routeText);
    } catch (e) {
      console.error('[Telegram] photo route error:', e.message);
      await this.sendMessage(chatId, '⚠️ 處理圖片時發生錯誤：' + e.message.slice(0, 200));
    }
  }

  // F5: handle inbound voice note → download → STT (stt.py) → Hana → text + voice reply
  async _handleVoice(msg) {
    const chatId = msg.chat.id;
    if (!this._authorizedChatIds.has(chatId)) {
      console.log('[Telegram] unauthorized voice from chat_id=' + chatId + ' (ignored)');
      return;
    }
    const media = msg.voice || msg.audio || msg.document;
    const fileId = media && media.file_id;
    if (!fileId) return;
    this._logConsole({ role: 'user', chatId, text: '[語音訊息]' });

    if (!this._sttFn) { await this.sendMessage(chatId, '⚠️ 語音辨識未設定，無法處理語音。'); return; }

    // Resolve + download the .ogg from Telegram's CDN
    let fileRes;
    try { fileRes = await this._apiPost('getFile', { file_id: fileId }); }
    catch (e) { await this.sendMessage(chatId, '⚠️ 無法取得語音檔：' + String(e.message).slice(0, 150)); return; }
    if (!fileRes || !fileRes.ok || !fileRes.result || !fileRes.result.file_path) {
      await this.sendMessage(chatId, '⚠️ 無法取得語音檔資訊。'); return;
    }
    const voiceDir = path.join(this._harnessHome, 'global-knowledge', 'telegram', 'voice');
    try { fs.mkdirSync(voiceDir, { recursive: true }); } catch (e) {}
    const localPath = path.join(voiceDir, 'tg_voice_' + Date.now() + '.ogg');
    try { await this._downloadTelegramFile(fileRes.result.file_path, localPath); }
    catch (e) { await this.sendMessage(chatId, '⚠️ 語音下載失敗：' + String(e.message).slice(0, 150)); return; }

    // STT (server Whisper via stt.py)
    let text = '';
    try { text = await this._sttFn(localPath, this._voiceLang); }
    catch (e) { await this.sendMessage(chatId, '⚠️ 語音辨識失敗：' + String(e.message).slice(0, 150)); return; }
    finally { try { fs.unlinkSync(localPath); } catch (e) {} }

    if (!text || !text.trim()) { await this.sendMessage(chatId, '🤔 沒聽清楚，請再說一次。'); return; }
    this._logConsole({ role: 'user', chatId, text: '🎙️ ' + text });
    await this.sendMessage(chatId, '🎙️ 聽到：' + text);

    // Mutating request → existing confirm flow (text only). Conversational → reply text + voice.
    if (looksLikeTask(text)) return this._confirmTask(chatId, text);
    if (!this._chatFn) return;
    try {
      const reply = await this._chatFn(text, this.getConsoleLog(10), this.getContext(chatId));
      const safe = String(reply || '（無回應）');
      this._logConsole({ role: 'bot', chatId, text: safe });
      await this.sendMessage(chatId, safe);
      // Voice reply (edge-tts → ogg/opus). Best-effort: a TTS failure still leaves the text reply.
      if (this._ttsVoiceFn) {
        try {
          const oggPath = await this._ttsVoiceFn(safe.slice(0, 600));
          if (oggPath) { await this.sendVoice(chatId, oggPath); try { fs.unlinkSync(oggPath); } catch (e) {} }
        } catch (e) { console.error('[Telegram] voice reply error:', e.message); }
      }
    } catch (e) {
      await this.sendMessage(chatId, '⚠️ 回覆失敗：' + String(e.message).slice(0, 150));
    }
  }

  // Download a file from Telegram's CDN (GET /file/bot<token>/<file_path>)
  _downloadTelegramFile(tgFilePath, localPath) {
    var token = this._token;
    return new Promise(function (resolve, reject) {
      var opts = {
        hostname: 'api.telegram.org',
        path:     '/file/bot' + token + '/' + tgFilePath,
        method:   'GET',
      };
      var req = https.request(opts, function (res) {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        var chunks = [];
        res.on('data', function (d) { chunks.push(d); });
        res.on('end',  function () {
          try { fs.writeFileSync(localPath, Buffer.concat(chunks)); resolve(); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  // C4: handle inline keyboard button presses
  async _handleCallbackQuery(cq) {
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const data   = cq.data || '';
    // Always ack to remove Telegram loading state
    await this.answerCallbackQuery(cq.id, '收到！');
    if (!chatId || !this._authorizedChatIds.has(chatId)) return;

    // Generic extension point: optional plugins get first claim on the callback.
    for (const h of this._extraCallbackHandlers) {
      try { if (await h(data, chatId, this)) return; }
      catch (e) { console.error('[Telegram] extra callback handler error:', e.message); }
    }

    if (data.startsWith('confirm:')) {
      const key     = data.slice('confirm:'.length);
      const pending = this._pendingConfirms.get(key);
      if (!pending) {
        await this.sendMessage(chatId, '⚠️ 確認已逾時或找不到。請重新發送指令。');
        return;
      }
      this._pendingConfirms.delete(key);
      await this._executeTask(chatId, pending.text, pending.workspaceRoot, pending.label);

    } else if (data.startsWith('cancel:')) {
      const key = data.slice('cancel:'.length);
      this._pendingConfirms.delete(key);
      await this.sendMessage(chatId, '❌ 已取消。');

    } else if (data.startsWith('use:')) {
      // C3: workspace picker selection
      const root     = data.slice('use:'.length);
      const projects = this._listProjectsFn ? this._listProjectsFn() : [];
      const proj     = projects.find(function (p) { return p.root === root; });
      const label    = proj ? (proj.name || path.basename(root)) : path.basename(root);
      this.setContext(chatId, root, label);
      this._logConsole({ role: 'bot', chatId, text: '已切換至 ' + label });
      await this.sendMessage(chatId, '📍 目前脈絡切換至：' + label + '\n(' + root + ')');

    } else if (data.startsWith('meeting:')) {
      // /meeting — view meeting detail
      const meetingId = data.slice('meeting:'.length);
      await this._sendMeetingDetail(chatId, meetingId);
    }
  }

  // C4: execute a confirmed task in the target workspace
  async _executeTask(chatId, text, workspaceRoot, label) {
    const displayLabel = label || (workspaceRoot ? path.basename(workspaceRoot) : '預設');
    await this.sendMessage(chatId, '⚙️ 開始在「' + displayLabel + '」執行任務...');
    this._logConsole({ role: 'system', chatId, text: '[開始任務] 標的:' + displayLabel + ' | ' + text.slice(0, 200) });

    if (!this._taskFn) {
      const reply = '⚠️ taskFn 未設定，無法執行任務（請聯絡系統管理員）。';
      this._logConsole({ role: 'bot', chatId, text: reply });
      await this.sendMessage(chatId, reply);
      return;
    }

    try {
      const result = await this._taskFn(text, workspaceRoot);
      const safe   = String(result || '（完成，無輸出）');
      this._logConsole({ role: 'bot', chatId, text: '[任務完成] ' + safe.slice(0, 300) });
      await this.sendMessage(chatId, '✅ 任務完成 @ ' + displayLabel + '\n\n' + safe.slice(0, 3500));
    } catch (e) {
      const reply = '❌ 任務執行失敗：' + String(e.message).slice(0, 300);
      this._logConsole({ role: 'bot', chatId, text: reply });
      await this.sendMessage(chatId, reply);
    }
  }

  // ── /bind: one-time pairing (C2) ─────────────────────────────────────────

  async _handleBind(chatId) {
    try {
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(this._secretsPath, 'utf8')); } catch (e) {}
      const pendingUntil = cfg.bindPendingUntil ? new Date(cfg.bindPendingUntil) : null;
      if (pendingUntil && new Date() < pendingUntil) {
        this._authorizedChatIds.add(chatId);
        cfg.authorizedChatIds = [...this._authorizedChatIds];
        cfg.pollingOffset     = this._offset;
        cfg.bindPendingUntil  = null;
        fs.writeFileSync(this._secretsPath, JSON.stringify(cfg, null, 2));
        await this.sendMessage(chatId,
          '✅ 綁定成功！此 chat 已加入授權白名單。\n歡迎使用 Hana 全域指揮控制台。\n\n' +
          '指令：/today /schedules /status /here /use /clear /help'
        );
        console.log('[Telegram] chat_id=' + chatId + ' bound and authorized');
      } else {
        // No active bind window — silently ignore
        console.log('[Telegram] /bind from chat_id=' + chatId + ' — no active bind window');
      }
    } catch (e) { console.error('[Telegram] bind handler error:', e.message); }
  }

  openBindWindow(minutes) {
    try {
      fs.mkdirSync(this._secretsDir, { recursive: true });
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(this._secretsPath, 'utf8')); } catch (e) {}
      const expiresAt = new Date(Date.now() + (minutes || 10) * 60000).toISOString();
      cfg.bindPendingUntil = expiresAt;
      fs.writeFileSync(this._secretsPath, JSON.stringify(cfg, null, 2));
      console.log('[Telegram] bind window opened until ' + expiresAt);
      return expiresAt;
    } catch (e) {
      console.error('[Telegram] openBindWindow error:', e.message);
      return null;
    }
  }

  // ── Message routing (C2 + C3 + C5) ──────────────────────────────────────

  async _route(chatId, text) {
    const parts = text.split(/\s+/);
    const cmd   = parts[0].toLowerCase();
    if (cmd === '/today')     return this._cmdToday(chatId);
    if (cmd === '/schedules') return this._cmdSchedules(chatId);
    if (cmd === '/status')    return this._cmdStatus(chatId);
    if (cmd === '/here')      return this._cmdHere(chatId);
    if (cmd === '/use')       return this._cmdUse(chatId, parts.slice(1).join(' '));
    if (cmd === '/meeting')   return this._cmdMeeting(chatId, parts.slice(1).join(' '));
    if (cmd === '/clear')     return this._cmdClear(chatId);
    if (cmd === '/delete')    return this._cmdDelete(chatId, parts[1]);
    if (cmd === '/help')      return this._cmdHelp(chatId);
    return this._chat(chatId, text);
  }

  // /meeting [date] — list meetings for the current workspace context on a given date
  async _cmdMeeting(chatId, arg) {
    const ctx = this.getContext(chatId);
    const workspaceRoot = (ctx && ctx.root) || this._harnessHome;
    const label = ctx ? ctx.label : path.basename(workspaceRoot);

    // Parse date: "6/25", "06/25", "2026/6/25", "2026-06-25", or default today
    const today = new Date().toISOString().slice(0, 10);
    var dateStr = today;
    var raw = (arg || '').trim();
    if (raw) {
      var m1 = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
      var m2 = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
      if (m1) {
        dateStr = new Date().getFullYear() + '-' +
          String(parseInt(m1[1], 10)).padStart(2, '0') + '-' +
          String(parseInt(m1[2], 10)).padStart(2, '0');
      } else if (m2) {
        dateStr = m2[1] + '-' + String(parseInt(m2[2], 10)).padStart(2, '0') + '-' +
          String(parseInt(m2[3], 10)).padStart(2, '0');
      }
    }

    if (!this._meetingsFn) {
      return this.sendMessage(chatId, '⚠️ meetingsFn 未設定，無法查詢會議。');
    }

    var meetings = [];
    try { meetings = this._meetingsFn(workspaceRoot); } catch (e) {
      return this.sendMessage(chatId, '⚠️ 查詢會議失敗：' + e.message);
    }

    var filtered = meetings.filter(function (m) { return (m.startedAt || '').startsWith(dateStr); });

    if (!filtered.length) {
      var noReply = '📅 ' + dateStr + '（' + label + '）沒有會議記錄。';
      this._logConsole({ role: 'bot', chatId, text: noReply });
      return this.sendMessage(chatId, noReply);
    }

    var header = '📅 ' + dateStr + '（' + label + '）有 ' + filtered.length + ' 場會議，點選查看：';
    var rows = filtered.slice(0, 10).map(function (m) {
      var timeStr = (m.startedAt || '').slice(11, 16);
      var icon = m.status === 'done' ? '✅' : (m.status === 'recording' ? '🔴' : '•');
      var title = (m.title || m.meetingId || '未命名').slice(0, 30);
      return [{ text: icon + ' ' + timeStr + ' ' + title, callback_data: 'meeting:' + m.meetingId }];
    });

    this._logConsole({ role: 'bot', chatId, text: header });
    return this.sendInlineRows(chatId, header, rows);
  }

  // Send detailed meeting content (transcript + summary) to chat
  async _sendMeetingDetail(chatId, meetingId) {
    if (!this._meetingDetailFn) {
      return this.sendMessage(chatId, '⚠️ meetingDetailFn 未設定。');
    }
    const ctx = this.getContext(chatId);
    const workspaceRoot = (ctx && ctx.root) || this._harnessHome;
    try {
      const detail = this._meetingDetailFn(workspaceRoot, meetingId);
      const meta = detail.meta || {};
      const title = meta.title || meetingId;
      const timeStr = (meta.startedAt || '').slice(0, 16).replace('T', ' ');
      var reply = '📋 ' + title + '\n🕐 ' + timeStr;
      if (meta.status) reply += '　' + meta.status;
      reply += '\n\n';
      if (detail.summary) {
        reply += '── 摘要 ──\n' + detail.summary.slice(0, 1800) +
          (detail.summary.length > 1800 ? '\n…（已截斷）' : '');
      } else if (detail.transcript) {
        reply += '── 逐字稿 ──\n' + detail.transcript.slice(0, 2000) +
          (detail.transcript.length > 2000 ? '\n…（已截斷）' : '');
      } else {
        reply += '（無逐字稿或摘要）';
      }
      this._logConsole({ role: 'bot', chatId, text: '[會議詳情] ' + title });
      return this.sendMessage(chatId, reply);
    } catch (e) {
      return this.sendMessage(chatId, '⚠️ 讀取會議失敗：' + e.message);
    }
  }

  async _cmdToday(chatId) {
    const sm = this._schedulerManager;
    if (!sm) return this.sendMessage(chatId, '排程系統不可用。');
    const today = new Date().toISOString().slice(0, 10);
    let runs = sm.queryRuns({ since: today + 'T00:00:00.000Z' });
    // Scope to the chat's workspace context (map run.scheduleId → schedule.workspace).
    const ctx = this.getContext(chatId);
    let scope;
    if (ctx && ctx.root) {
      const active = this._normWs(ctx.root);
      const wsMap = {};
      sm.loadSchedules().forEach(s => { wsMap[s.id] = s.workspace; });
      runs = runs.filter(r => this._normWs(wsMap[r.scheduleId]) === active);
      scope = '（' + ctx.label + '）';
    } else {
      scope = '（全部工作區・未設定脈絡）';
    }
    let reply;
    if (!runs.length) {
      reply = '今天' + scope + '還沒有排程任務執行。';
    } else {
      const lines = runs.map(function (r) {
        const icon = r.status === 'success' ? '✅' : (r.status === 'failed' ? '❌' : (r.status === 'blocked' ? '⚠️' : '⏳'));
        const t = (r.startedAt || '').slice(0, 16).replace('T', ' ');
        return icon + ' ' + (r.scheduleId || '').slice(0, 20) + ' — ' + r.status + ' @ ' + t;
      });
      reply = '📅 今天的執行記錄 ' + scope + '（' + runs.length + ' 筆）：\n' + lines.join('\n');
    }
    this._logConsole({ role: 'bot', chatId, text: reply });
    return this.sendMessage(chatId, reply);
  }

  // Normalise a workspace path for comparison (collapse doubled separators, lowercase).
  _normWs(p) { try { return path.resolve(String(p || '')).toLowerCase(); } catch (e) { return ''; } }

  async _cmdSchedules(chatId) {
    const sm = this._schedulerManager;
    if (!sm) return this.sendMessage(chatId, '排程系統不可用。');
    const ctx = this.getContext(chatId);
    let list = sm.loadSchedules();
    let scope;
    if (ctx && ctx.root) {
      const active = this._normWs(ctx.root);
      list = list.filter(s => this._normWs(s.workspace) === active);
      scope = '（' + ctx.label + '）';
    } else {
      scope = '（全部工作區・未設定脈絡，用 /use 切換）';
    }
    let reply;
    if (!list.length) {
      reply = '目前' + scope + '沒有設定任何排程。';
    } else {
      const lines = list.map(function (s) {
        const icon = s.enabled ? '🟢' : '⚫';
        const next = s.nextRunAt ? s.nextRunAt.slice(0, 16).replace('T', ' ') : '無';
        return icon + ' ' + s.name + '\n  下次：' + next + ' | 模型：' + (s.model || '?');
      });
      reply = '📅 排程清單 ' + scope + '（' + list.length + ' 個）：\n\n' + lines.join('\n\n');
    }
    this._logConsole({ role: 'bot', chatId, text: reply });
    return this.sendMessage(chatId, reply);
  }

  async _cmdStatus(chatId) {
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const sm = this._schedulerManager;
    const ctx  = this.getContext(chatId);
    let sched = sm ? sm.loadSchedules() : [];
    if (ctx && ctx.root) { const active = this._normWs(ctx.root); sched = sched.filter(s => this._normWs(s.workspace) === active); }
    const schedCount  = sm ? sched.length : '?';
    const activeCount = sm ? sched.filter(function (s) { return s.enabled; }).length : '?';
    const reply = [
      '🤖 Hana Harness 狀態',
      '運行時間：' + h + 'h ' + m + 'm',
      '記憶體：' + mem + ' MB',
      'PID：' + process.pid,
      '排程：' + activeCount + ' 啟用 / ' + schedCount + ' 總計',
      'Telegram：已連接 (' + this._authorizedChatIds.size + ' 授權)',
      '目前脈絡：' + (ctx ? ctx.label : '未設定（用 /use 切換）'),
    ].join('\n');
    this._logConsole({ role: 'bot', chatId, text: reply });
    return this.sendMessage(chatId, reply);
  }

  async _cmdHere(chatId) {
    const ctx = this.getContext(chatId);
    let reply;
    if (ctx) {
      reply = '📍 目前脈絡：' + ctx.label + '\n路徑：' + ctx.root + '\n\n用 /use <專案名> 切換';
    } else {
      reply = '📍 目前脈絡：未設定\n\n用 /use <專案名> 設定，或發任務時從清單選擇。';
    }
    this._logConsole({ role: 'bot', chatId, text: reply });
    return this.sendMessage(chatId, reply);
  }

  // C3: /use [project] — set sticky workspace context
  async _cmdUse(chatId, arg) {
    const argTrim = (arg || '').trim();
    if (!argTrim) return this._showProjectPicker(chatId, '請選擇目標工作區：');
    const projects = this._listProjectsFn ? this._listProjectsFn() : [];
    const q = argTrim.toLowerCase();
    const match = projects.find(function (p) {
      return (p.name || '').toLowerCase().includes(q)
          || path.basename(p.root || '').toLowerCase().includes(q)
          || (p.root || '').toLowerCase().includes(q);
    });
    if (!match) return this._showProjectPicker(chatId, '找不到「' + argTrim + '」，請從清單選擇：');
    const label = match.name || path.basename(match.root);
    this.setContext(chatId, match.root, label);
    const reply = '📍 已切換至：' + label + '\n路徑：' + match.root;
    this._logConsole({ role: 'bot', chatId, text: reply });
    return this.sendMessage(chatId, reply);
  }

  // C3: show project picker as inline keyboard rows
  async _showProjectPicker(chatId, prompt) {
    const projects = this._listProjectsFn ? this._listProjectsFn() : [];
    if (!projects.length) return this.sendMessage(chatId, '目前沒有已知的工作區。');
    const buttons = projects.slice(0, 12).map(function (p) {
      return { text: (p.name || path.basename(p.root || '')).slice(0, 30), callback_data: 'use:' + p.root };
    });
    const rows = [];
    for (var i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    try {
      await this._apiPost('sendMessage', { chat_id: chatId, text: prompt || '請選擇工作區：', reply_markup: { inline_keyboard: rows } });
    } catch (e) { console.error('[Telegram] showProjectPicker error:', e.message); }
  }

  async _cmdClear(chatId) {
    const ok    = this.clearConsoleLog();
    const reply = ok ? '✅ 控制台日誌已清空。' : '⚠️ 清空失敗，請稍後再試。';
    return this.sendMessage(chatId, reply);
  }

  // C5: /delete <n>
  async _cmdDelete(chatId, idxStr) {
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx)) return this.sendMessage(chatId, '用法：/delete <序號>');
    const ok    = this.deleteConsoleEntry(idx);
    const reply = ok ? '✅ 已刪除第 ' + idx + ' 則記錄。' : '⚠️ 找不到序號 ' + idx + ' 的記錄。';
    return this.sendMessage(chatId, reply);
  }

  async _cmdHelp(chatId) {
    const reply = [
      '🤖 Hana 指揮控制台指令：',
      '/today — 今天的排程執行記錄',
      '/schedules — 排程清單',
      '/status — 系統狀態 + 目前脈絡',
      '/here — 目前脈絡',
      '/use [專案名] — 切換目前脈絡',
      '/meeting [日期] — 查詢當日或指定日期的會議',
      '/clear — 清空控制台日誌',
      '/delete <序號> — 刪除某則日誌',
      '/help — 顯示此說明',
      '',
      '直接發送文字：',
      '• 問答 / 唯讀 → 直接回應',
      '• 改檔 / 執行 → 確認後再派工',
    ].join('\n');
    return this.sendMessage(chatId, reply);
  }

  // ── Chat + C4 intent routing ──────────────────────────────────────────────

  async _chat(chatId, text) {
    // C4: classify — mutating task → confirm flow; otherwise → direct chat
    if (looksLikeTask(text)) return this._confirmTask(chatId, text);

    if (!this._chatFn) {
      const reply = '（chatFn 未設定，無法回覆）';
      this._logConsole({ role: 'bot', chatId, text: reply });
      return this.sendMessage(chatId, reply);
    }
    try {
      const context = this.getConsoleLog(10);
      const ctx     = this.getContext(chatId);
      const reply   = await this._chatFn(text, context, ctx);
      const safe    = String(reply || '（無回應）');
      this._logConsole({ role: 'bot', chatId, text: safe });
      return this.sendMessage(chatId, safe);
    } catch (e) {
      const reply = '⚠️ 聊天回覆失敗：' + String(e.message).slice(0, 200);
      this._logConsole({ role: 'bot', chatId, text: reply });
      return this.sendMessage(chatId, reply);
    }
  }

  // C4: ask for confirmation before executing a mutating task
  async _confirmTask(chatId, text) {
    let ctx = this.getContext(chatId);

    // No sticky context — try to infer workspace from text, then ask
    if (!ctx) {
      const inferred = this._inferWorkspace(text);
      if (!inferred) {
        this._logConsole({ role: 'bot', chatId, text: '[需先選工作區]' });
        await this._showProjectPicker(chatId, '這個任務需要知道目標工作區，請選擇：');
        await this.sendMessage(chatId, '選好工作區後，請重新發送您的指令。');
        return;
      }
      this.setContext(chatId, inferred.root, inferred.label);
      ctx = this.getContext(chatId);
    }

    const key = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this._pendingConfirms.set(key, { chatId, text, workspaceRoot: ctx.root, label: ctx.label, ts: Date.now() });

    // Evict confirms older than 5 minutes
    const now = Date.now();
    for (const [k, v] of this._pendingConfirms) {
      if (now - v.ts > 300000) this._pendingConfirms.delete(k);
    }

    const prompt = '📋 準備在「' + ctx.label + '」執行：\n\n' + text.slice(0, 500) + '\n\n確認？';
    this._logConsole({ role: 'bot', chatId, text: prompt });
    return this.sendInlineKeyboard(chatId, prompt, [
      { text: '✅ 確認執行', callback_data: 'confirm:' + key },
      { text: '❌ 取消',     callback_data: 'cancel:'  + key },
    ]);
  }

  // C4: infer workspace from project name mentioned in text
  _inferWorkspace(text) {
    const projects = this._listProjectsFn ? this._listProjectsFn() : [];
    const lower = text.toLowerCase();
    for (var i = 0; i < projects.length; i++) {
      const p    = projects[i];
      const name = (p.name || path.basename(p.root || '')).toLowerCase();
      if (name && lower.includes(name)) return { root: p.root, label: p.name || path.basename(p.root) };
    }
    return null;
  }

  // C3: trusted inbound from web portal console (no auth check — web = local = you)
  async handleWebMessage(text) {
    const chatId = this._authorizedChatIds.size > 0 ? [...this._authorizedChatIds][0] : 0;
    this._logConsole({ role: 'user', source: 'web', chatId: chatId || 'web', text });
    try {
      await this._route(chatId, text);
    } catch (e) {
      const reply = '⚠️ 處理時發生錯誤：' + String(e.message).slice(0, 200);
      this._logConsole({ role: 'bot', chatId: chatId || 'web', text: reply });
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

function createTelegramBot(harnessHome, schedulerManager, opts) {
  return new TelegramBot(harnessHome, schedulerManager, opts);
}

module.exports = { createTelegramBot, TelegramBot };
