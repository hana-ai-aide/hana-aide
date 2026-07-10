'use strict';
const fs = require('fs');
const path = require('path');

// Validate and normalise delivery sinks. Unknown sinks are stripped; empty/missing → default.
const _DELIVERY_VALID = ['web', 'telegram'];
function _normalizeDelivery(d) {
  const arr = Array.isArray(d) ? [...new Set(d.filter(s => _DELIVERY_VALID.includes(s)))] : null;
  return (arr && arr.length) ? arr : ['web', 'telegram'];
}

// ── SinkManager — pluggable delivery abstraction ──────────────────────────
// Run 完成時把摘要+連結投到各 sink（web / telegram / …）。
// 要接 Telegram（§C）只需：schedulerManager.sinkManager.register('telegram', fn)
class SinkManager {
  constructor() { this._sinks = new Map(); }
  register(name, fn) { this._sinks.set(name, fn); }
  has(name) { return this._sinks.has(name); }
  deliver(sinkNames, payload) {
    const names = (Array.isArray(sinkNames) && sinkNames.length) ? sinkNames : ['web'];
    for (const name of names) this.deliverOne(name, payload);
  }
  // Deliver to ONE sink; resolves true only if a sink fn exists AND its send completed without
  // throwing/rejecting — so the caller can mark that sink delivered (B4 per-sink idempotency).
  // AWAITs the fn so async sinks (telegram: a network send) are only counted delivered once the
  // send actually finished — a fire-and-forget send aborted by a deploy-restart resolves false here
  // and stays pending. Unregistered sink → false (e.g. telegram before §C wires it in).
  async deliverOne(name, payload) {
    const fn = this._sinks.get(name);
    if (!fn) return false;
    try { await fn(payload); return true; }
    catch (e) { console.error('[Sink:' + name + '] delivery error:', e.message); return false; }
  }
}

// ── Minimal 5-field cron field parser ────────────────────────────────────
// Supported: number, *, */N
function parseCronField(expr, min, max) {
  if (expr === '*') {
    const r = []; for (let i = min; i <= max; i++) r.push(i); return r;
  }
  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2), 10);
    if (!step || step <= 0) return [min];
    const r = []; for (let i = min; i <= max; i += step) r.push(i); return r;
  }
  const v = parseInt(expr, 10);
  if (!isNaN(v) && v >= min && v <= max) return [v];
  return [min];
}

// Returns the next Date after `after` matching the 5-field cron expr, or null.
function cronNextAfter(expr, after) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const mins   = parseCronField(parts[0], 0, 59);
  const hours  = parseCronField(parts[1], 0, 23);
  const doms   = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const dows   = parseCronField(parts[4], 0, 6);

  // Advance 1 minute past 'after' and start checking
  let d = new Date(after);
  d.setSeconds(0, 0);
  d = new Date(d.getTime() + 60000);

  const MAX_ITER = 366 * 24 * 60; // at most 1 year of minutes
  for (let i = 0; i < MAX_ITER; i++, d = new Date(d.getTime() + 60000)) {
    if (months.includes(d.getMonth() + 1) &&
        doms.includes(d.getDate()) &&
        dows.includes(d.getDay()) &&
        hours.includes(d.getHours()) &&
        mins.includes(d.getMinutes())) {
      return d;
    }
  }
  return null;
}

function computeNextRunAt(trigger, from) {
  const base = from || new Date();
  if (!trigger) return null;
  if (trigger.type === 'once') {
    // accept common field-name variants — agents writing the schedule via the API often guess
    // `at`/`atUTC` instead of the canonical `atISO`; treat them all the same (else nextRunAt=null silently).
    const t = new Date(trigger.atISO || trigger.at || trigger.atUTC || trigger.datetime);
    return isNaN(t.getTime()) || t <= base ? null : t;
  }
  if (trigger.type === 'interval') {
    const ms = trigger.intervalMs || trigger.everyMs ||
      (trigger.minutes ? trigger.minutes * 60000 : 0) || (trigger.seconds ? trigger.seconds * 1000 : 0) || 3600000;
    return new Date(base.getTime() + ms);
  }
  if (trigger.type === 'cron') {
    return cronNextAfter(trigger.expr || trigger.cron || trigger.expression || '0 * * * *', base);
  }
  return null;
}

