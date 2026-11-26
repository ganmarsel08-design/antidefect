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

test('наблюдения пассажа: тип времени по каждому наблюдению, форма timeline не меняется', () => {
  const c = cand('05.06.2026 10:00 — Пассаж по ЖКТ ещё не восстановлен.\n08.06.2026 09:00 — Осмотр. Пассаж восстановлен 08.06.2026 в 08:30.', 'gi_passage_restored');
  assert.deepEqual(c.timeline.map(x => Object.keys(x).sort()), [['at', 'date', 'fragment', 'v'], ['at', 'date', 'fragment', 'v']]);
  assert.deepEqual(c.timeline_basis.map(x => x.time_basis), ['document_time', 'event_time']);
  assert.equal(c.critical, true);
});

// ── Ревью ChatGPT к ce81b66 / b128244: сквозной путь extract → подтверждение → case → derive.
const Derive = require('../derive.js');
const T_OK = { timeIsEvent: true, basisReason: 'врач: в записи это время события' };
function sess(text) { let k = 0; return CB.createSession({ extraction: X.extract(text, { tz: TZ }), actor: 'тест', now: () => new Date(Date.UTC(2026, 5, 22, 5, 0, k++)).toISOString() }); }
const item = (s, f) => s.items.find(i => i.candidate.field === f);

test('унаследованное правило без привязки времени → unknown, не event_time', () => {
  for (const t of ['14.01.2026 07:30 — кровь на посев взята.', '14.01.2026 07:30 — введена первая доза антибиотиков.']) {
    for (const c of X.extract(t, { tz: TZ }).candidates.filter(x => /_at$/.test(x.field)))
      assert.ok(['document_time', 'unknown'].includes(c.time_basis), t + ' ' + c.field + ' = ' + c.time_basis);
  }
});

test('время записи: обычное подтверждение запрещено; явное — с основанием в журнале и источнике', () => {
  const s = sess('22.06.2026 08:30 — Подозрение на НЭК. На фоне энтерального кормления вздутие живота.\n22.06.2026 09:00 — Кормление прекращено.');
  const it = item(s, 'enteral_feeding_stopped_at');
  assert.throws(() => CB.confirm(s, it.candidate.id), /подтвердите явно, что это время события/);
  assert.throws(() => CB.confirm(s, it.candidate.id, { timeIsEvent: true }), /основание/);
  assert.ok(!('enteral_feeding_stopped_at' in CB.build(s).case.data));
  CB.confirm(s, it.candidate.id, T_OK);
  const b = CB.build(s);
  assert.equal(b.case.data.enteral_feeding_stopped_at, '2026-06-22T09:00+05:00');
  assert.equal(b.case.sources.enteral_feeding_stopped_at.time_basis, 'document_time');
  assert.equal(b.case.sources.enteral_feeding_stopped_at.time_confirmation, T_OK.basisReason);
  const j = s.journal.find(x => x.action === 'подтверждено' && x.field === 'enteral_feeding_stopped_at');
  assert.equal(j.time_basis, 'document_time'); assert.equal(j.time_confirmation, T_OK.basisReason);
});

test('без явного подтверждения derive не считает интервал от подозрения до прекращения кормления', () => {
  const s = sess('22.06.2026 08:30 — Подозрение на НЭК. На фоне энтерального кормления вздутие живота.\n22.06.2026 09:00 — Кормление прекращено.');
  for (const it of s.items) if (!CB.needsTimeConfirm(it) && !CB.needsChoice(it.candidate)) CB.confirm(s, it.candidate.id);
  const d1 = Derive.derive(CB.build(s).case.data);
  assert.ok(!('minutes_suspicion_to_feeding_stop' in d1.derived), 'интервала нет');
  for (const it of s.items) if (it.status === CB.STATUS.NEW && CB.needsTimeConfirm(it)) CB.confirm(s, it.candidate.id, T_OK);
  const d2 = Derive.derive(CB.build(s).case.data);
  assert.equal(d2.derived.minutes_suspicion_to_feeding_stop, 30, 'после явного подтверждения обоих времён — 30 мин');
});

test('два наблюдения с одинаковым at, разные значения и тип времени: выбор по индексу и цитате; время записи не подтверждается обычным выбором', () => {
  const text = '05.06.2026 10:00 — Пассаж по ЖКТ не восстановлен. Пассаж восстановлен в 10:00.';
  const s = sess(text); const it = item(s, 'gi_passage_restored');
  assert.deepEqual(it.candidate.timeline.map(t => t.at), ['2026-06-05T10:00+05:00', '2026-06-05T10:00+05:00']);
  // выбор второго (время события) — подтверждено сразу, метаданные — второго наблюдения
  CB.choose(s, it.candidate.id, 1);
  assert.equal(it.status, CB.STATUS.OK); assert.equal(it.choice.index, 1);
  assert.equal(text.slice(it.choice.fragment_start, it.choice.fragment_start + 19), 'Пассаж восстановлен');
  let b = CB.build(s); assert.equal(b.case.data.gi_passage_restored, true); assert.equal(b.case.sources.gi_passage_restored.time_basis, 'event_time');
  // перевыбор первого (время записи) — значение не передаётся, пока не подтверждено явно
  CB.choose(s, it.candidate.id, 0);
  assert.equal(it.status, CB.STATUS.NEW); assert.equal(it.choice.index, 0);
  b = CB.build(s); assert.ok(!('gi_passage_restored' in b.case.data));
  assert.throws(() => CB.confirm(s, it.candidate.id), /подтвердите явно/);
  CB.confirm(s, it.candidate.id, T_OK);
  b = CB.build(s); assert.equal(b.case.data.gi_passage_restored, false); assert.equal(b.case.sources.gi_passage_restored.time_basis, 'document_time');
  const js = s.journal.filter(x => x.field === 'gi_passage_restored').map(x => [x.action, x.chosen_index, x.time_basis]);
  assert.deepEqual(js, [['выбор значения', 1, 'event_time'], ['выбор значения', 0, 'document_time'], ['подтверждено', undefined, 'document_time']]);
});

