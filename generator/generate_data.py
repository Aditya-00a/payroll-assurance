#!/usr/bin/env python3
"""Generate the Northloom Apparel sample pay cycle.

One biweekly pay cycle (Sun 2026-09-13 to Sat 2026-09-26, pay date Fri 2026-10-02)
for a fictional NY/NJ clothing retailer, flowing through every system the demo
validates:

    WFM schedules + time records  ->  payroll census + register  ->  bank activity  ->  GL journal

The data is internally consistent except for the issues listed in SEEDED_ISSUES,
which are injected on purpose so the validation engine has something to find.
Every number is derived from the same rules the engine applies, so employees
without a seeded issue must come through clean.

Outputs (written to ../data and ../app/sample-data.js):
    census.csv, schedules.csv, time_records.csv, payroll_register.csv,
    payroll_register.pdf, bank_activity.csv, gl_journal.csv,
    union_agreement.json, employee_handbook.json, gl_mapping.json,
    seeded_issues.json
"""
import base64
import csv
import io
import json
import math
import random
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
APP = ROOT / "app"

PERIOD_START = date(2026, 9, 13)  # Sunday
PERIOD_END = date(2026, 9, 26)  # Saturday
PAY_DATE = date(2026, 10, 2)
FUNDING_DATE = date(2026, 9, 30)
RETURN_DATE = date(2026, 10, 6)
DAYS = [PERIOD_START + timedelta(days=i) for i in range(14)]


