// Этап 8, issue #10 п.6 — газы крови, настройки ИВЛ, рентгенограммы из таблиц. Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const cand = (t, f) => X.extract(t, { tz: '+05:00' }).candidates.find(c => c.field === f);
const okFr = t => { for (const c of X.extract(t, { tz: '+05:00' }).candidates) for (const f of c.fragments || []) assert.equal(t.slice(f.start, f.end), f.text); };

const KOS = 'КОС\nДата/время | pH | pCO2, мм рт. ст. | BE\n14.01.2026 08:00 | 7,31 | 52 | -4\n14.01.2026 14:00 | 7,38 | 41 | -2';
test('газы крови из таблицы: дата-время строки, pH, pCO2 в мм рт. ст.; время — event_time', () => {
  const c = cand(KOS, 'blood_gases');
  assert.deepEqual(c.value, [{ drawn_at: '2026-01-14T08:00+05:00', ph: 7.31, paco2_mmhg: 52 }, { drawn_at: '2026-01-14T14:00+05:00', ph: 7.38, paco2_mmhg: 41 }]);
  assert.deepEqual(c.time_basis_items.map(x => x.time_basis), ['event_time', 'event_time']);
  okFr(KOS);
});
test('pCO2 в кПа, значения вне диапазона, строка без времени, скопированная строка — не извлекаются', () => {
  assert.equal(cand('Дата/время | pH | pCO2, кПа\n14.01.2026 08:00 | 7,31 | 6,9', 'blood_gases'), undefined);
  assert.equal(cand('Дата/время | pH | pCO2\n14.01.2026 08:00 | 73,1 | 52', 'blood_gases'), undefined);
  assert.equal(cand('Дата/время | pH | pCO2\n14.01.2026 | 7,31 | 52', 'blood_gases'), undefined);
  assert.equal(cand('Дата/время | pH | pCO2\n14.01.2026 08:00 (скопировано) | 7,31 | 52', 'blood_gases'), undefined);
  assert.equal(cand('Дата/время | pH | pCO2\n14.01.2026 08:00 | 7,31 |', 'blood_gases'), undefined, 'пустая ячейка');
});
const IVL = 'ИВЛ\nДата/время | PIP | PEEP | FiO2 | ЧД\n14.01.2026 08:00 | 20 | 6 | 0,40 | 50\n14.01.2026 14:00 | 18 | 6 | 0,30 | 50\n15.01.2026 08:00 | 18 | 5 | 0,30 | 45';
test('изменения ИВЛ по соседним строкам: только изменившиеся параметры, с пометкой и обязательным подтверждением', () => {
  const c = cand(IVL, 'vent_changes');
  const srt = a => a.slice().sort((x, y) => (x.at + x.parameter).localeCompare(y.at + y.parameter));
  assert.deepEqual(srt(c.value), srt([
    { at: '2026-01-14T14:00+05:00', parameter: 'PIP', from: 20, to: 18 },
    { at: '2026-01-15T08:00+05:00', parameter: 'PEEP', from: 6, to: 5 },
    { at: '2026-01-14T14:00+05:00', parameter: 'FiO2', from: 0.4, to: 0.3 },
    { at: '2026-01-15T08:00+05:00', parameter: 'Частота', from: 50, to: 45 }]));
  assert.equal(c.critical, true); assert.match(c.note, /вычислено по соседним строкам/);
  okFr(IVL);
});
test('FiO2 в процентах из таблицы не приводится к доле', () => {
  assert.equal(cand('Дата/время | FiO2, %\n14.01.2026 08:00 | 40\n14.01.2026 14:00 | 30', 'vent_changes'), undefined);
});
const RG = 'Рентгенография\nДата/время | Исследование | Положение | Показание | Заключение\n02.05.2026 09:30 | Рентгенография ОБП | горизонтально | экстренно | пневматоз кишечника\n04.05.2026 09:00 | Рентгенография ОБП | вертикально | контроль | свободного газа нет';
test('рентгенограммы из таблицы: время, положение, показание, заключение', () => {
  assert.deepEqual(cand(RG, 'xrays').value, [
    { at: '2026-05-02T09:30+05:00', position: 'horizontal', reason: 'urgent', result: 'пневматоз кишечника' },
    { at: '2026-05-04T09:00+05:00', position: 'vertical', reason: 'planned', result: 'свободного газа нет' }]);
});
test('таблица без колонки времени или без узнаваемых колонок не разбирается', () => {
  assert.equal(cand('Препарат | Доза\nГентамицин | 6 мг', 'blood_gases'), undefined);
  assert.equal(cand('Дата | Мероприятие\n14.01.2026 08:00 | Осмотр', 'xrays'), undefined);
});
