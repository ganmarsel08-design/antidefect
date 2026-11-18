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
  8. doc_id уникален; номер заседания ОКК идентификатором не считается (может повторяться).
  9. Тип протокола: диагностика_и_лечение / медицинское_вмешательство / реабилитация / не_установлен.
 10. «действует» дополнительно требует проверки актуальности (currency_check) с основанием:
     ни ссылка, ни подтверждение эксперта по отдельности недостаточны.
 11. local_pdf (локальный PDF пользователя): SHA-256 по байтам (64 hex), origin=user_upload,
     шапка совпадает с номером, датой и типом записи; хэш не совпадает с хэшами текста;
     один файл не привязан к двум записям; тождество официальному файлу не заявляется,
     пока не совпал file_checksum официального файла. Локальный PDF не делает статус «действует».
 12. --pdf-dir ПАПКА: пересчитать SHA-256 и размер каждого local_pdf; нет файла — ошибка.
 13. Коды МКБ с кириллической «Р» — предупреждение (сопоставление по коду может не сработать).
Возвращает 0, если ошибок нет.
"""
import hashlib, json, os, re, sys

OFFICIAL = {'подтверждено_официальным_PDF', 'подтверждено_выдержкой_официального_сайта', 'подтверждено_протоколом_ОКК'}
ALL_RESULTS = OFFICIAL | {'официальный_источник_найден_файл_не_верифицирован', 'документ_найден_шапка_не_прочитана', 'только_вторичный_источник', 'на_официальном_сайте_не_найдено'}
STATUSES = {'действует', 'заменён', 'не проверен'}
REQUIRED = ['id', 'doc_id', 'name_in_base', 'approval', 'protocol_type', 'internal_check', 'official_check', 'currency_check', 'registry_status', 'text_sha256']
TYPES = {'диагностика_и_лечение', 'медицинское_вмешательство', 'реабилитация', 'не_установлен'}
CURRENCY_OK = 'новее_редакции_не_найдено'


SHA_RE = re.compile(r'^[0-9a-f]{64}$')


def check_local_pdf(p, seen_sha, pdf_dir=None):
    pid, lp, errors = p.get('id', '?'), p.get('local_pdf'), []
    if not lp:
        return errors
    sha = lp.get('sha256') or ''
    if not SHA_RE.match(sha):
        errors.append(f'{pid}: local_pdf.sha256 — не SHA-256 байтов файла')
    if lp.get('sha256_source') != 'байты локального PDF-файла':
        errors.append(f'{pid}: local_pdf.sha256 должен быть вычислен по байтам PDF')
    if lp.get('origin') != 'user_upload':
        errors.append(f'{pid}: local_pdf.origin должен быть user_upload')
    oc = p.get('official_check') or {}
    if sha and sha in (p.get('text_sha256'), oc.get('quote_sha256')):
        errors.append(f'{pid}: хэш локального PDF совпадает с хэшем текста — подмена недопустима')
    if sha in seen_sha:
        errors.append(f'{pid}: один и тот же PDF ({sha[:12]}…) привязан к нескольким записям ({seen_sha[sha]})')
    seen_sha.setdefault(sha, pid)
    h = lp.get('header') or {}
    if lp.get('verified_header'):
        if str(h.get('approval_no')) != str(p['approval']['no']) or h.get('approval_date') != p['approval'].get('date_iso'):
            errors.append(f'{pid}: шапка локального PDF (№{h.get("approval_no")} от {h.get("approval_date")}) не совпадает с записью')
        if h.get('protocol_type') != p.get('protocol_type'):
            errors.append(f'{pid}: тип в шапке PDF «{h.get("protocol_type")}» ≠ тип записи «{p.get("protocol_type")}»')
    fc = p.get('file_checksum') or {}
    if lp.get('identity_with_official_file') != 'не установлено' and fc.get('value') != sha:
        errors.append(f'{pid}: тождество официальному файлу заявлено без совпадения SHA-256 официального файла')
    if pdf_dir is not None:
        f = os.path.join(pdf_dir, lp.get('file_name') or '')
        if not os.path.isfile(f):
            errors.append(f'{pid}: оригинал локального PDF отсутствует: {lp.get("file_name")}')
        else:
            b = open(f, 'rb').read()
            if hashlib.sha256(b).hexdigest() != sha:
                errors.append(f'{pid}: SHA-256 файла {lp.get("file_name")} не совпадает с реестром')
            if len(b) != lp.get('byte_size'):
                errors.append(f'{pid}: размер файла {lp.get("file_name")} не совпадает с реестром')
    return errors


def check(reg, texts=None, pdf_dir=None):
    errors, warnings = [], []
    seen, seen_doc, seen_sha = set(), set(), {}
    for p in reg.get('protocols', []):
        pid = p.get('id', '?')
        if p.get('doc_id') in seen_doc:
            errors.append(f'{pid}: doc_id не уникален')
        seen_doc.add(p.get('doc_id'))
        if p.get('protocol_type') not in TYPES:
            errors.append(f'{pid}: недопустимый тип протокола {p.get("protocol_type")}')
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
        if st == 'действует':
            cc = p.get('currency_check') or {}
            if cc.get('result') != CURRENCY_OK or not cc.get('basis'):
                errors.append(f'{pid}: «действует» без проверки актуальности редакции (ссылки и подтверждения эксперта недостаточно)')
        if st == 'заменён' and not (p.get('replaced_by') and p.get('valid_to')):
            errors.append(f'{pid}: «заменён» без replaced_by и valid_to')
        rc = p.get('reviewer_claim')
        if rc and str(rc.get('status', '')).startswith('не подтверждено') and oc.get('result') in OFFICIAL:
            errors.append(f'{pid}: заявление проверяющего не подтверждено, а результат сверки официальный')
        if rc and rc.get('local_document_sha256') and rc['local_document_sha256'] != (p.get('local_pdf') or {}).get('sha256'):
            errors.append(f'{pid}: заявление проверяющего ссылается на локальный документ, которого нет в local_pdf')
        if rc and 'побайтово совпадает' in str(rc.get('status', '')) and not (p.get('file_checksum') or {}).get('value'):
            errors.append(f'{pid}: заявлено побайтовое совпадение с официальным PDF без хэша официального файла')
        fc = p.get('file_checksum') or {}
        if fc.get('value'):
            if fc.get('source') != 'байты PDF-файла' or not fc.get('downloaded_from'):
                errors.append(f'{pid}: хэш файла должен быть вычислен по байтам скачанного PDF (source, downloaded_from)')
            if fc['value'] in (oc.get('quote_sha256'), p.get('text_sha256')):
                errors.append(f'{pid}: хэш файла совпадает с хэшем текста — подмена недопустима')
        errors.extend(check_local_pdf(p, seen_sha, pdf_dir))
        if any('Р' in str(c) for c in p.get('icd') or []):
            warnings.append(f'{pid}: в кодах МКБ кириллическая «Р» вместо латинской P')
        if oc.get('result') == 'только_вторичный_источник':
            warnings.append(f'{pid}: подтверждён только вторичным источником')
        if texts is not None:
            t = texts.get(pid)
            if t is None and p.get('in_neo_pro_base') is False:
                pass  # новая редакция, текста которой нет в базе neo-pro
            elif t is None:
                errors.append(f'{pid}: нет текста протокола в базе')
            elif p.get('text_sha256') is None and p.get('in_neo_pro_base') is False:
                pass  # новая редакция, текста которой нет в базе
            elif hashlib.sha256(t.encode()).hexdigest() != p.get('text_sha256'):
                errors.append(f'{pid}: текст протокола изменился после сверки (хэш не совпадает)')
    comp = reg.get('completeness', {})
    if comp.get('state') == 'полный' and (comp.get('applicable_not_in_registry') or comp.get('not_assessed')):
        errors.append('реестр помечен «полный», но есть пропущенные или неоценённые применимые протоколы')
    if comp.get('state') not in ('полный', 'неполный'):
        errors.append('completeness.state: полный или неполный')
    return errors, warnings


def editions_for(reg, topic, care_date):
    """Редакции по теме, одобренные не позднее даты помощи (YYYY-MM-DD), новые первыми.
    Без проверенной истории редакций ни одна не считается заменённой."""
    eds = [p for p in reg['protocols'] if p.get('topic') == topic and p['approval']['date_iso'] <= care_date]
    eds.sort(key=lambda p: p['approval']['date_iso'], reverse=True)
    return [{'doc_id': p['doc_id'], 'approved': p['approval']['date_iso'], 'registry_status': p['registry_status'],
             'history_verified': bool(p.get('edition_history_verified')),
             'replaced': p['registry_status'] == 'заменён' and bool(p.get('valid_to')) and p['valid_to'] <= care_date}
            for p in eds]


def engine_entry(p):
    """Запись протокола для protocol_check.searched модуля отклонений."""
    return {'doc_id': p['doc_id'], 'protocol_no': str(p['approval']['no']), 'protocol_type': p['protocol_type'],
            'registry_status': p['registry_status'], 'official_evidence': p['official_check']['result'],
            'currency_verified': (p.get('currency_check') or {}).get('result') == CURRENCY_OK}


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
    args = sys.argv[1:]
    pdf_dir = None
    if '--pdf-dir' in args:
        i = args.index('--pdf-dir'); pdf_dir = args[i + 1]; del args[i:i + 2]
    reg = json.load(open(args[0], encoding='utf-8'))
    texts = load_texts(args[1]) if len(args) > 1 else None
    errs, warns = check(reg, texts, pdf_dir)
    from collections import Counter
    c = Counter(p['official_check']['result'] for p in reg['protocols'])
    s = Counter(p['registry_status'] for p in reg['protocols'])
    print('Протоколов:', len(reg['protocols']))
    for k, v in c.most_common():
        print(f'  {k}: {v}')
    print('Статусы:', dict(s))
    print('Типы:', dict(Counter(p['protocol_type'] for p in reg['protocols'])))
    lp = [p for p in reg['protocols'] if p.get('local_pdf')]
    print('Локальных PDF:', len(lp), '| проверка файлов:', 'да, ' + pdf_dir if pdf_dir else 'нет (--pdf-dir не указан)')
    print('Полнота:', reg['completeness']['state'], '| для модуля:', coverage(reg))
    for w in warns:
        print('предупреждение:', w)
    for e in errs:
        print('ОШИБКА:', e)
    print('Ошибок:', len(errs))
    sys.exit(1 if errs else 0)
