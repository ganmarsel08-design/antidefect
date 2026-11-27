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
  // таблица — по заголовку (ревью 8622515: любой «|» больше не означает «назначено»)
  assert.deepEqual(ev('Дата | Назначено | Доза\n14.01.2026 | Гентамицин | 6 мг'), [['гентамицин', 'prescribed']]);
  assert.deepEqual(ev('Дата | Препарат | Доза\n14.01.2026 | Гентамицин | 6 мг'), [['гентамицин', 'mentioned']]);
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

// ── Ревью ChatGPT к 8622515: статус — у конкретного препарата; неоднозначность → «не определён».
const evAt = t => X.extract(t, { tz: '+05:00' }).medication_events.map(e => [e.drug, e.status, e.at]);
test('смешанные: у каждого препарата свой глагол', () => {
  assert.deepEqual(ev('Гентамицин назначен, ампициллин введён.'), [['гентамицин', 'prescribed'], ['ампициллин', 'administered']]);
  assert.deepEqual(ev('Гентамицин введён, ампициллин отменён.'), [['гентамицин', 'administered'], ['ампициллин', 'cancelled']]);
  assert.deepEqual(ev('Ампициллин введён вчера, гентамицин планируется.'), [['ампициллин', 'administered'], ['гентамицин', 'planned']]);
  assert.deepEqual(ev('Ампициллин введён, а гентамицин не вводился.'), [['ампициллин', 'administered'], ['гентамицин', 'not_administered']]);
});
test('отрицания и указания', () => {
  assert.deepEqual(ev('Гентамицин не назначен.'), [['гентамицин', 'not_prescribed']]);
  assert.deepEqual(ev('Гентамицин не вводить.'), [['гентамицин', 'withheld']]);
  assert.deepEqual(ev('14.01.2026 08:00 — Назначен ампициллин 100 мг. Введено не было.'), [['ампициллин', 'not_administered']]);
  assert.deepEqual(ev('Ампициллин назначен, введён не был.'), [['ампициллин', 'not_administered']]);
});
test('неоднозначность → «не определён», а не «введено»', () => {
  assert.deepEqual(ev('Назначены ампициллин и гентамицин. Введено не было.'), [['ампициллин', 'unknown'], ['гентамицин', 'unknown']]);
  assert.deepEqual(ev('Ампициллин и гентамицин назначены, введён в 08:00.'), [['ампициллин', 'unknown'], ['гентамицин', 'unknown']]);
  assert.deepEqual(ev('Гентамицин назначен, ампициллин введён, метронидазол.'), [['гентамицин', 'prescribed'], ['ампициллин', 'administered'], ['метронидазол', 'unknown']]);
  const n = X.extract('Назначены ампициллин и гентамицин. Введено не было.', { tz: '+05:00' }).medication_events[0];
  assert.equal(n.status_label, 'не определён'); assert.match(n.note, /нескольк\S* препарат/);
});
test('«начат» — не введение дозы', () => {
  assert.deepEqual(ev('14.01.2026 07:30 — Начат ампициллин 100 мг/кг/сут.'), [['ампициллин', 'started']]);
  assert.equal(X.extract('Начат ампициллин.', { tz: '+05:00' }).medication_events[0].at, null);
});
test('время — у глагола введения этого препарата', () => {
  assert.deepEqual(evAt('14.01.2026 07:30 — Гентамицин назначен в 07:30, ампициллин введён в 07:50.'), [['гентамицин', 'prescribed', null], ['ампициллин', 'administered', '2026-01-14T07:50+05:00']]);
  assert.deepEqual(evAt('14.01.2026 07:30 — Ампициллин введён в 07:50, гентамицин отменён в 08:10.'), [['ампициллин', 'administered', '2026-01-14T07:50+05:00'], ['гентамицин', 'cancelled', null]]);
});
test('таблица результатов и таблица «не назначено» — не назначение', () => {
  assert.deepEqual(ev('Посев | Возбудитель | Чувствительность\nкровь | E. coli | ампициллин R, гентамицин S'), [['ампициллин', 'mentioned'], ['гентамицин', 'mentioned']]);
  assert.deepEqual(ev('Препарат | Назначено | Введено\nГентамицин | не назначен | —'), [['гентамицин', 'not_prescribed']]);
  assert.deepEqual(ev('Время | Введено\n07:40 | ампициллин 100 мг'), [['ампициллин', 'administered']]);
});
test('скопированный и ошибочный текст — не источник', () => {
  assert.deepEqual(ev('Скопировано из вчерашней записи: гентамицин введён. Фактически сегодня ампициллин назначен.'), [['ампициллин', 'prescribed']]);
  assert.deepEqual(ev('Ошибочно указан гентамицин введён, верно: ампициллин введён.'), [['ампициллин', 'administered']]);
});
test('мать в одной части, ребёнок в другой', () => {
  assert.deepEqual(ev('Матери введён ампициллин 2 г, ребёнку назначен гентамицин.'), [['гентамицин', 'prescribed']]);
});

