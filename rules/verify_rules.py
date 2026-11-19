#!/usr/bin/env python3
"""Проверка базы медицинских правил (пилот).

python3 rules/verify_rules.py rules/pilot-rules.json [--registry registry/protocols-registry.json] [--pdf-dir DIR]

Без --pdf-dir проверяются структура, связь с реестром и хэши цитат.
С --pdf-dir каждая цитата ищется на указанной странице локального PDF
(текст извлекается pdftotext, пробелы и маркеры списков нормализуются).
"""
import hashlib, json, os, re, subprocess, sys

CANDIDATE = 'кандидат, ожидает экспертного подтверждения'
NORMATIVITY = {'обязательно', 'рекомендуется', 'может_применяться', 'не_рекомендуется', 'противопоказано'}
KINDS = {'требование', 'ограничение', 'сравнительное_положение'}
BLOCKING = {'no', 'always', 'when'}
SCOPES = {'applicability', 'requirement'}
CONFLICT_TYPES = {'противоречие', 'неоднозначность_маршрутизации'}
OPS = {'eq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_true', 'is_false', 'present'}
RULE_ID = re.compile(r'^(RDS|NEC|SEP)-\d{3}$')
PREFIX = {'rds': 'RDS', 'nek': 'NEC', 'sepsis': 'SEP'}
_BULLETS = re.compile('[-•●▪‣⁃]')


def norm_text(s):
    s = _BULLETS.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def sha(s):
    return hashlib.sha256(norm_text(s).encode('utf-8')).hexdigest()


def pdf_pages(path):
    out = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True, check=True).stdout
    pages = out.split('\f')
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    return [norm_text(p) for p in pages]


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def fields_of(node):
    if 'all' in node:
        return set().union(*(fields_of(n) for n in node['all']))
    if 'any' in node:
        return set().union(*(fields_of(n) for n in node['any']))
    return {node['field']}


def check_node(node, where, errs):
    if 'all' in node or 'any' in node:
        k = 'all' if 'all' in node else 'any'
        if not node[k]:
            errs.append(f'{where}: пустой список {k}')
        for n in node[k]:
            check_node(n, where, errs)
        return
    if node.get('op') not in OPS:
        errs.append(f'{where}: неизвестная операция {node.get("op")}')
    if node.get('op') in ('eq', 'gt', 'gte', 'lt', 'lte', 'in') and 'value' not in node:
        errs.append(f'{where}: операция {node["op"]} без value')


