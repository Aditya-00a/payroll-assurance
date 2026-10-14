/*
 * Payroll assurance engine.
 *
 * Validates one pay cycle end to end:
 *   WFM time & attendance -> WFM/payroll roster match -> payroll register -> funding (treasury) -> GL posting
 *
 * Pure functions, no DOM. Runs in the browser (window.PayrollEngine) and in node (module.exports).
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------------------------
  // Numbers, dates, formatting
  // ------------------------------------------------------------------------------------

  const r2 = (x) => {
    const s = x < 0 ? -1 : 1;
    return (s * Math.round(Math.abs(x) * 100 + 1e-7)) / 100;
  };
  const num = (v) => {
    if (v === null || v === undefined) return 0;
    const s = String(v).replace(/[$,\s]/g, '');
    if (s === '') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

  const money = (n) => {
    const v = r2(n);
    return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtH = (n) => {
    const v = Math.round(n * 100) / 100;
    return (Number.isInteger(v) ? v.toFixed(1) : String(v)) + 'h';
  };
  const signedH = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtH(Math.abs(n));

  const D = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(D(s) + n * 864e5);
  const dow = (s) => new Date(D(s)).getUTCDay();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
  const fmtDate = (s) => (s ? `${DOW[dow(s)]} ${md(s)}` : '');
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

  function yearsBetween(a, b) {
    const ay = +a.slice(0, 4), am = +a.slice(5, 7), ad = +a.slice(8, 10);
    const by = +b.slice(0, 4), bm = +b.slice(5, 7), bd = +b.slice(8, 10);
    let years = by - ay - (bm < am || (bm === am && bd < ad) ? 1 : 0);
    const anniv = Date.UTC(ay + years, am - 1, ad);
    const next = Date.UTC(ay + years + 1, am - 1, ad);
    return years + (D(b) - anniv) / (next - anniv);
  }
  const anniversaryOf = (hire, years) => `${+hire.slice(0, 4) + years}${hire.slice(4)}`;

  const toMin = (t) => {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
    if (!m) return null;
    return +m[1] * 60 + +m[2];
  };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  // ------------------------------------------------------------------------------------
  // CSV
  // ------------------------------------------------------------------------------------

  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
        continue;
      }
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const header = (rows.shift() || []).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    return rows
      .filter((r) => r.some((v) => v.trim() !== ''))
      .map((r) => Object.fromEntries(header.map((h, k) => [h, (r[k] === undefined ? '' : r[k]).trim()])));
  }

  function toCSV(rows, cols) {
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  }

  const SCHEMAS = {
    census: ['emp_id', 'first_name', 'last_name', 'job_title', 'cost_center', 'work_state', 'union_local', 'flsa_status', 'ft_pt', 'pay_type', 'hourly_rate', 'annual_salary', 'hire_date', 'term_date', 'bank_last4', 'vac_carryover_hrs', 'vac_current_hrs', 'sick_hrs'],
    schedules: ['emp_id', 'work_date', 'shift_start', 'shift_end', 'scheduled_hours'],
    time: ['emp_id', 'work_date', 'pay_code', 'punch_in', 'meal_out', 'meal_in', 'punch_out', 'wfm_hours', 'manager_override'],
    register: ['emp_id', 'cost_center', 'pay_type', 'rate', 'reg_hrs', 'ot_hrs', 'dt_hrs', 'vac_hrs', 'sick_hrs', 'hol_hrs', 'reg_pay', 'ot_pay', 'dt_pay', 'pto_pay', 'gross_pay', 'fed_wh', 'ss_ee', 'medicare_ee', 'state_wh', 'state_other_ee', 'k401_ee', 'medical_ee', 'net_pay', 'ss_er', 'medicare_er', 'futa_er', 'sui_er', 'work_state', 'bank_last4', 'vac_co_begin', 'vac_co_end', 'vac_cur_begin', 'vac_cur_end', 'sick_begin', 'sick_end'],
    bank: ['txn_id', 'value_date', 'txn_type', 'amount', 'emp_id', 'account_last4', 'return_code', 'jurisdiction'],
    gl: ['je_id', 'account', 'cost_center', 'debit', 'credit'],
  };

  function missingColumns(kind, rows) {
    const need = SCHEMAS[kind];
    if (!need) return [];
    if (!rows.length) return need.slice();
    const have = new Set(Object.keys(rows[0]));
    return need.filter((c) => !have.has(c));
  }

  // ------------------------------------------------------------------------------------
  // PDF payroll register (text extraction, three lines per employee)
  // ------------------------------------------------------------------------------------

  /**
   * lines: array of arrays of cell strings, in reading order (top to bottom, left to right).
   * Recognises the processor register layout: an earnings line that starts with the employee
   * id, followed by a TAXES/DED line and an EMPLOYER/BAL line.
   */
  function parseRegisterLines(lines) {
    const n = (s) => num(s);
    const rows = [];
    const problems = [];
    let cur = null;
    for (const cells of lines) {
      const c = cells.map((x) => String(x).trim()).filter(Boolean);
      if (!c.length) continue;
      if (/^E\d{3,}$/.test(c[0])) {
        if (c.length < 16) { problems.push(`Earnings line for ${c[0]} has ${c.length} cells, expected 16`); cur = null; continue; }
        const v = c.slice(4).map(n);
        cur = {
          emp_id: c[0], employee_name: c[1], cost_center: c[2], pay_type: c[3],
          rate: v[0], reg_hrs: v[1], ot_hrs: v[2], dt_hrs: v[3], vac_hrs: v[4], sick_hrs: v[5], hol_hrs: v[6],
          reg_pay: v[7], ot_pay: v[8], dt_pay: v[9], pto_pay: v[10], gross_pay: v[11],
        };
        rows.push(cur);
      } else if (/^TAXES\/DED$/i.test(c[0]) && cur) {
        const v = c.slice(1, 9).map(n);
        Object.assign(cur, {
          fed_wh: v[0], ss_ee: v[1], medicare_ee: v[2], state_wh: v[3], state_other_ee: v[4],
          k401_ee: v[5], medical_ee: v[6], net_pay: v[7], bank_last4: (c[9] || '').replace(/\D/g, ''),
        });
      } else if (/^EMPLOYER\/BAL$/i.test(c[0]) && cur) {
        const v = c.slice(1, 5).map(n);
        const b = c.slice(6, 12).map(n);
        Object.assign(cur, {
          ss_er: v[0], medicare_er: v[1], futa_er: v[2], sui_er: v[3], work_state: c[5],
          vac_co_begin: b[0], vac_co_end: b[1], vac_cur_begin: b[2], vac_cur_end: b[3], sick_begin: b[4], sick_end: b[5],
        });
      }
    }
    const incomplete = rows.filter((r) => r.net_pay === undefined || r.work_state === undefined);
    incomplete.forEach((r) => problems.push(`${r.emp_id}: deductions or employer lines missing`));
    const out = rows
      .filter((r) => !incomplete.includes(r))
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(2) : v])));
    return { rows: out, problems };
  }

  // ------------------------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------------------------

  function buildConfig(agreement, handbook, glMap, overrides) {
    const hb = handbook || {}, ua = agreement || {}, ot = ua.overtime || {}, vac = hb.vacation || {};
    const ewh = hb.expected_weekly_hours || {};
    const base = {
      unionFtWeekly: ua.full_time_weekly_hours ?? ewh.union_full_time ?? 35,
      nonUnionFtWeekly: ewh.non_union_full_time ?? 40,
      exemptWeekly: ewh.exempt_full_time ?? 40,
      ptMaxWeekly: hb.part_time_max_weekly_hours ?? 30,
      unionOtAfter: ot.weekly_after_hours ?? 35,
      flsaOtAfter: hb.flsa_overtime_weekly_after_hours ?? 40,
      otMultiplier: ot.multiplier ?? hb.flsa_overtime_multiplier ?? 1.5,
      sundayMultiplier: ot.sunday_multiplier ?? 2,
      saturdayPremium: !!ot.saturday_premium_enabled,
      dailyMaxHours: hb.daily_max_hours ?? 12,
      scheduleVarianceHours: 1,
      punchRounding: hb.punch_rounding_minutes ?? 15,
      mealRequiredAfter: hb.meal_punch_required_after_hours ?? 6,
      validCodes: hb.valid_pay_codes || ['REG', 'VAC', 'SICK', 'HOL'],
      holidays: hb.company_holidays_2026 || hb.company_holidays || [],
      accrual: vac.accrual_per_pay_period_hours || {},
      waitingDays: vac.waiting_period_days ?? 90,
      carryoverCap: vac.carryover_cap_hours ?? 40,
      drawFirst: (vac.draw_order || ['carryover', 'current'])[0] === 'current' ? 'current' : 'carryover',
      ssRate: 0.062,
      medicareRate: 0.0145,
      section125ReducesFica: true,
      taxTolerance: 0.02,
      salaryPeriods: 26,
      unionSteps: ua.steps || [],
      unionRates: ua.rates || {},
      unionName: ua.union || ua.local || 'Union',
      gl: glMap || {},
      periodStart: '',
    };
    const cfg = Object.assign(base, overrides || {});
    return cfg;
  }

  // ------------------------------------------------------------------------------------
  // Catalogue
  // ------------------------------------------------------------------------------------

  const STAGES = [
    { id: 'time', title: 'Time & attendance', phase: 'WFM', systems: 'Schedules · time records' },
    { id: 'roster', title: 'Roster match', phase: 'WFM → Payroll', systems: 'WFM roster · payroll census' },
    { id: 'payroll', title: 'Payroll register', phase: 'Payroll', systems: 'Register · census · agreement · handbook' },
    { id: 'funding', title: 'Funding', phase: 'Payroll → Treasury', systems: 'ACH settlement · tax & benefit remits' },
    { id: 'gl', title: 'GL posting', phase: 'Treasury → Finance', systems: 'Payroll journal · GL mapping' },
  ];

  const CHECKS = [
    { id: 'T1', stage: 'time', title: 'Punch completeness', rule: (c) => `Every shift has a check-in and check-out; a meal check-out has a return punch; shifts over ${c.mealRequiredAfter}h show a meal.` },
    { id: 'T2', stage: 'time', title: 'Manager overrides', rule: () => 'Hours entered without punches are listed for sign-off.' },
    { id: 'T3', stage: 'time', title: 'Punch rounding', rule: (c) => `WFM hours equal the punches rounded to the nearest ${c.punchRounding} minutes.` },
    { id: 'T4', stage: 'time', title: 'Schedule vs actual', rule: (c) => `No-shows, unscheduled shifts, and days off schedule by ${c.scheduleVarianceHours}h or more.` },
    { id: 'T5', stage: 'time', title: 'Short weeks', rule: (c) => `Worked plus time off reaches ${c.unionFtWeekly}h (union FT), ${c.nonUnionFtWeekly}h (non-union FT) or ${c.exemptWeekly}h (exempt), prorated for hires and terminations.` },
    { id: 'T6', stage: 'time', title: 'Overtime due', rule: (c) => `Non-exempt hours over ${c.unionOtAfter}h (union) or ${c.flsaOtAfter}h (FLSA) and union Sunday hours carry a premium.` },
    { id: 'T7', stage: 'time', title: 'Part-time cap', rule: (c) => `Part-time associates stay at or under ${c.ptMaxWeekly}h a week.` },
    { id: 'T8', stage: 'time', title: 'Daily maximum', rule: (c) => `No shift over ${c.dailyMaxHours}h.` },
    { id: 'T9', stage: 'time', title: 'Pay codes', rule: () => 'Codes are on the handbook list; HOL only on company holidays.' },
    { id: 'T10', stage: 'time', title: 'Time-off balances', rule: () => 'Vacation and sick hours coded do not exceed the available balance.' },
    { id: 'R1', stage: 'roster', title: 'Time without a payroll record', rule: () => 'Everyone with WFM time exists in the payroll census.' },
    { id: 'R2', stage: 'roster', title: 'Payroll record without WFM time', rule: () => 'Everyone active or paid in payroll has a WFM profile and time.' },
    { id: 'R3', stage: 'roster', title: 'Time before hire date', rule: () => 'No time records before the payroll hire date.' },
    { id: 'R4', stage: 'roster', title: 'Time after termination', rule: () => 'No time records or shifts after the payroll termination date.' },
    { id: 'P1', stage: 'payroll', title: 'Rate and salary', rule: () => 'Register rate, salary, pay type and cost center match the census.' },
    { id: 'P2', stage: 'payroll', title: 'Union pay scale', rule: (c) => `Union rates meet the ${c.unionName} step for title and years of service.` },
    { id: 'P3', stage: 'payroll', title: 'Hours tie-out', rule: () => 'Register hours by code equal approved WFM hours.' },
    { id: 'P4', stage: 'payroll', title: 'Overtime and premiums', rule: (c) => `Regular / ${c.otMultiplier}x / ${c.sundayMultiplier}x hours split matches the rules${c.saturdayPremium ? ' (Saturday premium on)' : ''}.` },
    { id: 'P5', stage: 'payroll', title: 'Exempt overtime', rule: () => 'Exempt salaried employees are not paid overtime.' },
    { id: 'P6', stage: 'payroll', title: 'Earnings math', rule: () => 'Each earning equals hours × rate × multiplier; gross equals the sum.' },
    { id: 'P7', stage: 'payroll', title: 'Statutory taxes', rule: (c) => `Social Security ${(c.ssRate * 100).toFixed(1)}% and Medicare ${(c.medicareRate * 100).toFixed(2)}% on FICA wages, matched by the employer.` },
    { id: 'P8', stage: 'payroll', title: 'Net pay math', rule: () => 'Net pay equals gross less taxes and deductions.' },
    { id: 'P9', stage: 'payroll', title: 'PTO balances', rule: (c) => `Balances start from the census, draw ${c.drawFirst} first, accrue per the handbook, and carryover stays under ${c.carryoverCap}h.` },
    { id: 'P10', stage: 'payroll', title: 'Approved time not paid', rule: () => 'Everyone with approved time in the window has a register line.' },
    { id: 'F1', stage: 'funding', title: 'Net pay funding', rule: () => 'Net pay impound equals register net pay.' },
    { id: 'F2', stage: 'funding', title: 'ACH by employee', rule: () => 'Each direct deposit equals that employee’s register net pay.' },
    { id: 'F3', stage: 'funding', title: 'Deposit account', rule: () => 'Deposits go to the account on file in the census.' },
    { id: 'F4', stage: 'funding', title: 'ACH returns', rule: () => 'Returned deposits are reissued.' },
    { id: 'F5', stage: 'funding', title: 'Shared bank accounts', rule: () => 'No two employees deposit to the same account.' },
    { id: 'F6', stage: 'funding', title: 'Tax remittance', rule: () => 'Tax impound and remittances by jurisdiction equal register employee + employer taxes.' },
    { id: 'F7', stage: 'funding', title: 'Benefit remittance', rule: () => '401(k) and medical remittances equal register deductions.' },
    { id: 'G1', stage: 'gl', title: 'Journal balances', rule: () => 'Each payroll journal entry balances.' },
    { id: 'G2', stage: 'gl', title: 'Wage expense by cost center', rule: () => 'Wage, premium and PTO expense by account and cost center equal the register.' },
    { id: 'G3', stage: 'gl', title: 'Cost center mapping', rule: () => 'Every cost center maps to an account; nothing in suspense.' },
    { id: 'G4', stage: 'gl', title: 'Employer tax expense', rule: () => 'Employer tax expense equals register employer taxes.' },
    { id: 'G5', stage: 'gl', title: 'Liabilities', rule: () => 'Taxes, 401(k) and medical payables equal the register.' },
    { id: 'G6', stage: 'gl', title: 'Cash', rule: () => 'Cash credit equals the net pay funded at the bank.' },
    { id: 'G7', stage: 'gl', title: 'Vacation accrual', rule: () => 'Accrual true-up equals the change in validated balances.' },
  ];
  const CHECK = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

  const RETURN_CODES = {
    R01: 'Insufficient funds', R02: 'Account closed', R03: 'No account / unable to locate account',
    R04: 'Invalid account number', R16: 'Account frozen', R20: 'Non-transaction account',
  };

  // ------------------------------------------------------------------------------------
  // Classification & pay rules
  // ------------------------------------------------------------------------------------

  function classify(c) {
    const union = !!(c.union_local && c.union_local.trim());
    const exempt = /^exempt$/i.test((c.flsa_status || '').trim());
    const ft = /^(ft|full)/i.test((c.ft_pt || '').trim());
    const salaried = /^sal/i.test((c.pay_type || '').trim());
    const key = union ? (ft ? 'UNION_FT' : 'UNION_PT') : salaried ? 'SALARIED' : ft ? 'HOURLY_FT' : 'HOURLY_PT';
    const label = union
      ? `Union ${ft ? 'FT' : 'PT'} · non-exempt`
      : salaried ? `Salaried · ${exempt ? 'exempt' : 'non-exempt'}` : `Hourly ${ft ? 'FT' : 'PT'} · non-exempt`;
    return { union, exempt, ft, salaried, key, label, glClass: union ? 'UNION' : salaried ? 'SALARIED' : 'HOURLY' };
  }

  function splitHours(cls, daily, dates, cfg) {
    let reg = 0, ot = 0, dt = 0;
    for (let w = 0; w < 2; w++) {
      let total = 0, sun = 0, sat = 0;
      for (let k = w * 7; k < w * 7 + 7; k++) {
        const h = daily[k] || 0;
        total += h;
        const d = dow(dates[k]);
        if (d === 0) sun += h;
        if (d === 6) sat += h;
      }
      if (cls.exempt) { reg += total; continue; }
      if (cls.union) {
        const satPrem = cfg.saturdayPremium ? sat : 0;
        const base = total - sun - satPrem;
        const wot = Math.max(0, base - cfg.unionOtAfter);
        dt += sun;
        ot += wot + satPrem;
        reg += base - wot;
      } else {
        const wot = Math.max(0, total - cfg.flsaOtAfter);
        ot += wot;
        reg += total - wot;
      }
    }
    return { reg: r2(reg), ot: r2(ot), dt: r2(dt) };
  }

  function hourlyEarnings(split, ptoHrs, rate, cfg) {
    return r2(r2(split.reg * rate) + r2(split.ot * rate * cfg.otMultiplier) + r2(split.dt * rate * cfg.sundayMultiplier) + r2(ptoHrs * rate));
  }

  function unionStep(cfg, title, hire, asOf) {
    const table = cfg.unionRates[title];
    if (!table || !cfg.unionSteps.length || !validDate(hire)) return null;
    const yrs = yearsBetween(hire, asOf);
    let idx = 0;
    cfg.unionSteps.forEach((s, i) => { if (yrs >= s.min_years) idx = i; });
    const step = cfg.unionSteps[idx];
    return { rate: table[idx], step: step.step || idx + 1, label: step.label, years: yrs, since: anniversaryOf(hire, Math.ceil(step.min_years)) };
  }

  // ------------------------------------------------------------------------------------
  // Run
  // ------------------------------------------------------------------------------------

  function run(input) {
    const census = input.census || [];
    const schedules = input.schedules || [];
    const time = input.time || [];
    const register = input.register || [];
    const bank = input.bank || [];
    const gl = input.gl || [];
    const cfg = buildConfig(input.agreement, input.handbook, input.glMap, input.settings);
    const glm = cfg.gl;

    // ---- Period
    let start = cfg.periodStart;
    if (!validDate(start)) {
      const dates = time.map((t) => t.work_date).concat(schedules.map((s) => s.work_date)).filter(validDate).sort();
      const first = dates[0] || iso(Date.now());
      start = addDays(first, -dow(first));
    }
    const dates = Array.from({ length: 14 }, (_, i) => addDays(start, i));
    const end = dates[13];
    const achDates = bank.filter((b) => b.txn_type === 'ACH_CREDIT').map((b) => b.value_date).filter(validDate);
    const payDate = mode(achDates) || '';
    const period = {
      start, end, payDate, dates,
      weeks: [
        { index: 0, start: dates[0], end: dates[6], label: `Week 1 (${md(dates[0])}–${md(dates[6])})` },
        { index: 1, start: dates[7], end: dates[13], label: `Week 2 (${md(dates[7])}–${md(dates[13])})` },
      ],
    };
    const dateIdx = Object.fromEntries(dates.map((d, i) => [d, i]));

    // ---- Exceptions
    const exceptions = [];
    const add = (o) => {
      const e = Object.assign({ severity: 'review', impact: null, empId: null, empName: '', date: '', links: [] }, o);
      e.id = 'X' + String(exceptions.length + 1).padStart(3, '0');
      e.stage = CHECK[e.check].stage;
      exceptions.push(e);
      return e;
    };
    const imp = (amount, kind, estimated) => (amount && Math.abs(r2(amount)) >= 0.01 ? { amount: r2(Math.abs(amount)), kind, estimated: !!estimated } : null);

    // ---- People
    const censusById = {};
    census.forEach((c) => { if (c.emp_id) censusById[c.emp_id] = c; });
    const regById = {};
    register.forEach((r) => { if (r.emp_id) regById[r.emp_id] = r; });
    const schedBy = {}, timeBy = {}, wfmNames = {}, wfmLocation = {};
    schedules.forEach((s) => {
      (schedBy[s.emp_id] = schedBy[s.emp_id] || []).push(s);
      if (s.employee_name) wfmNames[s.emp_id] = s.employee_name;
      if (s.location) wfmLocation[s.emp_id] = s.location;
    });
    time.forEach((t) => {
      (timeBy[t.emp_id] = timeBy[t.emp_id] || []).push(t);
      if (t.employee_name) wfmNames[t.emp_id] = t.employee_name;
      if (t.location) wfmLocation[t.emp_id] = t.location;
    });
    const ids = Array.from(new Set([...Object.keys(censusById), ...Object.keys(schedBy), ...Object.keys(timeBy), ...Object.keys(regById)])).sort();
    const ccNames = {};
    census.forEach((c) => { if (c.cost_center && c.location) ccNames[c.cost_center] = c.location; });
    Object.entries(glm.cost_centers || {}).forEach(([cc, name]) => { if (!ccNames[cc]) ccNames[cc] = name; });

    const employees = ids.map((id) => buildEmployee(id));
    const empById = Object.fromEntries(employees.map((e) => [e.id, e]));

    function buildEmployee(id) {
      const c = censusById[id] || null;
      const r = regById[id] || null;
      const name = c ? `${c.first_name} ${c.last_name}`.trim() : wfmNames[id] || (r && r.employee_name) || id;
      const cls = c ? classify(c) : null;
      const hire = c && validDate(c.hire_date) ? c.hire_date : '';
      const term = c && validDate(c.term_date) ? c.term_date : '';
      const inWindow = (d) => (!hire || d >= hire) && (!term || d <= term);
      const days = dates.map((date, i) => ({
        i, date, dow: dow(date), week: i < 7 ? 0 : 1, inWindow: inWindow(date),
        sched: [], schedHours: 0, records: [], worked: 0, pto: {}, ptoHours: 0,
      }));
      (schedBy[id] || []).forEach((s) => {
        const i = dateIdx[s.work_date];
        if (i === undefined) return;
        days[i].sched.push(s);
        days[i].schedHours += num(s.scheduled_hours);
      });
      (timeBy[id] || []).forEach((t) => {
        const i = dateIdx[t.work_date];
        if (i === undefined) return;
        const a = analyzeRecord(t, cfg);
        days[i].records.push(a);
        if (a.code === 'REG') days[i].worked += a.wfmHours;
        else { days[i].pto[a.code] = (days[i].pto[a.code] || 0) + a.wfmHours; days[i].ptoHours += a.wfmHours; }
      });
      const daily = days.map((d) => (d.inWindow ? d.worked : 0));
      const ptoIn = { VAC: 0, SICK: 0, HOL: 0, OTHER: 0 };
      days.forEach((d) => {
        if (!d.inWindow) return;
        Object.entries(d.pto).forEach(([k, v]) => { if (k in ptoIn) ptoIn[k] += v; else ptoIn.OTHER += v; });
      });
      const weekWorked = [0, 1].map((w) => sum(days.filter((d) => d.week === w && d.inWindow), (d) => d.worked));
      const weekPto = [0, 1].map((w) => sum(days.filter((d) => d.week === w && d.inWindow), (d) => d.ptoHours));

      let rate = 0, rateSource = '', scale = null, salaryPeriod = 0, prorate = 1;
      if (c) {
        if (cls.salaried) {
          const wk = dates.filter((d) => dow(d) >= 1 && dow(d) <= 5);
          prorate = wk.filter(inWindow).length / wk.length;
          salaryPeriod = r2((num(c.annual_salary) / cfg.salaryPeriods) * prorate);
          rate = num(c.annual_salary) / 2080;
          rateSource = 'Salary ÷ 2,080';
        } else {
          rate = num(c.hourly_rate);
          rateSource = 'Census rate';
          if (cls.union) {
            scale = unionStep(cfg, c.job_title, hire, end);
            if (scale && scale.rate > rate + 0.001) { rate = scale.rate; rateSource = `${cfg.unionName} step ${scale.step}`; }
          }
        }
      }
      const hasWfm = !!(schedBy[id] || timeBy[id]);
      const emp = {
        id, name, census: c, register: r, cls, hire, term, days, daily, ptoIn, weekWorked, weekPto,
        rate, rateSource, scale, salaryPeriod, prorate, hasWfm,
        title: c ? c.job_title : '', cc: c ? c.cost_center : r ? r.cost_center : '',
        location: c ? c.location || ccNames[c.cost_center] || '' : wfmLocation[id] || '',
        ach: [], exceptions: [],
      };
      emp.wfmWorked = sum(daily);
      emp.wfmPto = ptoIn.VAC + ptoIn.SICK + ptoIn.HOL + ptoIn.OTHER;
      if (c && !cls.salaried) {
        emp.expSplit = splitHours(cls, daily, dates, cfg);
        emp.expectedGross = hourlyEarnings(emp.expSplit, emp.wfmPto, rate, cfg);
      } else if (c) {
        emp.expSplit = cls.exempt ? { reg: 0, ot: 0, dt: 0 } : splitHours(cls, daily, dates, cfg);
        emp.expectedGross = salaryPeriod;
      } else {
        emp.expSplit = null;
        emp.expectedGross = null;
      }
      return emp;
    }

    // value of changing one day's worked hours for an hourly non-exempt employee
    const deltaValue = (emp, dayIndex, newHours) => {
      if (!emp.census || emp.cls.salaried || emp.cls.exempt) return 0;
      const d2 = emp.daily.slice();
      d2[dayIndex] = newHours;
      const a = hourlyEarnings(splitHours(emp.cls, emp.daily, dates, cfg), 0, emp.rate, cfg);
      const b = hourlyEarnings(splitHours(emp.cls, d2, dates, cfg), 0, emp.rate, cfg);
      return r2(b - a);
    };
    const nonExemptHourly = (emp) => emp.census && !emp.cls.salaried && !emp.cls.exempt;
    const expectedWeekly = (emp) => {
      if (!emp.cls) return null;
      if (emp.cls.key === 'UNION_FT') return cfg.unionFtWeekly;
      if (emp.cls.key === 'HOURLY_FT') return cfg.nonUnionFtWeekly;
      if (emp.cls.salaried && emp.cls.ft) return cfg.exemptWeekly;
      return null;
    };

    // =================================================================================
    // Stage 1 — Time & attendance
    // =================================================================================
    const t1Days = new Set();
    employees.forEach((emp) => {
      if (!emp.hasWfm) return;
      const flaggedRoster = (d) => emp.census && !d.inWindow; // reported by R3 / R4

      // T1 punch completeness, T3 rounding, T8 daily max
      emp.days.forEach((d) => {
        if (flaggedRoster(d)) return;
        d.records.forEach((a) => {
          const t = a.raw;
          const sched = d.sched[0];
          if (a.flags.includes('MISSING_OUT') || a.flags.includes('MISSING_IN')) {
            t1Days.add(emp.id + d.date);
            const missing = a.flags.includes('MISSING_OUT') ? 'check-out' : 'check-in';
            const shortBy = Math.max(0, d.schedHours - a.wfmHours);
            const val = nonExemptHourly(emp) ? deltaValue(emp, d.i, emp.daily[d.i] + shortBy) : 0;
            add({
              check: 'T1', severity: 'blocker', empId: emp.id, empName: emp.name, date: d.date,
              title: `No ${missing} on ${fmtDate(d.date)}`,
              detail: a.flags.includes('MISSING_OUT')
                ? `Checked in at ${t.punch_in}${t.meal_out ? `, took a meal ${t.meal_out}–${t.meal_in || '?'}` : ''} and never checked out. WFM credited ${fmtH(a.wfmHours)}${sched ? ` against a ${fmtH(d.schedHours)} scheduled shift (${sched.shift_start}–${sched.shift_end})` : ''}.`
                : `Check-out at ${t.punch_out} with no check-in. WFM credited ${fmtH(a.wfmHours)}.`,
              expected: sched ? `${fmtH(d.schedHours)} scheduled` : 'Complete punch pair', actual: `${fmtH(a.wfmHours)} credited`,
              impact: imp(val, 'underpaid', true), owner: 'Store manager',
              action: `Confirm the actual ${missing} time with ${emp.name.split(' ')[0]} and correct the timecard before WFM close.`,
            });
          }
          if (a.flags.includes('MISSING_MEAL_IN') || a.flags.includes('MISSING_MEAL_OUT')) {
            t1Days.add(emp.id + d.date);
            const over = Math.max(0, a.wfmHours - (d.schedHours || a.wfmHours));
            const val = over && nonExemptHourly(emp) ? -deltaValue(emp, d.i, emp.daily[d.i] - over) : 0;
            add({
              check: 'T1', severity: 'review', empId: emp.id, empName: emp.name, date: d.date,
              title: `Meal break with no return punch on ${fmtDate(d.date)}`,
              detail: `Checked out for a meal at ${t.meal_out || '?'} and never punched back in; checked out for the day at ${t.punch_out}. WFM credited the full ${fmtH(a.wfmHours)} span${sched ? `, ${signedH(a.wfmHours - d.schedHours)} over the ${fmtH(d.schedHours)} shift` : ''}, so the meal was paid${over ? ' and the extra hour lands in overtime' : ''}.`,
              expected: sched ? `${fmtH(d.schedHours)} after meal` : 'Meal deducted', actual: `${fmtH(a.wfmHours)} credited`,
              impact: imp(val, 'overpaid', true), owner: 'Store manager',
              action: 'Confirm the return-from-meal time and deduct the meal. Remind the team that meal breaks need both punches.',
            });
          }
          if (a.flags.includes('NO_MEAL')) {
            add({
              check: 'T1', severity: 'review', empId: emp.id, empName: emp.name, date: d.date,
              title: `No meal punches on a ${fmtH(a.computed)} shift`,
              detail: `${fmtDate(d.date)}: ${t.punch_in}–${t.punch_out} with no meal punches. The handbook requires a recorded meal after ${cfg.mealRequiredAfter}h.`,
              expected: 'Meal out / meal in', actual: 'None recorded', owner: 'Store manager',
              action: 'Confirm whether a meal was taken; if not, review meal-break compliance for this location.',
            });
          }
          if (a.computed !== null && !near(a.computed, a.wfmHours, 0.01)) {
            const startSched = sched ? toMin(sched.shift_start) : null;
            const snapped = startSched !== null && toMin(t.punch_in) < startSched && a.computed > a.wfmHours;
            const val = nonExemptHourly(emp) ? deltaValue(emp, d.i, emp.daily[d.i] - a.wfmHours + a.computed) : 0;
            add({
              check: 'T3', severity: 'review', empId: emp.id, empName: emp.name, date: d.date,
              title: `WFM hours differ from punches on ${fmtDate(d.date)}`,
              detail: `Punches ${t.punch_in}–${t.punch_out}${t.meal_out ? ` (meal ${t.meal_out}–${t.meal_in})` : ''} round to ${fmtH(a.computed)} under the ${cfg.punchRounding}-minute rule; WFM credited ${fmtH(a.wfmHours)}.${snapped ? ` WFM snapped the ${t.punch_in} check-in to the ${sched.shift_start} schedule start.` : ''}`,
              expected: fmtH(a.computed), actual: fmtH(a.wfmHours),
              impact: imp(val, val >= 0 ? 'underpaid' : 'overpaid'), owner: 'WFM admin',
              action: snapped ? 'Turn off schedule snapping for early punches at this location and pay the uncredited time.' : 'Recalculate the timecard with the standard rounding rule.',
            });
          }
          if (a.code === 'REG' && a.wfmHours > cfg.dailyMaxHours) {
            add({
              check: 'T8', severity: 'review', empId: emp.id, empName: emp.name, date: d.date,
              title: `${fmtH(a.wfmHours)} shift on ${fmtDate(d.date)}`,
              detail: `${t.punch_in || '—'}–${t.punch_out || '—'} exceeds the ${cfg.dailyMaxHours}h daily maximum${d.schedHours ? ` (scheduled ${fmtH(d.schedHours)})` : ''}.`,
              expected: `≤ ${cfg.dailyMaxHours}h`, actual: fmtH(a.wfmHours), owner: 'Store manager',
              action: 'Confirm the double shift was approved and staffed intentionally.',
            });
          }
        });
      });

      // T2 overrides (aggregated per employee)
      const ov = [];
      emp.days.forEach((d) => {
        if (flaggedRoster(d)) return;
        d.records.forEach((a) => { if (a.flags.includes('OVERRIDE') || a.flags.includes('NO_PUNCH')) ov.push({ d, a }); });
      });
      if (ov.length) {
        const hours = sum(ov, (x) => x.a.wfmHours);
        const by = Array.from(new Set(ov.map((x) => x.a.raw.override_by).filter(Boolean)));
        const reason = Array.from(new Set(ov.map((x) => x.a.raw.override_reason).filter(Boolean)));
        const unapproved = ov.some((x) => x.a.flags.includes('NO_PUNCH'));
        add({
          check: 'T2', severity: unapproved ? 'blocker' : 'review', empId: emp.id, empName: emp.name,
          title: `${ov.length} day${ov.length > 1 ? 's' : ''} of hours with no punches`,
          detail: `${ov.map((x) => `${fmtDate(x.d.date)} (${fmtH(x.a.wfmHours)})`).join(', ')} entered ${by.length ? `by ${by.join(', ')}` : 'without an approver'}${reason.length ? ` — “${reason.join('; ')}”` : ''}. ${fmtH(hours)}${emp.rate && nonExemptHourly(emp) ? ` (${money(hours * emp.rate)})` : ''} paid on manager attestation alone.`,
          expected: 'Punches or documented approval', actual: `${ov.length} override${ov.length > 1 ? 's' : ''}`, owner: 'Store manager',
          action: unapproved ? 'Hours without punches and without an approval must be approved or removed.' : 'Payroll to sign off the overrides; repeat overrides for one associate warrant coaching on punching.',
        });
      }

      // T4 schedule vs actual
      const variance = [];
      emp.days.forEach((d) => {
        if (flaggedRoster(d)) return;
        const hasTime = d.records.length > 0;
        if (d.schedHours > 0 && !hasTime) {
          const s = d.sched[0];
          add({
            check: 'T4', severity: 'review', empId: emp.id, empName: emp.name, date: d.date,
            title: `No-show on ${fmtDate(d.date)}`,
            detail: `Scheduled ${s.shift_start}–${s.shift_end} (${fmtH(d.schedHours)})${s.schedule_source ? ` via ${s.schedule_source}` : ''}; no punches and no time-off code.`,
            expected: `${fmtH(d.schedHours)} scheduled`, actual: 'No record', owner: 'Store manager',
            action: 'Confirm whether the shift was worked (missing punches), covered, or an unexcused absence; code PTO if applicable.',
          });
          return;
        }
        if (!(emp.census && emp.cls && !emp.cls.exempt)) return;
        if (d.schedHours === 0 && d.worked > 0) {
          add({
            check: 'T4', severity: 'review', empId: emp.id, empName: emp.name, date: d.date,
            title: `Unscheduled shift on ${fmtDate(d.date)}`,
            detail: `Worked ${fmtH(d.worked)} with no scheduled shift.${emp.cls.union && d.dow === 0 ? ` Union Sunday hours pay at ${cfg.sundayMultiplier}x.` : ''}`,
            expected: 'No shift', actual: `${fmtH(d.worked)} worked`, owner: 'Store manager',
            action: 'Confirm the shift was authorized and add it to the schedule of record.',
          });
          return;
        }
        if (d.schedHours > 0 && !t1Days.has(emp.id + d.date) && !d.records.some((a) => a.flags.length)) {
          const diff = d.worked + d.ptoHours - d.schedHours;
          if (Math.abs(diff) >= cfg.scheduleVarianceHours - 1e-9) variance.push({ d, diff });
        }
      });
      if (variance.length) {
        const net = sum(variance, (v) => v.diff);
        add({
          check: 'T4', severity: 'info', empId: emp.id, empName: emp.name,
          title: `${variance.length} day${variance.length > 1 ? 's' : ''} off schedule (net ${signedH(net)})`,
          detail: variance.map((v) => `${fmtDate(v.d.date)} ${signedH(v.diff)}`).join(', ') + '.',
          expected: 'Within ±' + fmtH(cfg.scheduleVarianceHours), actual: signedH(net), owner: 'Store manager',
          action: 'Review early departures and extended shifts with the associate.',
        });
      }

      if (!emp.census) return;
      const exp = expectedWeekly(emp);
      period.weeks.forEach((w) => {
        const wd = emp.days.filter((d) => d.week === w.index);
        const worked = sum(wd.filter((d) => d.inWindow), (d) => d.worked);
        const ptoH = sum(wd.filter((d) => d.inWindow), (d) => d.ptoHours);
        // T5 short weeks
        if (exp) {
          const wk = wd.filter((d) => d.dow >= 1 && d.dow <= 5);
          const frac = wk.filter((d) => d.inWindow).length / 5;
          const expected = r2(exp * frac);
          const acct = worked + ptoH;
          if (expected > 0 && acct < expected - 0.01) {
            const causes = [];
            wd.forEach((d) => {
              if (t1Days.has(emp.id + d.date)) causes.push(`missing punch ${fmtDate(d.date)}`);
              else if (d.schedHours > 0 && !d.records.length && d.inWindow) causes.push(`no-show ${fmtDate(d.date)}`);
            });
            add({
              check: 'T5', severity: 'review', empId: emp.id, empName: emp.name,
              title: `${w.label}: ${fmtH(acct)} of ${fmtH(expected)}`,
              detail: `${fmtH(worked)} worked + ${fmtH(ptoH)} time off against a ${fmtH(expected)} ${emp.cls.key === 'UNION_FT' ? 'union full-time' : emp.cls.salaried ? 'exempt full-time' : 'full-time'} week${frac < 1 ? ' (prorated for employment dates)' : ''} — ${fmtH(expected - acct)} not accounted for${causes.length ? `. Linked: ${causes.join(', ')}` : ''}.${emp.cls.exempt ? ' Exempt salary cannot be docked for partial days under the FLSA; code PTO if policy requires it.' : ''}`,
              expected: fmtH(expected), actual: fmtH(acct), owner: emp.cls.exempt ? 'HR' : 'Store manager',
              action: emp.cls.exempt ? 'Ask the employee to code PTO for the missing time or confirm it was worked.' : 'Confirm whether the time was worked, should be coded as PTO, or is unpaid.',
            });
          }
        }
        // T7 part-time cap (collected below)
        // T6 overtime due
        if (!emp.cls.exempt && !emp.cls.salaried) {
          const wdaily = emp.daily.map((h, i) => (Math.floor(i / 7) === w.index ? h : 0));
          const s = splitHours(emp.cls, wdaily, dates, cfg);
          if (s.ot > 0 || s.dt > 0) {
            add({
              check: 'T6', severity: 'info', empId: emp.id, empName: emp.name,
              title: `${w.label}: premium hours due`,
              detail: `${fmtH(worked)} worked → ${[s.ot ? `${fmtH(s.ot)} at ${cfg.otMultiplier}x` : '', s.dt ? `${fmtH(s.dt)} Sunday at ${cfg.sundayMultiplier}x` : ''].filter(Boolean).join(', ')} under the ${emp.cls.union ? cfg.unionName + ' agreement' : 'FLSA weekly rule'}. Checked against the register in P4.`,
              expected: [s.ot ? `${fmtH(s.ot)} OT` : '', s.dt ? `${fmtH(s.dt)} DT` : ''].filter(Boolean).join(' + '), actual: fmtH(worked), owner: 'Payroll',
              action: 'No action unless P4 flags the register.',
            });
          }
        }
      });
      // T7 part-time cap
      if (emp.cls && !emp.cls.ft) {
        const over = period.weeks.map((w) => ({ w, h: emp.weekWorked[w.index] })).filter((x) => x.h > cfg.ptMaxWeekly + 1e-9);
        if (over.length) {
          const avg = (emp.weekWorked[0] + emp.weekWorked[1]) / 2;
          add({
            check: 'T7', severity: 'review', empId: emp.id, empName: emp.name,
            title: `Part-time over ${cfg.ptMaxWeekly}h in ${over.length === 2 ? 'both weeks' : over[0].w.label.split(' (')[0]}`,
            detail: `${over.map((x) => `${x.w.label.split(' (')[0]} ${fmtH(x.h)}`).join(', ')} against the ${cfg.ptMaxWeekly}h part-time cap (period average ${fmtH(r2(avg))}). Sustained hours over the cap move the associate into the full-time benefits class.`,
            expected: `≤ ${cfg.ptMaxWeekly}h / week`, actual: over.map((x) => fmtH(x.h)).join(' · '), owner: 'Store manager',
            action: 'Bring scheduled hours back under the cap, or review benefits eligibility with HR.',
          });
        }
      }

      // T9 pay codes, T10 balances
      const used = { VAC: 0, SICK: 0 };
      emp.days.forEach((d) => {
        if (!d.inWindow) return;
        d.records.forEach((a) => {
          if (a.code !== 'REG' && !cfg.validCodes.includes(a.code)) {
            add({
              check: 'T9', severity: 'blocker', empId: emp.id, empName: emp.name, date: d.date,
              title: `Unknown pay code ${a.code} on ${fmtDate(d.date)}`,
              detail: `${fmtH(a.wfmHours)} coded ${a.code}, which is not on the handbook list (${cfg.validCodes.join(', ')}).${/CO$/.test(a.code) ? ' The handbook has no carryover bank for this time type.' : ''}`,
              expected: cfg.validCodes.join(' / '), actual: a.code, owner: 'WFM admin',
              impact: imp(nonExemptHourly(emp) ? a.wfmHours * emp.rate : 0, 'overpaid'),
              action: 'Recode to a valid pay code before WFM close.',
            });
          }
          if (a.code === 'HOL' && !cfg.holidays.includes(d.date)) {
            const prev = cfg.holidays.filter((h) => h < d.date).sort().pop();
            add({
              check: 'T9', severity: 'blocker', empId: emp.id, empName: emp.name, date: d.date,
              title: `Holiday pay on ${fmtDate(d.date)}, not a company holiday`,
              detail: `${fmtH(a.wfmHours)} coded HOL on ${fmtDate(d.date)}, which is not on the company holiday calendar.${prev ? ` The most recent company holiday was ${fmtDate(prev)}.` : ''}`,
              expected: 'Company holiday', actual: `HOL ${fmtH(a.wfmHours)}`, owner: 'WFM admin',
              impact: imp(nonExemptHourly(emp) ? a.wfmHours * emp.rate : 0, 'overpaid'),
              action: 'Remove the HOL code (or move it to the correct holiday date) before WFM close.',
            });
          }
          if (a.code === 'VAC' || a.code === 'SICK') used[a.code] += a.wfmHours;
        });
      });
      const c = emp.census;
      const vacAvail = num(c.vac_carryover_hrs) + num(c.vac_current_hrs);
      const sickAvail = num(c.sick_hrs);
      [['VAC', 'Vacation', vacAvail], ['SICK', 'Sick', sickAvail]].forEach(([code, label, avail]) => {
        if (used[code] > avail + 1e-9) {
          const excess = used[code] - avail;
          add({
            check: 'T10', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: `${label} coded beyond balance by ${fmtH(excess)}`,
            detail: `${fmtH(used[code])} ${label.toLowerCase()} coded against an available balance of ${fmtH(avail)}${code === 'SICK' && !cfg.sickCarryover ? ' (sick time is front-loaded; there is no sick carryover bank)' : ''}. The register will pay the full ${fmtH(used[code])} and leave a ${fmtH(-excess)} balance.`,
            expected: `≤ ${fmtH(avail)}`, actual: fmtH(used[code]), owner: 'Payroll',
            impact: imp(excess * emp.rate, 'overpaid'),
            action: `Recode ${fmtH(excess)} as unpaid time, or document an approved advance per the handbook.`,
          });
        }
      });
    });

    // =================================================================================
    // Stage 2 — Roster match
    // =================================================================================
    const medianRate = (loc) => {
      const rates = census.filter((c) => (!loc || c.location === loc) && num(c.hourly_rate) > 0).map((c) => num(c.hourly_rate)).sort((a, b) => a - b);
      if (!rates.length) return loc ? medianRate('') : 0;
      return rates[Math.floor(rates.length / 2)];
    };
    employees.forEach((emp) => {
      const c = emp.census;
      if (!c && emp.hasWfm) {
        const worked = sum(emp.days, (d) => d.worked);
        const firstDay = emp.days.find((d) => d.records.length);
        const rate = medianRate(emp.location);
        add({
          check: 'R1', severity: 'blocker', empId: emp.id, empName: emp.name,
          title: 'Working in WFM, missing from payroll',
          detail: `${emp.name} has ${emp.days.filter((d) => d.worked > 0).length} shifts (${fmtH(worked)}) in WFM${emp.location ? ` at ${emp.location}` : ''}${firstDay ? ` starting ${fmtDate(firstDay.date)}` : ''}, but no payroll record. ${period.payDate ? `They will not be paid on ${fmtDate(period.payDate)}.` : 'They will not be paid.'} Estimate uses the location median rate of ${money(rate)}.`,
          expected: 'Payroll record', actual: 'WFM only', owner: 'HR',
          impact: imp(worked * rate, 'underpaid', true),
          action: 'Complete payroll onboarding (rate, W-4, direct deposit) and add to this cycle or run an off-cycle payment.',
        });
        return;
      }
      if (!c) return;
      const active = !emp.term || emp.term >= period.start;
      if (!emp.hasWfm && (active || emp.register)) {
        const r = emp.register;
        if (r && num(r.gross_pay) > 0) {
          const shared = census.filter((o) => o.emp_id !== emp.id && o.bank_last4 && o.bank_last4 === c.bank_last4 && (o.bank_routing || '') === (c.bank_routing || ''));
          add({
            check: 'R2', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: 'Paid in payroll with no WFM profile or time',
            detail: `${emp.name} (${c.job_title}, ${emp.cc}) is paid ${money(num(r.gross_pay))} gross for ${fmtH(num(r.reg_hrs) + num(r.ot_hrs) + num(r.dt_hrs))} on the register, but has no WFM profile, schedule or time record. Payroll hire date ${fmtDate(c.hire_date)}.${shared.length ? ` Deposit account ****${c.bank_last4} is shared with ${shared.map((o) => `${o.emp_id} ${o.first_name} ${o.last_name} (${o.job_title})`).join(', ')}.` : ''} Pattern consistent with a ghost employee.`,
            expected: 'WFM time supports pay', actual: `${money(num(r.gross_pay))} paid, 0h in WFM`, owner: 'Payroll',
            impact: imp(num(r.gross_pay), 'overpaid'),
            action: 'Hold the payment, confirm employment with the hiring manager and HR, and review who created the payroll record and keyed the hours.',
          });
        } else {
          add({
            check: 'R2', severity: 'review', empId: emp.id, empName: emp.name,
            title: 'Active in payroll, no WFM time and no pay',
            detail: `${emp.name} (${c.job_title}, ${emp.cc}) is active in payroll since ${fmtDate(c.hire_date)} but has no WFM schedule or time this period and is not on the register.`,
            expected: 'Time or leave status', actual: 'Nothing recorded', owner: 'HR',
            action: 'Confirm whether the employee is on leave (update status) or missing from the WFM feed (fix the profile and collect time).',
          });
        }
      }
      // R3 / R4
      const pre = emp.days.filter((d) => emp.hire && d.date < emp.hire && (d.records.length || d.sched.length));
      if (pre.length) {
        const worked = sum(pre, (d) => d.worked);
        const workedDays = pre.filter((d) => d.worked > 0);
        let val = worked * emp.rate;
        if (emp.cls.salaried) val = workedDays.filter((d) => d.dow >= 1 && d.dow <= 5).length * (num(c.annual_salary) / cfg.salaryPeriods / 10);
        if (worked > 0) {
          add({
            check: 'R3', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: `Worked ${workedDays.length} day${workedDays.length > 1 ? 's' : ''} before the payroll hire date`,
            detail: `WFM shows ${workedDays.map((d) => fmtDate(d.date)).join(', ')} (${fmtH(worked)}), but payroll has a hire date of ${fmtDate(emp.hire)}. ${emp.cls.salaried ? `Salary is prorated from ${fmtDate(emp.hire)}, so those days are unpaid.` : 'Hours before the hire date are excluded from pay.'}`,
            expected: `Hire ${fmtDate(workedDays[0].date)}`, actual: `Hire ${fmtDate(emp.hire)}`, owner: 'HR',
            impact: imp(val, 'underpaid'),
            action: 'Correct the hire date in payroll (the authoritative source) and pay the missing days, or confirm the WFM start date is wrong.',
          });
        }
      }
      const post = emp.days.filter((d) => emp.term && d.date > emp.term && (d.records.length || d.sched.length));
      if (post.length) {
        const recs = post.filter((d) => d.records.length);
        const worked = sum(recs, (d) => d.worked);
        const by = Array.from(new Set(recs.flatMap((d) => d.records.map((a) => a.raw.override_by)).filter(Boolean)));
        const r = emp.register;
        const regWorked = r ? num(r.reg_hrs) + num(r.ot_hrs) + num(r.dt_hrs) : 0;
        const paidPost = r ? Math.max(0, regWorked - emp.wfmWorked) : 0;
        add({
          check: 'R4', severity: 'blocker', empId: emp.id, empName: emp.name,
          title: 'Time recorded after termination',
          detail: `Terminated ${fmtDate(emp.term)} in payroll. WFM still has ${recs.length} time record${recs.length === 1 ? '' : 's'} after that date (${fmtH(worked)}${by.length ? `, entered by ${by.join(', ')}` : ''}) and ${post.filter((d) => d.sched.length && !d.records.length).length} more scheduled shifts. ${paidPost > 0 ? `The register paid ${fmtH(paidPost)} beyond the termination date.` : `The register paid through ${fmtDate(emp.term)} only.`}`,
          expected: `Nothing after ${md(emp.term)}`, actual: `${recs.length} records, ${fmtH(worked)}`, owner: 'WFM admin',
          impact: imp(paidPost * emp.rate, 'overpaid'),
          action: 'Deactivate the WFM profile, delete the auto-filled records, and remove future shifts from the Excel schedule.',
        });
      }
    });

    // =================================================================================
    // Stage 3 — Payroll register
    // =================================================================================
    const regTotals = { gross: 0, net: 0, eeTax: 0, erTax: 0, k401: 0, medical: 0 };
    employees.forEach((emp) => {
      const r = emp.register;
      const c = emp.census;
      if (!r) {
        if (c && emp.wfmWorked > 0) {
          add({
            check: 'P10', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: 'Approved time but not on the register',
            detail: `${fmtH(emp.wfmWorked)} approved in WFM within employment dates, but there is no register line.`,
            expected: 'Register line', actual: 'Missing', owner: 'Payroll',
            impact: imp(emp.expectedGross, 'underpaid', true),
            action: 'Add the employee to the payroll batch before release.',
          });
        }
        return;
      }
      const R = {};
      SCHEMAS.register.forEach((k) => { R[k] = k === 'emp_id' || k === 'cost_center' || k === 'pay_type' || k === 'work_state' || k === 'bank_last4' || k === 'employee_name' ? r[k] : num(r[k]); });
      emp.R = R;
      const eeTax = R.fed_wh + R.ss_ee + R.medicare_ee + R.state_wh + R.state_other_ee;
      const erTax = R.ss_er + R.medicare_er + R.futa_er + R.sui_er;
      regTotals.gross += R.gross_pay; regTotals.net += R.net_pay; regTotals.eeTax += eeTax; regTotals.erTax += erTax;
      regTotals.k401 += R.k401_ee; regTotals.medical += R.medical_ee;
      if (!c) return; // reported in roster stage

      const salaried = emp.cls.salaried;
      const regPtoHrs = R.vac_hrs + R.sick_hrs + R.hol_hrs;
      const equivHours = R.reg_hrs + R.ot_hrs * cfg.otMultiplier + R.dt_hrs * cfg.sundayMultiplier + regPtoHrs;

      // P1 rate / salary / type / cost center
      const regIsSalary = /^sal/i.test(R.pay_type);
      if (regIsSalary !== salaried) {
        add({ check: 'P1', severity: 'blocker', empId: emp.id, empName: emp.name, title: 'Pay type differs from census', detail: `Register pays ${R.pay_type}; census pay type is ${c.pay_type}.`, expected: c.pay_type, actual: R.pay_type, owner: 'Payroll', action: 'Correct the pay type on the employee record and recalculate.' });
      } else if (!salaried) {
        const censusRate = num(c.hourly_rate);
        if (!near(R.rate, censusRate, 0.001)) {
          const val = (censusRate - R.rate) * equivHours;
          add({
            check: 'P1', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: `Register rate ${money(R.rate)} vs census ${money(censusRate)}`,
            detail: `The register paid ${fmtH(R.reg_hrs + R.ot_hrs + R.dt_hrs + regPtoHrs)} at ${money(R.rate)}/h; the census rate is ${money(censusRate)}/h.${R.rate.toFixed(2).split('').sort().join('') === censusRate.toFixed(2).split('').sort().join('') ? ' Same digits in a different order: likely a keying transposition.' : ''}`,
            expected: money(censusRate), actual: money(R.rate), owner: 'Payroll',
            impact: imp(val, val > 0 ? 'underpaid' : 'overpaid'),
            action: 'Correct the rate in the payroll batch before release.',
          });
        }
      } else {
        const paid = r2(R.reg_pay + R.pto_pay);
        if (!near(paid, emp.salaryPeriod, 0.011)) {
          add({
            check: 'P1', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: `Salary ${money(paid)} vs expected ${money(emp.salaryPeriod)}`,
            detail: `${money(num(c.annual_salary))} ÷ ${cfg.salaryPeriods}${emp.prorate < 1 ? ` × ${Math.round(emp.prorate * 10)}/10 days employed` : ''} = ${money(emp.salaryPeriod)}.`,
            expected: money(emp.salaryPeriod), actual: money(paid), owner: 'Payroll',
            impact: imp(emp.salaryPeriod - paid, emp.salaryPeriod > paid ? 'underpaid' : 'overpaid'),
            action: 'Correct the salary amount in the batch.',
          });
        }
      }
      if (R.cost_center && c.cost_center && R.cost_center !== c.cost_center) {
        add({ check: 'P1', severity: 'review', empId: emp.id, empName: emp.name, title: 'Cost center differs from census', detail: `Register charges ${R.cost_center}; census home cost center is ${c.cost_center}.`, expected: c.cost_center, actual: R.cost_center, owner: 'Payroll', action: 'Confirm a labor transfer or correct the cost center.' });
      }

      // P2 union scale
      if (emp.cls.union) {
        const s = emp.scale;
        const censusRate = num(c.hourly_rate);
        if (!s) {
          add({ check: 'P2', severity: 'review', empId: emp.id, empName: emp.name, title: `Title not in the ${cfg.unionName} rate table`, detail: `“${c.job_title}” has no rate row in the agreement.`, expected: 'Title in rate table', actual: c.job_title, owner: 'HR', action: 'Map the title to a contract classification.' });
        } else if (censusRate < s.rate - 0.001) {
          const val = (s.rate - censusRate) * equivHours;
          const weeksSince = Math.max(0, Math.floor((D(end) - D(s.since)) / (7 * 864e5)));
          const weekly = emp.cls.ft ? cfg.unionFtWeekly : (emp.weekWorked[0] + emp.weekWorked[1]) / 2;
          const retro = (s.rate - censusRate) * weekly * weeksSince;
          add({
            check: 'P2', severity: 'blocker', empId: emp.id, empName: emp.name,
            title: `Below contract step ${s.step}: ${money(censusRate)} vs ${money(s.rate)}`,
            detail: `${c.job_title} with ${s.years.toFixed(1)} years of service (seniority date ${md(c.hire_date)}/${c.hire_date.slice(0, 4)}) is step ${s.step} (${s.label}) at ${money(s.rate)}/h since the ${md(s.since)}/${s.since.slice(0, 4)} anniversary. Census and register still pay ${money(censusRate)}. Retro exposure since the anniversary ≈ ${money(retro)} (${weeksSince} weeks at ${fmtH(weekly)}).`,
            expected: money(s.rate), actual: money(censusRate), owner: 'HR',
            impact: imp(val, 'underpaid'),
            action: 'Apply the step increase in payroll, pay this period at the contract rate, and calculate retro pay back to the anniversary.',
          });
        }
      }

      // P3 hours tie-out & P4 premium split (hourly) ; P5 exempt OT
      if (emp.hasWfm) {
        const codes = [['VAC', R.vac_hrs], ['SICK', R.sick_hrs], ['HOL', R.hol_hrs]];
        const ptoDiffs = codes.filter(([k, v]) => !near(v, emp.ptoIn[k], 0.01));
        const regWorked = R.reg_hrs + R.ot_hrs + R.dt_hrs;
        if (!salaried) {
          const workedDiff = r2(regWorked - emp.wfmWorked);
          const regSplit = { reg: R.reg_hrs, ot: R.ot_hrs, dt: R.dt_hrs };
          const valued = (sp, pto) => hourlyEarnings(sp, pto, R.rate, cfg);
          const val = valued(regSplit, regPtoHrs) - valued(emp.expSplit, emp.wfmPto);
          if (Math.abs(workedDiff) > 0.01 || ptoDiffs.length) {
            const parts = [];
            if (Math.abs(workedDiff) > 0.01) parts.push(`${fmtH(regWorked)} worked hours on the register vs ${fmtH(emp.wfmWorked)} approved in WFM (${signedH(workedDiff)})`);
            ptoDiffs.forEach(([k, v]) => parts.push(`${k} ${fmtH(v)} on the register vs ${fmtH(emp.ptoIn[k])} coded in WFM`));
            const sickAsReg = workedDiff > 0 && emp.ptoIn.SICK > 0 && near(workedDiff, emp.ptoIn.SICK, 0.01) && near(R.sick_hrs, emp.ptoIn.SICK, 0.01);
            add({
              check: 'P3', severity: 'blocker', empId: emp.id, empName: emp.name,
              title: `Register hours ${signedH(workedDiff + sum(ptoDiffs, ([k, v]) => v - emp.ptoIn[k]))} vs approved time`,
              detail: parts.join('; ') + '.' + (sickAsReg ? ` The ${fmtH(emp.ptoIn.SICK)} sick day was paid as sick and again as regular time.` : ''),
              expected: `${fmtH(emp.wfmWorked)} + ${fmtH(emp.wfmPto)} PTO`, actual: `${fmtH(regWorked)} + ${fmtH(regPtoHrs)} PTO`, owner: 'Payroll',
              impact: imp(val, val > 0 ? 'overpaid' : 'underpaid'),
              action: 'Re-import approved WFM hours into the batch; remove manually keyed hours.',
            });
          } else if (!near(R.reg_hrs, emp.expSplit.reg, 0.01) || !near(R.ot_hrs, emp.expSplit.ot, 0.01) || !near(R.dt_hrs, emp.expSplit.dt, 0.01)) {
            const e = emp.expSplit;
            let why = '';
            if (e.ot > R.ot_hrs && R.dt_hrs === e.dt) why = `${fmtH(e.ot - R.ot_hrs)} of overtime was paid at straight time.`;
            else if (e.dt > R.dt_hrs && R.ot_hrs > e.ot) why = `${fmtH(e.dt - R.dt_hrs)} of Sunday hours were paid at ${cfg.otMultiplier}x instead of ${cfg.sundayMultiplier}x.`;
            add({
              check: 'P4', severity: 'blocker', empId: emp.id, empName: emp.name,
              title: 'Overtime / premium split is wrong',
              detail: `Expected ${fmtH(e.reg)} regular, ${fmtH(e.ot)} at ${cfg.otMultiplier}x, ${fmtH(e.dt)} at ${cfg.sundayMultiplier}x from WFM time under the ${emp.cls.union ? cfg.unionName + ' agreement' : 'FLSA weekly rule'}; register has ${fmtH(R.reg_hrs)} / ${fmtH(R.ot_hrs)} / ${fmtH(R.dt_hrs)}. ${why}`.trim(),
              expected: `${fmtH(e.reg)} / ${fmtH(e.ot)} / ${fmtH(e.dt)}`, actual: `${fmtH(R.reg_hrs)} / ${fmtH(R.ot_hrs)} / ${fmtH(R.dt_hrs)}`, owner: 'Payroll',
              impact: imp(val, val > 0 ? 'overpaid' : 'underpaid'),
              action: 'Recalculate premium hours with the weekly rule and union Sunday premium before release.',
            });
          }
        } else if (ptoDiffs.length) {
          add({
            check: 'P3', severity: 'review', empId: emp.id, empName: emp.name, title: 'Time-off hours differ from WFM',
            detail: ptoDiffs.map(([k, v]) => `${k} ${fmtH(v)} on the register vs ${fmtH(emp.ptoIn[k])} in WFM`).join('; ') + '. Salary is unchanged, but balances will be wrong.',
            expected: fmtH(emp.wfmPto), actual: fmtH(regPtoHrs), owner: 'Payroll', action: 'Align time-off hours with WFM.',
          });
        }
      }
      if (emp.cls.exempt && (R.ot_hrs > 0 || R.dt_hrs > 0 || R.ot_pay > 0 || R.dt_pay > 0)) {
        add({
          check: 'P5', severity: 'blocker', empId: emp.id, empName: emp.name,
          title: `Exempt employee paid ${fmtH(R.ot_hrs + R.dt_hrs)} overtime`,
          detail: `${c.job_title} is exempt salaried (${money(num(c.annual_salary))}/yr) but the register pays ${money(R.ot_pay + R.dt_pay)} overtime for ${fmtH(R.ot_hrs + R.dt_hrs)}. WFM shows ${fmtH(Math.max(...emp.weekWorked))} in the longest week; exempt pay does not change with hours.`,
          expected: '$0.00 overtime', actual: money(R.ot_pay + R.dt_pay), owner: 'Payroll',
          impact: imp(R.ot_pay + R.dt_pay, 'overpaid'),
          action: 'Remove the overtime earning. If the role should be non-exempt, take it to HR for a classification review.',
        });
      }

      // P6 earnings math
      const mathIssues = [];
      if (!salaried) {
        if (!near(R.reg_pay, r2(R.reg_hrs * R.rate), 0.011)) mathIssues.push(`regular ${money(R.reg_pay)} vs ${money(R.reg_hrs * R.rate)}`);
        if (!near(R.ot_pay, r2(R.ot_hrs * R.rate * cfg.otMultiplier), 0.011)) mathIssues.push(`overtime ${money(R.ot_pay)} vs ${money(R.ot_hrs * R.rate * cfg.otMultiplier)}`);
        if (!near(R.dt_pay, r2(R.dt_hrs * R.rate * cfg.sundayMultiplier), 0.011)) mathIssues.push(`double time ${money(R.dt_pay)} vs ${money(R.dt_hrs * R.rate * cfg.sundayMultiplier)}`);
        if (!near(R.pto_pay, r2(regPtoHrs * R.rate), 0.011)) mathIssues.push(`time off ${money(R.pto_pay)} vs ${money(regPtoHrs * R.rate)}`);
      }
      const comp = r2(R.reg_pay + R.ot_pay + R.dt_pay + R.pto_pay);
      if (!near(R.gross_pay, comp, 0.011)) mathIssues.push(`gross ${money(R.gross_pay)} vs earnings total ${money(comp)}`);
      if (mathIssues.length) {
        add({ check: 'P6', severity: 'blocker', empId: emp.id, empName: emp.name, title: 'Earnings do not compute', detail: mathIssues.join('; ') + '.', expected: 'Hours × rate', actual: 'Mismatch', owner: 'Payroll', impact: imp(R.gross_pay - comp, R.gross_pay > comp ? 'overpaid' : 'underpaid'), action: 'Recalculate the earnings lines.' });
      }

      // P7 statutory taxes
      const fica = R.gross_pay - (cfg.section125ReducesFica ? R.medical_ee : 0);
      const ssExp = r2(fica * cfg.ssRate), medExp = r2(fica * cfg.medicareRate);
      const taxIssues = [];
      let shortfall = 0;
      [['Social Security (employee)', R.ss_ee, ssExp], ['Medicare (employee)', R.medicare_ee, medExp], ['Social Security (employer)', R.ss_er, ssExp], ['Medicare (employer)', R.medicare_er, medExp]].forEach(([label, got, want]) => {
        if (Math.abs(got - want) > cfg.taxTolerance) { taxIssues.push(`${label} ${money(got)} vs ${money(want)}`); shortfall += want - got; }
      });
      if (taxIssues.length) {
        add({
          check: 'P7', severity: 'blocker', empId: emp.id, empName: emp.name,
          title: taxIssues.length > 1 && taxIssues.every((t) => t.startsWith('Medicare')) ? 'Medicare not withheld or matched' : 'Statutory tax amounts are off',
          detail: `${taxIssues.join('; ')}. FICA wages ${money(fica)} (gross less pre-tax medical).${R.medicare_ee === 0 ? ' A zero Medicare amount usually means the tax was switched off on the employee record.' : ''}`,
          expected: `SS ${money(ssExp)} · Med ${money(medExp)}`, actual: `SS ${money(R.ss_ee)} · Med ${money(R.medicare_ee)}`, owner: 'Payroll',
          impact: imp(shortfall, 'tax'),
          action: 'Fix the tax setup on the employee record, recalculate, and include the catch-up in this period’s Form 941 deposit.',
        });
      }

      // P8 net pay
      const netExp = r2(R.gross_pay - R.fed_wh - R.ss_ee - R.medicare_ee - R.state_wh - R.state_other_ee - R.k401_ee - R.medical_ee);
      if (!near(R.net_pay, netExp, 0.011)) {
        add({ check: 'P8', severity: 'blocker', empId: emp.id, empName: emp.name, title: `Net pay ${money(R.net_pay)} vs ${money(netExp)}`, detail: 'Gross less taxes and deductions does not equal the net pay on the register.', expected: money(netExp), actual: money(R.net_pay), owner: 'Payroll', impact: imp(R.net_pay - netExp, R.net_pay > netExp ? 'overpaid' : 'underpaid'), action: 'Recalculate the check.' });
      }

      // P9 PTO balances
      const cb = { co: num(c.vac_carryover_hrs), cur: num(c.vac_current_hrs), sick: num(c.sick_hrs) };
      const begins = [['carryover', R.vac_co_begin, cb.co], ['vacation', R.vac_cur_begin, cb.cur], ['sick', R.sick_begin, cb.sick]].filter(([, a, b]) => !near(a, b, 0.01));
      const valRate = salaried ? num(c.annual_salary) / 2080 : num(c.hourly_rate);
      if (begins.length) {
        add({ check: 'P9', severity: 'review', empId: emp.id, empName: emp.name, title: 'Opening balances differ from census', detail: begins.map(([k, a, b]) => `${k} ${fmtH(a)} on the register vs ${fmtH(b)} in the census`).join('; ') + '.', expected: 'Census balance', actual: 'Register balance', owner: 'Payroll', action: 'Reconcile the balance history before release.' });
      }
      if (cb.co > cfg.carryoverCap + 1e-9) {
        const over = cb.co - cfg.carryoverCap;
        add({
          check: 'P9', severity: 'review', empId: emp.id, empName: emp.name,
          title: `Carryover ${fmtH(cb.co)} exceeds the ${fmtH(cfg.carryoverCap)} cap`,
          detail: `${fmtH(over)} should have been forfeited at the January 1 rollover under the handbook. The liability is overstated and the employee can draw time they are not entitled to.`,
          expected: `≤ ${fmtH(cfg.carryoverCap)}`, actual: fmtH(cb.co), owner: 'Payroll',
          impact: imp(over * valRate, 'liability'),
          action: 'Run the carryover cap adjustment and notify the employee of the corrected balance.',
        });
      }
      const eligible = emp.cls.ft && !(emp.term && emp.term <= end) && emp.hire && (D(end) - D(emp.hire)) / 864e5 >= cfg.waitingDays;
      const accrual = eligible ? num(cfg.accrual[emp.cls.key]) : 0;
      const vacUsed = emp.ptoIn.VAC;
      let coUse, curUse;
      if (cfg.drawFirst === 'carryover') { coUse = Math.min(vacUsed, cb.co); curUse = vacUsed - coUse; }
      else { curUse = Math.min(vacUsed, cb.cur); coUse = vacUsed - curUse; }
      const expCo = r2(cb.co - coUse), expCur = r2(cb.cur - curUse + accrual), expSick = r2(cb.sick - emp.ptoIn.SICK);
      emp.expBalances = { co: expCo, cur: expCur, sick: expSick, accrual };
      const endTotalReg = R.vac_co_end + R.vac_cur_end, endTotalExp = expCo + expCur;
      if (emp.hasWfm) {
        if (!near(endTotalReg, endTotalExp, 0.01)) {
          const diff = endTotalReg - endTotalExp;
          add({
            check: 'P9', severity: 'review', empId: emp.id, empName: emp.name,
            title: `Vacation balance ${diff > 0 ? 'overstated' : 'understated'} by ${fmtH(Math.abs(diff))}`,
            detail: `Opening ${fmtH(cb.co + cb.cur)} − ${fmtH(vacUsed)} used + ${fmtH(accrual)} accrued = ${fmtH(endTotalExp)}; the register closes at ${fmtH(endTotalReg)}.${vacUsed > 0 && near(R.vac_co_end, cb.co, 0.01) && near(R.vac_cur_end, cb.cur, 0.01) ? ` The ${fmtH(vacUsed)} taken on ${emp.days.filter((d) => d.pto.VAC).map((d) => fmtDate(d.date)).join(', ')} was paid but never deducted, and the period accrual was not posted.` : ''}`,
            expected: fmtH(endTotalExp), actual: fmtH(endTotalReg), owner: 'Payroll',
            impact: imp(diff * valRate, 'liability'),
            action: 'Post the usage and accrual to the balance before the next statement goes to the employee.',
          });
        } else if (!near(R.vac_co_end, expCo, 0.01)) {
          add({
            check: 'P9', severity: 'review', empId: emp.id, empName: emp.name,
            title: `Vacation drawn from the wrong bucket`,
            detail: `${fmtH(vacUsed)} used should come from carryover first (handbook draw order), leaving carryover ${fmtH(expCo)} and current ${fmtH(expCur)}. The register leaves carryover at ${fmtH(R.vac_co_end)} and current at ${fmtH(R.vac_cur_end)}. Carryover expires at year end, so ${fmtH(R.vac_co_end - expCo)} is at risk of forfeiture.`,
            expected: `CO ${fmtH(expCo)} · Cur ${fmtH(expCur)}`, actual: `CO ${fmtH(R.vac_co_end)} · Cur ${fmtH(R.vac_cur_end)}`, owner: 'Payroll',
            action: 'Re-sequence the vacation draw to carryover first.',
          });
        }
        if (!near(R.sick_end, expSick, 0.01)) {
          add({ check: 'P9', severity: 'review', empId: emp.id, empName: emp.name, title: 'Sick balance does not roll forward', detail: `Opening ${fmtH(cb.sick)} − ${fmtH(emp.ptoIn.SICK)} used = ${fmtH(expSick)}; the register closes at ${fmtH(R.sick_end)}.`, expected: fmtH(expSick), actual: fmtH(R.sick_end), owner: 'Payroll', action: 'Correct the sick balance.' });
        }
      }
    });
    Object.keys(regTotals).forEach((k) => { regTotals[k] = r2(regTotals[k]); });

    // =================================================================================
    // Stage 4 — Funding
    // =================================================================================
    const byType = (t) => bank.filter((b) => b.txn_type === t);
    const ach = byType('ACH_CREDIT'), returns = byType('ACH_RETURN');
    ach.forEach((b) => { if (empById[b.emp_id]) empById[b.emp_id].ach.push(b); });
    returns.forEach((b) => { if (empById[b.emp_id]) empById[b.emp_id].ach.push(b); });
    const netFunding = r2(sum(byType('NET_PAY_FUNDING'), (b) => num(b.amount)));
    const achTotal = r2(sum(ach, (b) => num(b.amount)));
    const funding = { netFunding, achTotal, returns: r2(sum(returns, (b) => num(b.amount))), taxFunding: r2(sum(byType('TAX_FUNDING'), (b) => num(b.amount))) };

    if (bank.length) {
      if (!near(netFunding, regTotals.net, 0.011)) {
        add({ check: 'F1', severity: 'blocker', title: `Net pay impound ${money(netFunding)} vs register ${money(regTotals.net)}`, detail: `The processor debited ${money(netFunding)} for net pay; the register totals ${money(regTotals.net)} (${signedMoney(netFunding - regTotals.net)}).`, expected: money(regTotals.net), actual: money(netFunding), owner: 'Treasury', impact: imp(netFunding - regTotals.net, 'cash'), action: 'Reconcile the impound with the processor before settlement.' });
      }
      employees.forEach((emp) => {
        const r = emp.register;
        const credits = emp.ach.filter((b) => b.txn_type === 'ACH_CREDIT');
        const paid = r2(sum(credits, (b) => num(b.amount)));
        if (r) {
          const net = num(r.net_pay);
          if (!credits.length && net > 0) {
            add({ check: 'F2', severity: 'blocker', empId: emp.id, empName: emp.name, title: 'No direct deposit for register net pay', detail: `Register net ${money(net)}, no ACH credit in the settlement file.`, expected: money(net), actual: '$0.00', owner: 'Treasury', impact: imp(net, 'cash'), action: 'Confirm a live check was issued or add the deposit.' });
          } else if (credits.length && !near(paid, net, 0.011)) {
            add({ check: 'F2', severity: 'blocker', empId: emp.id, empName: emp.name, title: `Deposit ${money(paid)} vs net pay ${money(net)}`, detail: `The ACH credit is ${signedMoney(paid - net)} against register net pay. Nothing on the register explains the difference (no deduction, garnishment or split deposit), so ${money(Math.abs(paid - net))} ${paid < net ? 'is still owed to the employee and remains in the payroll account' : 'was overpaid'}.`, expected: money(net), actual: money(paid), owner: 'Treasury', impact: imp(paid - net, 'cash'), action: paid < net ? 'Find the manual change to the ACH file and send the balance by off-cycle deposit.' : 'Recover the overpayment.' });
          }
        } else if (credits.length) {
          add({ check: 'F2', severity: 'blocker', empId: emp.id, empName: emp.name, title: 'Deposit with no register line', detail: `${money(paid)} deposited to ****${credits[0].account_last4} for someone who is not on the register.`, expected: '$0.00', actual: money(paid), owner: 'Treasury', impact: imp(paid, 'cash'), action: 'Recall the deposit and investigate.' });
        }
        // F3 account on file
        const c = emp.census;
        credits.forEach((b) => {
          if (c && b.account_last4 && c.bank_last4 && b.account_last4 !== c.bank_last4) {
            const changed = validDate(c.bank_change_date) ? c.bank_change_date : '';
            add({
              check: 'F3', severity: 'blocker', empId: emp.id, empName: emp.name,
              title: `Deposit sent to ****${b.account_last4}, account on file is ****${c.bank_last4}`,
              detail: `${money(num(b.amount))} went to ****${b.account_last4}.${changed ? ` The employee changed direct deposit to ****${c.bank_last4} on ${fmtDate(changed)}, after the batch was built, so the ACH used the old account.` : ''}`,
              expected: `****${c.bank_last4}`, actual: `****${b.account_last4}`, owner: 'Treasury',
              action: 'Watch for a return on the old account. Move the bank-change cutoff ahead of batch build, or prenote new accounts.',
            });
          }
        });
      });
      returns.forEach((b) => {
        const emp = empById[b.emp_id];
        const c = emp && emp.census;
        add({
          check: 'F4', severity: 'blocker', empId: b.emp_id, empName: emp ? emp.name : b.payee,
          title: `ACH return ${b.return_code} — ${RETURN_CODES[b.return_code] || 'returned'}`,
          detail: `${money(num(b.amount))} to ****${b.account_last4} came back on ${fmtDate(b.value_date)}. ${emp ? emp.name.split(' ')[0] + ' has not been paid for this period.' : ''}${c && c.bank_last4 && c.bank_last4 !== b.account_last4 ? ` Current account on file: ****${c.bank_last4}.` : ''}`,
          expected: 'Settled', actual: `Returned ${b.return_code}`, owner: 'Treasury',
          impact: imp(num(b.amount), 'cash'), date: b.value_date,
          action: `Reissue by off-cycle deposit${c ? ` to ****${c.bank_last4}` : ''} or live check today; hold the returned funds in a returned-pay liability until reissued.`,
        });
      });
    }
    // F5 shared accounts (census) — independent of bank file
    const acctGroups = {};
    census.forEach((c) => {
      if (!c.bank_last4) return;
      const k = `${c.bank_routing || ''}|${c.bank_last4}`;
      (acctGroups[k] = acctGroups[k] || []).push(c);
    });
    Object.values(acctGroups).filter((g) => g.length > 1).forEach((g) => {
      const lead = g.find((c) => empById[c.emp_id] && !empById[c.emp_id].hasWfm) || g[0];
      const others = g.filter((c) => c !== lead);
      add({
        check: 'F5', severity: 'blocker', empId: lead.emp_id, empName: `${lead.first_name} ${lead.last_name}`,
        title: `Shares a deposit account with ${others.map((o) => o.emp_id).join(', ')}`,
        detail: `${g.map((c) => `${c.emp_id} ${c.first_name} ${c.last_name} (${c.job_title})`).join(' and ')} deposit to the same account (routing ${lead.bank_routing || '—'}, ****${lead.bank_last4}).${empById[lead.emp_id] && !empById[lead.emp_id].hasWfm ? ` ${lead.first_name} has no WFM record; ${others.some((o) => /payroll/i.test(o.job_title)) ? 'the other account holder works in payroll.' : ''}` : ''}`,
        expected: 'One employee per account', actual: `${g.length} employees`, owner: 'Payroll',
        action: 'Freeze changes to these records, verify both employees with HR, and have someone outside payroll review the audit trail.',
        links: others.map((o) => o.emp_id),
      });
    });
    // F6 taxes by jurisdiction
    const expJur = { 'FED-941': 0, 'FED-940': 0 };
    const suiByState = {};
    employees.forEach((emp) => {
      const R = emp.R;
      if (!R) return;
      expJur['FED-941'] += R.fed_wh + R.ss_ee + R.medicare_ee + R.ss_er + R.medicare_er;
      expJur['FED-940'] += R.futa_er;
      const st = R.work_state || 'STATE';
      expJur[st] = (expJur[st] || 0) + R.state_wh + R.state_other_ee + R.sui_er;
      suiByState[st] = (suiByState[st] || 0) + R.sui_er;
    });
    const remits = {};
    byType('TAX_REMIT').forEach((b) => { remits[b.jurisdiction] = (remits[b.jurisdiction] || 0) + num(b.amount); });
    const taxRows = Object.keys(Object.assign({}, expJur, remits)).sort().map((j) => ({ jurisdiction: j, expected: r2(expJur[j] || 0), remitted: r2(remits[j] || 0) }));
    funding.taxes = taxRows;
    if (bank.length && register.length) {
      const expTotal = r2(regTotals.eeTax + regTotals.erTax);
      let flagged = false;
      taxRows.forEach((t) => {
        const diff = r2(t.remitted - t.expected);
        if (Math.abs(diff) <= 0.011) return;
        flagged = true;
        const sui = r2(suiByState[t.jurisdiction] || 0);
        const hint = sui && near(-diff, sui, 0.02) ? ` The shortfall equals ${t.jurisdiction} employer SUI on the register (${money(sui)}): the processor is not remitting it.` : '';
        add({
          check: 'F6', severity: 'blocker',
          title: `${t.jurisdiction} remittance ${diff < 0 ? 'short' : 'over'} by ${money(Math.abs(diff))}`,
          detail: `Register taxes for ${t.jurisdiction} total ${money(t.expected)}; ${money(t.remitted)} was remitted.${hint} Tax impound ${money(funding.taxFunding)} vs register employee + employer taxes ${money(expTotal)}.`,
          expected: money(t.expected), actual: money(t.remitted), owner: 'Treasury',
          impact: imp(diff, 'tax'),
          action: `Have the processor add the ${t.jurisdiction} ${hint ? 'employer SUI' : 'difference'} to the next deposit and check the jurisdiction setup; late deposits accrue penalties and interest.`,
        });
      });
      if (!flagged && !near(funding.taxFunding, expTotal, 0.011)) {
        add({ check: 'F6', severity: 'blocker', title: `Tax impound ${money(funding.taxFunding)} vs register ${money(expTotal)}`, detail: 'Remittances tie by jurisdiction but the impound does not.', expected: money(expTotal), actual: money(funding.taxFunding), owner: 'Treasury', impact: imp(funding.taxFunding - expTotal, 'cash'), action: 'Reconcile the impound with the processor.' });
      }
      // F7 benefits
      const ben = {};
      byType('BENEFIT_REMIT').forEach((b) => { ben[(b.jurisdiction || '').toUpperCase()] = (ben[(b.jurisdiction || '').toUpperCase()] || 0) + num(b.amount); });
      [['401K', '401(k) deferrals', regTotals.k401], ['MEDICAL', 'Medical premiums', regTotals.medical]].forEach(([k, label, want]) => {
        const got = r2(ben[k] || 0);
        if (!near(got, want, 0.011)) add({ check: 'F7', severity: 'review', title: `${label} remitted ${money(got)} vs ${money(want)}`, detail: `Register ${label.toLowerCase()} total ${money(want)}; remitted ${money(got)}.`, expected: money(want), actual: money(got), owner: 'Treasury', impact: imp(got - want, 'cash'), action: 'Correct the remittance with the vendor.' });
      });
    }

    // =================================================================================
    // Stage 5 — GL posting
    // =================================================================================
    const glLines = gl.map((l) => ({ je: l.je_id, account: String(l.account || '').trim(), cc: (l.cost_center || '').trim(), dr: num(l.debit), cr: num(l.credit), name: l.account_name || (glm.accounts || {})[l.account] || '' }));
    const glOut = { entries: [], byAccount: {} };
    if (glLines.length) {
      // G1
      const jes = {};
      glLines.forEach((l) => { (jes[l.je] = jes[l.je] || { dr: 0, cr: 0, lines: 0 }); jes[l.je].dr += l.dr; jes[l.je].cr += l.cr; jes[l.je].lines++; });
      Object.entries(jes).forEach(([je, t]) => {
        glOut.entries.push({ je, dr: r2(t.dr), cr: r2(t.cr), lines: t.lines });
        if (!near(t.dr, t.cr, 0.011)) add({ check: 'G1', severity: 'blocker', title: `${je} out of balance by ${money(Math.abs(t.dr - t.cr))}`, detail: `Debits ${money(t.dr)}, credits ${money(t.cr)}.`, expected: 'Debits = credits', actual: signedMoney(t.dr - t.cr), owner: 'GL accounting', impact: imp(t.dr - t.cr, 'gl'), action: 'Correct the entry before posting.' });
      });
      // expected debits from register
      const accts = glm.accounts || {};
      const wageAcct = glm.wage_account_by_class || {};
      const premium = glm.premium_account || '6040', ptoAcct = glm.pto_account || '6050', erAcct = glm.employer_tax_account || '6100';
      const suspense = glm.suspense_account || '9999';
      const mappedCc = glm.cost_centers || {};
      const expDr = {}; // acct|cc -> amount
      const addExp = (a, cc, v) => { if (!v) return; const k = `${a}|${cc}`; expDr[k] = (expDr[k] || 0) + v; };
      const erByStateCc = {};
      employees.forEach((emp) => {
        const R = emp.R;
        if (!R || !emp.census) return;
        const cc = R.cost_center;
        addExp(wageAcct[emp.cls.glClass] || '6020', cc, R.reg_pay);
        addExp(premium, cc, R.ot_pay + R.dt_pay);
        addExp(ptoAcct, cc, R.pto_pay);
        addExp(erAcct, cc, R.ss_er + R.medicare_er + R.futa_er + R.sui_er);
        const k = `${R.work_state}|${cc}`;
        erByStateCc[k] = (erByStateCc[k] || 0) + R.sui_er;
      });
      // note: register lines without a census record are still costed (they were paid)
      employees.forEach((emp) => {
        const R = emp.R;
        if (!R || emp.census) return;
        addExp('6020', R.cost_center, R.reg_pay + R.ot_pay + R.dt_pay + R.pto_pay);
        addExp(erAcct, R.cost_center, R.ss_er + R.medicare_er + R.futa_er + R.sui_er);
      });
      const actDr = {};
      glLines.forEach((l) => { if (l.dr) { const k = `${l.account}|${l.cc}`; actDr[k] = (actDr[k] || 0) + l.dr - l.cr; } });

      // G3 suspense / unmapped cost centers
      const suspenseCc = new Set();
      const ccsSeen = Array.from(new Set(glLines.filter((l) => l.cc).map((l) => l.cc)));
      ccsSeen.forEach((cc) => {
        const inSusp = glLines.filter((l) => l.cc === cc && l.account === suspense);
        const unmapped = Object.keys(mappedCc).length && !mappedCc[cc];
        if (!inSusp.length && !unmapped) return;
        suspenseCc.add(cc);
        const amt = r2(sum(inSusp, (l) => l.dr - l.cr));
        const expCc = r2(sum(Object.entries(expDr).filter(([k]) => k.endsWith('|' + cc)), ([, v]) => v));
        const heads = employees.filter((e) => e.R && e.R.cost_center === cc);
        add({
          check: 'G3', severity: 'review',
          title: `${cc} ${ccNames[cc] ? ccNames[cc] + ' ' : ''}posted to suspense`,
          detail: `${cc} is not in the GL cost-center map${ccNames[cc] ? ` (${ccNames[cc]})` : ''}. ${money(amt)} of payroll cost went to ${suspense} ${accts[suspense] || 'Suspense'}${near(amt, expCc, 0.02) ? `, equal to the register cost for ${cc} (${heads.length} employee${heads.length === 1 ? '' : 's'}: ${heads.map((e) => e.id).join(', ')})` : ` vs register cost of ${money(expCc)}`}. Store-level labor reporting for ${cc} is understated until it is reclassed.`,
          expected: `Mapped to wage accounts`, actual: `${money(amt)} in ${suspense}`, owner: 'GL accounting',
          impact: imp(amt, 'gl'),
          action: `Add ${cc} to the GL mapping and reclass ${money(amt)} out of suspense before close.`,
        });
      });

      // G2 / G4 by account
      const compareAccounts = (accountsList, check, label) => {
        const keys = new Set([...Object.keys(expDr), ...Object.keys(actDr)].filter((k) => accountsList.includes(k.split('|')[0]) && !suspenseCc.has(k.split('|')[1])));
        const diffs = {};
        keys.forEach((k) => {
          const d = r2((actDr[k] || 0) - (expDr[k] || 0));
          if (Math.abs(d) > 0.011) { const [a, cc] = k.split('|'); (diffs[a] = diffs[a] || []).push({ cc, d, exp: r2(expDr[k] || 0), act: r2(actDr[k] || 0) }); }
        });
        Object.entries(diffs).forEach(([a, list]) => {
          const tot = r2(sum(list, (x) => x.d));
          const expA = r2(sum(list, (x) => x.exp)), actA = r2(sum(list, (x) => x.act));
          let hint = '';
          if (check === 'G4') {
            const states = Array.from(new Set(Object.keys(erByStateCc).map((k) => k.split('|')[0])));
            states.forEach((st) => {
              const s = r2(sum(Object.entries(erByStateCc).filter(([k]) => k.startsWith(st + '|') && !suspenseCc.has(k.split('|')[1])), ([, v]) => v));
              if (s && near(-tot, s, 0.02)) hint = ` The gap equals ${st} employer SUI on the register (${money(s)}).`;
            });
          }
          add({
            check, severity: 'review',
            title: `${a} ${accts[a] || label}: GL ${signedMoney(tot)} vs register`,
            detail: `${list.map((x) => `${x.cc || '(no CC)'} GL ${money(x.act)} vs register ${money(x.exp)} (${signedMoney(x.d)})`).join('; ')}.${hint}`,
            expected: money(expA), actual: money(actA), owner: 'GL accounting',
            impact: imp(tot, 'gl'),
            action: hint ? 'Add the missing employer tax to the payroll journal mapping and post a correcting entry.' : 'Investigate the posting difference and correct the journal.',
          });
        });
      };
      compareAccounts([...Object.values(wageAcct), premium, ptoAcct], 'G2', 'Wages');
      compareAccounts([erAcct], 'G4', 'Employer payroll taxes');

      // G5 liabilities, G6 cash
      const liab = glm.liability_accounts || { taxes: '2200', k401: '2210', medical: '2220' };
      const crOf = (a) => r2(sum(glLines.filter((l) => l.account === a), (l) => l.cr - l.dr));
      [['taxes', regTotals.eeTax + regTotals.erTax, 'employee + employer taxes'], ['k401', regTotals.k401, '401(k) deferrals'], ['medical', regTotals.medical, 'medical premiums']].forEach(([k, want, label]) => {
        const a = liab[k];
        if (!a) return;
        const got = crOf(a);
        if (!near(got, want, 0.011)) {
          const diff = r2(got - want);
          const bankSide = k === 'taxes' ? funding.taxFunding : null;
          const stateHint = Object.entries(suiByState).find(([, v]) => near(-diff, v, 0.02));
          const sameAsG4 = exceptions.some((x) => x.check === 'G4' && x.impact && near(x.impact.amount, Math.abs(diff), 0.011));
          add({
            check: 'G5', severity: 'review',
            title: `${a} ${accts[a] || label}: GL ${signedMoney(diff)} vs register`,
            detail: `GL credit ${money(got)} vs register ${label} ${money(want)}.${stateHint ? ` The gap equals ${stateHint[0]} employer SUI (${money(stateHint[1])}).` : ''}${bankSide !== null && near(got, bankSide, 0.02) ? ` The GL agrees with the bank tax impound (${money(bankSide)}), so a GL-to-bank reconciliation passes; only the three-way tie to the register shows the gap.` : ''}`,
            expected: money(want), actual: money(got), owner: 'GL accounting',
            impact: sameAsG4 ? null : imp(diff, 'gl'),
            action: `Book the missing liability${sameAsG4 ? ' together with the 6100 expense (one correcting entry)' : ''}; confirm the processor remits the same amount.`,
          });
        }
      });
      const cashAcct = glm.cash_account || '1010';
      const cashCr = crOf(cashAcct);
      if (bank.length && !near(cashCr, netFunding, 0.011)) {
        add({ check: 'G6', severity: 'review', title: `${cashAcct} cash credit ${money(cashCr)} vs funded ${money(netFunding)}`, detail: `The journal credits cash ${money(cashCr)}; the bank shows ${money(netFunding)} funded for net pay.`, expected: money(netFunding), actual: money(cashCr), owner: 'GL accounting', impact: imp(cashCr - netFunding, 'gl'), action: 'Align the cash entry with the bank.' });
      }

      // G7 vacation accrual
      const accrExp = glm.vacation_accrual_expense_account || '6060';
      const glAccr = r2(sum(glLines.filter((l) => l.account === accrExp), (l) => l.dr - l.cr));
      let expAccr = 0;
      const drivers = [];
      employees.forEach((emp) => {
        if (!emp.R || !emp.census || !emp.expBalances) return;
        const c = emp.census;
        const rate = emp.cls.salaried ? num(c.annual_salary) / 2080 : num(c.hourly_rate);
        const begin = num(c.vac_carryover_hrs) + num(c.vac_current_hrs);
        const e = emp.expBalances;
        expAccr += (e.co + e.cur - begin) * rate;
        const regChange = emp.R.vac_co_end + emp.R.vac_cur_end - begin;
        const d = (regChange - (e.co + e.cur - begin)) * rate;
        if (Math.abs(d) > 0.01) drivers.push({ id: emp.id, name: emp.name, d });
      });
      expAccr = r2(expAccr);
      glOut.vacationAccrual = { gl: glAccr, expected: expAccr };
      if (Math.abs(glAccr - expAccr) > 1) {
        add({
          check: 'G7', severity: 'review',
          title: `Vacation accrual ${signedMoney(glAccr - expAccr)} vs validated balances`,
          detail: `The true-up books ${money(glAccr)}; validated balance movement is ${money(expAccr)}.${drivers.length ? ` Driven by ${drivers.map((x) => `${x.id} ${x.name} (${signedMoney(x.d)})`).join(', ')} — the register balance was not updated.` : ''}`,
          expected: money(expAccr), actual: money(glAccr), owner: 'GL accounting',
          impact: imp(glAccr - expAccr, 'gl'),
          action: 'Reverse the difference once the balances are corrected (see P9).',
        });
      }
    }

    // =================================================================================
    // Summary
    // =================================================================================
    const sevRank = { blocker: 0, review: 1, info: 2 };
    const stageRank = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
    exceptions.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || stageRank[a.stage] - stageRank[b.stage] || (a.empId || 'Z').localeCompare(b.empId || 'Z') || a.check.localeCompare(b.check, undefined, { numeric: true }));
    exceptions.forEach((e, i) => { e.id = 'X' + String(i + 1).padStart(3, '0'); if (e.empId && empById[e.empId]) empById[e.empId].exceptions.push(e); });

    const checks = CHECKS.map((ch) => {
      const list = exceptions.filter((e) => e.check === ch.id);
      const worst = list.reduce((w, e) => (sevRank[e.severity] < sevRank[w] ? e.severity : w), 'info');
      return {
        id: ch.id, stage: ch.stage, title: ch.title, rule: ch.rule(cfg),
        count: list.length, blockers: list.filter((e) => e.severity === 'blocker').length,
        status: !list.length ? 'pass' : list.some((e) => e.severity !== 'info') ? (worst === 'blocker' ? 'fail' : 'warn') : 'note',
        ran: ranCheck(ch.id),
      };
    });
    function ranCheck(id) {
      const s = CHECK[id].stage;
      if (s === 'time') return time.length > 0 || schedules.length > 0;
      if (s === 'roster') return census.length > 0 && (time.length > 0 || schedules.length > 0);
      if (s === 'payroll') return register.length > 0 && census.length > 0;
      if (s === 'funding') return bank.length > 0 && (id === 'F5' ? census.length > 0 : register.length > 0);
      if (s === 'gl') return gl.length > 0;
      return true;
    }

    const kinds = ['underpaid', 'overpaid', 'tax', 'cash', 'gl', 'liability'];
    const impactTotals = Object.fromEntries(kinds.map((k) => [k, r2(sum(exceptions.filter((e) => e.impact && e.impact.kind === k), (e) => e.impact.amount))]));
    const impactPeople = Object.fromEntries(kinds.map((k) => [k, new Set(exceptions.filter((e) => e.impact && e.impact.kind === k && e.empId).map((e) => e.empId)).size]));
    const stages = STAGES.map((s) => {
      const list = exceptions.filter((e) => e.stage === s.id);
      const sc = checks.filter((c) => c.stage === s.id);
      return Object.assign({}, s, {
        checks: sc.length, passed: sc.filter((c) => c.status === 'pass' || c.status === 'note').length,
        ran: sc.some((c) => c.ran),
        blockers: list.filter((e) => e.severity === 'blocker').length,
        review: list.filter((e) => e.severity === 'review').length,
        info: list.filter((e) => e.severity === 'info').length,
        impact: r2(sum(list.filter((e) => e.impact), (e) => e.impact.amount)),
      });
    });
    const preRelease = stages.filter((s) => ['time', 'roster', 'payroll'].includes(s.id));
    const releaseBlockers = sum(preRelease, (s) => s.blockers);
    const postBlockers = sum(stages.filter((s) => !['time', 'roster', 'payroll'].includes(s.id)), (s) => s.blockers);

    return {
      period, config: cfg, employees, empById, exceptions, checks, stages, funding, regTotals, gl: glOut,
      totals: {
        people: employees.length,
        census: census.length,
        wfmOnly: employees.filter((e) => !e.census && e.hasWfm).length,
        onRegister: register.length,
        clean: employees.filter((e) => !e.exceptions.some((x) => x.severity !== 'info')).length,
        exceptions: exceptions.length,
        blockers: exceptions.filter((e) => e.severity === 'blocker').length,
        review: exceptions.filter((e) => e.severity === 'review').length,
        info: exceptions.filter((e) => e.severity === 'info').length,
        releaseBlockers, postBlockers,
        impact: impactTotals, impactPeople,
        checksRun: checks.filter((c) => c.ran).length,
        checksFailed: checks.filter((c) => c.ran && (c.status === 'fail' || c.status === 'warn')).length,
      },
      decision: releaseBlockers ? 'hold' : postBlockers ? 'release-with-actions' : 'release',
    };
  }

  function analyzeRecord(t, cfg) {
    const inc = cfg.punchRounding || 1;
    const pin = toMin(t.punch_in), mo = toMin(t.meal_out), mi = toMin(t.meal_in), pout = toMin(t.punch_out);
    const hasPunch = [pin, mo, mi, pout].some((v) => v !== null);
    const code = (t.pay_code || 'REG').trim().toUpperCase() || 'REG';
    const wfmHours = num(t.wfm_hours);
    const override = /^y/i.test(t.manager_override || '');
    const res = { raw: t, code, wfmHours, override, hasPunch, flags: [], computed: null };
    if (code !== 'REG') return res;
    if (pin !== null && pout === null) res.flags.push('MISSING_OUT');
    if (pin === null && pout !== null) res.flags.push('MISSING_IN');
    if (mo !== null && mi === null) res.flags.push('MISSING_MEAL_IN');
    if (mo === null && mi !== null) res.flags.push('MISSING_MEAL_OUT');
    if (!res.flags.length && pin !== null && pout !== null) {
      const R = (m) => Math.round(m / inc) * inc;
      let span = R(pout) - R(pin);
      if (span < 0) span += 1440;
      const shift = span / 60;
      if (mo !== null) span -= R(mi) - R(mo);
      res.computed = span / 60;
      if (mo === null && shift > cfg.mealRequiredAfter) res.flags.push('NO_MEAL');
    }
    if (!hasPunch && wfmHours > 0) res.flags.push(override ? 'OVERRIDE' : 'NO_PUNCH');
    return res;
  }

  function mode(arr) {
    const c = {};
    let best = '', n = 0;
    arr.forEach((x) => { c[x] = (c[x] || 0) + 1; if (c[x] > n) { n = c[x]; best = x; } });
    return best;
  }

  function signedMoney(n) {
    const v = r2(n);
    return (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v));
  }

  const api = {
    run, parseCSV, toCSV, parseRegisterLines, buildConfig, missingColumns, SCHEMAS, STAGES, CHECKS, RETURN_CODES,
    fmt: { money, signedMoney, fmtH, signedH, fmtDate, md, hhmm, DOW },
    util: { r2, num, splitHours, classify, yearsBetween },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PayrollEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
