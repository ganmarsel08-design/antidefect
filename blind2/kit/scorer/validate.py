#!/usr/bin/env python3
"""Антидефект — слепое тестирование №1. ФОРМАЛЬНАЯ проверка архива до заморозки (раздел 2, шаг 3 метода 1.1).

Проверяется только форма: схема, идентификаторы, ссылки, типы и допустимые значения, дословное наличие цитат
в указанном месте файла (DOCX читается НЕЗАВИСИМО от программы: zipfile + ElementTree), согласованность эталона
чтения DOCX с XML документа, минимумы набора. Содержание эталона не оценивается и не исправляется.

python3 -I validate.py --input <распакованный архив> --dict <pilot-rules.json> --sets <field-sets.json> [--technical-test]
Код выхода 0 — замечаний нет; 1 — есть замечания (архив возвращается автору).
"""
import argparse, json, re, sys, zipfile, unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
LOCS = {'body', 'table', 'textbox', 'image', 'embedded_object', 'header', 'footer', 'footnote', 'endnote', 'comment'}
TRAP_TYPES = {'negation', 'plan', 'conditional', 'mother', 'other_patient', 'other_protocol_mention', 'past_history', 'duplicate_copy',
              'corrected_record', 'unit_not_field_unit', 'dose_without_unit', 'time_without_date', 'date_without_time', 'relative_time',
              'midnight_crossing', 'document_time_as_event', 'abbreviation', 'typo', 'latin_cyrillic_mix', 'reference_range', 'template_placeholder', 'deleted_tracked_text'}
BASIS = {'explicit', 'date_from_heading', 'relative_computed', 'date_only', None}
# 1.5 (набор №2): тип времени — время события или время документа (записи); см. blind2/kit/CHANGES-1.4-1.5.md
# Единственный вариант: время записи НЕ размечается действующим фактом (ни с какой меткой); ловушка document_time_as_event.
TIME_KIND = {'event_time', None}
DT = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d\+05:00$')
IDS = ['СЛП-РДС-0%d' % i for i in range(1, 6)] + ['СЛП-НЭК-0%d' % i for i in range(1, 6)] + ['СЛП-СЕП-0%d' % i for i in range(1, 6)]
DOCX_IDS = {'СЛП-РДС-01', 'СЛП-РДС-02', 'СЛП-РДС-03', 'СЛП-НЭК-01', 'СЛП-НЭК-02', 'СЛП-НЭК-03', 'СЛП-НЭК-04', 'СЛП-СЕП-01', 'СЛП-СЕП-02', 'СЛП-СЕП-03'}


def para_text(p, deleted=False):
    """Текст абзаца без вложенных надписей (их текст относится к месту textbox)."""
    out = []
    def rec(el):
        for ch in el:
            if ch.tag == W + 'txbxContent':
                continue
            if ch.tag == W + 't' and not deleted:
                out.append(ch.text or '')
            elif ch.tag == W + 'delText' and deleted:
                out.append(ch.text or '')
            elif ch.tag == W + 'tab' and not deleted:
                out.append('\t')
            elif ch.tag in (W + 'br', W + 'cr') and not deleted:
                out.append('\n')
            rec(ch)
    rec(p)
    return ''.join(out)


MC_FALLBACK = '{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback'
SKIP_NOTE = {'separator', 'continuationSeparator', 'continuationNotice'}


