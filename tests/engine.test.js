// Runs the engine on the generated sample cycle and checks it against the seeded issues.
//   node tests/engine.test.js            -> pass/fail summary
//   node tests/engine.test.js --list     -> also prints every exception
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const E = require('../app/engine.js');

const DATA = path.join(__dirname, '..', 'data');
const read = (f) => fs.readFileSync(path.join(DATA, f), 'utf8');

function load() {
  return {
    census: E.parseCSV(read('census.csv')),
    schedules: E.parseCSV(read('schedules.csv')),
    time: E.parseCSV(read('time_records.csv')),
    register: E.parseCSV(read('payroll_register.csv')),
    bank: E.parseCSV(read('bank_activity.csv')),
    gl: E.parseCSV(read('gl_journal.csv')),
    agreement: JSON.parse(read('union_agreement.json')),
    handbook: JSON.parse(read('employee_handbook.json')),
    glMap: JSON.parse(read('gl_mapping.json')),
  };
}

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); } catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message); }
};

const input = load();
const res = E.run(input);
const seeded = JSON.parse(read('seeded_issues.json'));

if (process.argv.includes('--list')) {
  res.exceptions.forEach((x) => {
    const i = x.impact ? ` [${x.impact.kind} ${E.fmt.money(x.impact.amount)}${x.impact.estimated ? ' est' : ''}]` : '';
    console.log(`${x.severity.padEnd(7)} ${x.check.padEnd(4)} ${(x.empId || '—').padEnd(6)} ${x.title}${i}\n        ${x.detail}`);
  });
  console.log();
}

console.log('Seeded issues');
seeded.issues.forEach((s) => {
  test(`${s.check} ${s.emp || '(cycle)'} — ${s.note}`, () => {
    const hit = res.exceptions.find((x) => x.check === s.check && (s.emp ? x.empId === s.emp : true) && x.severity !== 'info');
    assert(hit, 'not detected');
  });
});

console.log('No unexpected exceptions');
test('every blocker/review exception maps to a seeded issue', () => {
  const allowed = new Set(seeded.issues.map((s) => `${s.check}|${s.emp || ''}`));
  const extra = res.exceptions.filter((x) => x.severity !== 'info' && !allowed.has(`${x.check}|${x.empId || ''}`) && !allowed.has(`${x.check}|`));
  assert(!extra.length, extra.map((x) => `${x.check} ${x.empId || ''} ${x.title}`).join('; '));
});
test('clean controls have no blocker/review exceptions', () => {
  const bad = seeded.clean_controls.filter((id) => res.empById[id].exceptions.some((x) => x.severity !== 'info'));
  assert(!bad.length, bad.join(', '));
});

console.log('Amounts');
const find = (check, emp) => res.exceptions.find((x) => x.check === check && x.empId === emp);
const amt = (check, emp) => (find(check, emp).impact || {}).amount;
test('E1020 overtime paid as straight time: underpaid $64.50', () => assert.strictEqual(amt('P4', 'E1020'), 64.5));
test('E1018 Sunday at 1.5x: paid $211.58 vs $282.10 owed = $70.52', () => assert.strictEqual(amt('P4', 'E1018'), 70.52));
test('E1008 sick day paid twice: overpaid $159.95', () => assert.strictEqual(amt('P3', 'E1008'), 159.95));
test('E1004 below step 4: underpaid $87.50', () => assert.strictEqual(amt('P2', 'E1004'), 87.5));
test('E1014 transposed rate: underpaid $25.20', () => assert.strictEqual(amt('P1', 'E1014'), 25.2));
test('E1031 exempt overtime: overpaid $398.08', () => assert.strictEqual(amt('P5', 'E1031'), 398.08));
test('E1033 two unpaid days: underpaid $492.31', () => assert.strictEqual(amt('R3', 'E1033'), 492.31));
test('E1098 ghost: $1,680.00', () => assert.strictEqual(amt('R2', 'E1098'), 1680));
test('E1005 balance not decremented: $105.60 liability', () => assert.strictEqual(amt('P9', 'E1005'), 105.6));
test('NJ SUI shortfall equals register NJ SUI', () => {
  const f6 = res.exceptions.find((x) => x.check === 'F6');
  const nj = input.register.filter((r) => r.work_state === 'NJ').reduce((a, r) => a + Number(r.sui_er), 0);
  assert.strictEqual(f6.impact.amount, E.util.r2(nj));
  assert(/employer SUI/.test(f6.detail));
});
test('G5 notes that GL ties to the bank but not to the register', () => {
  assert(/three-way/.test(res.exceptions.find((x) => x.check === 'G5').detail));
});
test('decision is hold', () => assert.strictEqual(res.decision, 'hold'));

console.log('Rules are live');
test('raising the union OT threshold to 37.5h removes E1012 overtime and adds none', () => {
  const r = E.run(Object.assign({}, input, { settings: { unionOtAfter: 37.5 } }));
  const e = r.empById.E1012;
  assert.strictEqual(e.expSplit.ot, 0);
  assert(r.exceptions.some((x) => x.check === 'P4' && x.empId === 'E1012'), 'register still pays 1h OT, so P4 should now flag it');
});
test('turning on the Saturday premium flags union Saturday workers in P4', () => {
  const r = E.run(Object.assign({}, input, { settings: { saturdayPremium: true } }));
  assert(r.exceptions.some((x) => x.check === 'P4' && x.empId === 'E1001'));
});
test('PT cap of 34h clears E1025', () => {
  const r = E.run(Object.assign({}, input, { settings: { ptMaxWeekly: 34 } }));
  assert(!r.exceptions.some((x) => x.check === 'T7'));
});

console.log('PDF register lines parse to the CSV register');
test('parseRegisterLines round-trips a register row', () => {
  const row = input.register[0];
  const m = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const lines = [
    ['EMP ID', 'NAME', 'CC'],
    [row.emp_id, row.employee_name, row.cost_center, row.pay_type, ...['rate', 'reg_hrs', 'ot_hrs', 'dt_hrs', 'vac_hrs', 'sick_hrs', 'hol_hrs', 'reg_pay', 'ot_pay', 'dt_pay', 'pto_pay', 'gross_pay'].map((k) => m(row[k]))],
    ['TAXES/DED', ...['fed_wh', 'ss_ee', 'medicare_ee', 'state_wh', 'state_other_ee', 'k401_ee', 'medical_ee', 'net_pay'].map((k) => m(row[k])), '****' + row.bank_last4],
    ['EMPLOYER/BAL', ...['ss_er', 'medicare_er', 'futa_er', 'sui_er'].map((k) => m(row[k])), row.work_state, ...['vac_co_begin', 'vac_co_end', 'vac_cur_begin', 'vac_cur_end', 'sick_begin', 'sick_end'].map((k) => m(row[k]))],
  ];
  const out = E.parseRegisterLines(lines);
  assert.strictEqual(out.rows.length, 1);
  E.SCHEMAS.register.forEach((k) => assert.strictEqual(String(Number(out.rows[0][k]) || out.rows[0][k]), String(Number(row[k]) || row[k]), k));
});

console.log(`\n${res.totals.exceptions} exceptions (${res.totals.blockers} blockers, ${res.totals.review} review, ${res.totals.info} info) · ${res.totals.clean}/${res.totals.people} people clean`);
console.log('Impact', JSON.stringify(res.totals.impact));
if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nAll tests passed');
