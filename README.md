# Rollcall.ai Payroll Assurance

*Everyone Accounted For.*

Validates every pay cycle end to end, **WFM → Payroll → Treasury → Finance**, and gates payroll release on the results. It covers time sheets, pre-payroll checks, the payroll register, funding and GL posting.

The workspace opens on a fictional sample cycle: Northloom Apparel, a clothing retailer with NY and NJ stores, a distribution center and a pop-up. The pay period runs Sun 2026-09-13 to Sat 2026-09-26, with a pay date of Fri 2026-10-02. There are 38 people on payroll plus one person who exists only in WFM. Issues are seeded on purpose so every check has something to find.

## Payroll Integrity AI

Five applications check one bi-weekly payroll, from the time clock to the general ledger. They follow the *Payroll Integrity AI: Use Case Requirements* (Oct 15, 2026). Each answers one question:

| # | Application | Question | Runs | Checks |
|---|---|---|---|---|
| 1 | **FeedPulse** | Is the data on time and complete? | Before release | Feed timeliness against the WFM close cutoff, completeness, period coverage and duplicates; T1 punches, T2 manager overrides, T3 rounding, T4 schedule vs actual, T8 daily max, T9 pay codes (including sick days coded as vacation), R1–R5 roster and start dates |
| 2 | **RunRadar** | Which exceptions change someone's pay? | Before release | T5 short weeks, T6 overtime due, T7 part-time cap, T10 balances, P1–P10 rates, union scale, overtime and Sunday premium, PTO buckets and register math, ranked by dollar impact |
| 3 | **Variance Voice** | Why did it happen? | Every step | One explanation per exception. It cites the source records ([R1], [R2]…) and the policy clause (HB, CBA or FIN clause ids), and names an owner and a next step. The reviewer approves, dismisses (with a reason) or escalates. |
| 4 | **Three-Way True** | Do payroll, payments and the ledger agree? | After funding and posting | Register ↔ bank/ACH ↔ GL for net pay, taxes by jurisdiction, benefits, wages and employer taxes; F1–F7 and G1–G7. Each break has an owner. |
| 5 | **FixFlow Clusters** | What keeps going wrong? | Across periods | Exceptions from the last 6 pay periods, grouped by store, manager and type. Patterns seen in 3 or more periods are flagged with a root cause and a fix. |

Every demo case in the use case is seeded in the sample cycle, and the Overview's *Showcase walkthrough* links to each one:

- missed lunch return (E1012)
- 8-hour manager override (E1021)
- sick day coded as vacation (E1016)
- start-date gap (E1038, payroll start 9/21, time from 9/23)
- Sunday hours at 1.5× instead of 2× (E1018)
- sick time drawn from the current-year bucket while an accrued balance remains (E1013)
- ACH return after a bank change (E1012)
- missed lunch check-ins at SoHo Flagship in every period (FixFlow)

**Guardrails.** Rules calculate every dollar. The AI only explains and groups. Payroll can't be released until every pre-release blocker is approved or dismissed by a reviewer.

### AI service

