// Проверка оценщика на технических искусственных примерах (не клинические истории, не набор разработки).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../match.js');
const RD = require('../reading.js');
const C = require('../common.js');

const dd = {
  gentamicin_dose_mg: { type: 'number', description: 'Разовая доза гентамицина' },
  surfactant_given: { type: 'tri', description: 'Сурфактант введён' },
  blood_culture_drawn_at: { type: 'datetime', description: 'Время забора крови на посев' },
  nec_stage: { type: 'enum', values: ['1а', '2а'], description: 'Стадия НЭК' },
  blood_gases: { type: 'list', description: 'Газы крови' },
  gi_passage_restored: { type: 'tri', description: 'Пассаж восстановлен' },
  abx_regimen: { type: 'list', description: 'Схема' },
};
const sets = { partA: Object.keys(dd), critical: ['gentamicin_dose_mg', 'blood_culture_drawn_at', 'gi_passage_restored'] };
const text = [
  'ТЕХ: доза А = 10 мг', // 0
  'ТЕХ: доза Б = 12 мг',
  'ТЕХ: средство С не вводилось',
  'ТЕХ: момент Х 2026-01-02 03:04',
  'ТЕХ: в планах доза 99 мг',
  'ТЕХ: ошибочно было 8 мг',
].join('\n');
const at = q => { const s = text.indexOf(q); return { start: s, end: s + q.length, text: q }; };
const fact = (fid, field, value, quote, extra) => Object.assign({ fid, field, value, quote, location: 'body', record_status: 'current', time_basis: null }, extra || {});
const H = facts => ({ id: 'ТЕХ', protocol: 'Сепсис', format: 'txt', facts, traps: [] });

test('В: однозначный верный кандидат; фрагмент совпадает с цитатой', () => {
  const r = M.scoreHistory({ h: H([fact('F1', 'gentamicin_dose_mg', 10, 'доза А = 10 мг')]), text, dd, sets,
    extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: '10', fragments: [at('доза А = 10 мг')] }] } });
  assert.equal(r.units[0].cls, 'В'); assert.equal(r.units[0].fragOk, true); assert.equal(r.lp.length, 0);
});

test('ВА и ЛП в альтернативах; П при отсутствии кандидата', () => {
  const h = H([fact('F1', 'gentamicin_dose_mg', 10, 'доза А = 10 мг'), fact('F2', 'blood_culture_drawn_at', '2026-01-02T03:04+05:00', 'момент Х 2026-01-02 03:04')]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', alternatives: [{ value: 10, fragments: [at('доза А = 10 мг')] }, { value: 99, fragments: [at('доза 99 мг')] }] }] } });
  assert.deepEqual(r.units.map(u => u.cls).sort(), ['ВА', 'П']);
  assert.equal(r.lp.length, 1); assert.equal(r.lp[0].single, false);
});

test('О молчаливая (доза), устаревшее значение — ЛП «устаревшее», нулевые критерии считают молчаливую ошибку', () => {
  const h = H([fact('F1', 'gentamicin_dose_mg', 12, 'доза Б = 12 мг'), fact('F0', 'gentamicin_dose_mg', 8, 'ошибочно было 8 мг', { record_status: 'superseded', superseded_by: 'F1' })]);
  const r1 = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 10, fragments: [at('доза А = 10 мг')] }] } });
  assert.equal(r1.units[0].cls, 'О'); assert.equal(r1.units[0].silent, true); assert.equal(r1.units[0].sub, 'доза');
  assert.equal(M.zeroCounts(r1).dose.k, 1);
  const r2 = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 8, fragments: [at('ошибочно было 8 мг')] }] } });
  assert.equal(r2.units[0].cls, 'П'); assert.equal(r2.lp[0].kind, 'устаревшее значение');
});

test('отрицание: «нет» верно; «да» вместо «нет» — ошибочное отрицание; ловушка negation срабатывает', () => {
  const h = H([fact('F1', 'surfactant_given', false, 'средство С не вводилось')]);
  h.traps = [{ tid: 'T1', type: 'negation', quote: 'средство С не вводилось', location: 'body', field: 'surfactant_given', must_not_value: true }];
  const ok = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'surfactant_given', value: false, fragments: [at('средство С не вводилось')] }] } });
  assert.equal(ok.units[0].cls, 'В'); assert.equal(ok.traps[0].status, 'выдержана'); assert.equal(M.zeroCounts(ok).negplan.k, 0);
  const bad = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'surfactant_given', value: true, fragments: [at('средство С не вводилось')] }] } });
  assert.equal(bad.units[0].negErr, true); assert.equal(bad.traps[0].status, 'сработала');
  // одна и та же ошибка (О да/нет и срабатывание ловушки negation) считается один раз (метод 1.2)
  assert.equal(M.zeroCounts(bad).negplan.k, 1); assert.equal(M.zeroCounts(bad).negplan.n, 2);
});