// ── SchedulerManager ─────────────────────────────────────────────────────

class SchedulerManager {
  constructor(harnessHome) {
    this.harnessHome        = harnessHome;
    this.schedulesDir       = path.join(harnessHome, 'global-knowledge', 'schedules');
    this.schedulesPath      = path.join(this.schedulesDir, 'schedules.json');
    this.runsDir            = path.join(this.schedulesDir, 'runs');
    this.notificationsPath  = path.join(this.schedulesDir, 'notifications.json');
    this.sinkManager        = new SinkManager();
    this._fireJob           = null;
    this._timer             = null;
    this._ensure();
  }

  _ensure() {
    try {
      fs.mkdirSync(this.schedulesDir, { recursive: true });
      fs.mkdirSync(this.runsDir,      { recursive: true });
      if (!fs.existsSync(this.schedulesPath))
        fs.writeFileSync(this.schedulesPath, JSON.stringify([], null, 2));
    } catch (e) { console.error('[Scheduler] init error:', e.message); }
  }

  // ── Schedule CRUD ──────────────────────────────────────────────────────

  loadSchedules() {
    try { return JSON.parse(fs.readFileSync(this.schedulesPath, 'utf8')); }
    catch (e) { return []; }
  }

  saveSchedules(list) {
    fs.writeFileSync(this.schedulesPath, JSON.stringify(list, null, 2));
  }

  getSchedule(id) {
    return this.loadSchedules().find(s => s.id === id) || null;
  }

  createSchedule(data) {
    const list = this.loadSchedules();
    const now  = new Date();
    const s = {
      id:        'sched_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name:      data.name      || '未命名排程',
      enabled:   data.enabled   !== false,
      trigger:   data.trigger   || { type: 'cron', expr: '0 * * * *' },
      task:      data.task      || { kind: 'prompt', prompt: '' },
      model:     data.model     || 'claude::sonnet',
      workspace: data.workspace || null,
      guardrails: Object.assign(
        { maxCalls: 100, maxRuntimeMs: 300000, maxResumes: 3, failureBreakAfter: 3 },
        data.guardrails || {}
      ),
      delivery:           _normalizeDelivery(data.delivery),
      createdAt:          now.toISOString(),
      nextRunAt:          null,
      lastRunAt:          null,
      lastRunStatus:      null,
      consecutiveFailures: 0,
      archived:           false,   // 歸檔後移到「歷史」、不再現役（執行完的 once 排程可手動歸檔）
    };
    s.nextRunAt = s.enabled
      ? (computeNextRunAt(s.trigger, now)?.toISOString() || null)
      : null;
    list.push(s);
    this.saveSchedules(list);
    return s;
  }

  updateSchedule(id, patch) {
    const list = this.loadSchedules();
    const idx  = list.findIndex(s => s.id === id);
    if (idx < 0) return null;
    Object.assign(list[idx], patch);
    // Recompute nextRunAt when trigger or enabled changes
    if ('trigger' in patch || 'enabled' in patch) {
      list[idx].nextRunAt = list[idx].enabled
        ? (computeNextRunAt(list[idx].trigger, new Date())?.toISOString() || null)
        : null;
    }
    this.saveSchedules(list);
    return list[idx];
  }