def docx_parts(path):
    """Независимое чтение DOCX (метод 1.3, раздел 3; без изменений с 1.2).

    body_blocks — основной текст ПО ПОРЯДКУ: ('paragraph', текст) | ('table', [[текст ячейки]]); ячейка = её абзацы через \n.
    textbox/header/footer/footnote/endnote/comment — по одной записи на элемент (абзацы через \n), пустые пропускаются;
    image/embedded_object — число элементов (текст на картинке машинно не проверяется); deleted — удалённый текст.
    Ветки mc:Fallback (дубликаты VML) не учитываются."""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    root = ET.fromstring(z.read('word/document.xml'))
    parent = {c: p for p in root.iter() for c in p}
    def in_fallback(el):
        while el in parent:
            el = parent[el]
            if el.tag == MC_FALLBACK:
                return True
        return False
    body = root.find(W + 'body')
    res = {k: [] for k in LOCS}
    res['deleted'] = []
    res['body_blocks'] = []
    tbx_paras = set()
    for t in root.iter(W + 'txbxContent'):
        for p in t.iter(W + 'p'):
            tbx_paras.add(p)
        if not in_fallback(t):
            txt = '\n'.join(para_text(p) for p in t.iter(W + 'p'))
            if txt.strip():
                res['textbox'].append(txt)
    res['_count'] = {
        'image': sum(1 for e in root.iter() if e.tag in (W + 'drawing', W + 'pict') and not in_fallback(e) and not any(x.tag == W + 'txbxContent' for x in e.iter())),
        'embedded_object': sum(1 for e in root.iter() if e.tag == W + 'object' and not in_fallback(e)),
    }
    def cell_text(tc):
        return '\n'.join(para_text(p) for p in tc.iter(W + 'p') if p not in tbx_paras)
    def walk(el):
        for ch in el:
            if ch.tag == W + 'p':
                t = para_text(ch)
                res['body_blocks'].append(('paragraph', t)); res['body'].append(t)
                d = para_text(ch, deleted=True)
                if d:
                    res['deleted'].append(d)
            elif ch.tag == W + 'tbl':
                rows = []
                for tr in ch.findall(W + 'tr'):
                    rows.append([cell_text(tc) for tc in tr.findall(W + 'tc')])
                    for tc in tr.findall(W + 'tc'):
                        for p in tc.iter(W + 'p'):
                            if p not in tbx_paras:
                                res['table'].append(para_text(p))
                                d = para_text(p, deleted=True)
                                if d:
                                    res['deleted'].append(d)
                res['body_blocks'].append(('table', rows))
            elif ch.tag in (W + 'sdt', W + 'sdtContent', W + 'customXml'):
                walk(ch)
    walk(body)
    for n in sorted(names):
        kind = 'header' if re.match(r'word/header\d*\.xml$', n) else 'footer' if re.match(r'word/footer\d*\.xml$', n) else \
            'footnote' if n == 'word/footnotes.xml' else 'endnote' if n == 'word/endnotes.xml' else 'comment' if n == 'word/comments.xml' else None
        if not kind:
            continue
        r = ET.fromstring(z.read(n))
        if kind in ('header', 'footer'):
            items = [r]
        else:
            tag = {'footnote': 'footnote', 'endnote': 'endnote', 'comment': 'comment'}[kind]
            items = [e for e in r.findall(W + tag) if e.get(W + 'type') not in SKIP_NOTE]
        for it in items:
            txt = '\n'.join(para_text(p) for p in it.iter(W + 'p'))
            if txt.strip():
                res[kind].append(txt)
    return res


def norm_ws(s):
    return ' '.join(nfc(str(s)).split())


