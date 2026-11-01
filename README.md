# Investor Portfolio

A free, self-hosted portfolio tracker in the spirit of Scrab: performance, dividends, allocation,
corporate events calendar and a Polish **PIT-38** tax estimate. No server, no account, no subscription.

- **Frontend**: static site in `docs/` (GitHub Pages). Plain ES modules, no build step.
  Your transactions are stored **only in your browser** (localStorage) and can be exported/imported as a JSON backup.
- **Data pipeline**: `backend/generate.py` runs in a GitHub Action on weekdays. It downloads prices, FX, NBP rates and events
  from Yahoo Finance / NBP and commits compact JSON into `docs/data/`.

```
tickers.json + config.json ──► GitHub Action (Python, yfinance, NBP API) ──► docs/data/*.json
                                                                                   │
              browser: localStorage transactions ──► js/engine.js ◄────────────────┘
```

## Features

| Area | What you get |
|---|---|
| Dashboard | value, total profit, today's change, TWR, XIRR, returns for 1D…Max, allocation, movers, upcoming events |
| Master chart | one chart with toggleable value, net invested, profit, return (TWR / XIRR / profit ÷ invested), drawdown, benchmarks (% change or "same money"), dividend and deposit bars, buy/sell/dividend/event markers; ranges 1M…Max or custom dates, drag-to-zoom (mouse and touch), log scale, daily/weekly/monthly points, filter by asset, crosshair tooltip, summary for the window, PNG/CSV export; settings are remembered |
| Holdings | positions with avg price, FIFO lots, unrealized/realized P&L, dividends, total return; per-stock chart with buy/sell markers and fundamentals |
| Transactions | buy, sell, dividend, deposit, withdrawal, fee, interest, tax; CSV import with auto column detection (EN/PL headers, EU number/date formats, duplicate skipping), CSV export |
| Dividends | received (recorded or estimated from market data), next-12-month forecast, monthly/yearly charts, yield and yield on cost |
| Analysis | allocation by sector, country, currency, market, asset type and portfolio; volatility, max drawdown, Sharpe; yearly returns vs benchmarks; monthly heatmap; "same money into a benchmark" simulation |
| Calendar | earnings, dividends, splits and expected dividends for your holdings |
| Taxes (PIT-38) | FIFO per portfolio, NBP rate from the business day before each transaction, fees as costs, foreign dividend top-up (19% minus withholding) |
| Watchlist | price, 1D/1M/1Y change, 52-week range, P/E, dividend yield, next event |
| Other | multiple portfolios (e.g. broker account, IKE/IKZE), any base currency, split handling, manual prices for assets without data, dark mode, mobile layout |

### How the numbers work
- **Cash mode**: if a portfolio has DEPOSIT/WITHDRAWAL transactions, its cash balances count towards its value and deposits
  are the external flows. Otherwise each buy is treated as new money in, and each sale or dividend as money taken out.
- **TWR** chains daily returns (inflows at the start of the day, outflows at the end). **XIRR** is the annualised money-weighted return.
- Yahoo prices are adjusted for splits; the pipeline undoes that adjustment so they match your real transaction prices. The engine then applies splits to your lots.
- **Estimated dividends** (setting, on by default): for each ex-date in the market data, shares held × dividend per share, before tax,
  unless you recorded a DIVIDEND for that ticker within 10 days before to 60 days after the ex-date. Estimates are never used for tax.

## Setup

1. Push this repository to GitHub, then go to **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/docs`.
2. Edit `tickers.json` and list the Yahoo Finance symbols you hold or watch (`AAPL`, `PKO.WA`, `SAP.DE`, `LLOY.L`, …).
   Pushing that change starts the **Update market data** workflow; you can also run it by hand from the Actions tab.
3. Open the site, then add transactions or import a CSV. **Settings → Market data** lists any of your tickers that have no data yet,
   with a ready-to-paste `tickers.json`.

`config.json` sets the history start date, the benchmarks (`^GSPC`, MSCI World, WIG20TR by default) and the currencies to fetch.

### Run locally
```bash
pip install -r backend/requirements.txt
python backend/generate.py            # or: --only prices fx
python -m http.server -d docs 8000    # open http://localhost:8000
python backend/manage.py add NVDA     # manage tickers.json
```

### Tests
```bash
node --test tests/*.test.mjs          # portfolio engine + CSV import
python -m pytest backend/tests -q     # data pipeline
```

### CSV format
Use the app's own export as a template:
`portfolio,date,type,ticker,quantity,price,fee,amount,tax,currency,note`.
The importer also recognises common broker headers in English and Polish (Data, Typ, Walor, Ilość, Cena, Prowizja, Waluta, Kwota…)
and lets you remap any column before importing.

## Privacy
Free GitHub Pages sites are public, but only market data is published. Your transactions never leave your browser.
Clearing site data deletes them, so **export a backup** from Settings now and then. Import that file to move to another device.

## Roadmap ideas
- Broker presets (XTB, mBank/eMakler, Bossa, Degiro, IBKR) with ISIN→ticker mapping
- Optional sync through a private GitHub Gist
- Polish treasury bonds (EDO/COI) valuation, crypto
- Loss carry-forward in PIT-38, PIT/ZG per country
- Price/dividend alerts, PWA offline mode, Polish UI translation
