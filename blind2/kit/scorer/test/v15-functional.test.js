// Оценщик 1.5: функциональные тесты (поведение вывода, а не regex исходника). Только синтетические данные.
// Ревью ChatGPT к e0d946b: тип времени сквозно, «часть не оценивалась», дозовые поля, дубли списков, инвариантность к порядку.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require('../match.js');
const I = require('../impact.js');
const KIT = path.resolve(__dirname, '..', '..');
const REPO = process.env.ANTIDEFECT_REPO || path.resolve(KIT, '..', '..');

const dd = { blood_culture_drawn_at: { type: 'datetime' }, first_abx_dose_administered_at: { type: 'datetime' }, gentamicin_dose_mg: { type: 'number' },
  blood_gases: { type: 'list' }, xrays: { type: 'list' }, gi_passage_restored: { type: 'tri' } };
const sets = { partA: Object.keys(dd), critical: [] };
const text = 'Кровь на посев взята 02.03.2026 07:30. Доза 5 мг. 02.03.2026 07:30 pH 7,3 PaCO2 30. 02.03.2026 07:30 pH 7,2 PaCO2 60.';
const at = q => { const s = text.indexOf(q); return { start: s, end: s + q.length, text: q }; };
const fact = (fid, field, value, quote, extra) => Object.assign({ fid, field, value, quote, location: 'body', record_status: 'current', time_basis: null }, extra || {});
const H = (facts, traps) => ({ id: 'ТЕХ', protocol: 'Сепсис', format: 'txt', facts, traps: traps || [] });
const T = '2026-03-02T07:30+05:00';
const run = (gk, cand) => {
  const h = H([fact('F1', 'blood_culture_drawn_at', T, 'взята 02.03.2026 07:30', gk === undefined ? {} : { time_kind: gk })]);
  const c = Object.assign({ id: 'c1', field: 'blood_culture_drawn_at', value: T, fragments: [at('взята 02.03.2026 07:30')] }, cand);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [c] } });
  return { r, u: r.units[0], z: M.zeroCounts(r) };
};