test('дедуп совпадающих фрагментов не теряет тип времени; явное время цитируется, даже если равно заголовку', () => {
  const t = '14.01.2026 07:30 — введена первая доза антибиотиков в 07:30.';
  const c = X.extract(t, { tz: TZ }).candidates.find(x => x.field === 'first_abx_dose_administered_at');
  assert.equal(c.time_basis, 'event_time');
  assert.ok(c.fragments.some(f => /в 07:30/.test(f.text) || f.start > 20), 'фрагмент включает явное время');
});

test('групповое подтверждение не подтверждает время записи и время неизвестного типа', () => {
  const s = sess('14.01.2026 07:30 — кровь на посев взята.');
  for (const g of [...new Set(s.items.map(i => i.candidate.group))]) CB.confirmGroup(s, g);
  assert.ok(!('blood_culture_drawn_at' in CB.build(s).case.data));
});

// ── Ревью ChatGPT к ae85d85: обход через edit, основание из пробелов, choose без time_confirmation, перевыбор, граница case-builder.
const NEC_TXT = '22.06.2026 08:30 — Подозрение на НЭК. На фоне энтерального кормления вздутие живота.\n22.06.2026 09:00 — Кормление прекращено.';

test('время записи нельзя «исправить» на то же значение (обход подтверждения); прочие поля — как на этапе 7', () => {
  const s = sess('22.06.2026 09:00 — Кормление прекращено.');
  const it = item(s, 'enteral_feeding_stopped_at');
  assert.throws(() => CB.edit(s, it.candidate.id, it.value), /не изменено/);
  assert.throws(() => CB.edit(s, it.candidate.id, it.value, { reason: 'так в записи' }), /не изменено/);
  assert.equal(it.status, CB.STATUS.NEW);
  assert.ok(!('enteral_feeding_stopped_at' in CB.build(s).case.data));
  assert.equal(s.journal.length, 0, 'отказ не пишется в журнал как действие');
  // поле без времени: правка на то же значение допустима (контракт этапа 7, «карточки устаревают только после реальной правки»)
  const s2 = sess('22.06.2026 08:30 — Подозрение на НЭК. Кормление прекращено в 08:40.');
  const e = item(s2, 'enteral_feeding_stopped_at'); CB.confirm(s2, e.candidate.id);
  const fp = CB.fingerprint(CB.build(s2)); CB.edit(s2, e.candidate.id, e.value);
  assert.equal(CB.fingerprint(CB.build(s2)), fp);
});

test('edit времени записи/неизвестного типа требует непустое основание; основание — в журнале и источнике', () => {
  const s = sess('22.06.2026 09:00 — Кормление прекращено.');
  const it = item(s, 'enteral_feeding_stopped_at');
  assert.throws(() => CB.edit(s, it.candidate.id, '2026-06-22T08:50+05:00'), /основание/);
  assert.throws(() => CB.edit(s, it.candidate.id, '2026-06-22T08:50+05:00', { reason: '   ' }), /основание/);
  assert.ok(!('enteral_feeding_stopped_at' in CB.build(s).case.data));
  CB.edit(s, it.candidate.id, '2026-06-22T08:50+05:00', { reason: ' медсестринский лист: прекращено в 08:50 ' });
  const b = CB.build(s);
  assert.equal(b.case.data.enteral_feeding_stopped_at, '2026-06-22T08:50+05:00');
  assert.equal(b.case.sources.enteral_feeding_stopped_at.confidence, 'исправлено врачом');
  assert.equal(b.case.sources.enteral_feeding_stopped_at.time_confirmation, 'медсестринский лист: прекращено в 08:50');
  const j = s.journal.find(x => x.action === 'исправлено');
  assert.equal(j.time_basis, 'document_time'); assert.equal(j.time_confirmation, 'медсестринский лист: прекращено в 08:50');
});

