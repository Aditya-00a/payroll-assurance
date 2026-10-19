# Rollcall.ai Payroll Assurance

*Everyone Accounted For.*

Validates every pay cycle end to end, **WFM → Payroll → Treasury → Finance**, and gates payroll release on the results. It covers time sheets, pre-payroll checks, the payroll register, funding and GL posting.

The workspace opens on a fictional sample cycle: Northloom Apparel, a clothing retailer with NY and NJ stores, a distribution center and a pop-up. The pay period runs Sun 2026-09-13 to Sat 2026-09-26, with a pay date of Fri 2026-10-02. There are 38 people on payroll plus one person who exists only in WFM. Issues are seeded on purpose so every check has something to find.

## Signing in

The app opens on a sign-in page with two options.

- **Employer** is for the payroll, HR, store, treasury and accounting teams. Pick your name from the team list. Payroll admins also enter the admin PIN when one is set. You land on *My work*.
- **Employee** is for anyone on the payroll. Enter your employee ID and the last 4 digits of the bank account your pay goes to. In the sample, use **E1012** and **4471**. After 5 wrong tries, employee sign-in is locked for 5 minutes on that device. Sign-ins, sign-outs and failed tries are logged.

**Team password.** Before the sign-in page, the site can ask for one password shared by the whole team. To turn it on, add `SITE_PASSWORD` in the Vercel project (Settings → Environment Variables, for Production) and redeploy. The check runs on Vercel (`middleware.js`) before any page, file or AI request is served. Each device remembers the password for 30 days, changing it signs everyone out, and `/__signout` forgets it on one device. Without the variable, the site stays open.

**This is demo sign-in.** It runs in the browser, and anyone with the link can sign in as anyone on the team. For production, sign people in through your company's single sign-on (Okta, Microsoft Entra or Google) and keep the data on a server. See *Notes*.

### What employees see

Employees see only their own records. Other people's names and IDs are removed from anything shown to them.

- **My pay.** Take-home pay, gross pay, hours paid and the account paid to. Below that: a pay statement (earnings, taxes, deductions), the items payroll is checking on their pay in plain words ("Being checked", "Checked", "You may be owed $X"), deposits (including any the bank sent back), and time off left.
- **My time.** Scheduled, worked, time-off and paid hours, and the full timecard with punches and flags.
- **Questions.** Ask the payroll team about pay, hours, time off, direct deposit or taxes. Each question goes into the review queue as an *Employee question* for the team that owns the topic, with a due time like any other item. The reviewer replies from the queue, and the employee sees the answer on this page. If the employee writes back, the question opens again. Closing without a reply shows the employee "Closed" and keeps the reviewer's reason internal.
- **Ask about my pay.** The AI chat, limited to that employee's own records and the company policies, with their name hidden from the AI. An admin can turn this off.

An admin can turn employee sign-in and the employee AI chat on or off under *Admin console → Policies → Employee access*.

## How a pay cycle is checked

One tool checks each bi-weekly payroll in five steps, from the time clock to the general ledger. Each step answers one question:

| Step | In the app | What it does | Runs | Checks |
|---|---|---|---|---|
| 1 | **FeedPulse** (Data quality) | Identify missing, late or abnormal data feeds. | Before release | Files on time against the due time, completeness, period coverage and duplicates; T1 punches, T2 manager overrides, T3 rounding, T4 schedule vs actual, T8 daily max, T9 pay codes (including sick days coded as vacation), R1–R5 roster and start dates |
| 2 | **RunRadar** (Pay accuracy) | Prioritize material payroll movements for review. | Before release | T5 short weeks, T6 overtime due, T7 part-time cap, T10 balances, P1–P10 rates, union scale, overtime and Sunday premium, time-off balances and register math, ranked by dollar impact |
| 3 | **Variance Voice** (in the Review queue) | Produce evidence-based explanations of exceptions. | Every step | Each exception comes with the source records it relies on ([R1], [R2]…), the policy clause (HB, CBA or FIN clause ids), an owner and a next step. The reviewer approves, dismisses (with a reason) or escalates. |
| 4 | **Three-Way True** (Bank and ledger) | Reconcile payroll, payment files and the general ledger. | After funding and posting | Register ↔ bank/ACH ↔ GL for net pay, taxes by jurisdiction, benefits, wages and employer taxes; F1–F7 and G1–G7. Each difference has an owner. |
| 5 | **FixFlow Clusters** (Repeat issues) | Group repeated corrections to reveal systemic causes. | Across periods | Exceptions from the last 6 pay periods, grouped by store, manager and type. Anything seen in 3 or more periods is flagged with a likely cause and a fix. |

