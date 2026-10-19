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
print('prices parser ok')