test('план: ловушка с must_not_value "any" срабатывает и даёт ЛП типа plan', () => {
  const h = H([]); h.traps = [{ tid: 'T1', type: 'plan', quote: 'в планах доза 99 мг', location: 'body', field: 'gentamicin_dose_mg', must_not_value: 'any' }];
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 99, fragments: [at('доза 99 мг')] }] } });
  assert.equal(r.traps[0].status, 'сработала'); assert.equal(r.lp[0].kind, 'plan'); assert.equal(M.zeroCounts(r).negplan.k, 1);
});

test('время: неверное время — молчаливая ошибка времени; дата без времени — придуманное время считается', () => {
  const h = H([fact('F1', 'blood_culture_drawn_at', '2026-01-02T03:04+05:00', 'момент Х 2026-01-02 03:04')]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'blood_culture_drawn_at', value: '2026-01-02T03:40+05:00', fragments: [at('момент Х 2026-01-02 03:04')] }] } });
  assert.equal(r.units[0].cls, 'О'); assert.equal(r.units[0].timeErr, true); assert.equal(M.zeroCounts(r).time.k, 1);
  const h2 = H([fact('F1', 'blood_culture_drawn_at', null, 'момент Х 2026-01-02', { event_date: '2026-01-02', time_basis: 'date_only' })]);
  const r2 = M.scoreHistory({ h: h2, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'blood_culture_drawn_at', value: '2026-01-02T00:00+05:00', fragments: [at('момент Х 2026-01-02 03:04')] }] } });
  assert.equal(r2.dateOnly[0].invented.length, 1); assert.equal(M.zeroCounts(r2).time.k, 1); assert.equal(r2.units.length, 0);
});

test('список: верный элемент; элемент с неверным временем — О «время элемента»; лишний — ЛП', () => {
  const g = (t, p) => ({ drawn_at: t, ph: 7.3, paco2_mmhg: p });
  const h = H([fact('F1', 'blood_gases', g('2026-01-02T03:04+05:00', 40), 'доза А = 10 мг'), fact('F2', 'blood_gases', g('2026-01-02T05:00+05:00', 30), 'доза Б = 12 мг')]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'blood_gases', value: [g('2026-01-02T03:04+05:00', 40), g('2026-01-02T06:00+05:00', 30), g('2026-01-03T01:00+05:00', 50)], fragments: [at('доза А = 10 мг'), at('доза Б = 12 мг'), at('доза 99 мг')] }] } });
  assert.deepEqual(r.units.map(u => u.cls + (u.sub ? ':' + u.sub : '')), ['В', 'О:время элемента']);
  assert.equal(r.lp.length, 1);
});

test('динамика gi_passage_restored: наблюдения по времени; неверное время — ошибка времени', () => {
  const h = H([fact('F1', 'gi_passage_restored', false, 'доза А = 10 мг', { event_at: '2026-01-02T08:00+05:00' }), fact('F2', 'gi_passage_restored', true, 'доза Б = 12 мг', { event_at: '2026-01-04T09:00+05:00' })]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gi_passage_restored', timeline: [
    { v: false, at: '2026-01-02T08:00+05:00', date: '2026-01-02', fragment: at('доза А = 10 мг') }, { v: true, at: '2026-01-04T10:00+05:00', date: '2026-01-04', fragment: at('доза Б = 12 мг') }] }] } });
  assert.deepEqual(r.units.map(u => u.cls), ['В', 'О']); assert.equal(r.units[1].timeErr, true);
});

test('схема АБТ: набор препаратов без учёта порядка и регистра', () => {
  const h = H([fact('F1', 'abx_regimen', ['Ампициллин', 'гентамицин'], 'доза А = 10 мг')]);
  dd.abx_regimen.type = 'list';
  const r = M.scoreHistory({ h, text, dd: Object.assign({}, dd, { abx_regimen: { type: 'list' } }), sets, extraction: { candidates: [{ id: 'c1', field: 'abx_regimen', value: ['гентамицин', 'ампициллин'], fragments: [at('доза А = 10 мг')] }] } });
  assert.equal(r.units[0].cls, 'В');
});

test('повторы одного значения учитываются один раз; верное значение из другого места отмечается', () => {
  const h = H([fact('F1', 'gentamicin_dose_mg', 12, 'доза Б = 12 мг'), fact('F2', 'gentamicin_dose_mg', 12, 'доза Б = 12 мг', { same_as: 'F1' })]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 12, fragments: [at('доза А = 10 мг')] }] } });
  assert.equal(r.units.length, 1); assert.equal(r.units[0].cls, 'В'); assert.equal(r.units[0].fragOk, false);
});