The names follow the *Payroll Integrity AI: Use Case Requirements* document (Oct 15, 2026). Each page shows its one-line purpose under the name, with the plain-words area above it.

Every demo case in the use case is seeded in the sample cycle, and the Overview's *Sample cases to try* links to each one:

- missed lunch return (E1012)
- 8-hour manager override (E1021)
- sick day coded as vacation (E1016)
- start-date gap (E1038, payroll start 9/21, time from 9/23)
- Sunday hours at 1.5× instead of 2× (E1018)
- sick time drawn from the current-year bucket while an accrued balance remains (E1013)
- ACH return after a bank change (E1012)
- missed lunch check-ins at SoHo Flagship in every period (Repeat issues)

**Guardrails.** Rules calculate every dollar. The AI only explains and groups. Payroll can't be released until every pre-release blocker is approved or dismissed by a reviewer.

### AI service

`api/ai.mjs` is a Vercel function with three tasks: *explain* (Why it happened), *clusters* (suggested causes) and *chat* (Ask AI). It runs on [Groq](https://groq.com) through the official `groq-sdk`, using `openai/gpt-oss-120b` by default. Answers come back as strict structured JSON (`response_format: json_schema`) and the function checks their shape before the app uses them. If you pick a model without structured-output support, the function falls back to JSON mode with the schema written into the prompt.

- **Turning it on.** Create a key at console.groq.com, add it as `GROQ_API_KEY` in the Vercel project's environment variables and redeploy. To keep strangers from using the endpoint, also set `AI_ACCESS_CODE`; reviewers then enter that code under Settings → AI service.
- **Changing the model.** Set `GROQ_MODEL` to any model id from Groq's model list (for example `openai/gpt-oss-20b` for lower cost).
- **Without a key.** *Why it happened* shows the explanation the rules put together from the records, with the same citations and policy clauses, and Repeat issues takes causes from rule templates. The app says which source produced each explanation.

**Hiding names.** All sample data is synthetic. Before anything leaves the browser, names, employee IDs, bank accounts, routing numbers and trace references are replaced with synthetic identifiers (`EMP-013`, `ACCT-01`). The review queue shows exactly what the AI sees, under *What the AI sees (names hidden)*. AI output keeps names hidden by default; *Show real names* puts them back in the browser only. The function also rejects any payload that still contains an employee ID, a 9-digit routing number or an SSN pattern.

## Your rules and data sources

- **Your rules** (Rules page). Build a check on any data source, including ones you add, without code. Pick the source and check each row or each employee's total. Then add conditions on any column: more or less than, equals, contains, is one of, is empty, or a comparison with another column, combined with *all* or *any*. Each rule also sets:
  - the level (blocker, review or info)
  - the step of the pay cycle
  - the owner
  - a title that can include column values, like `{wfm_hours}`
  - an optional dollar impact column
  - a suggested fix

  A live preview shows what the rule finds in this cycle before you save. Six starter templates cover common cases, such as an hourly rate below $20, more than 80 hours in the period, and deposits over $2,500. Matches go to the review queue, count toward the release gate (blockers in steps before release), appear on All checks marked *Your rule*, and get the same *Why it happened* panel. Rules can be edited, turned off or deleted, and every change is logged.
- **Your data sources** (Data sources page). Add any file the team checks each cycle, such as tips, garnishments, benefits or contractor pay. Set where it comes from, its step and owner, and whether it's required every cycle. A required file that's missing puts a blocker in the review queue. Files are uploaded on the source's card, through API sync, or straight from the import queue, where *New data source…* creates one from an unrecognized file. Columns are kept as they are and become available to rules and to Ask AI. Columns that look like names, addresses, SSNs or account numbers are never shown to the AI.
- **Approved items turn green.** This applies across the review queue, the check lists, Pay accuracy, All checks (*Cleared*), Bank and ledger (*Reviewed*), the detail panel and the admin stage meters.

## Working faster

- **My work** is the employer's home page. It shows the items in your queue, overdue ones first and then blockers, each with an *Approve* button. It also shows what's left before release, open employee questions, your recent actions, and, for admins, open and overdue work by queue.
- **A shorter sidebar.** *Checks* holds Data quality, Pay accuracy, Bank and ledger and Repeat issues as tabs. *Rules* holds All checks. *Reports* holds the Activity log. Each sidebar link remembers the last tab you used.
- **Faster reviewing.** Every row in the review queue has an approve button. Approving or dismissing moves you to the next item. Every change shows *Undo* for 8 seconds, and undoing is logged. In the review queue, these keyboard shortcuts work when you aren't typing in a box:

  | Key | Does |
  |---|---|
  | J or ↓ / K or ↑ | Next / previous item |
  | A | Approve, then go to the next item |
  | D | Dismiss, using the note, or ask for a reason |
  | E | Escalate |
  | X | Select or unselect the item |
  | / | Search |
  | U or Ctrl+Z | Undo the last change |
  | ? | Show the shortcuts |

- **Reset demo.** In the menu under your name (top right), on My work, on the Admin console and on the sign-in page. It puts the sample company back exactly as it started, in this browser only.
- **Import or connect payroll.** The top bar, My work and the Admin console open one choice: import payroll files, or connect a payroll system's report (the payroll register in API mode on Data sources).
- **Who is signed in** shows at the top right, with a menu to switch person or sign out.
- **Release checklist.** *Release payroll* lists what's left: data loaded, required files, pre-release blockers by owner, any hold, whether you can release, and the different-person rule. Each item links to where you fix it. When everything is done, it opens the approval.
- **Plain-word tooltips.** Payroll terms such as GL, ACH, WFM, PTO, census, payroll register, blocker, exempt, carryover and accrual are underlined the first time they appear on a page. Hover over one, or tap it, for a short definition.

## Ask AI

The *Ask AI* button opens a chat panel on the right. Ask about the cycle in plain words, for example "What's stopping payroll from being released?", "Who is owed money?" or "What does the handbook say about sick time?".

- **How it answers (RAG).** The browser searches this cycle's data first: exceptions, people, policy clauses, checks, bank and ledger lines, repeat issues, and the rows of every data source, built-in or added. It sends only the best-matching records to the AI, with names, employee IDs and account details replaced. The AI answers from those records and cites them as [R1], [R2]…; each citation opens the exception, person or page it came from.
- **Without the AI** (not connected, turned off in the admin console, or a role without AI access), the panel still searches and lists the closest records.
- Questions are logged in the activity log. *Show real names* is available to roles allowed to see them.

## Admin console

The payroll admin's page (*Admin console* in the sidebar) has four tabs.

- **Monitor.** Everything about the cycle on one page. Release status with pay date, net pay and people paid; the five checks with their live status; the release checklist with a fix for each open item; an employees panel (questions waiting, oldest wait, answered, employee sign-ins and failed sign-ins); blockers open, items awaiting review, percent reviewed, open dollar impact, overdue items and AI use; review progress for each stage; repeat issues by pay period; open work by owner with who covers each queue, overdue counts and the oldest item; the five checks; files received; and the admin activity log (role and policy changes, holds, releases, user switches and blocked actions). Charts have hover details and a table view.
- **Team and access.** Add, rename, deactivate or remove team members, and set each person's role and queue. The four roles are payroll admin, payroll approver, reviewer and viewer. The permissions table sets what each role can do: work exceptions, dismiss, dismiss large blockers, release, reopen, change rules, load data, use the AI, show real names, download, and manage admin settings. An optional admin PIN is asked for when someone switches into a payroll admin. There is always at least one active admin, and nobody can change their own role.
- **Policies.**
  - **Release hold:** stops release for this cycle until an admin lifts it.
  - **A different person must release:** whoever dismissed a pre-release blocker can't also release.
  - **Lock pre-release items after release.**
  - **Dismissal limit:** blockers at or above it need an approver or admin to dismiss.
  - **Approval note:** optionally required to approve a blocker.
  - **Due times:** for blockers and review items. Overdue items can be escalated in one click.
  - **AI on or off:** separately for explanations, suggested causes and the Ask AI chat.
  - **Repeat issues threshold.**
  - **Data due time:** when time records, schedules and the employee list are due.
- **Data and audit.** Download a backup of everything in the browser and restore it on another computer; audit trail counts and CSV export; cycles stored; storage used; clear workspace data (team, roles and policies are kept).

People sign in as themselves on the sign-in page. Settings → *Working as* switches to another team member without signing out (the admin PIN still applies). Roles are enforced for everyone using that browser, and every blocked action is logged.

## What it does

- **Overview.** Shows release readiness, the five check steps with live status, a progress bar of pre-release blockers cleared, blockers by owner, cycle totals and key dates (funding, settlement, GL post, ACH returns), open dollar impact, and recent activity.
- **Review queue.** Filter by status, severity, stage, owner or search. The detail panel shows why it happened, the cited evidence, the policy clause, owner reassignment, notes and full history. Bulk actions: assign, approve, dismiss (reason required), escalate. Buttons a person's role doesn't allow are disabled, with the reason shown.
- **Release gate.** *Release payroll* stays locked until every pre-release blocker (the time, roster and register checks) is approved or dismissed. It also respects the admin's hold and the different-person rule. Approval asks you to confirm the dismissed blockers and their reasons, and records the approver, a note and the totals. Released cycles feed Repeat issues' history. A released cycle can be reopened with a reason.
- **People.** Register gross vs validated gross for everyone. Click a person for the timecard (scheduled vs worked), pay rebuilt from WFM time and contract rates, PTO balances and deposits.
- **All checks** (a tab of Rules). All 39 checks by stage, each with its rule and its result.
- **Import.** Drop a cycle's exports anywhere in the app, several at once: CSV, JSON or the printed PDF register (read with pdf.js). Each file is matched to its source by its columns. Common vendor header names are recognized (for example "Employee ID", "File #", "Home Department", "Total Hours", "Lunch Out"). Anything unrecognized is mapped in a column mapper, and Rollcall remembers each mapping for files with the same columns. On import, US dates, 12-hour punches, `$1,234.56` amounts and `(negative)` amounts are normalized. Importing into the sample workspace replaces the sample cycle. CSV templates are available for each source.
- **Data sources.** Each source is set to *File* or *API*. In API mode, the browser calls your HTTPS endpoint directly, with an optional Authorization header that is kept for the session only. Use `{start}`/`{end}` in the URL for the pay period dates. The endpoint must return CSV or JSON rows and allow CORS. *Start a new cycle* clears the WFM, payroll, bank and GL data; policies, rule changes and saved column mappings carry over.
- **Rules.** Your own rules (see above), plus the thresholds from the union agreement and the handbook. Every change re-runs the checks and is logged.
- **Reports.** Release brief (.txt), exception register with statuses and notes (.csv), pay variance (.csv) and audit trail (.csv).
- **Activity log** (a tab of Reports). An append-only log of every status change, note, reassignment, rule change, data load, re-run, release, admin change and blocked action.

Statuses, notes, releases, team, roles, policies, rule changes, column mappings and imported data are stored in the browser (localStorage). Files are read client-side and are not sent anywhere. Nothing is shared between browsers or teammates automatically. Use the admin console's backup to move a workspace; sharing it live would need a backend.

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

- `middleware.js` — the team password check that runs on Vercel before anything is served (turned on by `SITE_PASSWORD`).
- `api/ai.mjs` — the AI function behind *Why it happened* and suggested causes (Vercel, Groq).
- `app/brand/` — logo mark, wordmark, favicon and app icon.
- `app/` — source. `index.html` is the shell and styles, `app.js` holds the pages, workflow, release gate, admin console, roles and persistence, `engine.js` holds the checks, and `sample-data.js` has the sample files embedded. `index.html` is written without an `<html>` wrapper; `build_dist.py` adds one.
- `public/` — the built static site for Vercel, made by `build_dist.py`
- `data/` — the sample files to upload: census, schedules, time records, register (CSV and PDF), bank activity, GL journal, union agreement, handbook and finance rules with numbered policy clauses, GL mapping, and `exception_history.json` (five earlier pay periods for Repeat issues). `seeded_issues.json` lists what was planted.
- `generator/generate_data.py` — builds the sample cycle from the same rules the engine checks
- `tests/engine.test.js` — regression test against the seeded issues
- `tests/middleware.test.mjs` — tests for the team password check

## Notes

- **Sign-in and shared data need a backend for production.** Today everything (team, statuses, questions, sign-in sessions) lives in one browser's storage, so teammates and employees on different devices don't see each other's work. A production setup needs an identity provider for single sign-on, a database for the workspace and questions (for example a Postgres database added to the Vercel project), and API routes that check each person's role and, for employees, return only their own records.

- The definitions follow the FLSA: non-exempt employees are hourly and earn overtime; exempt employees are salaried and don't.
- Dollar impacts marked *est.* are estimates. A missing check-out is valued at the scheduled shift. Time for someone missing from payroll is valued at the median rate for that location.
- The engine attributes each dollar once. The ghost employee's pay is counted in R2 and not again in F5. The NJ employer SUI gap is counted in F6 (tax) and G4 (GL) and not again in G5.
