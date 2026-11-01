"""Resolve ISINs to Yahoo Finance symbols with the free OpenFIGI mapping API.

tickers.json may list ISINs (e.g. from a Degiro export); they are resolved here,
cached in docs/data/isins.json, and replaced by Yahoo symbols for price fetching.
"""
import re
import time

import requests

API = "https://api.openfigi.com/v3/mapping"
ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

# Bloomberg exchange code -> Yahoo suffix
EXCH_SUFFIX = {
    "US": "", "UN": "", "UW": "", "UQ": "", "UA": "", "UP": "", "UR": "",
    "PW": ".WA", "GY": ".DE", "GR": ".F", "FP": ".PA", "NA": ".AS", "LN": ".L", "IM": ".MI",
    "SM": ".MC", "SW": ".SW", "SE": ".SW", "SS": ".ST", "DC": ".CO", "NO": ".OL", "FH": ".HE",
    "BB": ".BR", "AV": ".VI", "ID": ".IR", "PL": ".LS", "CN": ".TO", "JT": ".T", "HK": ".HK", "AU": ".AX",
}
# ISIN country -> preferred exchange codes (first available wins)
HOME = {
    "US": ["US"], "PL": ["PW"], "DE": ["GY", "GR"], "FR": ["FP"], "NL": ["NA"], "GB": ["LN"], "IT": ["IM"],
    "ES": ["SM"], "CH": ["SW", "SE"], "SE": ["SS"], "DK": ["DC"], "NO": ["NO"], "FI": ["FH"], "BE": ["BB"],
    "AT": ["AV"], "PT": ["PL"], "CA": ["CN"], "JP": ["JT"], "HK": ["HK"], "AU": ["AU"],
}
# funds domiciled in IE/LU trade on many venues; prefer EUR Xetra, then London, Amsterdam, Warsaw
FUND_PREF = ["GY", "LN", "NA", "PW", "IM", "SW"]


def is_isin(s):
    return bool(ISIN_RE.match(str(s or "").strip().upper()))


def pick_symbol(isin, rows):
    """Choose a Yahoo symbol from OpenFIGI result rows for one ISIN."""
    if not rows:
        return None
    by_exch = {}
    for r in rows:
        ex = r.get("exchCode")
        if ex in EXCH_SUFFIX and r.get("ticker"):
            by_exch.setdefault(ex, r)
    country = isin[:2]
    prefs = HOME.get(country, []) + FUND_PREF + ["US"]
    for ex in prefs:
        if ex in by_exch:
            tk = by_exch[ex]["ticker"].replace("/", "-").replace(" ", "-")
            return tk + EXCH_SUFFIX[ex]
    return None


def resolve(isins, cache=None, session=None, sleep=2.5):
    """Return {isin: yahoo_symbol or None}, reusing `cache` for already-known ISINs."""
    cache = dict(cache or {})
    todo = [i for i in dict.fromkeys(x.strip().upper() for x in isins) if i not in cache or not cache[i]]
    s = session or requests.Session()
    for k in range(0, len(todo), 10):  # anonymous limit: 10 jobs per request
        chunk = todo[k:k + 10]
        try:
            resp = s.post(API, json=[{"idType": "ID_ISIN", "idValue": i} for i in chunk], timeout=30)
            resp.raise_for_status()
            for isin, res in zip(chunk, resp.json()):
                cache[isin] = pick_symbol(isin, res.get("data") or [])
        except Exception as e:
            print(f"  [WARN] OpenFIGI: {e}")
        if k + 10 < len(todo):
            time.sleep(sleep)  # anonymous rate limit
    return cache
