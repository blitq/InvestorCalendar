import json
import os
from datetime import date, datetime, timedelta, timezone

import yfinance as yf

from scrapers import stock_from_stooq

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_PATH = os.path.join(BASE_DIR, "tickers.json")
OUTPUT_DIR = os.path.join(BASE_DIR, "docs")
EVENTS_PATH = os.path.join(OUTPUT_DIR, "events.json")

MARKET_MAP = {
    ".WA": "Poland (WSE)",
    ".DE": "Germany (Xetra)",
    ".PA": "France (Euronext)",
    ".L": "UK (LSE)",
    ".AS": "Netherlands (Euronext)",
    ".TO": "Canada (TSX)",
    ".T": "Japan (TSE)",
    ".HK": "Hong Kong",
    ".AX": "Australia (ASX)",
    ".MI": "Italy (Euronext)",
    ".MC": "Spain (BME)",
    ".CO": "Sweden (OMX)",
    ".HE": "Finland (OMX)",
    ".OL": "Norway (OSE)",
    ".ST": "Sweden (OMX)",
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


def detect_market(ticker):
    suffix = ticker[ticker.rfind("."):] if "." in ticker else ""
    return MARKET_MAP.get(suffix, "US" if not suffix else f"Other ({suffix})")


STOOQ_SUFFIX_MAP = {
    ".WA": "gpw",
    ".DE": "de",
    ".PA": "fr",
    ".L": "uk",
    ".AS": "nl",
    ".TO": "ca",
}


def stooq_exchange(ticker):
    suffix = ticker[ticker.rfind("."):] if "." in ticker else ""
    return STOOQ_SUFFIX_MAP.get(suffix, "us")


def safe_strftime(dt):
    if isinstance(dt, date):
        return dt.isoformat()
    if isinstance(dt, datetime):
        return dt.date().isoformat()
    return str(dt)[:10]


def fetch_events(ticker):
    events = []
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        name = info.get("longName") or info.get("shortName") or ticker
        market = detect_market(ticker)

        earnings = t.earnings_dates
        if earnings is not None and not earnings.empty:
            for idx, row in earnings.iterrows():
                dt_val = idx.date() if hasattr(idx, "date") else idx
                events.append({
                    "ticker": ticker,
                    "type": "earnings",
                    "date": str(dt_val)[:10],
                    "title": f"{name} — Earnings",
                    "market": market,
                    "details": {
                        "eps_estimate": str(row.get("EPS Estimate", "")),
                        "eps_actual": str(row.get("EPS Actual", "")),
                        "revenue_estimate": str(row.get("Revenue Estimate", "")),
                        "revenue_actual": str(row.get("Revenue Actual", "")),
                    },
                })

        calendar = dict(t.calendar)
        if calendar:
            ex_div = calendar.get("Ex-Dividend Date")
            if ex_div:
                events.append({
                    "ticker": ticker,
                    "type": "dividend",
                    "date": safe_strftime(ex_div),
                    "title": f"{name} — Ex-Dividend",
                    "market": market,
                    "details": {
                        "dividend_rate": str(calendar.get("Dividend Rate", "")),
                    },
                })

        dividends = t.dividends
        if dividends is not None and not dividends.empty:
            seen_dates = {e["date"] for e in events if e["type"] == "dividend"}
            for idx, val in dividends.tail(10).items():
                d = str(idx.date() if hasattr(idx, "date") else idx)[:10]
                if d not in seen_dates:
                    events.append({
                        "ticker": ticker,
                        "type": "dividend",
                        "date": d,
                        "title": f"{name} — Dividend",
                        "market": market,
                        "details": {"amount": str(val)},
                    })
                    seen_dates.add(d)

        splits = t.splits
        if splits is not None and not splits.empty:
            for idx, val in splits.tail(5).items():
                events.append({
                    "ticker": ticker,
                    "type": "split",
                    "date": str(idx.date() if hasattr(idx, "date") else idx)[:10],
                    "title": f"{name} — Stock Split",
                    "market": market,
                    "details": {"ratio": str(val)},
                })

    except Exception as e:
        print(f"  [WARN] {ticker}: {e}")

    return events


def main():
    with open(TICKERS_PATH) as f:
        tickers = json.load(f)

    print(f"Fetching events for {len(tickers)} tickers...")
    all_events = []
    for i, sym in enumerate(tickers):
        print(f"  [{i+1}/{len(tickers)}] {sym} ...", end=" ", flush=True)
        evts = fetch_events(sym)
        print(f"{len(evts)} events")
        all_events.extend(evts)

    all_events.sort(key=lambda e: e["date"])

    events_with_ticker = {}
    for e in all_events:
        events_with_ticker.setdefault(e["ticker"], []).append(e)
    for sym in tickers:
        if len(events_with_ticker.get(sym, [])) < 3:
            sym_clean = sym.replace(".WA", "").lower()
            print(f"  ↳ yfinance sparse for {sym}, trying Stooq.pl...", end=" ", flush=True)
            stooq_evts, err = stock_from_stooq(sym_clean, stooq_exchange(sym))
            if stooq_evts:
                print(f"{len(stooq_evts)} events from Stooq")
                all_events.extend(stooq_evts)
            else:
                print(f"no data ({err or 'empty'})")

    all_events.sort(key=lambda e: e["date"])

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(EVENTS_PATH, "w") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "events": all_events,
        }, f, indent=2)

    print(f"\nDone. {len(all_events)} events written to {EVENTS_PATH}")


if __name__ == "__main__":
    main()
