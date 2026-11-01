import os
import sys
from datetime import date

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import nbp  # noqa: E402
from markets import detect_market, normalize_currency, safe_filename, strip_suffix  # noqa: E402
from prices import build_history, unadjust_for_splits  # noqa: E402


def test_unadjust_for_splits():
    rows = [["2020-08-28", 124.8], ["2020-08-31", 129.0]]
    out = unadjust_for_splits(rows, [["2020-08-31", 4.0]])
    assert out[0] == ["2020-08-28", 124.8 * 4]
    assert out[1] == ["2020-08-31", 129.0]


def test_build_history_minor_currency_and_splits():
    idx = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"])
    df = pd.DataFrame({"Close": [200.0, 50.0, float("nan")],
                       "Dividends": [0.0, 10.0, 0.0],
                       "Stock Splits": [0.0, 4.0, 0.0]}, index=idx)
    h = build_history(df, divisor=100.0)
    assert h["dates"] == ["2024-01-02", "2024-01-03"]
    assert h["close"] == [8.0, 0.5]  # 200p * 4 split factor / 100
    assert h["splits"] == [["2024-01-03", 4.0]]
    assert h["dividends"] == [["2024-01-03", 0.1]]


def test_markets_helpers():
    assert normalize_currency("GBp") == ("GBP", 100.0)
    assert normalize_currency("usd") == ("USD", 1.0)
    assert detect_market("PKO.WA") == "Poland (WSE)"
    assert detect_market("AAPL") == "US"
    assert detect_market("^GSPC") == "Index"
    assert strip_suffix("PKO.WA") == "PKO"
    assert safe_filename("PLNUSD=X") == "PLNUSD_X"


def test_nbp_incremental(monkeypatch):
    calls = []

    def fake(code, start, end, session=None):
        calls.append((start, end))
        return [(start.isoformat(), 4.0)]

    monkeypatch.setattr(nbp, "fetch_range", fake)
    existing = {"dates": ["2024-01-02"], "rates": [3.9]}
    out = nbp.update_currency("USD", existing, date(2024, 1, 1), today=date(2024, 1, 10))
    assert calls == [(date(2024, 1, 3), date(2024, 1, 10))]
    assert out == {"dates": ["2024-01-02", "2024-01-03"], "rates": [3.9, 4.0]}
