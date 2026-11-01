"""Quotes, split-unadjusted price history, dividends and FX from Yahoo Finance."""
import yfinance as yf

from markets import detect_market, normalize_currency, num, safe_strftime

QUOTE_FIELDS = {
    "name": ("longName", "shortName"),
    "sector": ("sector",),
    "industry": ("industry",),
    "country": ("country",),
    "quote_type": ("quoteType",),
    "exchange": ("exchange",),
    "pe": ("trailingPE",),
    "forward_pe": ("forwardPE",),
    "market_cap": ("marketCap",),
    "beta": ("beta",),
    "high_52w": ("fiftyTwoWeekHigh",),
    "low_52w": ("fiftyTwoWeekLow",),
    "dividend_rate": ("dividendRate", "trailingAnnualDividendRate"),
    "payout_ratio": ("payoutRatio",),
    "five_year_avg_yield": ("fiveYearAvgDividendYield",),
    "target_price": ("targetMeanPrice",),
    "recommendation": ("recommendationKey",),
    "analysts": ("numberOfAnalystOpinions",),
    "revenue_growth": ("revenueGrowth",),
    "earnings_growth": ("earningsGrowth",),
    "profit_margin": ("profitMargins",),
    "roe": ("returnOnEquity",),
    "price_to_book": ("priceToBook",),
    "debt_to_equity": ("debtToEquity",),
    "employees": ("fullTimeEmployees",),
    "website": ("website",),
    "summary": ("longBusinessSummary",),
    "price": ("regularMarketPrice", "currentPrice", "navPrice"),
    "prev_close": ("regularMarketPreviousClose", "previousClose"),
}
PRICE_FIELDS = {"high_52w", "low_52w", "price", "prev_close", "target_price"}  # dividendRate is already in major units


def unadjust_for_splits(rows, splits):
    """Yahoo's Close is split-adjusted. Undo that so prices match what was
    actually paid at the time (quantities in transactions are historical).

    rows: list of [date_str, value]; splits: list of [date_str, ratio].
    A value dated strictly before a split is multiplied by that split's ratio.
    """
    if not splits:
        return rows
    out = []
    for d, v in rows:
        factor = 1.0
        for sd, ratio in splits:
            if d < sd and ratio:
                factor *= ratio
        out.append([d, v * factor if v is not None else None])
    return out


def build_history(df, divisor=1.0):
    """Convert a yfinance history DataFrame into the compact JSON structure."""
    splits = []
    if "Stock Splits" in df:
        for idx, val in df["Stock Splits"].items():
            if val and float(val) not in (0.0, 1.0):
                splits.append([safe_strftime(idx), float(val)])

    closes = [[safe_strftime(idx), float(v) / divisor]
              for idx, v in df["Close"].items() if v == v]  # skip NaN
    divs = []
    if "Dividends" in df:
        divs = [[safe_strftime(idx), float(v) / divisor]
                for idx, v in df["Dividends"].items() if v and v == v and float(v) > 0]

    closes = unadjust_for_splits(closes, splits)
    divs = unadjust_for_splits(divs, splits)

    # one row per date (FX data occasionally contains duplicates)
    dedup = {}
    for d, v in closes:
        dedup[d] = v
    dates = sorted(dedup)
    return {
        "dates": dates,
        "close": [num(dedup[d]) for d in dates],
        "dividends": [[d, num(v)] for d, v in divs],
        "splits": splits,
    }


def fetch_ticker(ticker, start):
    """Return (quote_dict, history_dict) for one symbol. Raises on hard failure."""
    t = yf.Ticker(ticker)
    try:
        info = t.info or {}
    except Exception as e:
        print(f"  [WARN] info {ticker}: {e}")
        info = {}

    raw_ccy = info.get("currency")
    if not raw_ccy:
        try:
            raw_ccy = t.fast_info.get("currency")
        except Exception:
            raw_ccy = None
    currency, divisor = normalize_currency(raw_ccy)

    df = t.history(start=start, interval="1d", auto_adjust=False, actions=True)
    if df is None or df.empty:
        raise RuntimeError("no price history")
    hist = build_history(df, divisor)
    hist["ticker"] = ticker
    hist["currency"] = currency

    quote = {"ticker": ticker, "currency": currency, "market": detect_market(ticker)}
    for key, sources in QUOTE_FIELDS.items():
        for src in sources:
            if info.get(src) not in (None, ""):
                val = info[src]
                if key in PRICE_FIELDS:
                    val = num(float(val) / divisor)
                elif isinstance(val, float):
                    val = num(val, 4)
                elif key == "summary":
                    val = str(val)[:700]
                quote[key] = val
                break
    quote.setdefault("name", ticker)
    # Fall back to history for price data the info endpoint did not give us.
    if hist["close"]:
        quote.setdefault("price", hist["close"][-1])
        if len(hist["close"]) > 1:
            quote.setdefault("prev_close", hist["close"][-2])
    quote["last_date"] = hist["dates"][-1] if hist["dates"] else None
    return quote, hist


def fetch_fx(currency, start):
    """Daily USD value of one unit of `currency` (e.g. PLN -> ~0.25)."""
    if currency == "USD":
        return None
    df = yf.Ticker(f"{currency}USD=X").history(start=start, interval="1d", auto_adjust=False)
    if df is None or df.empty:
        raise RuntimeError(f"no FX data for {currency}")
    h = build_history(df)
    return {"dates": h["dates"], "usd": h["close"]}
