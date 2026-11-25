#!/usr/bin/env python3
"""Технический искусственный пример для проверки оценщика (НЕ клиническая история, НЕ слепой набор).
Создаёт tech/histories/ТЕХ-01.txt, ТЕХ-02.docx (абзац, таблица, надпись, сноска, колонтитул, примечание, удалённый текст),
tech/docx-text/ТЕХ-02.json и tech/blind1-gold.json."""
import json, zipfile
from pathlib import Path
D = Path(__file__).parent / 'tech'
txt = '\n'.join([
    'ТЕХНИЧЕСКИЙ ПРИМЕР ТЕХ-01 (не история болезни)',
    'Срок гестации 29 недель. Масса при рождении 1250 г.',
    'Сурфактант в родильном зале не вводился.',
    '10.01.2026 08:00 — кровь на посев взята',
    'Планируется: гентамицин 7 мг при ухудшении.',
])
(D / 'histories' / 'ТЕХ-01.txt').write_bytes(('﻿' + txt.replace('\n', '\r\n')).encode('utf-8'))
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"'
P = lambda t: f'<w:p><w:r><w:t xml:space="preserve">{t}</w:t></w:r></w:p>'
doc = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document {W}><w:body>
{P('ТЕХНИЧЕСКИЙ ПРИМЕР ТЕХ-02')}
{P('Срок гестации 31 недель.')}
<w:p><w:r><w:t xml:space="preserve">Масса при рождении 1600 г.</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
<w:tbl><w:tr><w:tc>{P('Показатель')}</w:tc><w:tc>{P('Значение')}</w:tc></w:tr><w:tr><w:tc>{P('Сурфактант')}</w:tc><w:tc>{P('Сурфактант в родильном зале не вводился')}</w:tc></w:tr></w:tbl>
<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>{P('надпись: доза 77 мг')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>
<w:p><w:del w:id="5" w:author="x"><w:r><w:delText>Срок гестации 25 недель.</w:delText></w:r></w:del><w:r><w:t xml:space="preserve">Конец.</w:t></w:r></w:p>
<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Комментарий к этому.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>
</w:body></w:document>'''
fn = f'<?xml version="1.0" encoding="UTF-8"?><w:footnotes {W}><w:footnote w:id="1">{P("сноска: кровь взята 11.01.2026 09:15")}</w:footnote></w:footnotes>'
hd = f'<?xml version="1.0" encoding="UTF-8"?><w:hdr {W}>{P("колонтитул: масса 1,6 кг")}</w:hdr>'
cm = f'<?xml version="1.0" encoding="UTF-8"?><w:comments {W}><w:comment w:id="0" w:author="x">{P("примечание рецензента")}</w:comment></w:comments>'
ct = '''<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'''
rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
drels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>'
with zipfile.ZipFile(D / 'histories' / 'ТЕХ-02.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    for n, s in [('[Content_Types].xml', ct), ('_rels/.rels', rels), ('word/_rels/document.xml.rels', drels), ('word/document.xml', doc),
                 ('word/footnotes.xml', fn), ('word/header1.xml', hd), ('word/comments.xml', cm)]:
        z.writestr(zipfile.ZipInfo(n, (2026, 1, 1, 0, 0, 0)), s)
ref = {'body': [{'kind': 'paragraph', 'text': 'ТЕХНИЧЕСКИЙ ПРИМЕР ТЕХ-02'}, {'kind': 'paragraph', 'text': 'Срок гестации 31 недель.'}, {'kind': 'paragraph', 'text': 'Масса при рождении 1600 г.'},
                {'kind': 'table', 'rows': [['Показатель', 'Значение'], ['Сурфактант', 'Сурфактант в родильном зале не вводился']]},
                {'kind': 'paragraph', 'text': ''}, {'kind': 'paragraph', 'text': 'Конец.'}, {'kind': 'paragraph', 'text': 'Комментарий к этому.'}],
       'unread': [{'type': 'textbox', 'text': 'надпись: доза 77 мг'}, {'type': 'footnote', 'text': 'сноска: кровь взята 11.01.2026 09:15'},
                  {'type': 'header', 'text': 'колонтитул: масса 1,6 кг'}, {'type': 'comment', 'text': 'примечание рецензента'}],
       'deleted': ['Срок гестации 25 недель.']}
(D / 'docx-text' / 'ТЕХ-02.json').write_text(json.dumps(ref, ensure_ascii=False, indent=1), encoding='utf-8')
F = lambda fid, field, value, quote, loc='body', **k: dict(dict(fid=fid, field=field, value=value, unit_as_written=None, time_basis=None, event_at=None, event_date=None, quote=quote, location=loc,
                                                       record_status='current', superseded_by=None, same_as=None, primary=None, note=''), **k)
gold = {'schema': 'blind1-gold-1.1', 'facility_utc_offset': '+05:00', 'author': 'технический пример оценщика', 'created_at': '2026-11-21T01:00+05:00', 'histories': [
    {'id': 'ТЕХ-01', 'protocol': 'РДС', 'file': 'ТЕХ-01.txt', 'format': 'txt', 'design': {'intent': 'технический'},
     'facts': [F('Т1-F1', 'gestational_age_weeks', 29, 'Срок гестации 29 недель'), F('Т1-F2', 'birth_weight_g', 1250, 'Масса при рождении 1250 г'),
               F('Т1-F3', 'surfactant_in_delivery_room', False, 'Сурфактант в родильном зале не вводился'),
               F('Т1-F4', 'blood_culture_drawn_at', '2026-01-10T08:00+05:00', '10.01.2026 08:00 — кровь на посев взята', time_basis='explicit', event_at='2026-01-10T08:00+05:00'),
               F('Т1-F5', 'cpap_from_birth', True, 'ТЕХ-01')],
     'traps': [{'tid': 'Т1-T1', 'type': 'plan', 'quote': 'Планируется: гентамицин 7 мг при ухудшении.', 'location': 'body', 'field': 'gentamicin_dose_mg', 'must_not_value': 'any', 'correct_reading': 'план'},
               {'tid': 'Т1-T2', 'type': 'negation', 'quote': 'Сурфактант в родильном зале не вводился', 'location': 'body', 'field': 'surfactant_in_delivery_room', 'must_not_value': True, 'correct_reading': 'нет'}],
     'unread_elements': [], 'missing_clinical': []},
    {'id': 'ТЕХ-02', 'protocol': 'РДС', 'file': 'ТЕХ-02.docx', 'format': 'docx', 'design': {'intent': 'технический'},
     'facts': [F('Т2-F1', 'gestational_age_weeks', 31, 'Срок гестации 31 недель'), F('Т2-F2', 'birth_weight_g', 1600, 'Масса при рождении 1600 г'),
               F('Т2-F3', 'surfactant_in_delivery_room', False, 'Сурфактант в родильном зале не вводился', 'table'),
               F('Т2-F4', 'blood_culture_drawn_at', '2026-01-11T09:15+05:00', 'кровь взята 11.01.2026 09:15', 'footnote', time_basis='explicit', event_at='2026-01-11T09:15+05:00'),
               F('Т2-F5', 'weight_kg', 1.6, 'масса 1,6 кг', 'header')],
     'traps': [{'tid': 'Т2-T1', 'type': 'deleted_tracked_text', 'quote': 'Срок гестации 25 недель.', 'location': 'body', 'field': 'gestational_age_weeks', 'must_not_value': 25, 'correct_reading': 'удалено'}],
     'unread_elements': [{'ueid': 'Т2-U1', 'type': 'footnote', 'content_quote': 'сноска: кровь взята 11.01.2026 09:15', 'fids': ['Т2-F4']},
                         {'ueid': 'Т2-U2', 'type': 'header', 'content_quote': 'колонтитул: масса 1,6 кг', 'fids': ['Т2-F5']},
                         {'ueid': 'Т2-U3', 'type': 'textbox', 'content_quote': 'надпись: доза 77 мг', 'fids': []},
                         {'ueid': 'Т2-U4', 'type': 'comment', 'content_quote': 'примечание рецензента', 'fids': []}],
     'missing_clinical': [{'mid': 'Т2-M1', 'description': 'тест', 'quote': 'Конец.', 'relates_to_rules': []}]}]}
(D / 'blind1-gold.json').write_text(json.dumps(gold, ensure_ascii=False, indent=1), encoding='utf-8')
print('ok')