  deleteSchedule(id) {
    const list = this.loadSchedules();
    const idx  = list.findIndex(s => s.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    this.saveSchedules(list);
    return true;
  }

  // ── Run CRUD ───────────────────────────────────────────────────────────

  createRun(scheduleId, opts = {}) {
    const runId = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const runDir = path.join(this.runsDir, scheduleId, runId);
    fs.mkdirSync(runDir, { recursive: true });
    const run = {
      id:             runId,
      scheduleId,
      startedAt:      new Date().toISOString(),
      finishedAt:     null,
      status:         'running',
      trigger:        opts.trigger        || 'auto',  // 'auto' (排程到點/續跑) | 'manual' (/run 立即執行)
      model:          opts.model          || '',
      resolvedPrompt: opts.resolvedPrompt || '',
      usage:          { calls: 0, runtimeMs: 0 },
      jobId:          opts.jobId          || null,
      resumeCount:    opts.resumeCount    || 0,
      previousRunId:  opts.previousRunId  || null,
      artifactIds:    [],
      error:          null,
    };
    fs.writeFileSync(
      path.join(this.runsDir, scheduleId, runId + '.json'),
      JSON.stringify(run, null, 2)
    );
    return { run, runDir };
  }

  updateRun(scheduleId, runId, patch) {
    const runPath = path.join(this.runsDir, scheduleId, runId + '.json');
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      Object.assign(run, patch);
      fs.writeFileSync(runPath, JSON.stringify(run, null, 2));
      return run;
    } catch (e) {
      console.error('[Scheduler] updateRun error:', e.message);
      return null;
    }
  }

  getRun(scheduleId, runId) {
    try {
      return JSON.parse(fs.readFileSync(
        path.join(this.runsDir, scheduleId, runId + '.json'), 'utf8'
      ));
    } catch (e) { return null; }
  }

