// Этап 8, S8-4 (проект контракта, issue #10): время записи и время неизвестного типа не становятся временем события
// без явного подтверждения врача. Сквозные тесты нового контракта на синтетических историях этапа 7.
// Неизменённые тесты этапа 7 и их список ожидаемых падений НЕ трогаются; контроль этапа 7 остаётся красным до решения.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const CB = require('../case-builder.js');
const D = require('./tools/s84-diagnostics.js');
const TZ = '+05:00';
let k = 0; const now = () => new Date(Date.UTC(2026, 10, 20, 9, 0, k++)).toISOString();
const sess = h => CB.createSession({ extraction: X.extract(h.text, { tz: TZ, documentId: h.id }), actor: 'тест', now });
// уже утверждённые несовместимости этапа 8 (stage7-control-expected.json), к S8-4 не относятся
const KNOWN = { 'СИН-СЕП-01': ['данные sample_site'], 'СИН-СЕП-03': ['данные immunoglobulin_given', 'метки правил'] };

for (const h of D.EX.histories) {
  test(`${h.id}: путь этапа 7 без явного подтверждения не передаёт ни одного времени записи / unknown`, () => {
    const s = sess(h); const risky = D.risky(h).map(r => r.field);
    assert.ok(risky.length > 0, 'в истории есть время записи или неизвестного типа');
    for (const it of s.items) if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, 0);
    for (const it of s.items) if (it.status === CB.STATUS.NEW && !CB.needsTimeConfirm(it)) CB.confirm(s, it.candidate.id);
    for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
    for (const it of s.items) if (it.status === CB.STATUS.NEW && CB.needsTimeConfirm(it)) assert.throws(() => CB.confirm(s, it.candidate.id), /подтвердите явно|поэлементно/);
    const b = CB.build(s);
    for (const it of s.items) if (CB.needsTimeConfirm(it)) assert.ok(!(it.candidate.field in b.case.data), it.candidate.field + ' не передан');
    assert.equal(b.completeness.complete, false, 'проверка не завершена, пока время записи не решено');
  });

  test(`${h.id}: с явным подтверждением каждого времени записи движок = технический эталон (кроме утверждённых S8-1/S8-2)`, () => {
    for (const e of D.endToEnd(h)) {
      const extra = e.diff.filter(d => !(KNOWN[h.id] || []).some(p => d.startsWith(p)));
      assert.deepEqual(extra, [], (e.variant || '') + ' расхождения: ' + e.diff.join('; '));
    }
  });
}

test('явное подтверждение пишет тип и основание в журнал и источник для каждого времени записи', () => {
  const h = D.EX.histories.find(x => x.id === 'СИН-НЭК-01'); const s = sess(h);
  D.reviewExplicit(s, 0);
  const b = CB.build(s);
  for (const it of s.items) if (CB.needsTimeConfirm(it) && it.status !== CB.STATUS.REJECTED) {
    const src = b.case.sources[it.candidate.field];
    if (CB.riskyElems(it.candidate).length) {
      // список: основание у каждого рискового элемента, со ссылкой на его цитату; общего основания нет
      assert.ok(!('time_confirmation' in src), it.candidate.field);
      for (const e of CB.riskyElems(it.candidate)) assert.match(src.time_basis_items.find(x => x.index === e.index).time_confirmation, new RegExp('элемент №' + (e.index + 1)));
    } else assert.equal(src.time_confirmation, D.OK.basisReason, it.candidate.field);
    assert.ok(['document_time', 'unknown'].includes(b.case.sources[it.candidate.field].time_basis));
  }
});
