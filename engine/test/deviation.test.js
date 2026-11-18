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
// Синтетический реестр: записи протоколов модуль получает только через loadRegistry/registryEntry
const SYN_REG = { version: 'синтетический-1', protocols: [] };
function synDoc(o) {
  const p = Object.assign({ doc_id: 'КП-ДЛ:t-1:2020-01-01', approval: { no: 'T-1', date_iso: '2020-01-01' }, protocol_type: 'диагностика_и_лечение',
    registry_status: 'действует', official_check: { result: 'подтверждено_официальным_PDF' },
    currency_check: { result: 'новее_редакции_не_найдено', basis: 'синтетическая проверка' }, valid_to: null }, o || {});
  return p;
}
['T-1', '4', '185', '231', 'nek-a', 'nek-b', 'sep', 'secondary', 'no-currency', 'unverified', '10'].forEach(k => SYN_REG.protocols.push(synDoc({
  doc_id: k === 'T-1' ? 'КП-ДЛ:t-1:2020-01-01' : 'КП-ДЛ:' + k + ':2020-01-01',
  approval: { no: { 'nek-a': '185', 'nek-b': '185', sep: '185', secondary: 'S', 'no-currency': 'NC', unverified: 'U' }[k] || k, date_iso: '2020-01-01' },
  official_check: { result: k === 'secondary' ? 'только_вторичный_источник' : 'подтверждено_официальным_PDF' },
  currency_check: k === 'no-currency' ? { result: 'не_проверена', basis: null } : { result: 'новее_редакции_не_найдено', basis: 'синтетическая проверка' },
  registry_status: k === 'unverified' ? 'не проверен' : 'действует'
})));
const REGH = E.loadRegistry(SYN_REG).registry;
const CARE = '2026-01-10';
const searched = (o) => {
  o = o || {};
  const key = o.doc_id || (o.protocol_no && o.protocol_no !== 'T-1' ? 'КП-ДЛ:' + o.protocol_no + ':2020-01-01' : 'КП-ДЛ:t-1:2020-01-01');
  const r = E.registryEntry(REGH, key, o.care_date || CARE, { sections: ['раздел 1'] });
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.entry;
};

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
const regAtt = E.attestRegistryCompleteness({ confirmed_by: 'эксперт-1', total: 29, registry_version: 'синтетический v1', checked_protocols: ['КП-ДЛ:4:2020-01-01', 'КП-ДЛ:185:2020-01-01', 'КП-ДЛ:231:2020-01-01'], basis: 'синтетическая сверка' }).attestation;
// Отклонение по дозе (вне диапазона протокола): реестр полноты не требуется
function diffDev() { const d = base(); d.order.params.dose_mg_per_kg = 20; return d; }
// Отклонение «не урегулировано»: лечебный курс противогрибкового препарата
function deviation() {
  const d = base();
  d.order = { text: 'Лечебный курс противогрибкового препарата Y (синтетический пример)', drug: 'препарат Y', params: {}, date_time: '2026-01-12T10:00' };
  d.protocol_check = {
    relation: 'не_урегулировано',
    searched: [searched({ protocol_no: '4' }), searched({ protocol_no: '185' }), searched({ protocol_no: '231' })],
    match: null, search_date: '2026-11-18',
    registry_coverage: { total: 29, missing_applicable: [], completeness_attestation: regAtt }
  };
  return d;
}
// Подтверждения создаются только через attest* (с проверяющим)
const bib = (o) => E.attestBibliographic(Object.assign({ found: true, metadata_match: true, method: 'manual', checked_by: 'эксперт-1', checked_at: '2026-11-18' }, o || {})).attestation;
// Экспертная оценка привязана к клиническому контексту d и к источнику
const SRC = 'Синтетическая публикация А';
const ea = (d, o) => E.attestExpertAssessment(Object.assign({ applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'эксперт-1', at: '2026-11-18', context: d, source_key: SRC + '||' }, o || {})).attestation;
const goodEvidence = (d, o) => Object.assign({
  citation: SRC, presented: true,
  bibliographic: bib(), expert_assessment: ea(d),
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
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d)]; d.conflicts = [{ a: 'посев от 12.01: рост грибов (запись врача)', b: 'посев от 12.01: роста нет (лаборатория)' }]; return d; },
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
    build: () => { const d = base(); d.protocol_check.searched = [searched({ care_date: '2019-01-01' })]; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 12, title: 'Отклонение, запись врача не найдена во фрагменте',
    build: () => { const d = asFragment(deviation()); d.evidence = [goodEvidence(d)]; d.documentation.physician_note = 'не_найдено_во_фрагменте'; return d; },
    expect: { status: S.INSUFFICIENT, doc: 'не_определена' } },
  { n: 13, title: '«Не урегулировано» без сведений о полноте реестра',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d)]; delete d.protocol_check.registry_coverage; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 14, title: 'Противогрибковая терапия обоснована, но реестр не сверен с официальными источниками — вывод заблокирован',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d)]; return d; },
    expect: { status: S.EXPERT, relation: 'не_урегулировано', statement: E.NOT_REG_STATEMENT, blocked: true } },
  { n: 15, title: 'Доза вне диапазона: частичная применимость с записью врача о причине переноса',
    build: () => { const d = diffDev(); d.evidence = [goodEvidence(d, { expert_assessment: ea(d, { applicability: 'частично' }), transfer_rationale_documented: true })]; return d; },
    expect: { status: S.JUSTIFIED } },
  { n: 16, title: 'Доза вне диапазона, вне инструкции, полное обоснование — рекомендация консилиума',
    build: () => { const d = diffDev(); d.order.off_label = true; d.evidence = [goodEvidence(d)]; return d; },
    expect: { status: S.JUSTIFIED, recommendation: 'консилиум' } },
  { n: 17, title: 'Противогрибковая терапия без источника и без записи врача',
    build: () => { const d = deviation(); d.documentation.physician_note = 'не_найдено_в_полной_истории'; return d; },
    expect: { status: S.INCOMPLETE, missing: ['источник не предъявлен', 'запись врача с обоснованием'] } },
  { n: 18, title: 'Доза вне диапазона и показания не подтверждены одновременно',
    build: () => { const d = base(); d.order.params.dose_mg_per_kg = 20; d.indications.value = 'не_подтверждены'; return d; },
    expect: { status: S.INCOMPLETE, relation: 'отличается', missing: ['показания у пациента не подтверждены'] } },
  { n: 19, title: 'Источник о взрослых для недоношенного 700 г: эксперт — не совпадает',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d, { population: 'взрослые', expert_assessment: ea(d, { applicability: 'не_совпадает', regimen_match: 'частично' }) })]; return d; },
    expect: { status: S.INCOMPLETE, missing: ['не применим'] } },
  { n: 20, title: 'Источник не найден в PubMed',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d, { bibliographic: bib({ found: false }) })]; return d; },
    expect: { status: S.INCOMPLETE, missing: ['библиографическую проверку'] } },
  { n: 21, title: 'Консилиум обязателен по положению центра, но не найден',
    cfg: { consilium_mandatory: true, consilium_basis: 'синтетическое положение центра' },
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d)]; return d; },
    expect: { status: S.INCOMPLETE, missing: ['консилиум'] } },
  { n: 22, title: 'Источник найден в PubMed, экспертная оценка ещё не проведена',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d, { expert_assessment: null })]; return d; },
    expect: { status: S.EXPERT } },
  { n: 23, title: 'Частичная применимость без записи о причине переноса',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d, { expert_assessment: ea(d, { applicability: 'частично', regimen_match: 'частично' }) })]; return d; },
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
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d)]; d.protocol_check.registry_coverage.missing_applicable = ['протокол по кандидозу (не внесён)']; return d; },
    expect: { status: S.INSUFFICIENT, relation: 'невозможно_проверить' } },
  { n: 29, title: 'Протокол «не проверен» в реестре — положительный вывод заблокирован',
    build: () => { const d = base(); d.protocol_check.searched = [searched({ doc_id: 'КП-ДЛ:unverified:2020-01-01' })]; d.protocol_check.match.protocol_no = 'U'; return d; },
    expect: { status: S.EXPERT, blocked: true } },
  { n: 30, title: 'Обоснованное отклонение, но редакция одного из просмотренных протоколов не подтверждена',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d)]; d.protocol_check.searched[1] = searched({ protocol_no: '185', care_date: '2019-01-01' }); return d; },
    expect: { status: S.EXPERT, blocked: true } },
  { n: 31, title: 'Протокол сейчас заменён, но действовал на дату помощи',
    build: () => { const d = base(); return d; },   // «заменён» с датой окончания позже даты помощи — см. отдельный тест
    expect: { status: S.COMPLIANT, blocked: false } },
  { n: 32, title: 'Экспертная оценка пришла во входных данных без подтверждения',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d, { expert_assessment: { applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'кто-то' } })]; return d; },
    expect: { status: S.EXPERT, warning: 'не подтверждена и не учитывается' } },
  { n: 33, title: 'Результат PubMed во входных данных без подтверждения проверяющего',
    build: () => { const d = deviation(); d.evidence = [goodEvidence(d, { bibliographic: { method: 'pubmed_api', found: true, metadata_match: true } })]; return d; },
    expect: { status: S.EXPERT, warning: 'не подтверждён проверяющим' } },
  { n: 34, title: 'Протокол «не проверен», доза вне диапазона без обоснования — проблемы всё равно видны',
    build: () => { const d = base(); d.protocol_check.searched = [searched({ doc_id: 'КП-ДЛ:unverified:2020-01-01' })]; d.protocol_check.match.protocol_no = 'U'; d.order.params.dose_mg_per_kg = 20; d.documentation.physician_note = 'не_найдено_в_полной_истории'; return d; },
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
  const d = diffDev(); d.evidence = [goodEvidence(d)];
  assert.equal(E.evaluate(d).status, S.JUSTIFIED);
  const copy = JSON.parse(JSON.stringify(d));
  assert.equal(E.evaluate(copy).status, S.EXPERT);
});

