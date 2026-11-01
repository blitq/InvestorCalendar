"""Corporate events (earnings, dividends, splits) for the calendar view."""
import yfinance as yf

from markets import clean_val, detect_market, safe_strftime


def fetch_events(ticker, name=None):
    events = []
    try:
        t = yf.Ticker(ticker)
        if name is None:
            info = t.info or {}
            name = info.get("longName") or info.get("shortName") or ticker
        market = detect_market(ticker)

        def ev(kind, d, title, details):
            events.append({"ticker": ticker, "type": kind, "date": d,
                           "title": f"{name} — {title}", "market": market,
                           "details": details})

        try:
            earnings = t.earnings_dates
        except Exception:
            earnings = None
        if earnings is not None and not earnings.empty:
            for idx, row in earnings.iterrows():
                ev("earnings", safe_strftime(idx), "Earnings", {
                    "eps_estimate": clean_val(row.get("EPS Estimate")),
                    "eps_actual": clean_val(row.get("Reported EPS", row.get("EPS Actual"))),
                    "surprise_pct": clean_val(row.get("Surprise(%)")),
                })

        cal = t.calendar or {}
        if isinstance(cal, dict):
            ex_div = cal.get("Ex-Dividend Date")
            if ex_div:
                ev("dividend", safe_strftime(ex_div), "Ex-Dividend",
                   {"dividend_rate": clean_val(cal.get("Dividend Rate"))})
            for d in cal.get("Earnings Date") or []:
                ev("earnings", safe_strftime(d), "Earnings (expected)", {
                    "eps_estimate": clean_val(cal.get("Earnings Average")),
                    "revenue_estimate": clean_val(cal.get("Revenue Average")),
                })

        dividends = t.dividends
        if dividends is not None and not dividends.empty:
            seen = {e["date"] for e in events if e["type"] == "dividend"}
            for idx, val in dividends.tail(12).items():
                d = safe_strftime(idx)
                if d not in seen:
                    ev("dividend", d, "Dividend", {"amount": clean_val(val)})
                    seen.add(d)

        splits = t.splits
        if splits is not None and not splits.empty:
            for idx, val in splits.tail(5).items():
                ev("split", safe_strftime(idx), "Stock Split", {"ratio": clean_val(val)})
    except Exception as e:  # network / parsing problems must not kill the run
        print(f"  [WARN] events {ticker}: {e}")

    # de-duplicate (same ticker/type/date)
    uniq = {}
    for e in events:
        uniq.setdefault((e["type"], e["date"]), e)
    return list(uniq.values())
