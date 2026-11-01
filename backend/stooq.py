"""Fallback price source: Stooq daily CSV (https://stooq.com/q/d/l/?s=<symbol>&i=d).

Used only when Yahoo Finance fails for a ticker. Stooq has no dividends or split events,
so the fallback history carries prices only (dividends are kept from the previous data).
"""
import csv
import io

import requests

URL = "https://stooq.com/q/d/l/?s={sym}&i=d&d1={d1}"
# Yahoo suffix -> (Stooq suffix, divisor). London is quoted in pence on Stooq.
SUFFIX = {"": (".us", 1.0), ".WA": ("", 1.0), ".DE": (".de", 1.0), ".L": (".uk", 100.0),
          ".HK": (".hk", 1.0), ".T": (".jp", 1.0)}


def stooq_symbol(ticker):
    """Map a Yahoo ticker to (stooq_symbol, divisor) or None if Stooq does not cover it."""
    if ticker.startswith("^") or "=" in ticker:
        return None
    dot = ticker.rfind(".")
    suffix = ticker[dot:] if dot > 0 else ""
    root = ticker[:dot] if dot > 0 else ticker
    if suffix not in SUFFIX:
        return None
    sfx, div = SUFFIX[suffix]
    return root.lower().replace("-", ".") + sfx, div


def parse_csv(text, divisor=1.0):
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "Close" not in rows[0]:
        raise RuntimeError("no data from Stooq")
    dates, close = [], []
    for r in rows:
        try:
            dates.append(r["Date"])
            close.append(round(float(r["Close"]) / divisor, 6))
        except (KeyError, ValueError):
            dates.pop() if len(dates) > len(close) else None
    return {"dates": dates, "close": close, "dividends": [], "splits": [], "source": "stooq"}


def fetch_history(ticker, start, session=None):
    m = stooq_symbol(ticker)
    if not m:
        raise RuntimeError(f"Stooq does not cover {ticker}")
    sym, div = m
    s = session or requests
    resp = s.get(URL.format(sym=sym, d1=start.replace("-", "")), timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    return parse_csv(resp.text, div)