test('attest* требуют проверяющего и допустимые значения', () => {
  assert.equal(E.attestBibliographic({ found: true, metadata_match: true, method: 'manual' }).ok, false);
  assert.equal(E.attestBibliographic({ found: true, metadata_match: true, method: 'на глаз', checked_by: 'э' }).ok, false);
  assert.equal(E.attestExpertAssessment({ applicability: 'да', regimen_match: 'совпадает', assessed_by: 'э' }).ok, false);
  assert.equal(E.attestExpertAssessment({ applicability: 'совпадает', regimen_match: 'совпадает' }).ok, false);
  assert.equal(E.attestExpertAssessment({ applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'э', source_key: 'x' }).ok, false, 'без контекста');
  const a = E.attestExpertAssessment({ applicability: 'совпадает', regimen_match: 'совпадает', assessed_by: 'э', context: base(), source_key: 'x' }).attestation;
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

/* ---------- Замечания проверки PR #5 ---------- */

test('замечание 3: полнота реестра только заявлена — положительный вывод заблокирован', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  d.protocol_check.registry_coverage = { total: 29, missing_applicable: [] };   // выбор пользователя без подтверждения
  const r = E.evaluate(d);
  assert.equal(r.clinical.relation, 'не_урегулировано');
  assert.equal(r.status, S.EXPERT);
  assert.equal(r.positive_blocked, true);
  assert.ok(r.clinical.statement.includes('заявлена, но не подтверждена'));
  // подтверждение на другое число протоколов не принимается
  d.protocol_check.registry_coverage.completeness_attestation = E.attestRegistryCompleteness({ confirmed_by: 'э', total: 30, registry_version: 'v', checked_protocols: ['4', '185', '231'], basis: 'b' }).attestation;
  assert.equal(E.evaluate(d).positive_blocked, true);
  assert.equal(E.attestRegistryCompleteness({ total: 29 }).ok, false);
});

test('замечание 1: черновик по результату движка, а не по выбору пользователя', () => {
  // пользователь выбрал «не урегулировано», но перечня протоколов нет — движок: невозможно проверить
  const d = deviation(); d.evidence = [goodEvidence(d)]; d.protocol_check.searched = [];
  const r = E.evaluate(d);
  assert.equal(r.clinical.relation, 'невозможно_проверить');
  const t = E.buildJustificationDraft(d, r);
  assert.equal(t.ok, true); assert.equal(t.cautious, true); assert.equal(t.relation, 'невозможно_проверить');
  assert.ok(t.text.includes('установить не удалось'));
  assert.ok(!t.text.includes(E.NOT_REG_STATEMENT));
  assert.ok(t.text.includes('не может считаться достаточным'));
});

test('замечание 1: диапазон дозы переопределяет выбор — черновик говорит «в пределах протокола»', () => {
  const d = base(); d.protocol_check.relation = 'отличается';
  const t = E.buildJustificationDraft(d, E.evaluate(d));
  assert.ok(t.text.includes('в пределах протокола'));
  assert.ok(!t.text.includes('отличается от требования'));
});

test('замечание 1: осторожные формулировки при неполной проверке, полная — без слова «доказанно правильное» как утверждения', () => {
  const ok = diffDev(); ok.evidence = [goodEvidence(ok)];
  const tj = E.buildJustificationDraft(ok, E.evaluate(ok));
  assert.equal(tj.cautious, false);
  assert.ok(tj.text.includes('не означает, что назначение доказанно правильное'));
  const bad = deviation(); bad.documentation.physician_note = 'не_найдено_в_полной_истории';
  const tb = E.buildJustificationDraft(bad, E.evaluate(bad));
  assert.equal(tb.cautious, true);
  assert.ok(tb.text.includes('Не хватает:'));
  const blk = deviation(); blk.evidence = [goodEvidence(blk)]; blk.protocol_check.searched[0] = searched({ doc_id: 'КП-ДЛ:unverified:2020-01-01' });
  assert.ok(E.buildJustificationDraft(blk, E.evaluate(blk)).text.includes('Вывод предварительный'));
});

test('замечание 2: результат и черновик указывают, что анализируются введённые вручную сведения', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  const r = E.evaluate(d);
  assert.equal(r.analysis_basis, E.ANALYSIS_BASIS);
  assert.ok(E.ANALYSIS_BASIS.includes('вручную'));
  assert.ok(E.buildJustificationDraft(d, r).text.startsWith('ТЕСТОВЫЙ ЧЕРНОВИК. Основа: ' + E.ANALYSIS_BASIS));
});

