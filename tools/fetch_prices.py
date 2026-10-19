#!/usr/bin/env python3
"""Fetch today's closing prices for every TWSE (上市) and TPEx (上櫃) stock/ETF and write prices.json.

Runs from .github/workflows/prices.yml after the market closes. It downloads the WHOLE market on
purpose: the app keeps each person's holdings on their own phone, so nothing here may reveal them.

prices.json: {"d": "YYYY-MM-DD" trading date, "t": fetched-at (UTC ISO), "p": {code: [close, change, name]}}
"""
import json, sys, datetime, pathlib, urllib.request

TWSE = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TPEX = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
ROOT = pathlib.Path(__file__).resolve().parent.parent

def pick(row, *keys):
    for k in keys:
        if k in row and row[k] not in (None, ''):
            return row[k]
    return None

def num(v):
    try:
        v = str(v).replace(',', '').replace('+', '').replace('X', '').strip()
        return float(v) if v not in ('', '--', '---', '----') else None
    except ValueError:
        return None

def roc_date(v):
    """'1151019' (ROC) or '20261019' -> '2026-10-19'"""
    s = ''.join(ch for ch in str(v or '') if ch.isdigit())
    if len(s) == 7:
        s = str(int(s[:3]) + 1911) + s[3:]
    return s[:4] + '-' + s[4:6] + '-' + s[6:8] if len(s) == 8 else None

def parse(rows):
    out, dates = {}, []
    for r in rows if isinstance(rows, list) else []:
        code = pick(r, 'Code', 'SecuritiesCompanyCode', '證券代號')
        close = num(pick(r, 'ClosingPrice', 'Close', '收盤價'))
        if not code or close is None or close <= 0:
            continue
        chg = num(pick(r, 'Change', '漲跌價差'))
        name = str(pick(r, 'Name', 'CompanyName', '證券名稱') or '').strip()[:20]
        out[str(code).strip()] = [round(close, 4), round(chg, 4) if chg is not None else None, name]
        d = roc_date(pick(r, 'Date', '日期'))
        if d:
            dates.append(d)
    return out, (max(dates) if dates else None)

def get(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'habits-prices/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8-sig'))

def main():
    p, dates, errs = {}, [], []
    for url in (TWSE, TPEX):
        try:
            got, d = parse(get(url))
            p.update(got)
            if d:
                dates.append(d)
        except Exception as e:  # keep the other market if one fails
            errs.append(url + ': ' + str(e))
    if len(p) < 100:
        sys.exit('too few prices, keeping the old file. ' + ' | '.join(errs))
    tw_today = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date().isoformat()
    d = max(dates) if dates else tw_today
    out = {'d': d, 't': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z', 'p': dict(sorted(p.items()))}
    path = ROOT / 'prices.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    if old.get('d') == d and old.get('p') == out['p']:
        print('unchanged', d); return
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print('wrote', d, len(p), 'prices', ('; errors: ' + ' | '.join(errs)) if errs else '')

if __name__ == '__main__':
    main()
