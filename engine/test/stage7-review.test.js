// Этап 7 — регрессия по четырём замечаниям независимого аудита PR №8 (20.11). Только синтетические данные.
// 1) устаревший результат не выгружается; 2) лимиты DOCX — до распаковки, фактический объём под контролем;
// 3) «все сведения решены» и «документ прочитан полностью» — разные состояния; 4) обоснования и комментарии в выгрузке.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const JSZip = require(path.join(ROOT, 'engine/vendor/jszip/jszip.min.js'));
const DX = require('../extract/docx.js');
const X = require('../extract/extract.js');
const CB = require('../case-builder.js');
const V = require('../expert-view.js');
const RP = require('../expert-report.js');
const env = { RulesEngine: require('../rules-engine.js'), Derive: require('../derive.js'), db: require('../../rules/pilot-rules.json'), expertDecisions: require('../../rules/expert-decisions.json') };
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage7/stage7-extraction-gold.json'), 'utf8'));
const H = id => EX.histories.find(h => h.id === id);
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function reviewAll(s) {
  for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, 0);
  for (const it of s.items) if (it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id);
}
const sessionOf = (text, warnings) => CB.createSession({ extraction: X.extract(text, { tz: '+05:00', documentId: 'тест', warnings }), actor: 'эксперт-тест' });

// ── 1. устаревший результат
test('1. выгрузка: полная проверка → расчёт → изменение дозы → запрет → пересчёт → разрешено с новым результатом', () => {
  const s = sessionOf(H('СИН-РДС-01').text); reviewAll(s);
  let b = CB.build(s);
  assert.deepEqual(RP.exportState(b, null, false, CB.fingerprint).reasons, ['проверка правил не выполнялась']);
  let view = V.view(env, b, ['РДС']); let fp = CB.fingerprint(b);
  assert.equal(RP.exportState(b, fp, true, CB.fingerprint).allowed, true);
  assert.equal(view.rules.find(r => r.rule_id === 'RDS-009').label, 'соответствие');
  CB.edit(s, s.items.find(i => i.candidate.field === 'surfactant_initial_dose_mg_kg').candidate.id, 100);
  b = CB.build(s);
  const e = RP.exportState(b, fp, true, CB.fingerprint);
  assert.equal(e.allowed, false);
  assert.match(e.reasons.join(), /изменены после последнего расчёта/);
  view = V.view(env, b, ['РДС']); fp = CB.fingerprint(b);
  assert.equal(RP.exportState(b, fp, true, CB.fingerprint).allowed, true);
  const html = RP.buildReport({ view, built: b, journal: s.journal, documentId: 'тест', tz: '+05:00', text: H('СИН-РДС-01').text, comments: {}, justifications: {}, generatedAt: 'т' });
  assert.equal(view.rules.find(r => r.rule_id === 'RDS-009').label, 'неоднозначность');
  assert.match(html, /<td>RDS-009<\/td><td>неоднозначность<\/td>/);
});

test('1. выгрузка запрещена, пока не по всем сведениям есть решение', () => {
  const s = sessionOf(H('СИН-РДС-01').text);
  const b = CB.build(s);
  assert.match(RP.exportState(b, CB.fingerprint(b), true, CB.fingerprint).reasons.join(), /не по всем сведениям/);
});

// ── 2. DOCX: лимиты до распаковки
function spyZip() {
  const log = { opts: null, streamed: [] };
  const Z = { loadAsync: async (b, o) => {
    log.opts = o; const z = await JSZip.loadAsync(b, o);
    for (const [n, f] of Object.entries(z.files)) {
      const is = f.internalStream.bind(f), as = f.async.bind(f);
      f.internalStream = t => { log.streamed.push(n); return is(t); };
      f.async = t => { log.streamed.push(n); return as(t); };
    }
    return z;
  } };
  return { Z, log };
}

