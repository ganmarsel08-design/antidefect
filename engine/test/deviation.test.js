'use strict';
// Синтетические случаи. Препараты, дозы, диапазоны и цитаты вымышлены
// и не являются клиническими рекомендациями. Реальные данные пациентов не используются.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../deviation-engine.js');
const S = E.STATUS;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
const searched = (o) => Object.assign({
  protocol_no: 'T-1', approved_date: '01.01.2020 (синтетический)', edition: 'ред. 1',
  registry_status: 'действует', valid_on_care_date: 'да', sections: ['раздел 1'], applicability: 'синтетическая группа'
}, o || {});

// Назначение по протоколу: всё на месте
function base() {
  return {
    id: 'SYN', patient_ref: 'П-000', history_scope: 'full',
    order: { text: 'Препарат X (синтетический пример)', drug: 'препарат X', params: { dose_mg_per_kg: 10, interval_h: 12 }, date_time: '2026-01-10T09:00' },
    protocol_check: {
      relation: 'соответствует', searched: [searched()],
      match: { protocol_no: 'T-1', section: 'раздел 1', quote: 'синтетическая цитата', ranges: { dose_mg_per_kg: { min: 8, max: 12 }, interval_h: { min: 12, max: 12 } } },
      search_date: '2026-11-18', registry_coverage: { total: 29, missing_applicable: [] }
    },
    indications: { value: 'подтверждены', facts: [{ text: 'синтетический факт', date_time: '2026-01-10T08:00', source: 'запись врача' }] },
    required_documentation: [],
    documentation: { physician_note: 'найдено', risk_benefit: 'найдено', monitoring: 'найдено', consilium: 'не_найдено_в_полной_истории' },
    signals: [], conflicts: [], evidence: []
  };
}
// Отклонение «не урегулировано»: лечебный курс противогрибкового препарата
function deviation() {
  const d = base();
  d.order = { text: 'Лечебный курс противогрибкового препарата Y (синтетический пример)', drug: 'препарат Y', params: {}, date_time: '2026-01-12T10:00' };
  d.protocol_check = {
    relation: 'не_урегулировано',
    searched: [searched({ protocol_no: '4' }), searched({ protocol_no: '185' }), searched({ protocol_no: '231' })],
    match: null, search_date: '2026-11-18', registry_coverage: { total: 29, missing_applicable: [] }
  };
  return d;
}
// Подтверждения создаются только через attest* (с проверяющим)
const bib = (o) => E.attestBibliographic(Object.assign({ found: true, metadata_match: true, method: 'manual', checked_by: 'эксперт-1', checked_at: '2026-11-18' }, o || {})).attestation;
const ea = (o) => E.attestExpertAssessment(Object.assign({ applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'эксперт-1', at: '2026-11-18' }, o || {})).attestation;
const goodEvidence = (o) => Object.assign({
  citation: 'Синтетическая публикация А', presented: true,
  bibliographic: bib(), expert_assessment: ea(),
  transfer_rationale_documented: false, year: 2022
}, o || {});
const signal = (o) => Object.assign({
  kind: 'возможное_противопоказание', severity: 'высокая', confidence: 'высокая', confirmed: true,
  requirement_quote: 'синтетическая цитата требования', fact: 'синтетический факт', source: 'запись 10.01'
}, o || {});
function asFragment(d) {
  d.history_scope = 'fragment';
  for (const k of Object.keys(d.documentation)) if (d.documentation[k] === 'не_найдено_в_полной_истории') d.documentation[k] = 'не_найдено_во_фрагменте';
  return d;
}

