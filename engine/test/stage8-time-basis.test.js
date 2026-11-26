// Этап 8, issue #10 п.2 — время записи ≠ время события. Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const CB = require('../case-builder.js');
const TZ = '+05:00';
const cand = (t, f) => X.extract(t, { tz: TZ }).candidates.find(c => c.field === f);

test('своё время у события → event_time; только время записи → document_time, критическое, с пометкой', () => {
  const e = cand('22.06.2026 08:30 — Кормление прекращено в 08:40.', 'enteral_feeding_stopped_at');
  assert.equal(e.time_basis, 'event_time'); assert.equal(e.value, '2026-06-22T08:40+05:00');
  const d = cand('22.06.2026 08:30 — Кормление прекращено.', 'enteral_feeding_stopped_at');
  assert.equal(d.time_basis, 'document_time'); assert.equal(d.critical, true); assert.match(d.note, /Время записи врача/);
  assert.match(d.time_source, /время записи/);
});

test('дата из заголовка раздела + время записи → document_time с указанием источника даты', () => {
  const d = cand('Дневник 14.01.2026\n18:00 — Кормление прекращено.', 'enteral_feeding_stopped_at');
  assert.equal(d.time_basis, 'document_time'); assert.match(d.time_source, /заголовка раздела/);
  const e = cand('Дневник 14.01.2026\n07:00 — Осмотр. В 07:30 введена первая доза антибиотиков.', 'first_abx_dose_administered_at');
  assert.equal(e.time_basis, 'event_time'); assert.match(e.time_source, /дата — из/);
});

test('полночь: время события раньше времени записи на много часов — не вычисляется; дата события в тексте — event_time', () => {
  assert.equal(cand('14.01.2026 23:50 — Кормление прекращено в 00:10.', 'enteral_feeding_stopped_at'), undefined);
  const e = cand('14.01.2026 23:50 — Кормление прекращено 15.01.2026 в 00:10.', 'enteral_feeding_stopped_at');
  assert.equal(e.value, '2026-01-15T00:10+05:00'); assert.equal(e.time_basis, 'event_time');
  assert.equal(cand('Дневник 14.01.2026\n23:30 — Осмотр.\n00:20 — Кормление прекращено.', 'enteral_feeding_stopped_at'), undefined);
});

test('несколько действий: у действия без своего времени — ни своего, ни чужого, ни времени записи', () => {
  assert.equal(cand('22.06.2026 08:30 — Кормление прекращено, зонд установлен в 08:50.', 'enteral_feeding_stopped_at'), undefined);
  const z = cand('22.06.2026 08:30 — Кормление прекращено, установлен назогастральный зонд в 08:50.', 'ng_tube_placed_at');
  assert.equal(z.time_basis, 'event_time');
});

test('время записи в списке (СРБ) помечено по элементам', () => {
  const c = cand('05.03.2026 09:20 — Исходный СРБ взят.', 'crp_samples');
  assert.deepEqual(c.time_basis_items.map(x => x.time_basis), ['document_time']); assert.equal(c.critical, true);
});

test('время записи не попадает в случай без отдельного подтверждения врача — интервалы по нему не считаются', () => {
  const ex = X.extract('22.06.2026 08:30 — Подозрение на НЭК.\n22.06.2026 09:00 — Кормление прекращено.', { tz: TZ });
  let k = 0; const s = CB.createSession({ extraction: ex, actor: 'тест', now: () => new Date(Date.UTC(2026, 5, 22, 5, 0, k++)).toISOString() });
  for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
  const b = CB.build(s);
  assert.ok(!('enteral_feeding_stopped_at' in b.case.data), 'групповое подтверждение не берёт время записи');
  assert.ok(!('nec_suspected_at' in b.case.data));
});