`api/ai.mjs` is a Vercel function. It runs on [Groq](https://groq.com) through the official `groq-sdk`, using `openai/gpt-oss-120b` by default. Answers come back as strict structured JSON (`response_format: json_schema`) and the function checks their shape before the app uses them. If you pick a model without structured-output support, the function falls back to JSON mode with the schema written into the prompt.

- **Turning it on.** Create a key at console.groq.com, add it as `GROQ_API_KEY` in the Vercel project's environment variables and redeploy. To keep strangers from using the endpoint, also set `AI_ACCESS_CODE`; reviewers then enter that code under Settings → AI service.
- **Changing the model.** Set `GROQ_MODEL` to any model id from Groq's model list (for example `openai/gpt-oss-20b` for lower cost).
- **Without a key.** Variance Voice shows the explanation the rules assembled from the records, with the same citations and policy clauses, and FixFlow names root causes from rule templates. The app says which source produced each explanation.

**Masking.** All sample data is synthetic. Before anything leaves the browser, names, employee IDs, bank accounts, routing numbers and trace references are replaced with synthetic identifiers (`EMP-013`, `ACCT-01`). Variance Voice shows exactly what the AI sees, under *What the AI sees (masked)*. AI output stays masked by default; *Show real names* re-identifies it in the browser only. The function also rejects any payload that still contains an employee ID, a 9-digit routing number or an SSN pattern.

## What it does

- **Overview.** Shows release readiness, a progress bar of pre-release blockers cleared, blockers by owner, cycle totals and key dates (funding, settlement, GL post, ACH returns), checks by stage, open dollar exposure, and recent activity.
- **Variance Voice queue.** Filter by status, severity, stage, owner or search. The detail panel shows the explanation, cited evidence, policy clause, owner reassignment, notes and full history. Bulk actions: assign, approve, dismiss (reason required), escalate.
- **Release gate.** *Release payroll* stays locked until every pre-release blocker (FeedPulse and RunRadar) is approved or dismissed. Approval asks you to confirm the dismissed blockers and their reasons, and records the approver, a note and the totals. Released cycles feed FixFlow's history. A released cycle can be reopened with a reason.
- **People.** Register gross vs validated gross for everyone. Click a person for the timecard (scheduled vs worked), pay rebuilt from WFM time and contract rates, PTO balances and deposits.
- **Controls.** All 39 checks by stage and application, each with its rule and its result.
- **Import.** Drop a cycle's exports anywhere in the app, several at once: CSV, JSON or the printed PDF register (read with pdf.js). Each file is matched to its source by its columns. Common vendor header names are recognized (for example "Employee ID", "File #", "Home Department", "Total Hours", "Lunch Out"). Anything unrecognized is mapped in a column mapper, and Rollcall remembers each mapping for files with the same columns. On import, US dates, 12-hour punches, `$1,234.56` amounts and `(negative)` amounts are normalized. Importing into the sample workspace replaces the sample cycle. CSV templates are available for each source.
- **Data sources.** Each source is set to *File* or *API*. In API mode, the browser calls your HTTPS endpoint directly, with an optional Authorization header that is kept for the session only. Use `{start}`/`{end}` in the URL for the pay period dates. The endpoint must return CSV or JSON rows and allow CORS. *Start a new cycle* clears the WFM, payroll, bank and GL data; policies, rule changes and saved column mappings carry over.
- **Rules.** Thresholds come from the union agreement and the handbook. Every change re-runs the checks and is logged.
- **Reports.** Release brief (.txt), exception register with statuses and notes (.csv), pay variance (.csv) and audit trail (.csv).
- **Activity.** An append-only log of every status change, note, reassignment, rule change, data load, re-run and release.

Statuses, notes, releases, rule changes, column mappings and imported data are stored in the browser (localStorage). Files are read client-side and are not sent anywhere. Nothing is shared between browsers or teammates; that would need a backend.

## Run it

Use the Vercel deployment, or open `public/index.html` in a browser. To try a batch upload, use the files in `data/`.

```
python3 generator/generate_data.py   # regenerate data/ and app/sample-data.js
npm install                          # only needed for the api/ai function
node tests/engine.test.js            # every seeded issue is caught, nothing else is flagged
node tests/engine.test.js --list     # also prints each exception
python3 build_dist.py                # rebuild public/ (the static site Vercel serves)
```

Vercel deploys `public/` as a static site with no build step. After you change anything in `app/`, run `python3 build_dist.py` and commit `public/` along with it.

## Branding

Branding follows the Rollcall.ai Branding Guide:

- **Colors.** Primary: Vivid Blue `#3653FD`, Vivid Pink `#FD328E` and Sunrise Orange `#FE812B`. Secondary: Cloud Blue `#E5ECF9` and Midnight `#001137`. The blue → pink → orange gradient from the logo is used sparingly: the nav indicator, the readiness progress bar and the import icon.
- **Type.** Sora for headings and Manrope for text, both from Google Fonts.
- **Logo.** The checkmark + person mark and the Rollcall.ai wordmark are in `app/brand/`, extracted from the guide's artwork. The white wordmark is for the Midnight sidebar.
- **Tagline.** "Everyone Accounted For", shown in the sidebar.

The tokens are at the top of the `:root` block in `app/index.html`. Status colors (red, amber, green) are kept separate from the brand pink and orange so blockers never look like decoration.

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

- `api/ai.mjs` — the Variance Voice / FixFlow AI function (Vercel).
- `app/brand/` — logo mark, wordmark, favicon and app icon.
- `app/` — source. `index.html` is the shell and styles, `app.js` holds the pages, workflow, release gate and persistence, `engine.js` holds the checks, and `sample-data.js` has the sample files embedded. `index.html` is written without an `<html>` wrapper; `build_dist.py` adds one.
- `public/` — the built static site for Vercel, made by `build_dist.py`
- `data/` — the sample files to upload: census, schedules, time records, register (CSV and PDF), bank activity, GL journal, union agreement, handbook and finance rules with numbered policy clauses, GL mapping, and `exception_history.json` (five earlier pay periods for FixFlow). `seeded_issues.json` lists what was planted.
- `generator/generate_data.py` — builds the sample cycle from the same rules the engine checks
- `tests/engine.test.js` — regression test against the seeded issues

## Notes

- The definitions follow the FLSA: non-exempt employees are hourly and earn overtime; exempt employees are salaried and don't.
- Dollar impacts marked *est.* are estimates. A missing check-out is valued at the scheduled shift. Time for someone missing from payroll is valued at the median rate for that location.
- The engine attributes each dollar once. The ghost employee's pay is counted in R2 and not again in F5. The NJ employer SUI gap is counted in F6 (tax) and G4 (GL) and not again in G5.