const CASES = [
  { n: 1, title: 'По протоколу: доза и интервал в диапазоне, показания подтверждены', build: base,
    expect: { status: S.COMPLIANT, relation: 'соответствует', relation_source: 'ranges', doc: 'не_требуется' } },
  { n: 2, title: 'По протоколу, но обязательная запись отсутствует в полной истории',
    build: () => { const d = base(); d.required_documentation = ['physician_note']; d.documentation.physician_note = 'не_найдено_в_полной_истории'; return d; },
    expect: { status: S.COMPLIANT, doc: 'неполная', headline: 'документация неполная' } },
  { n: 3, title: 'Доза на нижней границе; заявлено «отличается», но диапазон приоритетнее',
    build: () => { const d = base(); d.order.params.dose_mg_per_kg = 8; d.protocol_check.relation = 'отличается'; return d; },
    expect: { status: S.COMPLIANT, relation: 'соответствует' } },
  { n: 4, title: 'Подтверждённое противопоказание высокой серьёзности', build: () => { const d = base(); d.signals = [signal()]; return d; },
    expect: { status: S.URGENT } },
  { n: 5, title: 'Критическое возможное превышение дозы, не подтверждено, уверенность средняя',
    build: () => { const d = base(); d.signals = [signal({ kind: 'возможное_превышение_дозы', severity: 'критическая', confidence: 'средняя', confirmed: false })]; return d; },
    expect: { status: S.URGENT } },
  { n: 6, title: 'Неподтверждённое подозрение на нарушение интервала, уверенность низкая',
    build: () => { const d = base(); d.signals = [signal({ kind: 'возможное_несоответствие_интервала', severity: 'средняя', confidence: 'низкая', confirmed: false })]; return d; },
    expect: { status: S.EXPERT, urgent: false } },
  { n: 7, title: 'Противоречие: разные результаты одного посева',
    build: () => { const d = deviation(); d.evidence = [goodEvidence()]; d.conflicts = [{ a: 'посев от 12.01: рост грибов (запись врача)', b: 'посев от 12.01: роста нет (лаборатория)' }]; return d; },
    expect: { status: S.EXPERT, conflict: true } },
  { n: 8, title: 'Противоречие при недостатке данных — не «недостаточно данных», а эксперт',
    build: () => { const d = base(); d.indications.value = 'недостаточно_данных'; d.conflicts = [{ a: 'масса 700 г (эпикриз)', b: 'масса 1700 г (дневник)' }]; return d; },
    expect: { status: S.EXPERT, conflict: true } },
  { n: 9, title: 'Предоставлен фрагмент, показаний недостаточно',
    build: () => { const d = asFragment(base()); d.indications.value = 'недостаточно_данных'; return d; },
    expect: { status: S.INSUFFICIENT } },
  { n: 10, title: 'Нет значения дозы для сравнения',
    build: () => { const d = base(); delete d.order.params.dose_mg_per_kg; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 11, title: 'Редакция протокола на дату помощи не подтверждена',
    build: () => { const d = base(); d.protocol_check.searched[0].valid_on_care_date = 'не_определено'; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 12, title: 'Отклонение, запись врача не найдена во фрагменте',
    build: () => { const d = asFragment(deviation()); d.evidence = [goodEvidence()]; d.documentation.physician_note = 'не_найдено_во_фрагменте'; return d; },
    expect: { status: S.INSUFFICIENT, doc: 'не_определена' } },
  { n: 13, title: '«Не урегулировано» без сведений о полноте реестра',
    build: () => { const d = deviation(); d.evidence = [goodEvidence()]; delete d.protocol_check.registry_coverage; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 14, title: 'Противогрибковая терапия: показания, проверенный источник, запись врача',
    build: () => { const d = deviation(); d.evidence = [goodEvidence()]; return d; },
    expect: { status: S.JUSTIFIED, relation: 'не_урегулировано', statement: E.NOT_REG_STATEMENT } },
  { n: 15, title: 'Частичная применимость с записью врача о причине переноса',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ expert_assessment: ea({ applicability: 'частично' }), transfer_rationale_documented: true })]; return d; },
    expect: { status: S.JUSTIFIED } },
  { n: 16, title: 'Вне инструкции, консилиум не обязателен — рекомендация консилиума',
    build: () => { const d = deviation(); d.order.off_label = true; d.evidence = [goodEvidence()]; return d; },
    expect: { status: S.JUSTIFIED, recommendation: 'консилиум' } },
  { n: 17, title: 'Противогрибковая терапия без источника и без записи врача',
    build: () => { const d = deviation(); d.documentation.physician_note = 'не_найдено_в_полной_истории'; return d; },
    expect: { status: S.INCOMPLETE, missing: ['источник не предъявлен', 'запись врача с обоснованием'] } },
  { n: 18, title: 'Доза вне диапазона и показания не подтверждены одновременно',
    build: () => { const d = base(); d.order.params.dose_mg_per_kg = 20; d.indications.value = 'не_подтверждены'; return d; },
    expect: { status: S.INCOMPLETE, relation: 'отличается', missing: ['показания у пациента не подтверждены'] } },
  { n: 19, title: 'Источник о взрослых для недоношенного 700 г: эксперт — не совпадает',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ population: 'взрослые', expert_assessment: ea({ applicability: 'не_совпадает', regimen_match: 'частично' }) })]; return d; },
    expect: { status: S.INCOMPLETE, missing: ['не применим'] } },
  { n: 20, title: 'Источник не найден в PubMed',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ bibliographic: bib({ found: false }) })]; return d; },
    expect: { status: S.INCOMPLETE, missing: ['библиографическую проверку'] } },
  { n: 21, title: 'Консилиум обязателен по положению центра, но не найден',
    cfg: { consilium_mandatory: true, consilium_basis: 'синтетическое положение центра' },
    build: () => { const d = deviation(); d.evidence = [goodEvidence()]; return d; },
    expect: { status: S.INCOMPLETE, missing: ['консилиум'] } },
  { n: 22, title: 'Источник найден в PubMed, экспертная оценка ещё не проведена',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ expert_assessment: null })]; return d; },
    expect: { status: S.EXPERT } },
  { n: 23, title: 'Частичная применимость без записи о причине переноса',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ expert_assessment: ea({ applicability: 'частично', regimen_match: 'частично' }) })]; return d; },
    expect: { status: S.EXPERT } },
  { n: 24, title: 'Назначение по протоколу, но показания не подтверждены (полная история)',
    build: () => { const d = base(); d.indications.value = 'не_подтверждены'; return d; },
    expect: { status: S.INCOMPLETE, relation: 'соответствует' } },
  { n: 25, title: 'Критическая серьёзность при низкой уверенности — срочно',
    build: () => { const d = base(); d.signals = [signal({ severity: 'критическая', confidence: 'низкая', confirmed: false })]; return d; },
    expect: { status: S.URGENT } },
  { n: 26, title: 'Высокая серьёзность, не подтверждён, уверенность низкая — обычная экспертиза',
    build: () => { const d = base(); d.signals = [signal({ severity: 'высокая', confidence: 'низкая', confirmed: false })]; return d; },
    expect: { status: S.EXPERT, urgent: false } },
  { n: 27, title: 'Низкая серьёзность — только предупреждение, статус не меняется',
    build: () => { const d = base(); d.signals = [signal({ severity: 'низкая', confidence: 'низкая', confirmed: false })]; return d; },
    expect: { status: S.COMPLIANT, warning: 'предупреждение' } },
  { n: 28, title: 'Реестр неполный: «не урегулировано» уверенно установить нельзя',
    build: () => { const d = deviation(); d.evidence = [goodEvidence()]; d.protocol_check.registry_coverage.missing_applicable = ['протокол по кандидозу (не внесён)']; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 29, title: 'Протокол «не проверен» в реестре — положительный вывод заблокирован',
    build: () => { const d = base(); d.protocol_check.searched[0].registry_status = 'не проверен'; return d; },
    expect: { status: S.EXPERT, blocked: true } },
  { n: 30, title: 'Обоснованное отклонение, но редакция одного из просмотренных протоколов не подтверждена',
    build: () => { const d = deviation(); d.evidence = [goodEvidence()]; d.protocol_check.searched[1].valid_on_care_date = 'не_определено'; return d; },
    expect: { status: S.EXPERT, blocked: true } },
  { n: 31, title: 'Протокол сейчас заменён, но действовал на дату помощи',
    build: () => { const d = base(); d.protocol_check.searched[0].registry_status = 'заменён'; return d; },
    expect: { status: S.COMPLIANT, blocked: false } },
  { n: 32, title: 'Экспертная оценка пришла во входных данных без подтверждения',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ expert_assessment: { applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'кто-то' } })]; return d; },
    expect: { status: S.EXPERT, warning: 'не подтверждена и не учитывается' } },
  { n: 33, title: 'Результат PubMed во входных данных без подтверждения проверяющего',
    build: () => { const d = deviation(); d.evidence = [goodEvidence({ bibliographic: { method: 'pubmed_api', found: true, metadata_match: true } })]; return d; },
    expect: { status: S.EXPERT, warning: 'не подтверждён проверяющим' } },
  { n: 34, title: 'Протокол «не проверен», доза вне диапазона без обоснования — проблемы всё равно видны',
    build: () => { const d = base(); d.protocol_check.searched[0].registry_status = 'не проверен'; d.order.params.dose_mg_per_kg = 20; d.documentation.physician_note = 'не_найдено_в_полной_истории'; return d; },
    expect: { status: S.INCOMPLETE, missing: ['источник не предъявлен', 'запись врача'] } }
];