test('факты в непрочитываемых местах не входят в полноту и учитываются отдельно', () => {
  const h = H([fact('F1', 'gentamicin_dose_mg', 12, 'х', { location: 'footnote' })]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [] } });
  assert.equal(r.units.length, 0); assert.equal(r.unreadFacts.length, 1);
});

test('чтение DOCX: таблица — не ошибка; предупреждения по типам; ложные предупреждения; утечка удалённого текста', () => {
  const ref = { body: [{ kind: 'paragraph', text: 'Абзац один' }, { kind: 'table', rows: [['А1', 'Б1'], ['А2', 'Б2']] }], unread: [{ type: 'footnote', text: 'сноска с важным' }, { type: 'textbox', text: 'надпись внутри' }], deleted: ['удалено'] };
  const prog = 'Абзац один\nА1 | Б1\nА2 | Б2';
  const r = RD.scoreReading({ id: 'Т', ref, programText: prog, warnings: ['не прочитано: надпись (текстовое поле) — 1 шт.', 'не прочитано: рисунок — 1 шт.', 'не прочитано: сноски', 'не прочитано: примечания рецензента'] });
  assert.equal(r.body_recall, 1); assert.equal(r.body_precision, 1);
  assert.equal(r.detected, 2); assert.deepEqual(r.false_warnings, ['comment']);
  const r2 = RD.scoreReading({ id: 'Т', ref, programText: prog + '\nудалено', warnings: [] });
  assert.equal(r2.detected, 0); assert.equal(r2.leaks.length, 1); assert.ok(r2.body_precision < 1);
  assert.equal(RD.refText(ref), prog);
});

test('интервалы: Уилсон, кластерный бутстреп воспроизводим, верхняя граница при k=0', () => {
  const pairs = [{ num: 9, den: 10 }, { num: 5, den: 10 }, { num: 10, den: 10 }];
  assert.deepEqual(C.clusterBoot(pairs, 2000, 1), C.clusterBoot(pairs, 2000, 1));
  assert.ok(C.wilson(8, 10)[0] < 0.8 && C.wilson(8, 10)[1] > 0.8);
  assert.equal(C.zeroUpper(0), null); assert.ok(Math.abs(C.zeroUpper(30) - 0.0950) < 0.001);
});

// --- регрессия по аудиту 1.1 → 1.2 ---
test('аудит 1.2: однозначная доза из устаревшей записи (П + ЛП) учитывается в нулевом критерии доз', () => {
  const h = H([fact('F1', 'gentamicin_dose_mg', 12, 'доза Б = 12 мг'), fact('F0', 'gentamicin_dose_mg', 8, 'ошибочно было 8 мг', { record_status: 'superseded', superseded_by: 'F1' })]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 8, fragments: [at('ошибочно было 8 мг')] }] } });
  assert.equal(r.units[0].cls, 'П'); assert.equal(r.lp[0].kind, 'устаревшее значение');
  const z = M.zeroCounts(r).dose; assert.equal(z.k, 1); assert.equal(z.n, 2);
});

test('аудит 1.2: однозначное дата-время без текущего факта в эталоне — ошибка времени', () => {
  const r = M.scoreHistory({ h: H([]), text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'blood_culture_drawn_at', value: '2026-01-02T03:04+05:00', fragments: [at('момент Х 2026-01-02 03:04')] }] } });
  assert.equal(r.units.length, 0); assert.equal(r.lp.length, 1);
  const z = M.zeroCounts(r).time; assert.equal(z.k, 1); assert.equal(z.n, 1);
});

test('аудит 1.2: ЛП в альтернативах не входит в «молчаливые»; лишний элемент списка и наблюдение динамики — входят', () => {
  const r = M.scoreHistory({ h: H([]), text, dd, sets, extraction: { candidates: [
    { id: 'c1', field: 'blood_culture_drawn_at', alternatives: [{ value: '2026-01-02T03:04+05:00', fragments: [] }, { value: '2026-01-02T05:00+05:00', fragments: [] }] },
    { id: 'c2', field: 'blood_gases', value: [{ drawn_at: '2026-01-02T03:04+05:00', ph: 7.3 }], fragments: [at('доза А = 10 мг')] },
    { id: 'c3', field: 'gi_passage_restored', timeline: [{ v: true, at: '2026-01-02T03:04+05:00', date: '2026-01-02', fragment: at('доза Б = 12 мг') }] }] } });
  const z = M.zeroCounts(r).time; assert.equal(z.k, 2); assert.equal(z.n, 2);
});