test('2. высокосжатый архив отклоняется по оглавлению, без распаковки какого-либо элемента', async () => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document ${W}><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`);
  z.file('word/media/bomb.bin', Buffer.alloc(40 * 1024 * 1024)); // 40 МБ нулей → ~40 КБ в архиве
  const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  assert.ok(buf.length < 200 * 1024);
  const { Z, log } = spyZip();
  const t0 = Date.now();
  await assert.rejects(DX.readDocx(buf, { JSZip: Z }), e => e.code === 'RATIO');
  assert.equal(log.opts.checkCRC32, false, 'оглавление читается без проверки CRC, то есть без распаковки');
  assert.deepEqual(log.streamed, [], 'ни один элемент не распаковывался');
  assert.ok(Date.now() - t0 < 2000);
});

/** Подмена заявленного размера распакованного элемента в локальном заголовке и оглавлении ZIP. */
function patchDeclaredSize(buf, name, newSize) {
  const b = Buffer.from(buf), nm = Buffer.from(name);
  for (let i = 0; i < b.length - 4; i++) {
    const sig = b.readUInt32LE(i);
    if (sig === 0x04034b50 && b.subarray(i + 30, i + 30 + nm.length).equals(nm)) b.writeUInt32LE(newSize, i + 22);
    if (sig === 0x02014b50 && b.subarray(i + 46, i + 46 + nm.length).equals(nm)) b.writeUInt32LE(newSize, i + 24);
  }
  return b;
}

test('2. фактический объём контролируется при распаковке: элемент больше заявленного — отказ', async () => {
  const z = new JSZip();
  const xml = `<w:document ${W}><w:body>` + '<w:p><w:r><w:t>строка истории</w:t></w:r></w:p>'.repeat(200) + '</w:body></w:document>';
  z.file('word/document.xml', xml);
  const buf = patchDeclaredSize(await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'word/document.xml', 1000);
  await assert.rejects(DX.readDocx(buf, { JSZip }), e => e.code === 'TOO_LARGE_UNPACKED' && /больше заявленного/.test(e.message));
});

test('2. целостность: изменённые данные элемента (несовпадение CRC-32) — отказ', async () => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document ${W}><w:body><w:p><w:r><w:t>ABCDEFGH</w:t></w:r></w:p></w:body></w:document>`);
  const b = Buffer.from(await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
  const i = b.indexOf('ABCDEFGH'); b[i] = 'Z'.charCodeAt(0);
  await assert.rejects(DX.readDocx(b, { JSZip }), e => e.code === 'CORRUPT' && /контрольная сумма/.test(e.message));
});

test('2. общий лимит распакованного объёма соблюдается и при фактическом чтении (уменьшенный лимит)', async () => {
  const z = new JSZip();
  z.file('word/document.xml', `<w:document ${W}><w:body>` + '<w:p><w:r><w:t>текст</w:t></w:r></w:p>'.repeat(50) + '</w:body></w:document>');
  z.file('word/header1.xml', `<w:hdr ${W}>` + '<w:p><w:r><w:t>колонтитул</w:t></w:r></w:p>'.repeat(50) + '</w:hdr>');
  const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const r = await DX.readDocx(buf, { JSZip });
  assert.ok(r.stats.unpacked > 0 && r.stats.unpacked <= r.stats.declared_unpacked);
  await assert.rejects(DX.readDocx(buf, { JSZip, limits: { unpackedBytes: r.stats.declared_unpacked - 1 } }), e => e.code === 'TOO_LARGE_UNPACKED');
});

// ── 3. два состояния
test('3. «все сведения решены» и «документ прочитан полностью» — разные признаки', () => {
  const s = sessionOf(H('СИН-СЕП-01').text, ['не прочитано: надпись (текстовое поле) — 1 шт.']); reviewAll(s);
  const b = CB.build(s);
  assert.equal(b.completeness.complete, true);
  assert.equal(b.completeness.source_complete, false);
  assert.deepEqual(RP.auditState(b), { review_complete: true, source_complete: false, full: false });
  const view = V.view(env, b, ['Сепсис']);
  const html = RP.buildReport({ view, built: b, journal: s.journal, documentId: 'тест', tz: '+05:00', text: H('СИН-СЕП-01').text, sourceWarnings: b.completeness.source_warnings, comments: {}, justifications: {}, generatedAt: 'т' });
  assert.match(html, /ИСХОДНЫЙ ДОКУМЕНТ ПРОЧИТАН НЕ ПОЛНОСТЬЮ: не прочитано: надпись/);
  assert.match(html, /исходный документ прочитан НЕ полностью/);
  assert.doesNotMatch(html, /исходный документ прочитан полностью/);
  const s2 = sessionOf(H('СИН-СЕП-01').text); reviewAll(s2);
  assert.equal(RP.auditState(CB.build(s2)).full, true);
});

