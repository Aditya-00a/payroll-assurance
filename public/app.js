/* Payroll Assurance — demo UI. Loads the sample cycle, runs the engine, renders the work queue. */
(function () {
  'use strict';

  const E = window.PayrollEngine;
  const F = E.fmt;
  let SAMPLE = window.NORTHLOOM_SAMPLE || { files: {} };
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longDate = (s) => (s ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}, ${s.slice(0, 4)}` : '');
  const shortDate = (s) => (s ? `${MONTHS[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}` : '');
  const plural = (n, w, p) => `${n} ${n === 1 ? w : p || w + 's'}`;

  const SOURCES = [
    { key: 'census', group: 'records', kind: 'csv', file: 'census.csv', title: 'Employee census', sys: 'Payroll system · system of record', api: 'GET https://payroll.northloom.example/v1/workers?asOf={end}', desc: 'Who is employed, how they are paid, hire and termination dates, deposit accounts and PTO balances. Payroll is authoritative: people are onboarded here before WFM.' },
    { key: 'schedules', group: 'records', kind: 'csv', file: 'schedules.csv', title: 'Schedules', sys: 'WFM · Excel for the distribution center', api: 'GET https://wfm.northloom.example/v1/schedules?from={start}&to={end}', desc: 'Scheduled shifts by day. Stores schedule in WFM; the distribution center builds schedules in Excel and uploads them.' },
    { key: 'time', group: 'records', kind: 'csv', file: 'time_records.csv', title: 'Time records', sys: 'WFM timekeeping', api: 'GET https://wfm.northloom.example/v1/timecards?period=PR-2026-19', desc: 'Check-in, meal and check-out punches, pay codes (REG, VAC, SICK, HOL) and manager overrides by day.' },
    { key: 'register', group: 'records', kind: 'register', file: 'payroll_register.csv', title: 'Payroll register', sys: 'Payroll processor', api: 'GET https://payroll.northloom.example/v1/registers/PR-2026-19', desc: 'Earnings, taxes, deductions, net pay and PTO balances by employee. Accepts the CSV export or the printed PDF register.' },
    { key: 'bank', group: 'records', kind: 'csv', file: 'bank_activity.csv', title: 'Bank activity', sys: 'Treasury · payroll bank account', api: 'Prior-day bank statement feed (BAI2 / camt.053) for the payroll account', desc: 'Net pay and tax impounds, ACH settlement by employee, returns, tax and benefit remittances.' },
    { key: 'gl', group: 'records', kind: 'csv', file: 'gl_journal.csv', title: 'GL journal', sys: 'ERP general ledger', api: 'GET https://erp.northloom.example/v1/journals?source=PAYROLL&period=2026-10', desc: 'Payroll journal entry and the vacation accrual true-up.' },
    { key: 'agreement', group: 'policy', kind: 'json', file: 'union_agreement.json', title: 'Union agreement', sys: 'Labor relations', desc: 'Step rates by title and years of service, the 35-hour week, overtime and the Sunday double-time premium.' },
    { key: 'handbook', group: 'policy', kind: 'json', file: 'employee_handbook.json', title: 'Employee handbook', sys: 'HR policy', desc: 'Expected weekly hours, part-time cap, pay codes and holidays, punch rounding, vacation carryover and sick rules.' },
    { key: 'glMap', group: 'policy', kind: 'json', file: 'gl_mapping.json', title: 'GL mapping', sys: 'Finance', desc: 'Wage account by employee class, liability and cash accounts, and the cost centers that are mapped.' },
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
  const KIND_WORD = { underpaid: 'owed to employee', overpaid: 'overpaid', tax: 'tax exposure', cash: 'deposit', gl: 'GL', liability: 'PTO liability' };
  const SEV_LABEL = { blocker: 'Blocker', review: 'Review', info: 'Info' };
  const STAGE_OF = Object.fromEntries(E.STAGES.map((s) => [s.id, s]));
  const FLAG_LABEL = { MISSING_OUT: 'No check-out', MISSING_IN: 'No check-in', MISSING_MEAL_IN: 'No meal return', MISSING_MEAL_OUT: 'No meal out', NO_MEAL: 'No meal', OVERRIDE: 'Override', NO_PUNCH: 'No punches' };

  const state = {
    src: {},
    settings: {},
    result: null,
    tab: 'exceptions',
    filters: { sev: { blocker: true, review: true, info: false }, stage: null, check: null, kind: null, owner: '', q: '' },
    peopleIssuesOnly: false,
    drawer: null,
    drawerOpener: null,
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
    if (def.kind === 'json') state.src[key] = { json: JSON.parse(text), name: def.file, origin: origin || 'sample', mode };
    else state.src[key] = { rows: E.parseCSV(text), name: def.file, origin: origin || 'sample', mode, format: 'csv' };
  }

  function input() {
    const g = (k) => state.src[k] || {};
    return {
      census: g('census').rows || [], schedules: g('schedules').rows || [], time: g('time').rows || [],
      register: g('register').rows || [], bank: g('bank').rows || [], gl: g('gl').rows || [],
      agreement: g('agreement').json, handbook: g('handbook').json, glMap: g('glMap').json,
      settings: state.settings,
    };
  }
  const policyDefaults = () => {
    const i = input();
    return E.buildConfig(i.agreement, i.handbook, i.glMap, {});
  };

  function recompute() {
    state.result = E.run(input());
  }

  // ----------------------------------------------------------------------------------
  // Header, decision, KPIs
  // ----------------------------------------------------------------------------------

  function renderHeader() {
    const p = state.result.period;
    $('#cycle').innerHTML = `
      <span>Pay period <b>${esc(shortDate(p.start))} – ${esc(longDate(p.end))}</b></span>
      ${p.payDate ? `<span>Pay date <b>${esc(F.fmtDate(p.payDate))}</b></span>` : ''}
      <span>Batch <b class="mono">PR-2026-19</b></span>
      <span class="tag">Northloom Apparel · sample data</span>`;
  }

  function renderDecision() {
    const r = state.result, t = r.totals;
    const words = { hold: ['Hold payroll', 'Hold'], 'release-with-actions': ['Release with actions', 'Actions'], release: ['Ready to release', 'Clear'] }[r.decision];
    let text;
    if (r.decision === 'hold') {
      text = `${plural(t.releaseBlockers, 'blocker')} in time, roster and register checks must clear before this batch is released.${t.postBlockers ? ` ${plural(t.postBlockers, 'more blocker', 'more blockers')} in funding and GL need action after settlement.` : ''}`;
    } else if (r.decision === 'release-with-actions') {
      text = `Pre-payroll and register checks are clear. ${plural(t.postBlockers, 'blocker')} in funding and GL need action.`;
    } else text = 'Every check that ran passed. The batch can be released.';
    const stub = $('#stub');
    stub.dataset.decision = r.decision;
    stub.innerHTML = `
      <span class="eyebrow">Release decision · ${esc(longDate(r.period.payDate || r.period.end))}</span>
      <div class="stub-status"><h2>${words[0]}</h2><span class="stamp">${words[1]}</span></div>
      <p>${esc(text)}</p>
      <div class="stub-meta">
        <span><b>${t.checksRun}</b> checks run</span>
        <span><b>${t.people}</b> people</span>
        <span><b>${t.clean}</b> with no open items</span>
        <span><b>${F.money(r.regTotals.gross)}</b> gross on the register</span>
      </div>`;

    $('#kpis').innerHTML = KINDS.map((k) => {
      const v = t.impact[k.kind] || 0;
      const est = r.exceptions.some((x) => x.impact && x.impact.kind === k.kind && x.impact.estimated);
      return `<button class="kpi" type="button" data-action="kind" data-kind="${k.kind}" aria-pressed="${state.filters.kind === k.kind}">
        <span class="label">${esc(k.label)}</span>
        <span class="value ${v ? '' : 'zero'}">${F.money(v)}</span>
        <span class="sub">${esc(k.sub(t.impactPeople[k.kind] || 0))}${est ? ' · incl. estimates' : ''}</span>
      </button>`;
    }).join('');
  }

  // ----------------------------------------------------------------------------------
  // Pipeline
  // ----------------------------------------------------------------------------------

  function stageState(s) {
    if (!s.ran) return 'idle';
    if (s.blockers) return 'fail';
    if (s.review) return 'warn';
    return 'pass';
  }

  function renderPipeline(runIdx) {
    const stages = state.result.stages;
    const running = typeof runIdx === 'number';
    const fill = running ? Math.min(100, (Math.max(0, runIdx) / (stages.length - 1)) * 100) : 100;
    $('#pipe').innerHTML = `<div class="track" aria-hidden="true"><i style="width:${fill}%;--fill:${fill}%"></i></div>` + stages.map((s, i) => {
      let st = stageState(s);
      if (running) st = i < runIdx ? st : i === runIdx ? 'running' : 'queued';
      const dot = st === 'fail' ? s.blockers : st === 'warn' ? s.review : st === 'pass' ? '✓' : st === 'idle' ? '–' : st === 'running' ? '···' : '';
      const counts = st === 'running' ? '<span>Checking…</span>' : st === 'queued' ? '<span>Queued</span>'
        : st === 'idle' ? '<span>No data loaded</span>'
          : [s.blockers ? `<span class="c-crit">${plural(s.blockers, 'blocker')}</span>` : '', s.review ? `<span class="c-warn">${s.review} to review</span>` : '', `<span>${s.passed}/${s.checks} pass</span>`].filter(Boolean).join('');
      return `<button class="node" type="button" data-action="stage" data-stage="${s.id}" data-state="${st}" aria-pressed="${state.filters.stage === s.id}" aria-label="${esc(s.title)}: ${esc(s.blockers)} blockers, ${esc(s.review)} to review">
        <span class="dot">${dot}</span>
        <span class="txt"><span class="node-name">${esc(s.title)}</span>
        <span class="node-sys">${esc(s.systems)}</span>
        <span class="node-counts">${counts}</span></span>
      </button>`;
    }).join('');
  }

  // ----------------------------------------------------------------------------------
  // Tabs
  // ----------------------------------------------------------------------------------

  const TABS = [
    { id: 'exceptions', label: 'Exceptions', count: () => state.result.totals.blockers + state.result.totals.review },
    { id: 'checks', label: 'Checks', count: () => state.result.totals.checksRun },
    { id: 'people', label: 'People', count: () => state.result.totals.people },
    { id: 'intake', label: 'Data intake', count: () => `${SOURCES.filter((s) => state.src[s.key] && (state.src[s.key].rows || state.src[s.key].json)).length}/${SOURCES.length}` },
    { id: 'rules', label: 'Rules', count: () => Object.keys(state.settings).length || '' },
    { id: 'brief', label: 'Brief' },
  ];

  function renderTabs() {
    $('#tabs').innerHTML = TABS.map((t) => {
      const c = t.count ? t.count() : '';
      return `<button class="tab" role="tab" type="button" id="tab-${t.id}" aria-controls="panel-${t.id}" aria-selected="${state.tab === t.id}" data-action="tab" data-tab="${t.id}">${esc(t.label)}${c !== '' && c !== 0 ? `<span class="count">${esc(c)}</span>` : ''}</button>`;
    }).join('');
    TABS.forEach((t) => { $('#panel-' + t.id).hidden = state.tab !== t.id; });
  }

  function setTab(id) {
    state.tab = id;
    renderTabs();
    renderPanel(id);
  }

  function renderPanel(id, opts) {
    const fn = { exceptions: renderExceptions, checks: renderChecks, people: renderPeople, intake: renderIntake, rules: renderRules, brief: renderBrief }[id || state.tab];
    if (fn) fn(opts || {});
  }

  function renderAll(opts) {
    opts = opts || {};
    renderHeader();
    renderDecision();
    renderPipeline();
    renderTabs();
    if (!(opts.keepRules && state.tab === 'rules')) renderPanel(state.tab);
    if (state.drawer) renderDrawer();
  }

  // ----------------------------------------------------------------------------------
  // Exceptions
  // ----------------------------------------------------------------------------------

  function matches(x, ignoreSev) {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    return (ignoreSev || f.sev[x.severity])
      && (!f.stage || x.stage === f.stage)
      && (!f.check || x.check === f.check)
      && (!f.kind || (x.impact && x.impact.kind === f.kind))
      && (!f.owner || x.owner === f.owner)
      && (!q || `${x.title} ${x.detail} ${x.empName} ${x.empId || ''} ${x.check} ${x.owner}`.toLowerCase().includes(q));
  }

  function renderExceptions() {
    const r = state.result;
    const owners = Array.from(new Set(r.exceptions.map((x) => x.owner).filter(Boolean))).sort();
    const f = state.filters;
    const chips = [];
    if (f.stage) chips.push(['stage', `Stage: ${STAGE_OF[f.stage].title}`]);
    if (f.check) chips.push(['check', `Check: ${f.check} ${E.CHECKS.find((c) => c.id === f.check).title}`]);
    if (f.kind) chips.push(['kind', `Impact: ${KINDS.find((k) => k.kind === f.kind).label}`]);
    $('#panel-exceptions').innerHTML = `
      <div class="filters">
        <div class="seg" role="group" aria-label="Severity">
          ${['blocker', 'review', 'info'].map((s) => `<button type="button" data-action="sev" data-sev="${s}" aria-pressed="${f.sev[s]}">${s === 'blocker' ? 'Blockers' : SEV_LABEL[s]} <span class="n" id="sevn-${s}">0</span></button>`).join('')}
        </div>
        <label class="field" for="ownerSel">Owner
          <select id="ownerSel"><option value="">Everyone</option>${owners.map((o) => `<option ${f.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        </label>
        <input class="text" id="exSearch" type="search" placeholder="Search name, ID or check" value="${esc(f.q)}" aria-label="Search exceptions">
        ${chips.map(([k, l]) => `<button class="chip" type="button" data-action="clear-filter" data-filter="${k}">${esc(l)} <span aria-hidden="true">×</span><span class="sr-only">Clear</span></button>`).join('')}
        <span class="spacer"></span>
        <button class="btn small" type="button" data-action="copy-ex">Copy as CSV</button>
      </div>
      <div id="copyFallback"></div>
      <p class="muted" id="exCount" style="margin-bottom:8px"></p>
      <div class="ex-list" id="exList"></div>`;
    renderExList();
  }

  function renderExList() {
    const r = state.result;
    const base = r.exceptions.filter((x) => matches(x, true));
    ['blocker', 'review', 'info'].forEach((s) => { const el = $('#sevn-' + s); if (el) el.textContent = base.filter((x) => x.severity === s).length; });
    const list = base.filter((x) => state.filters.sev[x.severity]);
    $('#exCount').textContent = `Showing ${list.length} of ${r.exceptions.length} exceptions · sorted by severity, then pipeline stage`;
    $('#exList').innerHTML = list.length ? list.map(exRow).join('') : `<div class="empty">No exceptions match these filters.${r.exceptions.length ? '' : ' Every check that ran passed.'}</div>`;
  }

  function exRow(x) {
    const emp = x.empId ? state.result.empById[x.empId] : null;
    const who = emp
      ? `<button class="who" type="button" data-action="open-emp" data-emp="${esc(emp.id)}"><b>${esc(emp.name)}</b><span>${esc(emp.id)}${emp.location ? ' · ' + esc(emp.location) : ''}</span></button>`
      : `<div class="who"><b style="text-decoration:none">Whole cycle</b><span>${esc(STAGE_OF[x.stage].phase)}</span></div>`;
    const impact = x.impact
      ? `<b class="k-${x.impact.kind}">${F.money(x.impact.amount)}</b><span>${esc(KIND_WORD[x.impact.kind])}${x.impact.estimated ? ' · est.' : ''}</span>`
      : `<span>No $ impact</span>`;
    return `<article class="ex" data-id="${x.id}">
      <div class="ex-sev"><span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span><span class="ex-check">${esc(x.check)} · ${esc(STAGE_OF[x.stage].title)}</span></div>
      <div class="ex-main"><h4>${esc(x.title)}</h4><p class="detail">${esc(x.detail)}</p>${x.action ? `<p class="ex-action"><span class="owner">${esc(x.owner)}</span><span>${esc(x.action)}</span></p>` : ''}</div>
      <div class="ex-who">${who}</div>
      <div class="ex-impact">${impact}</div>
    </article>`;
  }

  function exceptionsCSV(list) {
    const rows = list.map((x) => ({
      id: x.id, severity: x.severity, check: x.check, check_name: E.CHECKS.find((c) => c.id === x.check).title, stage: STAGE_OF[x.stage].title,
      emp_id: x.empId || '', employee: x.empName || '', title: x.title, detail: x.detail,
      impact_kind: x.impact ? x.impact.kind : '', impact_amount: x.impact ? x.impact.amount.toFixed(2) : '', estimated: x.impact && x.impact.estimated ? 'Y' : '',
      owner: x.owner || '', action: x.action || '',
    }));
    return E.toCSV(rows, ['id', 'severity', 'check', 'check_name', 'stage', 'emp_id', 'employee', 'title', 'detail', 'impact_kind', 'impact_amount', 'estimated', 'owner', 'action']);
  }

  function copyText(text, fallbackEl, what) {
    const show = () => {
      if (!fallbackEl) return;
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
  // Checks
  // ----------------------------------------------------------------------------------

  const GLYPH = {
    pass: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fail: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warn: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="6" cy="9.6" r="1.2" fill="currentColor"/></svg>',
    note: '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="2.6" r="1.2" fill="currentColor"/><path d="M6 5.5v4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    idle: '',
  };

  function renderChecks() {
    const r = state.result;
    $('#panel-checks').innerHTML = `<p class="muted" style="margin-bottom:14px;max-width:80ch">Each check reads the files on the Data intake tab and the thresholds on the Rules tab. Select a check to see its exceptions.</p>
    <div class="check-stages">${r.stages.map((s) => {
      const cs = r.checks.filter((c) => c.stage === s.id);
      const pass = cs.filter((c) => c.ran && (c.status === 'pass' || c.status === 'note')).length;
      return `<section class="check-stage">
        <header><span class="eyebrow">${esc(s.phase)}</span><h3>${esc(s.title)}</h3><span class="sys">${esc(s.systems)}</span><span class="res">${s.ran ? `${pass} of ${cs.length} pass` : 'No data loaded'}</span></header>
        <ul>${cs.map((c) => {
          const st = !c.ran ? 'idle' : c.status;
          const res = !c.ran ? '<span class="muted">No data</span>'
            : c.status === 'pass' ? '<span class="pill pass">Pass</span>'
              : c.status === 'note' ? `<span class="pill info">${c.count} note${c.count === 1 ? '' : 's'}</span>`
                : `<span class="pill ${c.status === 'fail' ? 'blocker' : 'review'}">${c.count} found</span>`;
          return `<li><button class="check-row" type="button" data-action="check" data-check="${c.id}" ${c.count ? '' : 'aria-disabled="true"'}>
            <span class="glyph ${st}">${GLYPH[st]}</span><span class="id">${c.id}</span><span class="t">${esc(c.title)}</span><span class="rule">${esc(c.rule)}</span><span class="res">${res}</span>
          </button></li>`;
        }).join('')}</ul>
      </section>`;
    }).join('')}</div>`;
  }

  // ----------------------------------------------------------------------------------
  // People
  // ----------------------------------------------------------------------------------

  function renderPeople() {
    const r = state.result;
    const rows = r.employees.filter((e) => !state.peopleIssuesOnly || e.exceptions.some((x) => x.severity !== 'info'));
    const cell = (v) => (v === null || v === undefined ? '<span class="muted">—</span>' : v);
    $('#panel-people').innerHTML = `
      <div class="people-tools">
        <label class="check" for="issuesOnly"><input type="checkbox" id="issuesOnly" ${state.peopleIssuesOnly ? 'checked' : ''}> Only people with open items</label>
        <span class="muted">${rows.length} of ${r.employees.length} · validated gross uses approved WFM time, contract rates and handbook rules</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Class</th><th>Location</th><th class="n">WFM hours</th><th class="n">Register hours</th><th class="n">Register gross</th><th class="n">Validated gross</th><th class="n">Difference</th><th>Open items</th></tr></thead>
        <tbody>${rows.map((e) => {
          const R = e.register;
          const regH = R ? E.util.num(R.reg_hrs) + E.util.num(R.ot_hrs) + E.util.num(R.dt_hrs) + E.util.num(R.vac_hrs) + E.util.num(R.sick_hrs) + E.util.num(R.hol_hrs) : null;
          const gross = R ? E.util.num(R.gross_pay) : null;
          const diff = gross !== null && e.expectedGross !== null ? E.util.r2(gross - e.expectedGross) : null;
          const b = e.exceptions.filter((x) => x.severity === 'blocker').length;
          const v = e.exceptions.filter((x) => x.severity === 'review').length;
          return `<tr>
            <td><button class="who" type="button" data-action="open-emp" data-emp="${esc(e.id)}"><b>${esc(e.name)}</b><span>${esc(e.id)}${e.title ? ' · ' + esc(e.title) : ''}</span></button></td>
            <td>${e.cls ? esc(e.cls.label) : '<span class="muted">Not in payroll</span>'}</td>
            <td>${esc(e.location)}${e.cc ? ` <span class="muted mono">${esc(e.cc)}</span>` : ''}</td>
            <td class="n">${e.hasWfm ? F.fmtH(e.wfmWorked + e.wfmPto) : cell(null)}</td>
            <td class="n">${regH === null ? cell(null) : F.fmtH(regH)}</td>
            <td class="n">${gross === null ? cell(null) : F.money(gross)}</td>
            <td class="n">${e.expectedGross === null || e.expectedGross === undefined ? cell(null) : F.money(e.expectedGross)}</td>
            <td class="n">${diff === null ? cell(null) : diff === 0 ? '<span class="muted">$0.00</span>' : `<span class="${diff > 0 ? 'pos' : 'neg'}">${F.signedMoney(diff)}</span>`}</td>
            <td>${b ? `<span class="pill blocker">${b}</span> ` : ''}${v ? `<span class="pill review">${v}</span>` : ''}${!b && !v ? '<span class="pill pass">Clear</span>' : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  // ----------------------------------------------------------------------------------
  // Intake
  // ----------------------------------------------------------------------------------

  function renderIntake() {
    const p = state.result.period;
    const card = (def) => {
      const s = state.src[def.key] || {};
      const mode = s.mode || 'upload';
      const busy = state.busy[def.key];
      const loaded = s.rows || s.json;
      const count = s.rows ? plural(s.rows.length, 'row') : s.json ? 'policy loaded' : '';
      const origin = { sample: 'sample file', upload: 'uploaded', api: 'API sync (simulated)', pdf: 'PDF extract' }[s.origin] || '';
      const schema = SCHEMA_OF[def.key] && E.SCHEMAS[SCHEMA_OF[def.key]];
      const accept = def.kind === 'json' ? '.json,application/json' : def.kind === 'register' ? '.csv,.pdf,text/csv,application/pdf' : '.csv,text/csv';
      const api = def.api ? def.api.replace('{start}', p.start).replace('{end}', p.end) : '';
      return `<article class="source" id="src-${def.key}">
        <header><div><h4>${esc(def.title)}</h4><div class="sys">${esc(def.sys)}</div></div>
          ${def.api ? `<div class="seg" role="group" aria-label="${esc(def.title)} connection">
            <button type="button" data-action="mode" data-key="${def.key}" data-mode="upload" aria-pressed="${mode === 'upload'}">Batch upload</button>
            <button type="button" data-action="mode" data-key="${def.key}" data-mode="api" aria-pressed="${mode === 'api'}">API</button>
          </div>` : ''}
        </header>
        <p class="desc">${esc(def.desc)}</p>
        <div class="status">${busy ? `<span class="muted">${esc(busy)}</span>` : loaded ? `<span class="ok">✓ Loaded</span><span>${esc(count)}</span><span class="muted mono">${esc(s.name || '')}</span><span class="muted">${esc(origin)}</span>` : '<span class="bad">Not loaded</span>'}</div>
        ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
        ${mode === 'api' && def.api ? `
          <div class="api">${esc(api)}</div>
          <div class="row"><button class="btn small" type="button" data-action="sync" data-key="${def.key}" ${busy ? 'disabled' : ''}>Sync now</button><span class="muted" style="font-size:var(--t-xs)">Demo: the connector returns the sample cycle.</span></div>`
        : `<div class="row">
            <span class="btn small file-btn">${loaded ? 'Replace file' : 'Upload file'}<input type="file" id="file-${def.key}" data-key="${def.key}" accept="${accept}" aria-label="Upload ${esc(def.title)}"></span>
            ${def.kind === 'register' ? `<button class="btn small" type="button" data-action="sample-pdf" ${busy ? 'disabled' : ''}>Use sample PDF register</button>` : ''}
            ${s.origin !== 'sample' || def.kind === 'register' && s.format === 'pdf' ? `<button class="linkish" type="button" data-action="sample" data-key="${def.key}" style="font-size:var(--t-xs)">Back to sample ${def.kind === 'register' ? 'CSV' : 'file'}</button>` : ''}
          </div>`}
        ${def.key === 'register' && s.format === 'pdf' && s.rows ? pdfPreview(s) : ''}
        ${schema ? `<details><summary>Required columns (${schema.length})</summary><code>${esc(schema.join(', '))}</code></details>` : ''}
      </article>`;
    };
    $('#panel-intake').innerHTML = `
      <div class="intro">
        <p>Each source connects by API or arrives as a batch file. The demo opens with the Northloom Apparel sample cycle loaded; upload your own CSV, JSON or PDF files to replace any source and every check re-runs. The payroll census is the system of record for who is employed and when.</p>
        <button class="btn small" type="button" data-action="reset-all">Reload all sample data</button>
      </div>
      ${window.PA_HOSTED ? `<p class="muted" style="font-size:var(--t-sm);margin:-6px 0 8px">Download the sample files to demo a batch upload: ${sampleDownloads().map(([n, u]) => `<a href="${u}" download="${esc(n)}" class="mono" style="color:var(--accent)">${esc(n)}</a>`).join(' · ')}</p>` : ''}
      <div class="group-title"><h3>Systems of record</h3><span class="muted">WFM, payroll, bank and ERP extracts for one pay cycle</span></div>
      <div class="sources">${SOURCES.filter((s) => s.group === 'records').map(card).join('')}</div>
      <div class="group-title"><h3>Policies and mappings</h3><span class="muted">The rules each check applies; thresholds can be adjusted on the Rules tab</span></div>
      <div class="sources">${SOURCES.filter((s) => s.group === 'policy').map(card).join('')}</div>`;
  }

  function pdfPreview(s) {
    const rows = s.rows.slice(0, 4);
    return `<div class="pdf-preview">
      <p class="muted" style="margin-bottom:6px">Extracted ${plural(s.rows.length, 'employee')} from ${plural(s.pages || 0, 'page')}${s.problems && s.problems.length ? ` · ${plural(s.problems.length, 'line')} skipped` : ''}. First rows:</p>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th class="n">Hours</th><th class="n">Gross</th><th class="n">Net</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="mono">${esc(r.emp_id)}</td><td>${esc(r.employee_name)}</td><td class="n">${F.fmtH(E.util.num(r.reg_hrs) + E.util.num(r.ot_hrs) + E.util.num(r.dt_hrs))}</td><td class="n">${F.money(E.util.num(r.gross_pay))}</td><td class="n">${F.money(E.util.num(r.net_pay))}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  async function handleFile(key, file) {
    const def = SRC[key];
    const prev = state.src[key] || {};
    const mode = prev.mode || 'upload';
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        if (key !== 'register') throw new Error('Only the payroll register can be read from a PDF.');
        const buf = await file.arrayBuffer();
        await loadRegisterPdf(new Uint8Array(buf), file.name, 'pdf');
        return;
      }
      const text = await file.text();
      if (def.kind === 'json') {
        let json;
        try { json = JSON.parse(text); } catch (e) { throw new Error(`${file.name} is not valid JSON.`); }
        state.src[key] = { json, name: file.name, origin: 'upload', mode };
      } else {
        const rows = E.parseCSV(text);
        const missing = E.missingColumns(SCHEMA_OF[key], rows);
        if (!rows.length) throw new Error(`${file.name} has no data rows.`);
        if (missing.length) throw new Error(`${file.name} is missing ${plural(missing.length, 'column')}: ${missing.join(', ')}. The previous file is still in use.`);
        state.src[key] = { rows, name: file.name, origin: 'upload', mode, format: 'csv' };
      }
      recompute();
      renderAll();
      toast(`${def.title}: loaded ${file.name} · re-ran ${state.result.totals.checksRun} checks`);
    } catch (e) {
      state.src[key] = Object.assign({}, prev, { error: e.message });
      renderIntake();
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
    if (state.tab === 'intake') renderIntake();
    try {
      const { lines, pages } = await pdfLines(bytes);
      const { rows, problems } = E.parseRegisterLines(lines);
      if (!rows.length) throw new Error('No employee lines were found. Use a text-based register PDF; scanned images need OCR first.');
      state.src.register = { rows, name, origin, mode: prev.mode || 'upload', format: 'pdf', pages, problems };
      delete state.busy.register;
      recompute();
      renderAll();
      toast(`Extracted ${plural(rows.length, 'employee')} from ${plural(pages, 'PDF page')} · re-ran ${state.result.totals.checksRun} checks`);
    } catch (e) {
      delete state.busy.register;
      state.src.register = Object.assign({}, prev, { error: e.message });
      renderIntake();
    }
  }

  let sampleUrls = null;
  function sampleDownloads() {
    if (!sampleUrls) {
      sampleUrls = Object.entries(SAMPLE.files).map(([name, text]) => [name, URL.createObjectURL(new Blob([text], { type: name.endsWith('.json') ? 'application/json' : 'text/csv' }))]);
      if (SAMPLE.registerPdfBase64) sampleUrls.push(['payroll_register.pdf', URL.createObjectURL(new Blob([samplePdfBytes()], { type: 'application/pdf' }))]);
    }
    return sampleUrls;
  }

  function samplePdfBytes() {
    const b64 = SAMPLE.registerPdfBase64 || '';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
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

  const ruleValue = (f, cfg) => (f.pct ? +(cfg[f.key] * 100).toFixed(4) : cfg[f.key]);
  const ruleDisplay = (f, v) => {
    if (f.type === 'bool') return v ? 'on' : 'off';
    if (f.type === 'select') { const o = f.options.find((x) => String(x[0]) === String(v)); return o ? o[1] : String(v); }
    return `${f.pct ? +(v * 100).toFixed(4) : v}${f.unit === 'h' || f.unit === 'h / week' ? 'h' : f.unit === '×' ? '×' : f.unit === '%' ? '%' : f.unit === '$' ? '' : ' ' + f.unit}`;
  };

  function renderRules() {
    const def = policyDefaults();
    const cfg = state.result.config;
    const ua = input().agreement || {};
    const glm = input().glMap || {};
    const hint = (f) => {
      const changed = Object.prototype.hasOwnProperty.call(state.settings, f.key);
      return `<p class="hint ${changed ? 'changed' : ''}" id="hint-${f.key}">${changed ? `Changed from policy ${esc(ruleDisplay(f, def[f.key]))} · <button class="linkish" type="button" data-action="reset-rule" data-key="${f.key}">Reset</button>` : `Policy: ${esc(ruleDisplay(f, def[f.key]))}`}</p>`;
    };
    const control = (f) => {
      const id = 'rule-' + f.key;
      if (f.type === 'bool') return `<input type="checkbox" id="${id}" data-rule="${f.key}" ${cfg[f.key] ? 'checked' : ''}>`;
      if (f.type === 'select') return `<select id="${id}" data-rule="${f.key}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(cfg[f.key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      return `<input type="number" inputmode="decimal" id="${id}" data-rule="${f.key}" value="${esc(ruleValue(f, cfg))}" step="${f.step || 1}" min="0">`;
    };
    const steps = ua.steps || [];
    const rates = ua.rates || {};
    $('#panel-rules').innerHTML = `
      <div class="intro"><p>Thresholds start from the loaded union agreement and handbook. Change one and every check re-runs; the exceptions, totals and brief update with it.</p>
        <button class="btn small" type="button" data-action="reset-rules" ${Object.keys(state.settings).length ? '' : 'disabled'}>Reset all to policy</button></div>
      <div class="rules">
        ${RULE_GROUPS.map((g) => `<section class="rule-card"><div><h4>${esc(g.title)}</h4><p class="src">${esc(g.src)}</p></div>
          ${g.fields.map((f) => `<div class="rule"><label for="rule-${f.key}">${esc(f.label)}${f.unit && f.type !== 'bool' && f.type !== 'select' ? ` <span class="muted">(${esc(f.unit)})</span>` : ''}</label>${control(f)}${hint(f)}</div>`).join('')}
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
    RULE_GROUPS.forEach((g) => g.fields.forEach((f) => {
      const el = $('#hint-' + f.key);
      if (!el) return;
      const changed = Object.prototype.hasOwnProperty.call(state.settings, f.key);
      el.className = 'hint' + (changed ? ' changed' : '');
      el.innerHTML = changed ? `Changed from policy ${esc(ruleDisplay(f, def[f.key]))} · <button class="linkish" type="button" data-action="reset-rule" data-key="${f.key}">Reset</button>` : `Policy: ${esc(ruleDisplay(f, def[f.key]))}`;
    }));
    const btn = document.querySelector('[data-action="reset-rules"]');
    if (btn) btn.disabled = !Object.keys(state.settings).length;
  }

  let rerunTimer = null;
  function onRuleInput(el) {
    const key = el.dataset.rule;
    const f = RULE_GROUPS.flatMap((g) => g.fields).find((x) => x.key === key);
    const def = policyDefaults();
    let v;
    if (f.type === 'bool') v = el.checked;
    else if (f.type === 'select') v = typeof def[key] === 'number' ? Number(el.value) : el.value;
    else {
      if (el.value === '' || !Number.isFinite(Number(el.value))) return;
      v = Number(el.value);
      if (f.pct) v = +(v / 100).toFixed(6);
    }
    if (v === def[key] || (typeof v === 'number' && Math.abs(v - def[key]) < 1e-9)) delete state.settings[key];
    else state.settings[key] = v;
    updateRuleHints();
    scheduleRerun(f.label);
  }

  function scheduleRerun(what) {
    clearTimeout(rerunTimer);
    rerunTimer = setTimeout(() => {
      const before = state.result.totals;
      recompute();
      renderAll({ keepRules: true });
      const t = state.result.totals;
      toast(`${what ? what + ' changed · ' : ''}${t.blockers} blockers (was ${before.blockers}), ${t.review} to review (was ${before.review})`);
    }, 250);
  }

  // ----------------------------------------------------------------------------------
  // Brief
  // ----------------------------------------------------------------------------------

  function briefModel() {
    const r = state.result, t = r.totals, p = r.period;
    const blockersPre = r.exceptions.filter((x) => x.severity === 'blocker' && ['time', 'roster', 'payroll'].includes(x.stage));
    const blockersPost = r.exceptions.filter((x) => x.severity === 'blocker' && !['time', 'roster', 'payroll'].includes(x.stage));
    const review = r.exceptions.filter((x) => x.severity === 'review');
    const byOwner = (list) => {
      const m = {};
      list.forEach((x) => { (m[x.owner || 'Unassigned'] = m[x.owner || 'Unassigned'] || []).push(x); });
      return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
    };
    const line = (x) => {
      const who = x.empId ? `${x.empId} ${x.empName}` : 'Cycle';
      const amt = x.impact ? ` (${F.money(x.impact.amount)} ${KIND_WORD[x.impact.kind]}${x.impact.estimated ? ', est.' : ''})` : '';
      return `${who}: ${x.title}${amt}. ${x.action || ''}`.trim();
    };
    const decisionWord = { hold: 'HOLD', 'release-with-actions': 'RELEASE WITH ACTIONS', release: 'RELEASE' }[r.decision];
    const imp = t.impact;
    const lead = [
      `${decisionWord}. ${plural(t.releaseBlockers, 'blocker')} before release${t.postBlockers ? `, ${t.postBlockers} more in funding and GL` : ''}; ${t.review} items to review.`,
      `${F.money(imp.underpaid)} is owed to ${plural(t.impactPeople.underpaid, 'employee')} and ${F.money(imp.overpaid)} was overpaid across ${plural(t.impactPeople.overpaid, 'employee')}${imp.tax ? `; tax exposure ${F.money(imp.tax)}` : ''}${imp.cash ? `; ${F.money(imp.cash)} of deposits need fixing` : ''}.`,
    ];
    return { r, t, p, blockersPre, blockersPost, review, byOwner, line, lead };
  }

  function renderBrief() {
    const m = briefModel();
    const section = (title, groups) => groups.length ? `<h4>${esc(title)}</h4>${groups.map(([o, list]) => `<h5>${esc(o)} · ${list.length}</h5><ul>${list.map((x) => `<li>${esc(m.line(x))}</li>`).join('')}</ul>`).join('')}` : '';
    $('#panel-brief').innerHTML = `
      <div class="brief-tools"><button class="btn small" type="button" data-action="copy-brief">Copy brief as text</button><span class="muted">For the payroll manager, controller and store operations. Regenerates on every run.</span></div>
      <div id="briefFallback"></div>
      <article class="brief">
        <div class="memo-head">
          <span class="eyebrow">Payroll readiness · batch PR-2026-19</span>
          <h3>Northloom Apparel, pay period ${esc(shortDate(m.p.start))} – ${esc(longDate(m.p.end))}</h3>
          <span class="muted">Pay date ${esc(F.fmtDate(m.p.payDate))} · ${m.t.checksRun} checks across ${m.t.people} people · WFM, payroll register, bank activity and GL</span>
        </div>
        ${m.lead.map((l) => `<p class="lead">${esc(l)}</p>`).join('')}
        ${section('Clear before release', m.byOwner(m.blockersPre))}
        ${section('After settlement — treasury and GL', m.byOwner(m.blockersPost))}
        ${section('Review before close', m.byOwner(m.review))}
      </article>`;
  }

  function briefText() {
    const m = briefModel();
    const out = [];
    out.push(`PAYROLL READINESS — Northloom Apparel — batch PR-2026-19`);
    out.push(`Pay period ${shortDate(m.p.start)} – ${longDate(m.p.end)} · pay date ${F.fmtDate(m.p.payDate)}`);
    out.push('');
    m.lead.forEach((l) => out.push(l));
    const sec = (title, groups) => {
      if (!groups.length) return;
      out.push('', title.toUpperCase());
      groups.forEach(([o, list]) => { out.push(`${o} (${list.length})`); list.forEach((x) => out.push(`  - ${m.line(x)}`)); });
    };
    sec('Clear before release', m.byOwner(m.blockersPre));
    sec('After settlement — treasury and GL', m.byOwner(m.blockersPost));
    sec('Review before close', m.byOwner(m.review));
    out.push('', `${m.t.checksRun} checks run across ${m.t.people} people.`);
    return out.join('\n');
  }

  // ----------------------------------------------------------------------------------
  // Drawer
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
    $('#scrim').hidden = true;
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
      ? `<div class="mini-ex">${exs.map((x) => `<div><span class="h"><span class="pill ${x.severity}">${SEV_LABEL[x.severity]}</span><span class="mono muted" style="font-size:var(--t-xs)">${esc(x.check)}</span>${esc(x.title)}${x.impact ? ` <span class="mono" style="margin-left:auto">${F.money(x.impact.amount)}</span>` : ''}</span><p>${esc(x.detail)}</p></div>`).join('')}</div>`
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
        <section><h4>Open items · ${exs.filter((x) => x.severity !== 'info').length}</h4>${exHtml}</section>
        <section><h4>Timecard · scheduled vs worked</h4>${e.hasWfm ? tcRows() : '<p class="muted">No WFM profile, schedule or time records.</p>'}</section>
        <section><h4>Pay · validated vs register</h4>${payHtml}</section>
        ${balHtml}
        <section><h4>Deposits</h4>${depHtml}</section>
      </div>`;
  }
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

  // ----------------------------------------------------------------------------------
  // Run, toast
  // ----------------------------------------------------------------------------------

  async function runValidation() {
    if (state.running) return;
    state.running = true;
    const btn = $('#runBtn');
    btn.disabled = true;
    btn.textContent = 'Running…';
    recompute();
    if (!reduceMotion) {
      for (let i = 0; i <= state.result.stages.length; i++) {
        renderPipeline(i);
        await sleep(i === 0 ? 150 : 430);
      }
    }
    state.running = false;
    btn.disabled = false;
    btn.textContent = 'Run validation';
    renderAll();
    const t = state.result.totals;
    toast(`Ran ${t.checksRun} checks across ${t.people} people · ${t.blockers} blockers, ${t.review} to review`);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // ----------------------------------------------------------------------------------
  // Events
  // ----------------------------------------------------------------------------------

  function filterExceptions(patch) {
    Object.assign(state.filters, patch);
    if (patch.stage || patch.check || patch.kind) state.filters.sev = { blocker: true, review: true, info: !!patch.check };
    state.tab = 'exceptions';
    renderDecision();
    renderPipeline();
    renderTabs();
    renderExceptions();
    const panel = $('#tabs');
    if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'tab') setTab(el.dataset.tab);
    else if (a === 'stage') filterExceptions({ stage: state.filters.stage === el.dataset.stage ? null : el.dataset.stage, check: null });
    else if (a === 'kind') filterExceptions({ kind: state.filters.kind === el.dataset.kind ? null : el.dataset.kind });
    else if (a === 'check') { if (el.getAttribute('aria-disabled') !== 'true') filterExceptions({ check: el.dataset.check, stage: null }); }
    else if (a === 'clear-filter') { state.filters[el.dataset.filter] = null; renderDecision(); renderPipeline(); renderExceptions(); }
    else if (a === 'sev') { state.filters.sev[el.dataset.sev] = !state.filters.sev[el.dataset.sev]; el.setAttribute('aria-pressed', state.filters.sev[el.dataset.sev]); renderExList(); }
    else if (a === 'copy-ex') copyText(exceptionsCSV(state.result.exceptions.filter((x) => matches(x))), $('#copyFallback'), 'exceptions as CSV');
    else if (a === 'copy-brief') copyText(briefText(), $('#briefFallback'), 'the brief');
    else if (a === 'open-emp') openDrawer(el.dataset.emp, el);
    else if (a === 'close-drawer') closeDrawer();
    else if (a === 'mode') { const s = state.src[el.dataset.key] || (state.src[el.dataset.key] = {}); s.mode = el.dataset.mode; renderIntake(); }
    else if (a === 'sync') {
      const key = el.dataset.key;
      state.busy[key] = 'Connecting…';
      renderIntake();
      setTimeout(() => {
        delete state.busy[key];
        loadSample(key, 'api');
        state.src[key].mode = 'api';
        recompute();
        renderAll();
        toast(`${SRC[key].title}: synced ${plural(state.src[key].rows.length, 'record')} · re-ran ${state.result.totals.checksRun} checks`);
      }, reduceMotion ? 0 : 700);
    } else if (a === 'sample') { loadSample(el.dataset.key); recompute(); renderAll(); toast(`${SRC[el.dataset.key].title}: back to the sample file`); }
    else if (a === 'sample-pdf') loadRegisterPdf(samplePdfBytes(), 'payroll_register.pdf', 'pdf');
    else if (a === 'reset-all') { SOURCES.forEach((s) => { const m = state.src[s.key] && state.src[s.key].mode; loadSample(s.key); if (m) state.src[s.key].mode = m; }); recompute(); renderAll(); toast('Reloaded the sample cycle'); }
    else if (a === 'reset-rule') { delete state.settings[el.dataset.key]; renderRules(); scheduleRerun(); }
    else if (a === 'reset-rules') { state.settings = {}; renderRules(); scheduleRerun('Rules reset'); }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('input[type="file"][data-key]') && t.files && t.files[0]) handleFile(t.dataset.key, t.files[0]);
    else if (t.id === 'ownerSel') { state.filters.owner = t.value; renderExList(); }
    else if (t.id === 'issuesOnly') { state.peopleIssuesOnly = t.checked; renderPeople(); }
    else if (t.matches('[data-rule]') && (t.type === 'checkbox' || t.tagName === 'SELECT')) onRuleInput(t);
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'exSearch') { state.filters.q = t.value; renderExList(); }
    else if (t.matches('input[type="number"][data-rule]')) onRuleInput(t);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.drawer) closeDrawer();
  });
  $('#scrim').addEventListener('click', closeDrawer);
  $('#runBtn').addEventListener('click', runValidation);

  // ----------------------------------------------------------------------------------
  // Boot
  // ----------------------------------------------------------------------------------

  function boot() {
    SAMPLE = window.NORTHLOOM_SAMPLE || SAMPLE;
    SOURCES.forEach((s) => loadSample(s.key));
    const hash = (location.hash || '').replace('#', '');
    if (TABS.some((t) => t.id === hash)) state.tab = hash;
    recompute();
    renderAll();
  }
  if (window.NORTHLOOM_SAMPLE_READY) {
    window.NORTHLOOM_SAMPLE_READY.then(boot, (e) => { $('#stub').textContent = 'The sample cycle could not be loaded: ' + e.message; });
  } else boot();
})();
