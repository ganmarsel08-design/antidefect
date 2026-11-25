// Этап 7 — извлечение (engine/extract/extract.js). Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const X = require('../extract/extract.js');
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage7/stage7-extraction-gold.json'), 'utf8'));
const TZ = '+05:00';
const PC = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/stage8/stage7-policy-changes.json'), 'utf8')).changes;
const changed = (h, f) => PC.some(x => x.history === h.id && x.field === f);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ex = t => X.extract(t, { tz: TZ });
const byField = r => new Map(r.candidates.map(c => [c.field, c]));

/** Сверка одной истории с эталоном уровня 1: значение, фрагмент (перекрытие с эталонным), точность. */
function compare(h, text) {
  const r = ex(text), got = byField(r), errors = [];
  let ok = 0;
  for (const c of r.candidates) for (const f of (c.fragments || [])) if (text.slice(f.start, f.end) !== f.text) errors.push(`фрагмент не совпадает с текстом: ${c.field}`);
  for (const it of h.items) {
    if (changed(h, it.field)) { if (got.has(it.field)) errors.push(`значение ${it.field} должно больше не извлекаться (этап 8)`); continue; }
    const c = got.get(it.field);
    if (!c) { errors.push(`нет значения ${it.field}`); continue; }
    if (it.timeline) {
      const tl = (c.timeline || []).map(t => ({ v: t.v, at: t.at, date: t.date }));
      const gt = it.timeline.map(t => ({ v: t.v, at: t.at || null, date: t.at ? t.at.slice(0, 10) : t.date }));
      if (!same(tl, gt)) { errors.push(`динамика ${it.field}: ${JSON.stringify(tl)} ≠ ${JSON.stringify(gt)}`); continue; }
    } else if (!same(c.value, it.value)) { errors.push(`${it.field}: ${JSON.stringify(c.value ?? c.alternatives)} ≠ ${JSON.stringify(it.value)}`); continue; }
    const gold = it.timeline ? it.timeline.map(t => t.q) : it.fragments;
    const frs = c.fragments || [];
    const hit = gold.every(g => { let i = -1, found = false; while ((i = text.indexOf(g, i + 1)) >= 0) if (frs.some(f => f.start < i + g.length && i < f.end)) found = true; return found; });
    if (!hit) { errors.push(`фрагмент ${it.field}: ${JSON.stringify(frs.map(f => f.text))} не совпадает с эталонным ${JSON.stringify(gold)}`); continue; }
    ok++;
  }
  const gf = new Set(h.items.map(i => i.field));
  for (const c of r.candidates) if (!gf.has(c.field)) errors.push(`лишнее значение ${c.field} = ${JSON.stringify(c.value)}`);
  for (const a of h.absent) if (got.has(a.f)) errors.push(`извлечено поле из списка «не извлекается»: ${a.f}`);
  return { ok, errors, r };
}

test('эталон уровня 1: 9 историй, 249 значений (246 утверждённых + 3 поправки), журнал поправок', () => {
  assert.equal(EX.histories.length, 9);
  assert.equal(EX.histories.reduce((a, h) => a + h.items.length, 0), 249);
  assert.equal(EX.counts.approved_v02_values, 246);
  assert.equal(EX.corrections.length, 6);
  for (const h of EX.histories) for (const it of h.items) for (const q of (it.timeline ? it.timeline.map(t => t.q) : it.fragments)) assert.ok(h.text.includes(q), `${h.id} ${it.field}: фрагмента нет в тексте`);
});

for (const h of EX.histories) {
  test(`${h.id}: все значения извлечены с исходными фрагментами, лишних нет, «не извлекается» соблюдено`, () => {
    const { ok, errors } = compare(h, h.text);
    assert.deepEqual(errors, []);
    assert.equal(ok, h.items.length - PC.filter(x => x.history === h.id).length);
  });
}

test('итог: 249 из 249 значений, ноль лишних, все намеренно отсутствующие данные не извлечены', () => {
  let ok = 0, absent = 0;
  for (const h of EX.histories) { const c = compare(h, h.text); assert.deepEqual(c.errors, []); ok += c.ok; absent += h.absent.length; }
  assert.equal(ok, 249 - PC.length, 'этап 8: намеренно не извлекаются ' + PC.length + ' значения (fixtures/stage8/stage7-policy-changes.json)');
  assert.equal(absent, 39);
});