test('аудит 1.2: одна ошибка дозы как ЛП и как срабатывание ловушки unit_not_field_unit — один раз', () => {
  const h = H([]); h.traps = [{ tid: 'T1', type: 'unit_not_field_unit', quote: 'доза 99 мг', location: 'body', field: 'gentamicin_dose_mg', must_not_value: 99 }];
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 99, fragments: [at('доза 99 мг')] }] } });
  assert.equal(r.traps[0].status, 'сработала'); assert.equal(r.lp.length, 1);
  const z = M.zeroCounts(r).dose; assert.equal(z.k, 1); assert.equal(z.n, 1);
});

test('аудит 1.2: О дозы и та же ошибка в ловушке — один раз; правильная доза не увеличивает k', () => {
  const h = H([fact('F1', 'gentamicin_dose_mg', 12, 'доза Б = 12 мг')]);
  h.traps = [{ tid: 'T1', type: 'dose_without_unit', quote: 'доза А = 10 мг', location: 'body', field: 'gentamicin_dose_mg', must_not_value: 'any' }];
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'gentamicin_dose_mg', value: 10, fragments: [at('доза А = 10 мг')] }] } });
  assert.equal(r.units[0].cls, 'О');
  const z = M.zeroCounts(r).dose; assert.equal(z.k, 1); assert.equal(z.n, 2);
});

// --- аудит 1.3 → 1.4: отрицательные наблюдения пассажа (gi_passage_restored) в критерии negplan ---
const giH = (extraTraps) => { const h = H([fact('F1', 'gi_passage_restored', false, 'доза А = 10 мг', { event_at: '2026-06-08T08:00+05:00', time_basis: 'explicit' })]); h.traps = extraTraps || []; return h; };
const giCand = v => ({ candidates: [{ id: 'c1', field: 'gi_passage_restored', timeline: [{ v, at: '2026-06-08T08:00+05:00', date: '2026-06-08', fragment: at('доза А = 10 мг') }] }] });

test('1.4: пассаж — верное «нет» в наблюдении: N = 1, k = 0', () => {
  const r = M.scoreHistory({ h: giH(), text, dd, sets, extraction: giCand(false) });
  assert.equal(r.units[0].cls, 'В');
  assert.deepEqual([M.zeroCounts(r).negplan.n, M.zeroCounts(r).negplan.k], [1, 0]);
});

test('1.4: пассаж — пропущенное «нет»: N = 1, k = 0 (пропуск учитывается в полноте, не в negplan)', () => {
  const r = M.scoreHistory({ h: giH(), text, dd, sets, extraction: { candidates: [] } });
  assert.equal(r.units[0].cls, 'П');
  assert.deepEqual([M.zeroCounts(r).negplan.n, M.zeroCounts(r).negplan.k], [1, 0]);
});

test('1.4: пассаж — ошибочное однозначное «да» вместо «нет» в том же наблюдении: N = 1, k = 1 (случай аудита)', () => {
  const r = M.scoreHistory({ h: giH(), text, dd, sets, extraction: giCand(true) });
  assert.equal(r.units[0].cls, 'О'); assert.equal(r.units[0].silent, true); assert.equal(r.units[0].negErr, true);
  assert.deepEqual([M.zeroCounts(r).negplan.n, M.zeroCounts(r).negplan.k], [1, 1]);
});

test('1.4: пассаж — то же ошибочное «да» и ловушка negation на той же цитате: N = 2, k = 1 (без двойного подсчёта)', () => {
  const trap = { tid: 'T1', type: 'negation', quote: 'доза А = 10 мг', location: 'body', field: 'gi_passage_restored', must_not_value: true };
  const r = M.scoreHistory({ h: giH([trap]), text, dd, sets, extraction: giCand(true) });
  assert.equal(r.traps[0].status, 'сработала');
  assert.deepEqual([M.zeroCounts(r).negplan.n, M.zeroCounts(r).negplan.k], [2, 1]);
});

test('1.4: пассаж — «да» в эталоне не входит в N negplan; верное «да» и ошибочное «нет» критерий не затрагивают', () => {
  const h = H([fact('F1', 'gi_passage_restored', true, 'доза А = 10 мг', { event_at: '2026-06-08T08:00+05:00' })]);
  for (const v of [true, false]) {
    const r = M.scoreHistory({ h, text, dd, sets, extraction: giCand(v) });
    assert.deepEqual([M.zeroCounts(r).negplan.n, M.zeroCounts(r).negplan.k], [0, 0]);
  }
});
