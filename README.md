# Payroll Assurance Pipeline

A demo of one transaction set validated end to end, as described in the WFM/payroll call:

**WFM → Payroll → Treasury → Finance** — time sheets, pre-payroll validation, the payroll register, funding, and GL posting.

The demo runs on a fictional clothing retailer (Northloom Apparel: NY and NJ stores, a distribution center, and a pop-up). The sample pay cycle is Sun 2026-09-13 to Sat 2026-09-26, with a pay date of Fri 2026-10-02. There are 38 people on payroll plus one person who exists only in WFM. Issues are seeded on purpose so the engine has something to find.

## Run it

Open `public/index.html` in a browser, or use the Vercel deployment. Everything runs client-side. The sample cycle loads automatically. On the **Data intake** tab you can choose *Batch upload* or *API* for each source (the API connection is simulated in the demo) and upload replacement CSV, JSON or PDF files. To demo a batch upload, use the files in `data/`.

```
python3 generator/generate_data.py   # regenerate data/ and app/sample-data.js
node tests/engine.test.js            # every seeded issue is caught, nothing else is flagged
node tests/engine.test.js --list     # also prints each exception
python3 build_dist.py                # rebuild public/ (the static site Vercel serves)
```

Vercel deploys `public/` as a static site with no build step. After you change anything in `app/`, run `python3 build_dist.py` and commit `public/` along with it.

## Where each point from the call lands

| From the call | Check |
|---|---|
| Compare schedules to actual time, identify gaps | T4 schedule vs actual: no-shows, unscheduled shifts, daily variance |
| Check-ins without check-outs; out to lunch with no return punch | T1 punch completeness |
| Manager overrides ("worked 8 hours, no checkout, I'll cover") | T2 manager overrides |
| Shorts: under 35h (union) or 40h (non-union / exempt) | T5 short weeks, prorated for hire and termination dates |
| Longs: overtime over 35 / 40 for hourly (exempt gets none) | T6 overtime due, P4 overtime and premiums, P5 exempt overtime |
| Part-time throttle: over 30h moves the benefit class | T7 part-time cap |
| Hours per day limits | T8 daily maximum |
| Coding: work, PTO, holiday, sick, vacation buckets | T9 pay codes, T10 time-off balances |
| Carryover vs current pool, per the employee manual | P9 PTO balances: draw order, carryover cap, accrual |
| WFM list = payroll list, no ghost employees | R1 time without payroll record, R2 payroll record without WFM time |
| Onboarded late: worked 10/6, payroll start date 10/8 | R3 time before hire date (sample: worked 9/21, hired 9/23) |
| Time records coincide with an active employee | R4 time after termination |
| Register vs census salaries and rates | P1 rate and salary |
| Union agreement by years of service | P2 union pay scale (UGRW Local 88 step table) |
| Time and a half, double time on Sunday | P4, with a Saturday premium toggle on the Rules tab |
| ADP-format register, extract from PDF | Register source accepts CSV or the printed PDF (pdf.js text extraction) |
| Match the processor to ACH activity; returns after a bank change | F1 net funding, F2 ACH by employee, F3 deposit account, F4 returns, F5 shared accounts |
| Employer taxes funded and remitted to the states | F6 tax remittance by jurisdiction, F7 benefit remittance |
| GL rules by employee type, accrual accounts | G1–G7: balance, wage expense by cost center, mapping/suspense, employer tax, liabilities, cash, vacation accrual |

Leaves are out of scope, as agreed on the call. Everyone in the sample is active or cleanly terminated.

## Files

- `app/` — the demo source (`index.html`, `app.js`, `engine.js`, and `sample-data.js` with the sample files embedded). `index.html` is in claude.ai artifact form, with no `<html>` wrapper.
- `public/` — the built static site for Vercel, made by `build_dist.py`
- `data/` — the sample files to upload: census, schedules, time records, register (CSV and PDF), bank activity, GL journal, union agreement, handbook, GL mapping. `seeded_issues.json` lists what was planted.
- `generator/generate_data.py` — builds the sample cycle from the same rules the engine checks
- `tests/engine.test.js` — regression test against the seeded issues

## Notes

- The definitions follow the FLSA: non-exempt employees are hourly and earn overtime; exempt employees are salaried and don't.
- Dollar impacts marked *est.* are estimates. A missing check-out is valued at the scheduled shift. Time for someone missing from payroll is valued at the median rate for that location.
- The engine attributes each dollar once. The ghost employee's pay is counted in R2 and not again in F5. The NJ employer SUI gap is counted in F6 (tax) and G4 (GL) and not again in G5.
