#!/usr/bin/env python3
"""Fetch today's closing prices for every TWSE (上市) and TPEx (上櫃) stock/ETF and write prices.json (official sites first, open-data APIs as fallback).

Runs from .github/workflows/prices.yml after the market closes. It downloads the WHOLE market on
purpose: the app keeps each person's holdings on their own phone, so nothing here may reveal them.

prices.json: {"d": "YYYY-MM-DD" trading date, "t": fetched-at (UTC ISO), "p": {code: [close, change, name]}}
prices-30.json: the last 30 trading days of closes, column style so it stays small:
  {"d": [oldest ... newest date], "c": {code: [close or null for each date]}}
The app only downloads it to fill in days it missed.
"""
import json, re, sys, time, datetime, pathlib, urllib.request

# Main sources: the official sites' 每日收盤行情 data (the same data their web pages show). They have the day's
# closes soon after the market closes. The open-data APIs below are the fallback; they are often hours late.
TWSE_WEB = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date={ymd}&type=ALLBUT0999&response=json'
TPEX_WEB = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date={y}/{m}/{d}&type=EW&response=json'
TWSE = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
TPEX = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
ROOT = pathlib.Path(__file__).resolve().parent.parent
# stocks (2330, 2881A) and ETFs (0050, 00679B); skips warrants and other instruments to keep the file small
KEEP = re.compile(r'^(\d{4}[A-Z]?|00\d{2,4}[A-Z]?)$')

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
        code = str(code or '').strip()
        if not KEEP.match(code) or close is None or close <= 0:
            continue
        chg = num(pick(r, 'Change', '漲跌價差'))
        name = str(pick(r, 'Name', 'CompanyName', '證券名稱') or '').strip()[:20]
        out[code] = [round(close, 4), round(chg, 4) if chg is not None else None, name]
        d = roc_date(pick(r, 'Date', '日期'))
        if d:
            dates.append(d)
    return out, (max(dates) if dates else None)

def parse_web(j):
    """Official-site JSON: {"date": "20261019", "tables": [{"fields": [...], "data": [[...]]}]} (TWSE MI_INDEX / TPEx otc).
    TWSE gives the sign in an HTML field 漲跌(+/-) and the size in 漲跌價差; TPEx gives a signed 漲跌 (or text like 除息)."""
    out = {}
    if not isinstance(j, dict):
        return out, None
    d = roc_date(j.get('date'))
    for t in j.get('tables') or []:
        f = [str(x).strip() for x in t.get('fields') or []]
        ci = next((f.index(k) for k in ('證券代號', '代號') if k in f), None)
        pi = next((f.index(k) for k in ('收盤價', '收盤') if k in f), None)
        if ci is None or pi is None:
            continue
        ni = next((f.index(k) for k in ('證券名稱', '名稱') if k in f), None)
        si = f.index('漲跌(+/-)') if '漲跌(+/-)' in f else None
        gi = f.index('漲跌價差') if '漲跌價差' in f else (f.index('漲跌') if '漲跌' in f else None)
        for r in t.get('data') or []:
            if len(r) <= max(ci, pi):
                continue
            code = str(r[ci]).strip()
            close = num(r[pi])
            if not KEEP.match(code) or close is None or close <= 0:
                continue
            chg = num(r[gi]) if gi is not None else None
            if si is not None:
                sign = re.sub(r'<[^>]*>', '', str(r[si])).strip()
                if 'X' in sign or chg is None:
                    chg = None
                elif '-' in sign:
                    chg = -abs(chg)
            name = str(r[ni]).strip()[:20] if ni is not None else ''
            out[code] = [round(close, 4), round(chg, 4) if chg is not None else None, name]
    return out, (d if out else None)

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (habits-prices)'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode('utf-8-sig'))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(15 * (i + 1))

HIST_DAYS = 30

def add_history(hist, d, p):
    """Put day d's closes into the 30-day history (replacing d if it is already there)."""
    days = list(hist.get('d') or [])
    old = {c: dict(zip(days, v)) for c, v in (hist.get('c') or {}).items()}
    if d not in days:
        days.append(d)
    days = sorted(days)[-HIST_DAYS:]
    for c in old:
        old[c].pop(d, None)
    for c, v in p.items():
        old.setdefault(c, {})[d] = v[0]
    cols = {}
    for c in sorted(old):
        row = [old[c].get(x) for x in days]
        if any(x is not None for x in row):
            cols[c] = row
    return {'d': days, 'c': cols}

def save_history(d, p):
    path = ROOT / 'prices-30.json'
    hist = json.loads(path.read_text()) if path.exists() else {}
    new = add_history(hist, d, p)
    if new != hist:
        path.write_text(json.dumps(new, ensure_ascii=False, separators=(',', ':')))

def fetch_market(web, api, now):
    """Closes for one market: the official site first, the open-data API if the site fails or has nothing yet."""
    errs = []
    try:
        got, d = parse_web(get(web.format(ymd=now.strftime('%Y%m%d'), y=now.year, m='%02d' % now.month, d='%02d' % now.day), tries=2))
        if got:
            return got, d, errs
        errs.append('site: no data yet')
    except Exception as e:
        errs.append('site: ' + str(e))
    try:
        got, d = parse(get(api))
        return got, d, errs
    except Exception as e:
        errs.append('api: ' + str(e))
        return {}, None, errs

def main():
    p, dates, errs = {}, [], []
    now = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date()
    for name, web, api in (('TWSE', TWSE_WEB, TWSE), ('TPEx', TPEX_WEB, TPEX)):
        got, d, e = fetch_market(web, api, now)
        print(name, d, len(got), '; '.join(e))
        if not got:
            errs.append(name + ': ' + ' | '.join(e))
            continue
        p.update(got)
        dates.append(d)
    # both markets must be on the same day, or holdings in one market would get a stale price.
    # This is normal before the day's closes are out everywhere (e.g. a run just after midnight): keep the old file quietly.
    if not errs and len(set(dates)) > 1:
        print('keeping the old file: markets on different days (' + ', '.join(str(x) for x in dates) + '); a later run will catch up')
        return
    # a half-updated file would show some holdings as "price not found", so keep the old one and let the next run retry
    if errs or len(p) < 100:
        sys.exit('keeping the old file: ' + (' | '.join(errs) or 'too few prices'))
    tw_today = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date().isoformat()
    d = max(dates) if dates else tw_today
    out = {'d': d, 't': datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z', 'p': dict(sorted(p.items()))}
    path = ROOT / 'prices.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    save_history(d, p)
    if old.get('d') == d and old.get('p') == out['p']:
        print('unchanged', d); return
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print('wrote', d, len(p), 'prices', ('; errors: ' + ' | '.join(errs)) if errs else '')

if __name__ == '__main__':
    main()
