#!/usr/bin/env python3
"""Таблица для врача-эксперта из rules/pilot-rules.json.

python3 rules/export_expert_review.py rules/pilot-rules.json docs/
Создаёт stage5-expert-review.csv (30 правил) и stage5-expert-questions.csv
(вопросы по неоднозначностям и расхождениям протоколов). Решения эксперта
в эти файлы вписываются вручную и затем переносятся в базу отдельным PR.

python3 rules/export_expert_review.py --stage6 rules/pilot-rules.json rules/build/baseline-2239c52.json rules/expert-decisions.json docs/
Создаёт stage6-rules-revision.csv (30 правил: было / стало, части, блокировки, вопросы Q)
и stage6-open-questions.csv (Q01–Q24, все открыты).
"""
import csv, json, os, sys

PN = {'rds': 'РДС', 'nek': 'НЭК', 'sepsis': 'Бактериальный сепсис'}
NORM = {'обязательно': 'обязательно', 'рекомендуется': 'рекомендуется', 'не_рекомендуется': 'не рекомендуется',
        'может_применяться': 'может применяться', 'противопоказано': 'противопоказано'}
BL = {'always': 'да, всегда', 'when': 'да, в описанной ситуации', 'no': 'нет'}
DECISION = 'Подтвердить / Исправить / Исключить'


def rows(db):
    rules, questions = [], []
    for r in db['rules']:
        p = db['protocols'][r['protocol']]
        e = p['edition']
        quotes = '\n'.join(f"стр. {q['page']}: «{q['text']}»" for q in r['source']['quotes'])
        ev = r['evidence_level']
        rules.append({
            'rule_id': r['rule_id'],
            'Протокол': f"{PN[r['protocol']]}, №{e['approval_no']} от {e['approval_date']}",
            'Раздел': r['source']['section'],
            'Цитата и страница': quotes,
            'Условие применения': r['applicability']['description'],
            'Требуемое действие / ограничение': r['requirement']['description'],
            'Класс (предварительно)': NORM[r['normativity']] + (' — нет модального слова' if 'без модального' in r['normativity_marker'] else ''),
            'Вид': r['kind'].replace('_', ' '),
            'Исключения и оговорки': '\n'.join(r['exceptions_and_caveats']),
            'Уровень доказательности': f"{ev['value']} (стр. {ev['source_page']})" if ev['value'] else 'не указан',
            'Вопросы эксперту': '; '.join(a['id'] for a in r['ambiguities']),
            'Решение эксперта': '',
            'Если «Исправить» — как': '',
            'Комментарий эксперта': '',
        })
        for a in r['ambiguities']:
            questions.append({'ID': a['id'], 'Тип': 'неоднозначность правила', 'Правила': r['rule_id'],
                              'Вопрос': a['text'], 'Блокирует оценку до решения': BL[a['blocking']],
                              'Цитаты': '', 'Решение эксперта': '', 'Комментарий эксперта': ''})
    for c in db.get('protocol_conflicts', []):
        questions.append({'ID': c['id'], 'Тип': c['type'].replace('_', ' '),
                          'Правила': ', '.join(c['rules'] + c.get('related_rules', [])),
                          'Вопрос': c['description'], 'Блокирует оценку до решения': 'показывается эксперту',
                          'Цитаты': '\n'.join(f"{PN[q['protocol']]}, стр. {q['page']}: «{q['text']}»" for q in c['quotes']),
                          'Решение эксперта': '', 'Комментарий эксперта': ''})
    return rules, questions


def write(path, data):
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(data[0]))
        w.writeheader()
        w.writerows(data)


def cond_text(n):
    if n is None:
        return ''
    if 'all' in n:
        return '(' + ' И '.join(cond_text(x) for x in n['all']) + ')'
    if 'any' in n:
        return '(' + ' ИЛИ '.join(cond_text(x) for x in n['any']) + ')'
    v = n.get('value')
    return f"{n['field']} {n['op']}" + ('' if v is None else f' {v}')


def stage6_rows(db, base, ed):
    dec = {d['rule_id']: d for d in ed['decisions']}
    qs = {}
    for q in ed['open_questions']:
        for r in q['rules']:
            qs.setdefault(r, []).append(q['id'])
    rows = []
    for r in db['rules']:
        b = base['rules'][r['rule_id']]
        d = dec[r['rule_id']]
        parts = r['requirement'].get('parts')
        now_check = '\n'.join(f"{p['part_id']}: {p['description']} — {cond_text(p['check'])}" + (f" [применимо: {cond_text(p['applicability']['condition'])}]" if p.get('applicability') else '') for p in parts) if parts else cond_text(r['requirement']['check'])
        old_ids = {a['id'] for a in b['ambiguities']}
        blk = [a for a in r['ambiguities'] if a['blocking'] != 'no']
        rows.append({
            'rule_id': r['rule_id'],
            'Круг 1': d['round1'],
            'Круг 2': (d['round2'] or {}).get('decision', '—'),
            'Изменено': 'нет (побайтово как в 2239c52)' if d['round1'] == 'Подтвердить' else 'да',
            'Было: применимость': cond_text(b['applicability']['condition']),
            'Было: проверка': cond_text(b['requirement'].get('check')),
            'Стало: применимость': cond_text(r['applicability']['condition']),
            'Стало: требование': r['requirement']['description'],
            'Стало: проверка / части': now_check,
            'Блокировки этапа 5': ', '.join(f"{a['id']} ({BL[a['blocking']]})" for a in blk if a['id'] in old_ids),
            'Новые блокировки': ', '.join(f"{a['id']} ({BL[a['blocking']]})" for a in blk if a['id'] not in old_ids),
            'Противоречия': ', '.join(r.get('protocol_conflicts', [])),
            'Вопросы Q (открыты)': ', '.join(qs.get(r['rule_id'], [])),
            'Подписи карточки': '\n'.join(c['label'] for c in r.get('card_labels', [])),
            'Новые цитаты': '\n'.join(f"стр. {q['page']}: «{q['text']}»" for q in r['source']['quotes'][len(b['quotes']):]),
            'Основание': ', '.join((r.get('revision') or {}).get('basis', [])),
            'Решение эксперта (3-й круг)': '',
            'Комментарий эксперта': '',
        })
    qrows = [{'ID': q['id'], 'Правила': ', '.join(q['rules']), 'Вопрос': q['question'], 'Режим до ответа': q['interim_mode'],
              'Статус': q['status'], 'Ответ эксперта': '', 'Источник ответа': '', 'Дата': ''} for q in ed['open_questions']]
    return rows, qrows


if __name__ == '__main__':
    if sys.argv[1] == '--stage6':
        db, base, ed = (json.load(open(x, encoding='utf-8')) for x in sys.argv[2:5])
        r, q = stage6_rows(db, base, ed)
        write(os.path.join(sys.argv[5], 'stage6-rules-revision.csv'), r)
        write(os.path.join(sys.argv[5], 'stage6-open-questions.csv'), q)
        print(len(r), len(q))
        sys.exit(0)
    db = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    r, q = rows(db)
    write(os.path.join(out, 'stage5-expert-review.csv'), r)
    write(os.path.join(out, 'stage5-expert-questions.csv'), q)
    print(len(r), len(q))
