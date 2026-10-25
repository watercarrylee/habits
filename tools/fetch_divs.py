#!/usr/bin/env python3
"""Fetch the official 除權除息預告表 (TWSE 上市 + TPEx 上櫃) and write dividends.json for the app.

dividends.json: {"t": fetched-at (UTC ISO), "e": [[code, "YYYY-MM-DD" ex-date, cash per share, stock ratio per share], ...]}
Whole market on purpose (the app keeps holdings on the phone). Entries are kept for 120 days after the
ex-date so someone who opens the app weeks later still gets asked about a dividend they missed.
Failure here never blocks the closing prices: the workflow runs it with continue-on-error.
"""
import json, sys, datetime, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fetch_prices import get, num, roc_date, KEEP

TWSE = 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL'
TPEX = 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'
ROOT = pathlib.Path(__file__).resolve().parent.parent
KEEP_DAYS = 120

def pick(row, *keys):
    for k in keys:
        if row.get(k) not in (None, ''):
            return row[k]
    return None

def parse(rows):
    """[{...}] from either market -> {(code, date): [cash, ratio]} (only entries that pay something)"""
    out = {}
    for r in rows if isinstance(rows, list) else []:
        code = str(pick(r, 'Code', 'SecuritiesCompanyCode') or '').strip()
        d = roc_date(pick(r, 'Date', 'ExRrightsExDividendDate'))
        if not KEEP.match(code) or not d:
            continue
        cash = num(pick(r, 'CashDividend')) or 0.0
        ratio = num(pick(r, 'StockDividendRatio')) or 0.0
        if cash <= 0 and ratio <= 0:
            continue
        out[(code, d)] = [round(cash, 6), round(ratio, 8)]
    return out

def merge(old, new, today):
    """keep old entries (still within KEEP_DAYS) and let the newest announcement win"""
    cut = (today - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    m = {(e[0], e[1]): [e[2], e[3]] for e in (old or []) if isinstance(e, list) and len(e) == 4 and e[1] >= cut}
    m.update({k: v for k, v in new.items() if k[1] >= cut})
    return sorted([[k[0], k[1], v[0], v[1]] for k, v in m.items()], key=lambda e: (e[1], e[0]))

def main():
    today = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date()
    new, errs = {}, []
    for name, url in (('TWSE', TWSE), ('TPEx', TPEX)):
        try:
            got = parse(get(url)); new.update(got); print(name, len(got))
        except Exception as e:
            errs.append(name + ': ' + str(e))
    path = ROOT / 'dividends.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    e = merge(old.get('e'), new, today)
    if e == old.get('e'):
        print('unchanged', len(e), '; '.join(errs)); return
    path.write_text(json.dumps({'t': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z', 'e': e}, ensure_ascii=False, separators=(',', ':')))
    print('wrote', len(e), 'entries', '; '.join(errs))
    if errs and not new:
        sys.exit(' | '.join(errs))

if __name__ == '__main__':
    main()
