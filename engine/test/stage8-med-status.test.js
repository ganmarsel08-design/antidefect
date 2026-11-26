// Этап 8, issue #10 п.3 — план / назначено / введено / отменено / не введено. Сведения для врача, в случай не входят.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const ev = t => X.extract(t, { tz: '+05:00' }).medication_events.map(e => [e.drug, e.status]);

test('план и условие', () => {
  assert.deepEqual(ev('14.01.2026 07:30 — Планируется гентамицин 6 мг в/в.'), [['гентамицин', 'planned']]);
  assert.deepEqual(ev('При появлении пневматоза — метронидазол 7,5 мг в/в.'), [['метронидазол', 'planned']]);
});
test('назначено, но не введено / отменено до введения', () => {
  assert.deepEqual(ev('14.01.2026 07:30 — Назначен гентамицин 6 мг в/в. Фактически не вводился.'), [['гентамицин', 'not_administered']]);
  assert.deepEqual(ev('Гентамицин 6 мг — отменён до введения.'), [['гентамицин', 'cancelled']]);
});
test('введено и назначено', () => {
  assert.deepEqual(ev('14.01.2026 07:40 — Введена первая доза АБТ: ампициллин 100 мг + гентамицин 8 мг.'), [['ампициллин', 'administered'], ['гентамицин', 'administered']]);
  assert.deepEqual(ev('Иммуноглобулин назначен индивидуально.'), [['иммуноглобулин', 'prescribed']]);
  assert.deepEqual(ev('Дата | Препарат | Доза\n14.01.2026 | Гентамицин | 6 мг'), [['гентамицин', 'prescribed']]);
});
test('время введения — только своё время события (не время записи)', () => {
  const a = X.extract('14.01.2026 07:30 — Осмотр. В 07:40 введена первая доза: ампициллин 100 мг.', { tz: '+05:00' }).medication_events.find(e => e.drug === 'ампициллин');
  assert.equal(a.status, 'administered'); assert.equal(a.at, '2026-01-14T07:40+05:00');
  const b = X.extract('14.01.2026 07:30 — Введена первая доза: ампициллин 100 мг.', { tz: '+05:00' }).medication_events.find(e => e.drug === 'ампициллин');
  assert.equal(b.at, null, 'время записи не выдаётся за время введения');
});
test('мать и другой ребёнок — не сведения о пациенте', () => {
  assert.deepEqual(ev('Матери введён ампициллин 2 г.'), []);
});
test('сведения о препаратах не входят в случай и не меняют поля', () => {
  const r = X.extract('14.01.2026 07:30 — Планируется гентамицин 6 мг в/в.', { tz: '+05:00' });
  assert.equal(r.candidates.find(c => c.field === 'gentamicin_given'), undefined);
  assert.ok(r.candidates.every(c => !/medication/.test(c.field)));
});
