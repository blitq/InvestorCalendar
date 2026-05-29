#!/usr/bin/env python3
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TICKERS_PATH = os.path.join(BASE_DIR, "tickers.json")


def load():
    with open(TICKERS_PATH) as f:
        return json.load(f)


def save(tickers):
    with open(TICKERS_PATH, "w") as f:
        json.dump(tickers, f, indent=4)
        f.write("\n")
    print(f"Saved {len(tickers)} tickers to {TICKERS_PATH}")


def cmd_list():
    tickers = load()
    if not tickers:
        print("No tickers configured.")
        return
    for t in tickers:
        print(t)


def cmd_add(symbol):
    symbol = symbol.upper().strip()
    tickers = load()
    if symbol in tickers:
        print(f"{symbol} already in list.")
        return
    tickers.append(symbol)
    tickers.sort()
    save(tickers)
    print(f"Added {symbol}.")


def cmd_remove(symbol):
    symbol = symbol.upper().strip()
    tickers = load()
    if symbol not in tickers:
        print(f"{symbol} not in list.")
        return
    tickers.remove(symbol)
    save(tickers)
    print(f"Removed {symbol}.")


def cmd_prune():
    import yfinance as yf

    tickers = load()
    bad = []
    for t in tickers:
        try:
            info = yf.Ticker(t).info
            if not info or info.get("regularMarketPrice") is None:
                bad.append(t)
        except Exception:
            bad.append(t)
    if bad:
        print(f"Pruning {len(bad)} unresolvable tickers: {', '.join(bad)}")
        for t in bad:
            tickers.remove(t)
        save(tickers)
    else:
        print("All tickers look valid.")


def cmd_help():
    print("Usage:")
    print("  python manage.py list")
    print("  python manage.py add <SYMBOL>")
    print("  python manage.py remove <SYMBOL>")
    print("  python manage.py prune")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        cmd_help()
        sys.exit(1)

    command = sys.argv[1]

    if command == "list":
        cmd_list()
    elif command == "add" and len(sys.argv) >= 3:
        cmd_add(sys.argv[2])
    elif command == "remove" and len(sys.argv) >= 3:
        cmd_remove(sys.argv[2])
    elif command == "prune":
        cmd_prune()
    else:
        cmd_help()