def check_reading_reference(hid, r, parts, E):
    """Эталон чтения ↔ независимое чтение XML: порядок и содержание основного текста, полнота и содержание доп. элементов."""
    ref_blocks = r.get('body', [])
    xb = parts['body_blocks']
    if len(ref_blocks) != len(xb):
        E(f'{hid}: число блоков основного текста в эталоне чтения ({len(ref_blocks)}) не равно XML ({len(xb)})')
    for i, (rb, x) in enumerate(zip(ref_blocks, xb)):
        if rb.get('kind') != x[0]:
            E(f'{hid}: блок {i + 1}: в эталоне чтения {rb.get("kind")}, в XML {x[0]} (нарушен порядок абзацев и таблиц)'); break
        if x[0] == 'paragraph' and nfc(rb.get('text', '')) != nfc(x[1]):
            E(f'{hid}: блок {i + 1}: текст абзаца не совпадает с XML'); break
        if x[0] == 'table' and [[norm_ws(c) for c in row] for row in rb.get('rows', [])] != [[norm_ws(c) for c in row] for row in x[1]]:
            E(f'{hid}: блок {i + 1}: таблица не совпадает с XML (строки, ячейки или их порядок)'); break
    ref_un = {}
    for u in r.get('unread', []):
        ref_un.setdefault(u.get('type'), []).append(u.get('text', ''))
    for t in ('textbox', 'header', 'footer', 'footnote', 'endnote', 'comment'):
        a = sorted(norm_ws(x) for x in ref_un.get(t, []))
        b = sorted(norm_ws(x) for x in parts[t])
        if a != b:
            miss = [x for x in b if x not in a]; extra = [x for x in a if x not in b]
            E(f'{hid}: элементы «{t}»: в XML {len(b)}, в эталоне чтения {len(a)}' + (f'; нет в эталоне: «{miss[0][:50]}»' if miss else '') + (f'; нет в XML: «{extra[0][:50]}»' if extra else ''))
    for t in ('image', 'embedded_object'):
        if len(ref_un.get(t, [])) != parts['_count'][t]:
            E(f'{hid}: элементы «{t}»: в XML {parts["_count"][t]}, в эталоне чтения {len(ref_un.get(t, []))}')
    if ''.join(''.join(r.get('deleted', [])).split()) != ''.join(''.join(parts['deleted']).split()):
        E(f'{hid}: удалённый текст эталона чтения не совпадает с XML')
    unknown = set(ref_un) - (LOCS - {'body', 'table'})
    if unknown:
        E(f'{hid}: неизвестные типы элементов в эталоне чтения: {sorted(unknown)}')