test('замечание 4: все подтверждения и решения в браузере помечены как тестовые', () => {
  for (const a of [bib(), ea(base()), regAtt]) { assert.equal(a.test_only, true); assert.equal(a.assurance, E.TEST_ASSURANCE); }
  const d = deviation(); d.evidence = [goodEvidence(d)];
  const r = E.evaluate(d);
  assert.equal(r.test_confirmations_used, true);
  assert.equal(E.evaluate(base()).test_confirmations_used, false);
  const o = E.applyExpertOverride(r, { who: 'э', status: S.EXPERT, reason: 'x', source: 'y' });
  assert.equal(o.history[0].test_only, true);
  assert.ok(o.headline.includes('тестовое'));
});

test('замечание 5: изменение данных делает результат устаревшим; решение по устаревшему отклоняется', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  const r = E.evaluate(d);
  assert.equal(E.isStale(r, d), false);
  const d2 = deviation(); d2.evidence = [goodEvidence(d2)]; d2.order.text += ' (изменено)';
  assert.equal(E.isStale(r, d2), true);
  assert.equal(E.applyExpertOverride(r, { who: 'э', status: S.EXPERT, reason: 'x', source: 'y', current_input: d2 }).ok, false);
  assert.equal(E.applyExpertOverride(r, { who: 'э', status: S.EXPERT, reason: 'x', source: 'y', current_input: d }).ok, true);
  assert.equal(E.buildJustificationDraft(d2, r).ok, false);
});

