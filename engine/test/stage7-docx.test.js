// Этап 7 — чтение DOCX (engine/extract/docx.js + локальная JSZip 3.10.1). Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const VEN = path.join(ROOT, 'engine/vendor/jszip');
const JSZip = require(path.join(VEN, 'jszip.min.js'));
const DX = require('../extract/docx.js');
const X = require('../extract/extract.js');
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage7/stage7-extraction-gold.json'), 'utf8'));
const read = (b, o) => DX.readDocx(b, Object.assign({ JSZip }, o || {}));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const p = (...runs) => `<w:p>${runs.map(r => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;
async function makeDocx(body, extra) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  for (const [n, c] of Object.entries(extra || {})) z.file(n, c);
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('JSZip: зафиксированная версия 3.10.1, лицензия сохранена, контрольные суммы совпадают', () => {
  for (const line of fs.readFileSync(path.join(VEN, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const [sum, name] = line.split(/\s+/);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(VEN, name))).digest('hex'), sum, name);
  }
  assert.match(fs.readFileSync(path.join(VEN, 'jszip.min.js'), 'utf8').slice(0, 200), /JSZip v3\.10\.1/);
  assert.match(fs.readFileSync(path.join(VEN, 'LICENSE.markdown'), 'utf8'), /MIT/);
  assert.equal(JSZip.version, '3.10.1');
});

test('ограничения по решению от 20.11: 10 МБ, 50 МБ, 500 элементов, 100:1', () => {
  assert.deepEqual(DX.LIMITS, { fileBytes: 10 * 1024 * 1024, unpackedBytes: 50 * 1024 * 1024, entries: 500, ratio: 100 });
});

for (const h of EX.histories) {
  test(`${h.id}: DOCX читается полностью, текст и извлечение совпадают с текстовой версией`, async () => {
    const r = await read(fs.readFileSync(path.join(__dirname, 'fixtures/stage7/docx', h.id + '.docx')));
    assert.equal(r.complete, true); assert.deepEqual(r.warnings, []);
    if (h.id === 'СИН-СЕП-01') {
      // таблица листа назначений стоит сразу после записи 08:30 (порядок «абзац — таблица — абзац»)
      const L = r.text.split('\n'), i = L.findIndex(l => l.startsWith('03.07.2026 08:30 — назначено'));
      assert.equal(L[i + 1], 'Время | Назначение | Отметка');
      assert.equal(L[i + 2], '03.07.2026 08:30 | по листу назначений | см. запись выше');
      assert.equal(L.filter((l, k) => k !== i + 1 && k !== i + 2).join('\n'), h.text);
    } else assert.equal(r.text, h.text);
    const a = X.extract(r.text, { tz: '+05:00' }).candidates.map(c => [c.field, c.value ?? c.timeline]);
    const b = X.extract(h.text, { tz: '+05:00' }).candidates.map(c => [c.field, c.value ?? c.timeline]);
    const strip = x => JSON.stringify(x.map(([f, v]) => [f, Array.isArray(v) ? v.map(t => t && t.fragment ? Object.assign({}, t, { fragment: t.fragment.text }) : t) : v]));
    assert.equal(strip(a), strip(b));
  });
}

test('порядок текста: фрагменты (runs) склеиваются, таблица между абзацами, числа и символы сохраняются', async () => {
  const body = p('21.09.2026 09:', '00 — назначено: бензилпенициллин 95', ' 000 ЕД (50 000 ЕД/кг) в/в каждые 8 ч.') +
    '<w:tbl><w:tr><w:tc>' + p('Гентамицин') + '</w:tc><w:tc>' + p('7,6 мг (4 мг/кг)') + '</w:tc></w:tr><w:tr><w:tc>' + p('Интервал') + '</w:tc><w:tc>' + p('24 ч') + '</w:tc></w:tr></w:tbl>' +
    p('Основание: тяжёлая нейтропения 0,4×10⁹/л &amp; &lt;проверка&gt;.');
  const r = await read(await makeDocx(body));
  assert.equal(r.text, '21.09.2026 09:00 — назначено: бензилпенициллин 95 000 ЕД (50 000 ЕД/кг) в/в каждые 8 ч.\nГентамицин | 7,6 мг (4 мг/кг)\nИнтервал | 24 ч\nОснование: тяжёлая нейтропения 0,4×10⁹/л & <проверка>.');
  const c = new Map(X.extract(r.text, { tz: '+05:00' }).candidates.map(x => [x.field, x]));
  assert.equal(c.get('benzylpenicillin_dose_units_per_kg').value, 50000);
  assert.equal(c.get('benzylpenicillin_prescribed_at').value, '2026-09-21T09:00+05:00');
});

test('удалённый текст (исправления Word), коды полей и запасной вариант mc:Fallback не попадают в текст', async () => {
  const body = '<w:p><w:r><w:t>Доза </w:t></w:r><w:del><w:r><w:delText>10 мг</w:delText></w:r></w:del><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>7,6 мг</w:t></w:r></w:p>' +
    '<mc:AlternateContent><mc:Choice Requires="wps">' + p('основной') + '</mc:Choice><mc:Fallback>' + p('ДУБЛЬ') + '</mc:Fallback></mc:AlternateContent>';
  const r = await read(await makeDocx(body));
  assert.equal(r.text, 'Доза 7,6 мг\nосновной');
});

test('нечитаемые части (надпись, рисунок, объект, колонтитул, сноски) — предупреждение и «неполное извлечение»', async () => {
  const body = p('Видимый текст') + '<w:p><w:r><w:drawing/></w:r><w:r><w:pict><w:txbxContent>' + p('Текст в надписи') + '</w:txbxContent></w:pict></w:r></w:p>' + '<w:p><w:r><w:object/></w:r></w:p>';
  const r = await read(await makeDocx(body, {
    'word/header1.xml': `<w:hdr ${W}>${p('Колонтитул')}</w:hdr>`,
    'word/footnotes.xml': `<w:footnotes ${W}><w:footnote>${p('Сноска')}</w:footnote></w:footnotes>`,
  }));
  assert.equal(r.complete, false);
  assert.ok(!r.text.includes('Текст в надписи'));
  const w = r.warnings.join('; ');
  for (const s of ['надпись', 'рисунок', 'внедрённый объект', 'колонтитул', 'сноски']) assert.ok(w.includes(s), s);
});

test('повреждённые и неподходящие файлы отклоняются с понятным сообщением', async () => {
  await assert.rejects(read(Buffer.alloc(0)), e => e.code === 'EMPTY');
  await assert.rejects(read(crypto.randomBytes(5000)), e => e.code === 'CORRUPT' && /повреждён/.test(e.message));
  const good = fs.readFileSync(path.join(__dirname, 'fixtures/stage7/docx/СИН-РДС-01.docx'));
  await assert.rejects(read(good.subarray(0, Math.floor(good.length / 2))), e => e.code === 'CORRUPT');
  const z = new JSZip(); z.file('readme.txt', 'не DOCX');
  await assert.rejects(read(await z.generateAsync({ type: 'nodebuffer' })), e => e.code === 'NO_DOCUMENT');
  const z2 = new JSZip(); z2.file('word/document.xml', '<w:document>без тела</w:document>');
  await assert.rejects(read(await z2.generateAsync({ type: 'nodebuffer' })), e => e.code === 'CORRUPT');
  await assert.rejects(DX.readDocx(good, {}), e => e.code === 'NO_ZIP');
});

test('лимит размера файла: больше 10 МБ — отказ до распаковки', async () => {
  await assert.rejects(read(Buffer.alloc(10 * 1024 * 1024 + 1)), e => e.code === 'TOO_LARGE' && /10 МБ/.test(e.message));
});

test('лимит числа элементов: больше 500 — отказ', async () => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document ${W}><w:body>${p('x')}</w:body></w:document>`);
  for (let i = 0; i < 500; i++) z.file(`x/${i}.txt`, String(i));
  await assert.rejects(read(await z.generateAsync({ type: 'nodebuffer' })), e => e.code === 'TOO_MANY_ENTRIES');
});

test('лимит степени сжатия: элемент сжат сильнее 100:1 — отказ («архивная бомба»)', async () => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document ${W}><w:body>${p('x')}</w:body></w:document>`);
  z.file('word/media/zero.bin', Buffer.alloc(2 * 1024 * 1024));
  await assert.rejects(read(await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })), e => e.code === 'RATIO' && /100:1/.test(e.message));
});

test('лимит распакованного объёма: проверка по заявленным размерам до распаковки (на уменьшенном лимите)', async () => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document ${W}><w:body>${p('x')}</w:body></w:document>`);
  z.file('word/media/a.bin', crypto.randomBytes(300 * 1024));
  const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  await assert.rejects(read(buf, { limits: { unpackedBytes: 200 * 1024 } }), e => e.code === 'TOO_LARGE_UNPACKED');
  const ok = await read(buf); assert.equal(ok.text, 'x');
});
