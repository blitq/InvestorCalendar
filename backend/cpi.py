"""Monthly year-on-year inflation for Poland, used to index treasury bonds (EDO/COI/ROS/ROD).

Source: Eurostat HICP (prc_hicp_manr, PL, all items). Polish retail bonds are officially indexed
with GUS CPI, which is close to but not identical with HICP — the app lets users override any
period's rate with the official one.
"""
import requests

URL = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr"
       "?geo=PL&coicop=CP00&sinceTimePeriod={since}")


def parse_eurostat(payload):
    idx = payload["dimension"]["time"]["category"]["index"]
    by_pos = {pos: month for month, pos in idx.items()}
    rows = sorted((by_pos[int(k)], float(v)) for k, v in payload.get("value", {}).items())
    return {"months": [m for m, _ in rows], "yoy": [v for _, v in rows],
            "source": "Eurostat HICP, annual rate of change (approximation of GUS CPI)"}


def fetch_cpi(since="2015-01"):
    resp = requests.get(URL.format(since=since), timeout=30)
    resp.raise_for_status()
    return parse_eurostat(resp.json())
