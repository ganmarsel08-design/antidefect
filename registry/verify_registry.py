#!/usr/bin/env python3
"""Проверка реестра клинических протоколов (этап 4).

python3 registry/verify_registry.py registry/protocols-registry.json [путь/к/protocols.json]

Правила:
  1. Каждая запись содержит обязательные поля.
  2. Номер в шапке текста совпадает с номером в метаданных.
  3. Если номер найден в официальном источнике, он совпадает с номером в реестре.
  4. «действует» / «заменён» ставятся только при подтверждении эксперта
     (кто, когда, основание) и только для официально подтверждённых документов.
  5. «заменён» требует replaced_by и valid_to.
  6. Реестр «полный» только без пропущенных применимых протоколов и без неоценённой части.
  7. Если передан текст протоколов — хэш текста совпадает (текст не изменился после сверки).
Возвращает 0, если ошибок нет.
"""
import hashlib, json, sys

OFFICIAL = {'подтверждено_официальным_PDF', 'подтверждено_выдержкой_официального_сайта', 'подтверждено_протоколом_ОКК'}
ALL_RESULTS = OFFICIAL | {'документ_найден_шапка_не_прочитана', 'только_вторичный_источник', 'на_официальном_сайте_не_найдено'}
STATUSES = {'действует', 'заменён', 'не проверен'}
REQUIRED = ['id', 'name_in_base', 'approval', 'internal_check', 'official_check', 'registry_status', 'text_sha256']


def check(reg, texts=None):
    errors, warnings = [], []
    seen = set()
    for p in reg.get('protocols', []):
        pid = p.get('id', '?')
        for k in REQUIRED:
            if k not in p:
                errors.append(f'{pid}: нет поля {k}')
        if pid in seen:
            errors.append(f'{pid}: дубликат')
        seen.add(pid)
        oc = p.get('official_check', {})
        if oc.get('result') not in ALL_RESULTS:
            errors.append(f'{pid}: недопустимый результат сверки {oc.get("result")}')
        if not p.get('internal_check', {}).get('matches_metadata'):
            errors.append(f'{pid}: номер в шапке текста не совпадает с метаданными')
        if oc.get('official_no') and str(oc['official_no']) != str(p['approval']['no']):
            errors.append(f'{pid}: номер в официальном источнике {oc["official_no"]} ≠ {p["approval"]["no"]}')
        if oc.get('result') in OFFICIAL and not oc.get('url'):
            errors.append(f'{pid}: официальное подтверждение без ссылки')
        st = p.get('registry_status')
        if st not in STATUSES:
            errors.append(f'{pid}: недопустимый статус {st}')
        if st in ('действует', 'заменён'):
            ec = p.get('expert_confirmation') or {}
            if not (ec.get('by') and ec.get('at') and ec.get('basis')):
                errors.append(f'{pid}: статус «{st}» без подтверждения эксперта (кто, когда, основание)')
            if oc.get('result') not in OFFICIAL:
                errors.append(f'{pid}: статус «{st}» без официального подтверждения документа')
        if st == 'заменён' and not (p.get('replaced_by') and p.get('valid_to')):
            errors.append(f'{pid}: «заменён» без replaced_by и valid_to')
        if oc.get('result') == 'только_вторичный_источник':
            warnings.append(f'{pid}: подтверждён только вторичным источником')
        if texts is not None:
            t = texts.get(pid)
            if t is None:
                errors.append(f'{pid}: нет текста протокола в базе')
            elif hashlib.sha256(t.encode()).hexdigest() != p.get('text_sha256'):
                errors.append(f'{pid}: текст протокола изменился после сверки (хэш не совпадает)')
    comp = reg.get('completeness', {})
    if comp.get('state') == 'полный' and (comp.get('applicable_not_in_registry') or comp.get('not_assessed')):
        errors.append('реестр помечен «полный», но есть пропущенные или неоценённые применимые протоколы')
    if comp.get('state') not in ('полный', 'неполный'):
        errors.append('completeness.state: полный или неполный')
    return errors, warnings


def coverage(reg):
    """Сведения о полноте для модуля отклонений (protocol_check.registry_coverage)."""
    comp = reg.get('completeness', {})
    missing = [m['title'] for m in comp.get('applicable_not_in_registry', [])]
    if comp.get('not_assessed'):
        missing.append('полный перечень P00–P96 не оценён')
    return {'total': len(reg.get('protocols', [])), 'missing_applicable': missing}


def load_texts(path):
    items = json.load(open(path, encoding='utf-8'))['items']
    return {x['id']: ''.join(s['t'] for s in x['sections']) for x in items}


if __name__ == '__main__':
    reg = json.load(open(sys.argv[1], encoding='utf-8'))
    texts = load_texts(sys.argv[2]) if len(sys.argv) > 2 else None
    errs, warns = check(reg, texts)
    from collections import Counter
    c = Counter(p['official_check']['result'] for p in reg['protocols'])
    s = Counter(p['registry_status'] for p in reg['protocols'])
    print('Протоколов:', len(reg['protocols']))
    for k, v in c.most_common():
        print(f'  {k}: {v}')
    print('Статусы:', dict(s))
    print('Полнота:', reg['completeness']['state'], '| для модуля:', coverage(reg))
    for w in warns:
        print('предупреждение:', w)
    for e in errs:
        print('ОШИБКА:', e)
    print('Ошибок:', len(errs))
    sys.exit(1 if errs else 0)
