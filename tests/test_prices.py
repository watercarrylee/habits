import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'tools'))
import fetch_prices as fp
F = pathlib.Path(__file__).resolve().parent / 'fixtures'
a, da = fp.parse(json.loads((F / 'twse.json').read_text()))
b, db = fp.parse(json.loads((F / 'tpex.json').read_text()))
assert a['2330'] == [1005.0, 15.0, '台積電'], a['2330']
assert a['0050'][1] == -1.25 and '9999' not in a
assert b['6488'] == [450.0, -3.5, '環球晶'] and b['00679B'][1] == 0.0
assert da == db == '2026-10-19'
assert fp.roc_date('20261019') == '2026-10-19'
w, _ = fp.parse([{'Code': '030012', 'ClosingPrice': '1.2', 'Change': '0'}, {'Code': '2881A', 'ClosingPrice': '60', 'Change': '0'}])
assert '030012' not in w and '2881A' in w, w
wa, wd = fp.parse_web(json.loads((F / 'twse_web.json').read_text()))
assert wd == '2026-10-19' and wa['0050'] == [108.15, -0.85, '元大台灣50'] and wa['2330'] == [2420.0, 0.0, '台積電'] and wa['3037'][1] == 30.0, wa
assert wa['2881'] == [88.5, None, '富邦金'] and '1101' not in wa and '030012' not in wa and len(wa) == 4, wa
wb, wbd = fp.parse_web(json.loads((F / 'tpex_web.json').read_text()))
assert wbd == '2026-10-19' and wb['6488'] == [882.0, -20.0, '環球晶'] and wb['00679B'][1] == 0.1 and wb['00694B'] == [42.25, None, '富邦美債1-3'], wb
assert fp.parse_web({'stat': '很抱歉，沒有符合條件的資料!'}) == ({}, None)
h = fp.add_history({}, '2026-10-16', {'2330': [1000, 5, 'x'], '0050': [190, 1, 'y']})
h = fp.add_history(h, '2026-10-19', {'2330': [1010, 10, 'x'], '6488': [450, 0, 'z']})
assert h == {'d': ['2026-10-16', '2026-10-19'], 'c': {'0050': [190, None], '2330': [1000, 1010], '6488': [None, 450]}}, h
assert fp.add_history(h, '2026-10-19', {'2330': [1011, 11, 'x']})['c']['2330'] == [1000, 1011]
for i in range(35):
    h = fp.add_history(h, '2026-11-%02d' % (i % 28 + 1) if i < 28 else '2026-12-%02d' % (i - 27), {'2330': [i, 0, 'x']})
assert len(h['d']) == 30 and len(h['c']['2330']) == 30 and h['d'] == sorted(h['d']) and '0050' not in h['c'], h['d']
print('prices parser ok')
import fetch_divs as fd, datetime as _dt
dv = fd.parse(json.loads((F / 'divs_twse.json').read_text()))
dv.update(fd.parse(json.loads((F / 'divs_tpex.json').read_text())))
assert dv[('0056', '2026-10-22')] == [1.72, 0.0] and dv[('2330', '2026-11-12')] == [4.5, 0.05] and dv[('6488', '2026-10-30')] == [3.5, 0.0], dv
assert not any(k[0] in ('00400A', '2025', '01007T') for k in dv), dv  # nothing announced yet / rights issue only / not a stock code we keep
m = fd.merge([['2330', '2026-05-01', 4.0, 0.0], ['1101', '2026-01-01', 1.0, 0.0]], dv, _dt.date(2026, 7, 1))
assert ['2330', '2026-05-01', 4.0, 0.0] in m and not any(e[0] == '1101' for e in m) and m == sorted(m, key=lambda e: (e[1], e[0])), m
print('dividends parser ok')
