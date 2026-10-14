/* Rollcall Payroll Assurance — app shell, exception workflow and release gate over the payroll engine. */
(function () {
  'use strict';

  const E = window.PayrollEngine;
  const F = E.fmt;
  let SAMPLE = window.NORTHLOOM_SAMPLE || { files: {} };
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wide = () => !window.matchMedia || window.matchMedia('(min-width: 1181px)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longDate = (s) => (s ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : '');
  const shortDate = (s) => (s ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}` : '');
  const plural = (n, w, p) => `${n} ${n === 1 ? w : p || w + 's'}`;
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const nowIso = () => new Date().toISOString();
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const clock = (t) => (t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
  const stamp = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const ago = (t) => {
    const s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return stamp(t);
  };
  const initials = (name) => (String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?');

  // ----------------------------------------------------------------------------------
  // Catalogue
  // ----------------------------------------------------------------------------------

  const SOURCES = [
    { key: 'census', group: 'records', kind: 'csv', file: 'census.csv', title: 'Employee census', sys: 'Payroll system · system of record', icon: 'people', api: 'GET /v1/workers?asOf={end}', desc: 'Who is employed, how they are paid, hire and termination dates, deposit accounts and PTO balances. Payroll is authoritative: people are onboarded here before WFM.' },
    { key: 'schedules', group: 'records', kind: 'csv', file: 'schedules.csv', title: 'Schedules', sys: 'WFM · Excel for the distribution center', icon: 'calendar', api: 'GET /v1/schedules?from={start}&to={end}', desc: 'Scheduled shifts by day. Stores schedule in WFM; the distribution center builds schedules in Excel and uploads them.' },
    { key: 'time', group: 'records', kind: 'csv', file: 'time_records.csv', title: 'Time records', sys: 'WFM timekeeping', icon: 'clock', api: 'GET /v1/timecards?from={start}&to={end}', desc: 'Check-in, meal and check-out punches, pay codes (REG, VAC, SICK, HOL) and manager overrides by day.' },
    { key: 'register', group: 'records', kind: 'register', file: 'payroll_register.csv', title: 'Payroll register', sys: 'Payroll processor', icon: 'file', api: 'GET /v1/registers?periodEnd={end}', desc: 'Earnings, taxes, deductions, net pay and PTO balances by employee. Accepts the CSV export or the printed PDF register.' },
    { key: 'bank', group: 'records', kind: 'csv', file: 'bank_activity.csv', title: 'Bank activity', sys: 'Treasury · payroll bank account', icon: 'bank', api: 'Prior-day statement feed (BAI2 / camt.053)', desc: 'Net pay and tax impounds, ACH settlement by employee, returns, tax and benefit remittances.' },
    { key: 'gl', group: 'records', kind: 'csv', file: 'gl_journal.csv', title: 'GL journal', sys: 'ERP general ledger', icon: 'ledger', api: 'GET /v1/journals?source=PAYROLL&period={end}', desc: 'Payroll journal entry and the vacation accrual true-up.' },
    { key: 'agreement', group: 'policy', kind: 'json', file: 'union_agreement.json', title: 'Union agreement', sys: 'Labor relations', icon: 'rules', desc: 'Step rates by title and years of service, the 35-hour week, overtime and the Sunday double-time premium.' },
    { key: 'handbook', group: 'policy', kind: 'json', file: 'employee_handbook.json', title: 'Employee handbook', sys: 'HR policy', icon: 'rules', desc: 'Expected weekly hours, part-time cap, pay codes and holidays, punch rounding, vacation carryover and sick rules.' },
    { key: 'glMap', group: 'policy', kind: 'json', file: 'gl_mapping.json', title: 'GL mapping', sys: 'Finance', icon: 'ledger', desc: 'Wage account by employee class, liability and cash accounts, and the cost centers that are mapped.' },
  ];
  const SRC = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
  const SCHEMA_OF = { census: 'census', schedules: 'schedules', time: 'time', register: 'register', bank: 'bank', gl: 'gl' };

  const KINDS = [
    { kind: 'underpaid', label: 'Owed to employees', sub: (n) => plural(n, 'person', 'people') + ' underpaid' },
    { kind: 'overpaid', label: 'Overpaid', sub: (n) => plural(n, 'person', 'people') + ' overpaid' },
    { kind: 'tax', label: 'Tax exposure', sub: () => 'Under-withheld or unremitted' },
    { kind: 'cash', label: 'Deposits to fix', sub: () => 'ACH returns and differences' },
    { kind: 'gl', label: 'GL to correct', sub: () => 'Suspense and misposted cost' },
    { kind: 'liability', label: 'PTO liability', sub: () => 'Balances misstated' },
  ];
  const KIND_SHORT = { underpaid: 'owed', overpaid: 'overpaid', tax: 'tax', cash: 'deposit', gl: 'GL', liability: 'PTO' };
  const KIND_WORD = { underpaid: 'owed to employee', overpaid: 'overpaid', tax: 'tax exposure', cash: 'deposit', gl: 'GL', liability: 'PTO liability' };
  const SEV_LABEL = { blocker: 'Blocker', review: 'Review', info: 'Info' };
  const STATUS_LABEL = { open: 'Open', review: 'In review', resolved: 'Resolved', accepted: 'Accepted risk' };
  const STATUS_VERB = { open: 'Reopened', review: 'Started review', resolved: 'Resolved', accepted: 'Accepted as risk' };
  const STAGE_OF = Object.fromEntries(E.STAGES.map((s) => [s.id, s]));
  const CHECK_OF = Object.fromEntries(E.CHECKS.map((c) => [c.id, c]));
  const PRE = ['time', 'roster', 'payroll'];
  const FLAG_LABEL = { MISSING_OUT: 'No check-out', MISSING_IN: 'No check-in', MISSING_MEAL_IN: 'No meal return', MISSING_MEAL_OUT: 'No meal out', NO_MEAL: 'No meal', OVERRIDE: 'Override', NO_PUNCH: 'No punches' };
  const OWNERS = ['Payroll', 'HR', 'Store manager', 'WFM admin', 'Treasury', 'GL accounting'];

  const svg = (d, s) => `<svg width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    overview: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    flag: svg('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
    people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-3.8-5.9"/>'),
    shield: svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
    file: svg('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
    db: svg('<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>'),
    rules: svg('<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4V2.8h6V4M9 10h6M9 14h6M9 18h3"/>'),
    sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>', 18),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 14),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 14),
    check: svg('<path d="M5 12.5 10 17l9-10"/>', 14),
    download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 14),
    calendar: svg('<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    bank: svg('<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
    ledger: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>'),
    plug: svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>', 14),
  };

  const NAV = [
    { group: 'Pay cycle', items: [
      { id: 'overview', label: 'Overview', icon: 'overview' },
      { id: 'exceptions', label: 'Exceptions', icon: 'flag' },
      { id: 'people', label: 'People', icon: 'people' },
      { id: 'controls', label: 'Controls', icon: 'shield' },
      { id: 'reports', label: 'Reports', icon: 'file' },
      { id: 'activity', label: 'Activity', icon: 'clock' },
    ] },
    { group: 'Configure', items: [
      { id: 'sources', label: 'Data sources', icon: 'db' },
      { id: 'rules', label: 'Rules', icon: 'rules' },
      { id: 'settings', label: 'Settings', icon: 'sliders' },
    ] },
  ];
  const PAGES = NAV.flatMap((g) => g.items.map((i) => i.id));
  const LEGACY = { intake: 'sources', checks: 'controls', brief: 'reports' };

  // ----------------------------------------------------------------------------------
  // Persistence: workflow, activity and settings live in this browser
  // ----------------------------------------------------------------------------------

  const STORE_KEY = 'rollcall.payroll-assurance.v1';
  const FILES_KEY = 'rollcall.payroll-assurance.sources.v1';
  const freshStore = () => ({ v: 1, user: 'Payroll ops', workspace: 'Northloom Apparel', theme: 'system', settings: {}, cycles: {}, audit: [] });
  let store = loadStore();

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 1) return Object.assign(freshStore(), s);
      }
    } catch (e) { /* storage unavailable: run in memory */ }
    return freshStore();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* in memory only */ }
  }
  function log(action, detail, opts) {
    opts = opts || {};
    store.audit.unshift({ t: nowIso(), by: opts.by || store.user, cycle: opts.cycle || cycleId(), action, detail: detail || '', ref: opts.ref || '' });
    if (store.audit.length > 1000) store.audit.length = 1000;
    save();
  }

  // ----------------------------------------------------------------------------------
  // State
  // ----------------------------------------------------------------------------------

  const state = {
    src: {},
    result: null,
    lastRun: null,
    page: 'overview',
    filters: { status: 'unresolved', sev: { blocker: true, review: true, info: false }, stage: '', check: null, kind: null, owner: '', q: '' },
    sel: new Set(),
    detail: null,
    listKeys: [],
    people: { show: 'all', q: '' },
    drawer: null,
    drawerOpener: null,
    modalOpener: null,
    running: false,
    busy: {},
  };

  // ----------------------------------------------------------------------------------
  // Data
  // ----------------------------------------------------------------------------------

  function loadSample(key, origin) {
    const def = SRC[key];
    const text = SAMPLE.files[def.file];
    const mode = (state.src[key] && state.src[key].mode) || 'upload';
    if (text === undefined) { state.src[key] = { mode, error: 'Sample file not bundled.' }; return; }
    if (def.kind === 'json') state.src[key] = { json: JSON.parse(text), name: def.file, origin: origin || 'sample', mode, at: nowIso() };
    else state.src[key] = { rows: E.parseCSV(text), name: def.file, origin: origin || 'sample', mode, format: 'csv', at: nowIso() };
  }

  function persistSources() {
    const out = {};
    SOURCES.forEach((def) => {
      const s = state.src[def.key];
      if (!s) return;
      const base = { origin: s.origin || null, mode: s.mode || 'upload', name: s.name || '', at: s.at || null, format: s.format || '' };
      if (!s.rows && !s.json) out[def.key] = Object.assign(base, { empty: true });
      else if (s.format === 'pdf') out[def.key] = Object.assign(base, { rows: s.rows, pages: s.pages, problems: s.problems });
      else if (s.origin === 'sample' || s.origin === 'api') out[def.key] = base;
      else if (s.json) out[def.key] = Object.assign(base, { json: s.json });
      else out[def.key] = Object.assign(base, { text: s.text });
    });
    try { localStorage.setItem(FILES_KEY, JSON.stringify(out)); return true; } catch (e) { return false; }
  }

  function restoreSources() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(FILES_KEY) || 'null'); } catch (e) { saved = null; }
    SOURCES.forEach((def) => {
      const s = saved && saved[def.key];
      try {
        if (s && s.empty) state.src[def.key] = { mode: s.mode || 'upload', at: null };
        else if (s && s.format === 'pdf' && s.rows) state.src[def.key] = { rows: s.rows, name: s.name, origin: s.origin, mode: s.mode, format: 'pdf', pages: s.pages, problems: s.problems || [], at: s.at };
        else if (s && s.json) state.src[def.key] = { json: s.json, name: s.name, origin: s.origin, mode: s.mode, at: s.at };
        else if (s && typeof s.text === 'string') state.src[def.key] = { rows: E.parseCSV(s.text), text: s.text, name: s.name, origin: s.origin, mode: s.mode, format: 'csv', at: s.at };
        else {
          state.src[def.key] = { mode: (s && s.mode) || 'upload' };
          loadSample(def.key, s && s.origin === 'api' ? 'api' : 'sample');
          if (s && s.at) state.src[def.key].at = s.at;
        }
      } catch (e) { loadSample(def.key); }
    });
  }

  function input() {
    const g = (k) => state.src[k] || {};
    return {
      census: g('census').rows || [], schedules: g('schedules').rows || [], time: g('time').rows || [],
      register: g('register').rows || [], bank: g('bank').rows || [], gl: g('gl').rows || [],
      agreement: g('agreement').json, handbook: g('handbook').json, glMap: g('glMap').json,
      settings: store.settings,
    };
  }
  const policyDefaults = () => { const i = input(); return E.buildConfig(i.agreement, i.handbook, i.glMap, {}); };
  const isSampleWorkspace = () => SOURCES.filter((s) => s.group === 'records').every((s) => state.src[s.key] && (state.src[s.key].origin === 'sample' || state.src[s.key].origin === 'api'));

  function batchLabel(start) {
    const d = new Date(start + 'T00:00:00Z');
    const y = d.getUTCFullYear();
    const doy = Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 864e5) + 1;
    return `PR-${y}-${String(Math.floor((doy - 1) / 14) + 1).padStart(2, '0')}`;
  }
  const cycleId = () => (state.result ? batchLabel(state.result.period.start) : '');
  function cyc() {
    const id = cycleId();
    return store.cycles[id] || (store.cycles[id] = { items: {}, released: null, created: nowIso() });
  }

  // Exception keys survive re-runs and rule changes (titles carry amounts, so they are not part of the key).
  function keyed(list) {
    const seen = {};
    return list.map((x) => {
      const base = `${x.check}|${x.empId || ''}|${x.date || ''}`;
      seen[base] = (seen[base] || 0) + 1;
      return seen[base] > 1 ? `${base}#${seen[base]}` : base;
    });
  }

  function recompute() {
    const before = state.result && cycleId();
    const prevKeys = state.result ? new Set(state.result.exceptions.map((x) => x.key)) : null;
    state.result = E.run(input());
    const keys = keyed(state.result.exceptions);
    state.result.exceptions.forEach((x, i) => { x.key = keys[i]; });
    state.lastRun = nowIso();
    const c = cyc();
    state.result.exceptions.forEach((x) => { if (!c.items[x.key]) c.items[x.key] = { status: 'open', owner: null, events: [], seen: state.lastRun }; });
    state.diff = null;
    if (prevKeys && before === cycleId()) {
      const now = new Set(keys);
      state.diff = { cleared: [...prevKeys].filter((k) => !now.has(k)).length, added: keys.filter((k) => !prevKeys.has(k)).length };
    }
    if (state.detail && !state.result.exceptions.some((x) => x.key === state.detail)) state.detail = null;
    state.sel.forEach((k) => { if (!keys.includes(k)) state.sel.delete(k); });
    save();
  }
  const diffText = () => (state.diff && (state.diff.cleared || state.diff.added) ? ` · ${state.diff.cleared} cleared, ${state.diff.added} new` : '');

  // ----------------------------------------------------------------------------------
  // Workflow layer
  // ----------------------------------------------------------------------------------

  const item = (x) => cyc().items[x.key] || (cyc().items[x.key] = { status: 'open', owner: null, events: [], seen: nowIso() });
  const statusOf = (x) => item(x).status;
  const ownerOf = (x) => item(x).owner || x.owner || 'Unassigned';
  const isOpen = (x) => { const s = statusOf(x); return s === 'open' || s === 'review'; };
  const isPre = (x) => PRE.includes(x.stage);
  const exByKey = (k) => state.result.exceptions.find((x) => x.key === k);
  const exLabel = (x) => `${x.check}${x.empId ? ' · ' + x.empId + ' ' + x.empName : ''} · ${x.title}`;
  const lastNote = (x) => { const ev = item(x).events.filter((e) => e.text).slice(-1)[0]; return ev ? ev.text : ''; };

  function setStatus(x, to, note) {
    const it = item(x);
    const from = it.status;
    if (from === to) return false;
    it.status = to;
    it.events.push({ t: nowIso(), by: store.user, type: 'status', from, to, text: note || '' });
    log(STATUS_VERB[to], exLabel(x) + (note ? ` — “${note}”` : ''), { ref: x.key });
    return true;
  }
  function setOwner(x, to) {
    const it = item(x);
    const from = ownerOf(x);
    if (from === to) return false;
    it.owner = to;
    it.events.push({ t: nowIso(), by: store.user, type: 'owner', from, to });
    log('Reassigned', `${exLabel(x)} — ${from} → ${to}`, { ref: x.key });
    return true;
  }
  function addNote(x, text) {
    item(x).events.push({ t: nowIso(), by: store.user, type: 'note', text });
    log('Note added', `${exLabel(x)} — “${text}”`, { ref: x.key });
  }

  function readiness() {
    const r = state.result;
    const stagesRan = PRE.every((id) => r.stages.find((s) => s.id === id).ran);
    const pre = r.exceptions.filter((x) => x.severity === 'blocker' && isPre(x));
    const preOpen = pre.filter(isOpen);
    const accepted = pre.filter((x) => statusOf(x) === 'accepted');
    const resolved = pre.filter((x) => statusOf(x) === 'resolved');
    const post = r.exceptions.filter((x) => x.severity === 'blocker' && !isPre(x));
    const postOpen = post.filter(isOpen);
    const released = cyc().released;
    const st = released ? 'released' : !stagesRan ? 'nodata' : preOpen.length ? 'blocked' : 'ready';
    return { state: st, pre, preOpen, accepted, resolved, post, postOpen, released, stagesRan };
  }

  function openImpact() {
    const amount = {}, people = {}, est = {};
    KINDS.forEach((k) => { amount[k.kind] = 0; people[k.kind] = new Set(); est[k.kind] = false; });
    state.result.exceptions.filter(isOpen).forEach((x) => {
      if (!x.impact) return;
      amount[x.impact.kind] = E.util.r2(amount[x.impact.kind] + x.impact.amount);
      if (x.empId) people[x.impact.kind].add(x.empId);
      if (x.impact.estimated) est[x.impact.kind] = true;
    });
    return { amount, people: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v.size])), est };
  }

  function stageOpen(id) {
    const list = state.result.exceptions.filter((x) => x.stage === id && isOpen(x));
    return { blockers: list.filter((x) => x.severity === 'blocker').length, review: list.filter((x) => x.severity === 'review').length };
  }

  // ----------------------------------------------------------------------------------
  // Shell
  // ----------------------------------------------------------------------------------

  const STATE_WORD = { blocked: 'Release blocked', ready: 'Ready to release', released: 'Released', nodata: 'Waiting for data' };

  function periodText(p) {
    return `${shortDate(p.start)} – ${shortDate(p.end)}, ${p.end.slice(0, 4)}`;
  }

  function renderShell() {
    applyTheme();
    renderWorkspace();
    renderNav();
    renderTopbar();
  }

  function renderWorkspace() {
    $('#workspace').innerHTML = `<span class="ws-mark" aria-hidden="true">${esc(initials(store.workspace))}</span>
      <span><b>${esc(store.workspace)}</b><small>${isSampleWorkspace() ? 'Sample workspace · fictional data' : 'Your files'}</small></span>`;
    $('#sideFoot').innerHTML = `Working as <b>${esc(store.user)}</b>. Statuses, notes and approvals are saved in this browser.`;
  }

  function navBadge(id) {
    const r = state.result;
    if (id === 'exceptions') {
      const n = r.exceptions.filter((x) => isOpen(x) && x.severity !== 'info').length;
      return n ? `<span class="badge ${readiness().preOpen.length ? 'crit' : ''}">${n}</span>` : '';
    }
    if (id === 'people') return `<span class="badge">${r.totals.people}</span>`;
    if (id === 'controls') return `<span class="badge">${r.totals.checksRun}/${E.CHECKS.length}</span>`;
    if (id === 'sources') return `<span class="badge">${SOURCES.filter((s) => state.src[s.key] && (state.src[s.key].rows || state.src[s.key].json)).length}/${SOURCES.length}</span>`;
    if (id === 'rules') { const n = Object.keys(store.settings).length; return n ? `<span class="badge">${n} changed</span>` : ''; }
    return '';
  }

  function renderNav() {
    $('#nav').innerHTML = NAV.map((g) => `<div class="nav-label">${esc(g.group)}</div>${g.items.map((i) => `
      <a href="#${i.id}" ${state.page === i.id ? 'aria-current="page"' : ''}>${ICON[i.icon]}<span>${esc(i.label)}</span>${navBadge(i.id)}</a>`).join('')}`).join('');
  }

  function renderTopbar() {
    const r = state.result, p = r.period, rd = readiness();
    const rel = rd.released;
    let releaseBtn;
    if (rd.state === 'released') releaseBtn = `<button class="btn" type="button" data-action="release-info">${ICON.check} Released</button>`;
    else releaseBtn = `<button class="btn primary" type="button" data-action="release" ${rd.state === 'ready' ? '' : 'aria-disabled="true"'} title="${rd.state === 'ready' ? 'Approve and release this batch' : rd.state === 'nodata' ? 'Load the cycle data first' : `Clear ${plural(rd.preOpen.length, 'blocker')} first`}">Release payroll</button>`;
    $('#topbar').innerHTML = `
      <button class="btn small menu-btn" type="button" data-action="nav-toggle" aria-label="Open navigation" aria-expanded="${$('#shell').classList.contains('nav-open')}">${ICON.menu}</button>
      <button class="cycle-btn" type="button" data-action="cycle-menu" aria-haspopup="true" aria-expanded="false">
        <b>${esc(cycleId())}</b><span>${esc(periodText(p))}${p.payDate ? ` · Pay ${esc(F.fmtDate(p.payDate))}` : ''}</span>${ICON.chevron}
      </button>
      <span class="status-chip ${rd.state}" title="${rel ? `Released ${esc(stamp(rel.at))} by ${esc(rel.by)}` : ''}">${STATE_WORD[rd.state]}</span>
      <span class="top-spacer"></span>
      <span class="last-run">${state.running ? 'Running checks…' : `Checked ${esc(clock(state.lastRun))}`}</span>
      <button class="btn" type="button" data-action="rerun" ${state.running ? 'disabled' : ''}>${ICON.refresh} ${state.running ? 'Running…' : 'Re-run checks'}</button>
      ${releaseBtn}`;
  }

  function renderPage() {
    const fn = { overview: renderOverview, exceptions: renderExceptions, people: renderPeople, controls: renderControls, sources: renderSources, rules: renderRules, reports: renderReports, activity: renderActivity, settings: renderSettings }[state.page];
    fn();
  }

  function renderAll() {
    renderShell();
    if (!(state.page === 'rules' && state.keepRules)) renderPage();
    if (state.drawer) renderDrawer();
  }

  function route() {
    let h = (location.hash || '').replace(/^#/, '').split('/')[0];
    if (LEGACY[h]) h = LEGACY[h];
    const next = PAGES.includes(h) ? h : 'overview';
    const changed = next !== state.page;
    state.page = next;
    closeNav();
    closePopover();
    renderShell();
    renderPage();
    if (changed) window.scrollTo(0, 0);
  }
  function go(page) {
    if ((location.hash || '').replace(/^#/, '') === page) route();
    else location.hash = page;
  }

  function applyTheme() {
    const root = document.documentElement;
    if (store.theme === 'light' || store.theme === 'dark') root.setAttribute('data-theme', store.theme);
    else root.removeAttribute('data-theme');
  }

  // ----------------------------------------------------------------------------------
  // Overview
  // ----------------------------------------------------------------------------------

  function byOwner(list) {
    const m = {};
    list.forEach((x) => { const o = ownerOf(x); (m[o] = m[o] || []).push(x); });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }

  function keyDates() {
    const r = state.result, p = r.period, bank = input().bank, gl = input().gl;
    const today = todayIso();
    const out = [];
    if (r.stages.some((s) => s.ran)) out.push({ date: p.end, title: 'Pay period closes', sub: `${shortDate(p.start)} – ${shortDate(p.end)} · ${F.fmtH(sum(r.employees, (e) => e.wfmWorked + e.wfmPto))} approved in WFM` });
    const fund = bank.filter((b) => b.txn_type === 'NET_PAY_FUNDING' || b.txn_type === 'TAX_FUNDING').map((b) => b.value_date).sort()[0];
    if (fund) out.push({ date: fund, title: 'Funding impounded', sub: `${F.money(r.funding.netFunding)} net pay · ${F.money(r.funding.taxFunding)} tax` });
    if (p.payDate) out.push({ date: p.payDate, title: 'Direct deposits settle', sub: `${plural(bank.filter((b) => b.txn_type === 'ACH_CREDIT').length, 'deposit')} · ${F.money(r.funding.achTotal)}` });
    const glDate = gl.map((g) => g.post_date).filter(Boolean).sort()[0];
    if (glDate) out.push({ date: glDate, title: 'Payroll journal posted', sub: `${gl[0].je_id || 'Journal'} · ${plural(gl.length, 'line')}` });
    bank.filter((b) => b.txn_type === 'ACH_RETURN').forEach((b) => out.push({ date: b.value_date, title: `ACH return ${b.return_code || ''}`.trim(), sub: `${F.money(E.util.num(b.amount))} to ****${b.account_last4 || ''}`, fail: true }));
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((d) => Object.assign(d, { done: d.date <= today }));
  }

  function stageButtons(runIdx) {
    const running = typeof runIdx === 'number';
    return state.result.stages.map((s, i) => {
      const o = stageOpen(s.id);
      let st = !s.ran ? 'idle' : o.blockers ? 'fail' : o.review ? 'warn' : 'pass';
      const ct = !s.ran ? 'No data loaded'
        : o.blockers || o.review ? [o.blockers ? `<b class="c">${plural(o.blockers, 'blocker')}</b>` : '', o.review ? `<b class="w">${o.review} to review</b>` : ''].filter(Boolean).join(' · ')
          : s.blockers + s.review ? 'All items cleared' : 'All checks pass';
      if (running && i >= runIdx) st = 'idle';
      return `<button class="stage" type="button" data-action="stage" data-stage="${s.id}" data-state="${st}" ${running && i === runIdx ? 'data-running="true"' : ''}>
        <span class="ph">${esc(s.phase)}</span>
        <span class="nm"><span class="dotc"></span>${esc(s.title)}</span>
        <span class="ct">${running && i === runIdx ? 'Checking…' : running && i > runIdx ? 'Queued' : ct}</span>
        <span class="bar" aria-hidden="true"><i style="width:${s.checks ? Math.round((s.passed / s.checks) * 100) : 0}%"></i></span>
        <span class="ct">${s.ran ? `${s.passed} of ${s.checks} checks pass` : `${s.checks} checks`}</span>
      </button>`;
    }).join('');
  }

  function renderOverview() {
    const r = state.result, p = r.period, t = r.totals, rd = readiness();
    const cleared = rd.pre.length - rd.preOpen.length;
    const pct = rd.pre.length ? Math.round((cleared / rd.pre.length) * 100) : rd.stagesRan ? 100 : 0;
    let text, actions;
    if (rd.state === 'blocked') {
      text = `${plural(rd.preOpen.length, 'blocker')} in time, roster and register checks ${rd.preOpen.length === 1 ? 'is' : 'are'} open. Resolve each one, or accept it as a risk with a reason, to release this batch.`;
      actions = `<button class="btn primary" type="button" data-action="go-blockers">Work the blockers</button><button class="btn" type="button" data-action="release" aria-disabled="true">Release payroll</button>`;
    } else if (rd.state === 'ready') {
      text = `${rd.pre.length ? `All ${plural(rd.pre.length, 'pre-release blocker')} are cleared${rd.accepted.length ? `, ${rd.accepted.length} accepted as risk` : ''}.` : 'Every pre-release check passed.'}${rd.postOpen.length ? ` ${plural(rd.postOpen.length, 'funding and GL blocker', 'funding and GL blockers')} stay open and are tracked after settlement.` : ''}`;
      actions = `<button class="btn primary" type="button" data-action="release">Release payroll</button><a class="btn" href="#exceptions">Review exceptions</a>`;
    } else if (rd.state === 'released') {
      const rel = rd.released;
      text = `Released ${stamp(rel.at)} by ${rel.by}${rel.note ? `: “${rel.note}”` : '.'}${rd.postOpen.length ? ` ${plural(rd.postOpen.length, 'funding and GL blocker', 'funding and GL blockers')} remain open for treasury and accounting.` : ''}`;
      actions = `<button class="btn" type="button" data-action="release-info">View release record</button>${rd.postOpen.length ? '<button class="btn" type="button" data-action="go-post">Work post-settlement items</button>' : ''}`;
    } else {
      text = 'Load the census, time records and payroll register for this cycle. Every check runs as soon as the files arrive.';
      actions = `<a class="btn primary" href="#sources">Go to data sources</a><button class="btn" type="button" data-action="load-sample">Load sample cycle</button>`;
    }
    const owners = byOwner(rd.preOpen);
    const top = (rd.state === 'blocked' ? rd.preOpen : rd.accepted).slice().sort((a, b) => (b.impact ? b.impact.amount : 0) - (a.impact ? a.impact.amount : 0)).slice(0, 4);
    const missing = SOURCES.filter((s) => s.group === 'records' && !(state.src[s.key] && state.src[s.key].rows));
    const oi = openImpact();
    const dates = keyDates();
    const feed = store.audit.filter((a) => a.cycle === cycleId()).slice(0, 7);
    const ownerRows = byOwner(r.exceptions.filter((x) => isOpen(x) && x.severity !== 'info'));
    const fact = (label, value) => `<div><span>${esc(label)}</span><b>${value}</b></div>`;

    $('#page').innerHTML = `
      <div class="page-head">
        <div><span class="eyebrow">Pay cycle ${esc(cycleId())}</span><h1>${esc(periodText(p))}</h1>
        <p>${esc(store.workspace)}${p.payDate ? ` · pay date ${esc(F.fmtDate(p.payDate))}` : ''} · ${plural(t.people, 'person', 'people')} · ${t.checksRun} of ${E.CHECKS.length} checks ran across WFM, the payroll register, bank activity and the GL</p></div>
      </div>
      <div class="grid ov-top">
        <section class="card ready-card" data-state="${rd.state}" aria-labelledby="readyTitle">
          <span class="eyebrow">Release readiness</span>
          <div class="ready-top"><h2 id="readyTitle">${STATE_WORD[rd.state]}</h2></div>
          <p>${esc(text)}</p>
          ${rd.state === 'nodata' ? `<ul class="timeline">${SOURCES.filter((s) => s.group === 'records').map((s) => `<li class="${missing.includes(s) ? '' : 'done'}"><span class="tdot"></span><span><b>${esc(s.title)}</b><br><span class="muted">${esc(s.sys)}</span></span><span class="tdate">${missing.includes(s) ? 'Missing' : 'Loaded'}</span></li>`).join('')}</ul>` : `
          <div><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Pre-release blockers cleared"><i style="width:${pct}%"></i></div>
          <div class="progress-meta"><span>${cleared} of ${plural(rd.pre.length, 'pre-release blocker')} cleared</span><span>${rd.resolved.length} resolved · ${rd.accepted.length} accepted as risk</span></div></div>
          ${owners.length ? `<div><span class="eyebrow">Open blockers by owner</span><div class="owner-row" style="margin-top:6px">${owners.map(([o, l]) => `<button type="button" data-action="filter-owner" data-owner="${esc(o)}" data-pre="1">${esc(o)} <b>${l.length}</b></button>`).join('')}</div></div>` : ''}
          ${top.length ? `<div><span class="eyebrow">${rd.state === 'blocked' ? 'Largest open blockers' : 'Accepted as risk'}</span><ul class="mini-list" style="margin-top:6px">${top.map((x) => `<li><button type="button" data-action="goto-ex" data-key="${esc(x.key)}" data-scope="pre">
            <span class="pill ${rd.state === 'blocked' ? 'blocker' : 'info'}">${esc(x.check)}</span>
            <span class="t"><b>${esc(x.title)}</b><span>${esc(x.empId ? `${x.empId} ${x.empName}` : 'Whole cycle')} · ${esc(ownerOf(x))}</span></span>
            <span class="mono">${x.impact ? F.money(x.impact.amount) : '—'}</span></button></li>`).join('')}</ul></div>` : ''}`}
          <div class="actions-row">${actions}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>This cycle</h3></div>
          <div class="facts">
            ${fact('Gross pay', F.money(r.regTotals.gross))}
            ${fact('Net pay', F.money(r.regTotals.net))}
            ${fact('Employer taxes', F.money(r.regTotals.erTax))}
            ${fact('On the register', `${t.onRegister}<span class="muted" style="font-size:var(--t-sm);font-family:var(--f-body)"> of ${t.census} in census</span>`)}
          </div>
          ${dates.length ? `<ul class="timeline">${dates.map((d) => `<li class="${d.fail ? 'fail' : d.done ? 'done' : ''}"><span class="tdot"></span><span><b>${esc(d.title)}</b><br><span class="muted">${esc(d.sub)}</span></span><span class="tdate">${esc(F.fmtDate(d.date))}</span></li>`).join('')}</ul>` : ''}
        </section>
      </div>

      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Checks by stage</h3><span class="muted" style="font-size:var(--t-sm)">Open items after review · select a stage to work it</span><a class="more" href="#controls">All controls</a></div>
        <div class="stages" id="stages" style="border-top:1px solid var(--line)">${stageButtons()}</div>
      </section>

      <div class="group-title"><h3>Open exposure</h3><span class="muted">Dollar impact of exceptions that are not yet resolved or accepted</span></div>
      <div class="kpis">${KINDS.map((k) => {
        const v = oi.amount[k.kind];
        return `<button class="kpi" type="button" data-action="kind" data-kind="${k.kind}">
          <span class="label">${esc(k.label)}</span>
          <span class="value ${v ? '' : 'zero'}">${F.money(v)}</span>
          <span class="sub">${esc(k.sub(oi.people[k.kind]))}${oi.est[k.kind] ? ' · incl. estimates' : ''}</span>
        </button>`;
      }).join('')}</div>

      <div class="grid ov-bottom" style="margin-top:16px">
        <section class="card">
          <div class="card-head"><h3>Open items by owner</h3><a class="more" href="#exceptions">Exception queue</a></div>
          ${ownerRows.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Owner</th><th class="n">Blockers</th><th class="n">Review</th><th class="n">Exposure</th></tr></thead>
            <tbody>${ownerRows.map(([o, l]) => `<tr class="clickable" data-action="filter-owner" data-owner="${esc(o)}">
              <td><b>${esc(o)}</b></td>
              <td class="n">${l.filter((x) => x.severity === 'blocker').length || '<span class="muted">0</span>'}</td>
              <td class="n">${l.filter((x) => x.severity === 'review').length || '<span class="muted">0</span>'}</td>
              <td class="n">${F.money(sum(l.filter((x) => x.impact), (x) => x.impact.amount))}</td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty"><h3>Nothing open</h3><p>Every blocker and review item is resolved or accepted.</p></div>'}
        </section>
        <section class="card">
          <div class="card-head"><h3>Recent activity</h3><a class="more" href="#activity">Full log</a></div>
          ${feed.length ? `<ul class="feed">${feed.map(feedItem).join('')}</ul>` : '<div class="empty"><p>No activity yet. Status changes, notes, re-runs and releases are logged here.</p></div>'}
        </section>
      </div>`;
  }

  function feedItem(a) {
    const sys = a.by === 'Rollcall';
    return `<li><span class="avatar ${sys ? 'sys' : ''}" aria-hidden="true">${sys ? 'RC' : esc(initials(a.by))}</span>
      <span><b>${esc(a.by)}</b> ${esc(a.action.toLowerCase())}<br><span class="muted">${esc(a.detail)}</span><br><span class="when">${esc(ago(a.t))}</span></span></li>`;
  }

  // ----------------------------------------------------------------------------------
  // Exceptions
  // ----------------------------------------------------------------------------------

  function matches(x, skip) {
    const f = state.filters;
    skip = skip || {};
    const q = f.q.trim().toLowerCase();
    const st = statusOf(x);
    return (skip.status || f.status === 'all' || (f.status === 'unresolved' ? st === 'open' || st === 'review' : st === f.status))
      && (skip.sev || f.sev[x.severity])
      && (!f.stage || (f.stage === 'pre' ? isPre(x) : f.stage === 'post' ? !isPre(x) : x.stage === f.stage))
      && (!f.check || x.check === f.check)
      && (!f.kind || (x.impact && x.impact.kind === f.kind))
      && (!f.owner || ownerOf(x) === f.owner)
      && (!q || `${x.title} ${x.detail} ${x.empName} ${x.empId || ''} ${x.check} ${ownerOf(x)}`.toLowerCase().includes(q));
  }

  function ownerOptions() {
    return Array.from(new Set(OWNERS.concat(state.result.exceptions.map(ownerOf)))).filter((o) => o !== 'Unassigned').sort();
  }

  function renderExceptions() {
    const f = state.filters;
    const chips = [];
    if (f.check) chips.push(['check', `Check: ${f.check} ${CHECK_OF[f.check].title}`]);
    if (f.kind) chips.push(['kind', `Impact: ${KINDS.find((k) => k.kind === f.kind).label}`]);
    const stageOpts = [['', 'All stages'], ['pre', 'Before release'], ['post', 'After settlement']].concat(E.STAGES.map((s) => [s.id, s.title]));
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>Exceptions</h1><p>Every finding from the last run with its owner, status and history. Blockers in time, roster and register checks must be resolved or accepted as a risk before the batch can be released.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="export-ex">${ICON.download} Export CSV</button></div>
      </div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Status" id="statusSeg"></div>
        <div class="seg" role="group" aria-label="Severity" id="sevSeg"></div>
      </div>
      <div class="toolbar">
        <label class="field" for="stageSel">Stage <select id="stageSel">${stageOpts.map(([v, l]) => `<option value="${v}" ${f.stage === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field" for="ownerSel">Owner <select id="ownerSel"><option value="">Everyone</option>${ownerOptions().concat(state.result.exceptions.some((x) => ownerOf(x) === 'Unassigned') ? ['Unassigned'] : []).map((o) => `<option ${f.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
        <input class="text" id="exSearch" type="search" placeholder="Search name, ID or check" value="${esc(f.q)}" aria-label="Search exceptions">
        ${chips.map(([k, l]) => `<button class="chip" type="button" data-action="clear-filter" data-filter="${k}">${esc(l)} <span aria-hidden="true">×</span><span class="sr-only">Clear filter</span></button>`).join('')}
        <span class="spacer"></span>
        <span class="muted" id="exCount" style="font-size:var(--t-sm)"></span>
      </div>
      <div id="bulk"></div>
      <div class="split" id="split">
        <div id="qlist"></div>
        <aside class="detail" id="detail" aria-label="Exception detail" hidden></aside>
      </div>`;
    renderQueue();
  }

  function renderQueue() {
    const r = state.result, f = state.filters;
    const base = r.exceptions.filter((x) => matches(x, { status: true }));
    const counts = { unresolved: 0, resolved: 0, accepted: 0, all: base.length };
    base.forEach((x) => { const s = statusOf(x); if (s === 'open' || s === 'review') counts.unresolved++; else counts[s]++; });
    $('#statusSeg').innerHTML = [['unresolved', 'Unresolved'], ['resolved', 'Resolved'], ['accepted', 'Accepted risk'], ['all', 'All']]
      .map(([v, l]) => `<button type="button" data-action="status-tab" data-status="${v}" aria-pressed="${f.status === v}">${l} <span class="n">${counts[v]}</span></button>`).join('');
    const sevBase = r.exceptions.filter((x) => matches(x, { sev: true }));
    $('#sevSeg').innerHTML = ['blocker', 'review', 'info']
      .map((s) => `<button type="button" data-action="sev" data-sev="${s}" aria-pressed="${f.sev[s]}">${s === 'blocker' ? 'Blockers' : SEV_LABEL[s]} <span class="n">${sevBase.filter((x) => x.severity === s).length}</span></button>`).join('');

    const list = r.exceptions.filter((x) => matches(x));
    state.listKeys = list.map((x) => x.key);
    $('#exCount').textContent = `${list.length} of ${r.exceptions.length} · by severity, then stage`;
    if (!state.detail && wide() && list.length) state.detail = list[0].key;

    const allSel = list.length && list.every((x) => state.sel.has(x.key));
    $('#qlist').innerHTML = list.length ? `<div class="qlist" role="list">
      <div class="qhead"><input type="checkbox" class="cb" id="selAll" aria-label="Select all shown" ${allSel ? 'checked' : ''}><span class="qid">Severity</span><span>Exception</span><span class="qown">Owner</span><span class="qimp">Impact</span><span class="qst">Status</span></div>
      ${list.map(qRow).join('')}</div>`
      : `<div class="qlist"><div class="empty"><h3>${r.exceptions.length ? 'Nothing matches these filters' : 'No exceptions'}</h3><p>${r.exceptions.length ? 'Change the status, severity or owner filters to see more.' : 'Every check that ran passed.'}</p></div></div>`;
    renderBulk();
    renderDetail();
  }

  function qRow(x) {
    const st = statusOf(x);
    const closed = st === 'resolved' || st === 'accepted';
    const who = x.empId ? `${x.empId} ${x.empName}` : 'Whole cycle';
    const impact = x.impact
      ? `<span class="k-${x.impact.kind}">${F.money(x.impact.amount)}</span><small>${esc(KIND_SHORT[x.impact.kind])}${x.impact.estimated ? ' · est.' : ''}</small>`
      : '<small>No $ impact</small>';
    return `<div class="qrow ${state.detail === x.key ? 'sel' : ''} ${closed ? 'closed' : ''}" role="listitem" data-action="select-ex" data-key="${esc(x.key)}">
      <input type="checkbox" class="cb" data-action="toggle-sel" data-key="${esc(x.key)}" aria-label="Select ${esc(x.title)}" ${state.sel.has(x.key) ? 'checked' : ''}>
      <span class="qid"><span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span><span class="mono">${esc(x.check)} · ${esc(x.id)}</span></span>
      <button class="qt linkless" type="button" data-action="select-ex" data-key="${esc(x.key)}"><b>${esc(x.title)}</b><span>${esc(who)} · ${esc(STAGE_OF[x.stage].title)}</span></button>
      <span class="qown">${esc(ownerOf(x))}</span>
      <span class="qimp">${impact}</span>
      <span class="qst">${statusPill(st)}</span>
    </div>`;
  }
  const statusPill = (st) => `<span class="st ${st}"><i aria-hidden="true"></i>${STATUS_LABEL[st]}</span>`;

  function renderBulk() {
    const el = $('#bulk');
    if (!el) return;
    const n = state.sel.size;
    el.innerHTML = n ? `<div class="bulk" style="margin-bottom:12px" role="region" aria-label="Bulk actions">
      <span>${plural(n, 'exception')} selected</span>
      <select id="bulkOwner" aria-label="Assign selected to"><option value="">Assign to…</option>${ownerOptions().map((o) => `<option>${esc(o)}</option>`).join('')}</select>
      <button class="btn small" type="button" data-action="bulk-status" data-to="review">Start review</button>
      <button class="btn small" type="button" data-action="bulk-status" data-to="resolved">Resolve</button>
      <button class="btn small" type="button" data-action="bulk-accept">Accept risk…</button>
      <button class="linkish" type="button" data-action="clear-sel">Clear selection</button>
    </div>` : '';
  }

  function renderDetail() {
    const el = $('#detail');
    const split = $('#split');
    if (!el) return;
    const x = state.detail && exByKey(state.detail);
    if (!x) {
      el.hidden = true;
      el.innerHTML = '';
      split.classList.add('nodetail');
      if (!wide()) $('#scrim').hidden = !state.drawer;
      return;
    }
    split.classList.remove('nodetail');
    el.hidden = false;
    if (!wide()) $('#scrim').hidden = false;
    const it = item(x);
    const st = it.status;
    const emp = x.empId ? state.result.empById[x.empId] : null;
    const idx = state.listKeys.indexOf(x.key);
    const next = state.listKeys[idx + 1];
    const btns = {
      open: [['review', 'Start review', ''], ['resolved', 'Resolve', 'primary'], ['accepted', 'Accept risk', '']],
      review: [['resolved', 'Resolve', 'primary'], ['accepted', 'Accept risk', ''], ['open', 'Back to open', '']],
      resolved: [['open', 'Reopen', '']],
      accepted: [['open', 'Reopen', '']],
    }[st];
    const ev = [];
    if (x.expected) ev.push(['Expected', x.expected]);
    if (x.actual) ev.push(['Actual', x.actual]);
    if (x.impact) ev.push(['Impact', `${F.money(x.impact.amount)} ${KIND_WORD[x.impact.kind]}${x.impact.estimated ? ' (est.)' : ''}`]);
    if (x.date) ev.push(['Date', F.fmtDate(x.date)]);
    ev.push(['Check', `${x.check} ${CHECK_OF[x.check].title}`]);
    ev.push(['Stage', `${STAGE_OF[x.stage].title}${isPre(x) ? ' · before release' : ' · after settlement'}`]);
    const hist = [{ t: it.seen || state.lastRun, by: 'Rollcall', type: 'detected' }].concat(it.events).reverse();
    el.innerHTML = `
      <div class="detail-head">
        <div class="row"><span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span><span class="mono muted" style="font-size:var(--t-xs)">${esc(x.id)} · ${esc(x.check)}</span>
          <span class="close-x" style="display:flex;gap:6px">${next ? `<button class="btn small" type="button" data-action="select-ex" data-key="${esc(next)}">Next</button>` : ''}<button class="btn small" type="button" data-action="close-detail">Close</button></span></div>
        <h2>${esc(x.title)}</h2>
        <div class="row">${statusPill(st)}<span class="muted" style="font-size:var(--t-xs)">Owner: ${esc(ownerOf(x))}</span></div>
      </div>
      <div class="detail-body">
        ${emp ? `<section><h4>Employee</h4><button class="who" type="button" data-action="open-emp" data-emp="${esc(emp.id)}"><b>${esc(emp.name)}</b><span>${esc(emp.id)}${emp.title ? ' · ' + esc(emp.title) : ''}${emp.location ? ' · ' + esc(emp.location) : ''}</span></button></section>` : ''}
        <section><h4>What Rollcall found</h4><p>${esc(x.detail)}</p></section>
        <div class="ev">${ev.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
        ${x.action ? `<section><h4>Recommended action</h4><p>${esc(x.action)}</p></section>` : ''}
        <section><h4>Work this item</h4>
          <div class="actions-row">${btns.map(([to, l, cls]) => `<button class="btn small ${cls}" type="button" data-action="set-status" data-to="${to}">${l}</button>`).join('')}</div>
          <label class="field" for="ownerOne" style="margin-top:10px">Owner
            <select id="ownerOne" data-key="${esc(x.key)}">${ownerOptions().concat(ownerOf(x) === 'Unassigned' ? ['Unassigned'] : []).map((o) => `<option ${ownerOf(x) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          </label>
        </section>
        <section><h4><label for="noteText">Note</label></h4>
          <textarea class="text" id="noteText" placeholder="Context, a ticket number, or the fix applied. Saved with the next action, or on its own."></textarea>
          <p class="form-err" id="noteErr" hidden></p>
          <div class="actions-row" style="margin-top:8px"><button class="btn small" type="button" data-action="add-note">Add note</button></div>
        </section>
        <section><h4>History</h4><ul class="history">${hist.map(histItem).join('')}</ul></section>
      </div>`;
  }

  function histItem(ev) {
    const sys = ev.by === 'Rollcall';
    let what;
    if (ev.type === 'detected') what = 'flagged this on a check run';
    else if (ev.type === 'status') what = `${STATUS_VERB[ev.to].toLowerCase()}${ev.from ? ` <span class="muted">(was ${esc(STATUS_LABEL[ev.from].toLowerCase())})</span>` : ''}`;
    else if (ev.type === 'owner') what = `reassigned to <b>${esc(ev.to)}</b> <span class="muted">from ${esc(ev.from)}</span>`;
    else what = 'added a note';
    return `<li><span class="avatar ${sys ? 'sys' : ''}" aria-hidden="true">${sys ? 'RC' : esc(initials(ev.by))}</span>
      <span><b>${esc(ev.by)}</b> ${what}<br><span class="when">${esc(stamp(ev.t))}</span>${ev.text ? `<div class="note">${esc(ev.text)}</div>` : ''}</span></li>`;
  }

  function selectEx(key) {
    state.detail = key;
    if (state.page !== 'exceptions') { go('exceptions'); return; }
    document.querySelectorAll('.qrow').forEach((r) => r.classList.toggle('sel', r.dataset.key === key));
    renderDetail();
    const d = $('#detail');
    if (d) d.scrollTop = 0;
    if (!wide() && d) { const b = d.querySelector('[data-action="close-detail"]'); if (b) b.focus(); }
  }
  function closeDetail() {
    state.detail = null;
    document.querySelectorAll('.qrow.sel').forEach((r) => r.classList.remove('sel'));
    const el = $('#detail');
    if (el) { el.hidden = true; $('#split').classList.add('nodetail'); }
    if (!state.drawer) $('#scrim').hidden = true;
  }

  function afterWorkflow() {
    save();
    renderShell();
    if (state.page === 'exceptions') renderQueue();
    else renderPage();
    if (state.drawer) renderDrawer();
  }

  function filterExceptions(patch) {
    state.filters = Object.assign({ status: 'unresolved', sev: { blocker: true, review: true, info: false }, stage: '', check: null, kind: null, owner: '', q: '' }, patch);
    if (patch.check) state.filters.sev = { blocker: true, review: true, info: true };
    state.detail = null;
    state.sel.clear();
    go('exceptions');
  }

  function exceptionsCSV(list) {
    const rows = list.map((x) => {
      const it = item(x);
      const last = it.events.slice(-1)[0];
      return {
        id: x.id, key: x.key, severity: x.severity, status: STATUS_LABEL[it.status], check: x.check, check_name: CHECK_OF[x.check].title, stage: STAGE_OF[x.stage].title,
        before_release: isPre(x) ? 'Y' : 'N', emp_id: x.empId || '', employee: x.empName || '', title: x.title, detail: x.detail,
        expected: x.expected || '', actual: x.actual || '',
        impact_kind: x.impact ? x.impact.kind : '', impact_amount: x.impact ? x.impact.amount.toFixed(2) : '', estimated: x.impact && x.impact.estimated ? 'Y' : '',
        owner: ownerOf(x), action: x.action || '',
        notes: it.events.filter((e) => e.text).map((e) => `${stamp(e.t)} ${e.by}: ${e.text}`).join(' | '),
        last_update: last ? last.t : '',
      };
    });
    return E.toCSV(rows, ['id', 'key', 'severity', 'status', 'check', 'check_name', 'stage', 'before_release', 'emp_id', 'employee', 'title', 'detail', 'expected', 'actual', 'impact_kind', 'impact_amount', 'estimated', 'owner', 'action', 'notes', 'last_update']);
  }

  // ----------------------------------------------------------------------------------
  // People
  // ----------------------------------------------------------------------------------

  const regHours = (R) => (R ? E.util.num(R.reg_hrs) + E.util.num(R.ot_hrs) + E.util.num(R.dt_hrs) + E.util.num(R.vac_hrs) + E.util.num(R.sick_hrs) + E.util.num(R.hol_hrs) : null);
  const openFor = (e) => e.exceptions.filter((x) => isOpen(x) && x.severity !== 'info');

  function renderPeople() {
    const r = state.result;
    const withOpen = r.employees.filter((e) => openFor(e).length).length;
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>People</h1><p>Everyone in the payroll census or WFM this cycle. Validated gross is rebuilt from approved WFM time, contract rates and handbook rules, then compared with the register.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="export-variance">${ICON.download} Export pay variance</button></div>
      </div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Show">
          ${[['all', 'Everyone', r.employees.length], ['open', 'With open items', withOpen], ['clear', 'Clear', r.employees.length - withOpen]].map(([v, l, n]) => `<button type="button" data-action="people-show" data-show="${v}" aria-pressed="${state.people.show === v}">${l} <span class="n">${n}</span></button>`).join('')}
        </div>
        <input class="text" id="peopleSearch" type="search" placeholder="Search name, ID, title or location" value="${esc(state.people.q)}" aria-label="Search people">
        <span class="spacer"></span><span class="muted" id="peopleCount" style="font-size:var(--t-sm)"></span>
      </div>
      <div id="peopleTable"></div>`;
    renderPeopleTable();
  }

  function renderPeopleTable() {
    const r = state.result;
    const q = state.people.q.trim().toLowerCase();
    const rows = r.employees.filter((e) => {
      const n = openFor(e).length;
      return (state.people.show === 'all' || (state.people.show === 'open' ? n : !n))
        && (!q || `${e.name} ${e.id} ${e.title || ''} ${e.location || ''} ${e.cc || ''}`.toLowerCase().includes(q));
    });
    const cell = (v) => (v === null || v === undefined ? '<span class="muted">—</span>' : v);
    $('#peopleCount').textContent = `${rows.length} of ${r.employees.length}`;
    $('#peopleTable').innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Class</th><th>Location</th><th class="n">WFM hours</th><th class="n">Register hours</th><th class="n">Register gross</th><th class="n">Validated gross</th><th class="n">Difference</th><th>Open items</th></tr></thead>
      <tbody>${rows.map((e) => {
        const R = e.register;
        const regH = regHours(R);
        const gross = R ? E.util.num(R.gross_pay) : null;
        const diff = gross !== null && e.expectedGross !== null && e.expectedGross !== undefined ? E.util.r2(gross - e.expectedGross) : null;
        const open = openFor(e);
        const b = open.filter((x) => x.severity === 'blocker').length;
        const v = open.filter((x) => x.severity === 'review').length;
        const done = e.exceptions.filter((x) => x.severity !== 'info' && !isOpen(x)).length;
        return `<tr>
          <td><button class="who" type="button" data-action="open-emp" data-emp="${esc(e.id)}"><b>${esc(e.name)}</b><span>${esc(e.id)}${e.title ? ' · ' + esc(e.title) : ''}</span></button></td>
          <td>${e.cls ? esc(e.cls.label) : '<span class="muted">Not in payroll</span>'}</td>
          <td>${esc(e.location)}${e.cc ? ` <span class="muted mono">${esc(e.cc)}</span>` : ''}</td>
          <td class="n">${e.hasWfm ? F.fmtH(e.wfmWorked + e.wfmPto) : cell(null)}</td>
          <td class="n">${regH === null ? cell(null) : F.fmtH(regH)}</td>
          <td class="n">${gross === null ? cell(null) : F.money(gross)}</td>
          <td class="n">${e.expectedGross === null || e.expectedGross === undefined ? cell(null) : F.money(e.expectedGross)}</td>
          <td class="n">${diff === null ? cell(null) : diff === 0 ? '<span class="muted">$0.00</span>' : `<span class="${diff > 0 ? 'pos' : 'neg'}">${F.signedMoney(diff)}</span>`}</td>
          <td>${b ? `<span class="pill blocker">${b}</span> ` : ''}${v ? `<span class="pill review">${v}</span> ` : ''}${!b && !v ? (done ? `<span class="pill pass">${done} cleared</span>` : '<span class="pill pass">Clear</span>') : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>` : '<div class="table-wrap"><div class="empty"><h3>No one matches</h3><p>Clear the search or change the filter.</p></div></div>';
  }

  function varianceCSV() {
    const rows = state.result.employees.map((e) => {
      const R = e.register;
      const gross = R ? E.util.num(R.gross_pay) : null;
      const diff = gross !== null && e.expectedGross !== null && e.expectedGross !== undefined ? E.util.r2(gross - e.expectedGross) : null;
      return {
        emp_id: e.id, employee: e.name, title: e.title || '', class: e.cls ? e.cls.label : 'Not in payroll', location: e.location || '', cost_center: e.cc || '',
        wfm_hours: e.hasWfm ? (e.wfmWorked + e.wfmPto).toFixed(2) : '', register_hours: R ? regHours(R).toFixed(2) : '',
        register_gross: gross === null ? '' : gross.toFixed(2), validated_gross: e.expectedGross === null || e.expectedGross === undefined ? '' : e.expectedGross.toFixed(2),
        difference: diff === null ? '' : diff.toFixed(2), net_pay: R ? E.util.num(R.net_pay).toFixed(2) : '',
        open_blockers: openFor(e).filter((x) => x.severity === 'blocker').length, open_review: openFor(e).filter((x) => x.severity === 'review').length,
      };
    });
    return E.toCSV(rows, ['emp_id', 'employee', 'title', 'class', 'location', 'cost_center', 'wfm_hours', 'register_hours', 'register_gross', 'validated_gross', 'difference', 'net_pay', 'open_blockers', 'open_review']);
  }

  // ----------------------------------------------------------------------------------
  // Controls
  // ----------------------------------------------------------------------------------

  const GLYPH = {
    pass: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fail: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warn: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="6" cy="9.6" r="1.2" fill="currentColor"/></svg>',
    note: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="2.6" r="1.2" fill="currentColor"/><path d="M6 5.5v4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    idle: '',
  };

  function renderControls() {
    const r = state.result;
    $('#page').innerHTML = `
      <div class="page-head"><div><h1>Controls</h1><p>${E.CHECKS.length} checks across five stages, from WFM time through the payroll register, treasury funding and GL posting. Each reads the loaded data sources and the thresholds on the Rules page. Select a check to see what it found.</p></div></div>
      <div class="check-stages">${r.stages.map((s) => {
        const cs = r.checks.filter((c) => c.stage === s.id);
        const pass = cs.filter((c) => c.ran && (c.status === 'pass' || c.status === 'note')).length;
        return `<section class="check-stage">
          <header><span class="eyebrow">${esc(s.phase)}</span><h3>${esc(s.title)}</h3><span class="sys">${esc(s.systems)}</span><span class="res">${s.ran ? `${pass} of ${cs.length} pass` : 'No data loaded'}${PRE.includes(s.id) ? ' · gates release' : ' · after settlement'}</span></header>
          <ul>${cs.map((c) => {
            const st = !c.ran ? 'idle' : c.status;
            const list = r.exceptions.filter((x) => x.check === c.id);
            const open = list.filter(isOpen).length;
            const res = !c.ran ? '<span class="muted">No data</span>'
              : c.status === 'pass' ? '<span class="pill pass">Pass</span>'
                : c.status === 'note' ? `<span class="pill info">${plural(c.count, 'note')}</span>`
                  : `<span class="pill ${c.status === 'fail' ? 'blocker' : 'review'}">${c.count} found${open < c.count ? ` · ${open} open` : ''}</span>`;
            return `<li><button class="check-row" type="button" data-action="check" data-check="${c.id}" ${c.count ? '' : 'aria-disabled="true"'}>
              <span class="glyph ${st}">${GLYPH[st]}</span><span class="id">${c.id}</span><span class="t">${esc(c.title)}</span><span class="rule">${esc(c.rule)}</span><span class="res">${res}</span>
            </button></li>`;
          }).join('')}</ul>
        </section>`;
      }).join('')}</div>`;
  }

  // ----------------------------------------------------------------------------------
  // Data sources
  // ----------------------------------------------------------------------------------

  function renderSources() {
    const p = state.result.period;
    const card = (def) => {
      const s = state.src[def.key] || {};
      const mode = s.mode || 'upload';
      const busy = state.busy[def.key];
      const loaded = !!(s.rows || s.json);
      const count = s.rows ? plural(s.rows.length, 'record') : s.json ? 'Policy loaded' : '';
      const schema = SCHEMA_OF[def.key] && E.SCHEMAS[SCHEMA_OF[def.key]];
      const accept = def.kind === 'json' ? '.json,application/json' : def.kind === 'register' ? '.csv,.pdf,text/csv,application/pdf' : '.csv,text/csv';
      const api = def.api ? def.api.replace('{start}', p.start).replace('{end}', p.end) : '';
      let status;
      if (busy) status = `<span class="conn idle">${esc(busy)}</span>`;
      else if (!loaded) status = '<span class="conn bad">Not loaded</span>';
      else if (mode === 'api' && s.origin === 'api') status = `<span class="conn ok">Connected</span><span>${esc(count)}</span><span class="muted">synced ${esc(clock(s.at))}</span>`;
      else if (mode === 'api') status = `<span class="conn idle">Connector ready</span><span class="muted">using ${esc(s.name)} until the first sync</span>`;
      else status = `<span class="conn ok">Loaded</span><span>${esc(count)}</span><span class="muted mono">${esc(s.name || '')}</span><span class="muted">${s.format === 'pdf' ? 'PDF extract' : s.origin === 'sample' ? 'sample file' : 'uploaded'}${s.at ? ' · ' + esc(clock(s.at)) : ''}</span>`;
      const dl = window.PA_HOSTED && SAMPLE.files[def.file] ? `<a class="linkish" style="font-size:var(--t-xs)" href="${sampleUrl(def.file)}" download="${esc(def.file)}">Download sample ${def.kind === 'json' ? 'JSON' : 'CSV'}</a>${def.kind === 'register' && SAMPLE.registerPdfBase64 ? ` <a class="linkish" style="font-size:var(--t-xs)" href="${sampleUrl('payroll_register.pdf')}" download="payroll_register.pdf">PDF</a>` : ''}` : '';
      return `<article class="source" id="src-${def.key}">
        <header><span class="src-icon">${ICON[def.icon]}</span><div style="flex:1;min-width:0"><h4>${esc(def.title)}</h4><div class="sys">${esc(def.sys)}</div></div>
          ${def.api ? `<div class="seg" role="group" aria-label="${esc(def.title)} connection">
            <button type="button" data-action="mode" data-key="${def.key}" data-mode="upload" aria-pressed="${mode === 'upload'}">File</button>
            <button type="button" data-action="mode" data-key="${def.key}" data-mode="api" aria-pressed="${mode === 'api'}">API</button>
          </div>` : ''}
        </header>
        <p class="desc">${esc(def.desc)}</p>
        <div class="status">${status}</div>
        ${s.error ? `<div class="err" role="alert">${esc(s.error)}</div>` : ''}
        ${mode === 'api' && def.api ? `
          <div class="api">${esc(api)}</div>
          <div class="row"><button class="btn small" type="button" data-action="sync" data-key="${def.key}" ${busy ? 'disabled' : ''}>${ICON.refresh} Sync now</button>${isSampleWorkspace() || s.origin === 'api' ? '<span class="muted" style="font-size:var(--t-xs)">This workspace’s connector returns the sample cycle.</span>' : ''}</div>`
        : `<div class="row">
            <span class="btn small file-btn">${loaded ? 'Replace file' : 'Upload file'}<input type="file" id="file-${def.key}" data-key="${def.key}" accept="${accept}" aria-label="Upload ${esc(def.title)}"></span>
            ${def.kind === 'register' ? `<button class="btn small" type="button" data-action="sample-pdf" ${busy ? 'disabled' : ''}>Read sample PDF register</button>` : ''}
            ${s.origin !== 'sample' || s.format === 'pdf' ? `<button class="linkish" type="button" data-action="sample" data-key="${def.key}" style="font-size:var(--t-xs)">Use sample file</button>` : ''}
            ${dl}
          </div>`}
        ${def.key === 'register' && s.format === 'pdf' && s.rows ? pdfPreview(s) : ''}
        ${schema ? `<details><summary>Required columns (${schema.length})</summary><code>${esc(schema.join(', '))}</code></details>` : ''}
      </article>`;
    };
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>Data sources</h1><p>Each system connects by API or sends a batch file for the cycle. Replace any source and every check re-runs. The payroll census is the system of record for who is employed and when.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="load-sample">Load sample cycle</button><button class="btn small" type="button" data-action="new-cycle">Start a new cycle</button></div>
      </div>
      ${isSampleWorkspace() ? `<div class="notice" style="margin-bottom:8px"><span>${ICON.plug}</span><span>This workspace runs on the Northloom Apparel sample cycle (fictional data). Upload your own exports to run the same checks on your data. Files are read in this browser and are not sent anywhere.</span></div>` : '<div class="notice" style="margin-bottom:8px"><span>Files are read in this browser and are not sent anywhere. They are kept here so the cycle survives a refresh.</span></div>'}
      <div class="group-title"><h3>Systems of record</h3><span class="muted">WFM, payroll, bank and ERP data for one pay cycle</span></div>
      <div class="sources">${SOURCES.filter((s) => s.group === 'records').map(card).join('')}</div>
      <div class="group-title"><h3>Policies and mappings</h3><span class="muted">The rules each check applies. Adjust thresholds on the Rules page.</span></div>
      <div class="sources">${SOURCES.filter((s) => s.group === 'policy').map(card).join('')}</div>`;
  }

  function pdfPreview(s) {
    const rows = s.rows.slice(0, 4);
    return `<div class="pdf-preview">
      <p class="muted" style="margin-bottom:6px;font-size:var(--t-xs)">Extracted ${plural(s.rows.length, 'employee')} from ${plural(s.pages || 0, 'page')}${s.problems && s.problems.length ? ` · ${plural(s.problems.length, 'line')} skipped` : ''}. First rows:</p>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th class="n">Hours</th><th class="n">Gross</th><th class="n">Net</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="mono">${esc(r.emp_id)}</td><td>${esc(r.employee_name)}</td><td class="n">${F.fmtH(E.util.num(r.reg_hrs) + E.util.num(r.ot_hrs) + E.util.num(r.dt_hrs))}</td><td class="n">${F.money(E.util.num(r.gross_pay))}</td><td class="n">${F.money(E.util.num(r.net_pay))}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  function sourceChanged(def, msg) {
    recompute();
    if (!persistSources()) toast('These files are too large to keep after a refresh; they stay loaded for this session.');
    log('Source loaded', `${def.title}: ${msg}`);
    log('Checks re-run', `${state.result.totals.checksRun} checks · ${state.result.totals.blockers} blockers, ${state.result.totals.review} to review${diffText()}`, { by: 'Rollcall' });
    renderAll();
  }

  async function handleFile(key, file) {
    const def = SRC[key];
    const prev = state.src[key] || {};
    const mode = prev.mode || 'upload';
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        if (key !== 'register') throw new Error('Only the payroll register can be read from a PDF.');
        const buf = await file.arrayBuffer();
        await loadRegisterPdf(new Uint8Array(buf), file.name, 'upload');
        return;
      }
      const text = await file.text();
      if (def.kind === 'json') {
        let json;
        try { json = JSON.parse(text); } catch (e) { throw new Error(`${file.name} is not valid JSON.`); }
        state.src[key] = { json, name: file.name, origin: 'upload', mode, at: nowIso() };
      } else {
        const rows = E.parseCSV(text);
        const missing = E.missingColumns(SCHEMA_OF[key], rows);
        if (!rows.length) throw new Error(`${file.name} has no data rows.`);
        if (missing.length) throw new Error(`${file.name} is missing ${plural(missing.length, 'column')}: ${missing.join(', ')}. The previous file is still in use.`);
        state.src[key] = { rows, text, name: file.name, origin: 'upload', mode, format: 'csv', at: nowIso() };
      }
      sourceChanged(def, `${file.name}${state.src[key].rows ? ` · ${plural(state.src[key].rows.length, 'record')}` : ''}`);
      toast(`${def.title}: loaded ${file.name} · re-ran ${state.result.totals.checksRun} checks`);
    } catch (e) {
      state.src[key] = Object.assign({}, prev, { error: e.message });
      if (state.page === 'sources') renderSources();
    }
  }

  let pdfjsPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the PDF reader. Check the connection and try again.'));
      document.head.appendChild(s);
    });
  }
  function loadPdfJs() {
    if (!pdfjsPromise) {
      const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
      pdfjsPromise = loadScript(base + 'pdf.worker.min.js')
        .then(() => loadScript(base + 'pdf.min.js'))
        .then(() => {
          const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
          lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
          return lib;
        })
        .catch((e) => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }

  async function pdfLines(bytes) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const y = it.transform[5], x = it.transform[4];
        let row = rows.find((r) => Math.abs(r.y - y) <= 2);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, s: it.str });
      });
      rows.sort((a, b) => b.y - a.y).forEach((r) => lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s)));
    }
    return { lines, pages: doc.numPages };
  }

  async function loadRegisterPdf(bytes, name, origin) {
    const prev = state.src.register || {};
    state.busy.register = 'Reading the PDF register…';
    if (state.page === 'sources') renderSources();
    try {
      const { lines, pages } = await pdfLines(bytes);
      const { rows, problems } = E.parseRegisterLines(lines);
      if (!rows.length) throw new Error('No employee lines were found. Use a text-based register PDF; scanned images need OCR first.');
      state.src.register = { rows, name, origin, mode: prev.mode || 'upload', format: 'pdf', pages, problems, at: nowIso() };
      delete state.busy.register;
      sourceChanged(SRC.register, `${name} · ${plural(rows.length, 'employee')} extracted from ${plural(pages, 'PDF page')}`);
      toast(`Extracted ${plural(rows.length, 'employee')} from ${plural(pages, 'PDF page')} · re-ran ${state.result.totals.checksRun} checks`);
    } catch (e) {
      delete state.busy.register;
      state.src.register = Object.assign({}, prev, { error: e.message });
      if (state.page === 'sources') renderSources();
    }
  }

  const sampleUrls = {};
  function sampleUrl(name) {
    if (!sampleUrls[name]) {
      const blob = name.endsWith('.pdf') ? new Blob([samplePdfBytes()], { type: 'application/pdf' })
        : new Blob([SAMPLE.files[name]], { type: name.endsWith('.json') ? 'application/json' : 'text/csv' });
      sampleUrls[name] = URL.createObjectURL(blob);
    }
    return sampleUrls[name];
  }

  function samplePdfBytes() {
    const bin = atob(SAMPLE.registerPdfBase64 || '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadSampleCycle() {
    SOURCES.forEach((s) => { const m = state.src[s.key] && state.src[s.key].mode; loadSample(s.key, m === 'api' ? 'api' : 'sample'); if (m) state.src[s.key].mode = m; });
    recompute();
    persistSources();
    log('Sample cycle loaded', `Northloom Apparel ${cycleId()} · ${plural(state.result.totals.people, 'person', 'people')}`);
    renderAll();
    toast(`Loaded the sample cycle ${cycleId()} · ${state.result.totals.checksRun} checks ran`);
  }

  function startNewCycle() {
    const prev = cycleId();
    SOURCES.filter((s) => s.group === 'records').forEach((s) => { state.src[s.key] = { mode: (state.src[s.key] && state.src[s.key].mode) || 'upload', at: null }; });
    recompute();
    persistSources();
    log('New cycle started', `Cleared WFM, payroll, bank and GL data (previous cycle ${prev} and its history are kept)`, { cycle: prev });
    go('sources');
    renderShell();
    toast('Upload this cycle’s files. Policies and rules carry over.');
  }

  // ----------------------------------------------------------------------------------
  // Rules
  // ----------------------------------------------------------------------------------

  const RULE_GROUPS = [
    { title: 'Expected hours', src: 'Short-week check (T5) · handbook and union agreement', fields: [
      { key: 'unionFtWeekly', label: 'Union full-time week', unit: 'h' },
      { key: 'nonUnionFtWeekly', label: 'Non-union full-time week', unit: 'h' },
      { key: 'exemptWeekly', label: 'Exempt full-time week', unit: 'h' },
    ] },
    { title: 'Overtime and premiums', src: 'T6 and P4 · union agreement and FLSA', fields: [
      { key: 'unionOtAfter', label: 'Union overtime after', unit: 'h / week', step: 0.5 },
      { key: 'flsaOtAfter', label: 'Non-union overtime after', unit: 'h / week', step: 0.5 },
      { key: 'otMultiplier', label: 'Overtime multiplier', unit: '×', step: 0.25 },
      { key: 'sundayMultiplier', label: 'Union Sunday multiplier', unit: '×', step: 0.25 },
      { key: 'saturdayPremium', label: 'Union Saturday premium (paid at the overtime multiplier)', type: 'bool' },
    ] },
    { title: 'Limits', src: 'T4, T7, T8 · handbook', fields: [
      { key: 'ptMaxWeekly', label: 'Part-time weekly cap', unit: 'h', step: 0.5 },
      { key: 'dailyMaxHours', label: 'Daily maximum', unit: 'h', step: 0.5 },
      { key: 'scheduleVarianceHours', label: 'Flag days off schedule by', unit: 'h', step: 0.25 },
    ] },
    { title: 'Time capture', src: 'T1, T3 · handbook', fields: [
      { key: 'punchRounding', label: 'Punch rounding', type: 'select', options: [[1, 'None (exact minutes)'], [5, '5 minutes'], [6, '6 minutes (tenths)'], [15, '15 minutes (7-minute rule)']] },
      { key: 'mealRequiredAfter', label: 'Meal punch required after', unit: 'h', step: 0.5 },
    ] },
    { title: 'Vacation and sick', src: 'T10, P9, G7 · handbook', fields: [
      { key: 'drawFirst', label: 'Vacation draws from', type: 'select', options: [['carryover', 'Carryover first'], ['current', 'Current year first']] },
      { key: 'carryoverCap', label: 'Carryover cap', unit: 'h' },
      { key: 'waitingDays', label: 'Accrual waiting period', unit: 'days' },
    ] },
    { title: 'Statutory rates', src: 'P7 · federal', fields: [
      { key: 'ssRate', label: 'Social Security rate', unit: '%', pct: true, step: 0.05 },
      { key: 'medicareRate', label: 'Medicare rate', unit: '%', pct: true, step: 0.05 },
      { key: 'taxTolerance', label: 'Rounding tolerance', unit: '$', step: 0.01 },
    ] },
  ];
  const RULE_FIELDS = RULE_GROUPS.flatMap((g) => g.fields);

  const ruleValue = (f, cfg) => (f.pct ? +(cfg[f.key] * 100).toFixed(4) : cfg[f.key]);
  const ruleDisplay = (f, v) => {
    if (f.type === 'bool') return v ? 'on' : 'off';
    if (f.type === 'select') { const o = f.options.find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
    return `${f.pct ? +(v * 100).toFixed(4) : v}${f.unit === 'h' || f.unit === 'h / week' ? 'h' : f.unit === '×' ? '×' : f.unit === '%' ? '%' : f.unit === '$' ? '' : ' ' + f.unit}`;
  };
  const hintHtml = (f, def) => {
    const changed = Object.prototype.hasOwnProperty.call(store.settings, f.key);
    return changed ? `Changed from policy ${esc(ruleDisplay(f, def[f.key]))} · <button class="linkish" type="button" data-action="reset-rule" data-key="${f.key}">Reset</button>` : `Policy: ${esc(ruleDisplay(f, def[f.key]))}`;
  };

  function renderRules() {
    const def = policyDefaults();
    const cfg = state.result.config;
    const ua = input().agreement || {};
    const glm = input().glMap || {};
    const control = (f) => {
      const id = 'rule-' + f.key;
      if (f.type === 'bool') return `<input type="checkbox" id="${id}" data-rule="${f.key}" ${cfg[f.key] ? 'checked' : ''}>`;
      if (f.type === 'select') return `<select id="${id}" data-rule="${f.key}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(cfg[f.key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      return `<input type="number" inputmode="decimal" id="${id}" data-rule="${f.key}" value="${esc(ruleValue(f, cfg))}" step="${f.step || 1}" min="0">`;
    };
    const steps = ua.steps || [];
    const rates = ua.rates || {};
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>Rules</h1><p>Thresholds start from the loaded union agreement and employee handbook. Change one and every check re-runs; exceptions, exposure and the release brief update with it. Changes are logged.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="reset-rules" ${Object.keys(store.settings).length ? '' : 'disabled'}>Reset all to policy</button></div>
      </div>
      <div class="rules">
        ${RULE_GROUPS.map((g) => `<section class="rule-card"><div><h4>${esc(g.title)}</h4><p class="src">${esc(g.src)}</p></div>
          ${g.fields.map((f) => `<div class="rule"><label for="rule-${f.key}">${esc(f.label)}${f.unit && f.type !== 'bool' && f.type !== 'select' ? ` <span class="muted">(${esc(f.unit)})</span>` : ''}</label>${control(f)}<p class="hint ${Object.prototype.hasOwnProperty.call(store.settings, f.key) ? 'changed' : ''}" id="hint-${f.key}">${hintHtml(f, def)}</p></div>`).join('')}
        </section>`).join('')}
        <section class="rule-card rule-wide"><div><h4>${esc(ua.union || 'Union')} pay scale</h4><p class="src">P2 · ${esc(ua.name || 'Agreement')}${ua.effective ? ` · effective ${esc(longDate(ua.effective))} to ${esc(longDate(ua.expires))}` : ''} · ${esc(ua.step_basis || '')}</p></div>
          <div class="table-wrap"><table><thead><tr><th>Title</th>${steps.map((s) => `<th class="n">Step ${s.step}<br><span style="text-transform:none;letter-spacing:0">${esc(s.label)}</span></th>`).join('')}</tr></thead>
          <tbody>${Object.entries(rates).map(([t, r]) => `<tr><td>${esc(t)}</td>${r.map((v) => `<td class="n">${F.money(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        </section>
        <section class="rule-card rule-wide"><div><h4>GL mapping</h4><p class="src">G2–G7 · ${esc(glm.name || '')}</p></div>
          <div class="kv">
            ${Object.entries(glm.wage_account_by_class || {}).map(([k, a]) => `<div><span>${esc(k.toLowerCase())} wages</span><b class="mono">${esc(a)}</b> ${esc((glm.accounts || {})[a] || '')}</div>`).join('')}
            <div><span>Overtime & premium</span><b class="mono">${esc(glm.premium_account)}</b></div>
            <div><span>Paid time off</span><b class="mono">${esc(glm.pto_account)}</b></div>
            <div><span>Employer taxes</span><b class="mono">${esc(glm.employer_tax_account)}</b></div>
            <div><span>Suspense</span><b class="mono">${esc(glm.suspense_account)}</b></div>
          </div>
          <p style="font-size:var(--t-sm)"><span class="muted">Mapped cost centers:</span> ${Object.entries(glm.cost_centers || {}).map(([cc, n]) => `<span class="mono">${esc(cc)}</span> ${esc(n)}`).join(' · ')}</p>
        </section>
      </div>`;
  }

  function updateRuleHints() {
    const def = policyDefaults();
    RULE_FIELDS.forEach((f) => {
      const el = $('#hint-' + f.key);
      if (!el) return;
      el.className = 'hint' + (Object.prototype.hasOwnProperty.call(store.settings, f.key) ? ' changed' : '');
      el.innerHTML = hintHtml(f, def);
    });
    const btn = document.querySelector('[data-action="reset-rules"]');
    if (btn) btn.disabled = !Object.keys(store.settings).length;
  }

  let rerunTimer = null;
  function onRuleInput(el) {
    const key = el.dataset.rule;
    const f = RULE_FIELDS.find((x) => x.key === key);
    const def = policyDefaults();
    let v;
    if (f.type === 'bool') v = el.checked;
    else if (f.type === 'select') v = typeof def[key] === 'number' ? Number(el.value) : el.value;
    else {
      if (el.value === '' || !Number.isFinite(Number(el.value))) return;
      v = Number(el.value);
      if (f.pct) v = +(v / 100).toFixed(6);
    }
    if (v === def[key] || (typeof v === 'number' && Math.abs(v - def[key]) < 1e-9)) delete store.settings[key];
    else store.settings[key] = v;
    save();
    updateRuleHints();
    scheduleRerun(`${f.label}: ${ruleDisplay(f, v)}`);
  }

  function scheduleRerun(what) {
    clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => {
      const before = state.result.totals;
      recompute();
      const t = state.result.totals;
      log('Rule changed', `${what} · ${t.blockers} blockers (was ${before.blockers}), ${t.review} to review (was ${before.review})${diffText()}`);
      state.keepRules = true;
      renderAll();
      state.keepRules = false;
      toast(`${what} · ${t.blockers} blockers (was ${before.blockers}), ${t.review} to review (was ${before.review})`);
    }, 400);
  }

  // ----------------------------------------------------------------------------------
  // Reports
  // ----------------------------------------------------------------------------------

  function briefModel() {
    const r = state.result, t = r.totals, p = r.period, rd = readiness();
    const unresolved = r.exceptions.filter(isOpen);
    const review = unresolved.filter((x) => x.severity === 'review');
    const accepted = r.exceptions.filter((x) => x.severity !== 'info' && statusOf(x) === 'accepted');
    const resolved = r.exceptions.filter((x) => x.severity !== 'info' && statusOf(x) === 'resolved');
    const line = (x) => {
      const who = x.empId ? `${x.empId} ${x.empName}` : 'Cycle';
      const amt = x.impact ? ` (${F.money(x.impact.amount)} ${KIND_WORD[x.impact.kind]}${x.impact.estimated ? ', est.' : ''})` : '';
      return `${who}: ${x.title}${amt}. ${x.action || ''}`.trim();
    };
    const acceptedLine = (x) => `${x.empId ? `${x.empId} ${x.empName}` : 'Cycle'}: ${x.title}. Reason: ${lastNote(x) || 'not recorded'}`;
    const oi = openImpact();
    const imp = oi.amount;
    let first;
    if (rd.state === 'nodata') first = 'WAITING FOR DATA. Load the census, time records and payroll register to evaluate this cycle.';
    else if (rd.state === 'blocked') first = `HOLD. ${rd.preOpen.length} of ${plural(rd.pre.length, 'pre-release blocker')} open${rd.pre.length - rd.preOpen.length ? ` (${rd.pre.length - rd.preOpen.length} cleared)` : ''}; ${rd.postOpen.length} funding and GL blockers and ${review.length} review items also open.`;
    else if (rd.state === 'ready') first = `READY TO RELEASE. ${rd.pre.length ? `All ${plural(rd.pre.length, 'pre-release blocker')} cleared: ${rd.resolved.length} resolved, ${rd.accepted.length} accepted as risk.` : 'Every pre-release check passed.'}${rd.postOpen.length ? ` ${rd.postOpen.length} funding and GL blockers tracked after settlement.` : ''}`;
    else first = `RELEASED ${stamp(rd.released.at)} by ${rd.released.by}${rd.released.note ? ` — “${rd.released.note}”` : ''}.${rd.postOpen.length ? ` ${rd.postOpen.length} funding and GL blockers still open.` : ''}`;
    const money = KINDS.filter((k) => imp[k.kind]);
    const second = money.length
      ? `Open exposure: ${money.map((k) => `${F.money(imp[k.kind])} ${k.kind === 'underpaid' ? `owed to ${plural(oi.people.underpaid, 'employee')}` : k.kind === 'overpaid' ? `overpaid across ${plural(oi.people.overpaid, 'employee')}` : k.label.toLowerCase()}`).join('; ')}.`
      : 'No open dollar exposure.';
    return { r, t, p, rd, review, accepted, resolved, line, acceptedLine, lead: [first, second] };
  }

  function renderReports() {
    const m = briefModel();
    const section = (title, groups, fn) => groups.length ? `<h4>${esc(title)}</h4>${groups.map(([o, list]) => `<h5>${esc(o)} · ${list.length}</h5><ul>${list.map((x) => `<li>${esc((fn || m.line)(x))}</li>`).join('')}</ul>`).join('')}` : '';
    const reports = [
      { title: 'Release brief', desc: 'Readiness, open exposure and every open item by owner, for the payroll manager, controller and store operations.', btns: `<button class="btn small" type="button" data-action="download-brief">${ICON.download} .txt</button><button class="btn small" type="button" data-action="copy-brief">Copy</button>` },
      { title: 'Exception register', desc: `All ${state.result.exceptions.length} exceptions with status, owner, expected vs actual, impact and notes.`, btns: `<button class="btn small" type="button" data-action="export-ex-all">${ICON.download} .csv</button>` },
      { title: 'Pay variance', desc: 'Register gross against validated gross for every employee, with hours from WFM and the register.', btns: `<button class="btn small" type="button" data-action="export-variance">${ICON.download} .csv</button>` },
      { title: 'Audit trail', desc: 'Every status change, note, reassignment, rule change, data load, re-run and release for this cycle.', btns: `<button class="btn small" type="button" data-action="export-audit">${ICON.download} .csv</button>` },
    ];
    $('#page').innerHTML = `
      <div class="page-head"><div><h1>Reports</h1><p>Generated from the latest run and the current status of every item. Downloads are built in this browser.</p></div></div>
      <div class="reports">${reports.map((r) => `<article class="report"><h4>${esc(r.title)}</h4><p>${esc(r.desc)}</p><div class="actions-row">${r.btns}</div></article>`).join('')}</div>
      <div id="copyFallback"></div>
      <article class="brief" aria-label="Release brief">
        <div class="memo-head">
          <span class="eyebrow">Release brief · batch ${esc(cycleId())}</span>
          <h3>${esc(store.workspace)}, pay period ${esc(periodText(m.p))}</h3>
          <span class="muted">${m.p.payDate ? `Pay date ${esc(F.fmtDate(m.p.payDate))} · ` : ''}${m.t.checksRun} checks across ${plural(m.t.people, 'person', 'people')} · generated ${esc(stamp(nowIso()))}</span>
        </div>
        ${m.lead.map((l) => `<p class="lead">${esc(l)}</p>`).join('')}
        ${section('Open before release', byOwner(m.rd.preOpen))}
        ${section('After settlement — treasury and GL', byOwner(m.rd.postOpen))}
        ${section('Review before close', byOwner(m.review))}
        ${m.accepted.length ? section('Accepted as risk', [['Accepted', m.accepted]], m.acceptedLine) : ''}
        ${m.resolved.length ? `<h4>Resolved</h4><p class="muted">${plural(m.resolved.length, 'item')} resolved this cycle. See the exception register for notes.</p>` : ''}
      </article>`;
  }

  function briefText() {
    const m = briefModel();
    const out = [];
    out.push(`RELEASE BRIEF — ${store.workspace} — batch ${cycleId()}`);
    out.push(`Pay period ${periodText(m.p)}${m.p.payDate ? ` · pay date ${F.fmtDate(m.p.payDate)}` : ''} · generated ${stamp(nowIso())}`);
    out.push('');
    m.lead.forEach((l) => out.push(l));
    const sec = (title, groups, fn) => {
      if (!groups.length) return;
      out.push('', title.toUpperCase());
      groups.forEach(([o, list]) => { out.push(`${o} (${list.length})`); list.forEach((x) => out.push(`  - ${(fn || m.line)(x)}`)); });
    };
    sec('Open before release', byOwner(m.rd.preOpen));
    sec('After settlement — treasury and GL', byOwner(m.rd.postOpen));
    sec('Review before close', byOwner(m.review));
    if (m.accepted.length) sec('Accepted as risk', [['Accepted', m.accepted]], m.acceptedLine);
    if (m.resolved.length) out.push('', `${plural(m.resolved.length, 'item')} resolved this cycle.`);
    out.push('', `${m.t.checksRun} checks run across ${plural(m.t.people, 'person', 'people')}.`);
    return out.join('\n');
  }

  function auditCSV() {
    return E.toCSV(store.audit.map((a) => ({ time: a.t, cycle: a.cycle, by: a.by, action: a.action, detail: a.detail })), ['time', 'cycle', 'by', 'action', 'detail']);
  }

  function download(name, text, type) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast(`Downloaded ${name}`);
    } catch (e) {
      copyText(text, $('#copyFallback'), name);
    }
  }

  function copyText(text, fallbackEl, what) {
    const show = () => {
      if (!fallbackEl) { toast('Copy was blocked by the browser'); return; }
      fallbackEl.innerHTML = `<p class="muted" style="margin:6px 0">Copy was blocked here. The text is selected below: press Ctrl+C or ⌘C.</p><textarea class="copy-fallback" readonly></textarea>`;
      const ta = fallbackEl.querySelector('textarea');
      ta.value = text;
      ta.focus();
      ta.select();
    };
    try {
      navigator.clipboard.writeText(text).then(() => toast(`Copied ${what}`), show);
    } catch (e) { show(); }
  }

  // ----------------------------------------------------------------------------------
  // Activity and settings
  // ----------------------------------------------------------------------------------

  function renderActivity() {
    const scope = state.activityScope || 'cycle';
    const list = store.audit.filter((a) => scope === 'all' || a.cycle === cycleId());
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>Activity</h1><p>An append-only log of who did what: status changes, notes, reassignments, rule changes, data loads, check runs and releases.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="export-audit">${ICON.download} Export CSV</button></div>
      </div>
      <div class="toolbar"><div class="seg" role="group" aria-label="Scope">
        <button type="button" data-action="activity-scope" data-scope="cycle" aria-pressed="${scope === 'cycle'}">This cycle <span class="n">${store.audit.filter((a) => a.cycle === cycleId()).length}</span></button>
        <button type="button" data-action="activity-scope" data-scope="all" aria-pressed="${scope === 'all'}">All cycles <span class="n">${store.audit.length}</span></button>
      </div></div>
      ${list.length ? `<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>Cycle</th></tr></thead>
        <tbody>${list.slice(0, 300).map((a) => `<tr ${a.ref && exByKey(a.ref) && a.cycle === cycleId() ? `class="clickable" data-action="goto-ex" data-key="${esc(a.ref)}"` : ''}>
          <td class="mono" style="font-size:var(--t-xs)">${esc(stamp(a.t))}</td>
          <td><span style="display:inline-flex;gap:8px;align-items:center"><span class="avatar ${a.by === 'Rollcall' ? 'sys' : ''}" aria-hidden="true">${a.by === 'Rollcall' ? 'RC' : esc(initials(a.by))}</span>${esc(a.by)}</span></td>
          <td><b>${esc(a.action)}</b></td><td class="wrap">${esc(a.detail)}</td><td class="mono" style="font-size:var(--t-xs)">${esc(a.cycle)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="table-wrap"><div class="empty"><h3>No activity yet</h3><p>Work an exception, change a rule or re-run the checks and it shows up here.</p></div></div>'}`;
  }

  function renderSettings() {
    $('#page').innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><p>Preferences for this browser.</p></div></div>
      <div class="settings">
        <section class="card"><div class="card-head"><h3>You</h3></div><div class="card-body">
          <label for="setName">Your name</label>
          <input class="text" id="setName" value="${esc(store.user)}" autocomplete="name">
          <p class="muted" style="font-size:var(--t-sm)">Shown on status changes, notes and release approvals.</p>
        </div></section>
        <section class="card"><div class="card-head"><h3>Workspace</h3></div><div class="card-body">
          <label for="setWs">Company name</label>
          <input class="text" id="setWs" value="${esc(store.workspace)}" autocomplete="organization">
          <p class="muted" style="font-size:var(--t-sm)">Used in the sidebar, the release brief and exports.</p>
        </div></section>
        <section class="card"><div class="card-head"><h3>Appearance</h3></div><div class="card-body">
          <div class="seg" role="group" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-action="theme" data-theme="${v}" aria-pressed="${store.theme === v}">${l}</button>`).join('')}</div>
        </div></section>
        <section class="card"><div class="card-head"><h3>Data in this browser</h3></div><div class="card-body">
          <p style="font-size:var(--t-sm)">${plural(Object.keys(store.cycles).length, 'cycle')}, ${plural(store.audit.length, 'activity entry', 'activity entries')} and ${plural(Object.keys(store.settings).length, 'rule change')} are stored here. Clearing them resets statuses, notes, releases and the activity log, and reloads the sample cycle.</p>
          <div><button class="btn small danger" type="button" data-action="reset-workspace">Clear workspace data…</button></div>
        </div></section>
      </div>`;
  }

  // ----------------------------------------------------------------------------------
  // Employee drawer
  // ----------------------------------------------------------------------------------

  function openDrawer(id, opener) {
    state.drawer = id;
    state.drawerOpener = opener || null;
    renderDrawer();
    $('#drawer').hidden = false;
    $('#scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    const c = $('#drawer .close');
    if (c) c.focus();
  }
  function closeDrawer() {
    state.drawer = null;
    $('#drawer').hidden = true;
    $('#scrim').hidden = !(state.detail && !wide() && state.page === 'exceptions');
    document.body.style.overflow = '';
    if (state.drawerOpener && document.body.contains(state.drawerOpener)) state.drawerOpener.focus();
  }

  function renderDrawer() {
    const r = state.result;
    const e = r.empById[state.drawer];
    if (!e) { closeDrawer(); return; }
    const c = e.census;
    const R = e.R;
    const n = E.util.num;
    const meta = [
      e.id, e.title, e.cls ? e.cls.label : 'Not in payroll', e.location + (e.cc ? ` (${e.cc})` : ''),
      c ? (e.cls.salaried ? `${F.money(n(c.annual_salary))}/yr` : `${F.money(n(c.hourly_rate))}/h census`) : '',
      c && c.hire_date ? `Hired ${longDate(c.hire_date)}` : '', c && c.term_date ? `Terminated ${longDate(c.term_date)}` : '',
    ].filter(Boolean);

    const exs = e.exceptions;
    const exHtml = exs.length
      ? `<div class="mini-ex">${exs.map((x) => `<button type="button" data-action="goto-ex" data-key="${esc(x.key)}"><span class="h"><span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span>${statusPill(statusOf(x))}<span class="mono muted" style="font-size:var(--t-xs)">${esc(x.check)}</span>${esc(x.title)}${x.impact ? ` <span class="mono" style="margin-left:auto">${F.money(x.impact.amount)}</span>` : ''}</span><p>${esc(x.detail)}</p></button>`).join('')}</div>`
      : '<p class="muted">No exceptions. Time, pay, deposit and balances tie out.</p>';

    const tcRows = () => {
      const rows = [];
      [0, 1].forEach((w) => {
        const days = e.days.filter((d) => d.week === w);
        days.forEach((d) => {
          const flags = d.records.flatMap((a) => a.flags);
          const crit = flags.some((f) => f === 'MISSING_OUT' || f === 'MISSING_IN' || f === 'NO_PUNCH');
          const outside = c && !d.inWindow;
          const noShow = d.schedHours > 0 && !d.records.length && !outside;
          const unsched = d.schedHours === 0 && d.worked > 0 && e.cls && !e.cls.exempt;
          const warn = !crit && (flags.length > 0 || noShow || unsched);
          const s = d.sched[0];
          const reg = d.records.filter((a) => a.code === 'REG');
          const p = (k) => reg.map((a) => a.raw[k]).filter(Boolean).join(', ');
          const meal = reg.filter((a) => a.raw.meal_out || a.raw.meal_in).map((a) => `${a.raw.meal_out || '?'}–${a.raw.meal_in || '?'}`).join(', ');
          const tags = [
            ...Object.entries(d.pto).map(([k, v]) => `<span class="tag-s pto">${esc(k)} ${F.fmtH(v)}</span>`),
            ...Array.from(new Set(flags)).map((f) => `<span class="tag-s ${f === 'MISSING_OUT' || f === 'MISSING_IN' || f === 'NO_PUNCH' ? 'crit' : 'warn'}">${esc(FLAG_LABEL[f] || f)}</span>`),
            ...reg.filter((a) => a.override).map((a) => `<span class="muted">by ${esc(a.raw.override_by)}</span>`),
            noShow ? '<span class="tag-s warn">No-show</span>' : '',
            unsched ? '<span class="tag-s warn">Unscheduled</span>' : '',
            outside && (d.records.length || d.sched.length) ? `<span class="tag-s crit">${e.hire && d.date < e.hire ? 'Before hire date' : 'After termination'}</span>` : '',
          ].filter(Boolean).join(' ');
          const empty = !s && !d.records.length;
          rows.push(`<tr class="${outside ? 'out' : ''} ${crit ? 'flagged' : warn ? 'warned' : ''}">
            <td class="day">${esc(F.fmtDate(d.date))}</td>
            <td class="p">${s ? `${esc(s.shift_start)}–${esc(s.shift_end)}` : '<span class="muted">Off</span>'}</td>
            <td class="p">${esc(p('punch_in'))}</td><td class="p">${esc(meal)}</td><td class="p">${esc(p('punch_out'))}</td>
            <td class="h">${reg.length ? F.fmtH(d.worked) : empty ? '' : '—'}</td>
            <td class="tags">${tags}</td></tr>`);
        });
        const tot = sum(days.filter((d) => !c || d.inWindow), (d) => d.worked);
        const pto = sum(days.filter((d) => !c || d.inWindow), (d) => d.ptoHours);
        rows.push(`<tr class="week"><td colspan="5">Week ${w + 1} · ${esc(F.md(days[0].date))}–${esc(F.md(days[6].date))}</td><td class="h">${F.fmtH(tot)}</td><td>${pto ? `+ ${F.fmtH(pto)} time off` : ''}</td></tr>`);
      });
      return `<div class="table-wrap timecard"><table><thead><tr><th>Day</th><th>Scheduled</th><th>In</th><th>Meal</th><th>Out</th><th class="n">Worked</th><th>Notes</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    };

    let payHtml = '<p class="muted">Not on the payroll register.</p>';
    if (R && c) {
      const x = e.expSplit || { reg: 0, ot: 0, dt: 0 };
      const rowsH = e.cls.salaried
        ? [
          ['Period salary', F.money(e.salaryPeriod) + (e.prorate < 1 ? ` (${Math.round(e.prorate * 10)}/10 days)` : ''), F.money(R.reg_pay + R.pto_pay)],
          ['Overtime pay', F.money(0), F.money(R.ot_pay + R.dt_pay)],
          ['Vacation / sick / holiday h', `${F.fmtH(e.ptoIn.VAC)} / ${F.fmtH(e.ptoIn.SICK)} / ${F.fmtH(e.ptoIn.HOL)}`, `${F.fmtH(R.vac_hrs)} / ${F.fmtH(R.sick_hrs)} / ${F.fmtH(R.hol_hrs)}`],
          ['Gross', F.money(e.expectedGross), F.money(R.gross_pay)],
        ]
        : [
          ['Rate', `${F.money(e.rate)} · ${esc(e.rateSource)}`, F.money(R.rate)],
          ['Regular h', F.fmtH(x.reg), F.fmtH(R.reg_hrs)],
          [`Overtime h (${r.config.otMultiplier}×)`, F.fmtH(x.ot), F.fmtH(R.ot_hrs)],
          [`Sunday h (${r.config.sundayMultiplier}×)`, F.fmtH(x.dt), F.fmtH(R.dt_hrs)],
          ['Vacation / sick / holiday h', `${F.fmtH(e.ptoIn.VAC)} / ${F.fmtH(e.ptoIn.SICK)} / ${F.fmtH(e.ptoIn.HOL)}`, `${F.fmtH(R.vac_hrs)} / ${F.fmtH(R.sick_hrs)} / ${F.fmtH(R.hol_hrs)}`],
          ['Gross', F.money(e.expectedGross), F.money(R.gross_pay)],
        ];
      const diff = E.util.r2(R.gross_pay - e.expectedGross);
      payHtml = `<div class="table-wrap"><table><thead><tr><th></th><th class="n">Validated</th><th class="n">Register</th></tr></thead><tbody>
        ${rowsH.map(([k, a, b]) => `<tr><td>${esc(k)}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`).join('')}
        <tr><td>Difference</td><td class="n"></td><td class="n">${diff === 0 ? '<span class="muted">$0.00</span>' : `<span class="${diff > 0 ? 'pos' : 'neg'}">${F.signedMoney(diff)}</span>`}</td></tr>
        <tr><td>Taxes and deductions</td><td class="n"></td><td class="n">${F.money(R.gross_pay - R.net_pay)}</td></tr>
        <tr><td>Net pay</td><td class="n"></td><td class="n">${F.money(R.net_pay)}</td></tr>
      </tbody></table></div>`;
    } else if (R) {
      payHtml = `<p class="muted">On the register (${F.money(R.gross_pay)} gross, ${F.money(R.net_pay)} net) with no census record.</p>`;
    }

    let balHtml = '';
    if (R && c && e.expBalances) {
      const b = e.expBalances;
      balHtml = `<section><h4>Time-off balances (hours)</h4><div class="table-wrap"><table><thead><tr><th></th><th class="n">Opening</th><th class="n">Validated close</th><th class="n">Register close</th></tr></thead><tbody>
        <tr><td>Vacation carryover</td><td class="n">${F.fmtH(n(c.vac_carryover_hrs))}</td><td class="n">${F.fmtH(b.co)}</td><td class="n">${F.fmtH(R.vac_co_end)}</td></tr>
        <tr><td>Vacation current year</td><td class="n">${F.fmtH(n(c.vac_current_hrs))}</td><td class="n">${F.fmtH(b.cur)}${b.accrual ? ` <span class="muted">(+${F.fmtH(b.accrual)})</span>` : ''}</td><td class="n">${F.fmtH(R.vac_cur_end)}</td></tr>
        <tr><td>Sick</td><td class="n">${F.fmtH(n(c.sick_hrs))}</td><td class="n">${F.fmtH(b.sick)}</td><td class="n">${F.fmtH(R.sick_end)}</td></tr>
      </tbody></table></div></section>`;
    }

    const depHtml = e.ach.length
      ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Account</th><th class="n">Amount</th></tr></thead><tbody>${e.ach.map((b) => `<tr><td>${esc(F.fmtDate(b.value_date))}</td><td>${b.txn_type === 'ACH_RETURN' ? `<span class="pill blocker">Return ${esc(b.return_code)}</span>` : 'Direct deposit'}</td><td class="mono">****${esc(b.account_last4)}${c && c.bank_last4 && b.account_last4 !== c.bank_last4 ? ` <span class="muted">(on file ****${esc(c.bank_last4)})</span>` : ''}</td><td class="n">${F.money(n(b.amount))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No deposits in the bank file.</p>';

    $('#drawer').innerHTML = `
      <div class="drawer-head">
        <div><span class="eyebrow">Employee</span><h3 id="drawerTitle">${esc(e.name)}</h3><div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div></div>
        <button class="btn small close" type="button" data-action="close-drawer">Close</button>
      </div>
      <div class="drawer-body">
        <section><h4>Exceptions · ${openFor(e).length} open</h4>${exHtml}</section>
        <section><h4>Timecard · scheduled vs worked</h4>${e.hasWfm ? tcRows() : '<p class="muted">No WFM profile, schedule or time records.</p>'}</section>
        <section><h4>Pay · validated vs register</h4>${payHtml}</section>
        ${balHtml}
        <section><h4>Deposits</h4>${depHtml}</section>
      </div>`;
  }

  // ----------------------------------------------------------------------------------
  // Modals: release, reopen, accept risk in bulk, new cycle, reset
  // ----------------------------------------------------------------------------------

  function openModal(html, opener) {
    state.modalOpener = opener || document.activeElement;
    const m = $('#modal');
    m.innerHTML = html;
    m.hidden = false;
    $('#modalScrim').hidden = false;
    const f = m.querySelector('[autofocus]') || m.querySelector('.mf .btn.primary') || m.querySelector('button');
    if (f) f.focus();
  }
  function closeModal() {
    $('#modal').hidden = true;
    $('#modalScrim').hidden = true;
    $('#modal').innerHTML = '';
    if (state.modalOpener && document.body.contains(state.modalOpener)) state.modalOpener.focus();
  }

  function releaseModal(opener) {
    const r = state.result, rd = readiness(), p = r.period;
    if (rd.state === 'nodata') {
      openModal(`<div class="mh"><h2 id="modalTitle">Nothing to release yet</h2></div>
        <div class="mb"><p>Load the census, time records and payroll register for ${esc(cycleId())}. Release opens once the time, roster and register checks have run.</p></div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Close</button><a class="btn primary" href="#sources" data-action="close-modal">Go to data sources</a></div>`, opener);
      return;
    }
    if (rd.state === 'blocked') {
      openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Release is blocked</h2></div>
        <div class="mb"><p>${plural(rd.preOpen.length, 'pre-release blocker')} ${rd.preOpen.length === 1 ? 'is' : 'are'} still open. Resolve each one, or accept it as a risk with a reason, and release opens.</p>
          <ul class="history">${rd.preOpen.slice(0, 8).map((x) => `<li><span class="pill blocker" style="grid-column:1/-1;justify-self:start">${esc(x.check)} · ${esc(ownerOf(x))}</span><span style="grid-column:1/-1">${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</span></li>`).join('')}</ul>
          ${rd.preOpen.length > 8 ? `<p class="muted">and ${rd.preOpen.length - 8} more</p>` : ''}</div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Close</button><button class="btn primary" type="button" data-action="go-blockers">Work the blockers</button></div>`, opener);
      return;
    }
    const n = E.util.num;
    openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())} · ${esc(periodText(p))}${p.payDate ? ` · pay ${esc(F.fmtDate(p.payDate))}` : ''}</span><h2 id="modalTitle">Approve and release payroll</h2></div>
      <div class="mb">
        <div class="ev">
          <div><span>Gross pay</span><b>${F.money(r.regTotals.gross)}</b></div>
          <div><span>Net pay</span><b>${F.money(r.regTotals.net)}</b></div>
          <div><span>Employees paid</span><b>${r.totals.onRegister}</b></div>
          <div><span>Employer taxes</span><b>${F.money(r.regTotals.erTax)}</b></div>
        </div>
        <p>${rd.pre.length ? `All ${plural(rd.pre.length, 'pre-release blocker')} are cleared: ${rd.resolved.length} resolved, ${rd.accepted.length} accepted as risk.` : 'Every time, roster and register check passed.'}</p>
        ${rd.accepted.length ? `<div><span class="eyebrow">Accepted as risk</span><ul class="history" style="margin-top:6px">${rd.accepted.map((x) => `<li style="grid-template-columns:1fr"><span><b>${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</b>${x.impact ? ` <span class="mono">${F.money(x.impact.amount)}</span>` : ''}<div class="note">${esc(lastNote(x) || 'No reason recorded')}</div></span></li>`).join('')}</ul></div>
          <label class="field" style="color:var(--ink)"><input type="checkbox" class="cb" id="relAck"> I reviewed the accepted risks above</label>` : ''}
        ${rd.postOpen.length ? `<div class="notice warn">${plural(rd.postOpen.length, 'funding and GL blocker', 'funding and GL blockers')} stay open after release for treasury and accounting.</div>` : ''}
        <label for="relNote"><b>Approval note</b> <span class="muted">(optional)</span></label>
        <textarea class="text" id="relNote" placeholder="e.g. Approved per payroll manager; E1012 re-issued by check"></textarea>
        <p class="muted">Approving as <b>${esc(store.user)}</b>. Change your name in Settings.</p>
        <p class="form-err" id="relErr" hidden></p>
      </div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-release">Release ${F.money(n(r.regTotals.net))} net pay</button></div>`, opener);
  }

  function confirmRelease() {
    const rd = readiness();
    if (rd.state !== 'ready') { closeModal(); return; }
    const ack = $('#relAck');
    if (ack && !ack.checked) { const e = $('#relErr'); e.textContent = 'Confirm you reviewed the accepted risks.'; e.hidden = false; ack.focus(); return; }
    const note = ($('#relNote').value || '').trim();
    const r = state.result;
    cyc().released = { at: nowIso(), by: store.user, note, gross: r.regTotals.gross, net: r.regTotals.net, people: r.totals.onRegister, resolved: rd.resolved.length, accepted: rd.accepted.map((x) => x.key), postOpen: rd.postOpen.length };
    log('Payroll released', `${F.money(r.regTotals.net)} net pay for ${plural(r.totals.onRegister, 'employee')} · ${rd.resolved.length} resolved, ${rd.accepted.length} accepted as risk${note ? ` — “${note}”` : ''}`);
    closeModal();
    afterWorkflow();
    toast(`${cycleId()} released`);
  }

  function releaseInfoModal(opener) {
    const rel = cyc().released;
    if (!rel) return;
    const acc = (rel.accepted || []).map(exByKey).filter(Boolean);
    openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Release record</h2></div>
      <div class="mb">
        <div class="ev">
          <div><span>Released</span><b>${esc(stamp(rel.at))}</b></div>
          <div><span>Approved by</span><b>${esc(rel.by)}</b></div>
          <div><span>Net pay</span><b>${F.money(rel.net)}</b></div>
          <div><span>Employees</span><b>${esc(rel.people)}</b></div>
        </div>
        ${rel.note ? `<div><span class="eyebrow">Approval note</span><div class="history"><div class="note">${esc(rel.note)}</div></div></div>` : ''}
        <p>${plural(rel.resolved || 0, 'blocker')} resolved and ${plural(acc.length, 'blocker')} accepted as risk at release.${rel.postOpen ? ` ${plural(rel.postOpen, 'funding or GL blocker', 'funding and GL blockers')} were open for after settlement.` : ''}</p>
        ${acc.length ? `<ul class="history">${acc.map((x) => `<li style="grid-template-columns:1fr"><span><b>${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</b><div class="note">${esc(lastNote(x) || 'No reason recorded')}</div></span></li>`).join('')}</ul>` : ''}
        <label for="reopenNote"><b>Reopen the cycle</b> <span class="muted">(reason required)</span></label>
        <textarea class="text" id="reopenNote" placeholder="Why the release is being reversed"></textarea>
        <p class="form-err" id="reopenErr" hidden></p>
      </div>
      <div class="mf"><button class="btn danger" type="button" data-action="confirm-reopen">Reopen cycle</button><button class="btn primary" type="button" data-action="close-modal">Done</button></div>`, opener);
  }

  function confirmReopen() {
    const note = ($('#reopenNote').value || '').trim();
    if (!note) { const e = $('#reopenErr'); e.textContent = 'Give a reason for reopening.'; e.hidden = false; $('#reopenNote').focus(); return; }
    cyc().released = null;
    log('Cycle reopened', `Release reversed — “${note}”`);
    closeModal();
    afterWorkflow();
    toast(`${cycleId()} reopened`);
  }

  function acceptModal(keys, opener) {
    openModal(`<div class="mh"><h2 id="modalTitle">Accept ${plural(keys.length, 'exception')} as risk</h2></div>
      <div class="mb"><p>Accepted items stop blocking release and are listed in the release brief and the release record with this reason.</p>
        <label for="acceptNote"><b>Reason</b></label>
        <textarea class="text" id="acceptNote" autofocus placeholder="e.g. Correction scheduled in the off-cycle run on 10/9"></textarea>
        <p class="form-err" id="acceptErr" hidden></p></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-accept" data-keys="${esc(keys.join('\n'))}">Accept as risk</button></div>`, opener);
  }

  // ----------------------------------------------------------------------------------
  // Popover, nav, run, toast
  // ----------------------------------------------------------------------------------

  let popover = null;
  function closePopover() {
    if (popover) { popover.remove(); popover = null; const b = document.querySelector('[data-action="cycle-menu"]'); if (b) b.setAttribute('aria-expanded', 'false'); }
  }
  function cycleMenu(btn) {
    if (popover) { closePopover(); return; }
    const rect = btn.getBoundingClientRect();
    const rd = readiness();
    const others = Object.entries(store.cycles).filter(([id, c]) => id !== cycleId() && (Object.values(c.items).some((i) => i.events.length) || c.released));
    popover = document.createElement('div');
    popover.className = 'popover';
    popover.setAttribute('role', 'menu');
    popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
    popover.style.left = `${Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 300))}px`;
    popover.innerHTML = `
      <button type="button" role="menuitem" data-action="load-sample"><b>Load sample cycle</b><small>Northloom Apparel PR-2026-19 · fictional data</small></button>
      <button type="button" role="menuitem" data-action="new-cycle"><b>Start a new cycle</b><small>Clear WFM, payroll, bank and GL data and upload files</small></button>
      ${rd.released ? '<hr><button type="button" role="menuitem" data-action="release-info"><b>Reopen this cycle</b><small>Reverse the release with a reason</small></button>' : ''}
      ${others.length ? `<hr>${others.map(([id, c]) => `<button type="button" role="menuitem" data-action="cycle-history" data-cycle="${esc(id)}"><b class="mono">${esc(id)}</b><small>${c.released ? `Released ${esc(stamp(c.released.at))} by ${esc(c.released.by)}` : 'Worked, not released'} · view activity</small></button>`).join('')}` : ''}`;
    document.body.appendChild(popover);
    btn.setAttribute('aria-expanded', 'true');
    const first = popover.querySelector('button');
    if (first) first.focus();
  }

  function closeNav() {
    $('#shell').classList.remove('nav-open');
    $('#navScrim').hidden = true;
  }

  async function rerun() {
    if (state.running) return;
    state.running = true;
    renderTopbar();
    if (!reduceMotion && state.page === 'overview' && $('#stages')) {
      for (let i = 0; i <= state.result.stages.length; i++) {
        $('#stages').innerHTML = stageButtons(i);
        await sleep(i === 0 ? 120 : 300);
      }
    } else await sleep(reduceMotion ? 0 : 350);
    recompute();
    state.running = false;
    const t = state.result.totals;
    log('Checks re-run', `${t.checksRun} checks · ${t.blockers} blockers, ${t.review} to review${diffText()}`, { by: 'Rollcall' });
    renderAll();
    toast(`Ran ${t.checksRun} checks across ${plural(t.people, 'person', 'people')}${diffText() || ' · no change'}`);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  // ----------------------------------------------------------------------------------
  // Events
  // ----------------------------------------------------------------------------------

  function noteValue() {
    const ta = $('#noteText');
    return ta ? ta.value.trim() : '';
  }

  document.addEventListener('click', (ev) => {
    if (popover && !popover.contains(ev.target) && !ev.target.closest('[data-action="cycle-menu"]')) closePopover();
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (el.closest('.popover')) closePopover();

    if (a === 'nav-toggle') { const open = !$('#shell').classList.contains('nav-open'); $('#shell').classList.toggle('nav-open', open); $('#navScrim').hidden = !open; el.setAttribute('aria-expanded', open); }
    else if (a === 'cycle-menu') cycleMenu(el);
    else if (a === 'load-sample') loadSampleCycle();
    else if (a === 'new-cycle') openModal(`<div class="mh"><h2 id="modalTitle">Start a new cycle</h2></div>
        <div class="mb"><p>This clears the census, schedules, time records, register, bank activity and GL journal so you can load this cycle’s files. The union agreement, handbook, GL mapping and your rule changes carry over.</p>
        <p>${esc(cycleId())} keeps its statuses, notes${cyc().released ? ', release record' : ''} and activity.</p></div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-new-cycle">Clear and start</button></div>`, el);
    else if (a === 'confirm-new-cycle') { closeModal(); startNewCycle(); }
    else if (a === 'cycle-history') { state.activityScope = 'all'; go('activity'); }
    else if (a === 'rerun') rerun();
    else if (a === 'release') releaseModal(el);
    else if (a === 'release-info') releaseInfoModal(el);
    else if (a === 'confirm-release') confirmRelease();
    else if (a === 'confirm-reopen') confirmReopen();
    else if (a === 'close-modal') closeModal();
    else if (a === 'go-blockers') { closeModal(); filterExceptions({ stage: 'pre', sev: { blocker: true, review: false, info: false } }); }
    else if (a === 'go-post') filterExceptions({ stage: 'post' });
    else if (a === 'filter-owner') filterExceptions(el.dataset.pre ? { owner: el.dataset.owner, stage: 'pre', sev: { blocker: true, review: false, info: false } } : { owner: el.dataset.owner });
    else if (a === 'stage') filterExceptions({ stage: el.dataset.stage });
    else if (a === 'kind') filterExceptions({ kind: el.dataset.kind, sev: { blocker: true, review: true, info: true } });
    else if (a === 'check') { if (el.getAttribute('aria-disabled') !== 'true') filterExceptions({ check: el.dataset.check, status: 'all' }); }
    else if (a === 'clear-filter') { state.filters[el.dataset.filter] = null; renderExceptions(); }
    else if (a === 'status-tab') { state.filters.status = el.dataset.status; renderQueue(); }
    else if (a === 'sev') { state.filters.sev[el.dataset.sev] = !state.filters.sev[el.dataset.sev]; renderQueue(); }
    else if (a === 'select-ex') { if (!ev.target.closest('.cb')) selectEx(el.dataset.key); }
    else if (a === 'toggle-sel') { const k = el.dataset.key; if (el.checked) state.sel.add(k); else state.sel.delete(k); renderBulk(); const all = $('#selAll'); if (all) all.checked = state.listKeys.length && state.listKeys.every((x) => state.sel.has(x)); }
    else if (a === 'close-detail') closeDetail();
    else if (a === 'goto-ex') {
      if (state.drawer) closeDrawer();
      state.filters = el.dataset.scope === 'pre'
        ? { status: 'all', sev: { blocker: true, review: false, info: false }, stage: 'pre', check: null, kind: null, owner: '', q: '' }
        : { status: 'all', sev: { blocker: true, review: true, info: true }, stage: '', check: null, kind: null, owner: '', q: '' };
      state.detail = el.dataset.key;
      go('exceptions');
    }
    else if (a === 'set-status') {
      const x = exByKey(state.detail);
      if (!x) return;
      const to = el.dataset.to;
      const note = noteValue();
      if (to === 'accepted' && !note) { const e = $('#noteErr'); e.textContent = 'Add a note explaining why this can be released as is.'; e.hidden = false; $('#noteText').focus(); return; }
      setStatus(x, to, note);
      afterWorkflow();
      toast(`${STATUS_VERB[to]}: ${x.title}`);
    } else if (a === 'add-note') {
      const x = exByKey(state.detail);
      const note = noteValue();
      if (!x) return;
      if (!note) { const e = $('#noteErr'); e.textContent = 'Write a note first.'; e.hidden = false; $('#noteText').focus(); return; }
      addNote(x, note);
      afterWorkflow();
      toast('Note added');
    } else if (a === 'bulk-status') {
      const to = el.dataset.to;
      let n = 0;
      state.sel.forEach((k) => { const x = exByKey(k); if (x && setStatus(x, to, '')) n++; });
      state.sel.clear();
      afterWorkflow();
      toast(`${STATUS_VERB[to]}: ${plural(n, 'exception')}`);
    } else if (a === 'bulk-accept') acceptModal(Array.from(state.sel), el);
    else if (a === 'confirm-accept') {
      const note = ($('#acceptNote').value || '').trim();
      if (!note) { const e = $('#acceptErr'); e.textContent = 'Give a reason.'; e.hidden = false; $('#acceptNote').focus(); return; }
      let n = 0;
      el.dataset.keys.split('\n').forEach((k) => { const x = exByKey(k); if (x && setStatus(x, 'accepted', note)) n++; });
      state.sel.clear();
      closeModal();
      afterWorkflow();
      toast(`Accepted as risk: ${plural(n, 'exception')}`);
    } else if (a === 'clear-sel') { state.sel.clear(); renderQueue(); }
    else if (a === 'open-emp') openDrawer(el.dataset.emp, el);
    else if (a === 'close-drawer') closeDrawer();
    else if (a === 'people-show') { state.people.show = el.dataset.show; renderPeople(); }
    else if (a === 'export-ex') download(`${cycleId()}-exceptions.csv`, exceptionsCSV(state.result.exceptions.filter((x) => matches(x))), 'text/csv');
    else if (a === 'export-ex-all') download(`${cycleId()}-exception-register.csv`, exceptionsCSV(state.result.exceptions), 'text/csv');
    else if (a === 'export-variance') download(`${cycleId()}-pay-variance.csv`, varianceCSV(), 'text/csv');
    else if (a === 'export-audit') download(`${cycleId()}-audit-trail.csv`, auditCSV(), 'text/csv');
    else if (a === 'download-brief') download(`${cycleId()}-release-brief.txt`, briefText(), 'text/plain');
    else if (a === 'copy-brief') copyText(briefText(), $('#copyFallback'), 'the brief');
    else if (a === 'activity-scope') { state.activityScope = el.dataset.scope; renderActivity(); }
    else if (a === 'mode') { const s = state.src[el.dataset.key] || (state.src[el.dataset.key] = {}); s.mode = el.dataset.mode; persistSources(); renderSources(); }
    else if (a === 'sync') {
      const key = el.dataset.key;
      state.busy[key] = 'Connecting…';
      renderSources();
      setTimeout(() => {
        delete state.busy[key];
        loadSample(key, 'api');
        state.src[key].mode = 'api';
        sourceChanged(SRC[key], `synced ${plural(state.src[key].rows.length, 'record')} by API`);
        toast(`${SRC[key].title}: synced ${plural(state.src[key].rows.length, 'record')} · re-ran ${state.result.totals.checksRun} checks`);
      }, reduceMotion ? 0 : 700);
    } else if (a === 'sample') { loadSample(el.dataset.key); sourceChanged(SRC[el.dataset.key], `${SRC[el.dataset.key].file} (sample)`); toast(`${SRC[el.dataset.key].title}: using the sample file`); }
    else if (a === 'sample-pdf') loadRegisterPdf(samplePdfBytes(), 'payroll_register.pdf', 'sample');
    else if (a === 'reset-rule') {
      const f = RULE_FIELDS.find((x) => x.key === el.dataset.key);
      delete store.settings[el.dataset.key];
      save();
      renderRules();
      scheduleRerun(`${f.label} reset to policy`);
    } else if (a === 'reset-rules') { store.settings = {}; save(); renderRules(); scheduleRerun('All rules reset to policy'); }
    else if (a === 'theme') { store.theme = el.dataset.theme; save(); applyTheme(); renderSettings(); }
    else if (a === 'reset-workspace') openModal(`<div class="mh"><h2 id="modalTitle">Clear workspace data?</h2></div>
        <div class="mb"><p>This deletes every status, note, reassignment, release record, rule change and activity entry stored in this browser, and reloads the sample cycle. It can’t be undone.</p></div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-reset">Clear data</button></div>`, el);
    else if (a === 'confirm-reset') {
      const keep = { user: store.user, workspace: store.workspace, theme: store.theme };
      store = Object.assign(freshStore(), keep);
      try { localStorage.removeItem(FILES_KEY); } catch (e) { /* nothing stored */ }
      SOURCES.forEach((s) => { state.src[s.key] = { mode: 'upload' }; loadSample(s.key); });
      state.detail = null;
      state.sel.clear();
      state.result = null;
      recompute();
      save();
      closeModal();
      renderAll();
      toast('Workspace data cleared');
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('input[type="file"][data-key]') && t.files && t.files[0]) handleFile(t.dataset.key, t.files[0]);
    else if (t.id === 'ownerSel') { state.filters.owner = t.value; renderQueue(); }
    else if (t.id === 'stageSel') { state.filters.stage = t.value; renderQueue(); }
    else if (t.id === 'selAll') { state.listKeys.forEach((k) => { if (t.checked) state.sel.add(k); else state.sel.delete(k); }); renderQueue(); }
    else if (t.id === 'ownerOne') { const x = exByKey(t.dataset.key); if (x && setOwner(x, t.value)) { afterWorkflow(); toast(`Assigned to ${t.value}`); } }
    else if (t.id === 'bulkOwner' && t.value) {
      let n = 0;
      state.sel.forEach((k) => { const x = exByKey(k); if (x && setOwner(x, t.value)) n++; });
      state.sel.clear();
      afterWorkflow();
      toast(`Assigned ${plural(n, 'exception')} to ${t.value}`);
    } else if (t.id === 'setName') { const v = t.value.trim(); if (v && v !== store.user) { const was = store.user; store.user = v; log('Name changed', `${was} → ${v}`); renderShell(); toast('Name saved'); } }
    else if (t.id === 'setWs') { const v = t.value.trim(); if (v && v !== store.workspace) { store.workspace = v; save(); renderShell(); toast('Company name saved'); } }
    else if (t.matches('[data-rule]') && (t.type === 'checkbox' || t.tagName === 'SELECT')) onRuleInput(t);
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'exSearch') { state.filters.q = t.value; renderQueue(); }
    else if (t.id === 'peopleSearch') { state.people.q = t.value; renderPeopleTable(); }
    else if (t.id === 'noteText') { const e = $('#noteErr'); if (e) e.hidden = true; }
    else if (t.matches('input[type="number"][data-rule]')) onRuleInput(t);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('#modal').hidden) closeModal();
    else if (popover) closePopover();
    else if (state.drawer) closeDrawer();
    else if ($('#shell').classList.contains('nav-open')) closeNav();
    else if (state.detail && !wide() && state.page === 'exceptions') closeDetail();
  });
  $('#scrim').addEventListener('click', () => { if (state.drawer) closeDrawer(); else closeDetail(); });
  $('#navScrim').addEventListener('click', closeNav);
  $('#modalScrim').addEventListener('click', closeModal);
  window.addEventListener('hashchange', route);

  // ----------------------------------------------------------------------------------
  // Boot
  // ----------------------------------------------------------------------------------

  function boot() {
    SAMPLE = window.NORTHLOOM_SAMPLE || SAMPLE;
    restoreSources();
    recompute();
    if (!store.audit.some((a) => a.cycle === cycleId())) log('Checks run', `${state.result.totals.checksRun} checks · ${state.result.totals.blockers} blockers, ${state.result.totals.review} to review`, { by: 'Rollcall' });
    route();
  }
  if (window.NORTHLOOM_SAMPLE_READY) {
    window.NORTHLOOM_SAMPLE_READY.then(boot, (e) => { $('#page').textContent = 'The sample cycle could not be loaded: ' + e.message; });
  } else boot();
})();