for (const c of CASES) {
  test(`случай ${c.n}: ${c.title}`, () => {
    const input = deepFreeze(c.build());               // вход не должен изменяться
    const r = E.evaluate(input, c.cfg);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const x = c.expect;
    assert.equal(r.status, x.status, r.reasons.concat(r.missing).join(' | '));
    if (x.relation) assert.equal(r.clinical.relation, x.relation);
    if (x.relation_source) assert.equal(r.clinical.relation_source, x.relation_source);
    if (x.doc) assert.equal(r.documentation.state, x.doc);
    if (x.headline) assert.ok(r.headline.includes(x.headline), r.headline);
    if (x.statement) assert.ok(r.clinical.statement.startsWith(x.statement), r.clinical.statement);
    if (x.conflict !== undefined) assert.equal(r.conflict_detected, x.conflict);
    if (x.urgent !== undefined) assert.equal(r.safety.urgent, x.urgent);
    if (x.blocked !== undefined) { assert.equal(r.positive_blocked, x.blocked); assert.equal(r.blocked_by.length > 0, x.blocked); }
    if (x.warning) assert.ok(r.warnings.some(t => t.includes(x.warning)), r.warnings.join(' | '));
    if (x.recommendation) assert.ok(r.recommendations.some(t => t.includes(x.recommendation)), r.recommendations.join(' | '));
    (x.missing || []).forEach(m => assert.ok(r.missing.some(t => t.includes(m)), `нет «${m}» в: ${r.missing.join(' | ')}`));
  });
}