test('каждый кандидат: статус «не подтверждено», группа, признак критичности', () => {
  const r = ex(EX.histories.find(h => h.id === 'СИН-СЕП-01').text);
  for (const c of r.candidates) { assert.equal(c.status, 'не подтверждено'); assert.ok(c.group); assert.equal(typeof c.critical, 'boolean'); }
  const crit = r.candidates.filter(c => c.critical).map(c => c.field);
  for (const f of ['weight_kg', 'gestational_age_weeks', 'postnatal_age_days', 'gentamicin_dose_mg', 'gentamicin_interval_h', 'first_abx_dose_administered_at', 'benzylpenicillin_prescribed_at', 'sepsis_suspected']) assert.ok(crit.includes(f), f);
  assert.ok(!crit.includes('improving'));
});

test('часовой пояс — параметр организации; без него извлечение не выполняется', () => {
  assert.throws(() => X.extract('03.07.2026 08:25 — кровь на посев взята.', {}), /часовой пояс/);
  const r = X.extract('03.07.2026 08:25 — кровь на посев взята.', { tz: '+06:00' });
  assert.equal(r.candidates[0].value, '2026-07-03T08:25+06:00');
});

test('дозы и единицы: ЕД не превращаются в мг, мл — в мг/кг', () => {
  const r = byField(ex('21.09.2026 09:00 — назначено: бензилпенициллин 95 000 ЕД (50 000 ЕД/кг) в/в каждые 8 ч.\nЭндотрахеально введён сурфактант: порактант альфа 2,6 мл.'));
  assert.equal(r.get('benzylpenicillin_dose_units_per_kg').value, 50000);
  assert.ok(!r.has('benzylpenicillin_dose_mg'));
  assert.ok(!r.has('benzylpenicillin_dose_mg_kg'));
  assert.equal(r.get('surfactant_drug').value, 'порактант альфа');
  assert.ok(!r.has('surfactant_initial_dose_mg_kg'));
});

test('дозы: десятичная запятая и пробел в числе сохраняются точно', () => {
  const r = byField(ex('21.09.2026 09:00 — назначено: гентамицин 7,6 мг (4 мг/кг) в/в каждые 24 ч.'));
  assert.equal(r.get('gentamicin_dose_mg').value, 7.6);
  assert.equal(r.get('gentamicin_initial_dose_mg_kg').value, 4);
  assert.equal(r.get('gentamicin_interval_h').value, 24);
});

test('время назначения и время введения — разные поля', () => {
  const r = byField(ex('03.07.2026 08:30 — назначено: бензилпенициллин 85 мг (25 мг/кг) в/в каждые 12 ч.\n03.07.2026 08:45 — введена первая доза антибиотика.'));
  assert.equal(r.get('benzylpenicillin_prescribed_at').value, '2026-07-03T08:30+05:00');
  assert.equal(r.get('first_abx_dose_administered_at').value, '2026-07-03T08:45+05:00');
});

test('доза, время и препарат из разных записей не объединяются', () => {
  // время в одной строке, назначение без времени — в другой: время назначения не появляется
  const r = byField(ex('03.07.2026 08:30 — осмотр.\nНазначено: гентамицин 17 мг (5 мг/кг) в/в, вторая доза через 36 ч.'));
  assert.equal(r.get('gentamicin_dose_mg').value, 17);
  assert.ok(!r.has('gentamicin_prescribed_at'));
  // FiO2 при ухудшении в ОРИТН не становится FiO2 при стабилизации
  const r2 = byField(ex('Кислород подавался без кислородно-воздушного смесителя.\n11.03.2026 02:30 — нарастание дыхательной недостаточности, FiO2 0,50; интубирован, ИВЛ.'));
  assert.ok(!r2.has('fio2'));
  // масса из одной записи и доза из другой не дают новой дозы на кг
  const r3 = byField(ex('20.09.2026 18:20 — масса 1,90 кг.\n21.09.2026 09:00 — назначено: гентамицин 7,6 мг в/в.'));
  assert.ok(!r3.has('gentamicin_initial_dose_mg_kg'));
  // этап 8: доза в мг с явной единицей извлекается и без «(N мг/кг)»; доза на кг по массе из другой записи не вычисляется
  assert.equal(r3.get('gentamicin_dose_mg').value, 7.6);
});

test('отрицания: «нет» только при явном отрицании; «сведений нет», «не указано», «в работе» — нет значения', () => {
  const r = byField(ex([
    'Антенатальные стероиды не вводились.', 'Кормление не прекращено.', 'Метронидазол не назначен.', 'ПВК сохранён.',
    'Интубация для стабилизации не потребовалась.', 'Сурфактант в родильном зале не вводился.', 'Клинического ухудшения не было.',
  ].join('\n')));
  assert.equal(r.get('antenatal_steroids_given').value, false);
  assert.equal(r.get('enteral_feeding_stopped').value, false);
  assert.equal(r.get('metronidazole_given').value, false);
  assert.equal(r.get('uvc_removed').value, false);
  assert.equal(r.get('intubation_needed_for_stabilization').value, false);
  assert.equal(r.get('surfactant_in_delivery_room').value, false);
  assert.equal(r.get('clinical_deterioration').value, false);
  assert.ok(!r.has('intubated'), '«не потребовалась» не означает «интубирован»');
  assert.ok(!r.has('surfactant_given'), '«в родзале не вводился» не означает «сурфактант не вводился»');
  const r2 = byField(ex('Сведений об антенатальных стероидах в обменной карте нет.\nПуповина пережата, время не указано.\nПосев крови — в работе.\nТяжёлая бактериальная инфекция не исключена.'));
  assert.equal(r2.size, 0);
});

