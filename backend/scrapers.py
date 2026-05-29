import re
from datetime import datetime

import requests
from bs4 import BeautifulSoup


STOOQ_EXCHANGE_MAP = {
    "us": "US",
    "gpw": "Poland (WSE)",
    "de": "Germany (Xetra)",
    "fr": "France (Euronext)",
    "uk": "UK (LSE)",
    "nl": "Netherlands (Euronext)",
}


def stock_from_stooq(symbol, exchange="gpw"):
    events = []

    url = f"https://stooq.pl/q/?s={symbol}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return [], str(e)

    soup = BeautifulSoup(resp.text, "lxml")
    market = STOOQ_EXCHANGE_MAP.get(exchange, f"Other ({exchange})")

    name_el = soup.select_one("h1")
    name = name_el.get_text(strip=True) if name_el else symbol

    div_table = soup.find("table", id_="dividends")
    if div_table:
        rows = div_table.find_all("tr")[1:]
        for row in rows:
            cols = row.find_all("td")
            if len(cols) >= 3:
                date_text = cols[0].get_text(strip=True)
                amount = cols[1].get_text(strip=True)
                parsed = _parse_stooq_date(date_text)
                if parsed:
                    events.append({
                        "ticker": symbol,
                        "type": "dividend",
                        "date": parsed,
                        "title": f"{name} — Dividends",
                        "market": market,
                        "details": {"amount": amount, "source": "Stooq.pl"},
                    })

    return events, None


def _parse_stooq_date(text):
    text = text.strip()
    patterns = [
        (r"(\d{4})-(\d{2})-(\d{2})", "%Y-%m-%d"),
        (r"(\d{4})/(\d{2})/(\d{2})", "%Y/%m/%d"),
        (r"(\d{2})\.(\d{2})\.(\d{4})", "%d.%m.%Y"),
        (r"(\d{4})\.(\d{2})\.(\d{2})", "%Y.%m.%d"),
    ]
    for pat, fmt in patterns:
        m = re.search(pat, text)
        if m:
            try:
                return datetime.strptime(m.group(0), fmt).strftime("%Y-%m-%d")
            except ValueError:
                pass
    return None
