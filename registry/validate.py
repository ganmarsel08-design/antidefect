#!/usr/bin/env python3
"""Проверка реестра: каждая цитата должна дословно находиться в тексте протокола.
python3 registry/validate.py registry/rules.json /путь/к/neo-pro/data/protocols.json"""
import json, re, sys
def norm(s): return re.sub(r'\s+',' ',s.replace(' ',' ')).strip().lower()
rules=json.load(open(sys.argv[1]))['rules']
P={x['id']:x for x in json.load(open(sys.argv[2]))['items']}
need=['id','protocol','section','quote','topic','kind','applies_when','requires','logic','if_data_missing','risk_proposed','fix_template','status']
bad=0; seen=set()
for r in rules:
    errs=[]
    for k in need:
        if not r.get(k): errs.append('нет поля '+k)
    if r['id'] in seen: errs.append('дубликат id')
    seen.add(r['id'])
    if r['status'] not in ('проверено','требует сверки','не использовать'): errs.append('статус')
    p=P.get(r['protocol']['id'])
    if not p: errs.append('нет протокола')
    else:
        if p['no']!=r['protocol']['no']: errs.append(f"номер протокола {p['no']}")
        q=norm(r['quote']); where=[]
        for i,s in enumerate(p['sections']):
            if q in norm(s['t']): where.append(f"раздел#{i}: {s['h'][:40]}")
        for i,d in enumerate(p['doses']):
            if q in norm(d): where.append(f"доза#{i}")
        r['_found']=where
        if not where: errs.append('ЦИТАТА НЕ НАЙДЕНА')
    if errs: bad+=1; print(r['id'],errs)
    else: print('ok',r['id'],r['_found'][:1])
print('Ошибок:',bad,'из',len(rules)); sys.exit(1 if bad else 0)
