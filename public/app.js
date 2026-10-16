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
    { key: 'census', group: 'records', kind: 'csv', file: 'census.csv', title: 'Employee census', sys: 'Payroll system · system of record', icon: 'people', api: 'https://payroll.example.com/api/workers?asOf={end}', desc: 'Who is employed, how they are paid, hire and termination dates, deposit accounts and PTO balances. Payroll is authoritative: people are onboarded here before WFM.' },
    { key: 'schedules', group: 'records', kind: 'csv', file: 'schedules.csv', title: 'Schedules', sys: 'WFM · Excel for the distribution center', icon: 'calendar', api: 'https://wfm.example.com/api/schedules?from={start}&to={end}', desc: 'Scheduled shifts by day. Stores schedule in WFM; the distribution center builds schedules in Excel and uploads them.' },
    { key: 'time', group: 'records', kind: 'csv', file: 'time_records.csv', title: 'Time records', sys: 'WFM timekeeping', icon: 'clock', api: 'https://wfm.example.com/api/timecards?from={start}&to={end}', desc: 'Check-in, meal and check-out punches, pay codes (REG, VAC, SICK, HOL) and manager overrides by day.' },
    { key: 'register', group: 'records', kind: 'register', file: 'payroll_register.csv', title: 'Payroll register', sys: 'Payroll processor', icon: 'file', api: 'https://payroll.example.com/api/registers?periodEnd={end}', desc: 'Earnings, taxes, deductions, net pay and PTO balances by employee. Accepts the CSV export or the printed PDF register.' },
    { key: 'bank', group: 'records', kind: 'csv', file: 'bank_activity.csv', title: 'Bank activity', sys: 'Treasury · payroll bank account', icon: 'bank', api: 'https://bank.example.com/api/accounts/payroll/transactions?from={start}', desc: 'Net pay and tax impounds, ACH settlement by employee, returns, tax and benefit remittances.' },
    { key: 'gl', group: 'records', kind: 'csv', file: 'gl_journal.csv', title: 'GL journal', sys: 'ERP general ledger', icon: 'ledger', api: 'https://erp.example.com/api/journals?source=PAYROLL&periodEnd={end}', desc: 'Payroll journal entry and the vacation accrual true-up.' },
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
  // Review: the reviewer approves, dismisses or escalates each exception.
  const STATUS_LABEL = { open: 'Open', escalated: 'Escalated', approved: 'Approved', dismissed: 'Dismissed' };
  const STATUS_VERB = { open: 'Reopened', escalated: 'Escalated', approved: 'Approved', dismissed: 'Dismissed' };
  const LEGACY_STATUS = { review: 'escalated', resolved: 'approved', accepted: 'dismissed' };
  const STAGE_OF = Object.fromEntries(E.STAGES.map((s) => [s.id, s]));
  const CHECK_OF = Object.fromEntries(E.CHECKS.map((c) => [c.id, c]));
  const PRE = ['time', 'roster', 'payroll'];
  const FLAG_LABEL = { MISSING_OUT: 'No check-out', MISSING_IN: 'No check-in', MISSING_MEAL_IN: 'No meal return', MISSING_MEAL_OUT: 'No meal out', NO_MEAL: 'No meal', OVERRIDE: 'Override', NO_PUNCH: 'No punches' };
  const OWNERS = ['Payroll', 'HR', 'Store manager', 'WFM admin', 'Treasury', 'GL accounting'];

  // Roles and what each may do. Payroll admins always hold every permission.
  const ROLES = [
    { id: 'admin', label: 'Payroll admin', desc: 'runs the cycle and owns team, roles and policies' },
    { id: 'approver', label: 'Payroll approver', desc: 'clears blockers and releases payroll' },
    { id: 'reviewer', label: 'Reviewer', desc: 'works the exceptions in their queue' },
    { id: 'viewer', label: 'Viewer', desc: 'read-only, for audit and finance' },
  ];
  const ROLE_OF = Object.fromEntries(ROLES.map((r) => [r.id, r]));
  const CAPS = [
    { id: 'review', label: 'Approve, escalate and reassign exceptions', verb: 'work exceptions' },
    { id: 'dismiss', label: 'Dismiss exceptions with a reason', verb: 'dismiss exceptions' },
    { id: 'dismissLarge', label: 'Dismiss blockers at or above the dismissal limit', verb: 'dismiss large blockers' },
    { id: 'release', label: 'Release payroll', verb: 'release payroll' },
    { id: 'reopen', label: 'Reopen a released cycle', verb: 'reopen a released cycle' },
    { id: 'rules', label: 'Change rules and thresholds', verb: 'change rules' },
    { id: 'data', label: 'Import data and start new cycles', verb: 'load or replace cycle data' },
    { id: 'ai', label: 'Ask the AI for explanations and causes', verb: 'use the AI' },
    { id: 'unmask', label: 'Show real names in AI output', verb: 'show real names' },
    { id: 'export', label: 'Download reports, registers and logs', verb: 'download data' },
    { id: 'admin', label: 'Manage team, roles and policies', verb: 'change admin settings' },
  ];
  const CAP_OF = Object.fromEntries(CAPS.map((c) => [c.id, c]));
  const ROLE_CAPS = {
    admin: CAPS.map((c) => c.id),
    approver: ['review', 'dismiss', 'dismissLarge', 'release', 'reopen', 'data', 'ai', 'unmask', 'export'],
    reviewer: ['review', 'dismiss', 'ai', 'export'],
    viewer: ['export'],
  };
  const defaultPerms = () => Object.fromEntries(ROLES.map((r) => [r.id, Object.fromEntries(CAPS.map((c) => [c.id, ROLE_CAPS[r.id].includes(c.id)]))]));
  const defaultPolicy = () => ({ perms: defaultPerms(), sod: true, lockAfterRelease: true, dismissLimit: 500, approveNote: false, slaBlockerH: 24, slaReviewH: 72, aiExplain: true, aiClusters: true, aiChat: true, fixThreshold: 3, cutoffDays: 2, cutoffTime: '10:00', pin: null });
  const defaultTeam = (name) => [
    { id: 'u1', name: name || 'Payroll ops', role: 'admin', queue: 'Payroll', active: true },
    { id: 'u2', name: 'Payroll approver', role: 'approver', queue: 'Payroll', active: true },
    { id: 'u3', name: 'Payroll reviewer', role: 'reviewer', queue: 'Payroll', active: true },
    { id: 'u4', name: 'HR partner', role: 'reviewer', queue: 'HR', active: true },
    { id: 'u5', name: 'Store operations', role: 'reviewer', queue: 'Store manager', active: true },
    { id: 'u6', name: 'Timekeeping admin', role: 'reviewer', queue: 'WFM admin', active: true },
    { id: 'u7', name: 'Treasury analyst', role: 'reviewer', queue: 'Treasury', active: true },
    { id: 'u8', name: 'GL accountant', role: 'reviewer', queue: 'GL accounting', active: true },
    { id: 'u9', name: 'Internal audit', role: 'viewer', queue: '', active: true },
  ];
  // Actions gated by one permission each, checked before the click handler runs them.
  const DATA_ACTIONS = new Set(['load-sample', 'new-cycle', 'confirm-new-cycle', 'import-load', 'sync', 'sample', 'sample-pdf', 'mode']);
  const EXPORT_ACTIONS = new Set(['export-ex', 'export-ex-all', 'export-variance', 'export-audit', 'download-brief', 'copy-brief', 'backup-export']);

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
    quality: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.8"/>'),
    dollar: svg('<path d="M12 3v18"/><path d="M16.5 7.5c-.7-1.4-2.4-2.2-4.5-2.2-2.6 0-4.3 1.3-4.3 3.1 0 4.4 9 2.4 9 6.9 0 1.9-1.9 3.3-4.6 3.3-2.3 0-4.1-1-4.8-2.5"/>'),
    match: svg('<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>'),
    repeat: svg('<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16.5 6.5 19 9M14 9l2 2"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 14),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', 14),
    check: svg('<path d="M5 12.5 10 17l9-10"/>', 14),
    download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 14),
    calendar: svg('<rect x="4" y="5" width="16" height="15" rx="1.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    bank: svg('<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
    ledger: svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>'),
    upload: svg('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', 18),
    plug: svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>', 14),
    chat: svg('<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9.5h8M8 12.5h5"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  };

  const NAV = [
    { group: 'Pay cycle', items: [
      { id: 'overview', label: 'Overview', icon: 'overview' },
      { id: 'exceptions', label: 'Review queue', icon: 'flag' },
      { id: 'people', label: 'People', icon: 'people' },
    ] },
    { group: 'Checks', items: [
      { id: 'feedpulse', label: 'Data quality', icon: 'quality' },
      { id: 'runradar', label: 'Pay accuracy', icon: 'dollar' },
      { id: 'threeway', label: 'Bank and ledger', icon: 'match' },
      { id: 'fixflow', label: 'Repeat issues', icon: 'repeat' },
    ] },
    { group: 'Records', items: [
      { id: 'reports', label: 'Reports', icon: 'file' },
      { id: 'activity', label: 'Activity log', icon: 'clock' },
    ] },
    { group: 'Setup', items: [
      { id: 'sources', label: 'Data sources', icon: 'db' },
      { id: 'rules', label: 'Rules', icon: 'rules' },
      { id: 'controls', label: 'All checks', icon: 'shield' },
      { id: 'settings', label: 'Settings', icon: 'sliders' },
    ] },
    { group: 'Admin', items: [
      { id: 'admin', label: 'Admin console', icon: 'key' },
    ] },
  ];
  const PAGES = NAV.flatMap((g) => g.items.map((i) => i.id));
  const LEGACY = { intake: 'sources', checks: 'controls', brief: 'reports', variance: 'exceptions' };

  // ----------------------------------------------------------------------------------
  // Persistence: workflow, activity and settings live in this browser
  // ----------------------------------------------------------------------------------

  const STORE_KEY = 'rollcall.payroll-assurance.v1';
  const FILES_KEY = 'rollcall.payroll-assurance.sources.v1';
  const freshStore = () => ({ v: 1, user: 'Payroll ops', workspace: 'Northloom Apparel', theme: 'system', settings: {}, cycles: {}, audit: [], mappings: {}, connectors: {}, team: defaultTeam('Payroll ops'), userId: 'u1', policy: defaultPolicy(), customSources: [], customRules: [] });
  let store = loadStore();

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === 1) {
          Object.values(s.cycles || {}).forEach((c) => Object.values(c.items || {}).forEach((it) => {
            if (LEGACY_STATUS[it.status]) it.status = LEGACY_STATUS[it.status];
            (it.events || []).forEach((e) => { if (LEGACY_STATUS[e.from]) e.from = LEGACY_STATUS[e.from]; if (LEGACY_STATUS[e.to]) e.to = LEGACY_STATUS[e.to]; });
          }));
          return hydrate(s);
        }
      }
    } catch (e) { /* storage unavailable: run in memory */ }
    return freshStore();
  }
  // Fill in team, roles and policies for stores saved before they existed.
  function hydrate(s) {
    const out = Object.assign(freshStore(), s);
    if (!Array.isArray(s.team) || !s.team.length) out.team = defaultTeam(s.user);
    const saved = s.policy || {};
    const perms = defaultPerms();
    ROLES.forEach((r) => Object.assign(perms[r.id], (saved.perms || {})[r.id] || {}));
    CAPS.forEach((c) => { perms.admin[c.id] = true; });
    ROLES.forEach((r) => { if (r.id !== 'admin') perms[r.id].admin = false; });
    out.policy = Object.assign(defaultPolicy(), saved, { perms });
    if (!out.team.some((m) => m.id === out.userId)) out.userId = (out.team.find((m) => m.name === out.user) || out.team[0]).id;
    out.user = out.team.find((m) => m.id === out.userId).name;
    return out;
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
    busy: {},
    importQueue: [],
    auth: {},
    chat: { open: false, msgs: [], busy: false, draft: '' },
    ruleDraft: null,
  };

  // ----------------------------------------------------------------------------------
  // Data
  // ----------------------------------------------------------------------------------

  function loadSample(key, origin) {
    const def = SRC[key];
    const text = SAMPLE.files[def.file];
    const mode = (state.src[key] && state.src[key].mode) || 'upload';
    if (def.group === 'custom') { state.src[key] = { mode }; return; }
    if (text === undefined) { state.src[key] = { mode, error: 'Sample file not bundled.' }; return; }
    if (def.kind === 'json') state.src[key] = { json: JSON.parse(text), name: def.file, origin: origin || 'sample', mode, at: nowIso() };
    else state.src[key] = { rows: E.parseCSV(text), name: def.file, origin: origin || 'sample', mode, format: 'csv', at: nowIso() };
  }

  function persistSources() {
    const out = {};
    SOURCES.forEach((def) => {
      const s = state.src[def.key];
      if (!s) return;
      const base = { origin: s.origin || null, mode: s.mode || 'upload', name: s.name || '', at: s.at || null, format: s.format || '', pages: s.pages, problems: s.problems };
      if (!s.rows && !s.json) out[def.key] = Object.assign(base, { empty: true });
      else if (s.origin === 'sample' && s.format !== 'pdf') out[def.key] = base;
      else if (s.json) out[def.key] = Object.assign(base, { json: s.json });
      else out[def.key] = Object.assign(base, { rows: s.rows });
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
        else if (s && Array.isArray(s.rows)) state.src[def.key] = { rows: s.rows, name: s.name, origin: s.origin, mode: s.mode, format: s.format || 'csv', pages: s.pages, problems: s.problems || [], at: s.at };
        else if (s && s.json) state.src[def.key] = { json: s.json, name: s.name, origin: s.origin, mode: s.mode, at: s.at };
        else if (s && typeof s.text === 'string') state.src[def.key] = { rows: E.parseCSV(s.text), name: s.name, origin: s.origin, mode: s.mode, format: 'csv', at: s.at };
        else {
          state.src[def.key] = { mode: (s && s.mode) || 'upload' };
          loadSample(def.key);
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
  const isSampleWorkspace = () => SOURCES.filter((s) => s.group === 'records').every((s) => state.src[s.key] && state.src[s.key].origin === 'sample');

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
    runCustomRules(state.result);
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
  const isOpen = (x) => { const s = statusOf(x); return s === 'open' || s === 'escalated'; };
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
    const dismissed = pre.filter((x) => statusOf(x) === 'dismissed');
    const approved = pre.filter((x) => statusOf(x) === 'approved');
    const post = r.exceptions.filter((x) => x.severity === 'blocker' && !isPre(x));
    const postOpen = post.filter(isOpen);
    const released = cyc().released;
    const hold = !released && cyc().hold ? cyc().hold : null;
    const st = released ? 'released' : !stagesRan ? 'nodata' : hold ? 'hold' : preOpen.length ? 'blocked' : 'ready';
    return { state: st, pre, preOpen, dismissed, approved, post, postOpen, released, stagesRan, hold };
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

  const STATE_WORD = { blocked: 'Release blocked', ready: 'Ready to release', released: 'Released', nodata: 'Waiting for data', hold: 'Release on hold' };

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
    $('#sideFoot').innerHTML = `<div class="tagline">Everyone Accounted For</div>Working as <b>${esc(store.user)}</b> · ${esc(roleLabel(me()))}. Statuses, notes and approvals are saved in this browser.`;
  }

  function navBadge(id) {
    const r = state.result;
    if (id === 'exceptions') {
      const n = r.exceptions.filter((x) => isOpen(x) && x.severity !== 'info').length;
      return n ? `<span class="badge ${readiness().preOpen.length ? 'crit' : ''}">${n}</span>` : '';
    }
    if (id === 'people') return `<span class="badge">${r.totals.people}</span>`;
    if (id === 'controls') return `<span class="badge">${r.totals.checksRun}/${r.checks.length}</span>`;
    if (id === 'sources') return `<span class="badge">${SOURCES.filter((s) => state.src[s.key] && (state.src[s.key].rows || state.src[s.key].json)).length}/${SOURCES.length}</span>`;
    if (id === 'rules') { const n = Object.keys(store.settings).length; return n ? `<span class="badge">${n} changed</span>` : ''; }
    if (id === 'admin') { const late = r.exceptions.filter(pastSla).length; return late ? `<span class="badge crit" title="Overdue items">${late}</span>` : cyc().hold ? '<span class="badge">Hold</span>' : ''; }
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
    else releaseBtn = `<button class="btn primary" type="button" data-action="release" ${rd.state === 'ready' ? '' : 'aria-disabled="true"'} title="${rd.state === 'ready' ? 'Approve and release this batch' : rd.state === 'nodata' ? 'Load the cycle data first' : rd.state === 'hold' ? 'Release is on hold' : `Clear ${plural(rd.preOpen.length, 'blocker')} first`}">Release payroll</button>`;
    $('#topbar').innerHTML = `
      <button class="btn small menu-btn" type="button" data-action="nav-toggle" aria-label="Open navigation" aria-expanded="${$('#shell').classList.contains('nav-open')}">${ICON.menu}</button>
      <button class="cycle-btn" type="button" data-action="cycle-menu" aria-haspopup="true" aria-expanded="false">
        <b>${esc(cycleId())}</b><span>${esc(periodText(p))}${p.payDate ? ` · Pay ${esc(F.fmtDate(p.payDate))}` : ''}</span>${ICON.chevron}
      </button>
      <span class="status-chip ${rd.state}" title="${rel ? `Released ${esc(stamp(rel.at))} by ${esc(rel.by)}` : ''}">${STATE_WORD[rd.state]}</span>
      <span class="top-spacer"></span>
      <span class="last-run">Checked ${esc(clock(state.lastRun))}</span>
      <button class="btn chat-btn" type="button" data-action="chat-toggle" aria-expanded="${!!state.chat.open}" aria-controls="chat">${ICON.chat.replace(/16/g, '15')} <span>Ask AI</span></button>
      <button class="btn" type="button" data-action="go-import">${ICON.upload.replace(/18/g, '14')} Import files</button>
      <button class="btn" type="button" data-action="rerun">${ICON.refresh} Re-run checks</button>
      ${releaseBtn}`;
  }

  function renderPage() {
    const fn = { feedpulse: renderFeedpulse, runradar: renderRunradar, threeway: renderThreeway, fixflow: renderFixflow, overview: renderOverview, exceptions: renderExceptions, people: renderPeople, controls: renderControls, sources: renderSources, rules: renderRules, reports: renderReports, activity: renderActivity, settings: renderSettings, admin: renderAdmin }[state.page];
    fn();
  }

  function renderAll() {
    renderShell();
    renderChat();
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
    hideTip();
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
    if (fund) out.push({ date: fund, title: 'Payroll funded', sub: `${F.money(r.funding.netFunding)} net pay · ${F.money(r.funding.taxFunding)} tax` });
    if (p.payDate) out.push({ date: p.payDate, title: 'Direct deposits settle', sub: `${plural(bank.filter((b) => b.txn_type === 'ACH_CREDIT').length, 'deposit')} · ${F.money(r.funding.achTotal)}` });
    const glDate = gl.map((g) => g.post_date).filter(Boolean).sort()[0];
    if (glDate) out.push({ date: glDate, title: 'Payroll journal posted', sub: `${gl[0].je_id || 'Journal'} · ${plural(gl.length, 'line')}` });
    bank.filter((b) => b.txn_type === 'ACH_RETURN').forEach((b) => out.push({ date: b.value_date, title: `ACH return ${b.return_code || ''}`.trim(), sub: `${F.money(E.util.num(b.amount))} to ****${b.account_last4 || ''}`, fail: true }));
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((d) => Object.assign(d, { done: d.date <= today }));
  }

  function renderOverview() {
    const r = state.result, p = r.period, t = r.totals, rd = readiness();
    const cleared = rd.pre.length - rd.preOpen.length;
    const pct = rd.pre.length ? Math.round((cleared / rd.pre.length) * 100) : rd.stagesRan ? 100 : 0;
    let text, actions;
    if (rd.state === 'blocked') {
      text = `${plural(rd.preOpen.length, 'blocker')} in time, roster and register checks ${rd.preOpen.length === 1 ? 'is' : 'are'} open. Approve or dismiss each one in the review queue to release this batch.`;
      actions = `<button class="btn primary" type="button" data-action="go-blockers">Work the blockers</button><button class="btn" type="button" data-action="release" aria-disabled="true">Release payroll</button>`;
    } else if (rd.state === 'hold') {
      text = `A payroll admin put release on hold (${rd.hold.by}, ${stamp(rd.hold.at)}): “${rd.hold.reason}”.${rd.preOpen.length ? ` ${plural(rd.preOpen.length, 'pre-release blocker')} ${rd.preOpen.length === 1 ? 'is' : 'are'} also open.` : ' Every pre-release blocker is cleared.'}`;
      actions = `${rd.preOpen.length ? '<button class="btn primary" type="button" data-action="go-blockers">Work the blockers</button>' : ''}${can('admin') ? '<button class="btn" type="button" data-action="admin-tab" data-tab="policies">Lift the hold</button>' : ''}`;
    } else if (rd.state === 'ready') {
      text = `${rd.pre.length ? `All ${plural(rd.pre.length, 'pre-release blocker')} are cleared${rd.dismissed.length ? `, ${rd.dismissed.length} dismissed with a reason` : ''}.` : 'Every pre-release check passed.'}${rd.postOpen.length ? ` ${plural(rd.postOpen.length, 'funding and GL blocker', 'funding and GL blockers')} stay open and are tracked after settlement.` : ''}`;
      actions = `<button class="btn primary" type="button" data-action="release">Release payroll</button><a class="btn" href="#exceptions">Review exceptions</a>`;
    } else if (rd.state === 'released') {
      const rel = rd.released;
      text = `Released ${stamp(rel.at)} by ${rel.by}${rel.note ? `: “${rel.note}”` : '.'}${rd.postOpen.length ? ` ${plural(rd.postOpen.length, 'funding and GL blocker', 'funding and GL blockers')} remain open for treasury and accounting.` : ''}`;
      actions = `<button class="btn" type="button" data-action="release-info">View release record</button>${rd.postOpen.length ? '<button class="btn" type="button" data-action="go-post">Work post-settlement items</button>' : ''}`;
    } else {
      text = 'Load the census, time records and payroll register for this cycle. Every check runs as soon as the files arrive.';
      actions = `<button class="btn primary" type="button" data-action="go-import">${ICON.upload.replace(/18/g, '14')} Import files</button><button class="btn" type="button" data-action="load-sample">Load sample cycle</button>`;
    }
    const owners = byOwner(rd.preOpen);
    const listOpen = rd.state === 'blocked' || (rd.state === 'hold' && rd.preOpen.length > 0);
    const top = (listOpen ? rd.preOpen : rd.dismissed).slice().sort((a, b) => (b.impact ? b.impact.amount : 0) - (a.impact ? a.impact.amount : 0)).slice(0, 4);
    const missing = SOURCES.filter((s) => s.group === 'records' && !(state.src[s.key] && state.src[s.key].rows));
    const oi = openImpact();
    const dates = keyDates();
    const feed = store.audit.filter((a) => a.cycle === cycleId()).slice(0, 7);
    const ownerRows = byOwner(r.exceptions.filter((x) => isOpen(x) && x.severity !== 'info'));
    const fact = (label, value) => `<div><span>${esc(label)}</span><b>${value}</b></div>`;

    $('#page').innerHTML = `
      <div class="page-head">
        <div><span class="eyebrow">Pay cycle ${esc(cycleId())}</span><h1>${esc(periodText(p))}</h1>
        <p>${esc(store.workspace)}${p.payDate ? ` · pay date ${esc(F.fmtDate(p.payDate))}` : ''} · ${plural(t.people, 'person', 'people')} · ${t.checksRun} of ${r.checks.length} checks ran across WFM, the payroll register, bank activity and the GL</p></div>
      </div>
      ${isSampleWorkspace() ? sampleBanner() : ''}
      <div style="margin-bottom:16px">${flowHtml()}</div>
      <div class="grid ov-top">
        <section class="card ready-card" data-state="${rd.state}" aria-labelledby="readyTitle">
          <span class="eyebrow">Release readiness</span>
          <div class="ready-top"><h2 id="readyTitle">${STATE_WORD[rd.state]}</h2></div>
          <p>${esc(text)}</p>
          ${rd.state === 'nodata' ? `<ul class="timeline">${SOURCES.filter((s) => s.group === 'records').map((s) => `<li class="${missing.includes(s) ? '' : 'done'}"><span class="tdot"></span><span><b>${esc(s.title)}</b><br><span class="muted">${esc(s.sys)}</span></span><span class="tdate">${missing.includes(s) ? 'Missing' : 'Loaded'}</span></li>`).join('')}</ul>` : `
          <div><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Pre-release blockers cleared"><i style="width:${pct}%"></i></div>
          <div class="progress-meta"><span>${cleared} of ${plural(rd.pre.length, 'pre-release blocker')} cleared</span><span>${rd.approved.length} approved · ${rd.dismissed.length} dismissed</span></div></div>
          ${owners.length ? `<div><span class="eyebrow">Open blockers by owner</span><div class="owner-row" style="margin-top:6px">${owners.map(([o, l]) => `<button type="button" data-action="filter-owner" data-owner="${esc(o)}" data-pre="1">${esc(o)} <b>${l.length}</b></button>`).join('')}</div></div>` : ''}
          ${top.length ? `<div><span class="eyebrow">${listOpen ? 'Largest open blockers' : 'Dismissed with a reason'}</span><ul class="mini-list" style="margin-top:6px">${top.map((x) => `<li><button type="button" data-action="goto-ex" data-key="${esc(x.key)}" data-scope="pre">
            <span class="pill ${listOpen ? 'blocker' : 'info'}">${esc(x.check)}</span>
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

      ${showcaseHtml()}

      <div class="group-title"><h3>Open dollar impact</h3><span class="muted">Dollar impact of exceptions not yet approved or dismissed</span></div>
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
          <div class="card-head"><h3>Open items by owner</h3><a class="more" href="#exceptions">Review queue</a></div>
          ${ownerRows.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Owner</th><th class="n">Blockers</th><th class="n">Review</th><th class="n">Dollar impact</th></tr></thead>
            <tbody>${ownerRows.map(([o, l]) => `<tr class="clickable" data-action="filter-owner" data-owner="${esc(o)}">
              <td><b>${esc(o)}</b></td>
              <td class="n">${l.filter((x) => x.severity === 'blocker').length || '<span class="muted">0</span>'}</td>
              <td class="n">${l.filter((x) => x.severity === 'review').length || '<span class="muted">0</span>'}</td>
              <td class="n">${F.money(sum(l.filter((x) => x.impact), (x) => x.impact.amount))}</td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty"><h3>Nothing open</h3><p>Every blocker and review item is approved or dismissed.</p></div>'}
        </section>
        <section class="card">
          <div class="card-head"><h3>Recent activity</h3><a class="more" href="#activity">Full log</a></div>
          ${feed.length ? `<ul class="feed">${feed.map(feedItem).join('')}</ul>` : '<div class="empty"><p>No activity yet. Status changes, notes, re-runs and releases are logged here.</p></div>'}
        </section>
      </div>`;
  }

  function sampleBanner() {
    return `<div class="notice sample-banner" role="note">
      <span><b>You’re looking at the Northloom Apparel sample cycle</b> (fictional data). Import your own WFM, payroll, bank and GL exports and the same ${E.CHECKS.length} checks run on them, in this browser.</span>
      <button class="btn small primary" type="button" data-action="go-import">${ICON.upload.replace(/18/g, '14')} Import your files</button>
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
    return (skip.status || f.status === 'all' || (f.status === 'unresolved' ? st === 'open' || st === 'escalated' : st === f.status))
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
    if (f.check) chips.push(['check', `Check: ${f.check} ${(CHECK_OF[f.check] || {}).title || ''}`]);
    if (f.kind) chips.push(['kind', `Impact: ${KINDS.find((k) => k.kind === f.kind).label}`]);
    const stageOpts = [['', 'All stages'], ['pre', 'Before release'], ['post', 'After settlement']].concat(E.STAGES.map((s) => [s.id, s.title]));
    $('#page').innerHTML = `
      <div class="page-head">
        <div><span class="eyebrow">Step 3 of 5</span><h1>Review queue</h1><p>Every exception the checks found. Select one to see why it happened, the records behind it and the policy that applies, then approve, dismiss or escalate it. Blockers in the time, roster and register checks must be approved or dismissed before payroll can be released.</p></div>
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
    const counts = { unresolved: 0, approved: 0, dismissed: 0, all: base.length };
    base.forEach((x) => { const s = statusOf(x); if (s === 'open' || s === 'escalated') counts.unresolved++; else counts[s]++; });
    $('#statusSeg').innerHTML = [['unresolved', 'Unresolved'], ['approved', 'Approved'], ['dismissed', 'Dismissed'], ['all', 'All']]
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
    const closed = st === 'approved' || st === 'dismissed';
    const who = x.empId ? `${x.empId} ${x.empName}` : 'Whole cycle';
    const impact = x.impact
      ? `<span class="k-${x.impact.kind}">${F.money(x.impact.amount)}</span><small>${esc(KIND_SHORT[x.impact.kind])}${x.impact.estimated ? ' · est.' : ''}</small>`
      : '<small>No $ impact</small>';
    return `<div class="qrow ${state.detail === x.key ? 'sel' : ''} ${closed ? 'closed' : ''}" data-st="${st}" role="listitem" data-action="select-ex" data-key="${esc(x.key)}">
      <input type="checkbox" class="cb" data-action="toggle-sel" data-key="${esc(x.key)}" aria-label="Select ${esc(x.title)}" ${state.sel.has(x.key) ? 'checked' : ''}>
      <span class="qid">${doneOrSev(x, st)}<span class="mono">${esc(x.check)} · ${esc(x.id)}</span></span>
      <button class="qt linkless" type="button" data-action="select-ex" data-key="${esc(x.key)}"><b>${esc(x.title)}</b><span>${esc(who)} · ${esc(STAGE_OF[x.stage].title)}</span></button>
      <span class="qown">${esc(ownerOf(x))}</span>
      <span class="qimp">${impact}</span>
      <span class="qst">${statusPill(st)}</span>
    </div>`;
  }
  // Approved items read green, dismissed ones neutral; open items keep their severity.
  const doneOrSev = (x, st) => (st === 'approved' ? '<span class="pill pass">Approved</span>' : st === 'dismissed' ? '<span class="pill plain">Dismissed</span>' : `<span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span>`);
  const statusPill = (st) => `<span class="st ${st}"><i aria-hidden="true"></i>${STATUS_LABEL[st]}</span>`;

  function renderBulk() {
    const el = $('#bulk');
    if (!el) return;
    const n = state.sel.size;
    el.innerHTML = n ? `<div class="bulk" style="margin-bottom:12px" role="region" aria-label="Bulk actions">
      <span>${plural(n, 'exception')} selected</span>
      <select id="bulkOwner" aria-label="Assign selected to"><option value="">Assign to…</option>${ownerOptions().map((o) => `<option>${esc(o)}</option>`).join('')}</select>
      <button class="btn small" type="button" data-action="bulk-status" data-to="approved">Approve</button>
      <button class="btn small" type="button" data-action="bulk-dismiss">Dismiss…</button>
      <button class="btn small" type="button" data-action="bulk-escalate">Escalate…</button>
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
      open: [['approved', 'Approve', 'primary'], ['dismissed', 'Dismiss', ''], ['escalated', 'Escalate', '']],
      escalated: [['approved', 'Approve', 'primary'], ['dismissed', 'Dismiss', ''], ['open', 'Back to open', '']],
      approved: [['open', 'Reopen', '']],
      dismissed: [['open', 'Reopen', '']],
    }[st];
    const lockWhy = changeBlock(x, null);
    const dWhy = !lockWhy && (st === 'open' || st === 'escalated') ? changeBlock(x, 'dismissed') : '';
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
        <div class="row"><span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span>${appChip(appOf(x))}<span class="mono muted" style="font-size:var(--t-xs)">${esc(x.id)} · ${esc(x.check)}</span>
          <span class="close-x" style="display:flex;gap:6px">${next ? `<button class="btn small" type="button" data-action="select-ex" data-key="${esc(next)}">Next</button>` : ''}<button class="btn small" type="button" data-action="close-detail">Close</button></span></div>
        <h2>${esc(x.title)}</h2>
        <div class="row">${statusPill(st)}<span class="muted" style="font-size:var(--t-xs)">Owner: ${esc(ownerOf(x))}</span></div>
        ${(() => { const done = st === 'approved' || st === 'dismissed' ? it.events.filter((e) => e.type === 'status' && e.to === st).slice(-1)[0] : null; return done ? `<div class="done-banner ${st === 'approved' ? 'ok' : 'dis'}"><b>${st === 'approved' ? '✓ Approved' : 'Dismissed'}</b> <span>by ${esc(done.by)} · ${esc(stamp(done.t))}${done.text ? ` — “${esc(done.text)}”` : ''}</span></div>` : ''; })()}
      </div>
      <div class="detail-body">
        ${emp ? `<section><h4>Employee</h4><button class="who" type="button" data-action="open-emp" data-emp="${esc(emp.id)}"><b>${esc(emp.name)}</b><span>${esc(emp.id)}${emp.title ? ' · ' + esc(emp.title) : ''}${emp.location ? ' · ' + esc(emp.location) : ''}</span></button></section>` : ''}
        ${varianceVoiceHtml(x)}
        <h4 style="margin-bottom:-8px">Finding</h4>
        <div class="ev">${ev.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
        ${x.action ? `<section><h4>Recommended action</h4><p>${esc(x.action)}</p></section>` : ''}
        <section><h4>Work this item</h4>
          <div class="actions-row">${btns.map(([to, l, cls]) => `<button class="btn small ${cls}" type="button" data-action="set-status" data-to="${to}" ${changeBlock(x, to) ? 'disabled' : ''}>${l}</button>`).join('')}</div>
          ${lockWhy || dWhy ? `<p class="muted" style="font-size:var(--t-xs);margin-top:6px">${esc(lockWhy || dWhy)}</p>` : ''}
          <label class="field" for="ownerOne" style="margin-top:10px">Owner
            <select id="ownerOne" data-key="${esc(x.key)}" ${lockWhy ? 'disabled' : ''}>${ownerOptions().concat(ownerOf(x) === 'Unassigned' ? ['Unassigned'] : []).map((o) => `<option ${ownerOf(x) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          </label>
        </section>
        <section><h4><label for="noteText">Note</label></h4>
          <textarea class="text" id="noteText" ${can('review') ? '' : 'disabled'} placeholder="Context, a ticket number, or the fix applied. Saved with the next action, or on its own."></textarea>
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
      <div class="page-head"><div><h1>All checks</h1><p>${r.checks.length} checks across five stages, from WFM time through the payroll register, treasury funding and GL posting. Each reads the loaded data sources and the thresholds on the Rules page. Select a check to see what it found.</p></div></div>
      <div class="check-stages">${r.stages.map((s) => {
        const cs = r.checks.filter((c) => c.stage === s.id);
        const pass = cs.filter((c) => c.ran && (c.status === 'pass' || c.status === 'note')).length;
        return `<section class="check-stage">
          <header><span class="eyebrow">${esc(s.phase)}</span><h3>${esc(s.title)}</h3><span class="sys">${esc(s.systems)}</span><span class="res">${appChip(appOf(cs[0].id))} ${s.ran ? `${pass} of ${cs.length} pass` : 'No data loaded'}${PRE.includes(s.id) ? ' · gates release' : ' · after settlement'}</span></header>
          <ul>${cs.map((c) => {
            const list = r.exceptions.filter((x) => x.check === c.id);
            const open = list.filter(isOpen).length;
            const work = list.filter((x) => x.severity !== 'info');
            const cleared = c.ran && work.length > 0 && !work.some(isOpen);
            const st = !c.ran ? 'idle' : cleared ? 'pass' : c.status;
            const res = !c.ran ? '<span class="muted">No data</span>'
              : c.status === 'pass' ? '<span class="pill pass">Pass</span>'
                : cleared ? `<span class="pill pass">Cleared · ${plural(work.length, 'item')} reviewed</span>`
                : c.status === 'note' ? `<span class="pill info">${plural(c.count, 'note')}</span>`
                  : `<span class="pill ${c.status === 'fail' ? 'blocker' : 'review'}">${c.count} found${open < c.count ? ` · ${open} open` : ''}</span>`;
            return `<li><button class="check-row" type="button" data-action="check" data-check="${c.id}" ${c.count ? '' : 'aria-disabled="true"'}>
              <span class="glyph ${st}">${GLYPH[st]}</span><span class="id">${c.id}</span><span class="t">${esc(c.title)}${c.custom ? ' <span class="pill plain">Your rule</span>' : ''}</span><span class="rule">${esc(c.rule)}</span><span class="res">${res}</span>
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
      const accept = def.kind === 'json' ? '.json,application/json' : def.kind === 'register' ? '.csv,.json,.pdf,text/csv,application/json,application/pdf' : '.csv,.json,text/csv,application/json';
      const conn = store.connectors[def.key] || {};
      let status;
      if (busy) status = `<span class="conn idle">${esc(busy)}</span>`;
      else if (!loaded) status = '<span class="conn bad">Not loaded</span>';
      else if (s.origin === 'api') status = `<span class="conn ok">Synced</span><span>${esc(count)}</span><span class="muted">${esc(clock(s.at))} · ${esc(s.name)}</span>`;
      else status = `<span class="conn ok">Loaded</span><span>${esc(count)}</span><span class="muted mono">${esc(s.name || '')}</span><span class="muted">${s.format === 'pdf' ? 'PDF extract' : s.origin === 'sample' ? 'sample data' : 'your file'}${s.at ? ' · ' + esc(clock(s.at)) : ''}</span>`;
      const dl = window.PA_HOSTED && SAMPLE.files[def.file] ? `<a class="linkish" style="font-size:var(--t-xs)" href="${sampleUrl(def.file)}" download="${esc(def.file)}">Sample ${def.kind === 'json' ? 'JSON' : 'CSV'}</a>${def.kind === 'register' && SAMPLE.registerPdfBase64 ? ` <a class="linkish" style="font-size:var(--t-xs)" href="${sampleUrl('payroll_register.pdf')}" download="payroll_register.pdf">Sample PDF</a>` : ''}` : '';
      const cols = SCHEMA_OF[def.key] ? targetsFor(def.key) : def.group === 'custom' && def.custom.columns.length ? def.custom.columns : null;
      return `<article class="source" id="src-${def.key}">
        <header><span class="src-icon">${ICON[def.icon]}</span><div style="flex:1;min-width:0"><h4>${esc(def.title)}</h4><div class="sys">${esc(def.sys)}</div></div>
          ${def.api ? `<div class="seg" role="group" aria-label="${esc(def.title)} connection">
            <button type="button" data-action="mode" data-key="${def.key}" data-mode="upload" aria-pressed="${mode === 'upload'}">File</button>
            <button type="button" data-action="mode" data-key="${def.key}" data-mode="api" aria-pressed="${mode === 'api'}">API</button>
          </div>` : ''}
        </header>
        <p class="desc">${esc(def.desc || 'Added by your team.')}</p>
        ${def.group === 'custom' ? customMeta(def) : ''}
        <div class="status">${status}</div>
        ${s.error ? `<div class="err" role="alert">${esc(s.error)}</div>` : ''}
        ${mode === 'api' && def.api ? `
          <label class="conn-field">Endpoint URL
            <input class="text" type="url" inputmode="url" spellcheck="false" data-conn-url="${def.key}" value="${esc(conn.url || '')}" placeholder="${esc(def.api)}"></label>
          <label class="conn-field">Authorization header <span class="muted" style="font-weight:500">optional · kept for this session only</span>
            <input class="text" type="password" autocomplete="off" data-conn-auth="${def.key}" value="${esc(state.auth[def.key] || '')}" placeholder="Bearer …"></label>
          <div class="row"><button class="btn small" type="button" data-action="sync" data-key="${def.key}" ${busy ? 'disabled' : ''}>${ICON.refresh} Sync now</button></div>
          <p class="muted" style="font-size:var(--t-xs)">Your browser calls this URL directly. It must return CSV or JSON rows and allow requests from this site (CORS). Use {start} and {end} for the pay period dates.</p>`
        : `<div class="row">
            <span class="btn small file-btn">${loaded && s.origin !== 'sample' ? 'Replace file' : 'Upload file'}<input type="file" id="file-${def.key}" data-key="${def.key}" accept="${accept}" aria-label="Upload ${esc(def.title)}"></span>
            ${def.kind === 'register' ? `<button class="btn small" type="button" data-action="sample-pdf" ${busy ? 'disabled' : ''}>Read sample PDF register</button>` : ''}
            ${def.group !== 'custom' && (s.origin !== 'sample' || s.format === 'pdf') ? `<button class="linkish" type="button" data-action="sample" data-key="${def.key}" style="font-size:var(--t-xs)">Use sample file</button>` : ''}
            ${dl}
          </div>`}
        ${def.key === 'register' && s.format === 'pdf' && s.rows ? pdfPreview(s) : ''}
        ${def.group === 'custom' && can('data') ? `<div class="row cs-actions"><button class="linkish" type="button" data-action="cs-edit" data-key="${def.key}">Edit</button><button class="linkish danger-link" type="button" data-action="cs-remove" data-key="${def.key}">Remove</button></div>` : ''}
        ${cols ? `<details><summary>Columns (${cols.length}${KEY_COLS[def.key].length ? `, ${KEY_COLS[def.key].length} required` : ''})</summary><code>${esc(cols.join(', '))}</code></details>` : ''}
      </article>`;
    };
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>Data sources</h1><p>Bring in this cycle’s data from WFM, payroll, the bank and the ERP, as files or from an API. Every check re-runs on import. The payroll census is the system of record for who is employed and when.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="load-sample">Load sample cycle</button><button class="btn small" type="button" data-action="new-cycle">Start a new cycle</button></div>
      </div>
      ${importCardHtml()}
      <div class="group-title"><h3>Systems of record</h3><span class="muted">${isSampleWorkspace() ? 'Showing the Northloom Apparel sample cycle (fictional data)' : 'WFM, payroll, bank and ERP data for one pay cycle'}</span></div>
      <div class="sources">${SOURCES.filter((s) => s.group === 'records').map(card).join('')}</div>
      <div class="group-title"><h3>Your data sources</h3><span class="muted">Anything else your team checks each cycle: benefits, tips, garnishments, expenses, contractor pay</span>${can('data') ? '<span class="spacer"></span><button class="btn small primary" type="button" data-action="cs-new">Add data source</button>' : ''}</div>
      ${SOURCES.some((s) => s.group === 'custom') ? `<div class="sources">${SOURCES.filter((s) => s.group === 'custom').map(card).join('')}</div>` : '<div class="table-wrap"><div class="empty"><h3>None yet</h3><p>Add a data source, upload its file, then write rules for it on the Rules page.</p></div></div>'}
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

  // ----------------------------------------------------------------------------------
  // Import: detect each file's source, map its columns, normalize values, load
  // ----------------------------------------------------------------------------------

  const RECORD_KINDS = ['census', 'schedules', 'time', 'register', 'bank', 'gl'];
  const KEY_COLS = {
    census: ['emp_id', 'first_name', 'last_name', 'pay_type', 'flsa_status', 'hire_date'],
    schedules: ['emp_id', 'work_date', 'scheduled_hours'],
    time: ['emp_id', 'work_date', 'wfm_hours'],
    register: ['emp_id', 'gross_pay', 'net_pay'],
    bank: ['value_date', 'txn_type', 'amount'],
    gl: ['account', 'debit', 'credit'],
  };
  // Common header names in WFM, payroll, bank and ERP exports, normalized to lowercase letters and digits.
  const SYN = {
    emp_id: ['employeeid', 'empid', 'employeenumber', 'employeeno', 'eeid', 'fileno', 'filenumber', 'associateid', 'workerid', 'personnumber', 'badgeid', 'badge', 'file', 'id'],
    first_name: ['firstname', 'first', 'givenname', 'legalfirstname'],
    last_name: ['lastname', 'last', 'surname', 'familyname', 'legallastname'],
    employee_name: ['employeename', 'name', 'fullname', 'employee', 'workername', 'associatename'],
    job_title: ['jobtitle', 'title', 'position', 'positiontitle', 'job', 'jobname'],
    location: ['location', 'store', 'site', 'worklocation', 'branch'],
    cost_center: ['costcenter', 'costcentre', 'department', 'dept', 'homedepartment', 'departmentcode', 'cc', 'costcentercode'],
    work_state: ['workstate', 'state', 'workedinstate', 'taxstate', 'suistate'],
    union_local: ['unionlocal', 'union', 'unioncode', 'bargainingunit', 'local'],
    flsa_status: ['flsastatus', 'flsa', 'exemptstatus', 'flsaclassification', 'exemptnonexempt'],
    ft_pt: ['ftpt', 'fulltimeparttime', 'fullparttime', 'ftptstatus', 'employmenttype', 'fulltime', 'timetype'],
    pay_type: ['paytype', 'payclass', 'hourlysalary', 'compensationtype', 'paybasis', 'salaryhourly'],
    hourly_rate: ['hourlyrate', 'payrate', 'baserate', 'regularrate', 'hourlypayrate', 'rate'],
    annual_salary: ['annualsalary', 'salary', 'annualpay', 'annualrate', 'annualbase', 'basesalary'],
    hire_date: ['hiredate', 'dateofhire', 'startdate', 'originalhiredate', 'doh', 'employmentstartdate'],
    term_date: ['termdate', 'terminationdate', 'separationdate', 'dateofterm', 'enddate'],
    status: ['status', 'employeestatus', 'employmentstatus', 'positionstatus'],
    bank_routing: ['bankrouting', 'routing', 'routingnumber', 'aba', 'transitnumber'],
    bank_last4: ['banklast4', 'accountlast4', 'acctlast4', 'depositaccountlast4', 'last4', 'depositaccount'],
    bank_change_date: ['bankchangedate', 'depositchangedate', 'directdepositchangedate', 'accountchangedate'],
    vac_carryover_hrs: ['vaccarryoverhrs', 'vacationcarryover', 'vaccarryover', 'carryoverhours', 'carryover'],
    vac_current_hrs: ['vaccurrenthrs', 'vacationbalance', 'vacationcurrent', 'vacbalance', 'vacationhours'],
    sick_hrs: ['sickhrs', 'sickhours', 'sickbalance', 'sick'],
    k401_pct: ['k401pct', '401kpct', '401kpercent', 'deferralpct', 'retirementpct'],
    medical_per_period: ['medicalperperiod', 'medicaldeduction', 'medicalpremium', 'healthdeduction'],
    work_date: ['workdate', 'date', 'shiftdate', 'punchdate', 'businessdate', 'applydate', 'day'],
    shift_start: ['shiftstart', 'scheduledstart', 'schedstart', 'starttime', 'start'],
    shift_end: ['shiftend', 'scheduledend', 'schedend', 'endtime', 'end'],
    meal_minutes: ['mealminutes', 'breakminutes', 'unpaidbreak', 'lunchminutes', 'meal'],
    scheduled_hours: ['scheduledhours', 'schedhours', 'shifthours', 'plannedhours', 'hours', 'duration'],
    pay_code: ['paycode', 'earningcode', 'earningscode', 'timecode', 'hourtype', 'code'],
    punch_in: ['punchin', 'clockin', 'timein', 'inpunch', 'in'],
    meal_out: ['mealout', 'lunchout', 'breakstart', 'mealstart', 'breakout'],
    meal_in: ['mealin', 'lunchin', 'breakend', 'mealend', 'breakin'],
    punch_out: ['punchout', 'clockout', 'timeout', 'outpunch', 'out'],
    wfm_hours: ['wfmhours', 'totalhours', 'workedhours', 'paidhours', 'timecardhours', 'hours'],
    manager_override: ['manageroverride', 'override', 'manualentry', 'manageredit', 'edited'],
    override_by: ['overrideby', 'editedby', 'approvedby', 'manager'],
    override_reason: ['overridereason', 'editreason', 'reason', 'comment', 'comments'],
    rate: ['rate', 'payrate', 'hourlyrate', 'baserate'],
    reg_hrs: ['reghrs', 'regularhours', 'reghours', 'regular'],
    ot_hrs: ['othrs', 'overtimehours', 'othours', 'ot'],
    dt_hrs: ['dthrs', 'doubletimehours', 'dthours', 'doubletime'],
    vac_hrs: ['vachrs', 'vacationhours', 'vachours', 'ptohours'],
    hol_hrs: ['holhrs', 'holidayhours', 'holhours', 'holiday'],
    reg_pay: ['regpay', 'regularpay', 'regularearnings', 'regearnings'],
    ot_pay: ['otpay', 'overtimepay', 'overtimeearnings', 'otearnings'],
    dt_pay: ['dtpay', 'doubletimepay', 'doubletimeearnings'],
    pto_pay: ['ptopay', 'vacationpay', 'timeoffpay', 'ptoearnings'],
    gross_pay: ['grosspay', 'gross', 'totalgross', 'grossearnings', 'grosswages'],
    fed_wh: ['fedwh', 'federalincometax', 'fit', 'fitw', 'federalwithholding', 'fedtax', 'federaltax'],
    ss_ee: ['ssee', 'socialsecurity', 'socialsecurityee', 'eesocialsecurity', 'oasdi', 'socsec'],
    medicare_ee: ['medicareee', 'medicare', 'eemedicare'],
    state_wh: ['statewh', 'stateincometax', 'sit', 'statetax', 'statewithholding'],
    state_other_ee: ['stateotheree', 'sdi', 'fli', 'statedisability', 'stateother'],
    k401_ee: ['k401ee', '401k', '401kee', '401kdeduction', 'retirement'],
    medical_ee: ['medicalee', 'medical', 'health', 'section125', 'sec125'],
    net_pay: ['netpay', 'net', 'takehome', 'netamount', 'netcheck'],
    ss_er: ['sser', 'employersocialsecurity', 'ersocialsecurity', 'oasdier'],
    medicare_er: ['medicareer', 'employermedicare', 'ermedicare'],
    futa_er: ['futaer', 'futa'],
    sui_er: ['suier', 'sui', 'suta', 'stateunemployment'],
    txn_id: ['txnid', 'transactionid', 'tracenumber', 'traceno', 'id'],
    value_date: ['valuedate', 'postdate', 'effectivedate', 'settlementdate', 'transactiondate', 'date'],
    txn_type: ['txntype', 'transactiontype', 'trancode', 'typecode', 'type'],
    amount: ['amount', 'amt', 'transactionamount', 'value'],
    payee: ['payee', 'counterparty', 'description', 'name'],
    account_last4: ['accountlast4', 'receivingaccount', 'accountnumber', 'account', 'dda'],
    return_code: ['returncode', 'reasoncode', 'achreturncode', 'return'],
    jurisdiction: ['jurisdiction', 'taxagency', 'agency', 'state'],
    reference: ['reference', 'ref', 'addenda', 'memo'],
    je_id: ['jeid', 'journalid', 'journalnumber', 'journal', 'entryid', 'documentnumber', 'batch'],
    line: ['line', 'lineno', 'linenumber'],
    post_date: ['postdate', 'postingdate', 'gldate', 'effectivedate', 'date'],
    account: ['account', 'accountnumber', 'glaccount', 'naturalaccount', 'acct', 'gl'],
    account_name: ['accountname', 'accountdescription', 'description'],
    debit: ['debit', 'dr', 'debitamount', 'debits'],
    credit: ['credit', 'cr', 'creditamount', 'credits'],
    memo: ['memo', 'linedescription', 'description', 'comment'],
  };
  const normH = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headersOf = (rows) => Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  // The engine's CSV reader lowercases header names; keep the file's own spelling for display.
  function rawHeader(text) {
    const out = [];
    let field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
      if (c === '"') q = true;
      else if (c === ',') { out.push(field.trim()); field = ''; }
      else if (c === '\n') break;
      else if (c !== '\r') field += c;
    }
    out.push(field.trim());
    return out;
  }
  const headerKey = (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const sampleRowsCache = {};
  const sampleRows = (kind) => sampleRowsCache[kind] || (sampleRowsCache[kind] = SAMPLE.files[SRC[kind].file] ? E.parseCSV(SAMPLE.files[SRC[kind].file]) : []);
  const targetsFor = (kind) => (isCustomSource(kind) ? [] : Array.from(new Set(KEY_COLS[kind].concat(E.SCHEMAS[kind], Object.keys(sampleRows(kind)[0] || {})))));
  let importSeq = 0;

  // Column types come from the sample layout, so dates, times and amounts can be normalized.
  const typeCache = {};
  function colType(kind, c) {
    const k = `${kind}.${c}`;
    if (typeCache[k]) return typeCache[k];
    const vals = sampleRows(kind).map((r) => r[c]).filter((v) => v !== undefined && v !== '');
    let t = 'text';
    if (/_date$/.test(c) || (vals.length && vals.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)))) t = 'date';
    else if (vals.length && vals.every((v) => /^\d{1,2}:\d{2}$/.test(v))) t = 'time';
    else if (vals.length && vals.every((v) => /^-?\d+(\.\d+)?$/.test(v)) && !/(_id|last4|routing|^account$|^line$)/.test(c)) t = 'num';
    return (typeCache[k] = t);
  }
  function valueHint(kind, c) {
    if (colType(kind, c) !== 'text' || /(_id$|name|title|last4|^account$|cost_center|reference|memo|payee|reason|location|override_by)/.test(c)) return '';
    const vals = Array.from(new Set(sampleRows(kind).map((r) => r[c]).filter(Boolean)));
    return vals.length && vals.length <= 8 ? vals.join(', ') : '';
  }
  function isoDate(s) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    return isNaN(d) ? s : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function hhmmOf(s) {
    const m = s.match(/^(\d{1,2}):?(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?$/);
    if (!m) return s;
    let h = +m[1];
    const ap = m[3] && m[3].toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  function numOf(s) {
    if (!/^[\s$€£(),.\-+\d]+$/.test(s)) return s;
    const neg = /^\(.*\)$/.test(s.trim()) || /^-/.test(s.replace(/[\s$€£]/g, ''));
    const n = s.replace(/[^\d.]/g, '');
    return n ? (neg ? '-' : '') + n : '';
  }
  function normVal(type, v) {
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return '';
    return type === 'date' ? isoDate(s) : type === 'time' ? hhmmOf(s) : type === 'num' ? numOf(s) : s;
  }

  function autoMap(kind, headers) {
    const saved = store.mappings && store.mappings[kind];
    if (saved && saved.sig === headers.join('|')) return Object.assign({}, saved.map);
    const map = {}, used = new Set();
    const targets = targetsFor(kind);
    const hn = headers.map((h) => [h, normH(h)]);
    targets.forEach((c) => { const hit = hn.find(([h, n]) => !used.has(h) && (h === c || n === normH(c))); if (hit) { map[c] = hit[0]; used.add(hit[0]); } });
    targets.forEach((c) => {
      if (map[c]) return;
      for (const syn of SYN[c] || []) {
        const hit = hn.find(([h, n]) => !used.has(h) && n === syn);
        if (hit) { map[c] = hit[0]; used.add(hit[0]); return; }
      }
    });
    return map;
  }
  function detectKind(name, headers) {
    const n = normH(name);
    const hints = { census: /census|employees|workers|roster/, schedules: /schedul/, time: /time|punch|clock/, register: /register|earning|payrun/, bank: /bank|ach|statement|treasury|transactions/, gl: /journal|ledger|^gl|glentry/ };
    let best = null;
    RECORD_KINDS.forEach((k) => {
      const m = autoMap(k, headers);
      const keys = KEY_COLS[k].filter((c) => m[c]).length / KEY_COLS[k].length;
      const cover = E.SCHEMAS[k].filter((c) => m[c]).length / E.SCHEMAS[k].length;
      const score = keys * 0.55 + cover * 0.45 + (hints[k].test(n) ? 0.1 : 0);
      if (!best || score > best.score) best = { kind: k, score };
    });
    if (best && best.score >= 0.5) return best.kind;
    // Your data sources: same columns as the last file loaded, or the source's name in the file name.
    const hs = new Set(headers.map(normH));
    const mine = SOURCES.filter((s) => s.group === 'custom').map((s) => {
      const cols = s.custom.columns.map(normH);
      const overlap = cols.length ? cols.filter((c) => hs.has(c)).length / Math.max(cols.length, hs.size) : 0;
      return { kind: s.key, score: overlap + (normH(s.title) && n.includes(normH(s.title)) ? 0.6 : 0) };
    }).sort((a, b) => b.score - a.score)[0];
    return mine && mine.score >= 0.6 ? mine.kind : '';
  }
  function detectPolicy(j) {
    if (j.steps && j.rates) return 'agreement';
    if (j.wage_account_by_class || (j.accounts && j.cost_centers)) return 'glMap';
    if (j.valid_pay_codes || j.expected_weekly_hours || j.vacation) return 'handbook';
    return '';
  }

  function parseImport(name, text, forceKind) {
    const it = { id: 'f' + (++importSeq), name, origin: 'upload' };
    const t = String(text || '').replace(/^﻿/, '');
    let json = null;
    if (/^\s*[[{]/.test(t)) {
      try { json = JSON.parse(t); } catch (e) { if (/\.json$/i.test(name)) { it.error = `${name} is not valid JSON.`; return it; } }
    }
    if (json && !Array.isArray(json) && typeof json === 'object') {
      const arr = ['rows', 'data', 'items', 'records', 'results', 'workers', 'employees', 'timecards', 'transactions', 'lines', 'entries'].map((k) => json[k]).find(Array.isArray);
      if (arr) json = arr;
    }
    if (json && !Array.isArray(json)) {
      if (forceKind && SRC[forceKind].group !== 'policy') { it.error = `${name} is a JSON document, not a table of ${SRC[forceKind].title.toLowerCase()} rows.`; return it; }
      return Object.assign(it, { type: 'policy', json, kind: forceKind || detectPolicy(json) });
    }
    if (forceKind && SRC[forceKind].group === 'policy') { it.error = `${SRC[forceKind].title} must be a JSON document.`; return it; }
    const rows = json
      ? json.filter((o) => o && typeof o === 'object').map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)])))
      : E.parseCSV(t);
    if (!rows.length) { it.error = `${name} has no data rows.`; return it; }
    it.type = 'table';
    it.rows = rows;
    it.headers = headersOf(rows);
    it.labels = json ? {} : Object.fromEntries(rawHeader(t).map((h) => [headerKey(h), h]));
    it.kind = forceKind || detectKind(name, it.headers);
    it.map = it.kind ? autoMap(it.kind, it.headers) : {};
    return it;
  }

  async function readFileImport(file, forceKind) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const it = { id: 'f' + (++importSeq), name: file.name, origin: 'upload', format: 'pdf' };
      if (forceKind && forceKind !== 'register') { it.error = 'Only the payroll register can be read from a PDF.'; return it; }
      try {
        const { lines, pages } = await pdfLines(new Uint8Array(await file.arrayBuffer()));
        const { rows, problems } = E.parseRegisterLines(lines);
        if (!rows.length) throw new Error('No employee lines were found. Use a text-based register PDF; scanned images need OCR first.');
        Object.assign(it, { type: 'table', kind: 'register', rows, headers: headersOf(rows), pages, problems });
        it.map = autoMap('register', it.headers);
      } catch (e) { it.error = e.message; }
      return it;
    }
    try { return parseImport(file.name, await file.text(), forceKind); } catch (e) { return { id: 'f' + (++importSeq), name: file.name, error: `${file.name} could not be read.` }; }
  }

  function importStatus(it) {
    if (it.error) return { st: 'error', label: 'Error' };
    if (it.kind === 'skip') return { st: 'skip', label: 'Skipped' };
    if (!it.kind) return { st: 'map', label: 'Choose a source' };
    if (it.type === 'table' && !isCustomSource(it.kind)) {
      const miss = KEY_COLS[it.kind].filter((c) => !it.map[c]);
      if (miss.length) return { st: 'map', label: 'Map columns', miss };
    }
    return { st: 'ready', label: 'Ready' };
  }

  function mapRows(kind, rows, map) {
    const targets = targetsFor(kind);
    const types = Object.fromEntries(targets.map((c) => [c, colType(kind, c)]));
    return rows.map((r) => {
      const o = Object.assign({}, r);
      targets.forEach((c) => { o[c] = normVal(types[c], map[c] ? r[map[c]] : ''); });
      return o;
    });
  }

  function applyItem(it) {
    const prev = state.src[it.kind] || {};
    const base = { name: it.name, origin: it.origin || 'upload', mode: prev.mode || 'upload', at: nowIso() };
    if (it.type === 'policy') { state.src[it.kind] = Object.assign(base, { json: it.json }); return; }
    if (isCustomSource(it.kind)) {
      state.src[it.kind] = Object.assign(base, { rows: it.rows, format: it.format || 'csv' });
      SRC[it.kind].custom.columns = it.headers.slice(0, 80);
      return;
    }
    state.src[it.kind] = Object.assign(base, { rows: mapRows(it.kind, it.rows, it.map), format: it.format || 'csv', pages: it.pages, problems: it.problems });
    if (it.format !== 'pdf') store.mappings[it.kind] = { sig: it.headers.join('|'), map: it.map };
  }

  function loadImports(items) {
    const ready = items.filter((it) => importStatus(it).st === 'ready');
    if (!ready.length) return;
    const wasSample = isSampleWorkspace();
    const kinds = new Set(ready.map((it) => it.kind));
    ready.forEach(applyItem);
    const cleared = [];
    if (wasSample && ready.some((it) => SRC[it.kind].group === 'records')) {
      SOURCES.filter((s) => s.group === 'records' && !kinds.has(s.key) && state.src[s.key] && state.src[s.key].origin === 'sample').forEach((s) => {
        state.src[s.key] = { mode: state.src[s.key].mode || 'upload', at: null };
        cleared.push(s.title);
      });
    }
    state.importQueue = state.importQueue.filter((q) => !ready.includes(q) && q.kind !== 'skip');
    recompute();
    const kept = persistSources();
    log('Files imported', ready.map((it) => `${it.name} → ${SRC[it.kind].title}${it.rows ? ` (${plural(it.rows.length, 'record')})` : ''}`).join('; ') + (cleared.length ? ` · sample data cleared for ${cleared.join(', ')}` : ''));
    const t = state.result.totals;
    log('Checks run', `${t.checksRun} checks · ${t.blockers} blockers, ${t.review} to review`, { by: 'Rollcall' });
    renderAll();
    toast(`Imported ${plural(ready.length, 'file')} · ran ${t.checksRun} checks${cleared.length ? ' · sample data cleared' : ''}${kept ? '' : ' · too large to keep after a refresh'}`);
  }

  async function enqueueFiles(files, forceKind) {
    if (!files.length) return;
    if (!allow('data')) return;
    if (state.page !== 'sources' && !forceKind) go('sources');
    state.importBusy = `Reading ${plural(files.length, 'file')}…`;
    renderImportQueue();
    const items = [];
    for (const f of files) items.push(await readFileImport(f, forceKind));
    state.importBusy = '';
    if (forceKind) {
      const it = items[0];
      if (it.error) { state.src[forceKind] = Object.assign({}, state.src[forceKind], { error: it.error }); renderImportQueue(); if (state.page === 'sources') renderSources(); return; }
      if (importStatus(it).st === 'ready') { loadImports([it]); return; }
      it.autoLoad = true;
      state.importQueue.push(it);
      renderImportQueue();
      mappingModal(it);
      return;
    }
    state.importQueue.push(...items);
    renderImportQueue();
  }

  function renderImportQueue() {
    const el = $('#importQueue');
    if (el) el.innerHTML = queueHtml();
  }

  function importCardHtml() {
    return `<section class="card import-card" id="importCard" aria-labelledby="importTitle">
      <div class="drop" id="dropZone">
        <span class="drop-icon" aria-hidden="true">${ICON.upload}</span>
        <div><h3 id="importTitle">Import this cycle’s files</h3>
          <p class="muted">Drop exports from WFM, payroll, the bank and the ERP here, several at once: CSV, JSON or the printed PDF register. Rollcall recognizes each file by its columns, and you can map any it doesn’t. Files are read in this browser and never sent anywhere.</p></div>
        <div class="actions-row"><span class="btn primary file-btn">Choose files<input type="file" id="importFiles" multiple accept=".csv,.json,.pdf,text/csv,application/json,application/pdf" aria-label="Choose files to import"></span><button class="btn" type="button" data-action="templates">CSV templates</button></div>
      </div>
      <div id="importQueue">${queueHtml()}</div>
    </section>`;
  }

  function queueHtml() {
    if (state.importBusy) return `<p class="muted" style="padding:0 20px 16px">${esc(state.importBusy)}</p>`;
    const q = state.importQueue;
    if (!q.length) return '';
    const statuses = q.map(importStatus);
    const ready = q.filter((it, i) => statuses[i].st === 'ready');
    const blocking = q.filter((it, i) => statuses[i].st === 'map' || statuses[i].st === 'error');
    const options = (it) => {
      const list = it.type === 'policy' ? SOURCES.filter((s) => s.group === 'policy') : it.format === 'pdf' ? [SRC.register] : SOURCES.filter((s) => s.group === 'records' || s.group === 'custom');
      return `<option value="" disabled ${it.kind ? '' : 'selected'}>Choose a source…</option>${list.map((s) => `<option value="${s.key}" ${it.kind === s.key ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}${it.type === 'table' && it.format !== 'pdf' && can('data') ? '<option value="__new">New data source…</option>' : ''}<option value="skip" ${it.kind === 'skip' ? 'selected' : ''}>Don’t import</option>`;
    };
    const dupe = (it) => it.kind && it.kind !== 'skip' && q.filter((x) => x.kind === it.kind && !x.error).length > 1;
    const pillCls = { ready: 'pass', map: 'review', error: 'blocker', skip: 'plain' };
    return `<div class="table-wrap"><table class="import-table">
      <thead><tr><th>File</th><th>Source</th><th>Columns</th><th>Status</th><th></th></tr></thead>
      <tbody>${q.map((it, i) => {
        const st = statuses[i];
        const tbl = it.type === 'table' && it.kind && it.kind !== 'skip' && !it.error;
        const targets = tbl ? targetsFor(it.kind) : [];
        const matched = targets.filter((c) => it.map[c]).length;
        return `<tr>
          <td><b class="mono" style="font-size:var(--t-xs)">${esc(it.name)}</b><br><span class="muted" style="font-size:var(--t-xs)">${it.rows ? plural(it.rows.length, 'record') : it.type === 'policy' ? 'JSON document' : ''}${it.format === 'pdf' && it.pages ? ` · PDF, ${plural(it.pages, 'page')}` : ''}</span></td>
          <td>${it.error ? '<span class="muted">—</span>' : `<select data-import-kind="${it.id}" aria-label="Source for ${esc(it.name)}">${options(it)}</select>`}${dupe(it) ? '<br><span class="muted" style="font-size:var(--t-xs)">Another file is set to this source too; the last one is used.</span>' : ''}</td>
          <td class="wrap">${it.error ? `<span class="neg">${esc(it.error)}</span>` : tbl && isCustomSource(it.kind) ? `${plural(it.headers.length, 'column')}, kept as they are` : tbl ? `${matched} of ${targets.length} matched${st.miss ? `<br><span class="neg" style="font-size:var(--t-xs)">Needs ${esc(st.miss.join(', '))}</span>` : ''}` : '<span class="muted">—</span>'}</td>
          <td><span class="pill ${pillCls[st.st]}">${esc(st.label)}</span></td>
          <td style="text-align:right">${tbl && !isCustomSource(it.kind) ? `<button class="btn small" type="button" data-action="map-cols" data-id="${it.id}">Map columns</button> ` : ''}<button class="linkish" type="button" data-action="import-remove" data-id="${it.id}" style="font-size:var(--t-xs)">Remove</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <div class="import-foot">
        <span class="muted" style="font-size:var(--t-sm)">${blocking.length ? `Map, fix or skip ${plural(blocking.length, 'file')} above to continue.` : `${plural(ready.length, 'file')} ready.`}${isSampleWorkspace() && ready.some((it) => SRC[it.kind].group === 'records') ? ' Loading replaces the sample cycle.' : ''}</span>
        <span class="spacer"></span>
        <button class="linkish" type="button" data-action="import-clear">Clear</button>
        <button class="btn primary" type="button" data-action="import-load" ${ready.length && !blocking.length ? '' : 'disabled'}>Load ${plural(ready.length, 'file')} and run checks</button>
      </div>`;
  }

  function mappingModal(it, opener) {
    const keys = new Set(KEY_COLS[it.kind]);
    const schema = new Set(E.SCHEMAS[it.kind]);
    const order = targetsFor(it.kind).sort((a, b) => (keys.has(b) - keys.has(a)) || (schema.has(b) - schema.has(a)));
    openModal(`<div class="mh"><span class="eyebrow">${esc(it.name)} → ${esc(SRC[it.kind].title)}</span><h2 id="modalTitle">Map columns</h2></div>
      <div class="mb">
        <p>Match each Rollcall field to a column in your file. Required fields must be mapped; anything set to “Not in this file” is read as blank. Dates, times and amounts are normalized on import, and Rollcall remembers this mapping for files with the same columns.</p>
        <div class="table-wrap map-table"><table>
          <thead><tr><th>Rollcall field</th><th>Column in your file</th><th>First value</th></tr></thead>
          <tbody>${order.map((c) => {
            const hint = valueHint(it.kind, c);
            return `<tr>
              <td><b class="mono" style="font-size:var(--t-xs)">${esc(c)}</b>${keys.has(c) ? ' <span class="pill review">Required</span>' : ''}${hint ? `<br><span class="muted" style="font-size:var(--t-2xs)">Values like ${esc(hint)}</span>` : ''}</td>
              <td><select data-map-col="${esc(c)}" aria-label="Column for ${esc(c)}"><option value="">— Not in this file —</option>${it.headers.map((h) => `<option value="${esc(h)}" ${it.map[c] === h ? 'selected' : ''}>${esc((it.labels && it.labels[h]) || h)}</option>`).join('')}</select></td>
              <td class="mono map-ex" data-map-ex="${esc(c)}">${esc(firstValue(it, it.map[c]))}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="form-err" id="mapErr" hidden></p>
      </div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="save-map" data-id="${it.id}">${it.autoLoad ? 'Save and load' : 'Save mapping'}</button></div>`, opener, true);
  }
  const firstValue = (it, h) => { if (!h) return ''; const r = it.rows.find((x) => x[h] !== '' && x[h] !== undefined); return r ? r[h] : ''; };

  function templatesModal(opener) {
    openModal(`<div class="mh"><h2 id="modalTitle">CSV templates</h2></div>
      <div class="mb"><p>Each template has Rollcall’s column names and one example row from the sample cycle. Your own exports don’t have to match; you can map their columns on import.</p>
        <ul class="history">${SOURCES.filter((s) => s.group === 'records').map((s) => `<li style="grid-template-columns:minmax(0,1fr) auto;align-items:center"><span><b>${esc(s.title)}</b><br><span class="muted" style="font-size:var(--t-xs)">Required: ${esc(KEY_COLS[s.key].join(', '))}</span></span><button class="btn small" type="button" data-action="dl-template" data-key="${s.key}">${ICON.download} CSV</button></li>`).join('')}</ul></div>
      <div class="mf"><button class="btn primary" type="button" data-action="close-modal">Done</button></div>`, opener);
  }

  async function syncSource(key) {
    const conn = store.connectors[key] || {};
    const p = state.result.period;
    const url = String(conn.url || '').trim().replace(/\{start\}/g, p.start).replace(/\{end\}/g, p.end);
    const prev = state.src[key] || {};
    if (!/^https:\/\/\S+$/i.test(url)) { state.src[key] = Object.assign({}, prev, { error: 'Enter this source’s HTTPS endpoint first.' }); renderSources(); return; }
    state.busy[key] = 'Syncing…';
    state.src[key] = Object.assign({}, prev, { error: '' });
    renderSources();
    try {
      const headers = { Accept: 'text/csv, application/json;q=0.9, */*;q=0.5' };
      if (state.auth[key]) headers.Authorization = state.auth[key];
      let res;
      try { res = await fetch(url, { headers, credentials: 'omit', cache: 'no-store' }); } catch (e) { throw new Error('Couldn’t reach the endpoint. Check the URL, and that it allows cross-origin requests from this site (CORS).'); }
      if (!res.ok) throw new Error(`The endpoint answered ${res.status}${res.statusText ? ' ' + res.statusText : ''}.`);
      const u = new URL(url);
      const it = parseImport(u.host + u.pathname, await res.text(), key);
      it.origin = 'api';
      if (it.error) throw new Error(it.error);
      delete state.busy[key];
      if (importStatus(it).st === 'ready') loadImports([it]);
      else { it.autoLoad = true; state.importQueue.push(it); renderSources(); mappingModal(it); }
    } catch (e) {
      delete state.busy[key];
      state.src[key] = Object.assign({}, state.src[key] || prev, { error: e.message });
      renderSources();
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
    SOURCES.filter((s) => s.group === 'records' || s.group === 'custom').forEach((s) => { state.src[s.key] = { mode: (state.src[s.key] && state.src[s.key].mode) || 'upload', at: null }; });
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
    const ro = can('rules') ? '' : 'disabled';
    const ua = input().agreement || {};
    const glm = input().glMap || {};
    const control = (f) => {
      const id = 'rule-' + f.key;
      if (f.type === 'bool') return `<input type="checkbox" id="${id}" data-rule="${f.key}" ${cfg[f.key] ? 'checked' : ''} ${ro}>`;
      if (f.type === 'select') return `<select id="${id}" data-rule="${f.key}" ${ro}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(cfg[f.key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      return `<input type="number" inputmode="decimal" id="${id}" data-rule="${f.key}" value="${esc(ruleValue(f, cfg))}" step="${f.step || 1}" min="0" ${ro}>`;
    };
    const steps = ua.steps || [];
    const rates = ua.rates || {};
    $('#page').innerHTML = `
      <div class="page-head">
        <div><h1>Rules</h1><p>Add your own rules on any data source, and adjust the thresholds that come from the union agreement and employee handbook. Every change re-runs the checks and is logged.</p></div>
        <div class="actions"><button class="btn small" type="button" data-action="reset-rules" ${Object.keys(store.settings).length && can('rules') ? '' : 'disabled'}>Reset all to policy</button></div>
      </div>
      ${can('rules') ? '' : `<div class="notice" style="margin-bottom:12px"><span>View only: your role (${esc(roleLabel(me()))}) can’t change rules.</span></div>`}
      ${customRulesHtml()}
      <div class="group-title"><h3>Policy thresholds</h3><span class="muted">From the union agreement and employee handbook</span></div>
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
    if (!allow('rules')) { renderRules(); return; }
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
  // The checks: one engine run, shown as five steps of the pay cycle.
  // Rules calculate the dollars; the AI explains and groups; a reviewer approves.
  // ----------------------------------------------------------------------------------

  const APPS = [
    { id: 'feedpulse', num: 1, name: 'Data quality', q: 'Did the data arrive complete and on time?' },
    { id: 'runradar', num: 2, name: 'Pay accuracy', q: 'Is everyone paid the right amount?' },
    { id: 'exceptions', num: 3, name: 'Review queue', q: 'Has a person checked every exception?' },
    { id: 'threeway', num: 4, name: 'Bank and ledger', q: 'Do payroll, the bank and the ledger agree?' },
    { id: 'fixflow', num: 5, name: 'Repeat issues', q: 'What keeps going wrong?' },
  ];
  const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));
  const RUNRADAR_TIME = new Set(['T5', 'T6', 'T7', 'T10']);
  const appOf = (x) => {
    const c = typeof x === 'string' ? x : x.check;
    if (CHECK_OF[c] && CHECK_OF[c].custom) {
      const st = typeof x === 'string' ? CHECK_OF[c].stage : x.stage;
      return st === 'payroll' ? 'runradar' : st === 'funding' || st === 'gl' ? 'threeway' : 'feedpulse';
    }
    if (c[0] === 'F' || c[0] === 'G') return 'threeway';
    if (c[0] === 'P' || RUNRADAR_TIME.has(c)) return 'runradar';
    return 'feedpulse';
  };
  const APP_NAME = { feedpulse: 'Data quality', runradar: 'Pay accuracy', threeway: 'Bank and ledger' };
  const appChip = (id) => `<span class="appchip" data-app="${id}">${esc(APP_NAME[id] || APP_BY_ID[id === 'variance' ? 'exceptions' : id].name)}</span>`;

  // ---- Policy clauses cited by each check
  const CHECK_CLAUSES = {
    T1: ['HB 3.2', 'HB 3.3'], T2: ['HB 3.3'], T3: ['HB 3.4'], T4: ['HB 3.6'], T5: ['HB 4.1', 'CBA 7.1'], T6: ['CBA 7.2', 'CBA 7.3', 'HB 4.2'],
    T7: ['HB 4.1'], T8: ['HB 3.5'], T9: ['HB 5.1'], T10: ['HB 7.4'],
    R1: ['HB 8.1'], R2: ['HB 8.1'], R3: ['HB 8.1'], R4: ['HB 8.1'], R5: ['HB 8.1'],
    P1: ['HB 8.1'], P2: ['CBA 12.1', 'CBA 12.2'], P3: ['HB 3.3'], P4: ['CBA 7.2', 'CBA 7.3', 'HB 4.2'], P5: ['HB 4.2'], P9: ['HB 6.3'], P10: ['HB 8.1'],
    F1: ['FIN 2.1'], F2: ['FIN 2.2'], F3: ['FIN 2.2', 'HB 8.2'], F4: ['FIN 2.3', 'HB 8.2'], F5: ['FIN 2.4'], F6: ['FIN 3.1'], F7: ['FIN 3.2'],
    G1: ['FIN 4.1'], G2: ['FIN 4.1'], G3: ['FIN 4.2'], G4: ['FIN 4.3'], G5: ['FIN 4.3'], G6: ['FIN 2.1'], G7: ['FIN 4.4'],
  };
  function allClauses() {
    const i = input();
    const out = {};
    [[i.handbook, 'Employee handbook'], [i.agreement, 'Union agreement'], [i.glMap, 'Finance and treasury rules']].forEach(([d, label]) => {
      ((d && d.clauses) || []).forEach((c) => { out[c.id] = Object.assign({ doc: label }, c); });
    });
    return out;
  }
  function clausesFor(x) {
    const mine = CHECK_OF[x.check];
    if (mine && mine.custom) return [{ id: x.check, title: mine.title, doc: 'Rule set by your team', text: mine.rule() }];
    let ids = CHECK_CLAUSES[x.check] || [];
    if (x.check === 'T9') ids = /sick/i.test(x.title) ? ['HB 7.3', 'HB 5.1'] : ['HB 5.1'];
    if (x.check === 'T10') ids = /sick/i.test(x.title) ? ['HB 7.4', 'HB 7.1'] : ['HB 7.4'];
    if (x.check === 'P9') ids = /sick/i.test(x.title) ? ['HB 7.2', 'HB 7.1'] : /carryover/i.test(x.title) ? ['HB 6.2'] : /bucket/i.test(x.title) ? ['HB 6.3'] : ['HB 6.1', 'HB 6.3'];
    if (x.check === 'T1' && !/meal/i.test(x.title)) ids = ['HB 3.3', 'HB 3.2'];
    const all = allClauses();
    return ids.map((id) => all[id]).filter(Boolean);
  }

  // ---- Evidence: the source records behind an exception, each with a citation ref
  const PICK = {
    census: ['emp_id', 'job_title', 'location', 'cost_center', 'union_local', 'flsa_status', 'ft_pt', 'pay_type', 'hourly_rate', 'annual_salary', 'hire_date', 'term_date'],
    censusPto: ['vac_carryover_hrs', 'vac_current_hrs', 'sick_accrued_hrs', 'sick_hrs'],
    censusBank: ['bank_last4', 'bank_change_date'],
    time: ['record_id', 'work_date', 'pay_code', 'punch_in', 'meal_out', 'meal_in', 'punch_out', 'wfm_hours', 'manager_override', 'override_by', 'override_reason', 'note'],
    sched: ['work_date', 'shift_start', 'shift_end', 'scheduled_hours', 'schedule_source'],
    reg: ['emp_id', 'pay_type', 'rate', 'reg_hrs', 'ot_hrs', 'dt_hrs', 'vac_hrs', 'sick_hrs', 'hol_hrs', 'reg_pay', 'ot_pay', 'dt_pay', 'pto_pay', 'gross_pay', 'net_pay'],
    regPto: ['vac_co_begin', 'vac_co_end', 'vac_cur_begin', 'vac_cur_end', 'sick_acc_begin', 'sick_acc_end', 'sick_begin', 'sick_end'],
    regTax: ['gross_pay', 'medical_ee', 'ss_ee', 'medicare_ee', 'ss_er', 'medicare_er', 'work_state'],
    regBank: ['net_pay', 'bank_last4'],
    bank: ['txn_id', 'value_date', 'txn_type', 'amount', 'emp_id', 'account_last4', 'return_code', 'jurisdiction', 'reference'],
    gl: ['je_id', 'line', 'account', 'account_name', 'cost_center', 'debit', 'credit', 'memo'],
  };
  const pickRow = (row, keys) => Object.fromEntries(keys.filter((k) => row && row[k] !== undefined && row[k] !== '').map((k) => [k, row[k]]));

  function evidenceFor(x) {
    const r = state.result, i = input(), ev = [];
    const add = (system, label, fields) => { if (Object.keys(fields).length) ev.push({ ref: `R${ev.length + 1}`, system, label, fields }); };
    const emp = x.empId && r.empById[x.empId];
    const c = emp && emp.census;
    const ck = x.check;
    if (x.custom) {
      if (c) add('Payroll census', `Census record ${c.emp_id}`, pickRow(c, PICK.census));
      if (x.row) {
        const def = SRC[x.source];
        const safe = Object.fromEntries(Object.entries(x.row).filter(([k, v]) => !SENSITIVE_RE.test(k) && v !== undefined && String(v).trim() !== '').slice(0, 16));
        add(def ? def.title : 'Data source', x.rowCount > 1 ? `Total of ${x.rowCount} rows for this employee` : `Row from ${def ? def.title : 'the file'}`, safe);
      }
      return ev;
    }
    if (c) add('Payroll census', `Census record ${c.emp_id}`, pickRow(c, PICK.census.concat(['P9', 'T10'].includes(ck) ? PICK.censusPto : [], ck[0] === 'F' ? PICK.censusBank : [])));
    if (x.empId && ['T1', 'T2', 'T3', 'T4', 'T8', 'T9', 'R1', 'R3', 'R4', 'R5', 'T10', 'P3'].includes(ck)) {
      let recs = i.time.filter((t) => t.emp_id === x.empId);
      if (x.date && ck !== 'R5') recs = recs.filter((t) => t.work_date === x.date);
      else if (ck === 'T2') recs = recs.filter((t) => /^y/i.test(t.manager_override || '') || !(t.punch_in || t.punch_out));
      else if (ck === 'T10' || ck === 'P3') recs = recs.filter((t) => t.pay_code && t.pay_code !== 'REG');
      else if (ck === 'R3' && emp && emp.hire) recs = recs.filter((t) => t.work_date < emp.hire);
      else if (ck === 'R4' && emp && emp.term) recs = recs.filter((t) => t.work_date > emp.term);
      else if (ck === 'R5') recs = recs.slice().sort((a, b) => (a.work_date < b.work_date ? -1 : 1)).slice(0, 1);
      recs.slice(0, 4).forEach((t) => add('WFM time records', `Time record ${t.record_id || t.work_date}`, pickRow(t, PICK.time)));
      const sch = i.schedules.filter((s) => s.emp_id === x.empId && (x.date && ck !== 'R5' ? s.work_date === x.date : false));
      sch.slice(0, 2).forEach((s) => add('WFM schedules', `Scheduled shift ${s.work_date}`, pickRow(s, PICK.sched)));
    }
    if (emp && emp.hasWfm && ['T5', 'T6', 'T7', 'P3', 'P4', 'P5'].includes(ck)) {
      const weeks = [0, 1].map((w) => emp.days.filter((d) => d.week === w));
      const fields = {};
      weeks.forEach((ds, w) => {
        fields[`week${w + 1}_worked_hours`] = E.util.r2(sum(ds.filter((d) => !c || d.inWindow), (d) => d.worked)).toFixed(2);
        fields[`week${w + 1}_sunday_hours`] = E.util.r2(sum(ds.filter((d) => d.dow === 0 && (!c || d.inWindow)), (d) => d.worked)).toFixed(2);
        fields[`week${w + 1}_time_off_hours`] = E.util.r2(sum(ds.filter((d) => !c || d.inWindow), (d) => d.ptoHours)).toFixed(2);
      });
      add('WFM time records', 'Approved WFM hours by week', fields);
    }
    const R = emp && emp.register;
    if (R && (ck[0] === 'P' || ['T10', 'R2', 'R3', 'R5', 'F2', 'F3', 'F4', 'F5'].includes(ck))) {
      const keys = ck === 'P9' || ck === 'T10' ? PICK.reg.slice(0, 1).concat(['vac_hrs', 'sick_hrs'], PICK.regPto) : ck === 'P7' ? PICK.regTax : ck[0] === 'F' ? PICK.regBank : PICK.reg;
      add('Payroll register', `Register line ${R.emp_id}`, pickRow(R, keys));
    }
    if (ck[0] === 'F') {
      let rows = [];
      if (x.empId) rows = i.bank.filter((b) => b.emp_id === x.empId);
      else if (ck === 'F6') rows = i.bank.filter((b) => b.txn_type === 'TAX_REMIT' || b.txn_type === 'TAX_FUNDING');
      else if (ck === 'F7') rows = i.bank.filter((b) => b.txn_type === 'BENEFIT_REMIT');
      else if (ck === 'F1') rows = i.bank.filter((b) => b.txn_type === 'NET_PAY_FUNDING');
      if (ck === 'F5' && x.links && x.links.length) rows = rows.concat(i.bank.filter((b) => x.links.includes(b.emp_id) && b.txn_type === 'ACH_CREDIT'));
      rows.slice(0, 6).forEach((b) => add('Bank activity', `Bank transaction ${b.txn_id}`, pickRow(b, PICK.bank)));
    }
    if (ck[0] === 'G') {
      const glm = i.glMap || {};
      const ccs = (`${x.title} ${x.detail}`.match(/CC-\d+/g) || []);
      let lines = i.gl.filter((l) => ccs.includes(l.cost_center) || (ck === 'G3' && l.account === glm.suspense_account));
      if (ck === 'G4') lines = i.gl.filter((l) => l.account === glm.employer_tax_account);
      if (ck === 'G5') lines = i.gl.filter((l) => Object.values(glm.liability_accounts || {}).includes(l.account));
      if (ck === 'G6') lines = i.gl.filter((l) => l.account === glm.cash_account);
      if (ck === 'G7') lines = i.gl.filter((l) => l.account === glm.vacation_liability_account || l.account === glm.vacation_accrual_expense_account);
      lines.slice(0, 6).forEach((l) => add('GL journal', `${l.je_id} line ${l.line}`, pickRow(l, PICK.gl)));
      if (ck === 'G4' || ck === 'G5') i.bank.filter((b) => b.txn_type === 'TAX_REMIT').slice(0, 4).forEach((b) => add('Bank activity', `Bank transaction ${b.txn_id}`, pickRow(b, PICK.bank)));
    }
    return ev;
  }

  // ---- Masking: what leaves the browser for the AI uses synthetic identifiers only
  let maskCache = null;
  function masker() {
    if (maskCache && maskCache.result === state.result) return maskCache;
    const r = state.result;
    const ids = r.employees.map((e) => e.id).sort();
    const idMap = {}, back = {};
    ids.forEach((id, k) => { idMap[id] = `EMP-${String(k + 1).padStart(3, '0')}`; });
    const pairs = [];
    const firstCount = {};
    r.employees.forEach((e) => { const f = String(e.name || '').split(' ')[0]; firstCount[f] = (firstCount[f] || 0) + 1; });
    r.employees.forEach((e) => {
      const tok = idMap[e.id];
      back[tok] = `${e.name} (${e.id})`;
      if (e.name) pairs.push([e.name, tok]);
      const [first, ...rest] = String(e.name || '').split(' ');
      const last = rest.join(' ');
      if (last && last.length > 2) pairs.push([`${first[0]}. ${last}`, `${tok} (manager)`]);
      if (first && first.length > 2 && firstCount[first] === 1) pairs.push([first, tok]);
    });
    pairs.sort((a, b) => b[0].length - a[0].length);
    const accts = {};
    let acctN = 0;
    const acct = (d) => accts[d] || (accts[d] = `ACCT-${String(++acctN).padStart(2, '0')}`);
    const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRe = pairs.length ? new RegExp(`\\b(${pairs.map((p) => reEsc(p[0])).join('|')})\\b`, 'g') : null;
    const nameMap = Object.fromEntries(pairs);
    const text = (s) => {
      if (s === null || s === undefined) return s;
      let t = String(s);
      if (nameRe) t = t.replace(nameRe, (m) => nameMap[m] || m);
      t = t.replace(/\bE\d{4}\b/g, (m) => idMap[m] || 'EMP-???');
      t = t.replace(/\*{2,4}(\d{4})\b/g, (m, d) => acct(d));
      t = t.replace(/\b\d{9}\b/g, '[routing]');
      t = t.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
      return t;
    };
    const DROP = new Set(['first_name', 'last_name', 'employee_name', 'bank_routing', 'ssn', 'address', 'street', 'city', 'zip', 'payee', 'reference']);
    const obj = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !DROP.has(k)).map(([k, v]) => {
      if (k === 'emp_id') return [k, idMap[v] || v];
      if (k === 'bank_last4' || k === 'account_last4') return [k, v ? acct(v) : v];
      if (k === 'override_by') return [k, v ? String(v).replace(/^.*\(/, 'Manager (').replace(/^[^(]*$/, 'Manager') : v];
      return [k, text(v)];
    }));
    const unmask = (s) => String(s || '').replace(/EMP-\d{3}/g, (m) => back[m] || m);
    maskCache = { result: r, id: (eid) => idMap[eid] || eid, text, obj, unmask };
    return maskCache;
  }

  function aiExplainPayload(x) {
    const m = masker();
    const p = state.result.period;
    return {
      company: 'Retail apparel employer, NY and NJ stores (synthetic demo data)',
      pay_period: `${p.start} to ${p.end}`,
      exception: {
        check: `${x.check} ${CHECK_OF[x.check].title}`, rule: CHECK_OF[x.check].rule(state.result.config),
        application: APP_NAME[appOf(x)], severity: x.severity, employee: x.empId ? m.id(x.empId) : 'whole cycle',
        title: m.text(x.custom ? CHECK_OF[x.check].title : x.title), finding: m.text(x.custom ? customFinding(x) : x.detail), expected: m.text(x.expected || ''), actual: m.text(x.actual || ''),
        dollar_impact_from_rules: x.impact ? `${F.money(x.impact.amount)} ${KIND_WORD[x.impact.kind]}${x.impact.estimated ? ' (estimate)' : ''}` : 'none',
        owner: ownerOf(x), suggested_action: m.text(x.action || ''),
      },
      records: evidenceFor(x).map((e) => ({ ref: e.ref, system: e.system, record: m.obj(e.fields) })),
      policy: clausesFor(x).map((c) => ({ id: c.id, title: c.title, document: c.doc, text: c.text })),
    };
  }

  // ---- AI service (Vercel function). Without it, explanations are assembled from the records by rules.
  const aiKey = (x) => `${x.key}|${String(x.detail).length}|${String(x.detail).slice(0, 40)}`;
  function aiStore() {
    store.ai = store.ai || {};
    return store.ai[cycleId()] || (store.ai[cycleId()] = { explain: {}, clusters: null });
  }
  async function checkAi() {
    state.ai = { available: false, checked: false };
    if (!/^https?:$/.test(location.protocol)) { state.ai.checked = true; return; }
    try {
      const res = await fetch('api/ai', { method: 'GET', headers: { Accept: 'application/json' } });
      const j = res.ok ? await res.json() : null;
      state.ai = { available: !!(j && j.ai), model: j && aiName(j), checked: true };
    } catch (e) { state.ai = { available: false, checked: true }; }
    if (state.page === 'exceptions') renderDetail();
    if (state.page === 'fixflow') renderFixflow();
    if (state.page === 'settings' && state.ai.available) renderSettings();
  }
  // "openai/gpt-oss-120b" from Groq reads as "gpt-oss-120b on Groq".
  function aiName(j) {
    const model = String(j.model || '').split('/').pop() || 'the AI';
    return j.provider ? `${model} on ${j.provider}` : model;
  }
  async function callAi(task, payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.aiCode) headers['x-access-code'] = state.aiCode;
    const res = await fetch('api/ai', { method: 'POST', headers, body: JSON.stringify({ task, payload }) });
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok) throw new Error((j && j.message) || `The AI service answered ${res.status}.`);
    return Object.assign({}, j, { model: aiName(j) });
  }
  async function explainWithAi(key) {
    const x = exByKey(key);
    if (!x) return;
    state.aiBusy = key;
    renderDetail();
    try {
      const j = await callAi('explain', aiExplainPayload(x));
      aiStore().explain[aiKey(x)] = { at: nowIso(), model: j.model, data: j.data };
      save();
      log('AI explanation', `${exLabel(x)} — explained by ${j.model}`, { ref: x.key, by: 'Rollcall' });
      state.aiError = null;
    } catch (e) { state.aiError = { key, message: e.message }; }
    state.aiBusy = null;
    if (state.page === 'exceptions') renderDetail();
  }

  function groundedExplanation(x) {
    const ev = evidenceFor(x);
    const cl = clausesFor(x);
    return {
      summary: x.title,
      explanation: x.detail,
      citations: ev.map((e) => ({ ref: e.ref, why: e.label })),
      policy: cl[0] ? { clause: `${cl[0].id} ${cl[0].title}`, how_it_applies: cl[0].text } : null,
      owner: ownerOf(x),
      next_step: x.action || '',
    };
  }

  function citeHtml(text, unmask) {
    const m = masker();
    const t = unmask ? m.unmask(text) : text;
    return esc(t).replace(/\[(R\d+)\]/g, '<button class="cite" type="button" data-action="cite" data-ref="$1">$1</button>');
  }

  function varianceVoiceHtml(x) {
    const cached = aiStore().explain[aiKey(x)];
    const busy = state.aiBusy === x.key;
    const err = state.aiError && state.aiError.key === x.key ? state.aiError.message : '';
    const data = cached ? cached.data : groundedExplanation(x);
    const fromAi = !!cached;
    const unmask = state.unmask;
    const ev = evidenceFor(x);
    const cl = clausesFor(x);
    const policyHtml = fromAi && data.policy
      ? `<blockquote class="clause"><b>${esc(data.policy.clause)}</b> ${citeHtml(data.policy.how_it_applies, unmask)}</blockquote>`
      : cl.map((c) => `<blockquote class="clause"><b>${esc(c.id)} ${esc(c.title)}</b> <span class="muted">${esc(c.doc)}</span><br>${esc(c.text)}</blockquote>`).join('');
    const aiBtn = state.ai && state.ai.available && store.policy.aiExplain && can('ai')
      ? `<button class="btn small ${fromAi ? '' : 'primary'}" type="button" data-action="ai-explain" data-key="${esc(x.key)}" ${busy ? 'disabled' : ''}>${busy ? 'Explaining…' : fromAi ? 'Explain again' : 'Explain with AI'}</button>`
      : '';
    const sourceLine = fromAi
      ? `Written by ${esc(cached.model || 'the AI')} from the records below, with names hidden · ${esc(stamp(cached.at))}`
      : !store.policy.aiExplain ? 'Put together from the records by the rules. AI explanations are turned off by a payroll admin.'
        : state.ai && state.ai.available ? `Put together from the records by the rules.${can('ai') ? ' Ask the AI for a written explanation.' : ''}` : 'Put together from the records by the rules. The AI service isn’t connected on this deployment.';
    return `<section class="vv" aria-label="Why it happened">
      <div class="vv-head"><b>Why it happened</b><span class="spacer"></span>${fromAi && can('unmask') ? `<label class="field vv-unmask"><input type="checkbox" class="cb" id="unmaskToggle" ${unmask ? 'checked' : ''}> Show real names</label>` : ''}${aiBtn}</div>
      <p class="vv-source">${sourceLine}</p>
      ${err ? `<p class="form-err">${esc(err)}</p>` : ''}
      ${fromAi ? `<p class="vv-summary">${citeHtml(data.summary, unmask)}</p>` : ''}
      <p class="vv-text">${fromAi ? citeHtml(data.explanation, unmask) : esc(data.explanation)}</p>
      ${policyHtml}
      <div class="vv-next"><div><span>Owner</span><b>${esc(fromAi ? data.owner : ownerOf(x))}</b></div><div><span>Next step</span><b>${fromAi ? citeHtml(data.next_step, unmask) : esc(data.next_step)}</b></div></div>
    </section>
    <section><h4>Evidence ${fromAi ? 'the AI cited' : 'behind the finding'}</h4>
      ${ev.length ? `<div class="evid">${ev.map((e) => {
        const why = fromAi && Array.isArray(data.citations) ? (data.citations.find((c) => c.ref === e.ref) || {}).why : '';
        return `<div class="evid-row" id="ev-${e.ref}"><span class="cite static">${e.ref}</span><div><b>${esc(e.label)}</b> <span class="muted">${esc(e.system)}</span>${why ? `<div class="evid-why">${citeHtml(why, unmask)}</div>` : ''}
          <div class="evid-fields">${Object.entries(e.fields).map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(v)}</span>`).join('')}</div></div></div>`;
      }).join('')}</div>` : '<p class="muted">This check works on totals; the figures are in the finding above.</p>'}
    </section>
    <details class="ai-sees"><summary>What the AI sees (names hidden)</summary>
      <p class="muted" style="font-size:var(--t-xs);margin:6px 0">Names, employee IDs, bank accounts and routing numbers are replaced with synthetic values before anything leaves the browser. Dollar figures come from the rules.</p>
      <pre>${esc(JSON.stringify(aiExplainPayload(x), null, 2))}</pre></details>`;
  }

  // ---- Data quality: is the data on time and complete?
  const FEED_KEYS = ['time', 'schedules', 'census'];
  const SAMPLE_RECEIVED = { census: '2026-09-28T08:30:00', time: '2026-09-28T09:12:00', schedules: '2026-09-28T14:40:00', register: '2026-09-29T16:05:00', bank: '2026-10-06T07:00:00', gl: '2026-10-02T18:20:00' };
  function addDaysIso(d, n) { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
  function feedStatus(key) {
    const s = state.src[key] || {};
    const p = state.result.period;
    const due = `${addDaysIso(p.end, store.policy.cutoffDays)}T${store.policy.cutoffTime}:00`;
    const rows = s.rows || [];
    const loaded = !!s.rows;
    const received = !loaded ? null : s.origin === 'sample' ? SAMPLE_RECEIVED[key] : (s.received || s.at);
    const late = received && new Date(received) > new Date(due) ? (new Date(received) - new Date(due)) / 60000 : 0;
    const keys = KEY_COLS[key] || [];
    const blanks = keys.map((c) => [c, rows.filter((r) => r[c] === undefined || String(r[c]).trim() === '').length]).filter(([, n]) => n);
    const filled = rows.length && keys.length ? 1 - sum(blanks, ([, n]) => n) / (rows.length * keys.length) : 1;
    let outside = 0, dupes = 0;
    if (key === 'time' || key === 'schedules') {
      outside = rows.filter((r) => r.work_date && (r.work_date < p.start || r.work_date > p.end)).length;
      const seen = new Set();
      rows.forEach((r) => { const k = key === 'time' ? `${r.emp_id}|${r.work_date}|${r.pay_code}|${r.punch_in}|${r.wfm_hours}` : `${r.emp_id}|${r.work_date}|${r.shift_start}`; if (seen.has(k)) dupes++; seen.add(k); });
    } else if (key === 'census') {
      const seen = new Set();
      rows.forEach((r) => { if (seen.has(r.emp_id)) dupes++; seen.add(r.emp_id); });
    }
    const alerts = [];
    if (!loaded) alerts.push({ sev: 'blocker', text: `${SRC[key].title} not received` });
    if (late) alerts.push({ sev: 'review', text: `${SRC[key].title} arrived ${fmtLate(late)} after the ${shortDate(due.slice(0, 10))} ${due.slice(11, 16)} cutoff` });
    blanks.forEach(([c, n]) => alerts.push({ sev: 'review', text: `${plural(n, 'record')} with no ${c}` }));
    if (outside) alerts.push({ sev: 'review', text: `${plural(outside, 'record')} dated outside the pay period` });
    if (dupes) alerts.push({ sev: 'review', text: `${plural(dupes, 'duplicate record')}` });
    return { key, loaded, received, due, late, rows: rows.length, filled, blanks, outside, dupes, alerts, source: s };
  }
  const fmtLate = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);

  function renderFeedpulse() {
    const r = state.result;
    const feeds = FEED_KEYS.map(feedStatus);
    const alerts = feeds.flatMap((f) => f.alerts.map((a) => Object.assign({ feed: SRC[f.key].title }, a)));
    const list = r.exceptions.filter((x) => appOf(x) === 'feedpulse' && x.severity !== 'info');
    const open = list.filter(isOpen);
    const groups = {};
    list.forEach((x) => { (groups[x.check] = groups[x.check] || []).push(x); });
    const order = ['T1', 'T2', 'T9', 'R1', 'R2', 'R3', 'R5', 'R4', 'T3', 'T4', 'T8'];
    const checkIds = Object.keys(groups).sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
    $('#page').innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Step 1 of 5</span><h1>Data quality</h1><p>Did this cycle’s data arrive complete and on time? Before payroll runs, we check the time records, schedules and employee list for late or missing files, people in timekeeping but not in payroll, time outside employment dates, missed punches, manager overrides and miscoded time.</p></div></div>
      <section class="card">
        <div class="card-head"><h3>Files received</h3><span class="muted" style="font-size:var(--t-sm)">Due by ${esc(F.fmtDate(feeds[0].due.slice(0, 10)))} ${esc(feeds[0].due.slice(11, 16))}</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>File</th><th>Source</th><th>Received</th><th>Status</th><th class="n">Records</th><th class="n">Complete</th><th>Checks</th></tr></thead>
          <tbody>${feeds.map((f) => `<tr>
            <td><b>${esc(SRC[f.key].title)}</b><br><span class="muted mono" style="font-size:var(--t-xs)">${esc(f.source.name || '—')}</span></td>
            <td>${esc(SRC[f.key].sys)}</td>
            <td class="mono" style="font-size:var(--t-xs)">${f.received ? esc(stamp(f.received)) : '—'}</td>
            <td>${!f.loaded ? '<span class="pill blocker">Missing</span>' : f.late ? `<span class="pill review">Late ${esc(fmtLate(f.late))}</span>` : '<span class="pill pass">On time</span>'}</td>
            <td class="n">${f.loaded ? f.rows : '—'}</td>
            <td class="n">${f.loaded ? `${(f.filled * 100).toFixed(f.filled < 1 ? 1 : 0)}%` : '—'}</td>
            <td class="wrap">${f.loaded ? [f.outside ? `${f.outside} out of period` : '', f.dupes ? `${f.dupes} duplicates` : '', f.blanks.length ? `${f.blanks.length} required fields blank` : ''].filter(Boolean).join(' · ') || '<span class="muted">Period covered, no duplicates</span>' : `<a href="#sources">Load it</a>`}</td>
          </tr>`).join('')}</tbody></table></div>
      </section>
      ${customSourcesCard()}
      ${alerts.length ? `<div class="group-title"><h3>File alerts</h3><span class="muted">${plural(alerts.length, 'alert')}</span></div>
        <div class="alerts">${alerts.map((a) => `<div class="alert ${a.sev}"><span class="pill ${a.sev}">${a.sev === 'blocker' ? 'Missing' : 'Alert'}</span><span>${esc(a.text)}</span></div>`).join('')}</div>` : ''}
      <div class="group-title"><h3>Data exceptions</h3><span class="muted">${open.length} open of ${list.length} · select one to see why it happened</span></div>
      <div class="check-stages">${checkIds.map((id) => `<section class="check-stage">
        <header><span class="id mono">${id}</span><h3>${esc(CHECK_OF[id].title)}</h3><span class="sys">${esc(CHECK_OF[id].rule(r.config))}</span><span class="res">${groups[id].filter(isOpen).length} open</span></header>
        <ul>${groups[id].map((x) => exLine(x)).join('')}</ul></section>`).join('') || '<div class="table-wrap"><div class="empty"><h3>No data exceptions</h3><p>Every data check passed.</p></div></div>'}</div>`;
  }

  function exLine(x, extra) {
    const st = statusOf(x);
    return `<li><button class="ex-line" type="button" data-st="${st}" data-action="goto-ex" data-key="${esc(x.key)}">
      ${doneOrSev(x, st)}
      <span class="t"><b>${esc(x.title)}</b><span>${esc(x.empId ? `${x.empId} ${x.empName}` : 'Whole cycle')}${x.location ? ' · ' + esc(x.location) : ''} · ${esc(ownerOf(x))}</span></span>
      ${extra || `<span class="mono amt">${x.impact ? F.money(x.impact.amount) : ''}</span>`}
      ${statusPill(st)}
    </button></li>`;
  }

  // ---- Pay accuracy: which exceptions change someone's pay?
  const RR_GROUPS = [
    { id: 'hours', label: 'Hours against class', checks: ['T5', 'T7', 'P3', 'P10'] },
    { id: 'ot', label: 'Overtime and premiums', checks: ['T6', 'P4', 'P5'] },
    { id: 'rates', label: 'Rates and union scale', checks: ['P1', 'P2'] },
    { id: 'pto', label: 'PTO buckets and balances', checks: ['T10', 'P9'] },
    { id: 'math', label: 'Taxes and register math', checks: ['P6', 'P7', 'P8'] },
  ];
  const rrGroupOf = (c) => RR_GROUPS.find((g) => g.checks.includes(c)) || (CHECK_OF[c] && CHECK_OF[c].custom ? { id: 'custom', label: 'Your rules', checks: [] } : RR_GROUPS[0]);
  function renderRunradar() {
    const r = state.result;
    const list = r.exceptions.filter((x) => appOf(x) === 'runradar' && x.severity !== 'info');
    const priced = list.filter((x) => x.impact).sort((a, b) => b.impact.amount - a.impact.amount);
    const unpriced = list.filter((x) => !x.impact);
    const openPriced = priced.filter(isOpen);
    const payKinds = ['underpaid', 'overpaid', 'tax', 'liability'];
    const tot = Object.fromEntries(payKinds.map((k) => [k, sum(openPriced.filter((x) => x.impact.kind === k), (x) => x.impact.amount)]));
    const max = priced.length ? priced[0].impact.amount : 1;
    const all = sum(priced, (x) => x.impact.amount);
    const top5 = sum(priced.slice(0, 5), (x) => x.impact.amount);
    const label = { underpaid: 'Owed to employees', overpaid: 'Overpaid', tax: 'Tax exposure', liability: 'PTO liability' };
    $('#page').innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Step 2 of 5</span><h1>Pay accuracy</h1><p>Which problems change someone’s pay? We check hours against each pay class (35 hours for union staff, 40 for full time, the 30-hour part-time cap), overtime (1.5× over 35 hours for union staff and over 40 for other hourly staff, 2× on Sundays, none for salaried exempt staff), pay rates against the employee list and the union scale, and whether time off came out of the right balance. The rules put a dollar amount on every problem.</p></div></div>
      <div class="kpis rr-kpis">${payKinds.map((k) => `<div class="kpi"><span class="label">${label[k]}</span><span class="value ${tot[k] ? '' : 'zero'}">${F.money(tot[k])}</span><span class="sub">open, from ${plural(openPriced.filter((x) => x.impact.kind === k).length, 'exception')}</span></div>`).join('')}</div>
      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Ranked by dollar impact</h3><span class="muted" style="font-size:var(--t-sm)">${priced.length ? `The top 5 carry ${Math.round((top5 / all) * 100)}% of ${F.money(all)}` : 'Nothing priced'}</span></div>
        ${priced.length ? `<ol class="rr-list">${priced.map((x, k) => {
          const g = rrGroupOf(x.check);
          return `<li><button class="rr-row" type="button" data-st="${statusOf(x)}" data-action="goto-ex" data-key="${esc(x.key)}">
            <span class="rank mono">${k + 1}</span>
            <span class="t"><b>${esc(x.title)}</b><span>${esc(x.empId ? `${x.empId} ${x.empName}` : 'Whole cycle')} · ${esc(g.label)} · ${esc(x.check)}</span></span>
            <span class="rr-bar" aria-hidden="true"><i class="k-${x.impact.kind}" style="width:${Math.max(3, Math.round((x.impact.amount / max) * 100))}%"></i></span>
            <span class="amt mono">${F.money(x.impact.amount)}<small>${esc(KIND_SHORT[x.impact.kind])}${x.impact.estimated ? ' · est.' : ''}</small></span>
            ${statusPill(statusOf(x))}
          </button></li>`;
        }).join('')}</ol>` : '<div class="empty"><p>No pay-impacting exceptions.</p></div>'}
      </section>
      ${unpriced.length ? `<div class="group-title"><h3>No direct dollar impact</h3><span class="muted">Still checked: short weeks, bucket order and similar</span></div>
        <div class="check-stages"><section class="check-stage"><ul>${unpriced.map((x) => exLine(x, `<span class="muted amt" style="font-size:var(--t-xs)">${esc(rrGroupOf(x.check).label)}</span>`)).join('')}</ul></section></div>` : ''}`;
  }

  // ---- Bank and ledger: do payroll, payments and the ledger agree?
  function threeWayRows() {
    const r = state.result, i = input();
    const num = E.util.num, r2 = E.util.r2;
    const reg = r.regTotals;
    const glm = i.glMap || {};
    const L = glm.liability_accounts || {};
    const bsum = (t, f) => r2(i.bank.filter((b) => b.txn_type === t && (!f || f(b))).reduce((a, b) => a + num(b.amount), 0));
    const acct = {};
    i.gl.forEach((l) => { const a = acct[l.account] || (acct[l.account] = { dr: 0, cr: 0 }); a.dr += num(l.debit); a.cr += num(l.credit); });
    const dr = (a) => r2((acct[a] || {}).dr || 0), cr = (a) => r2((acct[a] || {}).cr || 0);
    const wageAccts = Object.values(glm.wage_account_by_class || {}).concat([glm.premium_account, glm.pto_account]).filter(Boolean);
    const glWages = r2(sum(wageAccts, dr));
    const suspense = dr(glm.suspense_account);
    const rows = [
      { item: 'Net pay', payroll: reg.net, bank: bsum('NET_PAY_FUNDING'), bankLabel: 'Funding pull', gl: cr(glm.cash_account), glLabel: `${glm.cash_account} cash`, checks: ['F1', 'G6'] },
      { item: 'Net pay settled by ACH', payroll: reg.net, bank: r2(bsum('ACH_CREDIT') - bsum('ACH_RETURN')), bankLabel: 'ACH credits less returns', gl: null, checks: ['F2', 'F3', 'F4'] },
      { item: 'Withholdings and employer taxes', payroll: r2(reg.eeTax + reg.erTax), bank: bsum('TAX_REMIT'), bankLabel: 'Tax remittances', gl: cr(L.taxes), glLabel: `${L.taxes} taxes payable`, checks: ['F6', 'G5'] },
    ].concat((r.funding.taxes || []).map((t) => ({ item: `· ${t.jurisdiction}`, sub: true, payroll: t.expected, bank: t.remitted, bankLabel: 'Remitted', gl: null, checks: ['F6'] })), [
      { item: '401(k) deferrals', payroll: reg.k401, bank: bsum('BENEFIT_REMIT', (b) => /401/.test(b.jurisdiction)), bankLabel: 'Benefit remittance', gl: cr(L.k401), glLabel: `${L.k401} payable`, checks: ['F7', 'G5'] },
      { item: 'Medical premiums', payroll: reg.medical, bank: bsum('BENEFIT_REMIT', (b) => /MED/i.test(b.jurisdiction)), bankLabel: 'Benefit remittance', gl: cr(L.medical), glLabel: `${L.medical} payable`, checks: ['F7', 'G5'] },
      { item: 'Wage expense (gross pay)', payroll: reg.gross, bank: null, gl: glWages, glLabel: `Wage accounts${suspense ? ` · ${F.money(suspense)} more in ${glm.suspense_account} suspense` : ''}`, checks: ['G2', 'G3'] },
      { item: 'Employer tax expense', payroll: reg.erTax, bank: null, gl: dr(glm.employer_tax_account), glLabel: `${glm.employer_tax_account} expense`, checks: ['G4'] },
    ]);
    rows.forEach((row) => {
      const diffs = [row.bank, row.gl].filter((v) => v !== null && v !== undefined).map((v) => r2(v - row.payroll));
      row.break = diffs.find((d) => Math.abs(d) >= 0.01) || 0;
      row.open = r.exceptions.filter((x) => row.checks.includes(x.check) && x.severity !== 'info' && isOpen(x));
    });
    return rows;
  }

  function renderThreeway() {
    const r = state.result, i = input();
    const rows = threeWayRows();
    const breaks = r.exceptions.filter((x) => appOf(x) === 'threeway' && x.severity !== 'info');
    const num = E.util.num;
    const regRows = i.register;
    const ach = {};
    i.bank.filter((b) => b.txn_type === 'ACH_CREDIT').forEach((b) => { ach[b.emp_id] = (ach[b.emp_id] || 0) + num(b.amount); });
    const returned = new Set(i.bank.filter((b) => b.txn_type === 'ACH_RETURN').map((b) => b.emp_id));
    const matched = regRows.filter((x) => Math.abs((ach[x.emp_id] || 0) - num(x.net_pay)) < 0.01 && !returned.has(x.emp_id)).length;
    const money = (v) => (v === null || v === undefined ? '<span class="muted">—</span>' : F.money(v));
    $('#page').innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Step 4 of 5</span><h1>Bank and ledger</h1><p>Do payroll, the bank and the general ledger agree? After payroll is funded and posted, we match net pay to the direct deposits and bank activity, taxes and deductions to the payments sent, and the payroll register to the ledger entries. Every difference gets an owner.</p></div></div>
      <div class="kpis tw-kpis">
        <div class="kpi"><span class="label">Totals that match</span><span class="value">${rows.filter((x) => !x.break).length} of ${rows.length}</span><span class="sub">register · bank · GL</span></div>
        <div class="kpi"><span class="label">Differences</span><span class="value ${breaks.length ? '' : 'zero'}" style="${breaks.length ? 'color:var(--crit)' : ''}">${breaks.filter(isOpen).length}</span><span class="sub">open, ${breaks.length} found</span></div>
        <div class="kpi"><span class="label">Deposits matching the register</span><span class="value">${matched} of ${regRows.length}</span><span class="sub">by employee</span></div>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Payroll register, bank and ledger side by side</h3></div>
        <div class="table-wrap"><table class="tw-table">
          <thead><tr><th>Line</th><th class="n">Payroll register</th><th class="n">Bank and ACH</th><th class="n">General ledger</th><th>Result</th></tr></thead>
          <tbody>${rows.map((row) => `<tr class="${row.sub ? 'sub' : ''}">
            <td>${row.sub ? `<span class="muted">${esc(row.item)}</span>` : `<b>${esc(row.item)}</b>`}</td>
            <td class="n">${money(row.payroll)}</td>
            <td class="n">${money(row.bank)}${row.bank !== null && row.bankLabel ? `<br><small class="muted">${esc(row.bankLabel)}</small>` : ''}</td>
            <td class="n">${money(row.gl)}${row.gl !== null && row.glLabel ? `<br><small class="muted">${esc(row.glLabel)}</small>` : ''}</td>
            <td>${row.break ? (!row.open.length && r.exceptions.some((x) => row.checks.includes(x.check) && x.severity !== 'info') ? `<span class="pill pass">Reviewed · off by ${F.signedMoney(row.break)}</span>` : `<span class="pill blocker">Off by ${F.signedMoney(row.break)}</span>`) : '<span class="pill pass">Matches</span>'}${row.open.length && !row.sub ? `<br><button class="linkish" type="button" data-action="goto-ex" data-key="${esc(row.open[0].key)}" style="font-size:var(--t-xs)">${esc(row.open[0].check)} · ${esc(ownerOf(row.open[0]))}</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>
      </section>
      <div class="group-title"><h3>Differences to fix</h3><span class="muted">${breaks.filter(isOpen).length} open · each with an owner</span></div>
      <div class="check-stages"><section class="check-stage"><ul>${breaks.map((x) => exLine(x)).join('') || '<li><div class="empty"><p>No differences. The payroll register, the bank and the ledger agree.</p></div></li>'}</ul></section></div>`;
  }

  // ---- Repeat issues: what keeps going wrong?
  const FIX_TYPES = {
    meal_return: { label: 'Missed lunch check-ins', by: 'store' },
    missing_out: { label: 'Missing check-outs', by: 'store' },
    missing_in: { label: 'Missing check-ins', by: 'store' },
    override: { label: 'Hours entered without punches', by: 'manager' },
    bank_change: { label: 'Deposits to an old account after a bank change', by: 'type' },
    no_show: { label: 'No-shows on scheduled shifts', by: 'store' },
    unscheduled: { label: 'Unscheduled shifts', by: 'store' },
    short_week: { label: 'Short weeks with no time off coded', by: 'store' },
    ot_straight: { label: 'Overtime paid at straight time', by: 'store' },
    premium_split: { label: 'Overtime or Sunday premium split wrong', by: 'store' },
    after_term: { label: 'Time recorded after termination', by: 'store' },
    before_hire: { label: 'Time before the payroll hire date', by: 'type' },
    start_gap: { label: 'Payroll start date before the first time record', by: 'type' },
    unmapped_cc: { label: 'Cost center posted to suspense', by: 'type' },
    holiday_code: { label: 'Holiday pay on a non-holiday', by: 'type' },
    sick_coded_vac: { label: 'Sick days coded as vacation', by: 'store' },
    rate: { label: 'Register rate differs from census', by: 'type' },
    union_step: { label: 'Union step increase missed', by: 'type' },
    vac_bucket: { label: 'Vacation drawn from the wrong bucket', by: 'type' },
    sick_bucket: { label: 'Sick time drawn from the wrong bucket', by: 'type' },
    daily_max: { label: 'Shifts over the daily maximum', by: 'store' },
  };
  function fixType(x) {
    const c = x.check, t = `${x.title} ${x.detail}`;
    if (c === 'T1') return /meal/i.test(x.title) ? 'meal_return' : /check-in/i.test(x.title) ? 'missing_in' : 'missing_out';
    if (c === 'T2') return 'override';
    if (c === 'T4') return /no-show/i.test(x.title) ? 'no_show' : 'unscheduled';
    if (c === 'T5') return 'short_week';
    if (c === 'T8') return 'daily_max';
    if (c === 'T9') return /sick/i.test(x.title) ? 'sick_coded_vac' : 'holiday_code';
    if (c === 'R3') return 'before_hire';
    if (c === 'R4') return 'after_term';
    if (c === 'R5') return 'start_gap';
    if (c === 'P1') return 'rate';
    if (c === 'P2') return 'union_step';
    if (c === 'P4') return /straight time/i.test(t) ? 'ot_straight' : 'premium_split';
    if (c === 'P9') return /sick/i.test(x.title) ? 'sick_bucket' : /bucket/i.test(x.title) ? 'vac_bucket' : null;
    if (c === 'F3' || c === 'F4') return 'bank_change';
    if (c === 'G3') return 'unmapped_cc';
    return null;
  }
  function fixflowPeriods() {
    const r = state.result;
    const managers = {};
    r.employees.forEach((e) => { if (e.census && /Store Manager|Distribution Center Manager/.test(e.census.job_title || '')) managers[e.cc] = e.name; });
    const periods = [];
    let hist = null;
    try { hist = isSampleWorkspace() && SAMPLE.files['exception_history.json'] ? JSON.parse(SAMPLE.files['exception_history.json']) : null; } catch (e) { hist = null; }
    (hist ? hist.periods : []).forEach((pp) => periods.push({ cycle: pp.cycle, start: pp.start, rows: pp.exceptions.map((h) => ({ type: h.type, store: h.location, cc: h.cost_center, manager: h.entered_by || h.store_manager || '', emp: h.emp_id, owner: h.owner, amount: Number(h.impact_amount) || 0, title: h.title })) }));
    Object.entries(store.history || {}).forEach(([cycle, h]) => { if (cycle !== cycleId() && !periods.some((pp) => pp.cycle === cycle)) periods.push({ cycle, start: h.start, rows: h.rows }); });
    periods.push({ cycle: cycleId(), start: r.period.start, current: true, rows: currentFixRows() });
    periods.sort((a, b) => (a.start < b.start ? -1 : 1));
    return periods.slice(-6);
  }
  function currentFixRows() {
    const r = state.result;
    const managers = {};
    r.employees.forEach((e) => { if (e.census && /Store Manager|Distribution Center Manager/.test(e.census.job_title || '')) managers[e.cc] = e.name; });
    return r.exceptions.filter((x) => x.severity !== 'info').map((x) => {
      const type = fixType(x);
      if (!type) return null;
      const cc = x.cc || ((`${x.title} ${x.detail}`.match(/CC-\d+/) || [])[0]) || '';
      return { type, store: x.location || (cc && input().glMap && (input().glMap.cost_centers || {})[cc]) || cc || '—', cc, manager: x.enteredBy || managers[cc] || '', emp: x.empId || '', owner: ownerOf(x), amount: x.impact ? x.impact.amount : 0, title: x.title, key: x.key };
    }).filter(Boolean);
  }
  function fixClusters(threshold) {
    const periods = fixflowPeriods();
    const map = {};
    periods.forEach((pp, k) => {
      const seen = new Set();
      pp.rows.filter((row) => { const id = `${row.type}|${row.emp || row.title}`; if (seen.has(id)) return false; seen.add(id); return true; }).forEach((row) => {
      const def = FIX_TYPES[row.type] || { label: row.type, by: 'type' };
      const dim = def.by === 'store' ? row.store : def.by === 'manager' ? (row.manager || row.store) : '';
      const id = `${row.type}|${dim}`;
      const c = map[id] || (map[id] = { id, type: row.type, label: def.label, by: def.by, dim, perPeriod: periods.map(() => 0), people: new Set(), amount: 0, owners: {}, stores: new Set(), managers: new Set(), currentKeys: [] });
      c.perPeriod[k]++;
      if (row.emp) c.people.add(row.emp);
      c.amount += row.amount || 0;
      c.owners[row.owner] = (c.owners[row.owner] || 0) + 1;
      if (row.store) c.stores.add(row.store);
      if (row.manager) c.managers.add(row.manager);
      if (pp.current && row.key) c.currentKeys.push(row.key);
      });
    });
    const list = Object.values(map).map((c) => Object.assign(c, {
      periods: c.perPeriod.filter(Boolean).length, occurrences: sum(c.perPeriod, (n) => n),
      owner: Object.entries(c.owners).sort((a, b) => b[1] - a[1])[0][0], inCurrent: c.perPeriod[c.perPeriod.length - 1] > 0,
    }));
    list.sort((a, b) => b.periods - a.periods || b.occurrences - a.occurrences);
    return { periods, recurring: list.filter((c) => c.periods >= threshold), watch: list.filter((c) => c.periods < threshold && c.periods >= 2), all: list };
  }
  function clusterRootCause(c, N) {
    const store_ = c.dim || [...c.stores].join(', ');
    const mgr = [...c.managers][0] || 'the store manager';
    const n = `${c.periods} of ${N} periods`;
    const T = {
      meal_return: [`Associates at ${store_} go out for lunch and don’t punch back in, in ${n} (${plural(c.occurrences, 'time')}, ${plural(c.people.size, 'associate')}). A pattern spread across many associates at one store points to the store’s break process or time-clock setup, not individual habits.`, `Have ${store_}’s manager (${mgr}) review meal punches in WFM before close each day, turn on WFM’s missed-meal-return alert for the store, and recheck after two periods.`],
      override: [`${c.dim || 'One manager'} keys hours without punches in ${n}. The reasons cite forgotten punches or a down badge reader, so hours are paid on attestation alone.`, 'Require a second approver for manager-entered hours in WFM, log badge-reader outages with IT, and coach the associates involved on punching.'],
      bank_change: [`Direct-deposit changes entered after the batch is built reach the ACH file late in ${n}, so deposits go to the old account and come back as returns.`, 'Freeze bank-detail changes at batch build (HB 8.2), prenote new accounts, and have Treasury reissue returns within one business day (FIN 2.3).'],
      ot_straight: [`Weekly overtime at ${store_} is paid as straight time in ${n}. The distribution center’s hours come from an Excel schedule import that doesn’t split hours over 40.`, 'Recompute weekly overtime in payroll from WFM time rather than the Excel totals, and fix the import mapping.'],
      no_show: [`Scheduled shifts at ${store_} end with no punches and no time-off code in ${n}.`, `${store_}’s manager codes absences in WFM before close, and schedules are updated when shifts are swapped.`],
      unmapped_cc: [`A new cost center (${[...c.stores].join(', ')}) posts payroll to suspense in ${n} because it was never added to the GL map.`, 'Add new cost centers to the GL map as part of store opening, and reclass suspense before close.'],
    };
    const t = T[c.type] || [`${c.label}${store_ ? ` at ${store_}` : ''} recurs in ${n} (${plural(c.occurrences, 'occurrence')}).`, `${c.owner} to find the shared step that produces these and fix it at the source.`];
    return { root_cause: t[0], fix: t[1] };
  }

  async function clustersWithAi() {
    const thr = state.fixThreshold || store.policy.fixThreshold;
    const { periods, recurring } = fixClusters(thr);
    if (!recurring.length) return;
    state.aiBusy = 'clusters';
    renderFixflow();
    const m = masker();
    const mask = (s) => m.text(String(s || '').replace(/^.*\(/, 'Manager ('));
    try {
      const j = await callAi('clusters', {
        company: 'Retail apparel employer, NY and NJ stores (synthetic demo data)',
        periods: periods.map((pp) => pp.cycle),
        clusters: recurring.map((c, k) => ({ id: `C${k + 1}`, type: c.label, grouped_by: c.by, store: c.by === 'store' ? c.dim : [...c.stores].join(', '), manager: c.by === 'manager' ? mask(c.dim) : '', occurrences_per_period: c.perPeriod, periods_seen: c.periods, people_affected: c.people.size, dollar_impact_from_rules: E.util.r2(c.amount), usual_owner: c.owner, examples: periods.flatMap((pp) => pp.rows.filter((row) => `${row.type}|${FIX_TYPES[row.type] && FIX_TYPES[row.type].by === 'store' ? row.store : FIX_TYPES[row.type] && FIX_TYPES[row.type].by === 'manager' ? (row.manager || row.store) : ''}` === c.id).slice(0, 2).map((row) => `${pp.cycle}: ${m.text(row.title)}`)).slice(0, 6) })),
        policy: Object.values(allClauses()).filter((cl) => ['HB 3.2', 'HB 3.3', 'HB 8.2', 'FIN 2.3', 'FIN 4.2', 'HB 4.2'].includes(cl.id)).map((cl) => ({ id: cl.id, title: cl.title, text: cl.text })),
      });
      const ids = Object.fromEntries(recurring.map((c, k) => [`C${k + 1}`, c.id]));
      const data = { clusters: ((j.data && j.data.clusters) || []).map((x) => Object.assign({}, x, { id: ids[x.id] || x.id })) };
      aiStore().clusters = { at: nowIso(), model: j.model, data };
      save();
      log('AI root causes', `Suggested causes for ${plural(recurring.length, 'repeat issue')} with ${j.model}`, { by: 'Rollcall' });
      state.aiError = null;
    } catch (e) { state.aiError = { key: 'clusters', message: e.message }; }
    state.aiBusy = null;
    if (state.page === 'fixflow') renderFixflow();
  }

  function renderFixflow() {
    const thr = state.fixThreshold || store.policy.fixThreshold;
    const { periods, recurring, watch } = fixClusters(thr);
    const N = periods.length;
    const ai = aiStore().clusters;
    const aiFor = (c) => ai && ai.data && Array.isArray(ai.data.clusters) ? ai.data.clusters.find((x) => x.id === c.id) : null;
    const heat = (c) => `<span class="heat" aria-label="${c.perPeriod.join(', ')} by period">${c.perPeriod.map((n, k) => `<i class="${n ? (n > 1 ? 'h2' : 'h1') : ''} ${periods[k].current ? 'cur' : ''}" title="${esc(periods[k].cycle)}: ${n}">${n || ''}</i>`).join('')}</span>`;
    const card = (c) => {
      const rc = aiFor(c) || clusterRootCause(c, N);
      const unmask = state.unmask;
      const m = masker();
      return `<article class="cluster">
        <header><div><h4>${esc(c.label)}</h4><p class="muted">${c.by === 'store' ? `Store: ${esc(c.dim)}` : c.by === 'manager' ? `Entered by: ${esc(c.dim)}` : `Across ${esc([...c.stores].join(', ') || 'the company')}`} · ${plural(c.occurrences, 'occurrence')}${c.people.size ? ` · ${plural(c.people.size, 'person', 'people')}` : ''}${c.amount ? ` · ${F.money(c.amount)}` : ''}</p></div>
          <span class="pill ${c.periods >= thr ? 'blocker' : 'review'}">${c.periods} of ${N} periods</span></header>
        <div class="heat-row"><span class="muted" style="font-size:var(--t-2xs)">${esc(periods[0].cycle)}</span>${heat(c)}<span class="muted" style="font-size:var(--t-2xs)">${esc(periods[N - 1].cycle)}</span></div>
        <div class="rc"><span>Likely cause</span><p>${esc(unmask ? m.unmask(rc.root_cause) : rc.root_cause)}</p></div>
        <div class="rc"><span>Suggested fix</span><p>${esc(unmask ? m.unmask(rc.fix) : rc.fix)}</p></div>
        <footer><span class="muted" style="font-size:var(--t-xs)">${aiFor(c) ? `Written by ${esc(ai.model || 'the AI')}` : 'Written by the rules'} · owner ${esc(c.owner)}</span>${c.currentKeys.length ? `<button class="linkish" type="button" data-action="goto-ex" data-key="${esc(c.currentKeys[0])}" style="font-size:var(--t-xs)">This period’s ${c.currentKeys.length === 1 ? 'exception' : `${c.currentKeys.length} exceptions`}</button>` : ''}</footer>
      </article>`;
    };
    $('#page').innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Step 5 of 5</span><h1>Repeat issues</h1><p>What keeps going wrong? We look at the exceptions from the last ${N} pay periods, group them by store, manager and type, flag anything seen in ${thr} or more periods, and suggest the cause and a fix.</p></div>
        <div class="actions"><label class="field" for="fixThr">Flag at
          <select id="fixThr">${[2, 3, 4, 5].map((n) => `<option value="${n}" ${n === thr ? 'selected' : ''}>${n}+ periods</option>`).join('')}</select></label>
          ${state.ai && state.ai.available && store.policy.aiClusters && can('ai') && recurring.length ? `<button class="btn small primary" type="button" data-action="ai-clusters" ${state.aiBusy === 'clusters' ? 'disabled' : ''}>${state.aiBusy === 'clusters' ? 'Writing…' : ai ? 'Suggest causes again' : 'Suggest causes with AI'}</button>` : ''}</div>
      </div>
      ${state.aiError && state.aiError.key === 'clusters' ? `<p class="form-err" style="margin-bottom:10px">${esc(state.aiError.message)}</p>` : ''}
      <div class="notice" style="margin-bottom:14px"><span>Periods: ${periods.map((pp) => `<b class="mono">${esc(pp.cycle)}</b>${pp.current ? ' (this cycle)' : ''}`).join(' · ')}.${isSampleWorkspace() ? ' The five earlier periods are the sample workspace’s exception history.' : ' Earlier periods come from cycles released in this browser.'}${ai ? ` Causes written by ${esc(ai.model || 'the AI')} · ${esc(stamp(ai.at))}.` : ''}</span></div>
      <div class="group-title"><h3>Repeating issues</h3><span class="muted">${plural(recurring.length, 'issue')} seen in ${thr} or more periods</span></div>
      <div class="clusters">${recurring.map(card).join('') || '<div class="table-wrap"><div class="empty"><h3>No repeat issues</h3><p>No exception shows up in enough pay periods to count as repeating.</p></div></div>'}</div>
      ${watch.length ? `<div class="group-title"><h3>Watch list</h3><span class="muted">Seen in 2 periods: not yet a pattern</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Issue</th><th>Where</th><th>By period</th><th class="n">Occurrences</th><th>Owner</th><th></th></tr></thead>
          <tbody>${watch.map((c) => `<tr><td><b>${esc(c.label)}</b></td><td>${esc(c.by === 'type' ? [...c.stores].join(', ') : c.dim)}</td><td>${heat(c)}</td><td class="n">${c.occurrences}</td><td>${esc(c.owner)}</td>
            <td>${c.currentKeys.length ? `<button class="linkish" type="button" data-action="goto-ex" data-key="${esc(c.currentKeys[0])}" style="font-size:var(--t-xs)">This period</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  // ---- Overview: the five steps of one pay cycle, with live status for each
  function appStatus() {
    const r = state.result;
    const feeds = FEED_KEYS.map(feedStatus);
    const by = (id) => r.exceptions.filter((x) => appOf(x) === id && x.severity !== 'info');
    const fp = by('feedpulse'), rr = by('runradar'), tw = by('threeway');
    const all = r.exceptions.filter((x) => x.severity !== 'info');
    const fx = fixClusters(state.fixThreshold || store.policy.fixThreshold);
    const st = (list) => (list.some((x) => isOpen(x) && x.severity === 'blocker') ? 'fail' : list.some(isOpen) ? 'warn' : 'pass');
    const rrMoney = sum(rr.filter((x) => isOpen(x) && x.impact), (x) => x.impact.amount);
    return {
      feedpulse: { state: feeds.some((f) => !f.loaded) ? 'fail' : st(fp), text: `${feeds.filter((f) => f.loaded && !f.late).length} of ${feeds.length} files on time · ${fp.filter(isOpen).length} data exceptions open` },
      runradar: { state: st(rr), text: `${plural(rr.filter((x) => x.impact).length, 'pay error')} found · ${F.money(rrMoney)} still open` },
      exceptions: { state: st(all), text: `${all.length - all.filter(isOpen).length} of ${all.length} reviewed · ${all.filter(isOpen).length} open` },
      threeway: { state: st(tw), text: `${threeWayRows().filter((x) => !x.break).length} of ${threeWayRows().length} totals match · ${tw.filter(isOpen).length} differences open` },
      fixflow: { state: fx.recurring.length ? 'warn' : 'pass', text: `${plural(fx.recurring.length, 'repeat issue')} across ${fx.periods.length} pay periods` },
    };
  }
  const STEP_PILL = { pass: ['pass', 'OK'], warn: ['review', 'Review'], fail: ['blocker', 'Action needed'] };
  function flowHtml() {
    const s = appStatus();
    return `<section class="card flow-card" aria-labelledby="flowTitle">
      <div class="card-head"><h3 id="flowTitle">How this pay cycle is checked</h3><span class="muted" style="font-size:var(--t-sm)">Five steps, from the time clock to the general ledger</span></div>
      <ol class="steps">${APPS.map((a) => `<li><button class="step" type="button" data-action="go-page" data-page="${a.id}" data-state="${s[a.id].state}">
        <span class="step-top"><span class="step-n" aria-hidden="true">${a.num}</span><b>${esc(a.name)}</b></span>
        <span class="step-q">${esc(a.q)}</span>
        <span class="step-live"><span class="pill ${STEP_PILL[s[a.id].state][0]}">${STEP_PILL[s[a.id].state][1]}</span><span>${esc(s[a.id].text)}</span></span>
      </button></li>`).join('')}</ol>
      <div class="guardrails"><span>Rules calculate every dollar</span><span>The AI only explains</span><span>A person approves before payroll is released</span><span>Names are hidden from the AI</span></div>
    </section>`;
  }

  const SHOWCASE = [
    { app: 1, label: 'Missed punch: out to lunch, never checked back in', find: (x) => x.check === 'T1' && /meal/i.test(x.title) && x.empId === 'E1012' },
    { app: 1, label: 'Manager override: 8 hours entered with no punches', find: (x) => x.check === 'T2' && x.empId === 'E1021' },
    { app: 1, label: 'Miscoded time: a sick day coded as vacation', find: (x) => x.check === 'T9' && /sick/i.test(x.title) },
    { app: 1, label: 'Start-date gap: payroll start 9/21, time begins 9/23', find: (x) => x.check === 'R5' },
    { app: 2, label: 'Sunday hours paid at 1.5× instead of 2×', find: (x) => x.check === 'P4' && x.empId === 'E1018' },
    { app: 3, label: 'Sick time drawn from the current year while an accrued balance remains', find: (x) => x.check === 'P9' && /sick/i.test(x.title) },
    { app: 4, label: 'ACH return after an employee changed bank accounts', find: (x) => x.check === 'F4' },
    { app: 5, label: 'Missed lunch check-ins at one store, every period', page: 'fixflow' },
  ];
  function showcaseHtml() {
    if (!isSampleWorkspace()) return '';
    const items = SHOWCASE.map((s) => Object.assign({ x: s.find ? state.result.exceptions.find(s.find) : null }, s)).filter((s) => s.page || s.x);
    return `<section class="card showcase" style="margin-top:16px"><div class="card-head"><h3>Sample cases to try</h3><span class="muted" style="font-size:var(--t-sm)">Problems planted in the sample data. Select one to see what was found.</span></div>
      <ol class="sc-list">${items.map((s) => `<li><button type="button" ${s.page ? `data-action="go-page" data-page="${s.page}"` : `data-action="goto-ex" data-key="${esc(s.x.key)}"`}><span class="sc-t">${esc(s.label)}<small>${esc(APPS[s.app - 1].name)}</small></span>${s.x ? statusPill(statusOf(s.x)) : '<span class="muted" style="font-size:var(--t-xs)">View</span>'}</button></li>`).join('')}</ol></section>`;
  }

  // ----------------------------------------------------------------------------------
  // Reports
  // ----------------------------------------------------------------------------------

  function briefModel() {
    const r = state.result, t = r.totals, p = r.period, rd = readiness();
    const unresolved = r.exceptions.filter(isOpen);
    const review = unresolved.filter((x) => x.severity === 'review');
    const dismissed = r.exceptions.filter((x) => x.severity !== 'info' && statusOf(x) === 'dismissed');
    const approved = r.exceptions.filter((x) => x.severity !== 'info' && statusOf(x) === 'approved');
    const line = (x) => {
      const who = x.empId ? `${x.empId} ${x.empName}` : 'Cycle';
      const amt = x.impact ? ` (${F.money(x.impact.amount)} ${KIND_WORD[x.impact.kind]}${x.impact.estimated ? ', est.' : ''})` : '';
      return `${who}: ${x.title}${amt}. ${x.action || ''}`.trim();
    };
    const dismissedLine = (x) => `${x.empId ? `${x.empId} ${x.empName}` : 'Cycle'}: ${x.title}. Reason: ${lastNote(x) || 'not recorded'}`;
    const oi = openImpact();
    const imp = oi.amount;
    let first;
    if (rd.state === 'nodata') first = 'WAITING FOR DATA. Load the census, time records and payroll register to evaluate this cycle.';
    else if (rd.state === 'blocked') first = `HOLD. ${rd.preOpen.length} of ${plural(rd.pre.length, 'pre-release blocker')} open${rd.pre.length - rd.preOpen.length ? ` (${rd.pre.length - rd.preOpen.length} cleared)` : ''}; ${rd.postOpen.length} funding and GL blockers and ${review.length} review items also open.`;
    else if (rd.state === 'hold') first = `ON HOLD. ${rd.hold.by} put release on hold: “${rd.hold.reason}”. ${rd.preOpen.length} of ${plural(rd.pre.length, 'pre-release blocker')} open.`;
    else if (rd.state === 'ready') first = `READY TO RELEASE. ${rd.pre.length ? `All ${plural(rd.pre.length, 'pre-release blocker')} cleared: ${rd.approved.length} approved, ${rd.dismissed.length} dismissed with a reason.` : 'Every pre-release check passed.'}${rd.postOpen.length ? ` ${rd.postOpen.length} funding and GL blockers tracked after settlement.` : ''}`;
    else first = `RELEASED ${stamp(rd.released.at)} by ${rd.released.by}${rd.released.note ? ` — “${rd.released.note}”` : ''}.${rd.postOpen.length ? ` ${rd.postOpen.length} funding and GL blockers still open.` : ''}`;
    const money = KINDS.filter((k) => imp[k.kind]);
    const second = money.length
      ? `Open dollar impact: ${money.map((k) => `${F.money(imp[k.kind])} ${k.kind === 'underpaid' ? `owed to ${plural(oi.people.underpaid, 'employee')}` : k.kind === 'overpaid' ? `overpaid across ${plural(oi.people.overpaid, 'employee')}` : k.label.toLowerCase()}`).join('; ')}.`
      : 'No open dollar impact.';
    return { r, t, p, rd, review, dismissed, approved, line, dismissedLine, lead: [first, second] };
  }

  function renderReports() {
    const m = briefModel();
    const section = (title, groups, fn) => groups.length ? `<h4>${esc(title)}</h4>${groups.map(([o, list]) => `<h5>${esc(o)} · ${list.length}</h5><ul>${list.map((x) => `<li>${esc((fn || m.line)(x))}</li>`).join('')}</ul>`).join('')}` : '';
    const reports = [
      { title: 'Release brief', desc: 'Readiness, open dollar impact and every open item by owner, for the payroll manager, controller and store operations.', btns: `<button class="btn small" type="button" data-action="download-brief">${ICON.download} .txt</button><button class="btn small" type="button" data-action="copy-brief">Copy</button>` },
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
          <span class="eyebrow">Rollcall.ai · Release brief · batch ${esc(cycleId())}</span>
          <h3>${esc(store.workspace)}, pay period ${esc(periodText(m.p))}</h3>
          <span class="muted">${m.p.payDate ? `Pay date ${esc(F.fmtDate(m.p.payDate))} · ` : ''}${m.t.checksRun} checks across ${plural(m.t.people, 'person', 'people')} · generated ${esc(stamp(nowIso()))}</span>
        </div>
        ${m.lead.map((l) => `<p class="lead">${esc(l)}</p>`).join('')}
        ${section('Open before release', byOwner(m.rd.preOpen))}
        ${section('After settlement — treasury and GL', byOwner(m.rd.postOpen))}
        ${section('Review before close', byOwner(m.review))}
        ${m.dismissed.length ? section('Dismissed with a reason', [['Dismissed', m.dismissed]], m.dismissedLine) : ''}
        ${m.approved.length ? `<h4>Approved</h4><p class="muted">${plural(m.approved.length, 'item')} approved this cycle. See the exception register for notes.</p>` : ''}
      </article>`;
  }

  function briefText() {
    const m = briefModel();
    const out = [];
    out.push(`ROLLCALL.AI PAYROLL ASSURANCE · RELEASE BRIEF — ${store.workspace} — batch ${cycleId()}`);
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
    if (m.dismissed.length) sec('Dismissed with a reason', [['Dismissed', m.dismissed]], m.dismissedLine);
    if (m.approved.length) out.push('', `${plural(m.approved.length, 'item')} approved this cycle.`);
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
        <div><h1>Activity log</h1><p>An append-only log of who did what: status changes, notes, reassignments, rule changes, data loads, check runs and releases.</p></div>
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
        <section class="card"><div class="card-head"><h3>You</h3><span class="pill plain">${esc(roleLabel(me()))}</span></div><div class="card-body">
          <label for="setUser">Working as</label>
          <select id="setUser">${store.team.filter((m) => m.active !== false || m.id === store.userId).map((m) => `<option value="${esc(m.id)}" ${m.id === store.userId ? 'selected' : ''}>${esc(m.name)} · ${esc(roleLabel(m))}</option>`).join('')}</select>
          <p class="muted" style="font-size:var(--t-sm)">${esc(capsText(me()))}.${store.policy.pin ? ' Switching to a payroll admin asks for the admin PIN.' : ''}${can('admin') ? ' Manage the team in the <a href="#admin">Admin console</a>.' : ''}</p>
          <label for="setName">Your display name</label>
          <input class="text" id="setName" value="${esc(store.user)}" autocomplete="name">
          <p class="muted" style="font-size:var(--t-sm)">Shown on status changes, notes and release approvals.</p>
        </div></section>
        <section class="card"><div class="card-head"><h3>Workspace</h3></div><div class="card-body">
          <label for="setWs">Company name</label>
          <input class="text" id="setWs" value="${esc(store.workspace)}" autocomplete="organization">
          <p class="muted" style="font-size:var(--t-sm)">Used in the sidebar, the release brief and exports.</p>
        </div></section>
        <section class="card"><div class="card-head"><h3>AI service</h3></div><div class="card-body">
          <p style="font-size:var(--t-sm)">${state.ai && state.ai.available ? `<span class="conn ok">Connected</span> AI explanations and suggested causes use ${esc(state.ai.model || 'the AI')}. Names are hidden before anything is sent.` : '<span class="conn idle">Not connected</span> Explanations and root causes are assembled from the records by the rules. Add a GROQ_API_KEY to the Vercel project to turn on the AI.'}</p>
          <label for="setAiCode">Access code <span class="muted" style="font-weight:500">(only if the deployment sets AI_ACCESS_CODE · kept for this session)</span></label>
          <input class="text" id="setAiCode" type="password" autocomplete="off" value="${esc(state.aiCode || '')}">
        </div></section>
        <section class="card"><div class="card-head"><h3>Appearance</h3></div><div class="card-body">
          <div class="seg" role="group" aria-label="Theme">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" data-action="theme" data-theme="${v}" aria-pressed="${store.theme === v}">${l}</button>`).join('')}</div>
        </div></section>
        <section class="card"><div class="card-head"><h3>Data in this browser</h3></div><div class="card-body">
          <p style="font-size:var(--t-sm)">${plural(Object.keys(store.cycles).length, 'cycle')}, ${plural(store.audit.length, 'activity entry', 'activity entries')} and ${plural(Object.keys(store.settings).length, 'rule change')} are stored here. Clearing them resets statuses, notes, releases and the activity log, and reloads the sample cycle.</p>
          ${can('admin') ? '<div><button class="btn small danger" type="button" data-action="reset-workspace">Clear workspace data…</button></div>' : '<p class="muted" style="font-size:var(--t-sm)">Only a payroll admin can clear workspace data. Backups are in the Admin console.</p>'}
        </div></section>
      </div>`;
  }

  // ----------------------------------------------------------------------------------
  // Team, roles and policies: who may do what, and the controls a payroll admin sets.
  // They apply to everyone working in this browser; in production people sign in via SSO.
  // ----------------------------------------------------------------------------------

  function me() { return store.team.find((m) => m.id === store.userId) || store.team[0]; }
  const roleLabel = (m) => (ROLE_OF[m && m.role] || { label: (m && m.role) || 'Unknown' }).label;
  const permsOf = (role) => store.policy.perms[role] || {};
  function can(cap) {
    const m = me();
    return !!(m && m.active !== false && permsOf(m.role)[cap]);
  }
  const capsOf = (m) => CAPS.filter((c) => permsOf(m.role)[c.id]);
  const capsText = (m) => { const l = capsOf(m); return l.length ? `Can ${l.map((c) => c.verb).join(', ')}` : 'Read only'; };
  const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const ACT = { approved: 'Approve', dismissed: 'Dismiss', escalated: 'Escalate', open: 'Reopen' };

  // A blocked action is logged and explained; nothing changes.
  function blocked(what, why, msg) {
    log('Action blocked', `${what} · ${why}`);
    toast(msg || why);
  }
  function allow(cap) {
    if (can(cap)) return true;
    const role = roleLabel(me());
    blocked(upper(CAP_OF[cap].verb), `not permitted for the ${role} role`, `Your role (${role}) can’t ${CAP_OF[cap].verb}. Ask a payroll admin, or switch user in Settings.`);
    return false;
  }

  const bigBlocker = (x) => x.severity === 'blocker' && !!x.impact && x.impact.amount >= store.policy.dismissLimit;
  // Why this user can't move an exception to `to` (null = reassign), or '' when they can.
  function changeBlock(x, to) {
    const role = roleLabel(me());
    if (!can('review')) return `Your role (${role}) can’t work exceptions.`;
    if (cyc().released && store.policy.lockAfterRelease && isPre(x)) return `${cycleId()} is released, so pre-release items are locked. Reopen the cycle to change them.`;
    if (to === 'dismissed' && !can('dismiss')) return `Your role (${role}) can’t dismiss exceptions.`;
    if (to === 'dismissed' && bigBlocker(x) && !can('dismissLarge')) return `Blockers of ${F.money(store.policy.dismissLimit)} or more need a payroll approver or admin to dismiss.`;
    return '';
  }
  function partition(keys, to) {
    const ok = [], why = {};
    keys.forEach((k) => {
      const x = exByKey(k);
      if (!x) return;
      const w = changeBlock(x, to);
      if (w) why[w] = (why[w] || 0) + 1;
      else ok.push(x);
    });
    return { ok, skipped: sum(Object.values(why), (n) => n), reason: Object.keys(why)[0] || '' };
  }
  const skippedText = (pt) => (pt.skipped ? ` · ${pt.skipped} skipped. ${pt.reason}` : '');

  // Review SLA: hours since the rules first found the item.
  const slaH = (x) => (x.severity === 'blocker' ? store.policy.slaBlockerH : store.policy.slaReviewH);
  const ageH = (x) => { const s = item(x).seen; return s ? Math.max(0, (Date.now() - new Date(s).getTime()) / 3.6e6) : 0; };
  const pastSla = (x) => isOpen(x) && x.severity !== 'info' && ageH(x) > slaH(x);
  const hrs = (h) => (h >= 48 ? `${Math.round(h / 24)}d` : h >= 1 ? `${Math.round(h)}h` : `${Math.max(1, Math.round(h * 60))}m`);

  // Release separation of duties: the releaser didn't dismiss a pre-release blocker themselves.
  function sodConflicts() {
    if (!store.policy.sod) return [];
    return readiness().dismissed.filter((x) => {
      const ev = item(x).events.filter((e) => e.type === 'status' && e.to === 'dismissed').slice(-1)[0];
      return ev && ev.by === store.user;
    });
  }

  // SHA-256 for the admin PIN. crypto.subtle needs a secure context; this works everywhere.
  function sha256(str) {
    const K = [], H = [];
    const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
    for (let n = 2, c = 0; c < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (c < 8) H[c] = frac(Math.sqrt(n));
      K[c++] = frac(Math.cbrt(n));
    }
    const bytes = Array.from(new TextEncoder().encode(str));
    const bits = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 0xff);
    const rotr = (x, r) => (x >>> r) | (x << (32 - r));
    const W = new Array(64);
    for (let i = 0; i < bytes.length; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = (bytes[i + 4 * t] << 24) | (bytes[i + 4 * t + 1] << 16) | (bytes[i + 4 * t + 2] << 8) | bytes[i + 4 * t + 3];
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, k) => { H[k] = (H[k] + v) | 0; });
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  const pinHash = (pin) => sha256(`rollcall-pin:${pin}`);

  // ---- Working as: switching user, with the admin PIN in front of admin accounts.
  function switchUser(id, el) {
    const m = store.team.find((x) => x.id === id);
    if (el) el.value = store.userId;
    if (!m || m.id === store.userId) return;
    if (permsOf(m.role).admin && store.policy.pin && !can('admin')) { pinModal(m, el); return; }
    doSwitch(m);
  }
  function doSwitch(m) {
    const was = me();
    store.userId = m.id;
    store.user = m.name;
    log('Switched user', `${was.name} (${roleLabel(was)}) → ${m.name} (${roleLabel(m)})`);
    state.unmask = state.unmask && can('unmask');
    renderAll();
    toast(`Working as ${m.name} · ${roleLabel(m)}`);
  }
  function pinModal(m, opener) {
    openModal(`<div class="mh"><h2 id="modalTitle">Admin PIN</h2></div>
      <div class="mb"><p>Enter the admin PIN to work as <b>${esc(m.name)}</b> (${esc(roleLabel(m))}).</p>
        <label for="pinIn"><b>PIN</b></label>
        <input class="text" id="pinIn" type="password" inputmode="numeric" autocomplete="off" autofocus>
        <p class="form-err" id="pinErr" hidden></p></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="pin-ok" data-id="${esc(m.id)}">Continue</button></div>`, opener);
    const f = $('#pinIn');
    if (f) f.focus();
  }
  function checkPin(id) {
    const m = store.team.find((x) => x.id === id);
    const v = ($('#pinIn').value || '').trim();
    if (!m) { closeModal(); return; }
    if (pinHash(v) !== store.policy.pin) {
      log('Action blocked', `Switch to ${m.name} · wrong admin PIN`);
      const e = $('#pinErr');
      e.textContent = 'That PIN is not right.';
      e.hidden = false;
      $('#pinIn').select();
      return;
    }
    closeModal();
    doSwitch(m);
  }

  // ---- Release hold: set per cycle by a payroll admin.
  function holdModal(opener) {
    openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Put release on hold</h2></div>
      <div class="mb"><p>Nobody can release ${esc(cycleId())} while the hold is on, even with every blocker cleared. Reviewers keep working exceptions.</p>
        <label for="holdNote"><b>Reason</b></label>
        <textarea class="text" id="holdNote" autofocus placeholder="e.g. Waiting on treasury to confirm the funding wire"></textarea>
        <p class="form-err" id="holdErr" hidden></p></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="hold-confirm">Put on hold</button></div>`, opener);
  }
  function confirmHold() {
    if (!allow('admin')) { closeModal(); return; }
    const reason = ($('#holdNote').value || '').trim();
    if (!reason) { const e = $('#holdErr'); e.textContent = 'Give a reason for the hold.'; e.hidden = false; $('#holdNote').focus(); return; }
    cyc().hold = { at: nowIso(), by: store.user, reason };
    log('Release hold', `${cycleId()} on hold — “${reason}”`);
    closeModal();
    renderAll();
    toast(`${cycleId()} release is on hold`);
  }
  function liftHold() {
    if (!allow('admin')) return;
    const h = cyc().hold;
    if (!h) return;
    cyc().hold = null;
    log('Hold lifted', `${cycleId()} hold lifted (set by ${h.by}: “${h.reason}”)`);
    renderAll();
    toast('Hold lifted');
  }

  function escalatePastSla() {
    const keys = state.result.exceptions.filter((x) => pastSla(x) && statusOf(x) === 'open').map((x) => x.key);
    const pt = partition(keys, 'escalated');
    pt.ok.forEach((x) => setStatus(x, 'escalated', `Overdue: open ${hrs(ageH(x))}, due within ${slaH(x)}h`));
    if (pt.skipped) log('Action blocked', `Escalate ${plural(pt.skipped, 'overdue item')} · ${pt.reason}`);
    afterWorkflow();
    toast(`Escalated ${plural(pt.ok.length, 'overdue item')}${skippedText(pt)}`);
  }

  // ---- Team and permissions
  const activeAdmins = () => store.team.filter((m) => m.role === 'admin' && m.active !== false);
  function teamChange(el) {
    if (!allow('admin')) { renderAdmin(); return; }
    const m = store.team.find((x) => x.id === el.dataset.team);
    if (!m) return;
    const f = el.dataset.field;
    const v = f === 'active' ? el.checked : el.value.trim();
    const label = { name: 'name', role: 'role', queue: 'queue', active: 'status' }[f];
    const show = (val) => (f === 'role' ? (ROLE_OF[val] || {}).label : f === 'active' ? (val !== false ? 'active' : 'inactive') : f === 'queue' ? val || 'no queue' : val);
    const refuse = f === 'name' && !v ? 'A team member needs a name.'
      : f === 'name' && store.team.some((x) => x.id !== m.id && x.name.toLowerCase() === v.toLowerCase()) ? `${v} is already on the team.`
        : m.id === store.userId && (f === 'role' || f === 'active') ? 'Ask another payroll admin to change your own role or status.'
          : m.role === 'admin' && m.active !== false && activeAdmins().length === 1 && ((f === 'role' && v !== 'admin') || (f === 'active' && !v)) ? 'Keep at least one active payroll admin.' : '';
    if (refuse) { toast(refuse); renderAdmin(); return; }
    const was = m[f];
    if (was === v) return;
    m[f] = v;
    if (m.id === store.userId && f === 'name') store.user = v;
    log('Team changed', `${m.name}: ${label} ${show(was)} → ${show(v)}`);
    renderShell();
    renderAdmin();
    toast(`${m.name}: ${label} ${show(v)}`);
  }
  function addMember() {
    if (!allow('admin')) return;
    const name = ($('#tmName').value || '').trim();
    const role = $('#tmRole').value, queue = $('#tmQueue').value;
    const err = $('#tmErr');
    const refuse = !name ? 'Enter a name.' : store.team.some((x) => x.name.toLowerCase() === name.toLowerCase()) ? `${name} is already on the team.` : '';
    if (refuse) { err.textContent = refuse; err.hidden = false; $('#tmName').focus(); return; }
    store.team.push({ id: `u${Date.now().toString(36)}`, name, role, queue, active: true });
    log('Team changed', `Added ${name} as ${ROLE_OF[role].label}${queue ? `, ${queue} queue` : ''}`);
    renderShell();
    renderAdmin();
    toast(`Added ${name}`);
  }
  function removeMember(id) {
    if (!allow('admin')) return;
    const m = store.team.find((x) => x.id === id);
    if (!m) return;
    if (m.id === store.userId) { toast('You can’t remove yourself.'); return; }
    if (m.role === 'admin' && m.active !== false && activeAdmins().length === 1) { toast('Keep at least one active payroll admin.'); return; }
    store.team = store.team.filter((x) => x.id !== id);
    log('Team changed', `Removed ${m.name} (${roleLabel(m)})`);
    renderShell();
    renderAdmin();
    toast(`Removed ${m.name}`);
  }
  function permChange(el) {
    if (!allow('admin')) { renderAdmin(); return; }
    const [role, cap] = el.dataset.perm.split('|');
    if (role === 'admin' || cap === 'admin' || !ROLE_OF[role] || !CAP_OF[cap]) return;
    store.policy.perms[role][cap] = el.checked;
    log('Permission changed', `${ROLE_OF[role].label}: ${el.checked ? 'can' : 'can no longer'} ${CAP_OF[cap].verb}`);
    renderShell();
    toast(`${ROLE_OF[role].label}: ${el.checked ? 'can' : 'can no longer'} ${CAP_OF[cap].verb}`);
  }
  function setPin() {
    if (!allow('admin')) return;
    const v = ($('#pinNew').value || '').trim();
    const err = $('#pinSetErr');
    if (!/^\d{4,12}$/.test(v)) { err.textContent = 'Use 4 to 12 digits.'; err.hidden = false; $('#pinNew').focus(); return; }
    const had = !!store.policy.pin;
    store.policy.pin = pinHash(v);
    log('Admin PIN', had ? 'Admin PIN changed' : 'Admin PIN set');
    renderAdmin();
    toast(had ? 'Admin PIN changed' : 'Admin PIN set');
  }
  function clearPin() {
    if (!allow('admin')) return;
    store.policy.pin = null;
    log('Admin PIN', 'Admin PIN removed');
    renderAdmin();
    toast('Admin PIN removed');
  }

  // ---- Policies
  const POLICY_LABEL = {
    sod: 'Different person must release', lockAfterRelease: 'Lock pre-release items after release', dismissLimit: 'Dismissal limit',
    approveNote: 'Note to approve a blocker', slaBlockerH: 'Blockers due within', slaReviewH: 'Review items due within', aiExplain: 'AI explanations',
    aiClusters: 'AI-suggested causes', aiChat: 'AI chat', fixThreshold: 'Count an issue as repeating at', cutoffDays: 'Data due', cutoffTime: 'Data due by',
  };
  function polFmt(key, v) {
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (key === 'dismissLimit') return F.money(v);
    if (key === 'slaBlockerH' || key === 'slaReviewH') return `${v}h`;
    if (key === 'cutoffDays') return `${plural(v, 'day')} after period end`;
    if (key === 'fixThreshold') return `${v}+ periods`;
    return String(v);
  }
  function policyChange(el) {
    if (!allow('admin')) { renderAdmin(); return; }
    const key = el.dataset.policy;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (key === 'cutoffTime') { v = el.value; if (!/^\d{2}:\d{2}$/.test(v)) return; }
    else {
      v = Number(el.value);
      if (el.value === '' || !Number.isFinite(v) || v < 0) { el.value = store.policy[key]; return; }
      if (key === 'slaBlockerH' || key === 'slaReviewH') v = Math.max(1, Math.round(v));
      if (key === 'cutoffDays') v = Math.min(14, Math.round(v));
      el.value = v;
    }
    const was = store.policy[key];
    if (was === v) return;
    store.policy[key] = v;
    if (key === 'fixThreshold') state.fixThreshold = null;
    log('Policy changed', `${POLICY_LABEL[key]}: ${polFmt(key, was)} → ${polFmt(key, v)}`);
    renderShell();
    toast(`${POLICY_LABEL[key]}: ${polFmt(key, v)}`);
  }

  // ---- Backup and restore
  function backupJson() {
    let sources = null;
    try { sources = JSON.parse(localStorage.getItem(FILES_KEY) || 'null'); } catch (e) { sources = null; }
    return JSON.stringify({ app: 'rollcall-payroll-assurance', version: 1, exported: nowIso(), workspace: store.workspace, store, sources });
  }
  let pendingRestore = null;
  async function readRestore(file) {
    if (!allow('admin')) return;
    let b = null;
    try { b = JSON.parse(await file.text()); } catch (e) { b = null; }
    if (!b || b.app !== 'rollcall-payroll-assurance' || !b.store || b.store.v !== 1) { toast('That file isn’t a Rollcall payroll assurance backup.'); return; }
    pendingRestore = b;
    const s = b.store;
    openModal(`<div class="mh"><h2 id="modalTitle">Restore from backup?</h2></div>
      <div class="mb">
        <div class="ev">
          <div><span>Workspace</span><b>${esc(s.workspace || '—')}</b></div>
          <div><span>Exported</span><b>${esc(stamp(b.exported))}</b></div>
          <div><span>Cycles</span><b>${Object.keys(s.cycles || {}).length}</b></div>
          <div><span>Activity entries</span><b>${(s.audit || []).length}</b></div>
        </div>
        <p>This replaces everything in this browser with the backup: statuses, notes, releases, team, roles, policies, rule changes, the activity log and imported files. It can’t be undone; download a backup of the current data first if you need it.</p>
      </div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="restore-confirm">Restore</button></div>`);
  }
  function confirmRestore() {
    const b = pendingRestore;
    pendingRestore = null;
    if (!b || !allow('admin')) { closeModal(); return; }
    const by = store.user;
    store = hydrate(b.store);
    syncCustomSources();
    try {
      if (b.sources) localStorage.setItem(FILES_KEY, JSON.stringify(b.sources));
      else localStorage.removeItem(FILES_KEY);
    } catch (e) { /* imported files stay in memory only */ }
    restoreSources();
    state.detail = null;
    state.sel.clear();
    state.importQueue = [];
    state.result = null;
    state.fixThreshold = null;
    recompute();
    log('Backup restored', `${b.store.workspace || 'Workspace'} backup from ${stamp(b.exported)}, restored by ${by}`);
    closeModal();
    renderAll();
    toast('Backup restored');
  }

  // ---- One tooltip for every chart mark. Lines come from data-tip; the first line is the value.
  let tipEl = null;
  function showTip(el, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.textContent = '';
    el.dataset.tip.split('\n').forEach((line, k) => { const n = document.createElement(k ? 'span' : 'b'); n.textContent = line; tipEl.appendChild(n); });
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 12))}px`;
    tipEl.style.top = `${y - r.height - 12 < 8 ? y + 16 : y - r.height - 12}px`;
  }
  const hideTip = () => { if (tipEl) tipEl.hidden = true; };
  document.addEventListener('pointermove', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tip]');
    if (el && ev.pointerType !== 'touch') showTip(el, ev.clientX, ev.clientY); else hideTip();
  });
  document.addEventListener('focusin', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tip]');
    if (el && el.matches(':focus-visible')) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } else hideTip();
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

  // ----------------------------------------------------------------------------------
  // Admin console: what a payroll admin watches, and the controls they set
  // ----------------------------------------------------------------------------------

  const ADMIN_TABS = [['monitor', 'Monitor'], ['team', 'Team and access'], ['policies', 'Policies'], ['data', 'Data and audit']];
  const ADMIN_ACTIONS = new Set(['Action blocked', 'Switched user', 'Name changed', 'Team changed', 'Permission changed', 'Policy changed', 'Admin PIN',
    'Release hold', 'Hold lifted', 'Payroll released', 'Cycle reopened', 'Rule changed', 'Rule created', 'Rule deleted', 'Rule turned on', 'Rule turned off',
    'Data source added', 'Data source changed', 'Data source removed', 'Backup exported', 'Backup restored', 'Workspace cleared']);

  function renderAdmin() {
    const tab = ADMIN_TABS.some(([id]) => id === state.adminTab) ? state.adminTab : 'monitor';
    const body = { monitor: adminMonitor, team: adminTeam, policies: adminPolicies, data: adminData }[tab]();
    $('#page').innerHTML = `
      <div class="page-head">
        <div><span class="eyebrow">Admin console · ${esc(cycleId())}</span><h1>Payroll admin</h1>
        <p>Watch the cycle across every queue and application, and set who can do what: team and roles, release controls, review policy and the AI. Every change here is logged.</p></div>
        <div class="actions"><span class="who-chip">${esc(store.user)} · ${esc(roleLabel(me()))}</span></div>
      </div>
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Admin console section">${ADMIN_TABS.map(([id, l]) => `<button type="button" data-action="admin-tab" data-tab="${id}" aria-pressed="${tab === id}">${l}</button>`).join('')}</div>
        ${tab !== 'monitor' && !can('admin') ? `<span class="muted" style="font-size:var(--t-sm)">View only: your role (${esc(roleLabel(me()))}) can’t change admin settings.</span>` : ''}
      </div>
      ${body}`;
  }

  function niceTicks(max) {
    const raw = Math.max(1, max) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = Math.max(1, [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw));
    const top = Math.max(step, Math.ceil(max / step) * step);
    const ticks = [];
    for (let v = 0; v <= top; v += step) ticks.push(v);
    return { top, ticks };
  }

  function adminMonitor() {
    const r = state.result, rd = readiness(), p = r.period;
    const work = r.exceptions.filter((x) => x.severity !== 'info');
    const open = work.filter(isOpen);
    const escalated = open.filter((x) => statusOf(x) === 'escalated');
    const late = open.filter(pastSla);
    const lateOpen = late.filter((x) => statusOf(x) === 'open');
    const nextDue = open.filter((x) => !pastSla(x)).map((x) => slaH(x) - ageH(x)).sort((a, b) => a - b)[0];
    const priced = open.filter((x) => x.impact);
    const exposure = sum(priced, (x) => x.impact.amount);
    const done = work.length - open.length;
    const pct = work.length ? Math.round((done / work.length) * 100) : 100;
    const aiN = Object.keys(aiStore().explain).length;
    const aiOn = !!(state.ai && state.ai.available && store.policy.aiExplain);
    const thr = state.fixThreshold || store.policy.fixThreshold;
    const fx = fixClusters(thr);
    const apps = appStatus();

    const tile = (label, value, sub, o) => {
      o = o || {};
      const tag = o.action ? 'button' : 'div';
      return `<${tag} class="kpi" ${o.action ? `type="button" ${o.action}` : ''}><span class="label">${esc(label)}</span><span class="value ${o.cls || ''}">${value}</span><span class="sub">${esc(sub)}</span></${tag}>`;
    };
    const line = {
      hold: rd.hold ? `Held by ${rd.hold.by}, ${stamp(rd.hold.at)}: “${rd.hold.reason}”.${rd.preOpen.length ? ` ${plural(rd.preOpen.length, 'pre-release blocker')} also open.` : ' Every pre-release blocker is cleared.'}` : '',
      blocked: `${plural(rd.preOpen.length, 'pre-release blocker')} open across ${plural(byOwner(rd.preOpen).length, 'queue')}. Release opens when each one is approved or dismissed.`,
      ready: `Every pre-release blocker is cleared${rd.dismissed.length ? `, ${rd.dismissed.length} dismissed with a reason` : ''}. ${can('release') ? 'You can release this batch.' : 'Waiting for a payroll approver or admin to release.'}`,
      released: rd.released ? `Released ${stamp(rd.released.at)} by ${rd.released.by}.${rd.postOpen.length ? ` ${plural(rd.postOpen.length, 'funding and GL blocker', 'funding and GL blockers')} open for treasury and accounting.` : ''}` : '',
      nodata: 'Waiting for the census, time records and payroll register.',
    }[rd.state];
    const btns = [];
    if (rd.preOpen.length && !rd.released) btns.push('<button class="btn small" type="button" data-action="go-blockers">Work the blockers</button>');
    if (lateOpen.length && can('review')) btns.push(`<button class="btn small" type="button" data-action="sla-escalate">Escalate ${plural(lateOpen.length, 'overdue item')}</button>`);
    if (can('admin') && !rd.released && rd.state !== 'nodata') btns.push(rd.hold ? '<button class="btn small primary" type="button" data-action="hold-lift">Lift hold</button>' : '<button class="btn small" type="button" data-action="hold-open">Put release on hold…</button>');

    // Stage meters: reviewed out of found, per stage.
    const stages = E.STAGES.map((s) => {
      const list = work.filter((x) => x.stage === s.id);
      const c = { approved: 0, dismissed: 0, escalated: 0, open: 0 };
      list.forEach((x) => { c[statusOf(x)]++; });
      const ran = (r.stages.find((z) => z.id === s.id) || {}).ran;
      return { s, total: list.length, c, done: c.approved + c.dismissed, ran };
    });
    const meter = (g) => {
      const w = g.total ? Math.round((g.done / g.total) * 100) : g.ran ? 100 : 0;
      const tip = g.total ? `${g.done} of ${g.total} reviewed\n${g.s.title}\n${g.c.approved} approved · ${g.c.dismissed} dismissed\n${g.c.escalated} escalated · ${g.c.open} open` : `${g.ran ? 'Nothing found' : 'No data'}\n${g.s.title}`;
      return `<li><button class="stg" type="button" data-action="stage" data-stage="${g.s.id}" data-tip="${esc(tip)}">
        <span class="stg-name"><b>${esc(g.s.title)}</b><small>${esc(g.s.phase)}${PRE.includes(g.s.id) ? ' · gates release' : ' · after settlement'}</small></span>
        <span class="meter${g.total && g.done === g.total ? ' done' : ''}" aria-hidden="true"><i style="width:${w}%"></i></span>
        <span class="stg-val"><b>${g.total ? `${g.done} of ${g.total}` : g.ran ? 'Clean' : 'No data'}</b><small>${g.total ? `${g.c.open + g.c.escalated} open${g.c.escalated ? ` · ${g.c.escalated} escalated` : ''}` : g.ran ? 'nothing found' : 'not loaded'}</small></span>
      </button></li>`;
    };

    // Repeat issues per pay period, with the current period emphasized.
    const per = fx.periods.map((pp, k) => ({
      cycle: pp.cycle, current: !!pp.current, n: sum(fx.recurring, (c) => c.perPeriod[k]),
      parts: fx.recurring.filter((c) => c.perPeriod[k]).map((c) => `${c.label}${c.by !== 'type' && c.dim ? `, ${c.dim}` : ''}: ${c.perPeriod[k]}`),
    }));
    const peak = Math.max(0, ...per.map((x) => x.n));
    const { top, ticks } = niceTicks(peak);
    const peakIdx = per.findIndex((x) => x.n === peak);
    const shortCycle = (c) => c.replace(/^PR-\d{4}-/, 'PR ');
    const chart = fx.recurring.length ? `<div class="colchart">
        <div class="cc-plot">
          ${ticks.map((v) => `<span class="cc-grid" style="bottom:${(v / top) * 100}%"><em>${v}</em></span>`).join('')}
          <div class="cc-cols">${per.map((x, k) => `<button type="button" class="cc-col${x.current ? ' cur' : ''}" aria-label="${esc(`${x.cycle}${x.current ? ' (this cycle)' : ''}: ${x.n} occurrences`)}" data-tip="${esc([`${x.n} ${x.n === 1 ? 'occurrence' : 'occurrences'}`, `${x.cycle}${x.current ? ' · this cycle' : ''}`].concat(x.parts).join('\n'))}">
            <span class="cc-bar" style="height:${top ? (x.n / top) * 100 : 0}%">${x.current || k === peakIdx ? `<b>${x.n}</b>` : ''}</span></button>`).join('')}</div>
        </div>
        <div class="cc-x" aria-hidden="true">${per.map((x) => `<span class="${x.current ? 'cur' : ''}">${esc(shortCycle(x.cycle))}</span>`).join('')}</div>
      </div>
      <details class="tview"><summary>Table view</summary><div class="table-wrap"><table>
        <thead><tr><th>Period</th><th class="n">Occurrences</th><th>Patterns</th></tr></thead>
        <tbody>${per.map((x) => `<tr><td class="mono">${esc(x.cycle)}${x.current ? ' <span class="pill plain">This cycle</span>' : ''}</td><td class="n">${x.n}</td><td class="wrap">${esc(x.parts.join('; ') || '—')}</td></tr>`).join('')}</tbody></table></div></details>`
      : '<div class="empty"><h3>No repeat issues</h3><p>No exception shows up in enough pay periods to count as repeating.</p></div>';

    // Queues: open work by owner, with who covers each queue.
    const queues = [...new Set(OWNERS.concat(open.map(ownerOf)))].map((o) => {
      const l = open.filter((x) => ownerOf(x) === o);
      return {
        o, l, people: store.team.filter((m) => m.active !== false && m.queue === o).map((m) => m.name),
        esc: l.filter((x) => statusOf(x) === 'escalated').length, blockers: l.filter((x) => x.severity === 'blocker').length,
        late: l.filter(pastSla).length, oldest: l.length ? Math.max(...l.map(ageH)) : 0, exposure: sum(l.filter((x) => x.impact), (x) => x.impact.amount),
      };
    }).filter((q) => q.l.length || q.people.length).sort((a, b) => b.blockers - a.blockers || b.l.length - a.l.length || a.o.localeCompare(b.o));

    const feedRow = (def) => {
      if (def.group === 'custom') {
        const s = state.src[def.key] || {};
        const n = (s.rows || []).length;
        return { def, at: n ? s.at : null, pill: n ? ['pass', 'Loaded'] : def.custom.required ? ['blocker', 'Missing'] : ['plain', 'Not loaded'] };
      }
      if (FEED_KEYS.includes(def.key)) {
        const f = feedStatus(def.key);
        return { def, at: f.received, pill: !f.loaded ? ['blocker', 'Missing'] : f.late ? ['review', `Late ${fmtLate(f.late)}`] : ['pass', 'On time'] };
      }
      const s = state.src[def.key] || {};
      return { def, at: s.rows ? (s.origin === 'sample' ? SAMPLE_RECEIVED[def.key] : s.received || s.at) : null, pill: s.rows ? ['pass', 'Loaded'] : ['blocker', 'Missing'] };
    };
    const adminLog = store.audit.filter((a) => ADMIN_ACTIONS.has(a.action)).slice(0, 8);

    return `
      <section class="card adm-status" data-state="${rd.state}">
        <div class="adm-status-main">
          <span class="status-chip ${rd.state}">${STATE_WORD[rd.state]}</span>
          <p>${esc(line)}</p>
          ${btns.length ? `<div class="actions-row">${btns.join('')}</div>` : ''}
        </div>
        <div class="facts adm-facts">
          <div><span>Pay date</span><b>${p.payDate ? esc(F.fmtDate(p.payDate)) : '—'}</b></div>
          <div><span>Net pay</span><b>${F.money(r.regTotals.net)}</b></div>
          <div><span>Employees paid</span><b>${r.totals.onRegister}</b></div>
          <div><span>Checks last run</span><b>${esc(clock(state.lastRun))}</b></div>
        </div>
      </section>

      <div class="kpis">
        ${tile('Pre-release blockers', String(rd.preOpen.length), `open of ${rd.pre.length} · ${rd.preOpen.length ? 'release blocked' : 'gate clear'}`, { action: 'data-action="go-blockers"', cls: rd.preOpen.length ? 'crit' : 'zero' })}
        ${tile('Awaiting review', String(open.length), `${escalated.length} escalated`, { action: 'data-action="go-page" data-page="exceptions"', cls: open.length ? '' : 'zero' })}
        ${tile('Reviewed', `${pct}%`, `${done} of ${work.length} items`)}
        ${tile('Open dollar impact', F.money(exposure), `from ${plural(priced.length, 'priced item')}`, { action: 'data-action="go-page" data-page="runradar"', cls: exposure ? '' : 'zero' })}
        ${tile('Overdue', String(late.length), late.length ? `oldest open ${hrs(Math.max(...late.map(ageH)))}` : nextDue !== undefined ? `next due in ${hrs(nextDue)}` : 'nothing open', { cls: late.length ? 'crit' : 'zero' })}
        ${tile('AI explanations', String(aiN), aiOn ? 'this cycle' : store.policy.aiExplain ? 'AI service not connected' : 'turned off in Policies', { cls: aiN ? '' : 'zero' })}
      </div>

      <div class="grid adm-2">
        <section class="card">
          <div class="card-head"><h3>Review progress by stage</h3><span class="muted" style="font-size:var(--t-sm)">Approved or dismissed, of everything found</span></div>
          <ul class="stg-list">${stages.map(meter).join('')}</ul>
          <details class="tview"><summary>Table view</summary><div class="table-wrap"><table>
            <thead><tr><th>Stage</th><th class="n">Found</th><th class="n">Approved</th><th class="n">Dismissed</th><th class="n">Escalated</th><th class="n">Open</th></tr></thead>
            <tbody>${stages.map((g) => `<tr><td>${esc(g.s.title)}</td><td class="n">${g.total}</td><td class="n">${g.c.approved}</td><td class="n">${g.c.dismissed}</td><td class="n">${g.c.escalated}</td><td class="n">${g.c.open}</td></tr>`).join('')}</tbody></table></div></details>
        </section>
        <section class="card">
          <div class="card-head"><h3>Repeat issues by pay period</h3><a class="more" href="#fixflow">Repeat issues</a></div>
          <p class="card-sub">How often the ${plural(fx.recurring.length, 'repeat issue')} showed up each period (an issue counts once it’s seen in ${thr} or more periods)</p>
          ${chart}
        </section>
      </div>

      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Work by owner</h3><span class="muted" style="font-size:var(--t-sm)">Blockers are due within ${store.policy.slaBlockerH}h, review items within ${store.policy.slaReviewH}h</span><a class="more" href="#exceptions">Review queue</a></div>
        ${queues.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Owner</th><th>People</th><th class="n">Open</th><th class="n">Escalated</th><th class="n">Blockers</th><th class="n">Overdue</th><th class="n">Oldest</th><th class="n">Dollar impact</th></tr></thead>
          <tbody>${queues.map((q) => `<tr class="clickable" data-action="filter-owner" data-owner="${esc(q.o)}">
            <td><b>${esc(q.o)}</b></td>
            <td class="wrap">${q.people.length ? esc(q.people.join(', ')) : q.l.length ? '<span class="pill review">No one assigned</span>' : '<span class="muted">—</span>'}</td>
            <td class="n">${q.l.length || '<span class="muted">0</span>'}</td>
            <td class="n">${q.esc || '<span class="muted">0</span>'}</td>
            <td class="n">${q.blockers || '<span class="muted">0</span>'}</td>
            <td class="n">${q.late ? `<b class="neg">${q.late}</b>` : '<span class="muted">0</span>'}</td>
            <td class="n">${q.l.length ? hrs(q.oldest) : '—'}</td>
            <td class="n">${F.money(q.exposure)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty"><h3>Nothing open</h3><p>Every queue is clear.</p></div>'}
      </section>

      <div class="grid adm-2">
        <section class="card">
          <div class="card-head"><h3>Checks</h3><span class="muted" style="font-size:var(--t-sm)">Each step of the cycle</span></div>
          <ul class="adm-list">${APPS.map((a) => `<li><button type="button" data-action="go-page" data-page="${a.id}"><span class="t"><b>${esc(a.name)}</b><span>${esc(apps[a.id].text)}</span></span><span class="pill ${STEP_PILL[apps[a.id].state][0]}">${STEP_PILL[apps[a.id].state][1]}</span></button></li>`).join('')}</ul>
        </section>
        <section class="card">
          <div class="card-head"><h3>Files received</h3><a class="more" href="#sources">Data sources</a></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Source</th><th>Received</th><th>Status</th></tr></thead>
            <tbody>${SOURCES.filter((s) => s.group === 'records' || s.group === 'custom').map(feedRow).map((f) => `<tr><td><b>${esc(f.def.title)}</b><br><span class="muted" style="font-size:var(--t-xs)">${esc(f.def.sys)}</span></td><td class="mono" style="font-size:var(--t-xs)">${f.at ? esc(stamp(f.at)) : '—'}</td><td><span class="pill ${f.pill[0]}">${esc(f.pill[1])}</span></td></tr>`).join('')}</tbody>
          </table></div>
        </section>
      </div>

      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Admin activity</h3><span class="muted" style="font-size:var(--t-sm)">Role and policy changes, holds, releases, user switches and blocked actions</span><a class="more" href="#activity">Full log</a></div>
        ${adminLog.length ? `<ul class="feed">${adminLog.map(feedItem).join('')}</ul>` : '<div class="empty"><p>Nothing yet. Role changes, policy changes, holds, releases and blocked actions show up here.</p></div>'}
      </section>`;
  }

  function adminTeam() {
    const ed = can('admin');
    const dis = ed ? '' : 'disabled';
    const lastSeen = (m) => { const a = store.audit.find((e) => e.by === m.name); return a ? ago(a.t) : 'No activity'; };
    const count = (role) => store.team.filter((m) => m.role === role && m.active !== false).length;
    return `
      <div class="notice" style="margin-bottom:16px"><span>Roles apply to everyone working in this browser. Each person picks themselves under Settings → Working as${store.policy.pin ? '; switching into a payroll admin asks for the admin PIN' : ''}. In production, people sign in through your single sign-on.</span></div>
      <section class="card">
        <div class="card-head"><h3>Team</h3><span class="muted" style="font-size:var(--t-sm)">${plural(store.team.filter((m) => m.active !== false).length, 'active member')}</span></div>
        <div class="table-wrap"><table class="team">
          <thead><tr><th>Name</th><th>Role</th><th>Queue</th><th>Status</th><th>Last activity</th><th></th></tr></thead>
          <tbody>${store.team.map((m) => `<tr>
            <td><span class="team-name"><input class="text" data-team="${esc(m.id)}" data-field="name" value="${esc(m.name)}" aria-label="Name" ${dis}>${m.id === store.userId ? '<span class="pill plain">You</span>' : ''}</span></td>
            <td><select data-team="${esc(m.id)}" data-field="role" aria-label="Role for ${esc(m.name)}" ${dis}>${ROLES.map((r) => `<option value="${r.id}" ${m.role === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></td>
            <td><select data-team="${esc(m.id)}" data-field="queue" aria-label="Queue for ${esc(m.name)}" ${dis}><option value="">No queue</option>${OWNERS.map((o) => `<option ${m.queue === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>
            <td><label class="field"><input type="checkbox" class="cb" data-team="${esc(m.id)}" data-field="active" ${m.active !== false ? 'checked' : ''} ${dis}> Active</label></td>
            <td class="muted" style="font-size:var(--t-xs)">${esc(lastSeen(m))}</td>
            <td>${ed && m.id !== store.userId ? `<button class="linkish" type="button" data-action="team-remove" data-id="${esc(m.id)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody>
        </table></div>
        ${ed ? `<div class="card-body team-add">
          <span class="eyebrow">Add a team member</span>
          <div class="team-add-row">
            <input class="text" id="tmName" placeholder="Name" aria-label="New member name" autocomplete="off">
            <select id="tmRole" aria-label="New member role">${ROLES.map((r) => `<option value="${r.id}" ${r.id === 'reviewer' ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
            <select id="tmQueue" aria-label="New member queue"><option value="">No queue</option>${OWNERS.map((o) => `<option>${esc(o)}</option>`).join('')}</select>
            <button class="btn small primary" type="button" data-action="team-add">Add</button>
          </div>
          <p class="form-err" id="tmErr" hidden></p>
        </div>` : ''}
      </section>

      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Permissions by role</h3><span class="muted" style="font-size:var(--t-sm)">Payroll admins always hold every permission</span></div>
        <div class="table-wrap"><table class="perm">
          <thead><tr><th>Permission</th>${ROLES.map((r) => `<th class="c">${esc(r.label)}<br><span class="perm-n">${plural(count(r.id), 'person', 'people')}</span></th>`).join('')}</tr></thead>
          <tbody>${CAPS.map((c) => `<tr><td class="wrap">${esc(c.label)}</td>${ROLES.map((r) => {
            const locked = r.id === 'admin' || c.id === 'admin';
            return `<td class="c"><input type="checkbox" class="cb" data-perm="${r.id}|${c.id}" ${permsOf(r.id)[c.id] ? 'checked' : ''} ${locked || !ed ? 'disabled' : ''} aria-label="${esc(`${r.label}: ${c.label}`)}"></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="card-body"><p class="muted" style="font-size:var(--t-sm);margin-top:10px">${ROLES.map((r) => `<b>${esc(r.label)}</b>: ${esc(r.desc)}`).join(' · ')}</p></div>
      </section>

      <section class="card" style="margin-top:16px;max-width:720px">
        <div class="card-head"><h3>Admin PIN</h3>${store.policy.pin ? '<span class="pill pass">Set</span>' : '<span class="pill plain">Not set</span>'}</div>
        <div class="card-body" style="display:grid;gap:10px">
          <p style="font-size:var(--t-sm)">Asked for when someone switches into a payroll admin in Settings, so reviewers sharing this browser can’t open the admin controls. It is a PIN, not a password: use single sign-on for real access control.</p>
          ${ed ? `<div class="team-add-row">
            <input class="text" id="pinNew" type="password" inputmode="numeric" maxlength="12" placeholder="4 to 12 digits" aria-label="New admin PIN" autocomplete="new-password">
            <button class="btn small primary" type="button" data-action="pin-set">${store.policy.pin ? 'Change PIN' : 'Set PIN'}</button>
            ${store.policy.pin ? '<button class="btn small danger" type="button" data-action="pin-clear">Remove PIN</button>' : ''}
          </div><p class="form-err" id="pinSetErr" hidden></p>` : ''}
        </div>
      </section>`;
  }

  function adminPolicies() {
    const p = store.policy, ed = can('admin'), dis = ed ? '' : 'disabled';
    const rd = readiness();
    const hold = cyc().hold;
    const chk = (key, label, hint) => `<div class="rule"><label for="pol-${key}">${esc(label)}</label><input type="checkbox" id="pol-${key}" data-policy="${key}" ${p[key] ? 'checked' : ''} ${dis}><p class="hint">${esc(hint)}</p></div>`;
    const num = (key, label, unit, hint, step, min) => `<div class="rule"><label for="pol-${key}">${esc(label)} <span class="muted">(${esc(unit)})</span></label><input type="number" inputmode="decimal" id="pol-${key}" data-policy="${key}" value="${esc(p[key])}" step="${step || 1}" min="${min || 0}" ${dis}><p class="hint">${esc(hint)}</p></div>`;
    return `<div class="rules">
      <section class="rule-card"><div><h4>Release controls</h4><p class="src">Checked whenever someone opens Release payroll</p></div>
        <div class="hold-box" data-on="${!!hold}">
          ${hold ? `<p><b>${esc(cycleId())} is on hold.</b> ${esc(hold.by)}, ${esc(stamp(hold.at))}: “${esc(hold.reason)}”</p>${ed ? '<div><button class="btn small primary" type="button" data-action="hold-lift">Lift hold</button></div>' : ''}`
            : `<p><b>Release hold.</b> Stops anyone releasing ${esc(cycleId())} until an admin lifts it, even when every blocker is cleared.</p>${ed && !rd.released ? '<div><button class="btn small" type="button" data-action="hold-open">Put release on hold…</button></div>' : rd.released ? '<p class="muted">This cycle is already released.</p>' : ''}`}
        </div>
        ${chk('sod', 'A different person must release', 'Whoever dismissed a pre-release blocker can’t also release the batch.')}
        ${chk('lockAfterRelease', 'Lock pre-release items after release', 'Time, roster and register items can’t change until the cycle is reopened with a reason.')}
      </section>
      <section class="rule-card"><div><h4>Review controls</h4><p class="src">The review queue</p></div>
        ${num('dismissLimit', 'Dismissal limit', '$', 'Blockers at or above this amount need a payroll approver or admin to dismiss. Change who can under Team and access.', 50, 0)}
        ${chk('approveNote', 'Require a note to approve a blocker', 'The reviewer writes what was fixed or checked before approving.')}
        ${num('slaBlockerH', 'Blockers are due within', 'hours', 'Open blockers older than this show as overdue.', 1, 1)}
        ${num('slaReviewH', 'Review items are due within', 'hours', 'The same, for review items.', 1, 1)}
      </section>
      <section class="rule-card"><div><h4>AI and checks</h4><p class="src">Data quality, the review queue and repeat issues</p></div>
        ${chk('aiExplain', 'AI explanations in the review queue', 'Off: reviewers see the explanation the rules assemble from the records.')}
        ${chk('aiClusters', 'AI-suggested causes on Repeat issues', 'Off: causes come from the rule templates.')}
        ${chk('aiChat', 'AI chat', 'The Ask AI panel. Off: it still searches your data and lists the closest records.')}
        <div class="rule"><label for="pol-fixThreshold">Count an issue as repeating at</label><select id="pol-fixThreshold" data-policy="fixThreshold" ${dis}>${[2, 3, 4, 5].map((n) => `<option value="${n}" ${p.fixThreshold === n ? 'selected' : ''}>${n}+ periods</option>`).join('')}</select><p class="hint">The default on Repeat issues and the monitor.</p></div>
        ${num('cutoffDays', 'Data is due', 'days after period end', 'Time records, schedules and the employee list received after this are late.', 1, 0)}
        <div class="rule"><label for="pol-cutoffTime">Data is due by</label><input type="time" id="pol-cutoffTime" data-policy="cutoffTime" value="${esc(p.cutoffTime)}" ${dis}></div>
        <div class="rule"><span>Mask names, IDs and bank details</span><span class="pill pass" style="justify-self:end">Always on</span><p class="hint">Applied before anything is sent to the AI. Not configurable.</p></div>
        <div class="rule"><span>AI service</span>${state.ai && state.ai.available ? '<span class="conn ok" style="justify-self:end">Connected</span>' : '<span class="conn idle" style="justify-self:end">Not connected</span>'}<p class="hint">${state.ai && state.ai.available ? `${esc(state.ai.model)}. Only masked records are sent.` : 'Add GROQ_API_KEY to the deployment to turn it on.'}</p></div>
      </section>
    </div>`;
  }

  function adminData() {
    const ed = can('admin');
    const chars = (k) => { try { return (localStorage.getItem(k) || '').length; } catch (e) { return 0; } };
    const used = chars(STORE_KEY) + chars(FILES_KEY);
    const cap = 5 * 1024 * 1024;
    const cycles = Object.entries(store.cycles).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const fact = (label, value) => `<div><span>${esc(label)}</span><b>${value}</b></div>`;
    return `<div class="grid adm-2" style="margin-top:0">
      <section class="card"><div class="card-head"><h3>Backup and restore</h3></div><div class="card-body" style="display:grid;gap:10px">
        <p style="font-size:var(--t-sm)">Download everything this browser holds for ${esc(store.workspace)}: statuses, notes, releases, team, roles, policies, rule changes, the activity log and imported files. Restore it on another computer to pick up where you left off. The file contains pay data; store it like a payroll report.</p>
        <div class="actions-row">
          <button class="btn small primary" type="button" data-action="backup-export">${ICON.download} Download backup</button>
          ${ed ? '<button class="btn small" type="button" data-action="restore-pick">Restore from backup…</button><input type="file" id="restoreFile" accept=".json,application/json" hidden>' : ''}
        </div>
      </div></section>
      <section class="card"><div class="card-head"><h3>Audit trail</h3><a class="more" href="#activity">Activity log</a></div>
        <div class="facts">
          ${fact('Entries', store.audit.length)}
          ${fact('This cycle', store.audit.filter((a) => a.cycle === cycleId()).length)}
          ${fact('Admin changes', store.audit.filter((a) => ADMIN_ACTIONS.has(a.action) && a.action !== 'Action blocked').length)}
          ${fact('Blocked actions', store.audit.filter((a) => a.action === 'Action blocked').length)}
        </div>
        <div class="card-body"><button class="btn small" type="button" data-action="export-audit">${ICON.download} Export CSV</button></div>
      </section>
      <section class="card"><div class="card-head"><h3>Cycles in this browser</h3></div>
        ${cycles.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Cycle</th><th class="n">Worked items</th><th>Status</th></tr></thead>
          <tbody>${cycles.map(([id, c]) => `<tr><td class="mono">${esc(id)}${id === cycleId() ? ' <span class="pill plain">Current</span>' : ''}</td>
            <td class="n">${Object.values(c.items || {}).filter((i) => i.events && i.events.length).length}</td>
            <td>${c.released ? `<span class="pill info">Released</span> <span class="muted" style="font-size:var(--t-xs)">${esc(stamp(c.released.at))} by ${esc(c.released.by)}</span>` : c.hold ? '<span class="pill review">On hold</span>' : '<span class="pill plain">Open</span>'}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty"><p>No cycles yet.</p></div>'}
      </section>
      <section class="card"><div class="card-head"><h3>Storage</h3></div><div class="card-body" style="display:grid;gap:10px">
        <p style="font-size:var(--t-sm)">${Math.max(1, Math.round(used / 1024))} KB of the roughly 5 MB this browser allows.</p>
        <span class="meter" role="img" aria-label="${Math.round((used / cap) * 100)}% of browser storage used"><i style="width:${Math.min(100, Math.max(1, (used / cap) * 100)).toFixed(1)}%"></i></span>
        <p style="font-size:var(--t-sm)">Clearing deletes every status, note, release record, rule change and activity entry here and reloads the sample cycle. Team, roles and policies are kept.</p>
        ${ed ? '<div><button class="btn small danger" type="button" data-action="reset-workspace">Clear workspace data…</button></div>' : ''}
      </div></section>
    </div>`;
  }

  // ----------------------------------------------------------------------------------
  // Your data sources and your rules: added by the team, run beside the built-in checks
  // ----------------------------------------------------------------------------------

  const STAGE_TITLE = Object.fromEntries(E.STAGES.map((s) => [s.id, s.title]));
  const SOURCE_STAGE = { census: 'roster', schedules: 'time', time: 'time', register: 'payroll', bank: 'funding', gl: 'gl' };
  const isCustomSource = (key) => !!(SRC[key] && SRC[key].group === 'custom');
  const ruleSources = () => SOURCES.filter((s) => s.group === 'records' || s.group === 'custom');
  // Columns that can identify a person; never shown to the AI and left out of evidence.
  const SENSITIVE_RE = /(^|_)(first|last|middle|full|employee|legal|preferred|payee)_?name$|^name$|ssn|social_?sec|address|street|city|zip|postal|phone|email|routing|account_?(no|num|number)$|birth|dob/i;
  const EMP_KEYS = ['empid', 'employee', 'employeeno', 'employeenumber'].concat((SYN.emp_id || []).filter((k) => k !== 'id'));
  const DATE_KEYS = ['work_date', 'date', 'value_date', 'post_date', 'pay_date', 'txn_date', 'effective_date', 'period_end'];
  const MAX_RULE_HITS = 200;

  // Mirror store.customSources into the SOURCES list every page already reads.
  function syncCustomSources() {
    for (let i = SOURCES.length - 1; i >= 0; i--) if (SOURCES[i].group === 'custom') { delete SRC[SOURCES[i].key]; SOURCES.splice(i, 1); }
    (store.customSources || []).forEach((d) => {
      d.columns = d.columns || [];
      const def = { key: d.key, group: 'custom', kind: 'csv', file: '', title: d.title, sys: d.sys || 'Added by your team', icon: 'plug', api: 'https://example.com/api/rows?from={start}&to={end}', desc: d.desc || '', custom: d };
      SOURCES.push(def);
      SRC[d.key] = def;
      KEY_COLS[d.key] = [];
    });
  }
  const sourceRows = (key) => (state.src[key] && state.src[key].rows) || [];
  function sourceFields(key) {
    const rows = sourceRows(key);
    if (rows.length) return headersOf(rows.slice(0, 300));
    if (isCustomSource(key)) return SRC[key].custom.columns.slice();
    return E.SCHEMAS[key] ? E.SCHEMAS[key].slice() : [];
  }
  const empField = (fields) => fields.find((f) => f === 'emp_id') || fields.find((f) => EMP_KEYS.includes(normH(f))) || null;
  const nameField = (fields) => fields.find((f) => /^(employee_?name|name|full_?name)$/i.test(f)) || null;

  // ---- Data source editor
  function sourceModal(def, opener, importItem) {
    const d = def ? def.custom : { title: importItem ? upper(importItem.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()) : '', sys: '', desc: '', stage: 'payroll', owner: 'Payroll', required: false };
    openModal(`<div class="mh"><h2 id="modalTitle">${def ? 'Edit data source' : 'Add a data source'}</h2></div>
      <div class="mb">
        ${def ? '' : '<p>Add any file or system your team checks each pay cycle, such as benefits enrollment, tips, garnishments, expense reimbursements or contractor payments. Then upload its file and write rules for it on the Rules page.</p>'}
        <label class="field-col" for="csTitle"><b>Name</b><input class="text" id="csTitle" value="${esc(d.title)}" placeholder="e.g. Benefits enrollment" autocomplete="off" autofocus></label>
        <label class="field-col" for="csSys"><span><b>Where it comes from</b> <span class="muted">optional</span></span><input class="text" id="csSys" value="${esc(d.sys)}" placeholder="e.g. Benefits portal export" autocomplete="off"></label>
        <label class="field-col" for="csDesc"><span><b>What it contains</b> <span class="muted">optional</span></span><textarea class="text" id="csDesc" placeholder="e.g. One row per employee and plan, with the deduction amount">${esc(d.desc)}</textarea></label>
        <div class="two-col">
          <label class="field-col" for="csStage"><b>Step of the pay cycle</b><select id="csStage">${E.STAGES.map((s) => `<option value="${s.id}" ${d.stage === s.id ? 'selected' : ''}>${esc(s.title)}${PRE.includes(s.id) ? ' (before release)' : ' (after payday)'}</option>`).join('')}</select></label>
          <label class="field-col" for="csOwner"><b>Owner</b><select id="csOwner">${OWNERS.map((o) => `<option ${d.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
        </div>
        <label class="field" style="color:var(--ink);align-items:flex-start"><input type="checkbox" class="cb" id="csRequired" ${d.required ? 'checked' : ''}> <span><b>Required every pay cycle</b><br><span class="muted">If the file is missing, the review queue gets a blocker. In a step before release, that stops payroll release.</span></span></label>
        <p class="form-err" id="csErr" hidden></p>
      </div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="cs-save" data-key="${def ? esc(def.key) : ''}" data-import="${importItem ? esc(importItem.id) : ''}">${def ? 'Save' : 'Add data source'}</button></div>`, opener);
  }
  function saveSource(el) {
    if (!allow('data')) { closeModal(); return; }
    const title = $('#csTitle').value.trim();
    const err = $('#csErr');
    const editing = el.dataset.key ? store.customSources.find((x) => x.key === el.dataset.key) : null;
    const clash = SOURCES.find((s) => s.title.toLowerCase() === title.toLowerCase() && (!editing || s.key !== editing.key));
    if (!title || clash) { err.textContent = !title ? 'Give the data source a name.' : `There is already a data source called ${clash.title}.`; err.hidden = false; $('#csTitle').focus(); return; }
    const fields = { title, sys: $('#csSys').value.trim(), desc: $('#csDesc').value.trim(), stage: $('#csStage').value, owner: $('#csOwner').value, required: $('#csRequired').checked };
    let d = editing;
    if (d) {
      Object.assign(d, fields);
      log('Data source changed', `${title} · ${STAGE_TITLE[d.stage]} · ${d.owner}${d.required ? ' · required every cycle' : ''}`);
    } else {
      d = Object.assign({ key: `cs${Date.now().toString(36)}`, columns: [], created: nowIso(), by: store.user }, fields);
      store.customSources.push(d);
      log('Data source added', `${title} · ${STAGE_TITLE[d.stage]} · ${d.owner}${d.required ? ' · required every cycle' : ''}`);
    }
    syncCustomSources();
    if (!state.src[d.key]) state.src[d.key] = { mode: 'upload' };
    const it = el.dataset.import && state.importQueue.find((x) => x.id === el.dataset.import);
    if (it) { it.kind = d.key; it.map = {}; }
    closeModal();
    recompute();
    persistSources();
    renderAll();
    toast(editing ? `${title} saved` : `${title} added${it ? ' · ready to load' : '. Upload its file below.'}`);
  }
  function removeSourceModal(key, opener) {
    const def = SRC[key];
    if (!def) return;
    const used = (store.customRules || []).filter((r) => r.source === key);
    openModal(`<div class="mh"><h2 id="modalTitle">Remove ${esc(def.title)}?</h2></div>
      <div class="mb"><p>This removes the data source and its loaded file from this browser.${used.length ? ` ${plural(used.length, 'rule uses', 'rules use')} it and will be turned off: ${esc(used.map((r) => r.name).join(', '))}.` : ''}</p></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="cs-remove-confirm" data-key="${esc(key)}">Remove</button></div>`, opener);
  }
  function removeSource(key) {
    if (!allow('data')) { closeModal(); return; }
    const d = store.customSources.find((x) => x.key === key);
    if (!d) { closeModal(); return; }
    store.customSources = store.customSources.filter((x) => x.key !== key);
    const off = (store.customRules || []).filter((r) => r.source === key && r.enabled);
    off.forEach((r) => { r.enabled = false; });
    delete state.src[key];
    delete store.connectors[key];
    syncCustomSources();
    log('Data source removed', `${d.title}${off.length ? ` · turned off ${plural(off.length, 'rule')}` : ''}`);
    closeModal();
    recompute();
    persistSources();
    renderAll();
    toast(`${d.title} removed`);
  }
  function customMeta(def) {
    const d = def.custom;
    const used = (store.customRules || []).filter((r) => r.source === def.key).length;
    return `<div class="cs-meta"><span class="pill plain">${esc(STAGE_TITLE[d.stage])}</span><span class="pill plain">Owner: ${esc(d.owner)}</span>${d.required ? '<span class="pill review">Required every cycle</span>' : ''}${used ? `<span class="pill info">${plural(used, 'rule')}</span>` : ''}</div>`;
  }
  function customSourcesCard() {
    const list = SOURCES.filter((s) => s.group === 'custom');
    if (!list.length) return '';
    return `<section class="card" style="margin-top:16px"><div class="card-head"><h3>Your data sources</h3><a class="more" href="#sources">Data sources</a></div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Step</th><th>Received</th><th>Status</th><th class="n">Records</th></tr></thead>
      <tbody>${list.map((s) => {
        const st = state.src[s.key] || {};
        const n = (st.rows || []).length;
        return `<tr><td><b>${esc(s.title)}</b><br><span class="muted" style="font-size:var(--t-xs)">${esc(s.sys)}</span></td><td>${esc(STAGE_TITLE[s.custom.stage])}</td>
          <td class="mono" style="font-size:var(--t-xs)">${n && st.at ? esc(stamp(st.at)) : '—'}</td>
          <td>${n ? '<span class="pill pass">Loaded</span>' : s.custom.required ? '<span class="pill blocker">Missing</span>' : '<span class="pill plain">Not loaded</span>'}</td><td class="n">${n || '—'}</td></tr>`;
      }).join('')}</tbody></table></div></section>`;
  }

  // ---- Rule engine
  const OPS = [['gt', 'is more than'], ['gte', 'is at least'], ['lt', 'is less than'], ['lte', 'is at most'], ['eq', 'equals'], ['ne', 'does not equal'],
    ['contains', 'contains'], ['not_contains', 'does not contain'], ['in', 'is one of'], ['empty', 'is empty'], ['not_empty', 'is not empty']];
  const OP_WORD = Object.fromEntries(OPS);
  const NO_VALUE = new Set(['empty', 'not_empty']);
  // Numbers as files write them: 1,234.56, $12, (45.00). Dates and times are not numbers.
  function numv(v) {
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (!/^\(?-?\$?\s*[\d,]*\.?\d+\)?$/.test(s)) return null;
    const n = parseFloat(s.replace(/[$,()\s]/g, ''));
    return Number.isFinite(n) ? (/^\(.*\)$/.test(s) ? -n : n) : null;
  }
  function testCond(row, c) {
    const a = row[c.field];
    const b = c.cmp === 'field' ? row[c.value] : c.value;
    const sa = String(a === null || a === undefined ? '' : a).trim(), sb = String(b === null || b === undefined ? '' : b).trim();
    const la = sa.toLowerCase(), lb = sb.toLowerCase();
    if (c.op === 'empty') return sa === '';
    if (c.op === 'not_empty') return sa !== '';
    if (c.op === 'contains') return lb !== '' && la.includes(lb);
    if (c.op === 'not_contains') return !la.includes(lb);
    if (c.op === 'in') return lb.split(',').map((x) => x.trim()).filter(Boolean).includes(la);
    const na = numv(a), nb = numv(b);
    const num = na !== null && nb !== null;
    if (c.op === 'eq') return num ? Math.abs(na - nb) < 0.005 : la === lb;
    if (c.op === 'ne') return num ? Math.abs(na - nb) >= 0.005 : la !== lb;
    if (num) return { gt: na > nb, gte: na >= nb, lt: na < nb, lte: na <= nb }[c.op] || false;
    if (sa === '' || sb === '') return false;
    return { gt: sa > sb, gte: sa >= sb, lt: sa < sb, lte: sa <= sb }[c.op] || false;
  }
  const activeConds = (rule) => (rule.conds || []).filter((c) => c.field && c.op && (NO_VALUE.has(c.op) || String(c.value || '').trim() !== ''));
  // Rows to test: each row, or one combined row per employee with numbers added up.
  function ruleRows(rule) {
    const rows = sourceRows(rule.source);
    if (rule.scope !== 'employee') return rows.map((row) => ({ row, n: 1 }));
    const ef = empField(sourceFields(rule.source));
    if (!ef) return [];
    const groups = {};
    rows.forEach((r) => { const id = String(r[ef] || '').trim(); if (id) (groups[id] = groups[id] || []).push(r); });
    return Object.values(groups).map((list) => {
      const out = {};
      headersOf(list).forEach((k) => {
        const vals = list.map((r) => r[k]).filter((v) => v !== undefined && String(v).trim() !== '');
        const nums = vals.map(numv);
        out[k] = k !== ef && vals.length && nums.every((n) => n !== null) ? String(E.util.r2(sum(nums, (n) => n))) : vals[0] || '';
      });
      out.row_count = String(list.length);
      return { row: out, n: list.length };
    });
  }
  function ruleMatches(rule) {
    const conds = activeConds(rule);
    if (!conds.length || !SRC[rule.source]) return [];
    return ruleRows(rule).filter(({ row }) => (rule.match === 'any' ? conds.some((c) => testCond(row, c)) : conds.every((c) => testCond(row, c))));
  }
  const fieldLabel = (f) => (f === 'row_count' ? 'number of rows' : f);
  function condText(c, row) {
    const target = NO_VALUE.has(c.op) ? '' : c.cmp === 'field' ? `${fieldLabel(c.value)}${row ? ` (${String(row[c.value] || '').trim() || 'blank'})` : ''}` : c.value;
    if (!row) return `${fieldLabel(c.field)} ${OP_WORD[c.op]}${target !== '' ? ' ' + target : ''}`;
    const actual = String(row[c.field] === undefined ? '' : row[c.field]).trim() || 'blank';
    return `${fieldLabel(c.field)} is ${actual} (rule: ${OP_WORD[c.op]}${target !== '' ? ' ' + target : ''})`;
  }
  function ruleSummary(rule) {
    const def = SRC[rule.source];
    const conds = activeConds(rule);
    return `${rule.scope === 'employee' ? 'Each employee’s total in' : 'Each row in'} ${def ? def.title.toLowerCase() : 'a removed source'}: ${conds.length ? conds.map((c) => condText(c)).join(rule.match === 'any' ? ' or ' : ' and ') : 'no conditions yet'}`;
  }
  const fillTitle = (tpl, row, emp) => String(tpl || '').replace(/\{([^{}]+)\}/g, (m, k) => {
    const key = k.trim();
    if (key === 'employee') return emp ? emp.name : '';
    return row[key] === undefined ? m : String(row[key]);
  }).trim();
  // What the AI is told about a match: the same finding, with identifying values hidden.
  function customFinding(x) {
    const rule = (store.customRules || []).find((r) => r.id === x.check);
    if (!rule || !x.row) return x.detail;
    const safe = Object.assign({}, x.row);
    Object.keys(safe).forEach((k) => { if (SENSITIVE_RE.test(k)) safe[k] = '[hidden]'; });
    return `${x.rowCount > 1 ? `Total across ${plural(x.rowCount, 'row')} in` : 'In'} ${SRC[rule.source] ? SRC[rule.source].title : 'the file'}: ${activeConds(rule).map((c) => condText(c, safe)).join('; ')}.`;
  }

  // Runs after the engine: required files, then every rule that is on. Results join the same lists.
  function runCustomRules(r) {
    Object.keys(CHECK_OF).forEach((k) => { if (CHECK_OF[k].custom) delete CHECK_OF[k]; });
    const added = [];
    const add = (o) => {
      const emp = o.empId && r.empById[o.empId];
      const x = Object.assign({ severity: 'review', impact: null, empId: null, empName: '', date: '', links: [], custom: true }, o);
      if (emp) { x.empName = emp.name; x.location = emp.location || ''; x.cc = emp.cc || ''; emp.exceptions.push(x); }
      added.push(x);
    };
    const required = SOURCES.filter((s) => s.group === 'custom' && s.custom.required);
    if (required.length) {
      CHECK_OF.D1 = { id: 'D1', stage: 'time', title: 'Required files received', custom: true, rule: () => 'Every data source marked as required has a file for this pay cycle.' };
      required.filter((s) => !sourceRows(s.key).length).forEach((s) => add({
        check: 'D1', stage: s.custom.stage, severity: 'blocker', source: s.key, owner: s.custom.owner,
        title: `${s.title} not received`, detail: `${s.title} is required every pay cycle and no file has been loaded for this one.`,
        action: `Upload this cycle’s ${s.title} file on the Data sources page, or ask a payroll admin to make it optional.`,
      }));
    }
    const ran = new Set(required.length ? ['D1'] : []);
    (store.customRules || []).forEach((rule) => {
      const def = SRC[rule.source];
      CHECK_OF[rule.id] = { id: rule.id, stage: rule.stage, title: rule.name, custom: true, rule: () => ruleSummary(rule) };
      if (!rule.enabled || !def) return;
      if (sourceRows(rule.source).length) ran.add(rule.id);
      const fields = sourceFields(rule.source);
      const ef = empField(fields), nf = nameField(fields);
      const conds = activeConds(rule);
      ruleMatches(rule).slice(0, MAX_RULE_HITS).forEach(({ row, n }) => {
        const empId = ef ? String(row[ef] || '').trim() || null : null;
        const emp = empId && r.empById[empId];
        const amt = rule.amountField ? numv(row[rule.amountField]) : null;
        add({
          check: rule.id, stage: rule.stage, severity: rule.severity, owner: rule.owner, source: rule.source, row: Object.assign({}, row), rowCount: n,
          empId, empName: emp ? emp.name : nf ? String(row[nf] || '') : '',
          date: rule.scope === 'employee' ? '' : DATE_KEYS.map((k) => row[k]).find((v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) || '',
          title: fillTitle(rule.title || rule.name, row, emp) || rule.name,
          detail: `${n > 1 ? `Total across ${plural(n, 'row')} in` : 'In'} ${def.title}: ${conds.map((c) => condText(c, row)).join('; ')}.`,
          action: rule.action || 'Check the record and correct it at the source.',
          impact: amt !== null && Math.abs(amt) >= 0.01 ? { amount: E.util.r2(Math.abs(amt)), kind: rule.amountKind || 'underpaid', estimated: false } : null,
        });
      });
    });
    const sevRank = { blocker: 0, review: 1, info: 2 };
    const stageRank = Object.fromEntries(E.STAGES.map((s, i) => [s.id, i]));
    const seq = {};
    added.forEach((x) => { seq[x.check] = (seq[x.check] || 0) + 1; x.id = `${x.check}-${String(seq[x.check]).padStart(2, '0')}`; });
    r.exceptions.push(...added);
    r.exceptions.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || stageRank[a.stage] - stageRank[b.stage]);
    const defs = Object.values(CHECK_OF).filter((c) => c.custom && (c.id === 'D1' || (store.customRules || []).some((x) => x.id === c.id && x.enabled && SRC[x.source])));
    defs.forEach((c) => {
      const list = added.filter((x) => x.check === c.id);
      const worst = list.reduce((w, e) => (sevRank[e.severity] < sevRank[w] ? e.severity : w), 'info');
      r.checks.push({
        id: c.id, stage: c.stage, title: c.title, rule: c.rule(), custom: true, ran: ran.has(c.id),
        count: list.length, blockers: list.filter((e) => e.severity === 'blocker').length,
        status: !list.length ? 'pass' : list.some((e) => e.severity !== 'info') ? (worst === 'blocker' ? 'fail' : 'warn') : 'note',
      });
    });
    r.stages.forEach((s) => {
      const list = r.exceptions.filter((x) => x.stage === s.id);
      s.blockers = list.filter((x) => x.severity === 'blocker').length;
      s.review = list.filter((x) => x.severity === 'review').length;
      s.info = list.filter((x) => x.severity === 'info').length;
    });
    const t = r.totals;
    t.exceptions = r.exceptions.length;
    t.blockers = r.exceptions.filter((x) => x.severity === 'blocker').length;
    t.review = r.exceptions.filter((x) => x.severity === 'review').length;
    t.info = r.exceptions.filter((x) => x.severity === 'info').length;
    t.releaseBlockers = r.exceptions.filter((x) => x.severity === 'blocker' && PRE.includes(x.stage)).length;
    t.postBlockers = r.exceptions.filter((x) => x.severity === 'blocker' && !PRE.includes(x.stage)).length;
    t.checksRun = r.checks.filter((c) => c.ran).length;
    t.checksFailed = r.checks.filter((c) => c.ran && (c.status === 'fail' || c.status === 'warn')).length;
    t.clean = r.employees.filter((e) => !e.exceptions.some((x) => x.severity !== 'info')).length;
  }

  // ---- Rule builder
  const RULE_TEMPLATES = [
    { name: 'Hourly rate below $20.00', source: 'census', conds: [{ field: 'pay_type', op: 'eq', value: 'Hourly' }, { field: 'hourly_rate', op: 'lt', value: '20' }], severity: 'review', owner: 'HR', title: 'Hourly rate of ${hourly_rate} is below $20.00', action: 'Confirm the rate against the offer letter and the union scale.' },
    { name: 'More than 80 hours in the pay period', source: 'time', scope: 'employee', conds: [{ field: 'wfm_hours', op: 'gt', value: '80' }], severity: 'review', owner: 'Payroll', title: '{wfm_hours} hours recorded this pay period', action: 'Check the timecard with the store manager before payroll runs.' },
    { name: 'Shift longer than 12 hours', source: 'time', conds: [{ field: 'wfm_hours', op: 'gt', value: '12' }], severity: 'review', owner: 'Store manager', title: 'Shift of {wfm_hours} hours on {work_date}', action: 'Confirm the punches with the store manager and correct them in WFM.' },
    { name: 'Direct deposit over $2,500', source: 'bank', conds: [{ field: 'txn_type', op: 'eq', value: 'ACH_CREDIT' }, { field: 'amount', op: 'gt', value: '2500' }], severity: 'info', owner: 'Treasury', title: 'Deposit of ${amount}', action: 'Spot-check the amount against the payroll register.' },
    { name: 'Net pay of zero or less', source: 'register', conds: [{ field: 'net_pay', op: 'lte', value: '0' }], severity: 'blocker', owner: 'Payroll', title: 'Net pay of {net_pay}', action: 'Review deductions and garnishments before release.' },
    { name: 'Employee with no cost center', source: 'census', conds: [{ field: 'cost_center', op: 'empty', value: '' }], severity: 'review', owner: 'HR', title: 'No cost center on file', action: 'Add the home cost center so wages post to the right account.' },
  ];
  const AMOUNT_KINDS = [['underpaid', 'owed to the employee'], ['overpaid', 'overpaid'], ['tax', 'tax exposure'], ['cash', 'deposit to fix'], ['gl', 'GL to correct'], ['liability', 'PTO liability']];
  function blankDraft() {
    return { id: null, name: '', source: 'time', scope: 'row', match: 'all', conds: [{ field: '', op: 'gt', cmp: 'value', value: '' }], severity: 'review', stage: SOURCE_STAGE.time, owner: 'Payroll', title: '', amountField: '', amountKind: 'underpaid', action: '', enabled: true };
  }
  function draftFromTemplate(t) {
    return Object.assign(blankDraft(), JSON.parse(JSON.stringify(t)), { stage: SOURCE_STAGE[t.source] || 'payroll' }, { conds: t.conds.map((c) => Object.assign({ cmp: 'value' }, c)) });
  }
  function ruleModal(opener, draft) {
    state.ruleDraft = draft;
    openModal(`<div class="mh"><h2 id="modalTitle">${draft.id ? `Edit rule ${esc(draft.id)}` : 'New rule'}</h2></div>
      <div class="mb" id="rbBody">${builderBody()}</div>
      <div class="mf"><p class="form-err" id="rbErr" hidden style="margin-right:auto"></p><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="rb-save">${draft.id ? 'Save rule' : 'Create rule'}</button></div>`, opener, true);
    refreshPreview();
  }
  function builderBody() {
    const d = state.ruleDraft;
    const fields = sourceFields(d.source);
    const ef = empField(fields);
    const all = d.scope === 'employee' ? fields.concat(['row_count']) : fields;
    const fsel = (attrs, val, blank) => `<select ${attrs}><option value="" ${val ? '' : 'selected'}>${blank}</option>${all.map((f) => `<option value="${esc(f)}" ${f === val ? 'selected' : ''}>${esc(fieldLabel(f))}</option>`).join('')}${val && !all.includes(val) ? `<option value="${esc(val)}" selected>${esc(val)}</option>` : ''}</select>`;
    return `
      ${d.id ? '' : `<div><span class="eyebrow">Start from a template</span><div class="tpl-row" style="margin-top:6px">${RULE_TEMPLATES.map((t, k) => `<button class="chip-btn" type="button" data-action="rb-template" data-t="${k}">${esc(t.name)}</button>`).join('')}</div></div>`}
      <label class="field-col" for="rbName"><b>Rule name</b><input class="text" id="rbName" data-rd="name" value="${esc(d.name)}" placeholder="e.g. Shift longer than 12 hours" autocomplete="off"></label>
      <div class="rb-section"><h4>What to check</h4>
        <div class="two-col">
          <label class="field-col" for="rbSource"><b>Data source</b><select id="rbSource" data-rd="source">${ruleSources().map((s) => `<option value="${s.key}" ${d.source === s.key ? 'selected' : ''}>${esc(s.title)}${sourceRows(s.key).length ? '' : ' (no file yet)'}</option>`).join('')}</select></label>
          <label class="field-col" for="rbScope"><b>Check</b><select id="rbScope" data-rd="scope"><option value="row" ${d.scope !== 'employee' ? 'selected' : ''}>Each row</option><option value="employee" ${d.scope === 'employee' ? 'selected' : ''} ${ef ? '' : 'disabled'}>Each employee’s total${ef ? '' : ' (needs an employee ID column)'}</option></select></label>
        </div>
        <div class="rb-match">Flag it when <select data-rd="match" aria-label="Match"><option value="all" ${d.match !== 'any' ? 'selected' : ''}>all</option><option value="any" ${d.match === 'any' ? 'selected' : ''}>any</option></select> of these are true:</div>
        <div class="rb-conds">${d.conds.map((c, i) => `<div class="rb-cond">
          ${fsel(`data-rc="field" data-i="${i}" aria-label="Column"`, c.field, 'Choose a column…')}
          <select data-rc="op" data-i="${i}" aria-label="Test">${OPS.map(([v, l]) => `<option value="${v}" ${c.op === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${NO_VALUE.has(c.op) ? '<span></span><span></span>' : `<select data-rc="cmp" data-i="${i}" aria-label="Compare with"><option value="value" ${c.cmp !== 'field' ? 'selected' : ''}>a value</option><option value="field" ${c.cmp === 'field' ? 'selected' : ''}>another column</option></select>
          ${c.cmp === 'field' ? fsel(`data-rc="value" data-i="${i}" aria-label="Other column"`, c.value, 'Choose a column…') : `<input class="text" data-rc="value" data-i="${i}" value="${esc(c.value)}" placeholder="${c.op === 'in' ? 'A, B, C' : 'Value'}" aria-label="Value" autocomplete="off">`}`}
          <button class="linkish" type="button" data-action="rb-cond-remove" data-i="${i}" ${d.conds.length === 1 ? 'disabled' : ''}>Remove</button>
        </div>`).join('')}</div>
        <div><button class="btn small" type="button" data-action="rb-cond-add">Add a condition</button></div>
        ${fields.length ? '' : '<p class="muted" style="font-size:var(--t-xs)">This source has no file yet, so its columns are unknown. Upload a file first, or type column names exactly as they appear in the file.</p>'}
      </div>
      <div class="rb-section"><h4>When it finds something</h4>
        <div class="two-col">
          <label class="field-col" for="rbSev"><b>Level</b><select id="rbSev" data-rd="severity">${[['blocker', 'Blocker: must be fixed'], ['review', 'Review: someone should look'], ['info', 'Info: just a note']].map(([v, l]) => `<option value="${v}" ${d.severity === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field-col" for="rbStage"><b>Step of the pay cycle</b><select id="rbStage" data-rd="stage">${E.STAGES.map((s) => `<option value="${s.id}" ${d.stage === s.id ? 'selected' : ''}>${esc(s.title)}${PRE.includes(s.id) ? ' (before release)' : ' (after payday)'}</option>`).join('')}</select></label>
          <label class="field-col" for="rbOwner"><b>Owner</b><select id="rbOwner" data-rd="owner">${OWNERS.map((o) => `<option ${d.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
          <label class="field-col" for="rbAmt"><span><b>Dollar impact</b> <span class="muted">optional</span></span><span class="rb-amt">${fsel('id="rbAmt" data-rd="amountField"', d.amountField, 'None')}<select data-rd="amountKind" aria-label="Counts as" ${d.amountField ? '' : 'disabled'}>${AMOUNT_KINDS.map(([v, l]) => `<option value="${v}" ${d.amountKind === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></span></label>
        </div>
        ${d.severity === 'blocker' && PRE.includes(d.stage) ? '<p class="notice warn" style="margin:0">Blockers in this step stop payroll release until someone approves or dismisses them.</p>' : ''}
        <label class="field-col" for="rbTitle"><span><b>Title in the review queue</b> <span class="muted">optional · use {column} to include a value</span></span><input class="text" id="rbTitle" data-rd="title" value="${esc(d.title)}" placeholder="${esc(d.name || 'Uses the rule name')}" autocomplete="off"></label>
        <label class="field-col" for="rbAction"><span><b>Suggested fix</b> <span class="muted">optional</span></span><textarea class="text" id="rbAction" data-rd="action" placeholder="What the owner should do">${esc(d.action)}</textarea></label>
      </div>
      <div class="rb-preview" id="rbPreview" aria-live="polite"></div>`;
  }
  function draftProblem(d, saving) {
    if (saving && !d.name.trim()) return 'Give the rule a name.';
    const conds = d.conds.filter((c) => c.field || String(c.value || '').trim());
    if (!conds.length) return 'Add at least one condition: choose a column and a test.';
    const bad = conds.find((c) => !c.field || (!NO_VALUE.has(c.op) && String(c.value || '').trim() === ''));
    if (bad) return bad.field ? `Give a ${bad.cmp === 'field' ? 'column' : 'value'} for “${fieldLabel(bad.field)} ${OP_WORD[bad.op]}”.` : 'Choose a column for each condition.';
    if (d.scope === 'employee' && !empField(sourceFields(d.source))) return 'This source has no employee ID column, so it can only check each row.';
    return '';
  }
  let previewTimer = null;
  function refreshPreview(delay) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const el = $('#rbPreview');
      const d = state.ruleDraft;
      if (!el || !d) return;
      const def = SRC[d.source];
      const problem = draftProblem(d, false);
      if (problem) { el.innerHTML = `<span class="muted">${esc(problem)}</span>`; return; }
      if (!sourceRows(d.source).length) { el.innerHTML = `<span class="muted">${esc(def.title)} has no file loaded yet. The rule will run as soon as one arrives.</span>`; return; }
      const hits = ruleMatches(d);
      const fields = sourceFields(d.source);
      const cols = Array.from(new Set([empField(fields), d.scope === 'employee' ? 'row_count' : DATE_KEYS.find((k) => fields.includes(k))].concat(activeConds(d).flatMap((c) => [c.field, c.cmp === 'field' ? c.value : null]), [d.amountField]).filter(Boolean))).slice(0, 6);
      el.innerHTML = `<b>${hits.length ? `Finds ${plural(hits.length, 'match', 'matches')} in this pay cycle` : 'Finds nothing in this pay cycle'}</b>${hits.length > MAX_RULE_HITS ? ` <span class="muted">· the review queue shows the first ${MAX_RULE_HITS}</span>` : ''}
        ${hits.length ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(fieldLabel(c))}</th>`).join('')}</tr></thead><tbody>${hits.slice(0, 5).map(({ row }) => `<tr>${cols.map((c) => `<td>${esc(row[c] === undefined ? '' : row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${hits.length > 5 ? `<span class="muted" style="font-size:var(--t-xs)">and ${hits.length - 5} more</span>` : ''}` : ''}`;
    }, delay || 0);
  }
  function rerenderBuilder(focusSel) {
    const body = $('#rbBody');
    if (!body) return;
    body.innerHTML = builderBody();
    refreshPreview();
    if (focusSel) { const f = body.querySelector(focusSel); if (f) f.focus(); }
  }
  function onDraftField(el, structural) {
    const d = state.ruleDraft;
    if (!d) return;
    const k = el.dataset.rd;
    d[k] = el.value;
    if (k === 'source') {
      d.stage = isCustomSource(d.source) ? SRC[d.source].custom.stage : SOURCE_STAGE[d.source] || d.stage;
      if (isCustomSource(d.source)) d.owner = SRC[d.source].custom.owner;
      if (d.scope === 'employee' && !empField(sourceFields(d.source))) d.scope = 'row';
    }
    if (structural || ['source', 'scope', 'severity', 'stage', 'amountField'].includes(k)) rerenderBuilder(`[data-rd="${k}"]`);
    else refreshPreview(k === 'name' || k === 'title' || k === 'action' ? 250 : 0);
  }
  function onDraftCond(el) {
    const d = state.ruleDraft;
    if (!d) return;
    const c = d.conds[Number(el.dataset.i)];
    if (!c) return;
    const k = el.dataset.rc;
    const before = { op: c.op, cmp: c.cmp };
    c[k] = el.value;
    if (k === 'cmp') c.value = '';
    if (k === 'op' && NO_VALUE.has(c.op)) c.value = '';
    if (k === 'cmp' || (k === 'op' && NO_VALUE.has(before.op) !== NO_VALUE.has(c.op))) rerenderBuilder(`[data-rc="${k}"][data-i="${el.dataset.i}"]`);
    else refreshPreview(k === 'value' && el.tagName === 'INPUT' ? 200 : 0);
  }
  function saveRule() {
    if (!allow('rules')) { closeModal(); return; }
    const d = state.ruleDraft;
    const err = $('#rbErr');
    const problem = draftProblem(d, true);
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    const clean = {
      name: d.name.trim(), source: d.source, scope: d.scope === 'employee' ? 'employee' : 'row', match: d.match === 'any' ? 'any' : 'all',
      conds: d.conds.filter((c) => c.field).map((c) => ({ field: c.field, op: c.op, cmp: c.cmp === 'field' ? 'field' : 'value', value: NO_VALUE.has(c.op) ? '' : String(c.value).trim() })),
      severity: d.severity, stage: d.stage, owner: d.owner, title: d.title.trim(), amountField: d.amountField, amountKind: d.amountKind, action: d.action.trim(),
    };
    let rule = d.id && store.customRules.find((x) => x.id === d.id);
    const hits = ruleMatches(Object.assign({}, clean)).length;
    if (rule) {
      Object.assign(rule, clean, { updated: nowIso(), updatedBy: store.user });
      log('Rule changed', `${rule.id} ${rule.name}: ${ruleSummary(rule)} · ${SEV_LABEL[rule.severity].toLowerCase()} · finds ${hits}`);
    } else {
      const n = store.customRules.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0) + 1;
      rule = Object.assign({ id: `C${n}`, enabled: true, created: nowIso(), by: store.user }, clean);
      store.customRules.push(rule);
      log('Rule created', `${rule.id} ${rule.name}: ${ruleSummary(rule)} · ${SEV_LABEL[rule.severity].toLowerCase()} · finds ${hits}`);
    }
    state.ruleDraft = null;
    closeModal();
    recompute();
    renderAll();
    toast(`${rule.name} saved · finds ${plural(hits, 'match', 'matches')} in this pay cycle`);
  }
  function toggleRule(id, on) {
    if (!allow('rules')) { renderRules(); return; }
    const rule = store.customRules.find((x) => x.id === id);
    if (!rule) return;
    rule.enabled = on;
    log(on ? 'Rule turned on' : 'Rule turned off', `${rule.id} ${rule.name}`);
    recompute();
    renderAll();
    toast(`${rule.name} ${on ? 'on' : 'off'}`);
  }
  function deleteRuleModal(id, opener) {
    const rule = store.customRules.find((x) => x.id === id);
    if (!rule) return;
    openModal(`<div class="mh"><h2 id="modalTitle">Delete ${esc(rule.name)}?</h2></div>
      <div class="mb"><p>The rule stops running and its items leave the review queue. Notes and statuses already recorded stay in the activity log. To pause it instead, turn it off.</p></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="rule-delete-confirm" data-id="${esc(id)}">Delete rule</button></div>`, opener);
  }
  function deleteRule(id) {
    if (!allow('rules')) { closeModal(); return; }
    const rule = store.customRules.find((x) => x.id === id);
    if (!rule) { closeModal(); return; }
    store.customRules = store.customRules.filter((x) => x.id !== id);
    log('Rule deleted', `${rule.id} ${rule.name}`);
    if (state.filters.check === id) state.filters.check = null;
    closeModal();
    recompute();
    renderAll();
    toast(`${rule.name} deleted`);
  }
  function customRulesHtml() {
    const ed = can('rules');
    const rules = store.customRules || [];
    const counts = {};
    state.result.exceptions.forEach((x) => { counts[x.check] = (counts[x.check] || 0) + 1; });
    return `<div class="group-title" style="margin-top:0"><h3>Your rules</h3><span class="muted">Checks your team adds. They run on every import and send what they find to the review queue.</span>${ed ? '<span class="spacer"></span><button class="btn small primary" type="button" data-action="rule-new">New rule</button>' : ''}</div>
      ${rules.length ? `<div class="table-wrap"><table class="my-rules">
        <thead><tr><th>Rule</th><th>What it checks</th><th class="n">Found</th><th>Level</th><th>Owner</th><th>On</th><th></th></tr></thead>
        <tbody>${rules.map((rule) => {
          const live = rule.enabled && SRC[rule.source];
          return `<tr>
          <td><b>${esc(rule.name)}</b><br><span class="muted mono" style="font-size:var(--t-xs)">${esc(rule.id)} · ${esc(STAGE_TITLE[rule.stage])}</span></td>
          <td class="wrap">${esc(ruleSummary(rule))}${SRC[rule.source] ? '' : ' <span class="pill review">Source removed</span>'}</td>
          <td class="n">${!live ? '<span class="muted">—</span>' : counts[rule.id] ? `<button class="linkish" type="button" data-action="check" data-check="${esc(rule.id)}">${counts[rule.id]}</button>` : '0'}</td>
          <td><span class="pill ${rule.severity}">${SEV_LABEL[rule.severity]}</span></td>
          <td>${esc(rule.owner)}</td>
          <td><input type="checkbox" class="cb" data-rule-on="${esc(rule.id)}" ${rule.enabled ? 'checked' : ''} ${ed && SRC[rule.source] ? '' : 'disabled'} aria-label="${esc(rule.name)} on"></td>
          <td style="text-align:right;white-space:nowrap">${ed ? `<button class="btn small" type="button" data-action="rule-edit" data-id="${esc(rule.id)}">Edit</button> <button class="linkish" type="button" data-action="rule-delete" data-id="${esc(rule.id)}">Delete</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`
      : `<section class="card"><div class="card-body" style="padding-top:16px;display:grid;gap:10px">
          <p style="font-size:var(--t-sm)">No rules of your own yet. Start from a template or build one on any data source, including ones you add.</p>
          ${ed ? `<div class="tpl-row">${RULE_TEMPLATES.map((t, k) => `<button class="chip-btn" type="button" data-action="rule-new" data-t="${k}">${esc(t.name)}</button>`).join('')}</div>` : ''}
        </div></section>`}`;
  }

  // ----------------------------------------------------------------------------------
  // Ask AI: a chat panel that answers from this cycle's data. The browser finds the
  // records that match the question (retrieval), hides names, and sends only those.
  // ----------------------------------------------------------------------------------

  const STOP = new Set('a an the and or of to in on for is are was were be been with by at from this that these those it its as what which who whom how why when where do does did can could should would will i me my we our you your they them their there here any all some much many more most less than then into about over under per vs show tell give list find me please'.split(' '));
  const SYNONYMS = {
    owed: ['underpaid', 'owed'], underpaid: ['underpaid', 'owed'], short: ['underpaid', 'short'], overpaid: ['overpaid'], overtime: ['overtime', 'ot', 'premium'],
    ot: ['overtime', 'ot'], sunday: ['sunday', 'premium'], sick: ['sick'], vacation: ['vacation', 'vac', 'pto'], pto: ['pto', 'vacation', 'vac', 'sick'],
    deposit: ['deposit', 'ach', 'bank'], deposits: ['deposit', 'ach', 'bank'], bank: ['bank', 'ach', 'deposit'], ledger: ['ledger', 'gl', 'journal', 'account'],
    gl: ['gl', 'ledger', 'journal'], tax: ['tax', 'withholding', 'remit'], taxes: ['tax', 'withholding', 'remit'], release: ['blocker', 'release'],
    blocking: ['blocker'], blocked: ['blocker'], blockers: ['blocker'], stopping: ['blocker'], punch: ['punch', 'check-in', 'check-out', 'meal'],
    punches: ['punch', 'meal', 'check-out'], lunch: ['meal', 'lunch'], policy: ['policy', 'handbook', 'agreement'], handbook: ['handbook', 'policy'],
    union: ['union', 'agreement', 'cba'], repeat: ['repeat', 'recurring'], recurring: ['recurring', 'repeat'], late: ['late', 'cutoff'],
    rate: ['rate', 'hourly_rate'], hire: ['hire', 'hire_date'], fired: ['termination', 'term_date'], terminated: ['termination', 'term_date'],
  };
  const KIND_LABEL = { summary: 'Cycle summary', exception: 'Exception', employee: 'Employee', policy: 'Policy', check: 'Check', reconciliation: 'Bank and ledger', repeat: 'Repeat issue', row: 'Data row' };
  const tokenize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_\- ]/g, ' ').split(/\s+/).map((w) => w.replace(/^-+|-+$/g, '')).filter((w) => w && !STOP.has(w));

  function ragChunks() {
    const r = state.result, rd = readiness(), oi = openImpact(), p = r.period;
    const chunks = [];
    const push = (kind, label, text, nav, extra) => chunks.push(Object.assign({ kind, label, text, nav }, extra || {}));
    push('summary', `Pay cycle ${cycleId()}`, `Pay cycle ${cycleId()}, ${p.start} to ${p.end}, pay date ${p.payDate || 'unknown'}. Status: ${STATE_WORD[rd.state]}${rd.hold ? ` (on hold: ${rd.hold.reason})` : ''}. ${rd.preOpen.length} of ${rd.pre.length} pre-release blockers open; ${rd.postOpen.length} funding and GL blockers open. Gross pay ${F.money(r.regTotals.gross)}, net pay ${F.money(r.regTotals.net)}, employer taxes ${F.money(r.regTotals.erTax)}, ${r.totals.onRegister} employees on the register, ${r.totals.census} in the census. Open dollar impact: ${KINDS.map((k) => `${k.label.toLowerCase()} ${F.money(oi.amount[k.kind])}`).join('; ')}. ${r.exceptions.filter(isOpen).length} of ${r.exceptions.length} exceptions open.`, { type: 'page', page: 'overview' }, { always: true });
    r.exceptions.forEach((x) => push('exception', `${x.check} · ${x.title}${x.empId ? ` · ${x.empName}` : ''}`,
      `Exception ${x.id} (${x.check} ${CHECK_OF[x.check].title}), ${SEV_LABEL[x.severity]}, status ${STATUS_LABEL[statusOf(x)]}, step ${STAGE_OF[x.stage].title}. ${x.title}. ${x.detail} ${x.empId ? `Employee ${x.empId} ${x.empName}${x.location ? ', ' + x.location : ''}.` : 'Whole cycle.'} Owner ${ownerOf(x)}.${x.impact ? ` Dollar impact ${F.money(x.impact.amount)} ${KIND_WORD[x.impact.kind]}.` : ''}${x.action ? ` Suggested fix: ${x.action}` : ''}${lastNote(x) ? ` Latest note: ${lastNote(x)}` : ''}`,
      { type: 'ex', key: x.key }, { empId: x.empId, check: x.check, open: isOpen(x), sev: x.severity, money: !!x.impact }));
    r.employees.forEach((e) => {
      const open = e.exceptions.filter((x) => x.severity !== 'info' && isOpen(x));
      const R = e.register;
      push('employee', `${e.name} (${e.id})`, `Employee ${e.id} ${e.name}: ${e.title || 'no job title'}, ${e.location || 'no location'}${e.cc ? ' ' + e.cc : ''}, ${e.cls ? e.cls.label : 'not in payroll'}. WFM hours ${E.util.r2(e.wfmWorked + e.wfmPto)}${R ? `; register gross ${F.money(E.util.num(R.gross_pay))}, net ${F.money(E.util.num(R.net_pay))}` : '; not on the register'}${e.expectedGross !== null && e.expectedGross !== undefined ? `; validated gross ${F.money(e.expectedGross)}` : ''}. ${open.length ? `Open items: ${open.map((x) => `${x.check} ${x.title}`).join('; ')}.` : 'No open items.'}`,
        { type: 'emp', id: e.id }, { empId: e.id });
    });
    Object.values(allClauses()).forEach((c) => push('policy', `${c.id} ${c.title}`, `Policy ${c.id} ${c.title} (${c.doc}): ${c.text}`, null));
    r.checks.forEach((c) => push('check', `${c.id} ${c.title}`, `Check ${c.id} ${c.title}${c.custom ? ' (a rule your team added)' : ''}: ${c.rule} ${c.ran ? `Found ${c.count}.` : 'Not run: no data.'}`, { type: 'check', id: c.id }, { check: c.id }));
    threeWayRows().filter((row) => !row.sub).forEach((row) => push('reconciliation', `Bank and ledger: ${row.item}`, `Bank and ledger match for ${row.item}: payroll register ${F.money(row.payroll)}${row.bank !== null && row.bank !== undefined ? `, bank ${F.money(row.bank)}` : ''}${row.gl !== null && row.gl !== undefined ? `, general ledger ${F.money(row.gl)}` : ''}. ${row.break ? `Off by ${F.signedMoney(row.break)}.` : 'Matches.'}`, { type: 'page', page: 'threeway' }));
    fixClusters(state.fixThreshold || store.policy.fixThreshold).recurring.forEach((c) => push('repeat', `Repeat issue: ${c.label}`, `Repeat issue: ${c.label}${c.dim ? ` at ${c.dim}` : ''}, seen in ${c.periods} of ${c.perPeriod.length} pay periods, ${c.occurrences} times, ${plural(c.people.size, 'person', 'people')}, usual owner ${c.owner}.`, { type: 'page', page: 'fixflow' }));
    const RAG_PICK = { census: PICK.census, schedules: ['emp_id'].concat(PICK.sched), time: ['emp_id'].concat(PICK.time, ['location']), register: PICK.reg.concat(['fed_wh', 'state_wh', 'k401_ee', 'medical_ee']), bank: PICK.bank, gl: PICK.gl };
    ruleSources().forEach((s) => sourceRows(s.key).forEach((row, i) => {
      const keys = RAG_PICK[s.key] || Object.keys(row).filter((k) => !SENSITIVE_RE.test(k)).slice(0, 16);
      const ef = empField(Object.keys(row));
      const id = ef ? String(row[ef] || '').trim() : '';
      push('row', `${s.title} · row ${i + 1}${id ? ` · ${id}` : ''}`, `${s.title} row: ${Object.entries(pickRow(row, keys)).map(([k, v]) => `${k} ${v}`).join(', ')}`,
        id && state.result.empById[id] ? { type: 'emp', id } : { type: 'page', page: 'sources' }, { empId: id, source: s.key });
    }));
    return chunks;
  }

  // Keyword retrieval with a few payroll-aware boosts: people and check IDs named in the question,
  // open blockers for release questions, policy text for policy questions, priced items for money.
  function retrieve(question, k) {
    const chunks = ragChunks();
    const ql = question.toLowerCase();
    const terms = new Set(tokenize(question).flatMap((w) => SYNONYMS[w] || [w]));
    const people = new Set(state.result.employees.filter((e) => {
      if (ql.includes(e.id.toLowerCase())) return true;
      const n = String(e.name || '').toLowerCase();
      return n && (ql.includes(n) || n.split(' ').some((part) => part.length > 3 && new RegExp(`\\b${part.replace(/[^a-z]/g, '')}\\b`).test(ql)));
    }).map((e) => e.id));
    const checks = new Set((question.match(/\b[TRPFGCD]\d{1,2}\b/gi) || []).map((s) => s.toUpperCase()));
    const docs = chunks.map((c) => tokenize(c.text));
    const df = {};
    docs.forEach((toks) => new Set(toks).forEach((t) => { df[t] = (df[t] || 0) + 1; }));
    const N = chunks.length;
    const wantsRelease = /release|block|stop|hold|ready|payday/.test(ql);
    const wantsPolicy = /policy|handbook|agreement|union|allowed|entitled|clause|rule says|supposed to/.test(ql);
    const wantsMoney = /owe|owed|underpaid|overpaid|money|dollar|\$|cost|impact|how much/.test(ql);
    const scored = chunks.map((c, i) => {
      if (c.always) return { c, s: 0 };
      const tf = {};
      docs[i].forEach((t) => { tf[t] = (tf[t] || 0) + 1; });
      let s = 0;
      terms.forEach((t) => { if (tf[t]) s += Math.log(1 + N / df[t]) * (tf[t] / (tf[t] + 1.2)); });
      if (c.empId && people.has(c.empId)) s += c.kind === 'row' ? 3 : 6;
      if (c.check && checks.has(c.check)) s += 5;
      if (c.kind === 'exception' && c.open) s += 0.5;
      if (wantsRelease && c.kind === 'exception' && c.open && c.sev === 'blocker') s += 2.5;
      if (wantsPolicy && c.kind === 'policy') s += 1.5;
      if (wantsMoney && c.money && c.open) s += 1.5;
      if (c.kind === 'row') s *= 0.75;
      return { c, s };
    }).filter((x) => x.s > 0.4).sort((a, b) => b.s - a.s);
    return [chunks.find((c) => c.always)].concat(scored.slice(0, k || 14).map((x) => x.c));
  }

  function chatPayload(question, refs) {
    const m = masker();
    const hist = [];
    const msgs = state.chat.msgs;
    for (let i = msgs.length - 2; i >= 0 && hist.length < 2; i--) {
      if (msgs[i].role === 'user' && msgs[i + 1] && msgs[i + 1].answer) hist.unshift({ question: m.text(msgs[i].text), answer: msgs[i + 1].answer });
    }
    return {
      company: 'Retail apparel employer, NY and NJ stores (synthetic demo data)',
      question: m.text(question),
      earlier: hist,
      records: refs.map((c, i) => ({ ref: `R${i + 1}`, type: KIND_LABEL[c.kind], text: m.text(c.text).slice(0, 700) })),
    };
  }

  const chatAiOn = () => !!(state.ai && state.ai.available && store.policy.aiChat && can('ai'));
  async function askChat(question) {
    question = String(question || '').trim();
    if (!question || state.chat.busy) return;
    const refs = retrieve(question, 14);
    const m = masker();
    const msgRefs = refs.map((c, i) => ({ ref: `R${i + 1}`, kind: c.kind, label: c.label, text: c.text, nav: c.nav }));
    state.chat.msgs.push({ role: 'user', text: question, at: nowIso() });
    state.chat.draft = '';
    if (!chatAiOn()) {
      const why = !store.policy.aiChat ? 'AI chat is turned off by a payroll admin.' : !can('ai') ? `Your role (${roleLabel(me())}) can’t use the AI.` : 'The AI service isn’t connected on this deployment.';
      state.chat.msgs.push({ role: 'ai', local: true, refs: msgRefs, why });
      renderChat();
      return;
    }
    state.chat.busy = true;
    renderChat();
    try {
      const j = await callAi('chat', chatPayload(question, refs));
      const data = j.data || {};
      state.chat.msgs.push({ role: 'ai', answer: String(data.answer || ''), follow: (data.follow_ups || []).slice(0, 3).map(String), refs: msgRefs, model: j.model, at: nowIso() });
      log('Asked the AI', `“${m.text(question).slice(0, 160)}” · answered from ${plural(refs.length, 'record')}`);
    } catch (e) {
      state.chat.msgs.push({ role: 'ai', local: true, refs: msgRefs, why: e.message });
    }
    state.chat.busy = false;
    renderChat();
  }

  const CHAT_SUGGEST = ['What’s stopping payroll from being released?', 'Who is owed money this cycle, and how much?', 'Summarize the bank and ledger differences', 'Which store keeps missing lunch check-ins?', 'What does the handbook say about sick time?'];
  function chatShow(s) {
    const m = masker();
    return can('unmask') && state.chatNames !== false ? m.unmask(s) : m.text(s);
  }
  function chatAnswerHtml(msg, idx) {
    if (msg.local) {
      const top = msg.refs.filter((x) => x.kind !== 'summary').slice(0, 6);
      return `<div class="msg ai local"><p class="msg-note">${esc(msg.why)} The closest records in your data:</p>
        ${top.length ? `<ol class="msg-refs">${top.map((x) => `<li><button type="button" class="linkish" data-action="chat-ref" data-m="${idx}" data-ref="${x.ref}">${esc(chatShow(x.label))}</button><span>${esc(KIND_LABEL[x.kind])}</span></li>`).join('')}</ol>` : '<p class="muted">Nothing matched. Try other words, a person’s name or a check ID like P4.</p>'}</div>`;
    }
    const lines = esc(chatShow(msg.answer)).split(/\n/).map((l) => l.trim()).filter(Boolean);
    let html = '', list = false;
    lines.forEach((l) => {
      const li = /^([-•*]|\d+[.)])\s+/.test(l);
      if (li && !list) { html += '<ul>'; list = true; }
      if (!li && list) { html += '</ul>'; list = false; }
      html += li ? `<li>${l.replace(/^([-•*]|\d+[.)])\s+/, '')}</li>` : `<p>${l}</p>`;
    });
    if (list) html += '</ul>';
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[(R\d+)\]/g, (mm, ref) => (msg.refs.some((x) => x.ref === ref) ? `<button type="button" class="cite" data-action="chat-ref" data-m="${idx}" data-ref="${ref}">${ref}</button>` : mm));
    const cited = msg.refs.filter((x) => msg.answer.includes(`[${x.ref}]`));
    return `<div class="msg ai">${html}
      ${cited.length ? `<details class="msg-src" id="msgsrc-${idx}"><summary>${plural(cited.length, 'source')}</summary><ol>${cited.map((x) => `<li id="msgref-${idx}-${x.ref}"><button type="button" class="linkish" data-action="chat-ref" data-m="${idx}" data-ref="${x.ref}">${x.ref} · ${esc(chatShow(x.label))}</button><span>${esc(chatShow(x.text).slice(0, 220))}</span></li>`).join('')}</ol></details>` : ''}
      ${msg.follow && msg.follow.length ? `<div class="msg-follow">${msg.follow.map((f) => `<button class="chip-btn" type="button" data-action="chat-ask" data-q="${esc(chatShow(f))}">${esc(chatShow(f))}</button>`).join('')}</div>` : ''}
      <span class="msg-meta">${esc(msg.model || 'AI')} · from ${plural(msg.refs.length, 'record')} in your data, names hidden</span></div>`;
  }
  function renderChat() {
    const el = $('#chat');
    if (!el) return;
    const open = !!state.chat.open;
    el.hidden = !open;
    $('#shell').classList.toggle('chat-open', open);
    const tb = document.querySelector('[data-action="chat-toggle"]');
    if (tb) tb.setAttribute('aria-expanded', open);
    if (!open) return;
    const msgs = state.chat.msgs;
    const ai = chatAiOn();
    const suggest = CHAT_SUGGEST.concat(isSampleWorkspace() ? ['Show everything for Diego Santos'] : []);
    el.innerHTML = `
      <header class="chat-head"><span class="chat-icon" aria-hidden="true">${ICON.chat}</span><div><h2 id="chatTitle">Ask about this pay cycle</h2>
        <small>${ai ? `Answers from your data sources, written by ${esc(state.ai.model)}. Names are hidden from the AI.` : 'Searches your data sources. The AI isn’t available here, so you get the closest records.'}</small></div>
        <button class="btn small chat-x" type="button" data-action="chat-close" aria-label="Close the chat">${ICON.close}</button></header>
      <div class="chat-tools">${can('unmask') ? `<label class="field"><input type="checkbox" class="cb" id="chatNames" ${state.chatNames !== false ? 'checked' : ''}> Show real names</label>` : '<span class="muted">Names stay hidden for your role</span>'}<span class="spacer"></span>${msgs.length ? '<button class="linkish" type="button" data-action="chat-clear">Clear</button>' : ''}</div>
      <div class="chat-log" id="chatLog">${msgs.length ? msgs.map((msg, i) => (msg.role === 'user' ? `<div class="msg user">${esc(msg.text)}</div>` : chatAnswerHtml(msg, i))).join('')
        : `<div class="chat-empty"><p>Ask anything about ${esc(cycleId())}: who is owed money, why an item was flagged, what a policy says, or what is in any of your data sources.</p><div class="msg-follow">${suggest.map((q) => `<button class="chip-btn" type="button" data-action="chat-ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`}
        ${state.chat.busy ? '<div class="msg ai busy" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> Reading your data…</div>' : ''}</div>
      <form class="chat-form" id="chatForm"><textarea id="chatInput" rows="2" aria-label="Your question" placeholder="Ask about pay, people, files or policy" ${state.chat.busy ? 'disabled' : ''}>${esc(state.chat.draft || '')}</textarea><button class="btn primary" type="submit" ${state.chat.busy ? 'disabled' : ''}>Ask</button></form>`;
    const lg = $('#chatLog');
    if (lg) lg.scrollTop = lg.scrollHeight;
  }
  function chatRef(el) {
    const msg = state.chat.msgs[Number(el.dataset.m)];
    const x = msg && msg.refs.find((y) => y.ref === el.dataset.ref);
    if (!x) return;
    const narrow = !window.matchMedia('(min-width: 1181px)').matches;
    if (!x.nav) {
      const d = $(`#msgsrc-${el.dataset.m}`);
      if (d) { d.open = true; const li = $(`#msgref-${el.dataset.m}-${x.ref}`); if (li) { li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); li.scrollIntoView({ block: 'nearest' }); } }
      return;
    }
    if (narrow) { state.chat.open = false; renderChat(); }
    if (x.nav.type === 'ex' && exByKey(x.nav.key)) {
      state.filters = { status: 'all', sev: { blocker: true, review: true, info: true }, stage: '', check: null, kind: null, owner: '', q: '' };
      state.detail = x.nav.key;
      if (state.page === 'exceptions') renderExceptions(); else go('exceptions');
    } else if (x.nav.type === 'emp' && state.result.empById[x.nav.id]) openDrawer(x.nav.id, el);
    else if (x.nav.type === 'check' && CHECK_OF[x.nav.id]) filterExceptions({ check: x.nav.id, status: 'all' });
    else if (x.nav.type === 'page') go(x.nav.page);
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

  function openModal(html, opener, wide) {
    state.modalOpener = opener || document.activeElement;
    const m = $('#modal');
    m.classList.toggle('wide', !!wide);
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
    if (rd.state === 'hold') {
      openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Release is on hold</h2></div>
        <div class="mb"><p>${esc(rd.hold.by)} put release on hold ${esc(stamp(rd.hold.at))}: “${esc(rd.hold.reason)}”.</p><p>A payroll admin lifts the hold in the Admin console, under Policies.</p></div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Close</button>${can('admin') ? '<button class="btn primary" type="button" data-action="admin-tab" data-tab="policies">Open release controls</button>' : ''}</div>`, opener);
      return;
    }
    if (rd.state === 'blocked') {
      openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Release is blocked</h2></div>
        <div class="mb"><p>${plural(rd.preOpen.length, 'pre-release blocker')} ${rd.preOpen.length === 1 ? 'is' : 'are'} still open. Approve or dismiss each one in the review queue, and release opens.</p>
          <ul class="history">${rd.preOpen.slice(0, 8).map((x) => `<li><span class="pill blocker" style="grid-column:1/-1;justify-self:start">${esc(x.check)} · ${esc(ownerOf(x))}</span><span style="grid-column:1/-1">${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</span></li>`).join('')}</ul>
          ${rd.preOpen.length > 8 ? `<p class="muted">and ${rd.preOpen.length - 8} more</p>` : ''}</div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Close</button><button class="btn primary" type="button" data-action="go-blockers">Work the blockers</button></div>`, opener);
      return;
    }
    if (!can('release')) {
      openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Ready for an approver</h2></div>
        <div class="mb"><p>Every pre-release blocker is cleared. Your role (${esc(roleLabel(me()))}) can’t release payroll; a payroll approver or admin releases this batch.</p></div>
        <div class="mf"><button class="btn primary" type="button" data-action="close-modal">Close</button></div>`, opener);
      return;
    }
    const mine = sodConflicts();
    if (mine.length) {
      openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">A different person must release</h2></div>
        <div class="mb"><p>You dismissed ${plural(mine.length, 'pre-release blocker')}, so someone else has to release this batch. A payroll admin set this rule in the Admin console.</p>
          <ul class="history">${mine.map((x) => `<li style="grid-template-columns:1fr"><span><b>${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</b><div class="note">${esc(lastNote(x) || 'No reason recorded')}</div></span></li>`).join('')}</ul></div>
        <div class="mf"><button class="btn primary" type="button" data-action="close-modal">Close</button></div>`, opener);
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
        <p>${rd.pre.length ? `All ${plural(rd.pre.length, 'pre-release blocker')} are cleared: ${rd.approved.length} approved, ${rd.dismissed.length} dismissed with a reason.` : 'Every time, roster and register check passed.'}</p>
        ${rd.dismissed.length ? `<div><span class="eyebrow">Dismissed with a reason</span><ul class="history" style="margin-top:6px">${rd.dismissed.map((x) => `<li style="grid-template-columns:1fr"><span><b>${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</b>${x.impact ? ` <span class="mono">${F.money(x.impact.amount)}</span>` : ''}<div class="note">${esc(lastNote(x) || 'No reason recorded')}</div></span></li>`).join('')}</ul></div>
          <label class="field" style="color:var(--ink)"><input type="checkbox" class="cb" id="relAck"> I reviewed the dismissed blockers and their reasons</label>` : ''}
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
    if (rd.state !== 'ready' || !can('release') || sodConflicts().length) { closeModal(); return; }
    const ack = $('#relAck');
    if (ack && !ack.checked) { const e = $('#relErr'); e.textContent = 'Confirm you reviewed the dismissed blockers.'; e.hidden = false; ack.focus(); return; }
    const note = ($('#relNote').value || '').trim();
    const r = state.result;
    cyc().released = { at: nowIso(), by: store.user, note, gross: r.regTotals.gross, net: r.regTotals.net, people: r.totals.onRegister, approved: rd.approved.length, dismissed: rd.dismissed.map((x) => x.key), postOpen: rd.postOpen.length };
    store.history = store.history || {};
    store.history[cycleId()] = { start: r.period.start, rows: currentFixRows().map((row) => Object.assign({}, row, { key: undefined })) };
    log('Payroll released', `${F.money(r.regTotals.net)} net pay for ${plural(r.totals.onRegister, 'employee')} · ${rd.approved.length} approved, ${rd.dismissed.length} dismissed${note ? ` — “${note}”` : ''}`);
    closeModal();
    afterWorkflow();
    toast(`${cycleId()} released`);
  }

  function releaseInfoModal(opener) {
    const rel = cyc().released;
    if (!rel) return;
    const acc = (rel.dismissed || rel.accepted || []).map(exByKey).filter(Boolean);
    openModal(`<div class="mh"><span class="eyebrow">${esc(cycleId())}</span><h2 id="modalTitle">Release record</h2></div>
      <div class="mb">
        <div class="ev">
          <div><span>Released</span><b>${esc(stamp(rel.at))}</b></div>
          <div><span>Approved by</span><b>${esc(rel.by)}</b></div>
          <div><span>Net pay</span><b>${F.money(rel.net)}</b></div>
          <div><span>Employees</span><b>${esc(rel.people)}</b></div>
        </div>
        ${rel.note ? `<div><span class="eyebrow">Approval note</span><div class="history"><div class="note">${esc(rel.note)}</div></div></div>` : ''}
        <p>${plural(rel.approved ?? rel.resolved ?? 0, 'blocker')} approved and ${plural(acc.length, 'blocker')} dismissed with a reason at release.${rel.postOpen ? ` ${plural(rel.postOpen, 'funding or GL blocker', 'funding and GL blockers')} were open for after settlement.` : ''}</p>
        ${acc.length ? `<ul class="history">${acc.map((x) => `<li style="grid-template-columns:1fr"><span><b>${esc(x.empId ? x.empName + ': ' : '')}${esc(x.title)}</b><div class="note">${esc(lastNote(x) || 'No reason recorded')}</div></span></li>`).join('')}</ul>` : ''}
        ${can('reopen') ? `<label for="reopenNote"><b>Reopen the cycle</b> <span class="muted">(reason required)</span></label>
        <textarea class="text" id="reopenNote" placeholder="Why the release is being reversed"></textarea>
        <p class="form-err" id="reopenErr" hidden></p>` : ''}
      </div>
      <div class="mf">${can('reopen') ? '<button class="btn danger" type="button" data-action="confirm-reopen">Reopen cycle</button>' : ''}<button class="btn primary" type="button" data-action="close-modal">Done</button></div>`, opener);
  }

  function confirmReopen() {
    if (!allow('reopen')) return;
    const note = ($('#reopenNote').value || '').trim();
    if (!note) { const e = $('#reopenErr'); e.textContent = 'Give a reason for reopening.'; e.hidden = false; $('#reopenNote').focus(); return; }
    cyc().released = null;
    log('Cycle reopened', `Release reversed — “${note}”`);
    closeModal();
    afterWorkflow();
    toast(`${cycleId()} reopened`);
  }

  function dismissModal(keys, opener) {
    openModal(`<div class="mh"><h2 id="modalTitle">Dismiss ${plural(keys.length, 'exception')}</h2></div>
      <div class="mb"><p>Dismissed items stop blocking release. The reason is kept with each item and listed in the release brief and the release record.</p>
        <label for="dismissNote"><b>Reason</b></label>
        <textarea class="text" id="dismissNote" autofocus placeholder="e.g. Not an error: the associate was on approved unpaid leave"></textarea>
        <p class="form-err" id="dismissErr" hidden></p></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-dismiss" data-keys="${esc(keys.join('\n'))}">Dismiss</button></div>`, opener);
  }

  function escalateModal(keys, opener) {
    const xs = keys.map(exByKey).filter(Boolean);
    const current = xs.length === 1 ? ownerOf(xs[0]) : '';
    openModal(`<div class="mh"><h2 id="modalTitle">Escalate ${plural(keys.length, 'exception')}</h2></div>
      <div class="mb"><p>Escalated items stay open and keep blocking release until the owner approves or dismisses them.</p>
        <label class="field" for="escOwner" style="color:var(--ink)"><b>Escalate to</b>
          <select id="escOwner">${ownerOptions().map((o) => `<option ${o === current ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
        <label for="escNote"><b>Note</b> <span class="muted">(optional)</span></label>
        <textarea class="text" id="escNote" autofocus placeholder="What the owner needs to check or fix"></textarea></div>
      <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-escalate" data-keys="${esc(keys.join('\n'))}">Escalate</button></div>`, opener);
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

  function rerun() {
    recompute();
    const t = state.result.totals;
    log('Checks re-run', `${t.checksRun} checks · ${t.blockers} blockers, ${t.review} to review${diffText()}`, { by: 'Rollcall' });
    renderAll();
    toast(`Ran ${t.checksRun} checks across ${plural(t.people, 'person', 'people')}${diffText() || ' · nothing changed since the last run'}`);
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
    else if (DATA_ACTIONS.has(a) && !allow('data')) { if (!$('#modal').hidden) closeModal(); }
    else if (EXPORT_ACTIONS.has(a) && !allow('export')) { /* blocked and logged by allow() */ }
    else if ((a === 'reset-rule' || a === 'reset-rules') && !allow('rules')) { /* blocked */ }
    else if ((a === 'reset-workspace' || a === 'confirm-reset' || a === 'restore-pick') && !allow('admin')) { if (!$('#modal').hidden) closeModal(); }
    else if (a === 'cycle-menu') cycleMenu(el);
    else if (a === 'load-sample') loadSampleCycle();
    else if (a === 'new-cycle') openModal(`<div class="mh"><h2 id="modalTitle">Start a new cycle</h2></div>
        <div class="mb"><p>This clears the census, schedules, time records, register, bank activity and GL journal so you can load this cycle’s files. The union agreement, handbook, GL mapping and your rule changes carry over.</p>
        <p>${esc(cycleId())} keeps its statuses, notes${cyc().released ? ', release record' : ''} and activity.</p></div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-new-cycle">Clear and start</button></div>`, el);
    else if (a === 'confirm-new-cycle') { closeModal(); startNewCycle(); }
    else if (a === 'cycle-history') { state.activityScope = 'all'; go('activity'); }
    else if (a === 'rerun') rerun();
    else if (a === 'go-page') go(el.dataset.page);
    else if (a === 'ai-explain') { if (store.policy.aiExplain && allow('ai')) explainWithAi(el.dataset.key); }
    else if (a === 'ai-clusters') { if (store.policy.aiClusters && allow('ai')) clustersWithAi(); }
    else if (a === 'cite') {
      const row = document.getElementById('ev-' + el.dataset.ref);
      if (row) { row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
    }
    else if (a === 'go-import') {
      go('sources');
      setTimeout(() => { const c = $('#importCard'); if (c) { c.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); const b = $('#importFiles'); if (b) b.focus(); } }, 60);
    } else if (a === 'templates') templatesModal(el);
    else if (a === 'dl-template') {
      const k = el.dataset.key, t = targetsFor(k), ex = sampleRows(k)[0] || {};
      download(`${k}_template.csv`, E.toCSV([Object.fromEntries(t.map((c) => [c, ex[c] || '']))], t), 'text/csv');
    } else if (a === 'map-cols') { const it = state.importQueue.find((x) => x.id === el.dataset.id); if (it) mappingModal(it, el); }
    else if (a === 'save-map') {
      const it = state.importQueue.find((x) => x.id === el.dataset.id);
      if (!it) { closeModal(); return; }
      const map = {};
      document.querySelectorAll('#modal [data-map-col]').forEach((sel) => { if (sel.value) map[sel.dataset.mapCol] = sel.value; });
      const miss = KEY_COLS[it.kind].filter((c) => !map[c]);
      if (miss.length) { const e = $('#mapErr'); e.textContent = `Map the required ${miss.length === 1 ? 'field' : 'fields'} first: ${miss.join(', ')}.`; e.hidden = false; return; }
      it.map = map;
      closeModal();
      if (it.autoLoad) loadImports([it]);
      else renderImportQueue();
    } else if (a === 'import-remove') { state.importQueue = state.importQueue.filter((x) => x.id !== el.dataset.id); renderImportQueue(); }
    else if (a === 'import-clear') { state.importQueue = []; renderImportQueue(); }
    else if (a === 'import-load') loadImports(state.importQueue.filter((x) => x.kind !== 'skip'));
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
      const why = changeBlock(x, to);
      if (why) { blocked(`${ACT[to]} ${x.check}${x.empId ? ' ' + x.empId : ''}`, why); return; }
      if (to === 'approved' && x.severity === 'blocker' && store.policy.approveNote && !note) { const e = $('#noteErr'); e.textContent = 'Add a note saying what was fixed or checked before approving a blocker.'; e.hidden = false; $('#noteText').focus(); return; }
      if (to === 'escalated') { escalateModal([x.key], el); return; }
      if (to === 'dismissed' && !note) { const e = $('#noteErr'); e.textContent = 'Add the reason for dismissing this exception in the note first.'; e.hidden = false; $('#noteText').focus(); return; }
      setStatus(x, to, note);
      afterWorkflow();
      toast(`${STATUS_VERB[to]}: ${x.title}`);
    } else if (a === 'add-note') {
      const x = exByKey(state.detail);
      const note = noteValue();
      if (!x) return;
      if (!allow('review')) return;
      if (!note) { const e = $('#noteErr'); e.textContent = 'Write a note first.'; e.hidden = false; $('#noteText').focus(); return; }
      addNote(x, note);
      afterWorkflow();
      toast('Note added');
    } else if (a === 'bulk-status') {
      const to = el.dataset.to;
      const pt = partition(Array.from(state.sel), to);
      if (to === 'approved' && store.policy.approveNote) {
        const needNote = pt.ok.filter((x) => x.severity === 'blocker');
        if (needNote.length) { pt.ok = pt.ok.filter((x) => x.severity !== 'blocker'); pt.skipped += needNote.length; pt.reason = pt.reason || 'Approving a blocker needs a note; approve those one at a time.'; }
      }
      let n = 0;
      pt.ok.forEach((x) => { if (setStatus(x, to, '')) n++; });
      if (pt.skipped) log('Action blocked', `${ACT[to]} ${plural(pt.skipped, 'exception')} · ${pt.reason}`);
      state.sel.clear();
      afterWorkflow();
      toast(`${STATUS_VERB[to]}: ${plural(n, 'exception')}${skippedText(pt)}`);
    } else if (a === 'bulk-dismiss') dismissModal(Array.from(state.sel), el);
    else if (a === 'bulk-escalate') escalateModal(Array.from(state.sel), el);
    else if (a === 'confirm-dismiss') {
      const note = ($('#dismissNote').value || '').trim();
      if (!note) { const e = $('#dismissErr'); e.textContent = 'Give a reason.'; e.hidden = false; $('#dismissNote').focus(); return; }
      let n = 0;
      const pt = partition(el.dataset.keys.split('\n'), 'dismissed');
      pt.ok.forEach((x) => { if (setStatus(x, 'dismissed', note)) n++; });
      if (pt.skipped) log('Action blocked', `Dismiss ${plural(pt.skipped, 'exception')} · ${pt.reason}`);
      state.sel.clear();
      closeModal();
      afterWorkflow();
      toast(`Dismissed: ${plural(n, 'exception')}${skippedText(pt)}`);
    } else if (a === 'confirm-escalate') {
      const owner = $('#escOwner').value;
      const note = ($('#escNote').value || '').trim();
      let n = 0;
      const pt = partition(el.dataset.keys.split('\n'), 'escalated');
      pt.ok.forEach((x) => { setOwner(x, owner); if (setStatus(x, 'escalated', note)) n++; });
      if (pt.skipped) log('Action blocked', `Escalate ${plural(pt.skipped, 'exception')} · ${pt.reason}`);
      state.sel.clear();
      closeModal();
      afterWorkflow();
      toast(`Escalated ${plural(n, 'exception')} to ${owner}${skippedText(pt)}`);
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
    else if (a === 'sync') syncSource(el.dataset.key);
    else if (a === 'sample') { loadSample(el.dataset.key); sourceChanged(SRC[el.dataset.key], `${SRC[el.dataset.key].file} (sample)`); toast(`${SRC[el.dataset.key].title}: using the sample file`); }
    else if (a === 'sample-pdf') loadRegisterPdf(samplePdfBytes(), 'payroll_register.pdf', 'sample');
    else if (a === 'reset-rule') {
      const f = RULE_FIELDS.find((x) => x.key === el.dataset.key);
      delete store.settings[el.dataset.key];
      save();
      renderRules();
      scheduleRerun(`${f.label} reset to policy`);
    } else if (a === 'reset-rules') { store.settings = {}; save(); renderRules(); scheduleRerun('All rules reset to policy'); }
    else if (a === 'theme') { store.theme = el.dataset.theme; save(); applyTheme(); renderSettings(); }
    else if (a === 'cs-new') { if (allow('data')) sourceModal(null, el); }
    else if (a === 'cs-edit') { if (allow('data')) sourceModal(SRC[el.dataset.key], el); }
    else if (a === 'cs-save') saveSource(el);
    else if (a === 'cs-remove') { if (allow('data')) removeSourceModal(el.dataset.key, el); }
    else if (a === 'cs-remove-confirm') removeSource(el.dataset.key);
    else if (a === 'rule-new') { if (allow('rules')) ruleModal(el, el.dataset.t !== undefined ? draftFromTemplate(RULE_TEMPLATES[Number(el.dataset.t)]) : blankDraft()); }
    else if (a === 'rule-edit') { const rule = store.customRules.find((x) => x.id === el.dataset.id); if (rule && allow('rules')) ruleModal(el, Object.assign(blankDraft(), JSON.parse(JSON.stringify(rule)))); }
    else if (a === 'rule-delete') { if (allow('rules')) deleteRuleModal(el.dataset.id, el); }
    else if (a === 'rule-delete-confirm') deleteRule(el.dataset.id);
    else if (a === 'rb-template') { const keep = state.ruleDraft && state.ruleDraft.id; state.ruleDraft = Object.assign(draftFromTemplate(RULE_TEMPLATES[Number(el.dataset.t)]), { id: keep || null }); rerenderBuilder('#rbName'); }
    else if (a === 'rb-cond-add') { state.ruleDraft.conds.push({ field: '', op: 'gt', cmp: 'value', value: '' }); rerenderBuilder(`[data-rc="field"][data-i="${state.ruleDraft.conds.length - 1}"]`); }
    else if (a === 'rb-cond-remove') { state.ruleDraft.conds.splice(Number(el.dataset.i), 1); rerenderBuilder(); }
    else if (a === 'rb-save') saveRule();
    else if (a === 'chat-toggle') { state.chat.open = !state.chat.open; renderChat(); if (state.chat.open) { const f = $('#chatInput'); if (f) f.focus(); } }
    else if (a === 'chat-close') { state.chat.open = false; renderChat(); const b = document.querySelector('[data-action="chat-toggle"]'); if (b) b.focus(); }
    else if (a === 'chat-clear') { state.chat.msgs = []; renderChat(); }
    else if (a === 'chat-ask') askChat(el.dataset.q);
    else if (a === 'chat-ref') chatRef(el);
    else if (a === 'admin-tab') { if (!$('#modal').hidden) closeModal(); state.adminTab = el.dataset.tab; if (state.page === 'admin') renderAdmin(); else go('admin'); }
    else if (a === 'hold-open') { if (allow('admin')) holdModal(el); }
    else if (a === 'hold-confirm') confirmHold();
    else if (a === 'hold-lift') liftHold();
    else if (a === 'sla-escalate') escalatePastSla();
    else if (a === 'team-add') addMember();
    else if (a === 'team-remove') removeMember(el.dataset.id);
    else if (a === 'pin-set') setPin();
    else if (a === 'pin-clear') clearPin();
    else if (a === 'pin-ok') checkPin(el.dataset.id);
    else if (a === 'backup-export') {
      download(`${store.workspace.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'}-backup-${todayIso()}.json`, backupJson(), 'application/json');
      log('Backup exported', `${store.workspace} backup downloaded`);
    }
    else if (a === 'restore-pick') { const f = $('#restoreFile'); if (f) f.click(); }
    else if (a === 'restore-confirm') confirmRestore();
    else if (a === 'reset-workspace') openModal(`<div class="mh"><h2 id="modalTitle">Clear workspace data?</h2></div>
        <div class="mb"><p>This deletes every status, note, reassignment, release record, rule change and activity entry stored in this browser, and reloads the sample cycle. Team, roles, policies, your rules and your data sources are kept. It can’t be undone.</p></div>
        <div class="mf"><button class="btn" type="button" data-action="close-modal">Cancel</button><button class="btn primary" type="button" data-action="confirm-reset">Clear data</button></div>`, el);
    else if (a === 'confirm-reset') {
      const keep = { user: store.user, workspace: store.workspace, theme: store.theme, team: store.team, userId: store.userId, policy: store.policy, customSources: (store.customSources || []).map((d) => Object.assign({}, d)), customRules: store.customRules };
      const by = store.user;
      store = hydrate(Object.assign(freshStore(), keep));
      syncCustomSources();
      try { localStorage.removeItem(FILES_KEY); } catch (e) { /* nothing stored */ }
      SOURCES.forEach((s) => { state.src[s.key] = { mode: 'upload' }; loadSample(s.key); });
      state.detail = null;
      state.sel.clear();
      state.importQueue = [];
      state.result = null;
      recompute();
      log('Workspace cleared', `Statuses, notes, releases, rule changes and activity cleared by ${by}`);
      closeModal();
      renderAll();
      toast('Workspace data cleared');
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('input[type="file"][data-key]') && t.files && t.files[0]) { enqueueFiles([t.files[0]], t.dataset.key); t.value = ''; }
    else if (t.id === 'importFiles' && t.files && t.files.length) { enqueueFiles(Array.from(t.files)); t.value = ''; }
    else if (t.matches('[data-import-kind]')) {
      const it = state.importQueue.find((x) => x.id === t.dataset.importKind);
      if (it && t.value === '__new') { t.value = it.kind || ''; if (allow('data')) sourceModal(null, t, it); }
      else if (it) { it.kind = t.value; it.map = it.type === 'table' && it.kind && it.kind !== 'skip' ? autoMap(it.kind, it.headers) : {}; renderImportQueue(); }
    } else if (t.matches('[data-map-col]')) {
      const id = ($('#modal [data-action="save-map"]') || {}).dataset;
      const it = id && state.importQueue.find((x) => x.id === id.id);
      const cell = document.querySelector(`#modal [data-map-ex="${t.dataset.mapCol}"]`);
      if (it && cell) cell.textContent = firstValue(it, t.value);
    } else if (t.matches('[data-conn-url]')) { store.connectors[t.dataset.connUrl] = { url: t.value.trim() }; save(); }
    else if (t.id === 'ownerSel') { state.filters.owner = t.value; renderQueue(); }
    else if (t.id === 'unmaskToggle') { if (t.checked && !allow('unmask')) { t.checked = false; return; } state.unmask = t.checked; if (state.page === 'exceptions') renderDetail(); else renderPage(); }
    else if (t.id === 'fixThr') { state.fixThreshold = Number(t.value); renderFixflow(); }
    else if (t.id === 'stageSel') { state.filters.stage = t.value; renderQueue(); }
    else if (t.id === 'selAll') { state.listKeys.forEach((k) => { if (t.checked) state.sel.add(k); else state.sel.delete(k); }); renderQueue(); }
    else if (t.id === 'ownerOne') {
      const x = exByKey(t.dataset.key);
      const why = x ? changeBlock(x, null) : '';
      if (why) { blocked(`Reassign ${x.check}`, why); renderDetail(); }
      else if (x && setOwner(x, t.value)) { afterWorkflow(); toast(`Assigned to ${t.value}`); }
    }
    else if (t.id === 'bulkOwner' && t.value) {
      let n = 0;
      const pt = partition(Array.from(state.sel), null);
      pt.ok.forEach((x) => { if (setOwner(x, t.value)) n++; });
      state.sel.clear();
      afterWorkflow();
      toast(`Assigned ${plural(n, 'exception')} to ${t.value}${skippedText(pt)}`);
    } else if (t.id === 'setName') { const v = t.value.trim(); if (v && v !== store.user) { const was = store.user; store.user = v; me().name = v; log('Name changed', `${was} → ${v}`); renderShell(); toast('Name saved'); } }
    else if (t.id === 'setWs') { const v = t.value.trim(); if (v && v !== store.workspace) { store.workspace = v; save(); renderShell(); toast('Company name saved'); } }
    else if (t.matches('select[data-rd]')) onDraftField(t);
    else if (t.matches('select[data-rc]')) onDraftCond(t);
    else if (t.matches('[data-rule-on]')) toggleRule(t.dataset.ruleOn, t.checked);
    else if (t.id === 'chatNames') { state.chatNames = t.checked; renderChat(); }
    else if (t.id === 'setUser') switchUser(t.value, t);
    else if (t.matches('[data-team]')) teamChange(t);
    else if (t.matches('[data-perm]')) permChange(t);
    else if (t.matches('[data-policy]')) policyChange(t);
    else if (t.id === 'restoreFile' && t.files && t.files[0]) { readRestore(t.files[0]); t.value = ''; }
    else if (t.matches('[data-rule]') && (t.type === 'checkbox' || t.tagName === 'SELECT')) onRuleInput(t);
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'exSearch') { state.filters.q = t.value; renderQueue(); }
    else if (t.id === 'peopleSearch') { state.people.q = t.value; renderPeopleTable(); }
    else if (t.id === 'noteText') { const e = $('#noteErr'); if (e) e.hidden = true; }
    else if (t.matches('[data-conn-auth]')) state.auth[t.dataset.connAuth] = t.value;
    else if (t.id === 'setAiCode') state.aiCode = t.value.trim();
    else if (t.matches('input[type="number"][data-rule]')) onRuleInput(t);
    else if (t.matches('input[data-rd], textarea[data-rd]')) onDraftField(t);
    else if (t.matches('input[data-rc]')) onDraftCond(t);
    else if (t.id === 'chatInput') state.chat.draft = t.value;
  });
  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'chatForm') return;
    ev.preventDefault();
    askChat(($('#chatInput') || {}).value);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.id === 'pinIn') { ev.preventDefault(); const b = $('#modal [data-action="pin-ok"]'); if (b) checkPin(b.dataset.id); return; }
    if (ev.key === 'Enter' && ev.target.id === 'tmName') { ev.preventDefault(); addMember(); return; }
    if (ev.key === 'Enter' && !ev.shiftKey && ev.target.id === 'chatInput') { ev.preventDefault(); askChat(ev.target.value); return; }
    if (ev.key === 'Escape' && state.chat.open && $('#modal').hidden && ev.target.closest && ev.target.closest('#chat')) { state.chat.open = false; renderChat(); const b = document.querySelector('[data-action="chat-toggle"]'); if (b) b.focus(); return; }
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
  const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const files = Array.from(e.dataTransfer.files || []);
    const card = e.target.closest && e.target.closest('.source');
    const key = card && card.id.replace('src-', '');
    enqueueFiles(files, key && SRC[key] && files.length === 1 ? key : null);
  });

  // ----------------------------------------------------------------------------------
  // Boot
  // ----------------------------------------------------------------------------------

  function boot() {
    SAMPLE = window.NORTHLOOM_SAMPLE || SAMPLE;
    syncCustomSources();
    restoreSources();
    recompute();
    if (!store.audit.some((a) => a.cycle === cycleId())) log('Checks run', `${state.result.totals.checksRun} checks · ${state.result.totals.blockers} blockers, ${state.result.totals.review} to review`, { by: 'Rollcall' });
    route();
    checkAi();
  }
  if (window.NORTHLOOM_SAMPLE_READY) {
    window.NORTHLOOM_SAMPLE_READY.then(boot, (e) => { $('#page').textContent = 'The sample cycle could not be loaded: ' + e.message; });
  } else boot();
})();
