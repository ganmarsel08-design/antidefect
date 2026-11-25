// Этап 8 — привязка времени к событию (ошибка СЛП-НЭК-03 из слепого теста №1). Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const TZ = '+05:00';
const get = (t, f) => X.extract(t, { tz: TZ }).candidates.find(c => c.field === f);

test('время в том же предложении важнее времени заголовка записи (НЭК-03)', () => {
  const t = '22.06.2026 08:30 — Вздутие живота. Подозрение на НЭК. Энтеральное кормление прекращено в 08:40, установлен назогастральный зонд.';
  const c = get(t, 'enteral_feeding_stopped_at');
  assert.equal(c.value, '2026-06-22T08:40+05:00');
  assert.equal(get(t, 'nec_suspected_at').value, '2026-06-22T08:30+05:00');
  for (const f of c.fragments) { assert.equal(t.slice(f.start, f.end), f.text); assert.match(f.text, /08:40/); assert.match(f.text, /прекращено/); }
});

test('нет своего времени в предложении — время заголовка записи (как раньше)', () => {
  const c = get('22.06.2026 08:30 — Вздутие живота. Кормление прекращено, установлен зонд.', 'enteral_feeding_stopped_at');
  assert.equal(c.value, '2026-06-22T08:30+05:00');
});

test('два разных времени в одном предложении — значения нет (не угадываем)', () => {
  const t = '22.06.2026 08:30 — Осмотр. Кормление прекращено в 08:40 после контроля в 08:35.';
  assert.equal(get(t, 'enteral_feeding_stopped_at'), undefined);
  assert.ok(get(t, 'enteral_feeding_stopped'), 'сам факт прекращения извлекается');
});

test('время раньше заголовка (возможен переход через полночь) — значения нет', () => {
  const t = '22.06.2026 23:50 — Ухудшение. Кормление прекращено в 00:10.';
  assert.equal(get(t, 'enteral_feeding_stopped_at'), undefined);
});

test('полная дата-время в предложении используется как есть', () => {
  const t = '22.06.2026 23:50 — Ухудшение. Кормление прекращено 23.06.2026 00:10.';
  assert.equal(get(t, 'enteral_feeding_stopped_at').value, '2026-06-23T00:10+05:00');
});

test('время без даты и без заголовка — значения нет', () => {
  assert.equal(get('Кормление прекращено в 08:40.', 'enteral_feeding_stopped_at'), undefined);
});

test('отрицание не даёт времени прекращения', () => {
  const t = '22.06.2026 08:30 — Кормление не прекращено в 08:40.';
  assert.equal(get(t, 'enteral_feeding_stopped_at'), undefined);
  assert.equal(get(t, 'enteral_feeding_stopped').value, false);
});

test('время в соседнем предложении не переносится на событие', () => {
  const t = '22.06.2026 08:30 — Контроль СРБ в 09:15. Кормление прекращено.';
  assert.equal(get(t, 'enteral_feeding_stopped_at').value, '2026-06-22T08:30+05:00');
});

test('дробные числа и дозы не принимаются за время', () => {
  const t = '22.06.2026 08:30 — Кормление прекращено, объём 12.30 мл, интервал 3 ч.';
  assert.equal(get(t, 'enteral_feeding_stopped_at').value, '2026-06-22T08:30+05:00');
});