const DT_TRAP = [{ tid: 'T-DOC', type: 'document_time_as_event', quote: 'взята 02.03.2026 07:30', location: 'body', field: 'blood_culture_drawn_at', must_not_value: 'any' }];
const runDoc = cand => {
  const c = Object.assign({ id: 'c1', field: 'blood_culture_drawn_at', value: T, fragments: [at('взята 02.03.2026 07:30')] }, cand);
  const r = M.scoreHistory({ h: H([], DT_TRAP), text, dd, sets, extraction: { candidates: [c] } });
  return { r, t: r.traps[0], z: M.zeroCounts(r) };
};
test('единственный вариант: время записи фактом не размечается; ловушка document_time_as_event срабатывает на кандидате с event_time, входит в нулевой критерий времени', () => {
  const { t, z } = runDoc({ time_basis: 'event_time' });
  assert.equal(t.status, 'сработала'); assert.equal(z.time.k, 1); assert.equal(z.time.n >= 1, true);
});
test('единственный вариант: document_time / unknown / нет time_basis у кандидата — ловушка выдержана', () => {
  for (const tb of ['document_time', 'unknown', undefined]) { const { t, z } = runDoc(tb === undefined ? {} : { time_basis: tb }); assert.equal(t.status, 'выдержана', String(tb)); assert.equal(z.time.k, 0); }
});
test('единственный вариант: ловушка в альтернативе event_time — срабатывает, но не как однозначная ошибка', () => {
  const { t, z } = runDoc({ value: undefined, alternatives: [{ value: T, fragments: [at('взята 02.03.2026 07:30')], time_basis: 'event_time' }] });
  assert.equal(t.status, 'сработала'); assert.equal(z.time.k, 0, 'альтернатива не однозначна');
});
test('единственный вариант: элемент списка с event_time по time_basis_items', () => {
  const el = { drawn_at: T, ph: 7.3, paco2_mmhg: 30 };
  const trap = [{ tid: 'T-DOC2', type: 'document_time_as_event', quote: '07:30 pH 7,3 PaCO2 30', location: 'body', field: 'blood_gases', must_not_value: 'any' }];
  const mk = tb => ({ candidates: [{ id: 'c', field: 'blood_gases', value: [el], fragments: [at('07:30 pH 7,3 PaCO2 30')], time_basis_items: [{ index: 0, time_basis: tb }] }] });
  assert.equal(M.scoreHistory({ h: H([], trap), text, dd, sets, extraction: mk('event_time') }).traps[0].status, 'сработала');
  assert.equal(M.scoreHistory({ h: H([], trap), text, dd, sets, extraction: mk('document_time') }).traps[0].status, 'выдержана');
});
test('единственный вариант: факт эталона с time_kind=document_time недопустим и для оценщика (останов, а не молчаливое решение)', () => {
  const h = H([fact('F1', 'blood_culture_drawn_at', T, 'взята 02.03.2026 07:30', { time_kind: 'document_time' })]);
  assert.throws(() => M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c1', field: 'blood_culture_drawn_at', value: T, time_basis: 'event_time', fragments: [at('взята 02.03.2026 07:30')] }] } }), /time_kind=document_time недопустим/);
});
test('тип времени: событие в эталоне — event_time верно; document_time/unknown/нет — значение верно, «требует подтверждения»', () => {
  assert.equal(run('event_time', { time_basis: 'event_time' }).u.tk.tkConfirm, false);
  for (const tb of ['document_time', 'unknown', undefined]) { const { u } = run('event_time', tb === undefined ? {} : { time_basis: tb }); assert.equal(u.cls, 'В'); assert.equal(u.tk.tkConfirm, true, String(tb)); }
});
test('тип времени: у факта эталона нет time_kind — помечается, не молча', () => {
  assert.equal(run(undefined, { time_basis: 'event_time' }).u.tk.tkMissing, true);
});

test('дозовые поля: время первой дозы — не доза; негативный функциональный тест (ошибка времени не попадает в дозовый критерий)', () => {
  const h = H([fact('F1', 'first_abx_dose_administered_at', T, 'взята 02.03.2026 07:30', { time_kind: 'event_time' })]);
  const r = M.scoreHistory({ h, text, dd, sets, extraction: { candidates: [{ id: 'c', field: 'first_abx_dose_administered_at', value: '2026-03-02T09:00+05:00', time_basis: 'event_time', fragments: [at('взята 02.03.2026 07:30')] }] } });
  const z = M.zeroCounts(r);
  assert.equal(z.dose.n, 0, 'не дозовое поле'); assert.equal(z.dose.k, 0);
  assert.equal(z.time.k, 1, 'ошибка времени учтена во времени');
  const h2 = H([fact('F1', 'gentamicin_dose_mg', 5, 'Доза 5 мг')]);
  const z2 = M.zeroCounts(M.scoreHistory({ h: h2, text, dd, sets, extraction: { candidates: [{ id: 'c', field: 'gentamicin_dose_mg', value: 6, fragments: [at('Доза 5 мг')] }] } }));
  assert.equal(z2.dose.n, 1); assert.equal(z2.dose.k, 1);
});

test('«часть не оценивалась»: функциональный вывод impactHistory (не «иное», причин нет)', () => {
  const env = I.loadEnv(REPO);
  const F = (fid, field, value) => ({ fid, field, value, quote: 'х', location: 'body', record_status: 'current' });
  const facts = [F('1', 'gestational_age_weeks', 29), F('2', 'rds_diagnosed', true), F('3', 'rds_risk', true), F('4', 'cpap_from_birth', true)];
  const r = I.impactHistory(env, { id: 'Т', protocol: 'РДС', facts }, { candidates: [] }, '+05:00');
  const parts = r.modes.stress.pairs.filter(p => p.cls === 'часть не оценивалась');
  assert.ok(parts.length > 0, 'есть пары без метки движка');
  for (const p of parts) { assert.deepEqual(p.fields, []); assert.deepEqual(p.cause_set, []); assert.equal(p.extracted, undefined); }
  assert.ok(!r.modes.stress.pairs.some(p => p.extracted === undefined && p.cls === 'иное'));
});

// ---- дубли и конфликты списков (impact.js / match.js согласованы) ----
const bg = (v, ph, pc) => ({ drawn_at: v, ph, paco2_mmhg: pc });
const gF = (fid, el, extra) => fact(fid, 'blood_gases', el, '07:30 pH 7,3 PaCO2 30', extra);
test('эталон: точный дубль списка сворачивается', () => {
  const g = I.goldData(H([gF('A', bg(T, 7.3, 30)), gF('B', bg(T, 7.3, 30))]), dd, '+05:00');
  assert.equal(g.data.blood_gases.length, 1); assert.deepEqual(g.ambiguous, []);
});
test('эталон: одинаковое время и разные значения — конфликт, поле неоднозначно, не «первый выигрывает»; порядок не влияет', () => {
  const a = I.goldData(H([gF('A', bg(T, 7.3, 30)), gF('B', bg(T, 7.2, 60))]), dd, '+05:00');
  const b = I.goldData(H([gF('B', bg(T, 7.2, 60)), gF('A', bg(T, 7.3, 30))]), dd, '+05:00');
  assert.deepEqual(a.ambiguous, ['blood_gases']); assert.equal(a.data.blood_gases, undefined);
  assert.deepEqual(a, b);
});
test('эталон: разное время — отдельные элементы, порядок фактов не влияет на состав', () => {
  const x = bg(T, 7.3, 30), y = bg('2026-03-02T09:00+05:00', 7.2, 60);
  const a = I.goldData(H([gF('A', x), gF('B', y)]), dd, '+05:00').data.blood_gases;
  const b = I.goldData(H([gF('B', y), gF('A', x)]), dd, '+05:00').data.blood_gases;
  assert.equal(a.length, 2); assert.deepEqual(a.map(e => e.drawn_at).sort(), b.map(e => e.drawn_at).sort());
});
test('оценка совпадения: два элемента с одним временем и разными значениями — две единицы, обе В, при любом порядке фактов и кандидатов', () => {
  const x = bg(T, 7.3, 30), y = bg(T, 7.2, 60);
  const cands = es => ({ candidates: [{ id: 'c', field: 'blood_gases', value: es, fragments: es.map(() => at('07:30 pH 7,3 PaCO2 30')) }] });
  const outs = [];
  for (const fo of [[x, y], [y, x]]) for (const co of [[x, y], [y, x]]) {
    const r = M.scoreHistory({ h: H(fo.map((e, i) => gF('F' + i, e))), text, dd, sets, extraction: cands(co) });
    assert.equal(r.units.length, 2); assert.deepEqual(r.units.map(u => u.cls), ['В', 'В']); assert.ok(r.units.every(u => u.conflict === true));
    outs.push(JSON.stringify(r.units.map(u => [u.key, u.cls]).sort()));
  }
  assert.equal(new Set(outs).size, 1, 'результат не зависит от порядка');
  // кандидат выдал только один из двух: второй — П, а не «верно по первому»
  const r1 = M.scoreHistory({ h: H([gF('F0', x), gF('F1', y)]), text, dd, sets, extraction: cands([y]) });
  assert.deepEqual(r1.units.map(u => u.cls).sort(), ['В', 'П']);
});
test('оценка совпадения: точный дубль в эталоне — одна единица', () => {
  const x = bg(T, 7.3, 30);
  const r = M.scoreHistory({ h: H([gF('A', x), gF('B', x)]), text, dd, sets, extraction: { candidates: [{ id: 'c', field: 'blood_gases', value: [x], fragments: [at('07:30 pH 7,3 PaCO2 30')] }] } });
  assert.equal(r.units.length, 1); assert.equal(r.units[0].cls, 'В'); assert.equal(r.units[0].conflict, undefined);
});
test('два разных рентгенологических исследования в одну минуту — конфликт, не склеиваются', () => {
  const a = { at: T, position: 'vertical', reason: 'urgent', result: 'газ' }, b = { at: T, position: 'lateral', reason: 'urgent', result: 'нет газа' };
  const g = I.goldData(H([fact('A', 'xrays', a, 'х'), fact('B', 'xrays', b, 'х')]), dd, '+05:00');
  assert.deepEqual(g.ambiguous, ['xrays']);
});

// ---- валидатор: time_kind обязателен у временных фактов ----
function validate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15f-'));
  fs.cpSync(path.join(KIT, 'scorer/test/tech'), dir, { recursive: true });
  const gp = path.join(dir, 'blind1-gold.json'); const g = JSON.parse(fs.readFileSync(gp, 'utf8')); mutate(g); fs.writeFileSync(gp, JSON.stringify(g));
  const r = spawnSync('python3', ['-I', '-B', path.join(KIT, 'scorer/validate.py'), '--input', dir, '--dict', path.join(REPO, 'rules/pilot-rules.json'), '--sets', path.join(KIT, 'field-sets.json'), '--technical-test'], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
  return r.stdout + r.stderr;
}
test('валидатор: исходный набор проходит; нет time_kind у временного факта — ошибка; time_kind у невременного поля — ошибка; document_time — ошибка; ловушка document_time_as_event проверяется', () => {
  assert.doesNotMatch(validate(() => {}), /не указан time_kind|указан у невременного|недопустимое time_kind/);
  const f2 = g => g.histories[1].facts.find(x => x.field === 'blood_culture_drawn_at');
  assert.match(validate(g => { delete f2(g).time_kind; }), /не указан time_kind/);
  assert.match(validate(g => { g.histories[0].facts.find(x => x.field === 'gestational_age_weeks').time_kind = 'event_time'; }), /указан у невременного поля/);
  assert.match(validate(g => { f2(g).time_kind = 'document_time'; }), /недопустимое time_kind/);
  assert.match(validate(g => { g.histories[0].traps.find(x => x.type === 'document_time_as_event').field = 'gestational_age_weeks'; }), /только для поля даты-времени/);
  assert.match(validate(g => { g.histories[0].traps.find(x => x.type === 'document_time_as_event').must_not_value = true; }), /must_not_value должен быть \\?"any\\?"/);
  // действующий факт того же поля из той же цитаты вместе с ловушкой — ошибка набора (единственный вариант)
  assert.match(validate(g => { g.histories[0].facts.push({ fid: 'Т1-F99', field: 'blood_culture_drawn_at', value: '2026-01-10T08:00+05:00', unit_as_written: null, time_basis: 'date_from_heading', time_kind: 'event_time', event_at: null, event_date: null, quote: '10.01.2026 08:00 — кровь на посев взята', location: 'body', record_status: 'current', superseded_by: null, same_as: null, primary: null, note: '' }); }), /противоречит действующему факту/);
});
test('технический эталон: заголовок записи не размечен фактом, есть ловушка document_time_as_event (единственный вариант, политика PR №15)', () => {
  const g = JSON.parse(fs.readFileSync(path.join(KIT, 'scorer/test/tech/blind1-gold.json'), 'utf8'));
  const h = g.histories[0];
  assert.ok(!h.facts.some(f => f.fid === 'Т1-F4'));
  assert.ok(h.traps.some(t => t.type === 'document_time_as_event' && t.field === 'blood_culture_drawn_at'));
  assert.ok(g.histories.every(x => x.facts.every(f => f.time_kind !== 'document_time')));
});

test('полнота дозовых полей против словаря: все числовые поля с единицей мг, мг/кг, Ед/кг — дозовые; поля времени и «_interval» — нет', () => {
  const db = require(path.join(REPO, 'rules/pilot-rules.json')).data_dictionary;
  const byUnit = Object.entries(db).filter(([, d]) => ['number', 'derived'].includes(d.type) && /^(мг|мг\/кг|Ед\/кг)$/.test(d.unit || '')).map(([f]) => f);
  assert.ok(byUnit.length >= 8, 'в словаре есть дозовые поля');
  for (const f of byUnit) assert.ok(M.DOSE.test(f), 'дозовое по единице, но не в шаблоне: ' + f);
  for (const [f, d] of Object.entries(db)) if (d.type === 'datetime' || /_interval_h$|_minutes$/.test(f)) assert.ok(!M.DOSE.test(f), 'не доза: ' + f);
});