def r2(x):
    return float(Decimal(repr(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def iso(d):
    return d.isoformat() if d else ""


# --------------------------------------------------------------------------------------
# Policies
# --------------------------------------------------------------------------------------

UNION_AGREEMENT = {
    "name": "Collective Bargaining Agreement — Store Associates",
    "union": "United Garment & Retail Workers, Local 88",
    "local": "UGRW-88",
    "effective": "2025-04-01",
    "expires": "2028-03-31",
    "covered_locations": ["CC-110", "CC-120", "CC-130"],
    "steps": [
        {"step": 1, "min_years": 0, "label": "0–1 yr"},
        {"step": 2, "min_years": 1, "label": "1–2 yrs"},
        {"step": 3, "min_years": 2, "label": "2–4 yrs"},
        {"step": 4, "min_years": 4, "label": "4–7 yrs"},
        {"step": 5, "min_years": 7, "label": "7+ yrs"},
    ],
    "rates": {
        "Sales Associate": [18.50, 19.25, 20.15, 21.40, 22.60],
        "Stock Associate": [18.75, 19.50, 20.40, 21.65, 22.85],
        "Visual Merchandiser": [20.25, 21.10, 22.00, 23.30, 24.50],
        "Lead Associate": [22.50, 23.40, 24.35, 25.70, 27.00],
    },
    "step_basis": "Years of continuous service from union seniority date; step increase effective on the anniversary.",
    "full_time_weekly_hours": 35,
    "overtime": {
        "weekly_after_hours": 35,
        "multiplier": 1.5,
        "sunday_multiplier": 2.0,
        "saturday_multiplier": 1.5,
        "saturday_premium_enabled": False,
        "pyramiding": False,
        "note": "Hours over 35 in the Sun–Sat week at time and a half; all Sunday hours at double time. Premium hours are not paid twice.",
    },
    "clauses": [
        {"id": "CBA 7.1", "title": "Full-time week", "text": "The full-time work week for covered associates is 35 hours, Sunday through Saturday."},
        {"id": "CBA 7.2", "title": "Overtime", "text": "Hours worked over 35 in the work week are paid at time and a half. Monday through Saturday hours within 35 are straight time."},
        {"id": "CBA 7.3", "title": "Sunday premium", "text": "All hours worked on Sunday are paid at double time. Premium hours are not paid twice (no pyramiding)."},
        {"id": "CBA 12.1", "title": "Wage scale", "text": "Covered associates are paid at least the step rate for their title and years of continuous service from the union seniority date."},
        {"id": "CBA 12.2", "title": "Step increases", "text": "A step increase takes effect on the associate's service anniversary."},
    ],
}

HANDBOOK = {
    "name": "Northloom Apparel Employee Handbook — Time Off & Timekeeping (rev. 2026-01)",
    "expected_weekly_hours": {"union_full_time": 35, "non_union_full_time": 40, "exempt_full_time": 40},
    "part_time_max_weekly_hours": 30,
    "part_time_note": "Part-time associates are scheduled 20–30 hours. Regularly working over 30 hours moves an associate into the full-time benefits class.",
    "flsa_overtime_weekly_after_hours": 40,
    "flsa_overtime_multiplier": 1.5,
    "daily_max_hours": 12,
    "punch_rounding_minutes": 15,
    "meal_punch_required_after_hours": 6,
    "work_week": "Sunday 12:00 AM through Saturday 11:59 PM",
    "valid_pay_codes": ["REG", "VAC", "SICK", "HOL", "BRV"],
    "company_holidays_2026": [
        "2026-01-01", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ],
    "vacation": {
        "accrual_per_pay_period_hours": {
            "UNION_FT": 2.69, "HOURLY_FT": 3.08, "SALARIED": 4.62, "UNION_PT": 0, "HOURLY_PT": 0,
        },
        "waiting_period_days": 90,
        "carryover_cap_hours": 40,
        "carryover_expires": "December 31 of the following year",
        "draw_order": ["carryover", "current"],
        "payout_on_termination": False,
    },
    "sick": {
        "method": "front_loaded_with_accrued_bank",
        "annual_hours_full_time": 40,
        "annual_hours_part_time": 24,
        "buckets": ["accrued", "current"],
        "draw_order": ["accrued", "current"],
        "note": "A current-year sick grant is made on January 1. Unused hours from prior years sit in the accrued balance. Sick time draws from the accrued balance first, then the current-year bucket.",
    },
    "clauses": [
        {"id": "HB 3.1", "title": "Work week", "text": "The work week runs Sunday 12:00 AM through Saturday 11:59 PM."},
        {"id": "HB 3.2", "title": "Punches", "text": "Associates punch in and out for every shift and for every meal break. A meal break is required on shifts over 6 hours."},
        {"id": "HB 3.3", "title": "Missed punches and manager edits", "text": "Missed punches are corrected by the store manager in WFM before WFM close, with a reason. Hours entered without punches need a documented approval and are reviewed by Payroll."},
        {"id": "HB 3.4", "title": "Rounding", "text": "Punches round to the nearest 15 minutes (7-minute rule). WFM must not snap punches to the schedule."},
        {"id": "HB 3.5", "title": "Daily maximum", "text": "No shift may exceed 12 hours without district manager approval."},
        {"id": "HB 3.6", "title": "Schedules", "text": "Associates work their published schedule. Absences are coded with a time-off code; unscheduled shifts need manager approval."},
        {"id": "HB 4.1", "title": "Expected hours", "text": "Full-time non-union associates are expected to work 40 hours a week and exempt staff 40 hours. Part-time associates are scheduled 20 to 30 hours; regularly working more than 30 hours moves an associate into the full-time benefits class."},
        {"id": "HB 4.2", "title": "Overtime (non-union)", "text": "Non-exempt hours over 40 in the work week are paid at 1.5 times the regular rate. Exempt salaried staff are not paid overtime, and their salary does not change with hours worked."},
        {"id": "HB 5.1", "title": "Pay codes", "text": "Valid pay codes are REG, VAC, SICK, HOL and BRV. HOL is paid only on company holidays: Jan 1, May 25, Jul 3, Sep 7, Nov 26 and Dec 25 in 2026."},
        {"id": "HB 6.1", "title": "Vacation accrual", "text": "Eligible full-time associates accrue vacation each pay period after a 90-day waiting period: 2.69h union, 3.08h hourly, 4.62h salaried."},
        {"id": "HB 6.2", "title": "Vacation carryover", "text": "Up to 40 hours of unused vacation carries over at January 1; anything above 40 hours is forfeited. Carryover expires December 31 of the following year."},
        {"id": "HB 6.3", "title": "Vacation draw order", "text": "Vacation draws from carryover first, then the current-year balance."},
        {"id": "HB 7.1", "title": "Sick time", "text": "Full-time associates receive a 40-hour current-year sick grant on January 1, part-time associates 24 hours. Unused sick hours from prior years remain in the accrued balance."},
        {"id": "HB 7.2", "title": "Sick draw order", "text": "Sick time draws from the accrued balance first, then the current-year bucket."},
        {"id": "HB 7.3", "title": "Coding sick days", "text": "Time off for illness is coded SICK. It may not be coded as vacation, even at the associate's request."},
        {"id": "HB 7.4", "title": "Balances", "text": "Time off cannot be taken beyond the available balance without an approved advance."},
        {"id": "HB 8.1", "title": "Start dates and payroll records", "text": "Payroll is the system of record for employment. The payroll hire date is the associate's first day of work, and new hires are set up in payroll before their first shift. WFM time must fall between the hire and termination dates."},
        {"id": "HB 8.2", "title": "Direct deposit changes", "text": "Direct deposit changes entered after the payroll batch is built take effect on the following pay date. Payroll prenotes new accounts."},
    ],
}

COST_CENTERS = {
    "CC-110": ("SoHo Flagship", "NY"),
    "CC-120": ("Williamsburg", "NY"),
    "CC-130": ("Jersey City", "NJ"),
    "CC-140": ("Hudson Yards Pop-up", "NY"),
    "CC-310": ("Secaucus Distribution Center", "NJ"),
    "CC-900": ("Corporate — Merchandising & Admin", "NY"),
}

GL_MAPPING = {
    "name": "Payroll GL mapping — Northloom Apparel (entity 100)",
    "accounts": {
        "1010": "Cash — Payroll Account",
        "2200": "Payroll Taxes Payable",
        "2210": "401(k) Deferrals Payable",
        "2220": "Medical Premiums Payable",
        "2310": "Accrued Vacation",
        "6010": "Wages — Union Hourly",
        "6020": "Wages — Non-Union Hourly",
        "6030": "Salaries — Exempt",
        "6040": "Overtime & Premium Pay",
        "6050": "Paid Time Off",
        "6060": "Vacation Accrual Expense",
        "6100": "Employer Payroll Taxes",
        "9999": "Suspense — Unmapped",
    },
    "wage_account_by_class": {"UNION": "6010", "HOURLY": "6020", "SALARIED": "6030"},
    "premium_account": "6040",
    "pto_account": "6050",
    "employer_tax_account": "6100",
    "vacation_accrual_expense_account": "6060",
    "vacation_liability_account": "2310",
    "liability_accounts": {"taxes": "2200", "k401": "2210", "medical": "2220"},
    "cash_account": "1010",
    "suspense_account": "9999",
    # CC-140 (the pop-up that opened 2026-09-08) has not been added yet: seeded issue.
    "cost_centers": {cc: name for cc, (name, _) in COST_CENTERS.items() if cc != "CC-140"},
    "clauses": [
        {"id": "FIN 2.1", "title": "Net pay funding", "text": "Treasury funds net pay to the processor's impound account two business days before the pay date, equal to register net pay."},
        {"id": "FIN 2.2", "title": "ACH settlement", "text": "Each direct deposit equals the employee's register net pay and goes to the account on file in the payroll census."},
        {"id": "FIN 2.3", "title": "ACH returns", "text": "Returned deposits are reissued within one business day, by off-cycle deposit to the corrected account or by check."},
        {"id": "FIN 2.4", "title": "Shared accounts", "text": "No two employees may deposit to the same bank account without HR documentation."},
        {"id": "FIN 3.1", "title": "Tax remittance", "text": "Employee withholdings and employer taxes on the register are funded and remitted to each jurisdiction in full each cycle."},
        {"id": "FIN 3.2", "title": "Benefit remittance", "text": "401(k) deferrals and medical premiums withheld are remitted to the recordkeeper and carrier each pay date."},
        {"id": "FIN 4.1", "title": "Journal entry", "text": "The payroll journal entry balances and posts wages by employee class and cost center: union 6010, non-union hourly 6020, salaried 6030, premium 6040, PTO 6050."},
        {"id": "FIN 4.2", "title": "Cost-center mapping", "text": "Every cost center on the register is in the GL map. Postings to 9999 Suspense must be reclassed before month-end close."},
        {"id": "FIN 4.3", "title": "Taxes and liabilities", "text": "Employer tax expense (6100) and payroll liabilities (2200, 2210, 2220) equal the register."},
        {"id": "FIN 4.4", "title": "Vacation accrual", "text": "The vacation accrual true-up equals the change in validated vacation balances, valued at each employee's rate."},
    ],
}

# --------------------------------------------------------------------------------------
# Shift templates: (start, end, meal_start, meal_minutes)
# --------------------------------------------------------------------------------------

ST7 = ("10:00", "18:00", "14:00", 60)  # store, 7h
ST7B = ("11:00", "19:00", "15:00", 60)  # store late, 7h
SK7 = ("07:00", "15:00", "11:00", 60)  # stockroom, 7h
DC8 = ("07:00", "15:30", "11:00", 30)  # distribution center, 8h
CO8 = ("09:00", "18:00", "13:00", 60)  # corporate / salaried, 8h
MG10 = ("08:00", "19:00", "13:00", 60)  # store manager long day, 10h
DM8 = ("07:00", "16:00", "11:30", 60)  # DC manager, 8h
PT6 = ("12:00", "18:00", None, 0)  # part-time, 6h
PT7 = ("11:00", "18:30", "14:30", 30)  # part-time, 7h
PU8 = ("10:00", "18:30", "14:00", 30)  # pop-up, 8h

PATTERNS = {
    "MF": [1, 2, 3, 4, 5],
    "TS": [2, 3, 4, 5, 6],
    "SuTh": [0, 1, 2, 3, 4],
    "WSu": [0, 3, 4, 5, 6],
    "ThSu": [0, 4, 5, 6],
    "FM": [0, 1, 5, 6],
    "MTh": [1, 2, 3, 4],
    "FSu": [0, 5, 6],
    "ThS": [4, 5, 6],
    "WThF": [3, 4, 5],
}

FIRST_LAST = lambda s: s.split(" ", 1)  # noqa: E731

# id, name, title, cc, union, flsa, ftpt, paytype, rate_or_salary, hire, term,
# pattern, shift, bank_routing, bank_last4, vac_co, vac_cur, sick, k401, medical
EMPLOYEES = [
    # ---- Union full-time (UGRW Local 88), non-exempt hourly
    ("E1001", "Maya Chen", "Lead Associate", "CC-110", True, "Non-Exempt", "FT", "Hourly", 27.00, "2017-03-12", None, "TS", ST7, "021000021", "5521", 48.0, 31.5, 32.0, 0.06, 96.25),
    ("E1002", "Luis Ortega", "Sales Associate", "CC-110", True, "Non-Exempt", "FT", "Hourly", 21.40, "2021-05-03", None, "SuTh", ST7, "026009593", "1187", 14.0, 22.5, 40.0, 0.04, 48.50),
    ("E1003", "Priya Natarajan", "Sales Associate", "CC-110", True, "Non-Exempt", "FT", "Hourly", 20.15, "2023-08-14", None, "MF", ST7, "021000089", "6640", 0.0, 18.0, 40.0, 0.03, 48.50),
    ("E1004", "Jamal Wright", "Sales Associate", "CC-120", True, "Non-Exempt", "FT", "Hourly", 20.15, "2022-06-20", None, "TS", ST7B, "021000021", "7302", 7.0, 25.0, 24.0, 0.05, 96.25),
    ("E1005", "Sofia Alvarez", "Visual Merchandiser", "CC-110", True, "Non-Exempt", "FT", "Hourly", 24.50, "2019-02-11", None, "MF", ST7, "026009593", "2290", 0.0, 42.0, 40.0, 0.06, 142.80),
    ("E1006", "Kevin O'Brien", "Stock Associate", "CC-120", True, "Non-Exempt", "FT", "Hourly", 21.65, "2020-11-02", None, "MF", SK7, "021000021", "8815", 21.0, 30.0, 40.0, 0.04, 96.25),
    ("E1007", "Aaliyah Brooks", "Sales Associate", "CC-120", True, "Non-Exempt", "FT", "Hourly", 20.15, "2024-04-22", None, "MF", ST7B, "021000089", "4419", 0.0, 12.0, 40.0, 0.00, 48.50),
    ("E1008", "Marcus Lee", "Stock Associate", "CC-130", True, "Non-Exempt", "FT", "Hourly", 22.85, "2018-07-09", None, "MF", SK7, "021200025", "3058", 10.0, 36.0, 40.0, 0.05, 142.80),
    ("E1009", "Hannah Kim", "Sales Associate", "CC-130", True, "Non-Exempt", "FT", "Hourly", 19.25, "2025-01-06", None, "TS", ST7, "021200025", "9921", 0.0, 9.0, 40.0, 0.00, 0.00),
    ("E1010", "Tomás Rivera", "Lead Associate", "CC-130", True, "Non-Exempt", "FT", "Hourly", 27.00, "2016-10-03", None, "WSu", ST7, "021200025", "6684", 16.0, 28.0, 40.0, 0.06, 142.80),
    ("E1011", "Grace Okafor", "Sales Associate", "CC-110", True, "Non-Exempt", "FT", "Hourly", 19.25, "2024-11-18", None, "MF", ST7, "021000021", "1043", 0.0, 10.0, 8.0, 0.00, 48.50),
    ("E1012", "Diego Santos", "Stock Associate", "CC-110", True, "Non-Exempt", "FT", "Hourly", 20.40, "2023-02-27", None, "MF", ST7, "026009593", "4471", 0.0, 20.0, 40.0, 0.03, 48.50),
    ("E1013", "Nina Petrova", "Visual Merchandiser", "CC-120", True, "Non-Exempt", "FT", "Hourly", 23.30, "2022-01-10", None, "MF", ST7, "021000089", "5376", 4.0, 26.0, 40.0, 0.04, 96.25),
    ("E1014", "Andre Johnson", "Sales Associate", "CC-120", True, "Non-Exempt", "FT", "Hourly", 21.40, "2020-03-16", None, "TS", ST7, "021000021", "2817", 0.0, 33.0, 40.0, 0.05, 96.25),
    ("E1015", "Chloe Martin", "Sales Associate", "CC-110", True, "Non-Exempt", "FT", "Hourly", 19.25, "2025-06-02", None, "MF", ST7B, "026009593", "7710", 0.0, 8.0, 40.0, 0.00, 48.50),
    ("E1016", "Ryan Patel", "Stock Associate", "CC-130", True, "Non-Exempt", "FT", "Hourly", 21.65, "2021-09-13", None, "MF", SK7, "021200025", "3392", 0.0, 24.0, 40.0, 0.04, 96.25),
    ("E1017", "Isabella Rossi", "Lead Associate", "CC-120", True, "Non-Exempt", "FT", "Hourly", 27.00, "2019-05-20", None, "WSu", ST7B, "021000089", "6205", 12.0, 30.0, 40.0, 0.06, 142.80),
    ("E1018", "Ethan Brown", "Sales Associate", "CC-130", True, "Non-Exempt", "FT", "Hourly", 20.15, "2023-03-06", None, "MF", ST7, "021200025", "8143", 0.0, 15.0, 40.0, 0.03, 48.50),
    # ---- Union part-time
    ("E1019", "Zoe Turner", "Sales Associate", "CC-110", True, "Non-Exempt", "PT", "Hourly", 19.25, "2025-09-08", None, "ThSu", PT6, "021000021", "9034", 0.0, 0.0, 24.0, 0.00, 0.00),
    ("E1025", "Liam Murphy", "Sales Associate", "CC-120", True, "Non-Exempt", "PT", "Hourly", 20.15, "2024-07-15", None, "FM", PT7, "026009593", "1566", 0.0, 0.0, 24.0, 0.00, 0.00),
    ("E1026", "Ava Nguyen", "Stock Associate", "CC-130", True, "Non-Exempt", "PT", "Hourly", 18.75, "2026-02-02", None, "MTh", PT6, "021200025", "4780", 0.0, 0.0, 24.0, 0.00, 0.00),
    # ---- Non-union hourly full-time
    ("E1020", "Omar Haddad", "Warehouse Associate", "CC-310", False, "Non-Exempt", "FT", "Hourly", 21.50, "2022-04-11", None, "MF", DC8, "021200025", "2651", 0.0, 40.0, 40.0, 0.04, 96.25),
    ("E1021", "Bianca Lopez", "Warehouse Associate", "CC-310", False, "Non-Exempt", "FT", "Hourly", 20.75, "2023-10-02", None, "MF", DC8, "021200025", "7468", 8.0, 22.0, 40.0, 0.03, 48.50),
    ("E1022", "Carlos Mendez", "Warehouse Associate", "CC-310", False, "Non-Exempt", "FT", "Hourly", 20.75, "2021-01-19", "2026-09-18", "MF", DC8, "021200025", "5092", 0.0, 16.0, 40.0, 0.04, 96.25),
    ("E1023", "Fatima Diallo", "Warehouse Lead", "CC-310", False, "Non-Exempt", "FT", "Hourly", 24.25, "2020-06-22", None, "MF", DC8, "021200025", "1839", 20.0, 35.0, 40.0, 0.06, 142.80),
    ("E1024", "Jack Wilson", "Customer Service Representative", "CC-900", False, "Non-Exempt", "FT", "Hourly", 22.00, "2022-08-08", None, "MF", CO8, "021000021", "6327", 6.0, 27.0, 40.0, 0.05, 96.25),
    ("E1027", "Mei Lin", "Pop-up Associate", "CC-140", False, "Non-Exempt", "FT", "Hourly", 19.50, "2026-09-08", None, "WSu", PU8, "021000089", "8806", 0.0, 0.0, 40.0, 0.00, 0.00),
    ("E1028", "Samuel Green", "Warehouse Associate", "CC-310", False, "Non-Exempt", "FT", "Hourly", 20.25, "2024-02-05", None, None, None, "021200025", "3375", 0.0, 30.0, 40.0, 0.03, 48.50),
    ("E1098", "Daniel Reyes", "Warehouse Associate", "CC-310", False, "Non-Exempt", "FT", "Hourly", 21.00, "2026-07-20", None, None, None, "021000021", "3317", 0.0, 0.0, 40.0, 0.00, 0.00),
    # ---- Non-union hourly part-time
    ("E1029", "Elena Popescu", "Pop-up Associate", "CC-140", False, "Non-Exempt", "PT", "Hourly", 19.50, "2026-09-08", None, "FSu", PU8, "026009593", "2044", 0.0, 0.0, 24.0, 0.00, 0.00),
    ("E1030", "Noah Fischer", "Warehouse Associate", "CC-310", False, "Non-Exempt", "PT", "Hourly", 20.00, "2025-03-17", None, "ThS", DC8, "021200025", "6912", 0.0, 0.0, 24.0, 0.00, 0.00),
    ("E1038", "Marisol Vega", "Warehouse Associate", "CC-310", False, "Non-Exempt", "PT", "Hourly", 20.00, "2026-09-21", None, "WThF", DC8, "021200025", "6120", 0.0, 0.0, 24.0, 0.00, 0.00),
    # ---- Salaried exempt
    ("E1031", "Rachel Adler", "Store Manager", "CC-110", False, "Exempt", "FT", "Salary", 92000, "2018-04-02", None, "MF", CO8, "021000021", "4108", 24.0, 60.0, 40.0, 0.06, 142.80),
    ("E1032", "David Kowalski", "Store Manager", "CC-130", False, "Exempt", "FT", "Salary", 88000, "2019-09-16", None, "MF", MG10, "021200025", "7759", 30.0, 55.0, 40.0, 0.05, 142.80),
    ("E1033", "Jasmine Carter", "Assistant Store Manager", "CC-120", False, "Exempt", "FT", "Salary", 64000, "2026-09-23", None, "MF", CO8, "021000089", "5163", 0.0, 0.0, 40.0, 0.00, 0.00),
    ("E1034", "Owen Price", "Merchandise Planner", "CC-900", False, "Exempt", "FT", "Salary", 105000, "2020-01-13", None, "MF", CO8, "021000021", "8492", 16.0, 70.0, 40.0, 0.06, 142.80),
    ("E1035", "Laura Benson", "Distribution Center Manager", "CC-310", False, "Exempt", "FT", "Salary", 98000, "2017-08-28", None, "MF", DM8, "021200025", "2978", 40.0, 64.0, 40.0, 0.05, 142.80),
    ("E1036", "Renee Walsh", "Payroll Specialist", "CC-900", False, "Exempt", "FT", "Salary", 72000, "2021-11-01", None, "MF", CO8, "021000021", "3317", 8.0, 44.0, 40.0, 0.04, 96.25),
    ("E1037", "Victor Huang", "HR Generalist", "CC-900", False, "Exempt", "FT", "Salary", 70000, "2023-05-22", None, "MF", CO8, "026009593", "1702", 0.0, 38.0, 40.0, 0.03, 48.50),
]

# Accrued (prior-year) sick balances; everyone else has 0.
SICK_ACCRUED = {"E1001": 16.0, "E1008": 8.0, "E1010": 12.0, "E1013": 12.0, "E1017": 8.0, "E1023": 16.0,
                "E1032": 20.0, "E1035": 24.0}

# Present in WFM only (onboarded to timekeeping, never set up in payroll).
WFM_ONLY = [("E1099", "Kayla Simmons", "Pop-up Associate", "CC-140", PU8)]

# Bank account on the register / ACH for E1012 before the change entered 2026-09-30.
E1012_OLD_ACCOUNT = "8820"
E1012_BANK_CHANGE = "2026-09-30"

SEEDED_ISSUES = [
    {"emp": "E1007", "check": "T1", "note": "Check-in with no check-out on Tue 9/22"},
    {"emp": "E1012", "check": "T1", "note": "Left for lunch Thu 9/17, no return punch; WFM credited 8.0h"},
    {"emp": "E1001", "check": "T1", "note": "Left for lunch Tue 9/22 at SoHo Flagship, no return punch (recurs every period)"},
    {"emp": "E1021", "check": "T2", "note": "Manager entered 8.0h for a day with no punches"},
    {"emp": "E1016", "check": "T9", "note": "Sick day coded as vacation"},
    {"emp": "E1038", "check": "R5", "note": "Payroll start date Mon 9/21, time records begin Wed 9/23"},
    {"emp": "E1013", "check": "P9", "note": "Sick time drawn from the current-year bucket while an accrued balance remains"},
    {"emp": "E1015", "check": "T2", "note": "Two manager overrides with no punches"},
    {"emp": "E1013", "check": "T3", "note": "WFM snapped a 9:38 punch-in to the 10:00 schedule start"},
    {"emp": "E1009", "check": "T4", "note": "No-show on scheduled Sat 9/26"},
    {"emp": "E1018", "check": "T4", "note": "Unscheduled Sunday shift 9/20"},
    {"emp": "E1003", "check": "T5", "note": "28.0h vs 35h union week, no PTO coded"},
    {"emp": "E1007", "check": "T5", "note": "Short week caused by the missing punch"},
    {"emp": "E1009", "check": "T5", "note": "Short week caused by the no-show"},
    {"emp": "E1037", "check": "T5", "note": "Exempt employee 32.5h vs 40h"},
    {"emp": "E1025", "check": "T7", "note": "Part-time associate over 30h both weeks"},
    {"emp": "E1024", "check": "T8", "note": "13.5h shift"},
    {"emp": "E1030", "check": "T9", "note": "HOL coded 9/14; Labor Day was 9/7"},
    {"emp": "E1011", "check": "T10", "note": "14h sick coded against an 8h balance"},
    {"emp": "E1099", "check": "R1", "note": "Worked 40h in WFM, no payroll record"},
    {"emp": "E1098", "check": "R2", "note": "Paid in payroll with no WFM profile or time (ghost)"},
    {"emp": "E1028", "check": "R2", "note": "Active in payroll, no WFM time and no pay"},
    {"emp": "E1033", "check": "R3", "note": "Worked 9/21–9/22, payroll hire date 9/23"},
    {"emp": "E1022", "check": "R4", "note": "Time auto-filled after 9/18 termination"},
    {"emp": "E1014", "check": "P1", "note": "Register rate 21.04 vs census 21.40"},
    {"emp": "E1004", "check": "P2", "note": "Step 4 since 6/20 anniversary, still paid step 3"},
    {"emp": "E1008", "check": "P3", "note": "Sick day also paid as regular hours"},
    {"emp": "E1020", "check": "P4", "note": "46h week paid as straight time"},
    {"emp": "E1018", "check": "P4", "note": "Sunday hours paid at 1.5x instead of 2.0x"},
    {"emp": "E1031", "check": "P5", "note": "Exempt store manager paid overtime"},
    {"emp": "E1016", "check": "P7", "note": "Medicare not withheld"},
    {"emp": "E1001", "check": "P9", "note": "Carryover 48h over the 40h cap"},
    {"emp": "E1005", "check": "P9", "note": "Vacation used but balance not decremented"},
    {"emp": "E1006", "check": "P9", "note": "Vacation drawn from current instead of carryover"},
    {"emp": "E1021", "check": "F2", "note": "ACH $200 less than register net"},
    {"emp": "E1012", "check": "F3", "note": "ACH sent to old account after bank change"},
    {"emp": "E1012", "check": "F4", "note": "R03 return"},
    {"emp": "E1098", "check": "F5", "note": "Shares bank account with payroll specialist E1036"},
    {"emp": None, "check": "F6", "note": "NJ employer SUI not remitted"},
    {"emp": None, "check": "G3", "note": "CC-140 not mapped, posted to suspense"},
    {"emp": None, "check": "G4", "note": "Employer tax expense missing NJ SUI"},
    {"emp": None, "check": "G5", "note": "Taxes payable missing NJ SUI"},
    {"emp": None, "check": "G7", "note": "Vacation accrual overstated (E1005 balance)"},
]

CLEAN_CONTROLS = ["E1002", "E1010", "E1017", "E1019", "E1023", "E1026", "E1032", "E1034", "E1035"]


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------

def tmin(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def mstr(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def round_q(m, inc=15):
    return int(math.floor(m / inc + 0.5)) * inc


def calc_hours(rec):
    if not rec["in"] or not rec["out"]:
        return None
    if bool(rec["mo"]) != bool(rec["mi"]):
        return None
    span = round_q(tmin(rec["out"])) - round_q(tmin(rec["in"]))
    if rec["mo"]:
        span -= round_q(tmin(rec["mi"])) - round_q(tmin(rec["mo"]))
    return span / 60


def sched_hours(shift):
    start, end, _, meal = shift
    return (tmin(end) - tmin(start) - meal) / 60


def make_shift(start, end, meal_start=None, meal=0):
    return (start, end, meal_start, meal)


def years_between(a, b):
    years = b.year - a.year - ((b.month, b.day) < (a.month, a.day))
    anniv = date(a.year + years, a.month, a.day)
    nxt = date(a.year + years + 1, a.month, a.day)
    return years + (b - anniv).days / (nxt - anniv).days


def emp_class(e):
    union, flsa, ftpt, paytype = e["union"], e["flsa"], e["ftpt"], e["paytype"]
    if union:
        return "UNION_FT" if ftpt == "FT" else "UNION_PT"
    if paytype == "Salary":
        return "SALARIED"
    return "HOURLY_FT" if ftpt == "FT" else "HOURLY_PT"


def gl_class(cls):
    return "UNION" if cls.startswith("UNION") else ("SALARIED" if cls == "SALARIED" else "HOURLY")


# --------------------------------------------------------------------------------------
# Build WFM schedules and time records
# --------------------------------------------------------------------------------------

def build():
    emps = []
    for row in EMPLOYEES:
        (eid, name, title, cc, union, flsa, ftpt, paytype, pay, hire, term, pattern, shift,
         routing, last4, vco, vcur, sick, k401, med) = row
        first, last = FIRST_LAST(name)
        emps.append(dict(
            id=eid, name=name, first=first, last=last, title=title, cc=cc, union=union, flsa=flsa,
            ftpt=ftpt, paytype=paytype, rate=pay if paytype == "Hourly" else None,
            salary=pay if paytype == "Salary" else None, hire=date.fromisoformat(hire),
            term=date.fromisoformat(term) if term else None, pattern=pattern, shift=shift,
            routing=routing, last4=last4, vco=vco, vcur=vcur, sick=sick, k401=k401, med=med,
            state=COST_CENTERS[cc][1], location=COST_CENTERS[cc][0],
        ))
    for e in emps:
        e["cls"] = emp_class(e)

    schedules = {}  # (emp, day_index) -> shift
    records = {}  # (emp, day_index) -> list of records

    def sched(eid, i, shift):
        schedules[(eid, i)] = shift

    def worked(eid, i, shift, rng, **over):
        start, end, meal_start, meal = shift
        rec = {"code": "REG", "in": "", "mo": "", "mi": "", "out": "", "override": "N", "by": "", "reason": "", "note": ""}
        j = lambda: rng.randint(-6, 6)  # noqa: E731 - stays inside the 15-minute rounding band
        rec["in"] = mstr(tmin(start) + j())
        rec["out"] = mstr(tmin(end) + j())
        if meal_start:
            ms = tmin(meal_start)
            rec["mo"] = mstr(ms + j())
            rec["mi"] = mstr(ms + meal + j())
        rec.update(over)
        h = calc_hours(rec)
        rec["hours"] = h if h is not None else 0.0
        records.setdefault((eid, i), []).append(rec)
        return rec

    def pto(eid, i, code, hours, note=""):
        records.setdefault((eid, i), []).append({
            "code": code, "in": "", "mo": "", "mi": "", "out": "", "hours": hours,
            "override": "N", "by": "", "reason": "", "note": note,
        })

    by_id = {e["id"]: e for e in emps}

    for e in emps:
        if not e["pattern"]:
            continue
        rng = random.Random(1000 + int(e["id"][1:]))
        for i, d in enumerate(DAYS):
            if (i % 7) in PATTERNS[e["pattern"]]:
                sched(e["id"], i, e["shift"])

    # Extra scheduled shifts
    sched("E1020", 13, make_shift("07:00", "13:00"))  # Sat inventory count, 6h
    sched("E1023", 6, make_shift("07:00", "11:00"))  # Sat 4h
    sched("E1025", 4, make_shift("12:00", "15:30"))  # Thu 3.5h (week 1)
    sched("E1025", 11, make_shift("12:00", "17:00"))  # Thu 5h (week 2)
    sched("E1099", 8, PU8)
    for i in range(8, 13):
        sched("E1099", i, PU8)
    # E1033 is scheduled from Mon 9/21 in WFM (payroll hire date says 9/23)
    for i in list(schedules):
        if i[0] == "E1033" and i[1] < 8:
            del schedules[i]
    # E1038 is hired Mon 9/21 in payroll, but WFM schedules and time begin Wed 9/23
    for i in list(schedules):
        if i[0] == "E1038" and i[1] < 10:
            del schedules[i]

    # Default: work every scheduled shift
    for (eid, i), shift in sorted(schedules.items()):
        rng = random.Random(hash((eid, i)) & 0xFFFF)
        rng.seed(int(eid[1:]) * 100 + i)
        records_for = by_id.get(eid)
        if records_for and records_for["term"] and DAYS[i] > records_for["term"]:
            continue  # handled below
        worked(eid, i, shift, rng)

    def replace(eid, i, recs):
        records[(eid, i)] = recs

    def rec_for(eid, i):
        return records[(eid, i)][0]

    # ---- Seeded WFM issues
    # E1003: leaves at 16:15 four days in week 1 (5.25h) -> 28.0h
    for i in (1, 2, 3, 4):
        r = rec_for("E1003", i)
        r["out"] = "16:16"
        r["hours"] = calc_hours(r)
    # E1007: Tue 9/22 (i=9) punched in, never punched out
    r = rec_for("E1007", 9)
    r["out"] = ""
    r["hours"] = 0.0
    # E1009: no-show Sat 9/26 (i=13)
    del records[("E1009", 13)]
    # E1012: Thu 9/17 (i=4) out to lunch, no return punch; WFM credited the full span
    r = rec_for("E1012", 4)
    r["mi"] = ""
    r["hours"] = (round_q(tmin(r["out"])) - round_q(tmin(r["in"]))) / 60
    # E1001: Tue 9/22 (i=9) out to lunch at SoHo, no return punch; WFM credited the full span
    r = rec_for("E1001", 9)
    r["mi"] = ""
    r["hours"] = (round_q(tmin(r["out"])) - round_q(tmin(r["in"]))) / 60
    # E1021: Wed 9/16 (i=3) manager entered 8.0h with no punches
    replace("E1021", 3, [{
        "code": "REG", "in": "", "mo": "", "mi": "", "out": "", "hours": 8.0, "override": "Y",
        "by": "L. Benson (Distribution Center Manager)", "reason": "Badge reader down — hours confirmed by supervisor",
        "note": "",
    }])
    # E1013: Fri 9/25 (i=12) early punch-in snapped to the 10:00 schedule start
    r = rec_for("E1013", 12)
    r["in"] = "09:38"
    r["hours"] = 7.0
    # E1015: manager overrides Wed 9/16 (i=3) and Wed 9/23 (i=10)
    for i in (3, 10):
        replace("E1015", i, [{
            "code": "REG", "in": "", "mo": "", "mi": "", "out": "", "hours": 7.0, "override": "Y",
            "by": "M. Chen (Lead Associate)", "reason": "Forgot to punch — hours confirmed by manager", "note": "",
        }])
    # E1018: unscheduled Sunday 9/20 (i=7)
    worked("E1018", 7, ST7, random.Random(18007))
    # E1020: Sat 9/26 shift already scheduled (worked by default)
    # E1022: terminated Fri 9/18; Excel schedule import auto-filled Mon/Tue
    for i in (8, 9):
        replace("E1022", i, [{
            "code": "REG", "in": "", "mo": "", "mi": "", "out": "", "hours": 8.0, "override": "Y",
            "by": "Excel schedule import", "reason": "Auto-filled from schedule", "note": "",
        }])
    # E1024: Tue 9/15 (i=2) 13.5h double shift
    replace("E1024", 2, [])
    worked("E1024", 2, make_shift("08:00", "22:00", "13:00", 30), random.Random(24002))
    # E1031: week 2 long days -> 46h (4 x 9h + 10h)
    for i in (8, 9, 10, 11):
        replace("E1031", i, [])
        worked("E1031", i, make_shift("08:30", "18:30", "13:00", 60), random.Random(31000 + i))
    replace("E1031", 12, [])
    worked("E1031", 12, make_shift("08:00", "19:00", "13:00", 60), random.Random(31012))
    # E1037: week 1, leaves at 16:30 every day -> 6.5h x 5 = 32.5h
    for i in (1, 2, 3, 4, 5):
        r = rec_for("E1037", i)
        r["out"] = "16:31"
        r["hours"] = calc_hours(r)

    # ---- PTO coding
    replace("E1005", 10, [])
    pto("E1005", 10, "VAC", 7.0)
    for i in (11, 12):
        replace("E1006", i, [])
        pto("E1006", i, "VAC", 7.0)
    replace("E1008", 8, [])
    pto("E1008", 8, "SICK", 7.0)
    for i in (9, 10):
        replace("E1011", i, [])
        pto("E1011", i, "SICK", 7.0)
    pto("E1030", 1, "HOL", 8.0)  # Mon 9/14 — Labor Day was 9/7
    replace("E1013", 2, [])
    pto("E1013", 2, "SICK", 7.0, note="Out sick")  # drawn from the wrong bucket on the register
    replace("E1016", 11, [])
    pto("E1016", 11, "VAC", 7.0, note="Called out sick (flu)")  # sick day coded as vacation
    replace("E1034", 12, [])
    pto("E1034", 12, "VAC", 8.0)

    records = {k: v for k, v in records.items() if v}
    return emps, schedules, records


# --------------------------------------------------------------------------------------
# Pay calculation (mirrors the engine's rules)
# --------------------------------------------------------------------------------------

def union_rate(e):
    yrs = years_between(e["hire"], PERIOD_END)
    step = max(i for i, s in enumerate(UNION_AGREEMENT["steps"]) if yrs >= s["min_years"])
    return UNION_AGREEMENT["rates"][e["title"]][step], step + 1, yrs


def in_window(e, d):
    return d >= e["hire"] and (e["term"] is None or d <= e["term"])


def weekday_count(e):
    n = 0
    for d in DAYS:
        if d.isoweekday() <= 5 and in_window(e, d):
            n += 1
    return n


def split_hours(e, daily):
    """daily: {i: worked hours}. Returns reg, ot, dt for the period."""
    reg = ot = dt = 0.0
    for w in (0, 1):
        idx = range(w * 7, w * 7 + 7)
        total = sum(daily.get(i, 0) for i in idx)
        sun = daily.get(w * 7, 0)
        if e["cls"].startswith("UNION"):
            o = UNION_AGREEMENT["overtime"]
            wd = total - sun
            w_ot = max(0.0, wd - o["weekly_after_hours"])
            dt += sun
            ot += w_ot
            reg += wd - w_ot
        else:
            w_ot = max(0.0, total - HANDBOOK["flsa_overtime_weekly_after_hours"])
            ot += w_ot
            reg += total - w_ot
    return reg, ot, dt


def accrual_eligible(e):
    if e["cls"] in ("UNION_PT", "HOURLY_PT"):
        return False
    if e["term"] and e["term"] <= PERIOD_END:
        return False
    return (PERIOD_END - e["hire"]).days >= HANDBOOK["vacation"]["waiting_period_days"]


def ytd_estimate(e, annual):
    start = max(e["hire"], date(2026, 1, 1))
    return annual * max(0, (PERIOD_START - start).days) / 365


def build_register(emps, records):
    rows = []
    for e in emps:
        if e["id"] == "E1028":
            continue  # no time, no pay (seeded)
        daily = {}
        vac = sick = hol = 0.0
        for i, d in enumerate(DAYS):
            if not in_window(e, d):
                continue
            for r in records.get((e["id"], i), []):
                if r["code"] == "REG":
                    daily[i] = daily.get(i, 0) + r["hours"]
                elif r["code"] == "VAC":
                    vac += r["hours"]
                elif r["code"] == "SICK":
                    sick += r["hours"]
                elif r["code"] == "HOL":
                    hol += r["hours"]
        if e["id"] == "E1098":
            daily = {i: 8.0 for i in range(14) if 1 <= i % 7 <= 5}  # keyed straight into payroll

        if e["paytype"] == "Hourly":
            reg, ot, dt = split_hours(e, daily)
            rate = e["rate"]
            if e["id"] == "E1014":
                rate = 21.04  # transposed digits on the register
            if e["id"] == "E1020":
                reg, ot = reg + ot, 0.0  # OT paid as straight time
            if e["id"] == "E1018":
                ot, dt = ot + dt, 0.0  # Sunday paid at 1.5x
            if e["id"] == "E1008":
                reg += 7.0  # sick day also keyed as regular
            reg_pay = r2(reg * rate)
            ot_pay = r2(ot * rate * 1.5)
            dt_pay = r2(dt * rate * 2.0)
            pto_pay = r2((vac + sick + hol) * rate)
        else:
            prorate = weekday_count(e) / 10
            period = r2(e["salary"] / 26 * prorate)
            std = 80 * prorate
            pto_hrs = vac + sick + hol
            pto_pay = r2(period * pto_hrs / std) if std else 0.0
            reg_pay = r2(period - pto_pay)
            reg, ot, dt = std - pto_hrs, 0.0, 0.0
            rate = r2(e["salary"] / 2080)
            ot_pay = dt_pay = 0.0
            if e["id"] == "E1031":
                ot = 6.0
                ot_pay = r2(6 * (e["salary"] / 2080) * 1.5)
        gross = r2(reg_pay + ot_pay + dt_pay + pto_pay)

        rng = random.Random(int(e["id"][1:]) * 7)
        fed_rate = 0.07 + (min(gross, 4500) / 4500) * 0.08 + rng.uniform(-0.01, 0.01)
        k401 = r2(gross * e["k401"])
        med = e["med"]
        fica_wages = gross - med
        fed = r2((gross - k401 - med) * fed_rate)
        ss = r2(fica_wages * 0.062)
        mcare = r2(fica_wages * 0.0145)
        if e["id"] == "E1016":
            mcare_ee = 0.0
            mcare_er = 0.0
        else:
            mcare_ee = mcare_er = mcare
        state = e["state"]
        state_wh = r2((gross - k401 - med) * (0.052 if state == "NY" else 0.031))
        state_other = r2(gross * 0.00388 + 1.20) if state == "NY" else r2(gross * 0.0064)
        annual = e["salary"] or e["rate"] * (2080 if e["ftpt"] == "FT" else 1250)
        ytd = ytd_estimate(e, annual)
        futa = r2(max(0.0, min(gross, 7000 - ytd)) * 0.006)
        if state == "NY":
            sui = r2(max(0.0, min(gross, 12800 - ytd)) * 0.041)
        else:
            sui = r2(max(0.0, min(gross, 44800 - ytd)) * 0.0282)
        net = r2(gross - fed - ss - mcare_ee - state_wh - state_other - k401 - med)

        # Vacation & sick balances
        co_b, cur_b, sick_b = e["vco"], e["vcur"], e["sick"]
        accr = HANDBOOK["vacation"]["accrual_per_pay_period_hours"][e["cls"]] if accrual_eligible(e) else 0.0
        co_used = min(vac, co_b)
        cur_used = vac - co_used
        co_e, cur_e = co_b - co_used, r2(cur_b - cur_used + accr)
        if e["id"] == "E1005":
            co_e, cur_e = co_b, cur_b  # balance never decremented (or accrued)
        if e["id"] == "E1006":
            co_e, cur_e = co_b, r2(cur_b - vac + accr)  # drew from current first
        acc_b = SICK_ACCRUED.get(e["id"], 0.0)
        acc_used = min(sick, acc_b)
        acc_e, sick_e = r2(acc_b - acc_used), r2(sick_b - (sick - acc_used))
        if e["id"] == "E1013":
            acc_e, sick_e = acc_b, r2(sick_b - sick)  # drew from the current-year bucket first

        last4 = E1012_OLD_ACCOUNT if e["id"] == "E1012" else e["last4"]
        rows.append({
            "emp_id": e["id"], "employee_name": e["name"], "cost_center": e["cc"],
            "pay_type": "SALARY" if e["paytype"] == "Salary" else "HOURLY", "rate": rate,
            "reg_hrs": reg, "ot_hrs": ot, "dt_hrs": dt, "vac_hrs": vac, "sick_hrs": sick, "hol_hrs": hol,
            "reg_pay": reg_pay, "ot_pay": ot_pay, "dt_pay": dt_pay, "pto_pay": pto_pay, "gross_pay": gross,
            "fed_wh": fed, "ss_ee": ss, "medicare_ee": mcare_ee, "state_wh": state_wh,
            "state_other_ee": state_other, "k401_ee": k401, "medical_ee": med, "net_pay": net,
            "ss_er": ss, "medicare_er": mcare_er, "futa_er": futa, "sui_er": sui, "work_state": state,
            "bank_last4": last4, "vac_co_begin": co_b, "vac_co_end": co_e, "vac_cur_begin": cur_b,
            "vac_cur_end": cur_e, "sick_acc_begin": acc_b, "sick_acc_end": acc_e,
            "sick_begin": sick_b, "sick_end": sick_e,
        })
    return rows


# --------------------------------------------------------------------------------------
# Treasury and GL
# --------------------------------------------------------------------------------------

def build_bank(reg):
    rows = []
    n = [0]

    def add(dt_, typ, amount, emp="", payee="", acct="", rc="", juris="", ref=""):
        n[0] += 1
        rows.append({
            "txn_id": f"BNK-{n[0]:04d}", "value_date": iso(dt_), "txn_type": typ, "amount": r2(amount),
            "emp_id": emp, "payee": payee, "account_last4": acct, "return_code": rc,
            "jurisdiction": juris, "reference": ref,
        })

    total_net = r2(sum(r["net_pay"] for r in reg))
    add(FUNDING_DATE, "NET_PAY_FUNDING", total_net, payee="Payroll processor — net pay impound",
        ref="PR-2026-19 NET")

    fed941 = sum(r["fed_wh"] + r["ss_ee"] + r["medicare_ee"] + r["ss_er"] + r["medicare_er"] for r in reg)
    futa = sum(r["futa_er"] for r in reg)
    ny = sum(r["state_wh"] + r["state_other_ee"] + r["sui_er"] for r in reg if r["work_state"] == "NY")
    # Seeded: NJ employer SUI left out of the NJ remittance
    nj = sum(r["state_wh"] + r["state_other_ee"] for r in reg if r["work_state"] == "NJ")
    remits = [("FED-941", fed941, "IRS — Form 941 deposit"), ("FED-940", futa, "IRS — FUTA (Form 940)"),
              ("NY", ny, "NYS DTF — withholding, SDI/PFL, UI"), ("NJ", nj, "NJ Division of Taxation — withholding, UI/DI/FLI")]
    add(FUNDING_DATE, "TAX_FUNDING", sum(r2(a) for _, a, _ in remits), payee="Payroll processor — tax impound",
        ref="PR-2026-19 TAX")

    for r in reg:
        amt = r["net_pay"]
        if r["emp_id"] == "E1021":
            amt = r2(amt - 200.00)
        add(PAY_DATE, "ACH_CREDIT", amt, emp=r["emp_id"], payee=r["employee_name"], acct=r["bank_last4"],
            ref=f"TRC 0210000{int(r['emp_id'][1:]):04d}")
    for code, amt, payee in remits:
        add(PAY_DATE, "TAX_REMIT", amt, payee=payee, juris=code, ref="PR-2026-19")
    add(PAY_DATE, "BENEFIT_REMIT", sum(r["k401_ee"] for r in reg), payee="401(k) recordkeeper",
        juris="401K", ref="PR-2026-19 401K")
    add(PAY_DATE, "BENEFIT_REMIT", sum(r["medical_ee"] for r in reg), payee="Medical carrier — employee premiums",
        juris="MEDICAL", ref="PR-2026-19 MED")
    e1012 = next(r for r in reg if r["emp_id"] == "E1012")
    add(RETURN_DATE, "ACH_RETURN", e1012["net_pay"], emp="E1012", payee=e1012["employee_name"],
        acct=E1012_OLD_ACCOUNT, rc="R03", ref=f"TRC 0210000{1012:04d} RETURN")
    return rows


def build_gl(reg, census_by_id):
    lines = []

    def add(je, acct, cc, dr, cr, memo):
        lines.append({
            "je_id": je, "line": len([x for x in lines if x["je_id"] == je]) + 1, "post_date": iso(PAY_DATE),
            "account": acct, "account_name": GL_MAPPING["accounts"][acct], "cost_center": cc,
            "debit": r2(dr) if dr else "", "credit": r2(cr) if cr else "", "memo": memo,
        })

    je = "JE-PR-2026-19"
    debits = {}  # (account, cc) -> amount
    for r in reg:
        e = census_by_id[r["emp_id"]]
        cc = r["cost_center"]
        wage = GL_MAPPING["wage_account_by_class"][gl_class(e["cls"])]
        er_tax = r["ss_er"] + r["medicare_er"] + r["futa_er"] + (0 if r["work_state"] == "NJ" else r["sui_er"])
        for acct, amt in ((wage, r["reg_pay"]), ("6040", r["ot_pay"] + r["dt_pay"]), ("6050", r["pto_pay"]),
                          ("6100", er_tax)):
            if amt:
                key = (acct if cc in GL_MAPPING["cost_centers"] else "9999", cc)
                debits[key] = debits.get(key, 0) + amt
    for (acct, cc), amt in sorted(debits.items(), key=lambda kv: (kv[0][0] == "9999", kv[0][0], kv[0][1])):
        memo = "Payroll 9/13–9/26" if acct != "9999" else f"Unmapped cost center {cc}"
        add(je, acct, cc, amt, 0, memo)

    ee_tax = sum(r["fed_wh"] + r["ss_ee"] + r["medicare_ee"] + r["state_wh"] + r["state_other_ee"] for r in reg)
    er_tax = sum(r["ss_er"] + r["medicare_er"] + r["futa_er"] + (0 if r["work_state"] == "NJ" else r["sui_er"])
                 for r in reg)
    add(je, "2200", "", 0, ee_tax + er_tax, "Employee and employer payroll taxes")
    add(je, "2210", "", 0, sum(r["k401_ee"] for r in reg), "401(k) deferrals")
    add(je, "2220", "", 0, sum(r["medical_ee"] for r in reg), "Medical premiums — employee share")
    add(je, "1010", "", 0, sum(r["net_pay"] for r in reg), "Net pay funded")

    # Vacation accrual true-up, valued at the census rate
    accr = 0.0
    for r in reg:
        e = census_by_id[r["emp_id"]]
        rate = e["rate"] if e["rate"] else e["salary"] / 2080
        change = (r["vac_co_end"] + r["vac_cur_end"]) - (r["vac_co_begin"] + r["vac_cur_begin"])
        accr += change * rate
    accr = r2(accr)
    je2 = "JE-VA-2026-19"
    if accr >= 0:
        add(je2, "6060", "", accr, 0, "Vacation accrual true-up")
        add(je2, "2310", "", 0, accr, "Vacation accrual true-up")
    else:
        add(je2, "2310", "", -accr, 0, "Vacation accrual true-up")
        add(je2, "6060", "", 0, -accr, "Vacation accrual true-up")

    # Make the payroll JE balance to the cent (rounding of summed lines)
    dr = r2(sum(x["debit"] or 0 for x in lines if x["je_id"] == je))
    cr = r2(sum(x["credit"] or 0 for x in lines if x["je_id"] == je))
    assert abs(dr - cr) < 0.005, (dr, cr)
    return lines


# --------------------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------------------

def fmt(v):
    if isinstance(v, float):
        return f"{v:.2f}"
    return "" if v is None else str(v)


def to_csv(rows, cols):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    for r in rows:
        w.writerow([fmt(r.get(c)) for c in cols])
    return buf.getvalue()


def census_rows(emps):
    out = []
    for e in emps:
        out.append({
            "emp_id": e["id"], "first_name": e["first"], "last_name": e["last"], "job_title": e["title"],
            "location": e["location"], "cost_center": e["cc"], "work_state": e["state"],
            "union_local": UNION_AGREEMENT["local"] if e["union"] else "", "flsa_status": e["flsa"],
            "ft_pt": e["ftpt"], "pay_type": e["paytype"],
            "hourly_rate": e["rate"] if e["rate"] else "", "annual_salary": e["salary"] if e["salary"] else "",
            "hire_date": iso(e["hire"]), "term_date": iso(e["term"]),
            "status": "Terminated" if e["term"] else "Active",
            "bank_routing": e["routing"], "bank_last4": e["last4"],
            "bank_change_date": E1012_BANK_CHANGE if e["id"] == "E1012" else "",
            "vac_carryover_hrs": e["vco"], "vac_current_hrs": e["vcur"],
            "sick_accrued_hrs": SICK_ACCRUED.get(e["id"], 0.0), "sick_hrs": e["sick"],
            "k401_pct": f"{e['k401'] * 100:.0f}", "medical_per_period": e["med"],
        })
    return out


def schedule_rows(emps, schedules):
    names = {e["id"]: (e["name"], e["location"], e["cc"]) for e in emps}
    for eid, name, _, cc, _ in WFM_ONLY:
        names[eid] = (name, COST_CENTERS[cc][0], cc)
    out = []
    for (eid, i), (start, end, meal_start, meal) in sorted(schedules.items()):
        name, loc, cc = names[eid]
        out.append({
            "emp_id": eid, "employee_name": name, "work_date": iso(DAYS[i]), "shift_start": start,
            "shift_end": end, "meal_minutes": meal, "scheduled_hours": float((tmin(end) - tmin(start) - meal) / 60),
            "location": loc, "schedule_source": "Excel upload" if cc == "CC-310" else "WFM",
        })
    return out


def time_rows(emps, records):
    names = {e["id"]: (e["name"], e["location"]) for e in emps}
    for eid, name, _, cc, _ in WFM_ONLY:
        names[eid] = (name, COST_CENTERS[cc][0])
    out = []
    for (eid, i), recs in sorted(records.items()):
        for k, r in enumerate(recs):
            name, loc = names[eid]
            out.append({
                "record_id": f"T{eid[1:]}-{DAYS[i].strftime('%m%d')}-{k + 1}", "emp_id": eid,
                "employee_name": name, "work_date": iso(DAYS[i]), "pay_code": r["code"],
                "punch_in": r["in"], "meal_out": r["mo"], "meal_in": r["mi"], "punch_out": r["out"],
                "wfm_hours": float(r["hours"]), "manager_override": r["override"], "override_by": r["by"],
                "override_reason": r["reason"], "note": r.get("note", ""), "location": loc,
            })
    return out


REG_COLS = ["emp_id", "employee_name", "cost_center", "pay_type", "rate", "reg_hrs", "ot_hrs", "dt_hrs",
            "vac_hrs", "sick_hrs", "hol_hrs", "reg_pay", "ot_pay", "dt_pay", "pto_pay", "gross_pay", "fed_wh",
            "ss_ee", "medicare_ee", "state_wh", "state_other_ee", "k401_ee", "medical_ee", "net_pay", "ss_er",
            "medicare_er", "futa_er", "sui_er", "work_state", "bank_last4", "vac_co_begin", "vac_co_end",
            "vac_cur_begin", "vac_cur_end", "sick_acc_begin", "sick_acc_end", "sick_begin", "sick_end"]


def money(v):
    return f"{v:,.2f}"


def write_pdf(reg, path):
    """A text-based payroll register laid out like a processor's printed register:
    three lines per employee (earnings / taxes & deductions / employer & balances)."""
    c = canvas.Canvas(str(path), pagesize=landscape(letter))
    c.setTitle("Payroll Register — Northloom Apparel — 09/13/2026–09/26/2026")
    c.setAuthor("Northloom Apparel Co. (sample data)")
    W, H = landscape(letter)
    per_page = 14
    pages = math.ceil(len(reg) / per_page)

    colsA = [("EMP ID", 28, "l"), ("NAME", 70, "l"), ("CC", 168, "l"), ("TYPE", 204, "l"), ("RATE", 270, "r"),
             ("REG", 306, "r"), ("OT", 334, "r"), ("DT", 362, "r"), ("VAC", 390, "r"), ("SICK", 420, "r"),
             ("HOL", 448, "r"), ("REG $", 504, "r"), ("OT $", 556, "r"), ("DT $", 606, "r"), ("PTO $", 658, "r"),
             ("GROSS", 740, "r")]
    colsB = [("", 70, "l"), ("FED WH", 270, "r"), ("SOC SEC", 334, "r"), ("MEDICARE", 390, "r"),
             ("STATE WH", 448, "r"), ("ST OTHER", 504, "r"), ("401(K)", 556, "r"), ("MED INS", 606, "r"),
             ("NET PAY", 680, "r"), ("DEPOSIT", 740, "r")]
    colsC = [("", 70, "l"), ("ER SS", 270, "r"), ("ER MED", 320, "r"), ("FUTA", 360, "r"), ("SUI", 404, "r"),
             ("ST", 414, "l"), ("VAC CO BEG", 470, "r"), ("VAC CO END", 516, "r"), ("VAC BEG", 556, "r"),
             ("VAC END", 594, "r"), ("SICK ACC BEG", 646, "r"), ("SICK ACC END", 698, "r"), ("SICK BEG", 734, "r"),
             ("SICK END", 766, "r")]

    def put(x, y, s, align):
        if s == "":
            return
        if align == "r":
            c.drawRightString(x, y, s)
        else:
            c.drawString(x, y, s)

    for p in range(pages):
        c.setFont("Helvetica-Bold", 11)
        c.drawString(28, H - 36, "NORTHLOOM APPAREL CO.  —  PAYROLL REGISTER")
        c.setFont("Helvetica", 8)
        c.drawString(28, H - 50, "Company code NLA-100   Pay period 09/13/2026 – 09/26/2026   Check date 10/02/2026   Biweekly   Batch PR-2026-19")
        c.drawRightString(W - 28, H - 36, f"Page {p + 1} of {pages}")
        c.drawRightString(W - 28, H - 50, "Sample data — fictional company")
        y = H - 74
        c.setFont("Helvetica-Bold", 6.5)
        for cols in (colsA, colsB, colsC):
            for label, x, al in cols:
                put(x, y, label, al)
            y -= 9
        c.setLineWidth(0.5)
        c.line(28, y + 4, W - 28, y + 4)
        y -= 8
        c.setFont("Helvetica", 7)
        for r in reg[p * per_page:(p + 1) * per_page]:
            valsA = [r["emp_id"], r["employee_name"], r["cost_center"], r["pay_type"], money(r["rate"]),
                     money(r["reg_hrs"]), money(r["ot_hrs"]), money(r["dt_hrs"]), money(r["vac_hrs"]),
                     money(r["sick_hrs"]), money(r["hol_hrs"]), money(r["reg_pay"]), money(r["ot_pay"]),
                     money(r["dt_pay"]), money(r["pto_pay"]), money(r["gross_pay"])]
            valsB = ["TAXES/DED", money(r["fed_wh"]), money(r["ss_ee"]), money(r["medicare_ee"]),
                     money(r["state_wh"]), money(r["state_other_ee"]), money(r["k401_ee"]), money(r["medical_ee"]),
                     money(r["net_pay"]), "****" + r["bank_last4"]]
            valsC = ["EMPLOYER/BAL", money(r["ss_er"]), money(r["medicare_er"]), money(r["futa_er"]),
                     money(r["sui_er"]), r["work_state"], money(r["vac_co_begin"]), money(r["vac_co_end"]),
                     money(r["vac_cur_begin"]), money(r["vac_cur_end"]), money(r["sick_acc_begin"]),
                     money(r["sick_acc_end"]), money(r["sick_begin"]), money(r["sick_end"])]
            for cols, vals in ((colsA, valsA), (colsB, valsB), (colsC, valsC)):
                for (label, x, al), v in zip(cols, vals):
                    put(x, y, v, al)
                y -= 9
            c.setStrokeGray(0.8)
            c.line(28, y + 5, W - 28, y + 5)
            c.setStrokeGray(0)
            y -= 4
        if p == pages - 1:
            c.setFont("Helvetica-Bold", 7)
            y -= 4
            c.drawString(28, y, "TOTALS")
            c.drawString(70, y, f"{len(reg)} employees")
            c.drawRightString(740, y, money(sum(r["gross_pay"] for r in reg)))
            c.drawRightString(680, y, money(sum(r["net_pay"] for r in reg)))
        c.showPage()
    c.save()


# The engine flags each cycle; this is what it flagged in the five closed periods before PR-2026-19,
# summarized one row per exception. FixFlow Clusters reads it with the current cycle's exceptions.
HISTORY_PERIODS = [("PR-2026-14", date(2026, 7, 5)), ("PR-2026-15", date(2026, 7, 19)), ("PR-2026-16", date(2026, 8, 2)),
                   ("PR-2026-17", date(2026, 8, 16)), ("PR-2026-18", date(2026, 8, 30))]
HISTORY = {
    # missed lunch check-ins at SoHo Flagship, every period
    "PR-2026-14": [("T1", "meal_return", "E1003"), ("T1", "meal_return", "E1015"), ("F3", "bank_change", "E1009"),
                   ("F4", "bank_change", "E1009"), ("T4", "no_show", "E1018"), ("T5", "short_week", "E1007")],
    "PR-2026-15": [("T1", "meal_return", "E1002"), ("T2", "override", "E1015"), ("R4", "after_term", "E1030"),
                   ("T1", "missing_out", "E1014"), ("P1", "rate", "E1006")],
    "PR-2026-16": [("T1", "meal_return", "E1011"), ("T1", "meal_return", "E1019"), ("T1", "meal_return", "E1012"),
                   ("F3", "bank_change", "E1013"), ("F4", "bank_change", "E1013"), ("P4", "ot_straight", "E1021"),
                   ("T8", "daily_max", "E1024")],
    "PR-2026-17": [("T1", "meal_return", "E1001"), ("T2", "override", "E1011"), ("P4", "ot_straight", "E1020"),
                   ("T4", "no_show", "E1016"), ("P9", "vac_bucket", "E1004")],
    "PR-2026-18": [("T1", "meal_return", "E1015"), ("T1", "meal_return", "E1003"), ("T2", "override", "E1015"),
                   ("F3", "bank_change", "E1030"), ("F4", "bank_change", "E1030"), ("G3", "unmapped_cc", None),
                   ("T9", "holiday_code", "E1023"), ("T4", "no_show", "E1009")],
}
HISTORY_TEXT = {
    "meal_return": ("Meal break with no return punch", "Store manager", "overpaid", 20.4),
    "missing_out": ("No check-out", "Store manager", "underpaid", 140.0),
    "override": ("Hours entered with no punches", "Store manager", None, 0),
    "bank_change": ("Deposit sent to the old account after a bank change", "Treasury", "cash", 1010.0),
    "no_show": ("No-show on a scheduled shift", "Store manager", None, 0),
    "short_week": ("Short week, no time off coded", "Store manager", None, 0),
    "after_term": ("Time recorded after termination", "WFM admin", "overpaid", 160.0),
    "rate": ("Register rate differs from census", "Payroll", "underpaid", 24.0),
    "ot_straight": ("Overtime paid at straight time", "Payroll", "underpaid", 64.5),
    "daily_max": ("Shift over the daily maximum", "Store manager", None, 0),
    "vac_bucket": ("Vacation drawn from the wrong bucket", "Payroll", None, 0),
    "unmapped_cc": ("CC-140 posted to suspense", "GL accounting", "gl", 1380.0),
    "holiday_code": ("Holiday pay on a non-holiday", "WFM admin", "overpaid", 194.0),
}
OVERRIDE_BY = {"E1015": "M. Chen (Lead Associate)", "E1011": "M. Chen (Lead Associate)"}


def build_history(emps):
    by_id = {e["id"]: e for e in emps}
    managers = {e["cc"]: e["name"] for e in emps if e["title"] in ("Store Manager", "Distribution Center Manager")}
    periods = []
    for cycle, start in HISTORY_PERIODS:
        rows = []
        for check, kind, eid in HISTORY[cycle]:
            title, owner, impact_kind, amount = HISTORY_TEXT[kind]
            e = by_id.get(eid)
            cc = e["cc"] if e else "CC-140"
            rows.append({
                "check": check, "type": kind, "emp_id": eid or "", "title": title,
                "location": COST_CENTERS[cc][0], "cost_center": cc, "store_manager": managers.get(cc, ""),
                "entered_by": OVERRIDE_BY.get(eid, "") if kind == "override" else "",
                "owner": owner, "impact_kind": impact_kind or "", "impact_amount": amount,
                "resolution": "Corrected before release" if check[0] in "TRP" else "Corrected after settlement",
            })
        periods.append({"cycle": cycle, "start": iso(start), "end": iso(start + timedelta(days=13)), "exceptions": rows})
    return {"name": "Exception history — five closed pay periods before PR-2026-19 (sample data)", "periods": periods}


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)
    emps, schedules, records = build()
    census_by_id = {e["id"]: e for e in emps}
    reg = build_register(emps, records)
    bank = build_bank(reg)
    gl = build_gl(reg, census_by_id)

    files = {}
    census = census_rows(emps)
    files["census.csv"] = to_csv(census, list(census[0].keys()))
    sch = schedule_rows(emps, schedules)
    files["schedules.csv"] = to_csv(sch, list(sch[0].keys()))
    tr = time_rows(emps, records)
    files["time_records.csv"] = to_csv(tr, list(tr[0].keys()))
    files["payroll_register.csv"] = to_csv(reg, REG_COLS)
    files["bank_activity.csv"] = to_csv(bank, list(bank[0].keys()))
    files["gl_journal.csv"] = to_csv(gl, list(gl[0].keys()))
    files["union_agreement.json"] = json.dumps(UNION_AGREEMENT, indent=2, ensure_ascii=False) + "\n"
    files["employee_handbook.json"] = json.dumps(HANDBOOK, indent=2, ensure_ascii=False) + "\n"
    files["gl_mapping.json"] = json.dumps(GL_MAPPING, indent=2, ensure_ascii=False) + "\n"
    files["exception_history.json"] = json.dumps(build_history(emps), indent=2, ensure_ascii=False) + "\n"
    seeded = {"issues": SEEDED_ISSUES, "clean_controls": CLEAN_CONTROLS}
    files["seeded_issues.json"] = json.dumps(seeded, indent=2) + "\n"

    for name, text in files.items():
        (DATA / name).write_text(text, encoding="utf-8")
    pdf_path = DATA / "payroll_register.pdf"
    write_pdf(reg, pdf_path)

    sample = {k: v for k, v in files.items() if k != "seeded_issues.json"}
    pdf_b64 = base64.b64encode(pdf_path.read_bytes()).decode()
    js = (
        "/* Generated by generator/generate_data.py — Northloom Apparel sample pay cycle (fictional). */\n"
        "window.NORTHLOOM_SAMPLE = " + json.dumps({"files": sample, "registerPdfBase64": pdf_b64}, ensure_ascii=False)
        + ";\n"
    )
    (APP / "sample-data.js").write_text(js, encoding="utf-8")

    print(f"census {len(census)}  schedules {len(sch)}  time records {len(tr)}  register {len(reg)}  "
          f"bank {len(bank)}  gl {len(gl)}")
    print(f"register gross {sum(r['gross_pay'] for r in reg):,.2f}  net {sum(r['net_pay'] for r in reg):,.2f}")


if __name__ == "__main__":
    main()