test('замечание 5: повторная проверка сохраняет историю решений и прежние результаты', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  const r0 = E.evaluate(d);
  const r1 = E.applyExpertOverride(r0, { who: 'эксперт-1', status: S.POTENTIAL_DEFECT, reason: 'x', source: 'протокол №1' });
  const d2 = deviation(); d2.documentation.physician_note = 'не_найдено_в_полной_истории';
  const r2 = E.reevaluate(r1, d2);
  assert.equal(r2.status, S.INCOMPLETE);
  assert.equal(r2.status_set_by, 'auto');
  assert.equal(r2.history.length, 2);
  assert.equal(r2.history[0].to, S.POTENTIAL_DEFECT);
  assert.equal(r2.history[1].event, 'повторная проверка');
  assert.equal(r2.prior_results.length, 1);
  assert.equal(r2.prior_results[0].status, S.POTENTIAL_DEFECT);
  assert.equal(E.isStale(r2, d2), false);
});

/* ---------- Риски финальной проверки этапа 3 ---------- */

test('риск 1: подтверждение полноты реестра кнопкой не снимает блокировку до реальной сверки', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  const r = E.evaluate(d);
  assert.equal(r.status, S.EXPERT);
  assert.equal(r.positive_blocked, true);
  assert.ok(r.blocked_by.some(x => x.includes('не сверен с официальными источниками')));
  assert.ok(r.clinical.statement.includes('сверка с официальными источниками не проведена'));
  assert.equal(regAtt.verification, 'заявлено_экспертом');
});