test('дата без времени не превращается в 00:00; «утром» — не время', () => {
  const r = byField(ex('08.06.2026 — вздутие живота. Подозрение на НЭК.\n21.09.2026 утром — показание к антибактериальной терапии.'));
  assert.equal(r.get('nec_suspected').value, true);
  assert.ok(!r.has('nec_suspected_at'));
  assert.ok(!r.has('sepsis_indication_identified_at'));
});

test('временная динамика: НЭК-03 — две записи о пассаже сохраняются, глобальное значение не выбирается', () => {
  const h = EX.histories.find(x => x.id === 'СИН-НЭК-03');
  const c = byField(ex(h.text)).get('gi_passage_restored');
  assert.ok(!('value' in c), 'значение не выбрано автоматически');
  assert.deepEqual(c.timeline.map(t => [t.v, t.at, t.date]), [[false, null, '2026-06-08'], [true, '2026-06-10T16:00+05:00', '2026-06-10']]);
  assert.match(c.note, /выбирает врач/);
  // одно наблюдение — обычное значение
  const c1 = byField(ex(EX.histories.find(x => x.id === 'СИН-НЭК-01').text)).get('gi_passage_restored');
  assert.equal(c1.value, true);
});

test('разные значения одного поля — альтернативы, выбирает врач', () => {
  const r = byField(ex('Срок гестации 34 недели.\nСрок гестации 33 недели.'));
  const c = r.get('gestational_age_weeks');
  assert.ok(!('value' in c));
  assert.deepEqual(c.alternatives.map(a => a.value), [34, 33]);
});

test('списки: газы крови, рентгенограммы — повод снимка не придумывается', () => {
  const r = byField(ex(EX.histories.find(x => x.id === 'СИН-НЭК-02').text));
  const xs = r.get('xrays').value;
  assert.equal(xs.length, 3);
  assert.deepEqual(xs.map(x => x.reason), [null, 'planned', null]);
  assert.equal(r.get('xrays').fragments.length, 3);
});

test('удаление записи убирает значение (значения не придумываются)', () => {
  const h = EX.histories.find(x => x.id === 'СИН-РДС-01');
  const cases = [
    ['давление 6 см H2O', 'cpap_pressure_cmh2o'],
    ['Кровь на посев взята 02.03.2026 07:30. ', 'blood_culture_drawn_at'],
    ['Порог гипокапнии в отделении: PaCO2 ниже 35 мм рт. ст. (СОП ОРИТН «Респираторная поддержка», п. 4.2).', 'paco2_hypocapnia_threshold'],
    ['Назначено: целевая SpO2 90–95%.', 'spo2_target_low'],
  ];
  for (const [frag, f] of cases) {
    assert.ok(h.text.includes(frag), frag);
    assert.ok(!byField(ex(h.text.replace(frag, ''))).has(f), f);
  }
  const s = EX.histories.find(x => x.id === 'СИН-СЕП-01');
  assert.ok(!byField(ex(s.text.replace(' (постнатальный возраст 0 суток)', ''))).has('postnatal_age_days'));
});

test('гипотетический грамотрицательный возбудитель — только как предложение по справочнику', () => {
  const c = byField(ex(EX.histories.find(x => x.id === 'СИН-СЕП-02').text)).get('gram_negative_culture');
  assert.equal(c.value, true);
  assert.match(c.note, /подтверждает врач/);
});

test('модуль извлечения независим от движка правил и не обращается к сети', () => {
  const src = fs.readFileSync(path.join(ROOT, 'engine/extract/extract.js'), 'utf8');
  assert.ok(!/require\(/.test(src));
  assert.ok(!/rules-engine|derive\.js|pilot-rules|RulesEngine|RulesDerive/.test(src.replace(/\/\*[\s\S]*?\*\//, '')));
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|https?:\/\//.test(src));
  for (const f of ['engine/case-builder.js', 'engine/extract/docx.js']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/require\(|fetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(s), f);
    assert.ok(!/RulesEngine|rules-engine/.test(s.replace(/\/\*[\s\S]*?\*\//, '')), f);
  }
});
