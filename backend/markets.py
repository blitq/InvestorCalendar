"""Market / ticker helpers shared by the data pipeline."""
import math
from datetime import date, datetime

MARKET_MAP = {
    ".WA": "Poland (WSE)",
    ".DE": "Germany (Xetra)",
    ".F": "Germany (Frankfurt)",
    ".PA": "France (Euronext)",
    ".L": "UK (LSE)",
    ".AS": "Netherlands (Euronext)",
    ".BR": "Belgium (Euronext)",
    ".TO": "Canada (TSX)",
    ".T": "Japan (TSE)",
    ".HK": "Hong Kong",
    ".AX": "Australia (ASX)",
    ".MI": "Italy (Euronext)",
    ".MC": "Spain (BME)",
    ".CO": "Denmark (OMX)",
    ".HE": "Finland (OMX)",
    ".OL": "Norway (OSE)",
    ".ST": "Sweden (OMX)",
    ".SW": "Switzerland (SIX)",
    ".VI": "Austria (VIE)",
    ".IR": "Ireland (ISE)",
    ".SG": "Singapore (SGX)",
    ".NS": "India (NSE)",
    ".BO": "India (BSE)",
    ".TW": "Taiwan (TWSE)",
    ".KS": "South Korea (KSE)",
    ".SS": "China (SSE)",
    ".SZ": "China (SZSE)",
}

KNOWN_SUFFIXES = sorted(MARKET_MAP.keys(), key=len, reverse=True)

STOOQ_SUFFIX_MAP = {
    ".WA": "gpw",
    ".DE": "de",
    ".PA": "fr",
    ".L": "uk",
    ".AS": "nl",
    ".TO": "ca",
}

# Yahoo quotes some markets in minor units (pence, cents, agorot).
MINOR_CURRENCIES = {"GBp": ("GBP", 100.0), "GBX": ("GBP", 100.0),
                    "ZAc": ("ZAR", 100.0), "ILA": ("ILS", 100.0)}


def _suffix(ticker):
    return ticker[ticker.rfind("."):] if "." in ticker else ""


def detect_market(ticker):
    if ticker.startswith("^"):
        return "Index"
    suffix = _suffix(ticker)
    return MARKET_MAP.get(suffix, "US" if not suffix else f"Other ({suffix})")


def strip_suffix(ticker):
    upper = ticker.upper()
    for suffix in KNOWN_SUFFIXES:
        if upper.endswith(suffix.upper()):
            return ticker[:-len(suffix)]
    return ticker


def stooq_exchange(ticker):
    return STOOQ_SUFFIX_MAP.get(_suffix(ticker), "us")


def normalize_currency(currency):
    """Return (major_currency, divisor) for a Yahoo currency code."""
    if not currency:
        return "USD", 1.0
    if currency in MINOR_CURRENCIES:
        return MINOR_CURRENCIES[currency]
    return currency.upper(), 1.0


def safe_filename(ticker):
    """Map a ticker such as ^GSPC or PLNUSD=X to a filesystem/URL-safe name."""
    out = []
    for ch in ticker:
        out.append(ch if ch.isalnum() or ch in ".-" else "_")
    return "".join(out)


def safe_strftime(dt):
    if isinstance(dt, datetime):
        return dt.date().isoformat()
    if isinstance(dt, date):
        return dt.isoformat()
    return str(dt)[:10]


def clean_val(val):
    if val is None:
        return ""
    try:
        if isinstance(val, float) and math.isnan(val):
            return ""
    except (ValueError, TypeError):
        pass
    s = str(val)
    return "" if s.lower() in ("nan", "nat", "none", "") else s


def num(val, digits=6):
    """Float rounded for compact JSON, or None for missing/NaN."""
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, digits)