test('не менее 15 случаев и не менее 2 на каждый автоматический статус', () => {
  assert.ok(CASES.length >= 15);
  for (const st of E.AUTO_STATUSES) assert.ok(CASES.filter(c => c.expect.status === st).length >= 2, st);
});

test('«Потенциальный дефект» никогда не ставится автоматически', () => {
  for (const c of CASES) assert.notEqual(E.evaluate(c.build(), c.cfg).status, S.POTENTIAL_DEFECT);
});

test('решение эксперта сохраняет исходный результат и ведёт журнал', () => {
  const r = E.evaluate(base());
  const r1 = E.applyExpertOverride(r, { who: 'эксперт-1', status: S.POTENTIAL_DEFECT, reason: 'синтетическая причина', source: 'протокол заседания №1', at: '2026-11-18T10:00' });
  assert.equal(r1.status, S.POTENTIAL_DEFECT);
  assert.equal(r1.status_set_by, 'expert');
  assert.equal(r1.original.status, S.COMPLIANT);
  const r2 = E.applyExpertOverride(r1, { who: 'комиссия', status: S.COMPLIANT, reason: 'пересмотр', source: 'протокол заседания №2', at: '2026-11-19T10:00' });
  assert.equal(r2.original.status, S.COMPLIANT);           // первоначальный автоматический результат
  assert.equal(r2.history.length, 2);
  assert.equal(r2.history[0].to, S.POTENTIAL_DEFECT);
  assert.equal(r.status, S.COMPLIANT);                     // исходный объект не изменён
});