test('основание из пробелов не принимается ни в confirm, ни в choose', () => {
  const s = sess('22.06.2026 09:00 — Кормление прекращено.');
  const it = item(s, 'enteral_feeding_stopped_at');
  assert.throws(() => CB.confirm(s, it.candidate.id, { timeIsEvent: true, basisReason: '  \n ' }), /основание/);
  assert.throws(() => CB.confirm(s, it.candidate.id, { timeIsEvent: 'да', basisReason: 'x' }), /подтвердите явно/);
  const s2 = sess('05.06.2026 10:00 — Пассаж по ЖКТ не восстановлен. Пассаж восстановлен в 10:00.');
  const p = item(s2, 'gi_passage_restored');
  CB.choose(s2, p.candidate.id, 0, { timeIsEvent: true, basisReason: '   ' });
  assert.equal(p.status, CB.STATUS.NEW); assert.equal(p.time_confirmation, null);
});

test('choose с явным подтверждением хранит time_confirmation; build его передаёт; перевыбор очищает', () => {
  const text = '05.06.2026 10:00 — Пассаж по ЖКТ не восстановлен. Пассаж восстановлен в 10:00.';
  const s = sess(text); const it = item(s, 'gi_passage_restored');
  CB.choose(s, it.candidate.id, 0, T_OK);
  assert.equal(it.status, CB.STATUS.OK);
  assert.deepEqual(it.time_confirmation, { basis: 'document_time', reason: T_OK.basisReason });
  let b = CB.build(s);
  assert.equal(b.case.data.gi_passage_restored, false);
  assert.equal(b.case.sources.gi_passage_restored.time_confirmation, T_OK.basisReason);
  // перевыбор на время события — старое основание не тянется
  CB.choose(s, it.candidate.id, 1);
  assert.equal(it.time_confirmation, null);
  b = CB.build(s); assert.equal(b.case.data.gi_passage_restored, true); assert.ok(!('time_confirmation' in b.case.sources.gi_passage_restored));
  // снова на время записи без подтверждения — не передаётся, старое основание не воскресает
  CB.choose(s, it.candidate.id, 0);
  assert.equal(it.status, CB.STATUS.NEW); assert.equal(it.time_confirmation, null);
  assert.ok(!('gi_passage_restored' in CB.build(s).case.data));
  // отклонение после подтверждения: подтверждение снимается
  CB.choose(s, it.candidate.id, 0, T_OK); CB.reject(s, it.candidate.id);
  assert.equal(it.time_confirmation, null); assert.ok(!('gi_passage_restored' in CB.build(s).case.data));
});

test('граница case-builder: время записи со статусом OK/EDITED без подтверждения не передаётся (защита build)', () => {
  const s = sess(NEC_TXT);
  const it = item(s, 'enteral_feeding_stopped_at');
  it.status = CB.STATUS.OK;                 // обход мимо confirm (старый код, ручная правка сессии)
  let b = CB.build(s);
  assert.ok(!('enteral_feeding_stopped_at' in b.case.data)); assert.ok(b.pending_fields.includes('enteral_feeding_stopped_at'));
  it.status = CB.STATUS.EDITED;
  b = CB.build(s); assert.ok(!('enteral_feeding_stopped_at' in b.case.data));
  for (const x of s.items) if (x !== it && !CB.needsTimeConfirm(x)) CB.confirm(s, x.candidate.id);
  assert.ok(!('minutes_suspicion_to_feeding_stop' in Derive.derive(CB.build(s).case.data).derived), 'derive без интервала');
});

test('граница case-builder: временное поле без типа времени считается unknown', () => {
  const s = sess('22.06.2026 08:30 — Подозрение на НЭК. Кормление прекращено в 08:40.');
  const it = item(s, 'enteral_feeding_stopped_at');
  assert.equal(CB.basisOf(it.candidate), 'event_time');
  delete it.candidate.time_basis;
  assert.equal(CB.basisOf(it.candidate), 'unknown');
  assert.ok(CB.needsTimeConfirm(it));
  assert.throws(() => CB.confirm(s, it.candidate.id), /подтвердите явно/);
  CB.confirm(s, it.candidate.id, T_OK);
  assert.equal(CB.build(s).case.sources.enteral_feeding_stopped_at.time_basis, 'unknown');
});

test('групповое подтверждение пропускает время записи независимо от признака «критическое»', () => {
  const s = sess('22.06.2026 09:00 — Кормление прекращено.');
  const it = item(s, 'enteral_feeding_stopped_at');
  it.candidate.critical = false;
  const r = CB.confirmGroup(s, it.candidate.group);
  assert.ok(r.skipped.includes(it.candidate.id)); assert.equal(it.status, CB.STATUS.NEW);
  assert.ok(!('enteral_feeding_stopped_at' in CB.build(s).case.data));
});

test('список (СРБ): источник содержит тип времени каждого элемента', () => {
  const s = sess('05.03.2026 09:20 — Исходный СРБ взят.');
  const it = item(s, 'crp_samples');
  assert.throws(() => CB.confirm(s, it.candidate.id), /подтвердите явно/);
  CB.confirm(s, it.candidate.id, T_OK);
  const src = CB.build(s).case.sources.crp_samples;
  assert.deepEqual(src.time_basis_items.map(x => x.time_basis), ['document_time']);
  assert.equal(src.time_confirmation, T_OK.basisReason);
});