// ── 4. обоснования и комментарии в выгрузке
test('4. выгрузка содержит комментарий, обоснование, привязанный фрагмент; ручное обоснование помечено', () => {
  const text = H('СИН-РДС-02').text;
  const s = sessionOf(text); reviewAll(s);
  const b = CB.build(s), view = V.view(env, b, ['РДС']);
  const fr = RP.bindFragment(text, 'смеситель в родзале № 2 неисправен');
  assert.ok(fr && RP.fragmentValid(text, fr));
  assert.equal(RP.bindFragment(text, 'такой фразы в истории нет'), null);
  const html = RP.buildReport({ view, built: b, journal: s.journal, documentId: 'тест', tz: '+05:00', text, generatedAt: 'т',
    comments: { 'RDS-004': { text: 'Комментарий <b>эксперта</b>', by: 'эксперт', at: '2026-11-20T10:00' } },
    justifications: {
      'RDS-004': { text: 'Неисправность оборудования', fragment: fr, by: 'эксперт', at: '2026-11-20T10:01' },
      'RDS-006': { text: 'Со слов дежурного врача', fragment: null, by: 'эксперт', at: '2026-11-20T10:02' },
      'RDS-005': { text: 'Подделанный фрагмент', fragment: { text: 'нет такого', start: 0, end: 10 }, by: 'эксперт', at: 'т' },
    } });
  assert.match(html, /Комментарий &lt;b&gt;эксперта&lt;\/b&gt;/, 'комментарий экранирован');
  assert.match(html, new RegExp(`Неисправность оборудования.*Фрагмент истории \\(позиция ${fr.start}\\): «смеситель в родзале № 2 неисправен»`, 's'));
  assert.match(html, /Со слов дежурного врача.*обоснование введено вручную и не связано с документом/s);
  assert.match(html, /Подделанный фрагмент.*указанный фрагмент не найден в документе/s);
  assert.match(html, /не меняют результат проверки правил и не считаются клинически подтверждёнными/);
  assert.match(html, /<td>RDS-004<\/td><td>предварительное отличие<\/td>/, 'обоснование не меняет результат движка');
});

test('4. повторяющийся фрагмент: привязка неоднозначна и не выдаётся за установленный источник', () => {
  const text = H('СИН-НЭК-01').text;
  const fr = RP.bindFragment(text, 'рентгенография в горизонтальном положении');
  assert.equal(fr.occurrences, 3); assert.equal(fr.ambiguous, true);
  const one = RP.bindFragment(text, 'ПВК удалён 13.04.2026 11:30');
  assert.equal(one.ambiguous, false);
  const s = sessionOf(text); reviewAll(s);
  const b = CB.build(s), view = V.view(env, b, ['НЭК']);
  const html = RP.buildReport({ view, built: b, journal: [], documentId: 'тест', tz: '+05:00', text, generatedAt: 'т', comments: {},
    justifications: { 'NEC-006': { text: 'Контроль выполнен', fragment: fr, by: 'эксперт', at: 'т' }, 'NEC-002': { text: 'Удалён сразу', fragment: one, by: 'эксперт', at: 'т' } } });
  assert.match(html, /Контроль выполнен.*встречается в документе 3 раз — место в истории однозначно не установлено; источник не считается достоверно привязанным/s);
  assert.doesNotMatch(html, new RegExp(`Фрагмент истории \\(позиция ${fr.start}\\): «рентгенография`));
  assert.match(html, new RegExp(`Удалён сразу.*Фрагмент истории \\(позиция ${one.start}\\): «ПВК удалён 13.04.2026 11:30»`, 's'));
});

test('итоговые инварианты: 249 эталонных значений, 79 пустых оценок, 30 правил, 7 конфликтов', () => {
  assert.equal(EX.histories.reduce((a, h) => a + h.items.length, 0), 249);
  const C = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage7/stage7-clinical-assessment-template.json'), 'utf8'));
  const k = C.histories.flatMap(h => h.key_items);
  assert.equal(k.length, 79); assert.ok(k.every(x => x.doctor_assessment === null));
  assert.equal(env.db.rules.length, 30); assert.equal(env.db.protocol_conflicts.length, 7);
});
