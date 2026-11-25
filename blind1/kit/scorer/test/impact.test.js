// Проверка оценки влияния на правила (технические данные; движок — замороженная рабочая копия программы).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I = require('../impact.js');
const REPO = process.env.ANTIDEFECT_REPO || '/home/claude/antidefect';
const env = I.loadEnv(REPO);
const F = (fid, field, value, extra) => Object.assign({ fid, field, value, quote: 'х', location: 'body', record_status: 'current' }, extra || {});
const base = [F('1', 'gestational_age_weeks', 29), F('2', 'rds_diagnosed', true), F('3', 'rds_risk', true), F('4', 'cpap_from_birth', true)];
const h = facts => ({ id: 'ТЕХ', protocol: 'РДС', facts });
const cand = (field, value, alts) => alts ? { id: field, field, alternatives: alts.map(v => ({ value: v, fragments: [] })) } : { id: field, field, value, fragments: [] };
const ext = (...c) => ({ candidates: [cand('gestational_age_weeks', 29), cand('rds_diagnosed', true), cand('rds_risk', true), cand('cpap_from_birth', true), ...c] });

test('неверно извлечённое давление даёт ложное предварительное соответствие RDS-001', () => {
  const r = I.impactHistory(env, h([...base, F('5', 'cpap_pressure_cmh2o', 5)]), ext(cand('cpap_pressure_cmh2o', 6)), '+05:00');
  assert.equal(r.gold['RDS-001'], 'предварительное отличие');
  const p = r.modes.stress.pairs.find(x => x.key === 'RDS-001');
  assert.equal(p.cls, 'ложное предварительное соответствие'); assert.ok(p.fields.includes('cpap_pressure_cmh2o'));
  assert.equal(I.falseCompliance(r, 'stress').k, 1);
});

test('альтернативы: стресс берёт первую (ложное соответствие), осторожный — нет данных', () => {
  const r = I.impactHistory(env, h([...base, F('5', 'cpap_pressure_cmh2o', 5)]), ext(cand('cpap_pressure_cmh2o', null, [6, 5])), '+05:00');
  assert.equal(r.modes.stress.pairs.find(x => x.key === 'RDS-001').cls, 'ложное предварительное соответствие');
  assert.match(r.modes.cautious.pairs.find(x => x.key === 'RDS-001').cls, /недостаточно данных/);
  assert.equal(I.falseCompliance(r, 'cautious').k, 0);
});

test('эталон: primary выбирает значение; без primary поле неоднозначно и пары исключаются из нулевого критерия', () => {
  const two = [F('5', 'cpap_pressure_cmh2o', 5, { primary: true }), F('6', 'cpap_pressure_cmh2o', 7)];
  assert.equal(I.goldData(h([...base, ...two]), env.db.data_dictionary, '+05:00').data.cpap_pressure_cmh2o, 5);
  const amb = [F('5', 'cpap_pressure_cmh2o', 5), F('6', 'cpap_pressure_cmh2o', 7)];
  const r = I.impactHistory(env, h([...base, ...amb]), ext(cand('cpap_pressure_cmh2o', 6)), '+05:00');
  assert.deepEqual(r.ambiguous_gold_fields, ['cpap_pressure_cmh2o']);
  assert.match(r.modes.stress.pairs.find(x => x.key === 'RDS-001').cls, /^зависит от выбора врача/);
  assert.equal(I.falseCompliance(r, 'stress').k, 0);
});

test('устаревшие записи эталона в данные не попадают', () => {
  const g = I.goldData(h([...base, F('5', 'cpap_pressure_cmh2o', 4, { record_status: 'superseded' }), F('6', 'cpap_pressure_cmh2o', 6)]), env.db.data_dictionary, '+05:00');
  assert.equal(g.data.cpap_pressure_cmh2o, 6); assert.deepEqual(g.ambiguous, []);
});