def check(db, registry=None, pdf_dir=None):
    errs, warns = [], []
    if db.get('authenticated') is not False:
        errs.append('база не может быть помечена authenticated: подпись не реализована')
    pol = db.get('policy', {})
    if 'final_conclusion' not in pol or 'deviation' not in pol:
        errs.append('policy: нет правил об итоговом выводе и об обосновании отклонения')
    reg = {p['id']: p for p in (registry or {}).get('protocols', [])}
    pages_cache = {}
    for pid, pr in db['protocols'].items():
        if registry is not None:
            rp = reg.get(pid)
            if not rp:
                errs.append(f'{pid}: нет в реестре')
                continue
            if rp['doc_id'] != pr['doc_id']:
                errs.append(f'{pid}: doc_id {pr["doc_id"]} ≠ реестр {rp["doc_id"]}')
            if (rp.get('local_pdf') or {}).get('sha256') != pr['pdf']['sha256']:
                errs.append(f'{pid}: SHA-256 PDF не совпадает с local_pdf реестра')
            if rp['approval']['no'] != pr['edition']['approval_no'] or rp['approval']['date_iso'] != pr['edition']['approval_date']:
                errs.append(f'{pid}: редакция (номер/дата одобрения) не совпадает с реестром')
            if rp['official_check']['result'] != pr['registry_official_check']:
                errs.append(f'{pid}: результат официальной сверки устарел относительно реестра')
        if pr['pdf'].get('identity_with_official_file') != 'не установлено' and not pr['pdf'].get('official_sha256'):
            errs.append(f'{pid}: тождество с официальным файлом заявлено без хэша официального файла')
        if pdf_dir:
            path = os.path.join(pdf_dir, pr['pdf']['file_name'])
            if not os.path.exists(path):
                errs.append(f'{pid}: нет файла {path}')
                continue
            if file_sha256(path) != pr['pdf']['sha256']:
                errs.append(f'{pid}: файл в --pdf-dir не совпадает по SHA-256')
                continue
            pages_cache[pid] = pdf_pages(path)
    ids = set()
    dd = db.get('data_dictionary', {})
    for r in db['rules']:
        rid = r.get('rule_id', '?')
        if not RULE_ID.match(rid):
            errs.append(f'{rid}: неверный формат rule_id')
        if rid in ids:
            errs.append(f'{rid}: повтор rule_id')
        ids.add(rid)
        pr = db['protocols'].get(r['protocol'])
        if not pr:
            errs.append(f'{rid}: неизвестный протокол {r["protocol"]}')
            continue
        if not rid.startswith(PREFIX[r['protocol']] + '-'):
            errs.append(f'{rid}: префикс не соответствует протоколу')
        if r['doc_id'] != pr['doc_id']:
            errs.append(f'{rid}: doc_id не совпадает с протоколом')
        if r['normativity'] not in NORMATIVITY:
            errs.append(f'{rid}: недопустимый класс нормативности {r["normativity"]}')
        if r.get('kind') not in KINDS:
            errs.append(f'{rid}: недопустимый вид правила')
        if r['normativity'] == 'противопоказано' and 'противопоказ' not in ' '.join(q['text'].lower() for q in r['source']['quotes']):
            errs.append(f'{rid}: «противопоказано» без такого слова в цитате')
        if 'без модального' in r['normativity_marker'] and not any('модальн' in a['text'] for a in r['ambiguities']):
            errs.append(f'{rid}: класс выставлен без модального слова, но вопрос эксперту о классе не поставлен')
        if r['status'] != CANDIDATE:
            if not r.get('expert_confirmation'):
                errs.append(f'{rid}: статус «{r["status"]}» без подтверждения эксперта')
        elif r.get('expert_confirmation'):
            errs.append(f'{rid}: кандидат с заполненным подтверждением эксперта')
        if not r['source'].get('section'):
            errs.append(f'{rid}: нет раздела')
        if not r['source']['quotes']:
            errs.append(f'{rid}: нет цитаты')
        for i, q in enumerate(r['source']['quotes']):
            w = f'{rid} цитата {i + 1}'
            if not isinstance(q.get('page'), int) or not (1 <= q['page'] <= pr['pdf']['pages']):
                errs.append(f'{w}: страница вне документа')
                continue
            if q.get('sha256') != sha(q['text']):
                errs.append(f'{w}: хэш цитаты не совпадает с текстом (цитата изменена?)')
            if r['protocol'] in pages_cache:
                pg = pages_cache[r['protocol']][q['page'] - 1]
                if norm_text(q['text']) not in pg:
                    other = [n + 1 for n, p in enumerate(pages_cache[r['protocol']]) if norm_text(q['text']) in p]
                    errs.append(f'{w}: текст не найден на стр. {q["page"]}' + (f' (найден на стр. {other})' if other else ' (нет в документе)'))
        for k in ('applicability', 'requirement'):
            node = r[k].get('condition' if k == 'applicability' else 'check')
            if not node:
                errs.append(f'{rid}: нет машинного условия в {k}')
                continue
            check_node(node, f'{rid}.{k}', errs)
            missing = fields_of(node) - {d['field'] for d in r['required_data']}
            if missing:
                errs.append(f'{rid}: поля {sorted(missing)} не перечислены в required_data')
        for d in r['required_data']:
            if d['field'] not in dd:
                errs.append(f'{rid}: поле {d["field"]} нет в словаре данных')
        ev = r.get('evidence_level') or {}
        if ev.get('value') and not ev.get('source_page'):
            errs.append(f'{rid}: уровень доказательности без страницы-источника')
        if r.get('kind') == 'сравнительное_положение' and r['normativity'] == 'обязательно':
            errs.append(f'{rid}: сравнительное положение не может быть обязательным требованием без решения эксперта')
        if r.get('kind') == 'сравнительное_положение' and not any(a.get('blocking') == 'always' for a in r.get('ambiguities', [])):
            errs.append(f'{rid}: сравнительное положение должно ожидать решения эксперта (блокирующая неоднозначность)')
        for a in r.get('ambiguities', []):
            if a.get('decision') and not r.get('expert_confirmation'):
                errs.append(f'{a["id"]}: решение по неоднозначности без подтверждения эксперта')
            if a.get('blocking') not in BLOCKING:
                errs.append(f'{a["id"]}: не указано, блокирует ли неоднозначность оценку')
            if a.get('scope') not in SCOPES:
                errs.append(f'{a["id"]}: неверная область неоднозначности')
            if a.get('blocking') == 'when':
                if not a.get('blocks_when'):
                    errs.append(f'{a["id"]}: blocking=when без условия blocks_when')
                else:
                    check_node(a['blocks_when'], a['id'], errs)
                    for fld in fields_of(a['blocks_when']) - set(dd):
                        errs.append(f'{a["id"]}: поле {fld} нет в словаре данных')
    rule_ids = {r['rule_id'] for r in db['rules']}
    cf_ids = set()
    for cf in db.get('protocol_conflicts', []):
        cid = cf.get('id', '?')
        if cid in cf_ids:
            errs.append(f'{cid}: повтор id противоречия')
        cf_ids.add(cid)
        if cf.get('type') not in CONFLICT_TYPES:
            errs.append(f'{cid}: недопустимый тип {cf.get("type")}')
        if not cf.get('rules'):
            errs.append(f'{cid}: нет правил, условия которых должны выполняться')
        if cf.get('type') == 'неоднозначность_маршрутизации' and 'противоречи' in cf.get('description', '').split('.')[0].lower():
            errs.append(f'{cid}: неоднозначность маршрутизации описана как противоречие')
        for rr in cf.get('rules', []) + cf.get('related_rules', []):
            if rr not in rule_ids:
                errs.append(f'{cid}: неизвестное правило {rr}')
        if not cf.get('active_when'):
            errs.append(f'{cid}: нет условия active_when')
        else:
            check_node(cf['active_when'], cid, errs)
            for fld in fields_of(cf['active_when']) - set(dd):
                errs.append(f'{cid}: поле {fld} нет в словаре данных')
        if len(cf.get('quotes', [])) < 2:
            errs.append(f'{cid}: противоречие должно опираться минимум на две цитаты')
        for i, q in enumerate(cf.get('quotes', [])):
            w = f'{cid} цитата {i + 1}'
            pr = db['protocols'].get(q.get('protocol'))
            if not pr:
                errs.append(f'{w}: неизвестный протокол')
                continue
            if q.get('sha256') != sha(q['text']):
                errs.append(f'{w}: хэш цитаты не совпадает с текстом')
            if q['protocol'] in pages_cache:
                if not (1 <= q['page'] <= len(pages_cache[q['protocol']])) or norm_text(q['text']) not in pages_cache[q['protocol']][q['page'] - 1]:
                    errs.append(f'{w}: текст не найден на стр. {q["page"]}')
    for r in db['rules']:
        declared = {c['id'] for c in db.get('protocol_conflicts', []) if r['rule_id'] in c['rules'] + c.get('related_rules', [])}
        if set(r.get('protocol_conflicts', [])) != declared:
            errs.append(f'{r["rule_id"]}: ссылки protocol_conflicts не совпадают с объявленными противоречиями')
    per = {}
    for r in db['rules']:
        per[r['protocol']] = per.get(r['protocol'], 0) + 1
    for pid in db['protocols']:
        if not 5 <= per.get(pid, 0) <= 10:
            errs.append(f'{pid}: в пилоте должно быть 5–10 правил, сейчас {per.get(pid, 0)}')
    return errs, warns


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    db = json.load(open(argv[1], encoding='utf-8'))
    reg = None
    if '--registry' in argv:
        reg = json.load(open(argv[argv.index('--registry') + 1], encoding='utf-8'))
    pdf_dir = argv[argv.index('--pdf-dir') + 1] if '--pdf-dir' in argv else None
    errs, warns = check(db, reg, pdf_dir)
    for w in warns:
        print('предупреждение:', w)
    for e in errs:
        print('ОШИБКА:', e)
    print(f'Правил: {len(db["rules"])}; ошибок: {len(errs)}' + ('; цитаты сверены с PDF' if pdf_dir else '; цитаты с PDF не сверялись (нет --pdf-dir)'))
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
