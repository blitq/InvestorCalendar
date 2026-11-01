"""NBP (National Bank of Poland) table A mid rates, used for PIT-38 tax maths.

Polish tax rules convert foreign-currency amounts at the NBP average rate from
the last business day *before* the transaction date. The frontend does that
lookup; here we only download and incrementally cache the rate tables.
"""
from datetime import date, timedelta

import requests

API = "https://api.nbp.pl/api/exchangerates/rates/a/{code}/{start}/{end}/?format=json"
MAX_SPAN_DAYS = 90  # API refuses ranges longer than 93 days


def fetch_range(code, start, end, session=None):
    s = session or requests
    resp = s.get(API.format(code=code.lower(), start=start.isoformat(), end=end.isoformat()),
                 timeout=20, headers={"Accept": "application/json"})
    if resp.status_code == 404:  # no quotations in range (holidays)
        return []
    resp.raise_for_status()
    return [(r["effectiveDate"], r["mid"]) for r in resp.json().get("rates", [])]


def update_currency(code, existing, start, today=None):
    """Return {"dates": [...], "rates": [...]} extended up to today."""
    today = today or date.today()
    pairs = dict(zip(existing.get("dates", []), existing.get("rates", []))) if existing else {}
    cursor = start
    if pairs:
        cursor = max(start, date.fromisoformat(max(pairs)) + timedelta(days=1))
    session = requests.Session()
    while cursor <= today:
        end = min(cursor + timedelta(days=MAX_SPAN_DAYS), today)
        for d, mid in fetch_range(code, cursor, end, session):
            pairs[d] = mid
        cursor = end + timedelta(days=1)
    dates = sorted(pairs)
    return {"dates": dates, "rates": [pairs[d] for d in dates]}
