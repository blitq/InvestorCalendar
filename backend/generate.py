"""Build all static data files consumed by the web app in docs/.

Outputs (docs/data/):
  meta.json            generation time, ticker list, benchmark names, file index
  quotes.json          latest quote + fundamentals per ticker
  history/<sym>.json   daily closes (split-unadjusted), dividends, splits
  fx.json              daily USD value of each currency
  nbp.json             NBP table A mid rates (PLN per unit) for PIT-38 tax maths
  cpi.json             monthly y/y inflation for Poland (treasury bond indexation)
  events.json          earnings / dividend / split calendar

Usage:
  python backend/generate.py                 # everything
  python backend/generate.py --only prices fx
"""
import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from isin import is_isin, resolve as resolve_isins  # noqa: E402
from markets import safe_filename, stooq_exchange, strip_suffix  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_PATH = os.path.join(BASE_DIR, "tickers.json")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
DATA_DIR = os.path.join(BASE_DIR, "docs", "data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")

STEPS = ("prices", "fx", "nbp", "cpi", "events")


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data, pretty=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        if pretty:
            json.dump(data, f, indent=1, ensure_ascii=False)
        else:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, path)


def step_prices(tickers, benchmarks, start):
    from prices import fetch_ticker

    quotes = load_json(os.path.join(DATA_DIR, "quotes.json"), {})
    files = {}
    symbols = list(dict.fromkeys(tickers + list(benchmarks)))
    for i, sym in enumerate(symbols):
        print(f"  [{i + 1}/{len(symbols)}] {sym} ...", end=" ", flush=True)
        fname = f"history/{safe_filename(sym)}.json"
        try:
            quote, hist = fetch_ticker(sym, start)
            if sym in benchmarks:
                quote["benchmark_name"] = benchmarks[sym]
            quotes[sym] = quote
            write_json(os.path.join(DATA_DIR, fname), hist)
            files[sym] = fname
            print(f"{len(hist['dates'])} days, {quote['currency']}")
        except Exception as e:
            # keep yesterday's data rather than dropping the ticker
            if os.path.exists(os.path.join(DATA_DIR, fname)):
                files[sym] = fname
            print(f"FAILED ({e}); keeping previous data" if sym in files else f"FAILED ({e})")
        time.sleep(0.3)
    # drop quotes of tickers no longer tracked
    quotes = {k: v for k, v in quotes.items() if k in symbols}
    write_json(os.path.join(DATA_DIR, "quotes.json"), quotes, pretty=True)
    return quotes, files


def step_fx(currencies, start):
    from prices import fetch_fx

    fx = load_json(os.path.join(DATA_DIR, "fx.json"), {})
    for ccy in sorted(currencies):
        if ccy == "USD":
            continue
        print(f"  FX {ccy}/USD ...", end=" ", flush=True)
        try:
            fx[ccy] = fetch_fx(ccy, start)
            print(f"{len(fx[ccy]['dates'])} days")
        except Exception as e:
            print(f"FAILED ({e})" + ("; keeping previous data" if ccy in fx else ""))
    write_json(os.path.join(DATA_DIR, "fx.json"), fx)
    return fx


def step_nbp(codes, start):
    from nbp import update_currency

    path = os.path.join(DATA_DIR, "nbp.json")
    data = load_json(path, {})
    for code in codes:
        print(f"  NBP {code} ...", end=" ", flush=True)
        try:
            data[code] = update_currency(code, data.get(code), start)
            print(f"{len(data[code]['dates'])} days")
        except Exception as e:
            print(f"FAILED ({e})")
    write_json(path, data)


def step_events(tickers, quotes, window_days):
    from events import fetch_events
    from scrapers import stock_from_stooq

    all_events = []
    for i, sym in enumerate(tickers):
        print(f"  [{i + 1}/{len(tickers)}] events {sym} ...", end=" ", flush=True)
        name = (quotes.get(sym) or {}).get("name")
        evts = fetch_events(sym, name)
        if len(evts) < 3:
            stooq_evts, err = stock_from_stooq(strip_suffix(sym).lower(), stooq_exchange(sym))
            for e in stooq_evts:
                e["ticker"] = sym
            evts.extend(stooq_evts)
        print(f"{len(evts)} events")
        all_events.extend(evts)

    today = date.today()
    lo = (today - timedelta(days=window_days)).isoformat()
    hi = (today + timedelta(days=window_days)).isoformat()
    all_events = sorted((e for e in all_events if lo <= e["date"] <= hi),
                        key=lambda e: (e["date"], e["ticker"]))
    write_json(os.path.join(DATA_DIR, "events.json"), {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "events": all_events,
    }, pretty=True)
    print(f"  {len(all_events)} events written")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="+", choices=STEPS, help="run only these steps")
    parser.add_argument("--days", type=int, default=730, help="calendar window in days (default 730)")
    args = parser.parse_args(argv)
    steps = set(args.only or STEPS)

    raw_tickers = [str(t).strip() for t in load_json(TICKERS_PATH, []) if str(t).strip()]
    config = load_json(CONFIG_PATH, {})
    # ISINs in tickers.json (e.g. from a Degiro export) are resolved to Yahoo symbols
    isin_path = os.path.join(DATA_DIR, "isins.json")
    isins = load_json(isin_path, {})
    wanted_isins = [t.upper() for t in raw_tickers if is_isin(t)]
    if wanted_isins:
        print(f"Resolving {len(wanted_isins)} ISINs via OpenFIGI")
        isins = resolve_isins(wanted_isins, isins)
        write_json(isin_path, isins, pretty=True)
        for i in wanted_isins:
            print(f"  {i} -> {isins.get(i) or 'NOT FOUND'}")
    tickers = list(dict.fromkeys(
        (isins.get(t.upper()) if is_isin(t) else t) for t in raw_tickers if not is_isin(t) or isins.get(t.upper())))
    start = config.get("history_start", "2016-01-01")
    benchmarks = config.get("benchmarks", {})
    meta_path = os.path.join(DATA_DIR, "meta.json")
    meta = load_json(meta_path, {})

    quotes = load_json(os.path.join(DATA_DIR, "quotes.json"), {})
    files = meta.get("files", {})
    if "prices" in steps:
        print(f"Prices for {len(tickers)} tickers + {len(benchmarks)} benchmarks")
        quotes, files = step_prices(tickers, benchmarks, start)

    if "fx" in steps:
        currencies = {q.get("currency") for q in quotes.values() if q.get("currency")}
        currencies |= set(config.get("extra_currencies", []))
        print(f"FX for {len(currencies)} currencies")
        step_fx(currencies, start)

    if "nbp" in steps:
        print("NBP rates")
        step_nbp(config.get("nbp_currencies", ["USD", "EUR"]), date.fromisoformat(start))

    if "cpi" in steps:
        print("Inflation (bond indexation)")
        from cpi import fetch_cpi
        try:
            cpi = fetch_cpi(start[:7])
            write_json(os.path.join(DATA_DIR, "cpi.json"), cpi)
            print(f"  {len(cpi['months'])} months, last {cpi['months'][-1]}")
        except Exception as e:
            print(f"  FAILED ({e}); keeping previous data")

    if "events" in steps:
        print("Events")
        step_events(tickers, quotes, args.days)

    meta.update({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tickers": tickers,
        "isins": {i: isins[i] for i in wanted_isins if isins.get(i)},
        "benchmarks": benchmarks,
        "files": files,
    })
    write_json(meta_path, meta, pretty=True)
    print("Done.")


if __name__ == "__main__":
    main()