test('решение эксперта без причины или источника отклоняется', () => {
  const r = E.evaluate(base());
  assert.equal(E.applyExpertOverride(r, { who: 'эксперт', status: S.JUSTIFIED, reason: '', source: 'x' }).ok, false);
  assert.equal(E.applyExpertOverride(r, { who: 'эксперт', status: S.JUSTIFIED, reason: 'x' }).ok, false);
  assert.equal(E.applyExpertOverride(r, { who: 'эксперт', status: 'Ошибка врача', reason: 'x', source: 'y' }).ok, false);
});

test('проверка входных данных', () => {
  const bad = (mut, cfg) => { const d = base(); mut(d); return E.evaluate(d, cfg); };
  assert.equal(bad(d => { d.history_scope = 'fragment'; }).ok, false, 'фрагмент + «не найдено в полной истории»');
  assert.equal(bad(d => { asFragment(d); d.indications.value = 'не_подтверждены'; }).ok, false, 'фрагмент + «не подтверждены»');
  assert.equal(bad(d => { d.signals = [signal({ requirement_quote: '' })]; }).ok, false, 'сигнал без цитаты');
  assert.equal(bad(d => { d.signals = [signal({ severity: undefined })]; }).ok, false, 'сигнал без серьёзности');
  assert.equal(bad(d => { d.order.text = 'ИИН 123456789012'; }).ok, false, 'возможный ИИН');
  assert.equal(bad(d => { d.required_documentation = ['consent']; }).ok, false, 'обязательная запись без результата поиска');
  assert.equal(bad(() => {}, { consilium_mandatory: true }).ok, false, 'обязательный консилиум без основания');
  assert.equal(bad(d => { d.conflicts = [{ a: 'факт', b: '' }]; }).ok, false, 'противоречие без второго факта');
});

test('подтверждение теряет силу после сериализации (импорт JSON не подтверждает)', () => {
  const d = deviation(); d.evidence = [goodEvidence()];
  assert.equal(E.evaluate(d).status, S.JUSTIFIED);
  const copy = JSON.parse(JSON.stringify(d));
  assert.equal(E.evaluate(copy).status, S.EXPERT);
});

test('attest* требуют проверяющего и допустимые значения', () => {
  assert.equal(E.attestBibliographic({ found: true, metadata_match: true, method: 'manual' }).ok, false);
  assert.equal(E.attestBibliographic({ found: true, metadata_match: true, method: 'на глаз', checked_by: 'э' }).ok, false);
  assert.equal(E.attestExpertAssessment({ applicability: 'да', regimen_match: 'совпадает', assessed_by: 'э' }).ok, false);
  assert.equal(E.attestExpertAssessment({ applicability: 'совпадает', regimen_match: 'совпадает' }).ok, false);
  const a = E.attestExpertAssessment({ applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'э' }).attestation;
  assert.ok(Object.isFrozen(a) && E.isAttested(a, 'expert_assessment'));
});

test('пороги сигналов', () => {
  const L = (severity, confidence, confirmed) => E.signalLevel({ severity, confidence, confirmed });
  assert.equal(L('критическая', 'низкая', false), 'срочно');
  assert.equal(L('высокая', 'низкая', true), 'срочно');
  assert.equal(L('высокая', 'средняя', false), 'срочно');
  assert.equal(L('высокая', 'низкая', false), 'эксперт');
  assert.equal(L('средняя', 'высокая', true), 'эксперт');
  assert.equal(L('низкая', 'высокая', true), 'предупреждение');
});
