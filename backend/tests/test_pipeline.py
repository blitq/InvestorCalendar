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


def test_isin_pick_symbol():
    from isin import is_isin, pick_symbol
    assert is_isin("US0378331005") and not is_isin("AAPL")
    rows = [{"ticker": "AAPL", "exchCode": "UA"}, {"ticker": "AAPL", "exchCode": "US"}, {"ticker": "APC", "exchCode": "GY"}]
    assert pick_symbol("US0378331005", rows) == "AAPL"
    assert pick_symbol("PLPKO0000016", [{"ticker": "PKO", "exchCode": "PW"}]) == "PKO.WA"
    fund = [{"ticker": "VWRA", "exchCode": "LN"}, {"ticker": "VWCE", "exchCode": "GY"}]
    assert pick_symbol("IE00BK5BQT80", fund) == "VWCE.DE"
    assert pick_symbol("US0846707026", [{"ticker": "BRK/B", "exchCode": "US"}]) == "BRK-B"
    assert pick_symbol("XX0000000000", []) is None


def test_isin_resolve_uses_cache(monkeypatch):
    import isin

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return [{"data": [{"ticker": "PKO", "exchCode": "PW"}]}]

    class Sess:
        def __init__(self):
            self.calls = 0

        def post(self, url, json, timeout):
            self.calls += 1
            assert [j["idValue"] for j in json] == ["PLPKO0000016"]
            return Resp()

    s = Sess()
    out = isin.resolve(["US0378331005", "PLPKO0000016"], {"US0378331005": "AAPL"}, session=s, sleep=0)
    assert out == {"US0378331005": "AAPL", "PLPKO0000016": "PKO.WA"}
    assert s.calls == 1


def test_parse_eurostat_cpi():
    from cpi import parse_eurostat
    payload = {"dimension": {"time": {"category": {"index": {"2024-02": 1, "2024-01": 0}}}}, "value": {"1": 3.3, "0": 4.5}}
    assert parse_eurostat(payload)["months"] == ["2024-01", "2024-02"]
    assert parse_eurostat(payload)["yoy"] == [4.5, 3.3]


def test_stooq_symbols_and_parse():
    from stooq import parse_csv, stooq_symbol
    assert stooq_symbol("AAPL") == ("aapl.us", 1.0)
    assert stooq_symbol("PKO.WA") == ("pko", 1.0)
    assert stooq_symbol("LLOY.L") == ("lloy.uk", 100.0)
    assert stooq_symbol("BRK-B") == ("brk.b.us", 1.0)
    assert stooq_symbol("AIR.PA") is None and stooq_symbol("^GSPC") is None
    h = parse_csv("Date,Open,High,Low,Close,Volume\n2024-01-02,1,1,1,45.2,100\n2024-01-03,1,1,1,46,100\n", 100.0)
    assert h["dates"] == ["2024-01-02", "2024-01-03"] and h["close"] == [0.452, 0.46]
    import pytest
    with pytest.raises(RuntimeError):
        parse_csv("Brak danych")


def test_step_prices_falls_back_to_stooq(tmp_path, monkeypatch):
    import json
    import generate
    import prices
    import stooq
    monkeypatch.setattr(generate, "DATA_DIR", str(tmp_path))
    (tmp_path / "history").mkdir()
    (tmp_path / "history" / "PKO.WA.json").write_text(json.dumps({"currency": "PLN", "dividends": [["2024-07-01", 5.5]], "splits": []}))
    monkeypatch.setattr(prices, "fetch_ticker", lambda sym, start: (_ for _ in ()).throw(RuntimeError("yahoo down")))
    monkeypatch.setattr(stooq, "fetch_history", lambda sym, start: {"dates": ["2024-07-01", "2024-07-02"], "close": [50.0, 51.0], "dividends": [], "splits": [], "source": "stooq"})
    monkeypatch.setattr(generate.time, "sleep", lambda s: None)
    quotes, files = generate.step_prices(["PKO.WA"], {}, "2024-01-01")
    h = json.loads((tmp_path / "history" / "PKO.WA.json").read_text())
    assert files == {"PKO.WA": "history/PKO.WA.json"}
    assert h["close"] == [50.0, 51.0] and h["dividends"] == [["2024-07-01", 5.5]] and h["currency"] == "PLN"
    assert quotes["PKO.WA"]["price"] == 51.0 and quotes["PKO.WA"]["source"] == "stooq"