test('риск 1: подтверждение полноты хранит перечень протоколов, версию реестра и основание', () => {
  assert.deepEqual(Array.from(regAtt.checked_protocols), ['КП-ДЛ:4:2020-01-01', 'КП-ДЛ:185:2020-01-01', 'КП-ДЛ:231:2020-01-01']);
  assert.equal(regAtt.registry_version, 'синтетический v1');
  assert.equal(regAtt.basis, 'синтетическая сверка');
  const miss = (o) => E.attestRegistryCompleteness(Object.assign({ confirmed_by: 'э', total: 29, registry_version: 'v', checked_protocols: ['4'], basis: 'b' }, o)).ok;
  assert.equal(miss({ checked_protocols: [] }), false);
  assert.equal(miss({ registry_version: '' }), false);
  assert.equal(miss({ basis: '' }), false);
  // просмотрен протокол, которого нет в перечне подтверждения — полнота не подтверждена
  const d = deviation(); d.evidence = [goodEvidence(d)];
  d.protocol_check.searched.push({ protocol_no: '10', registry_status: 'действует', valid_on_care_date: 'да' });
  const r = E.evaluate(d);
  assert.ok(r.blocked_by.some(x => x.includes('заявлена, но не подтверждена')));
});

test('риск 2: изменение схемы назначения требует повторной экспертной оценки, библиография сохраняется', () => {
  const d = diffDev(); d.evidence = [goodEvidence(d)];
  assert.equal(E.evaluate(d).status, S.JUSTIFIED);
  const d2 = diffDev(); d2.evidence = d.evidence; d2.order.params.dose_mg_per_kg = 25;   // та же оценка, другая схема
  const r = E.evaluate(d2);
  assert.equal(r.status, S.EXPERT);
  assert.ok(r.reasons.some(x => x.includes('нужна повторная экспертная оценка')), r.reasons.join(' | '));
  assert.ok(r.warnings.some(x => x.includes('оценка не учитывается')));
  assert.equal(r.evidence.items[0].verdict, 'нужна повторная экспертная оценка');   // библиография принята, оценка нет
  d2.evidence = [Object.assign({}, d.evidence[0], { expert_assessment: ea(d2) })];   // повторная оценка
  assert.equal(E.evaluate(d2).status, S.JUSTIFIED);
});

test('риск 2: изменение показаний (клинического контекста) требует повторной оценки', () => {
  const d = diffDev(); d.evidence = [goodEvidence(d)];
  const d2 = diffDev(); d2.evidence = d.evidence; d2.indications = { value: 'подтверждены', facts: [{ text: 'другой синтетический факт', source: 'x' }] };
  assert.equal(E.evaluate(d2).status, S.EXPERT);
});

test('риск 2: оценка другого источника не переносится', () => {
  const d = diffDev(); d.evidence = [goodEvidence(d, { citation: 'Синтетическая публикация Б' })];   // оценка выдана для А
  assert.equal(E.evaluate(d).status, S.EXPERT);
});

/* ---------- Этап 4: требования проверки PR #6 ---------- */

test('ручные поля official_evidence/currency_verified во входных данных не учитываются', () => {
  const d = base();
  d.protocol_check.searched = [Object.assign({}, searched())];   // копия: те же поля, но не из реестра
  const r = E.evaluate(d);
  assert.equal(r.positive_blocked, true);
  assert.ok(r.blocked_by.some(x => x.includes('не из загруженного реестра')));
});