  getRuns(scheduleId, limit = 50) {
    const dir = path.join(this.runsDir, scheduleId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return null; } })
      .filter(Boolean)
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
      .slice(0, limit);
  }

  saveArtifact(scheduleId, runId, kind, content) {
    const artId  = 'art_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const artDir = path.join(this.runsDir, scheduleId, runId);
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(
      path.join(artDir, artId + '.json'),
      JSON.stringify({ id: artId, runId, kind, content, createdAt: new Date().toISOString() }, null, 2)
    );
    // Append to run's artifactIds
    const runPath = path.join(this.runsDir, scheduleId, runId + '.json');
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      (run.artifactIds = run.artifactIds || []).push(artId);
      fs.writeFileSync(runPath, JSON.stringify(run, null, 2));
    } catch (e) {}
    return artId;
  }

  getArtifact(scheduleId, runId, artId) {
    try {
      return JSON.parse(fs.readFileSync(
        path.join(this.runsDir, scheduleId, runId, artId + '.json'), 'utf8'
      ));
    } catch (e) { return null; }
  }

  // ── Scheduler loop ─────────────────────────────────────────────────────

  setFireJob(fn) { this._fireJob = fn; }

  start() {
    this.reconcileOrphanRuns();  // clear phantom 'running' from a prior process before anything fires
    this._tickWithMissedRun(); // immediate check on startup (missed-run + due runs)
    this._timer = setInterval(() => this._tick(), 60000);
    if (this._timer.unref) this._timer.unref(); // don't prevent process exit
    console.log('[Scheduler] loop started (tick every 60s)');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  // On startup: if nextRunAt is in the past (up to 24h), fire once as a missed-run.
  _tickWithMissedRun() {
    const now      = new Date();
    const cutoff   = new Date(now.getTime() - 24 * 3600 * 1000); // 24h window
    const list     = this.loadSchedules();
    let   changed  = false;
    for (const s of list) {
      // Fire overdue pending resumes on startup; skip regular run while any resume is pending
      if (s.pendingResume) {
        if (new Date(s.pendingResume.atISO) <= now) {
          console.log(`[Scheduler] ${s.id} (${s.name}) firing missed resume #${s.pendingResume.resumeCount} from startup`);
          const pr = s.pendingResume;
          s.pendingResume = null;
          changed = true;
          this.saveSchedules(list);
          this._firePendingResume(s, pr);
        }
        continue;
      }

      if (!s.enabled || !s.nextRunAt) continue;
      const next = new Date(s.nextRunAt);
      if (next > now) continue; // not yet due
      if (next < cutoff) {
        // Missed more than 24h ago → skip, advance nextRunAt
        console.log(`[Scheduler] ${s.id} (${s.name}) missed by >24h — skipping, advancing nextRunAt`);
      } else {
        // Missed within 24h → fire once as catch-up
        console.log(`[Scheduler] ${s.id} (${s.name}) missed run detected — firing now`);
        this._fireSchedule(s);
      }
      // Advance nextRunAt regardless
      if (s.trigger.type === 'once') {
        s.nextRunAt = null;
        s.enabled   = false;
      } else {
        const n = computeNextRunAt(s.trigger, now);
        s.nextRunAt = n ? n.toISOString() : null;
      }
      changed = true;
    }
    if (changed) this.saveSchedules(list);
  }

  _tick() {
    const now  = new Date();
    const list = this.loadSchedules();
    let changed = false;
    for (const s of list) {
      // Pending resume takes priority; also suppresses regular run while waiting
      if (s.pendingResume) {
        if (new Date(s.pendingResume.atISO) <= now) {
          console.log(`[Scheduler] ${s.id} (${s.name}) firing resume #${s.pendingResume.resumeCount}`);
          const pr = s.pendingResume;
          s.pendingResume = null;
          changed = true;
          this.saveSchedules(list); // persist cleared pendingResume before firing
          this._firePendingResume(s, pr);
        }
        continue; // don't fire regular run while resume is pending or being fired
      }

      if (!s.enabled || !s.nextRunAt) continue;
      if (new Date(s.nextRunAt) > now) continue;

      // Circuit breaker
      if ((s.consecutiveFailures || 0) >= (s.guardrails?.failureBreakAfter || 3)) {
        console.log(`[Scheduler] ${s.id} (${s.name}) circuit breaker — disabling after ${s.consecutiveFailures} consecutive failures`);
        s.enabled   = false;
        s.nextRunAt = null;
        changed     = true;
        continue;
      }

      console.log(`[Scheduler] firing ${s.id} (${s.name})`);
      this._fireSchedule(s);

      // Advance trigger
      if (s.trigger.type === 'once') {
        s.nextRunAt = null;
        s.enabled   = false;
      } else {
        const n = computeNextRunAt(s.trigger, now);
        s.nextRunAt = n ? n.toISOString() : null;
      }
      changed = true;
    }
    if (changed) this.saveSchedules(list);
    // H6/H5: daily & weekly housekeeping hook (fires on every tick, guarded inside)
    if (typeof this._housekeepingFn === 'function') {
      try { this._housekeepingFn(); } catch (e) { console.error('[Scheduler] housekeeping error:', e.message); }
    }
  }

  _fireSchedule(schedule, trigger) {
    if (!this._fireJob) {
      console.warn('[Scheduler] fireJob callback not set — skipping');
      return;
    }
    const resolvedPrompt = schedule.task.kind === 'skill'
      ? `/${schedule.task.skill || ''}${schedule.task.args ? ' ' + schedule.task.args : ''}`
      : (schedule.task.prompt || '');

    const { run } = this.createRun(schedule.id, {
      model: schedule.model,
      resolvedPrompt,
      trigger: trigger || 'auto',   // 自動觸發（_tick）不帶值 → 'auto'；手動經 triggerNow 帶 'manual'
    });

    // Fire async, handle errors internally
    Promise.resolve().then(() => this._fireJob(schedule, run)).catch(e => {
      console.error(`[Scheduler] fireJob error for ${schedule.id}:`, e.message);
      this.updateRun(schedule.id, run.id, {
        status:      'failed',
        finishedAt:  new Date().toISOString(),
        error:       e.message,
      });
      this._recordFailure(schedule.id);
    });
  }

  // Called by onComplete in server.js to update schedule-level stats
  recordRunOutcome(scheduleId, status) {
    const list = this.loadSchedules();
    const idx  = list.findIndex(s => s.id === scheduleId);
    if (idx < 0) return;
    list[idx].lastRunAt     = new Date().toISOString();
    list[idx].lastRunStatus = status;
    if (status === 'success') {
      list[idx].consecutiveFailures = 0;
    } else if (status !== 'limited-waiting' && status !== 'blocked' && status !== 'noop') {
      // limited-waiting / blocked / noop are not real failures — don't count toward the circuit
      // breaker. blocked (SSTAT-02) = ran clean but deliberately did nothing (guardrail/approval):
      // it neither succeeded (don't zero the counter) nor broke (don't push toward the breaker).
      list[idx].consecutiveFailures = (list[idx].consecutiveFailures || 0) + 1;
    }
    this.saveSchedules(list);
  }

  // Schedule a resume run at resetAt (called by server.js onComplete when rate-limited).
  // Stores a pendingResume on the schedule; _tick picks it up when the time arrives.
  scheduleResume(schedule, previousRun, resetAt, partial) {
    const maxResumes  = (schedule.guardrails && schedule.guardrails.maxResumes != null)
      ? schedule.guardrails.maxResumes : 3;
    const resumeCount = (previousRun.resumeCount || 0) + 1;
    if (resumeCount > maxResumes) {
      console.log(`[Scheduler] ${schedule.id} (${schedule.name}) maxResumes (${maxResumes}) reached — not scheduling resume`);
      return false;
    }
    // Default to 6h from now if no resetAt was parsed
    const atISO = resetAt || new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    const list = this.loadSchedules();
    const idx  = list.findIndex(s => s.id === schedule.id);
    if (idx < 0) return false;
    list[idx].pendingResume = {
      atISO,
      previousRunId: previousRun.id,
      resumeCount,
      partial:       (partial || '').slice(0, 8000),
    };
    this.saveSchedules(list);
    console.log(`[Scheduler] ${schedule.id} (${schedule.name}) resume #${resumeCount} scheduled for ${atISO}`);
    return true;
  }

  // Fire a pending resume as a new run, passing partial output + original prompt.
  _firePendingResume(schedule, pendingResume) {
    if (!this._fireJob) {
      console.warn('[Scheduler] fireJob callback not set — skipping resume');
      return;
    }
    const originalPrompt = schedule.task.kind === 'skill'
      ? '/' + (schedule.task.skill || '') + (schedule.task.args ? ' ' + schedule.task.args : '')
      : (schedule.task.prompt || '');
    const partial = pendingResume.partial || '';
    const resumePrompt = partial
      ? '[系統：上次執行因配額限制中斷，已保存的進度如下]\n\n--- 上次進度 ---\n' + partial + '\n--- 進度結束 ---\n\n[請在上述進度的基礎上繼續完成原始任務]\n\n' + originalPrompt
      : '[系統：上次執行因配額限制中斷，現在繼續完成原始任務]\n\n' + originalPrompt;
    const { run } = this.createRun(schedule.id, {
      model:         schedule.model,
      resolvedPrompt: resumePrompt,
      resumeCount:   pendingResume.resumeCount,
      previousRunId: pendingResume.previousRunId,
      trigger:       'auto',   // 限額自醒續跑 = 系統自動發起
    });
    Promise.resolve().then(() => this._fireJob(schedule, run)).catch(e => {
      console.error(`[Scheduler] resume fireJob error for ${schedule.id}:`, e.message);
      this.updateRun(schedule.id, run.id, {
        status:     'failed',
        finishedAt: new Date().toISOString(),
        error:      e.message,
      });
      this._recordFailure(schedule.id);
    });
  }

  _recordFailure(scheduleId) {
    this.recordRunOutcome(scheduleId, 'failed');
  }

  // ── Notifications (web sink persistence) ──────────────────────────────────
  // Ring-buffer: newest first, max 200 entries.

  saveNotification(notif) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(this.notificationsPath, 'utf8')); } catch (e) {}
    if (!Array.isArray(list)) list = [];
    list.unshift(notif);
    if (list.length > 200) list = list.slice(0, 200);
    try { fs.writeFileSync(this.notificationsPath, JSON.stringify(list, null, 2)); } catch (e) {
      console.error('[Sink:web] saveNotification error:', e.message);
    }
  }

  getNotifications(limit) {
    try {
      const list = JSON.parse(fs.readFileSync(this.notificationsPath, 'utf8'));
      return (Array.isArray(list) ? list : []).slice(0, limit || 50);
    } catch (e) { return []; }
  }

  dismissNotification(id) {
    try {
      let list = JSON.parse(fs.readFileSync(this.notificationsPath, 'utf8'));
      if (!Array.isArray(list)) return false;
      const len = list.length;
      list = list.filter(function(n) { return n.id !== id; });
      if (list.length !== len) {
        fs.writeFileSync(this.notificationsPath, JSON.stringify(list, null, 2));
        return true;
      }
      return false;
    } catch (e) { return false; }
  }

  // ── Delivery ───────────────────────────────────────────────────────────────
  // 投出「摘要+連結」到排程定義的各 sink；web sink 預設啟用。
  // Telegram（§C）只需 register('telegram', fn) 即可插入，不動核心。

  // ── Resilient delivery (B4 / SCHED-10·11·12) ──────────────────────────────
  // The OLD deliver() sent web+telegram fire-and-forget right after a run finished. If that run
  // triggered a deploy/restart, the send never ran → the notification vanished even though the run
  // was marked success. Now the delivery INTENT lives on the run (`run.delivery`, written atomically
  // with the final status by server.js), and actual sending is a separate, idempotent, retryable step:
  //   • flushRunDelivery — send the sinks this run hasn't delivered yet, record which succeeded.
  //   • flushPendingDeliveries — on boot, re-send every run with sinks still undelivered.

  // Attach a delivery intent to a run if it has none (used when a caller didn't write it inline).
  recordPendingDelivery(scheduleId, runId, sinks, status, summary, scheduleName) {
    const run = this.getRun(scheduleId, runId);
    if (!run || run.delivery) return;
    this.updateRun(scheduleId, runId, {
      delivery: { sinks: sinks && sinks.length ? sinks : ['web'], status, summary: summary || '', scheduleName: scheduleName || '', deliveredSinks: [] },
    });
  }

  // Send the sinks this run still owes; mark each that succeeds. Idempotent: an already-delivered sink
  // is skipped, so re-running this (e.g. on every boot) never double-sends.
  async flushRunDelivery(scheduleId, runId) {
    const run = this.getRun(scheduleId, runId);
    if (!run || !run.delivery) return;
    const d = run.delivery;
    const done = new Set(d.deliveredSinks || []);
    for (const sink of d.sinks || []) {
      if (done.has(sink)) continue;
      const notif = {
        id:           'notif_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type:         'run_complete',
        scheduleId,   scheduleName: d.scheduleName || '',
        runId,        status: d.status, summary: d.summary || '',
        createdAt:    run.finishedAt || new Date().toISOString(),
      };
      // AWAIT the actual send: web resolves immediately (sync file write); telegram resolves only
      // after Telegram accepts the HTTP. Persist deliveredSinks PER-SINK on success, so a sink that
      // truly sent is recorded even if a later sink — or a deploy-restart killing this process
      // mid-send — aborts before the rest finish. Anything not recorded stays owed → re-sent on boot.
      let ok = false;
      try { ok = await this.sinkManager.deliverOne(sink, notif); } catch (e) { ok = false; }
      if (ok) {
        done.add(sink);
        this.updateRun(scheduleId, runId, { delivery: Object.assign({}, d, { deliveredSinks: Array.from(done) }) });
      }
    }
  }

  // On boot (after sinks are registered): re-send every run whose delivery still has an undelivered,
  // currently-registered sink. Runs predating this feature (no `delivery`) are skipped — no back-spam.
  flushPendingDeliveries() {
    let scheduleIds = [];
    try { scheduleIds = fs.readdirSync(this.runsDir).filter((f) => { try { return fs.statSync(path.join(this.runsDir, f)).isDirectory(); } catch (e) { return false; } }); }
    catch (e) { return; }
    let flushed = 0;
    for (const sid of scheduleIds) {
      const dir = path.join(this.runsDir, sid);
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (e) { continue; }
      for (const f of files) {
        let run; try { run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
        if (!run || !run.id || !run.delivery) continue;
        const done = new Set(run.delivery.deliveredSinks || []);
        const owed = (run.delivery.sinks || []).filter((s) => !done.has(s) && this.sinkManager.has(s));
        if (owed.length) { this.flushRunDelivery(sid, run.id); flushed++; }
      }
    }
    if (flushed) console.log('[Scheduler] re-delivered notifications for ' + flushed + ' run(s) undelivered before restart');
  }

  // ── Cross-schedule run query (SCHED-09 自我感知) ──────────────────────────
  // 跨所有排程搜尋執行紀錄，供 API 查詢 + 注入 Hana 上下文。

  queryRuns(opts) {
    opts = opts || {};
    var since     = opts.since      || null;
    var until     = opts.until      || null;
    var filterSid = opts.scheduleId || null;
    var filterSt  = opts.status     || null;
    var limit     = opts.limit      || 50;

    var sids;
    if (filterSid) {
      sids = [filterSid];
    } else {
      try {
        sids = fs.readdirSync(this.runsDir).filter(function(f) {
          try { return fs.statSync(path.join(this.runsDir, f)).isDirectory(); } catch(e) { return false; }
        }.bind(this));
      } catch (e) { sids = []; }
    }

    var results = [];
    var self = this;
    for (var i = 0; i < sids.length; i++) {
      var dir = path.join(self.runsDir, sids[i]);
      if (!fs.existsSync(dir)) continue;
      try {
        var files = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.json'); });
        for (var j = 0; j < files.length; j++) {
          try {
            var run = JSON.parse(fs.readFileSync(path.join(dir, files[j]), 'utf8'));
            if (since && run.startedAt && run.startedAt < since) continue;
            if (until && run.startedAt && run.startedAt > until) continue;
            if (filterSt && run.status !== filterSt) continue;
            results.push(run);
          } catch (e) {}
        }
      } catch (e) {}
    }
    return results
      .sort(function(a, b) { return (b.startedAt || '').localeCompare(a.startedAt || ''); })
      .slice(0, limit);
  }

  // Manual trigger for API /api/schedules/:id/run
  triggerNow(scheduleId) {
    const s = this.getSchedule(scheduleId);
    if (!s) return null;
    // SCHED-15: 防重入 — 已有執行中的 run 就不再觸發（前端按鈕也會 disabled，這是後端雙保險）。
    const running = this.getRunningRun(scheduleId);
    if (running) return { ok: false, error: 'already-running', runId: running.id };
    this._fireSchedule(s, 'manual');
    return { ok: true, scheduleId };
  }

  // SCHED-14/15: 該排程目前仍在執行的 run（status 'running'），無則 null。
  // 供「立即執行」防重入守衛與清單「執行中」徽章使用。
  getRunningRun(scheduleId) {
    return this.getRuns(scheduleId, 50).find(r => r && r.status === 'running') || null;
  }

  // 開機對帳：任何殘留 'running' 的 run 都屬於上一個（已死）行程 —— 此刻尚無任何 job 真正在跑。
  // 將其改記為 'interrupted'，避免清單顯示幽靈「執行中」或永久卡住手動執行按鈕。
  reconcileOrphanRuns() {
    let scheduleIds = [];
    try { scheduleIds = fs.readdirSync(this.runsDir).filter(f => { try { return fs.statSync(path.join(this.runsDir, f)).isDirectory(); } catch (e) { return false; } }); }
    catch (e) { return; }
    let fixed = 0;
    for (const sid of scheduleIds) {
      for (const run of this.getRuns(sid, 200)) {
        if (run && run.status === 'running') {
          this.updateRun(sid, run.id, { status: 'interrupted', finishedAt: new Date().toISOString(), error: '中斷：伺服器重啟' });
          fixed++;
        }
      }
    }
    if (fixed) console.log('[Scheduler] reconciled ' + fixed + ' orphaned running run(s) → interrupted');
  }

  // ── Memory candidate sidecar (H4/H5/H6) ───────────────────────────────────
  // candidate.json is written alongside the run dir when the agent judges a run noteworthy.

  saveMemoryCandidate(scheduleId, runId, data) {
    const dir = path.join(this.runsDir, scheduleId, runId);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'candidate.json'), JSON.stringify(data, null, 2));
    } catch (e) { console.error('[Scheduler] saveMemoryCandidate error:', e.message); }
  }

  getMemoryCandidate(scheduleId, runId) {
    try {
      return JSON.parse(fs.readFileSync(
        path.join(this.runsDir, scheduleId, runId, 'candidate.json'), 'utf8'
      ));
    } catch (e) { return null; }
  }

  // Collect all unreviewed memory candidates for a workspace (null = all workspaces).
  collectCandidates(workspaceRoot) {
    const norm = p => p ? path.resolve(p).toLowerCase() : null;
    const wsNorm = workspaceRoot ? norm(workspaceRoot) : null;
    const results = [];
    for (const s of this.loadSchedules()) {
      if (wsNorm !== null) {
        const sWs = norm(s.workspace) || norm(this.harnessHome);
        if (sWs !== wsNorm) continue;
      }
      for (const r of this.getRuns(s.id, 500)) {
        if (!r.hasCandidate) continue;
        const candidate = this.getMemoryCandidate(s.id, r.id);
        if (!candidate || !candidate.noteworthy || candidate.reviewed) continue;
        results.push({ scheduleId: s.id, scheduleName: s.name, runId: r.id, startedAt: r.startedAt, candidate });
      }
    }
    return results.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  }

  // Identify runs eligible for automatic transcript cleanup (H6).
  // Returns [{scheduleId, runId, workspace}] — server.js does the actual file deletion.
  collectHousekeepingTargets(retainDays, retainMin) {
    retainDays = retainDays || 30;
    retainMin  = retainMin  || 20;
    const cutoff = new Date(Date.now() - retainDays * 24 * 3600 * 1000);
    const targets = [];
    for (const s of this.loadSchedules()) {
      const runs = this.getRuns(s.id, 500);
      const keepSet = new Set();
      runs.forEach((r, i) => {
        if (i < retainMin) keepSet.add(r.id);
        if (r.startedAt && new Date(r.startedAt) >= cutoff) keepSet.add(r.id);
      });
      for (const r of runs) {
        if (keepSet.has(r.id)) continue;
        if (r.transcriptCleared) continue;
        if (r.status === 'pending-resume' || r.status === 'limited-waiting') continue;
        if (r.hasCandidate) {
          const cand = this.getMemoryCandidate(s.id, r.id);
          if (cand && !cand.reviewed) continue; // H6 value gate: pending review
        }
        targets.push({ scheduleId: s.id, runId: r.id, workspace: s.workspace || null });
      }
    }
    return targets;
  }

  // ── Housekeeping state (H5 weekly / H6 daily tracking) ───────────────────

  _housekeepingPath() { return path.join(this.schedulesDir, 'housekeeping.json'); }

  getHousekeepingState() {
    try { return JSON.parse(fs.readFileSync(this._housekeepingPath(), 'utf8')); }
    catch (e) { return {}; }
  }

  saveHousekeepingState(state) {
    try { fs.writeFileSync(this._housekeepingPath(), JSON.stringify(state, null, 2)); }
    catch (e) { console.error('[Scheduler] saveHousekeepingState error:', e.message); }
  }

  // Hook registered by server.js for daily/weekly housekeeping (H6/H5).
  setHousekeepingFn(fn) { this._housekeepingFn = fn; }
}

module.exports = { SchedulerManager, computeNextRunAt };