def nfc(s):
    return unicodedata.normalize('NFC', s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--dict', required=True)
    ap.add_argument('--sets', required=True)
    ap.add_argument('--technical-test', action='store_true')
    a = ap.parse_args()
    inp = Path(a.input)
    dd = json.load(open(a.dict, encoding='utf-8'))['data_dictionary']
    sets = json.load(open(a.sets, encoding='utf-8'))
    allowed = set(sets['partA']) | set(sets['partB'])
    errs, warns = [], []
    E = errs.append
    try:
        g = json.load(open(inp / 'blind1-gold.json', encoding='utf-8'))
    except Exception as e:
        print('ОШИБКА: blind1-gold.json не читается:', e); sys.exit(1)
    if g.get('schema') != 'blind1-gold-1.1':
        E('schema должна быть blind1-gold-1.1')
    if g.get('facility_utc_offset') != '+05:00':
        E('facility_utc_offset должен быть +05:00')
    hs = g.get('histories', [])
    ids = [h.get('id') for h in hs]
    if not a.technical_test and sorted(ids) != sorted(IDS):
        E('состав историй не совпадает с заданием: %s' % ids)
    seen = set()
    counts = {'trap': {}, 'docx_unread_types': set(), 'docx_with_unread': 0, 'docx_without_unread': 0, 'docx_unread_with_facts': 0, 'docx_deleted': 0}
    for h in hs:
        hid = h.get('id')
        fmt = h.get('format')
        if not a.technical_test and (fmt == 'docx') != (hid in DOCX_IDS):
            E(f'{hid}: формат {fmt} не совпадает с заданием')
        fp = inp / 'histories' / str(h.get('file'))
        if not fp.exists():
            E(f'{hid}: нет файла {fp.name}'); continue
        if fmt == 'txt':
            raw = fp.read_bytes()
            try:
                txt = raw.decode('utf-8')
            except UnicodeDecodeError:
                E(f'{hid}: TXT не в UTF-8'); continue
            txt = txt.lstrip('\ufeff').replace('\r\n', '\n').replace('\r', '\n')
            where = lambda loc: [txt] if loc == 'body' else []
        else:
            try:
                parts = docx_parts(fp)
            except Exception as e:
                E(f'{hid}: DOCX не читается независимым чтением: {e}'); continue
            where = lambda loc, parts=parts: parts.get(loc, [])
            ref = inp / 'docx-text' / f'{hid}.json'
            if not ref.exists():
                E(f'{hid}: нет эталона чтения docx-text/{hid}.json')
            else:
                r = json.load(open(ref, encoding='utf-8'))
                check_reading_reference(hid, r, parts, E)
                types = {u.get('type') for u in r.get('unread', [])}
                if types:
                    counts['docx_with_unread'] += 1
                else:
                    counts['docx_without_unread'] += 1
                counts['docx_unread_types'] |= types
                if parts['deleted']:
                    counts['docx_deleted'] += 1
        def has_quote(q, loc):
            if loc in ('image', 'embedded_object'):
                return None
            return any(nfc(q) in nfc(x) for x in where(loc))
        fids = set()
        for f in h.get('facts', []):
            fid = f.get('fid')
            if fid in seen:
                E(f'{hid}: повтор идентификатора {fid}')
            seen.add(fid); fids.add(fid)
            fld = f.get('field')
            if fld not in allowed:
                E(f'{hid}/{fid}: поле {fld} не из словаря'); continue
            if f.get('location') not in LOCS or (fmt == 'txt' and f.get('location') != 'body'):
                E(f'{hid}/{fid}: недопустимое место {f.get("location")}')
            if f.get('time_kind') not in TIME_KIND:
                E(f'{hid}/{fid}: недопустимое time_kind (допустимо только event_time; время записи не размечается фактом — используйте ловушку document_time_as_event)')
            # 1.5: у временных фактов (дата-время, дата, элементы списков, динамика пассажа) тип времени обязателен; у прочих — не указывается
            _tt = dd[fld]['type'] in ('datetime', 'date', 'list') or fld == 'gi_passage_restored'
            if f.get('record_status') == 'current' and f.get('value') is not None:
                if _tt and f.get('time_kind') is None:
                    E(f'{hid}/{fid}: у временного факта {fld} не указан time_kind (event_time / document_time)')
            if not _tt and f.get('time_kind') is not None:
                E(f'{hid}/{fid}: time_kind указан у невременного поля {fld}')
            if f.get('time_basis') not in BASIS:
                E(f'{hid}/{fid}: недопустимое time_basis')
            if f.get('record_status') not in ('current', 'superseded'):
                E(f'{hid}/{fid}: record_status должен быть current или superseded')
            t = dd[fld]['type']; v = f.get('value')
            if v is not None:
                ok = {'number': lambda: isinstance(v, (int, float)) and not isinstance(v, bool), 'tri': lambda: isinstance(v, bool),
                      'datetime': lambda: isinstance(v, str) and bool(DT.match(v)), 'date': lambda: isinstance(v, str) and bool(re.match(r'^\d{4}-\d\d-\d\d$', v)),
                      'enum': lambda: v in dd[fld].get('values', [v]), 'text': lambda: isinstance(v, str),
                      'list': lambda: isinstance(v, (dict, list)), 'object': lambda: isinstance(v, dict)}.get(t, lambda: True)()
                if not ok:
                    E(f'{hid}/{fid}: значение {v!r} не соответствует типу {t} поля {fld}')
            elif t not in ('datetime',):
                E(f'{hid}/{fid}: value null допустим только для дата-времени без времени')
            for k in ('event_at',):
                if f.get(k) and not DT.match(f[k]):
                    E(f'{hid}/{fid}: {k} не в формате YYYY-MM-DDTHH:MM+05:00')
            q = f.get('quote') or ''
            hq = has_quote(q, f.get('location'))
            if hq is False:
                E(f'{hid}/{fid}: цитата не найдена в месте {f.get("location")}: «{q[:60]}»')
            elif hq is None:
                warns.append(f'{hid}/{fid}: цитата в {f.get("location")} — машинно не проверяема')
        for f in h.get('facts', []):
            for k in ('same_as', 'superseded_by'):
                if f.get(k) and f[k] not in fids:
                    E(f'{hid}/{f.get("fid")}: {k} ссылается на несуществующий {f[k]}')
            if f.get('record_status') == 'superseded' and not f.get('superseded_by'):
                E(f'{hid}/{f.get("fid")}: superseded без superseded_by')
        for t in h.get('traps', []):
            if t.get('tid') in seen:
                E(f'{hid}: повтор идентификатора {t.get("tid")}')
            seen.add(t.get('tid'))
            if t.get('type') not in TRAP_TYPES:
                E(f'{hid}/{t.get("tid")}: неизвестный тип ловушки {t.get("type")}')
            counts['trap'][t.get('type')] = counts['trap'].get(t.get('type'), 0) + 1
            if t.get('field') and t['field'] not in allowed:
                E(f'{hid}/{t.get("tid")}: поле {t["field"]} не из словаря')
            loc = t.get('location', 'body')
            if t.get('type') == 'deleted_tracked_text':
                ok = fmt == 'docx' and any(nfc(t.get('quote', '')) in nfc(x) for x in parts['deleted'])
                if not ok:
                    E(f'{hid}/{t.get("tid")}: удалённый текст не найден в XML')
            elif has_quote(t.get('quote', ''), loc) is False:
                E(f'{hid}/{t.get("tid")}: цитата ловушки не найдена в месте {loc}')
            if t.get('type') == 'document_time_as_event':
                if (dd.get(t.get('field')) or {}).get('type') not in ('datetime', 'date'):
                    E(f'{hid}/{t.get("tid")}: document_time_as_event — только для поля даты-времени')
                if t.get('must_not_value') != 'any':
                    E(f'{hid}/{t.get("tid")}: document_time_as_event — must_not_value должен быть "any"')
            # 1.5: ловушка «никакого значения» не может противоречить действующему факту того же поля из той же цитаты
            if t.get('must_not_value') == 'any' and t.get('field'):
                for f in h.get('facts', []):
                    if f.get('field') == t['field'] and f.get('record_status') != 'superseded' and f.get('value') is not None \
                            and (nfc(f.get('quote', '')) in nfc(t.get('quote', '')) or nfc(t.get('quote', '')) in nfc(f.get('quote', ''))):
                        E(f'{hid}/{t.get("tid")}: must_not_value="any" противоречит действующему факту {f.get("fid")} ({t["field"]}) из той же цитаты')
        for u in h.get('unread_elements', []):
            if u.get('type') not in LOCS - {'body', 'table'}:
                E(f'{hid}/{u.get("ueid")}: недопустимый тип элемента')
            if any(x not in fids for x in u.get('fids', [])):
                E(f'{hid}/{u.get("ueid")}: ссылка на несуществующий факт')
            if u.get('fids') and set(sets['partA']) & {f['field'] for f in h.get('facts', []) if f.get('fid') in u['fids']}:
                counts['docx_unread_with_facts'] += 1
        for m in h.get('missing_clinical', []):
            if m.get('mid') in seen:
                E(f'{hid}: повтор идентификатора {m.get("mid")}')
            seen.add(m.get('mid'))
    if not a.technical_test:
        mins = {'negation': 12, 'plan': 3, 'conditional': 3, 'mother': 3, 'corrected_record': 4, 'duplicate_copy': 4, 'dose_without_unit': 3,
                'unit_not_field_unit': 5, 'time_without_date': 5, 'date_without_time': 3, 'relative_time': 3, 'midnight_crossing': 2,
                'abbreviation': 12, 'reference_range': 3, 'template_placeholder': 2, 'deleted_tracked_text': 1}
        for k, n in mins.items():
            if counts['trap'].get(k, 0) < n:
                warns.append(f'минимум не выполнен: {k} — {counts["trap"].get(k, 0)} из {n}')
        if counts['docx_with_unread'] < 6 or len(counts['docx_unread_types']) < 5 or counts['docx_without_unread'] < 2 or counts['docx_unread_with_facts'] < 4:
            warns.append(f'требования к DOCX не выполнены: {counts["docx_with_unread"]} с непрочитываемыми, типов {len(counts["docx_unread_types"])}, без них {counts["docx_without_unread"]}, с фактами {counts["docx_unread_with_facts"]}')
    out = {'errors': errs, 'warnings': warns, 'counts': {**counts, 'docx_unread_types': sorted(counts['docx_unread_types'])}}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