test('официальный документ без проверки актуальности не даёт положительного вывода', () => {
  const d = base(); d.protocol_check.searched = [searched({ doc_id: 'КП-ДЛ:no-currency:2020-01-01' })]; d.protocol_check.match.protocol_no = 'NC';
  const r = E.evaluate(d);
  assert.equal(r.status, S.INSUFFICIENT);   // без проверки актуальности редакция на дату помощи не определяется
});

test('вторичный источник не заменяет официальное подтверждение', () => {
  const d = base(); d.protocol_check.searched = [searched({ doc_id: 'КП-ДЛ:secondary:2020-01-01' })]; d.protocol_check.match.protocol_no = 'S';
  const r = E.evaluate(d);
  assert.equal(r.positive_blocked, true);
  assert.ok(r.blocked_by.some(x => x.includes('не подтверждён официальным документом')));
});

test('применимость на дату помощи вычисляется из реестра, а не со входа', () => {
  assert.equal(searched({ care_date: '2019-06-01' }).valid_on_care_date, 'не_определено');   // помощь до одобрения
  assert.equal(searched().valid_on_care_date, 'да');
  assert.equal(E.registryEntry({ version: 'x', _map: new Map() }, 'КП-ДЛ:t-1:2020-01-01', CARE).ok, false);   // поддельный реестр
  assert.equal(E.registryEntry(REGH, 'КП-ДЛ:нет:2020-01-01', CARE).ok, false);
  const reg2 = E.loadRegistry({ version: 'v', protocols: [synDoc(), synDoc()] });
  assert.equal(reg2.ok, false);   // повтор doc_id
});

test('заменённая редакция применима только до даты окончания', () => {
  const h = E.loadRegistry({ version: 'v', protocols: [synDoc({ registry_status: 'заменён', valid_to: '2023-07-28' })] }).registry;
  assert.equal(E.registryEntry(h, 'КП-ДЛ:t-1:2020-01-01', '2022-01-01').entry.valid_on_care_date, 'да');
  assert.equal(E.registryEntry(h, 'КП-ДЛ:t-1:2020-01-01', '2024-01-01').entry.valid_on_care_date, 'не_определено');
});

test('номер заседания ОКК не идентифицирует документ: два документа №185 → невозможно проверить', () => {
  const d = base();
  d.protocol_check.searched = [searched({ doc_id: 'КП-ДЛ:sep:2020-01-01' }), searched({ doc_id: 'КП-ДЛ:nek-a:2020-01-01' })];
  d.protocol_check.match.protocol_no = '185';
  const r = E.evaluate(d);
  assert.equal(r.clinical.relation, 'невозможно_проверить');
  assert.ok(r.reasons.some(x => x.includes('не идентифицирует документ однозначно')));
  const d2 = base();
  d2.protocol_check.searched = d.protocol_check.searched;
  d2.protocol_check.match = Object.assign({}, d.protocol_check.match, { doc_id: 'КП-ДЛ:nek-a:2020-01-01' });
  const r2 = E.evaluate(d2);
  assert.equal(r2.status, S.COMPLIANT);
  assert.ok(r2.clinical.statement.includes('КП-ДЛ:nek-a:2020-01-01'));
});

test('полнота подтверждается по doc_id, а не по номеру заседания', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  d.protocol_check.searched = [searched({ doc_id: 'КП-ДЛ:nek-a:2020-01-01' }), searched({ doc_id: 'КП-ДЛ:nek-b:2020-01-01' })];
  d.protocol_check.registry_coverage.completeness_attestation = E.attestRegistryCompleteness({ confirmed_by: 'э', total: 29, registry_version: 'v', basis: 'b', checked_protocols: ['185'] }).attestation;
  assert.ok(E.evaluate(d).blocked_by.some(x => x.includes('заявлена, но не подтверждена')));
});

test('недопустимый тип протокола отклоняется', () => {
  const d = base(); d.protocol_check.searched = [Object.assign({}, searched(), { protocol_type: 'лечение' })];
  assert.equal(E.evaluate(d).ok, false);
});

test('блокировка из-за неполноты реестра сохраняется при полном официальном подтверждении', () => {
  const d = deviation(); d.evidence = [goodEvidence(d)];
  d.protocol_check.registry_coverage.missing_applicable = ['Крайняя незрелость'];
  const r = E.evaluate(d);
  assert.equal(r.clinical.relation, 'невозможно_проверить');
  assert.notEqual(r.status, S.JUSTIFIED);
});
