# Investor Portfolio

A free, self-hosted portfolio tracker in the spirit of Scrab: performance, dividends, allocation,
corporate events calendar and a Polish **PIT-38** tax estimate. No server, no account, no subscription.

- **Frontend**: static site in `docs/` (GitHub Pages). Plain ES modules, no build step.
  Your transactions are stored **only in your browser** (localStorage) and can be exported/imported as a JSON backup.
- **Data pipeline**: `backend/generate.py` runs in a GitHub Action on weekdays. It downloads prices, FX, NBP rates and events
  from Yahoo Finance / NBP into `docs/data/` and deploys the site together with that data to GitHub Pages.
  The data is not committed, so the repository stays small; it is cached between workflow runs.

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
| Holdings | positions with avg price, FIFO lots, unrealized/realized P&L, dividends, total return; closed-trade statistics (win rate, profit factor, holding time); stock detail with buy/sell markers, fundamentals (P/E, P/B, margins, ROE, payout, analyst target), business summary and dividend history with 1/3/5-year growth |
| Transactions | buy, sell, dividend, deposit, withdrawal, fee, interest, tax, currency exchange; ticker change for renames/mergers; trades settled in another account currency (e.g. PLN paid for USD shares); CSV export |
| Broker import | **XTB** (cash operations xlsx/csv), **Degiro** (Transactions.csv + Account.csv), **Interactive Brokers** (activity statement), **Revolut**; anything else via the column mapper (EN/PL headers, EU formats). Symbol mapping remembered between imports, duplicate skipping, price sanity check (fixes pence-quoted LSE prices) |
| Dividends | received (recorded or estimated from market data), next-12-month forecast, monthly/yearly charts, yield and yield on cost |
| Analysis | holdings heatmap and contribution to profit by period; allocation by sector, country, currency, market, asset type and portfolio; volatility, max drawdown, Sharpe; yearly returns vs benchmarks (config or any tracked ticker); monthly heatmap; "same money into a benchmark" simulation; side-by-side portfolio comparison |
| Calendar | earnings, dividends, splits and expected dividends for your holdings |
| Taxes (PIT-38) | CSV export and printable report; FIFO per portfolio, NBP rate from the business day before the trade or T+2 settlement date, fees as costs, foreign dividend top-up (19% minus withholding), automatic loss carry-forward (one-off up to PLN 5M or 50%/year, 5 years, plus losses from before your data), per-country breakdown for PIT/ZG |
| Watchlist | price, 1D/1M/1Y change, 52-week range, P/E, dividend yield, next event |
| Treasury bonds | Polish retail bonds OTS, ROR, DOR, TOS, COI, ROS, EDO, ROD: value with accrued interest, inflation-linked rates (CPI two months before each period + margin, editable per period), capitalisation or yearly/monthly interest payouts, early-redemption value after fee and 19% tax, maturity tracking |
| Other assets | real estate, deposits, crypto wallets, gold, private loans… valued by hand (valuation history) or growing at a fixed interest rate; included in value, returns and allocation |
| Accounts | portfolio types Regular / IKE / IKZE / OIPE; yearly contribution limits with progress and remaining amount, IKZE PIT deduction estimate; tax-free accounts excluded from PIT-38 |
| Reports | month / quarter / year summary: start and end value, net money in, profit, return vs benchmark, dividends, best and worst positions, all transactions; printable |
| Goals | financial independence (monthly income at a safe withdrawal rate), dividend-income or amount goals; projection in today's money, time to goal, monthly contribution needed |
| Languages | English and Polish (follows the browser, switchable in Settings); numbers and dates in the chosen locale |
| Alerts & sharing | price alerts on the watchlist (dashboard banner + browser notification), read-only share link with weights and returns only, installable app (PWA) that works offline |
| Sync & backup | optional sync between devices through a private GitHub Gist (end-to-end encrypted with a passphrase, merges by transaction, deletions propagate), JSON backup, backup reminder |
| Other | multiple portfolios, any base currency, split handling, manual prices for assets without data, dark mode, mobile layout |

### How the numbers work
- **Cash mode**: if a portfolio has DEPOSIT/WITHDRAWAL transactions, its cash balances count towards its value and deposits
  are the external flows. Otherwise each buy is treated as new money in, and each sale or dividend as money taken out.
- **TWR** chains daily returns (inflows at the start of the day, outflows at the end). **XIRR** is the annualised money-weighted return.
- Yahoo prices are adjusted for splits; the pipeline undoes that adjustment so they match your real transaction prices. The engine then applies splits to your lots.
- **Estimated dividends** (setting, on by default): for each ex-date in the market data, shares held × dividend per share, before tax,
  unless you recorded a DIVIDEND for that ticker within 10 days before to 60 days after the ex-date. Estimates are never used for tax.

## Setup

1. Push this repository to GitHub, then go to **Settings → Pages** and set **Source: GitHub Actions**.
   The **Build data and deploy site** workflow publishes the site on every push to `main` and on its schedule.
2. Edit `tickers.json` and list the Yahoo Finance symbols you hold or watch (`AAPL`, `PKO.WA`, `SAP.DE`, `LLOY.L`, …).
   ISINs work too (`IE00BK5BQT80`): the workflow resolves them through OpenFIGI, and imported "ISIN:…" positions switch to the ticker automatically.
   Pushing that change rebuilds and redeploys the site; you can also run the workflow by hand from the Actions tab.
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
node --test tests/*.test.mjs          # engine, importers, brokers, bonds, sync, goals, master chart
python -m pytest backend/tests -q     # data pipeline
node tests/e2e/smoke.mjs              # every page in EN + PL in Chromium (needs `playwright`)
```

### Code layout
```
backend/            data pipeline (prices, FX, NBP, CPI, ISIN resolution, events)
docs/index.html     app shell            docs/js/app.js       routing + shared context
docs/js/engine.js   portfolio maths, tax, rebalancing (pure, tested in Node)
docs/js/views/      one module per page  docs/js/i18n.js      Polish translation
docs/js/brokers.js  broker importers     docs/js/bonds.js     treasury bonds
docs/js/sync.js     Gist sync            docs/js/masterchart.js + masterdata.js
```

### CSV format
Use the app's own export as a template:
`portfolio,date,type,ticker,quantity,price,fee,amount,tax,currency,note`.
The importer also recognises common broker headers in English and Polish (Data, Typ, Walor, Ilość, Cena, Prowizja, Waluta, Kwota…)
and lets you remap any column before importing.

## Privacy
Free GitHub Pages sites are public, but only market data is published. Your transactions stay in your browser.
Clearing site data deletes them, so **export a backup** from Settings now and then, or turn on **sync**: it stores the
portfolio in a private gist of your GitHub account, encrypted in the browser with your passphrase (PBKDF2 + AES-GCM),
so GitHub only ever sees ciphertext. The token and passphrase never leave the device you typed them on.

## Roadmap ideas
- Broker presets (XTB, mBank/eMakler, Bossa, Degiro, IBKR) with ISIN→ticker mapping
- Optional sync through a private GitHub Gist
- Polish treasury bonds (EDO/COI) valuation, crypto
- Loss carry-forward in PIT-38, PIT/ZG per country
- Price/dividend alerts, PWA offline mode, Polish UI translation