// --- метод 1.3: причины расхождений результатов правил ---
const SETS = require('../../field-sets.json');
const pressureCase = loc => h([...base, F('5', 'cpap_pressure_cmh2o', 5, { location: loc, quote: 'давление 5 см' })]);
const ctx = (format, extra) => Object.assign({ sets: SETS, format, programText: 'давление 5 см', warnings: [], refExtraction: null }, extra || {});
const causesOf = (r, mode, key) => r.modes[mode].pairs.find(x => x.key === key).causes;

test('1.3: TXT — неверное значение при прочитанном тексте: ошибка извлекателя; ложное соответствие считается независимо от причины', () => {
  const r = I.impactHistory(env, pressureCase('body'), ext(cand('cpap_pressure_cmh2o', 6)), '+05:00', ctx('txt'));
  assert.deepEqual(causesOf(r, 'stress', 'RDS-001').cpap_pressure_cmh2o, [I.CAUSE.extractor]);
  assert.equal(I.falseCompliance(r, 'stress').k, 1);
});

test('1.3: DOCX — сведения в сноске: с предупреждением — «доп. элемент», без предупреждения — ошибка чтения', () => {
  const w = I.impactHistory(env, pressureCase('footnote'), ext(), '+05:00', ctx('docx', { programText: '', warnings: ['не прочитано: сноски'] }));
  assert.deepEqual(causesOf(w, 'stress', 'RDS-001').cpap_pressure_cmh2o, [I.CAUSE.unread_warned]);
  const n = I.impactHistory(env, pressureCase('footnote'), ext(), '+05:00', ctx('docx', { programText: '', warnings: [] }));
  assert.deepEqual(causesOf(n, 'stress', 'RDS-001').cpap_pressure_cmh2o, [I.CAUSE.reading]);
});

test('1.3: DOCX — цитата не попала в прочитанный текст или эталон чтения извлекается верно: ошибка чтения; иначе — извлекателя', () => {
  const lost = I.impactHistory(env, pressureCase('table'), ext(cand('cpap_pressure_cmh2o', 6)), '+05:00', ctx('docx', { programText: 'иной текст' }));
  assert.deepEqual(causesOf(lost, 'stress', 'RDS-001').cpap_pressure_cmh2o, [I.CAUSE.reading]);
  const refOk = I.impactHistory(env, pressureCase('table'), ext(cand('cpap_pressure_cmh2o', 6)), '+05:00', ctx('docx', { refExtraction: ext(cand('cpap_pressure_cmh2o', 5)) }));
  assert.deepEqual(causesOf(refOk, 'stress', 'RDS-001').cpap_pressure_cmh2o, [I.CAUSE.reading]);
  const refBad = I.impactHistory(env, pressureCase('table'), ext(cand('cpap_pressure_cmh2o', 6)), '+05:00', ctx('docx', { refExtraction: ext(cand('cpap_pressure_cmh2o', 6)) }));
  assert.deepEqual(causesOf(refBad, 'stress', 'RDS-001').cpap_pressure_cmh2o, [I.CAUSE.extractor]);
  assert.equal(I.falseCompliance(refOk, 'stress').k, 1); // нулевой критерий не смягчается причиной
});

test('1.3: поле вне схемы извлечения — ограничение схемы; несколько наблюдений пассажа — ограничение движка', () => {
  const hb = h([...base, F('9', 'blood_culture_before_antibiotics', true)]);
  assert.deepEqual(I.fieldCauses('blood_culture_before_antibiotics', hb, {}, {}, {}, 'stress', ctx('txt'), env.db.data_dictionary), [I.CAUSE.schema]);
  const hg = h([F('1', 'gi_passage_restored', false, { event_at: '2026-01-02T08:00+05:00' }), F('2', 'gi_passage_restored', true, { event_at: '2026-01-04T08:00+05:00' })]);
  const c = I.fieldCauses('gi_passage_restored', hg, { gi_passage_restored: false }, { gi_passage_restored: false }, { gi_passage_restored: false }, 'stress', ctx('txt'), env.db.data_dictionary);
  assert.deepEqual(c, [I.CAUSE.engine]);
});