test('сведения о препаратах не влияют на случай и derive (смешанный и отрицательный текст)', () => {
  const CB = require('../case-builder.js'), Derive = require('../derive.js'), SIM = require('./tools/time-confirm-sim.js');
  const text = '14.01.2026 07:30 — Гентамицин назначен, ампициллин введён в 07:50. Метронидазол не вводить. Назначены цефотаксим и амикацин. Введено не было. Начат ванкомицин.\n14.01.2026 06:00 — Масса 3,1 кг.';
  const run = drop => {
    const x = X.extract(text, { tz: '+05:00' }); if (drop) x.medication_events = [];
    let k = 0; const s = CB.createSession({ extraction: x, actor: 'т', now: () => 't' + k++ });
    for (const it of s.items) { if (CB.needsChoice(it.candidate)) CB.choose(s, it.candidate.id, 0); }
    for (const it of s.items) if (it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id, CB.needsTimeConfirm(it) ? SIM.confirmOpts(it, 'симуляция') : undefined);
    const b = CB.build(s); return { data: b.case.data, derived: Derive.derive(b.case.data) };
  };
  const a = run(false), b = run(true);
  assert.deepEqual(a, b);
  assert.ok(Object.keys(a.data).every(f => !/medication|metronidazole|vancomycin|cefotaxime|amikacin/.test(f)), Object.keys(a.data).join());
});

// ── Самостоятельный поиск ошибок 27.11 (синтетические контрпримеры)
test('«продолжен» / «не отменён» — не «отменено»; соседний статус не переносится', () => {
  assert.deepEqual(ev('Ампициллин отменён 02.03.2026 10:00, гентамицин продолжен.'), [['ампициллин', 'cancelled'], ['гентамицин', 'continued']]);
  assert.deepEqual(ev('Гентамицин отменён, ампициллин продолжается.'), [['гентамицин', 'cancelled'], ['ампициллин', 'continued']]);
  assert.deepEqual(ev('Ампициллин не отменён.'), [['ампициллин', 'continued']]);
  assert.equal(X.extract('Ампициллин не отменён.', { tz: '+05:00' }).medication_events[0].status_label, 'продолжено (не отменено)');
});
test('сомнение во фразе или в следующей фразе — «не определён», время не выдаётся', () => {
  for (const t of ['Ампициллин введён 02.03.2026 07:50? уточнить у медсестры.', 'Ампициллин введён 02.03.2026 07:50. Уточнить у медсестры.', 'Ампициллин введён под вопросом.']) {
    const e = X.extract(t, { tz: '+05:00' }).medication_events;
    assert.deepEqual(e.map(x => [x.drug, x.status, x.at]), [['ампициллин', 'unknown', null]], t);
    assert.match(e[0].note, /сомнение/);
  }
});
test('запись о введении названа ошибочной — «не определён»; ошибка другого объекта — нет', () => {
  assert.deepEqual(ev('Ампициллин введён ошибочно, запись аннулирована.'), [['ампициллин', 'unknown']]);
  assert.deepEqual(ev('Ампициллин введён. Запись о введении аннулирована.'), [['ампициллин', 'unknown']]);
  assert.deepEqual(ev('Ампициллин введён; ошибка маркировки устранена.'), [['ампициллин', 'administered']]);
  assert.deepEqual(ev('Ампициллин введён; неверный номер палаты исправлен.'), [['ампициллин', 'administered']]);
});
