#!/usr/bin/env python3
"""Таблица для врача-эксперта из rules/pilot-rules.json.

python3 rules/export_expert_review.py rules/pilot-rules.json docs/
Создаёт stage5-expert-review.csv (30 правил) и stage5-expert-questions.csv
(вопросы по неоднозначностям и расхождениям протоколов). Решения эксперта
в эти файлы вписываются вручную и затем переносятся в базу отдельным PR.
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


if __name__ == '__main__':
    db = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    r, q = rows(db)
    write(os.path.join(out, 'stage5-expert-review.csv'), r)
    write(os.path.join(out, 'stage5-expert-questions.csv'), q)
    print(len(r), len(q))
