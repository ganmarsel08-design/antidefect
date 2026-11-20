# Антидефект — этап 7. Создание DOCX-версий девяти синтетических историй из stage7-extraction-gold.json.
# Каждая строка текста — отдельный абзац Word. Чтобы проверить сборку текста из нескольких фрагментов (runs),
# строки с отметкой времени намеренно разбиваются на 3 фрагмента, в том числе внутри даты-времени и дозы.
# В историю СЕП-01 дополнительно добавляется таблица листа назначений (проверка порядка «абзац — таблица — абзац»).
# Запуск: python3 engine/test/tools/make-stage7-docx.py   (нужен python-docx; только синтетические данные)
import json, os, re, sys
from docx import Document
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'engine', 'test', 'fixtures', 'stage7')
E = json.load(open(os.path.join(D, 'stage7-extraction-gold.json'), encoding='utf-8'))
os.makedirs(os.path.join(D, 'docx'), exist_ok=True)
TABLE = {'СИН-СЕП-01': [['Время', 'Назначение', 'Отметка'], ['03.07.2026 08:30', 'по листу назначений', 'см. запись выше']]}
for h in E['histories']:
    doc = Document()
    doc.core_properties.author = 'синтетический пример'
    doc.core_properties.title = h['id']
    for i, line in enumerate(h['text'].split('\n')):
        p = doc.add_paragraph()
        m = re.match(r'^(\d\d\.\d\d\.\d{4} \d\d:)(\d\d — .{0,12})(.*)$', line)
        if m:
            for part in m.groups():
                if part: p.add_run(part)
        else:
            p.add_run(line)
        if h['id'] in TABLE and line.startswith('03.07.2026 08:30'):
            t = doc.add_table(rows=0, cols=3)
            for row in TABLE[h['id']]:
                cells = t.add_row().cells
                for c, v in zip(cells, row): c.text = v
    doc.save(os.path.join(D, 'docx', h['id'] + '.docx'))
print('docx:', len(E['histories']))
