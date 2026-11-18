/*
 * Антидефект — модуль «Отклонение от протокола + обоснование».
 * Этапы 1–2 ТЗ v0.3 (docs/deviation-module-spec.md): модель данных,
 * независимые проверки, детерминированный механизм статусов, журнал решений эксперта.
 *
 * Модуль только читает входные данные и ничего в них не меняет.
 * Не использует ИИ и сеть. Работает в браузере (window.DeviationEngine) и в Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeviationEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.3.0-stage2';

  const STATUS = Object.freeze({
    URGENT: 'Требуется срочная оценка эксперта',
    EXPERT: 'Требуется оценка эксперта',
    INSUFFICIENT: 'Недостаточно данных',
    COMPLIANT: 'Соответствует протоколу',
    JUSTIFIED: 'Обоснованное отклонение',
    INCOMPLETE: 'Отклонение документировано не полностью',
    POTENTIAL_DEFECT: 'Потенциальный дефект' // только решением эксперта
  });
  const AUTO_STATUSES = Object.freeze([STATUS.URGENT, STATUS.EXPERT, STATUS.INSUFFICIENT,
    STATUS.COMPLIANT, STATUS.JUSTIFIED, STATUS.INCOMPLETE]);
  const ALL_STATUSES = Object.freeze(AUTO_STATUSES.concat([STATUS.POTENTIAL_DEFECT]));

  const RELATION = Object.freeze({
    OK: 'соответствует', DIFF: 'отличается',
    NOT_REG: 'не_урегулировано', UNKNOWN: 'невозможно_проверить'
  });
  const INDICATIONS = Object.freeze({
    CONFIRMED: 'подтверждены', NOT_CONFIRMED: 'не_подтверждены', INSUFFICIENT: 'недостаточно_данных'
  });
  const DOC = Object.freeze({
    FOUND: 'найдено', FRAGMENT: 'не_найдено_во_фрагменте', FULL: 'не_найдено_в_полной_истории'
  });
  const DOC_LABEL = Object.freeze({
    physician_note: 'запись врача с обоснованием',
    risk_benefit: 'оценка пользы и рисков',
    monitoring: 'мониторинг эффективности и безопасности',
    consilium: 'консилиум',
    consent: 'информированное согласие'
  });
  const SIGNAL_KINDS = Object.freeze(['возможное_противопоказание', 'возможное_превышение_дозы',
    'возможное_несоответствие_пути_введения', 'возможное_несоответствие_интервала']);
  const SEVERITY = Object.freeze(['низкая', 'средняя', 'высокая', 'критическая']);
  const CONFIDENCE = Object.freeze(['низкая', 'средняя', 'высокая']);
  const APPLICABILITY = Object.freeze(['совпадает', 'частично', 'не_совпадает', 'не_определено']);
  const REGIMEN = Object.freeze(['совпадает', 'частично', 'нет', 'не_определено']);

  const NOT_REG_STATEMENT = 'прямая рекомендация не найдена в проверенном наборе применимых протоколов';

  const DEFAULT_CONFIG = Object.freeze({
    consilium_mandatory: false,        // true только при указании основания
    consilium_basis: '',               // нормативный или локальный документ
    extra_required_documentation_for_deviation: [],
    urgent_min_severity: 'высокая',
    urgent_min_confidence: 'средняя'
  });

  function isStr(x) { return typeof x === 'string' && x.trim().length > 0; }
  function uniq(a) { return Array.from(new Set(a)); }
  function rank(list, v) { return list.indexOf(v); }

  /* ---------- Этап 1: проверка структуры ---------- */

  function validate(d, config) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const e = [];
    if (!d || typeof d !== 'object') return ['нет входных данных'];
    if (!isStr(d.id)) e.push('нет id');
    if (!isStr(d.patient_ref)) e.push('нет patient_ref (псевдоним пациента)');
    if (d.history_scope !== 'full' && d.history_scope !== 'fragment') e.push('history_scope: full или fragment');
    if (!d.order || !isStr(d.order.text)) e.push('нет order.text');

    const pc = d.protocol_check;
    if (!pc || !Object.values(RELATION).includes(pc.relation)) e.push('protocol_check.relation: недопустимое значение');
    else if (!Array.isArray(pc.searched)) e.push('protocol_check.searched должен быть массивом');

    if (!d.indications || !Object.values(INDICATIONS).includes(d.indications.value)) e.push('indications.value: недопустимое значение');
    if (!d.documentation || typeof d.documentation !== 'object') e.push('нет documentation');
    else {
      for (const k of Object.keys(d.documentation)) {
        if (!DOC_LABEL[k]) e.push('documentation: неизвестный пункт ' + k);
        else if (!Object.values(DOC).includes(d.documentation[k])) e.push('documentation.' + k + ': недопустимое значение');
      }
    }
    (d.required_documentation || []).forEach(k => { if (!DOC_LABEL[k]) e.push('required_documentation: неизвестный пункт ' + k); });

    if (d.history_scope === 'fragment') {
      if (d.indications && d.indications.value === INDICATIONS.NOT_CONFIRMED)
        e.push('по фрагменту истории нельзя установить «показания не подтверждены» — укажите «недостаточно_данных»');
      if (d.documentation) for (const k of Object.keys(d.documentation))
        if (d.documentation[k] === DOC.FULL) e.push('documentation.' + k + ': «не найдено в полной истории» при history_scope=fragment');
    }

    (d.signals || []).forEach((s, i) => {
      const p = 'signals[' + i + ']: ';
      if (!SIGNAL_KINDS.includes(s.kind)) e.push(p + 'недопустимый вид');
      if (!SEVERITY.includes(s.severity)) e.push(p + 'нет серьёзности');
      if (!CONFIDENCE.includes(s.confidence)) e.push(p + 'нет уверенности');
      if (typeof s.confirmed !== 'boolean') e.push(p + 'не указана подтверждённость');
      if (!isStr(s.requirement_quote)) e.push(p + 'нет цитаты требования');
      if (!isStr(s.fact)) e.push(p + 'нет факта из истории');
      if (!isStr(s.source)) e.push(p + 'нет источника факта');
    });
    (d.conflicts || []).forEach((c, i) => {
      if (!isStr(c.a) || !isStr(c.b)) e.push('conflicts[' + i + ']: нужны оба противоречащих факта');
    });
    (d.evidence || []).forEach((v, i) => {
      const p = 'evidence[' + i + ']: ';
      if (typeof v.presented !== 'boolean') e.push(p + 'не указано, предъявлен ли источник');
      if (v.presented && !isStr(v.citation) && !isStr(v.pmid) && !isStr(v.doi)) e.push(p + 'нет описания источника');
      const ea = v.expert_assessment;
      if (ea) {
        if (!APPLICABILITY.includes(ea.applicability)) e.push(p + 'applicability: недопустимое значение');
        if (!REGIMEN.includes(ea.regimen_match)) e.push(p + 'regimen_match: недопустимое значение');
        if (!isStr(ea.assessed_by)) e.push(p + 'не указано, кто оценил');
      }
    });

    if (cfg.consilium_mandatory && !isStr(cfg.consilium_basis))
      e.push('настройки: обязательный консилиум без указания основания не принимается');
    if (!SEVERITY.includes(cfg.urgent_min_severity) || !CONFIDENCE.includes(cfg.urgent_min_confidence))
      e.push('настройки: недопустимые пороги срочности');

    if (/(^|\D)\d{12}(?!\d)/.test(JSON.stringify(d)))
      e.push('во входных данных есть последовательность из 12 цифр (возможный ИИН) — используйте псевдоним');
    return e;
  }

  /* ---------- Отношение к протоколу ---------- */

  function deriveRelation(d) {
    const pc = d.protocol_check, notes = [], warnings = [];
    let relation = pc.relation, source = 'supplied';
    const match = pc.match || null;
    const ranges = match && match.ranges && typeof match.ranges === 'object' ? match.ranges : null;

    if (ranges && Object.keys(ranges).length) {
      source = 'ranges';
      const params = (d.order && d.order.params) || {};
      const outside = [], absent = [];
      for (const name of Object.keys(ranges)) {
        const r = ranges[name], v = params[name];
        if (typeof v !== 'number' || Number.isNaN(v)) { absent.push(name); continue; }
        if ((r.min != null && v < r.min) || (r.max != null && v > r.max))
          outside.push(name + ' = ' + v + ' вне диапазона протокола [' + (r.min == null ? '−∞' : r.min) + '; ' + (r.max == null ? '+∞' : r.max) + ']');
      }
      if (outside.length) { relation = RELATION.DIFF; notes.push.apply(notes, outside); }
      else if (absent.length) { relation = RELATION.UNKNOWN; notes.push('в назначении нет значения параметра: ' + absent.join(', ')); }
      else relation = RELATION.OK;
      if (relation !== pc.relation)
        warnings.push('заявленное отношение «' + pc.relation + '» заменено результатом сравнения с диапазонами: «' + relation + '»');
    }

    let statement = '';
    if (relation === RELATION.OK || relation === RELATION.DIFF) {
      const hasRef = match && isStr(match.protocol_no) && isStr(match.section) && isStr(match.quote);
      const sp = hasRef ? pc.searched.find(s => s.protocol_no === match.protocol_no) : null;
      if (!hasRef) { relation = RELATION.UNKNOWN; notes.push('нет ссылки на протокол (номер, раздел, дословная цитата)'); }
      else if (!sp) { relation = RELATION.UNKNOWN; notes.push('протокол №' + match.protocol_no + ' отсутствует в перечне просмотренных'); }
      else if (sp.valid_on_care_date !== 'да') {
        relation = RELATION.UNKNOWN;
        notes.push('редакция протокола №' + sp.protocol_no + ' на дату оказания помощи не подтверждена (' + (sp.valid_on_care_date || 'не указано') + ')');
      } else {
        statement = 'протокол №' + match.protocol_no + ', раздел «' + match.section + '»: «' + match.quote + '»';
        if (sp.registry_status === 'не проверен') warnings.push('актуальность протокола №' + sp.protocol_no + ' в реестре не проверена');
      }
    }
    if (relation === RELATION.NOT_REG) {
      const cov = pc.registry_coverage;
      if (!pc.searched.length || !cov || typeof cov.total !== 'number' || !Array.isArray(cov.missing_applicable)) {
        relation = RELATION.UNKNOWN;
        notes.push('«не урегулировано» нельзя установить без перечня просмотренных протоколов и сведений о полноте реестра');
      } else {
        statement = NOT_REG_STATEMENT + ' (просмотрены: ' + pc.searched.map(s => '№' + s.protocol_no).join(', ') + ')';
        if (cov.missing_applicable.length) warnings.push('в реестр не внесены применимые протоколы: ' + cov.missing_applicable.join(', '));
        pc.searched.forEach(s => { if (s.valid_on_care_date !== 'да') warnings.push('редакция протокола №' + s.protocol_no + ' на дату помощи не подтверждена'); });
      }
    }
    if (relation === RELATION.UNKNOWN && !notes.length) notes.push('отношение к протоколу невозможно проверить');
    return { relation, source, statement, notes, warnings };
  }

  /* ---------- Научное обоснование ---------- */

  function assessEvidence(list) {
    const out = { qualifies: false, needs_expert: [], gaps: [], items: [] };
    const presented = (list || []).filter(v => v.presented);
    if (!presented.length) { out.gaps.push('источник не предъявлен'); return out; }
    for (const v of presented) {
      const name = '«' + (v.citation || v.pmid || v.doi) + '»';
      const b = v.bibliographic || {};
      const bibOk = b.found === true && b.metadata_match === true;
      let verdict;
      if (!bibOk) {
        verdict = 'не прошёл библиографическую проверку';
        out.gaps.push('источник ' + name + ' не прошёл библиографическую проверку');
      } else if (!v.expert_assessment) {
        verdict = 'ждёт экспертной оценки';
        out.needs_expert.push('источник ' + name + ' найден, но применимость и схема не оценены экспертом');
      } else {
        const a = v.expert_assessment.applicability, r = v.expert_assessment.regimen_match;
        if (a === 'не_совпадает' || r === 'нет') {
          verdict = 'не применим';
          out.gaps.push('источник ' + name + ' не применим к пациенту или схеме (оценка эксперта)');
        } else if (a === 'не_определено' || r === 'не_определено') {
          verdict = 'применимость не определена';
          out.needs_expert.push('источник ' + name + ': применимость или схема не определены');
        } else if (a === 'частично' || r === 'частично') {
          if (v.transfer_rationale_documented === true) { verdict = 'принят (частичное совпадение, перенос обоснован)'; out.qualifies = true; }
          else { verdict = 'частичное совпадение без обоснования переноса'; out.needs_expert.push('источник ' + name + ' совпадает частично, запись врача о причине переноса данных не найдена'); }
        } else { verdict = 'принят'; out.qualifies = true; }
      }
      out.items.push({ source: v.citation || v.pmid || v.doi, verdict });
    }
    if (out.qualifies) { out.needs_expert = []; out.gaps = []; }
    else if (out.needs_expert.length) out.gaps = [];
    return out;
  }

  function isUrgent(s, cfg) {
    return rank(SEVERITY, s.severity) >= rank(SEVERITY, cfg.urgent_min_severity) &&
      (s.confirmed === true || rank(CONFIDENCE, s.confidence) >= rank(CONFIDENCE, cfg.urgent_min_confidence));
  }

  function composeHeadline(status, documentation) {
    let h = status;
    if (documentation.state === 'неполная') h += '; документация неполная: ' + documentation.missing_items.join(', ');
    else if (documentation.state === 'не_определена') h += '; полнота документации не определена (предоставлен фрагмент)';
    return h;
  }

  /* ---------- Этап 2: механизм статусов ---------- */

  function evaluate(d, config) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const errors = validate(d, cfg);
    if (errors.length) return { ok: false, errors };

    const rel = deriveRelation(d);
    const relation = rel.relation;
    const ind = d.indications.value;
    const isDeviation = relation === RELATION.DIFF || relation === RELATION.NOT_REG;
    const reasons = rel.notes.slice(), warnings = rel.warnings.slice(), recommendations = [], missing = [];

    // Полнота документации — отдельно от клинического статуса
    const required = uniq((d.required_documentation || []).concat(isDeviation
      ? ['physician_note'].concat(cfg.extra_required_documentation_for_deviation || [], cfg.consilium_mandatory ? ['consilium'] : [])
      : []));
    const absentKeys = required.filter(k => !Object.values(DOC).includes(d.documentation[k]));
    if (absentKeys.length) return { ok: false, errors: absentKeys.map(k => 'не указан результат поиска обязательной записи: ' + k) };
    const docMissing = [], docUnknown = [];
    required.forEach(k => {
      if (d.documentation[k] === DOC.FULL) docMissing.push(k);
      else if (d.documentation[k] === DOC.FRAGMENT) docUnknown.push(k);
    });
    const documentation = {
      state: !required.length ? 'не_требуется' : docMissing.length ? 'неполная' : docUnknown.length ? 'не_определена' : 'полная',
      required, missing: docMissing, unknown: docUnknown,
      missing_items: docMissing.map(k => DOC_LABEL[k]), unknown_items: docUnknown.map(k => DOC_LABEL[k])
    };

    const signals = (d.signals || []).map(s => Object.assign({}, s, { urgent: isUrgent(s, cfg) }));
    const urgent = signals.filter(s => s.urgent);
    const conflicts = (d.conflicts || []).slice();
    const conflict_detected = conflicts.length > 0;
    const evidence = isDeviation ? assessEvidence(d.evidence) : null;

    let status;
    if (urgent.length) {
      status = STATUS.URGENT;
      urgent.forEach(s => reasons.push('срочный сигнал: ' + s.kind + ' (серьёзность ' + s.severity + ', уверенность ' + s.confidence + (s.confirmed ? ', подтверждён' : '') + ')'));
    } else if (conflict_detected || signals.length) {
      status = STATUS.EXPERT;
      conflicts.forEach(c => reasons.push('противоречие: «' + c.a + '» и «' + c.b + '»'));
      signals.forEach(s => reasons.push('сигнал ниже порога срочности: ' + s.kind + ' (серьёзность ' + s.severity + ', уверенность ' + s.confidence + ')'));
    } else {
      const ins = [];
      if (relation === RELATION.UNKNOWN) ins.push('отношение к протоколу невозможно проверить');
      if (ind === INDICATIONS.INSUFFICIENT) ins.push('показания: недостаточно данных');
      if (isDeviation && docUnknown.length) ins.push('при отклонении не найдено во фрагменте: ' + documentation.unknown_items.join(', '));
      if (ins.length) { status = STATUS.INSUFFICIENT; reasons.push.apply(reasons, ins); }
      else if (relation === RELATION.OK && ind === INDICATIONS.CONFIRMED) {
        status = STATUS.COMPLIANT; reasons.push('назначение в пределах протокола, показания подтверждены');
      } else if (isDeviation) {
        if (ind === INDICATIONS.NOT_CONFIRMED) missing.push('показания у пациента не подтверждены (проверена полная история)');
        if (!evidence.qualifies && !evidence.needs_expert.length) missing.push.apply(missing, evidence.gaps);
        documentation.missing_items.forEach(x => missing.push(x + ' — не найдено в полной истории'));
        if (missing.length) status = STATUS.INCOMPLETE;
        else if (!evidence.qualifies) { status = STATUS.EXPERT; reasons.push.apply(reasons, evidence.needs_expert); }
        else { status = STATUS.JUSTIFIED; reasons.push('показания подтверждены', 'источник прошёл библиографическую проверку и принят экспертом', 'запись врача с обоснованием найдена'); }
      } else {
        status = STATUS.INCOMPLETE;
        missing.push('показания у пациента не подтверждены (проверена полная история)');
      }
    }

    // Рекомендации (не влияют на статус)
    const highRisk = signals.length > 0 || (d.order && (d.order.off_label === true || d.order.high_risk === true));
    if (highRisk && d.documentation.consilium !== DOC.FOUND && !(cfg.consilium_mandatory && isDeviation))
      recommendations.push('рекомендуется консилиум (высокий риск: ' + [signals.length ? 'сигнал безопасности' : '', d.order.off_label ? 'вне инструкции' : '', d.order.high_risk ? 'отметка высокого риска' : ''].filter(Boolean).join(', ') + ')');
    if (isDeviation) ['risk_benefit', 'monitoring'].forEach(k => {
      if (!required.includes(k) && d.documentation[k] !== DOC.FOUND) recommendations.push('желательно отразить: ' + DOC_LABEL[k]);
    });

    return {
      ok: true, engine_version: VERSION, id: d.id,
      status, status_set_by: 'auto',
      headline: composeHeadline(status, documentation),
      clinical: { relation, relation_source: rel.source, indications: ind, statement: rel.statement },
      documentation,
      conflict_detected, conflicts,
      safety: { signals, urgent: urgent.length > 0 },
      evidence,
      reasons, missing, recommendations, warnings,
      original: null, history: []
    };
  }

  /* ---------- Решение эксперта (журнал) ---------- */

  function applyExpertOverride(result, o) {
    const errs = [];
    if (!result || !result.ok) errs.push('нет результата проверки');
    ['who', 'status', 'reason', 'source'].forEach(k => { if (!o || !isStr(o[k])) errs.push('не указано: ' + k); });
    if (o && isStr(o.status) && !ALL_STATUSES.includes(o.status)) errs.push('неизвестный статус: ' + o.status);
    if (errs.length) return { ok: false, errors: errs };
    const original = result.original || { status: result.status, status_set_by: result.status_set_by, headline: result.headline, reasons: result.reasons.slice() };
    const entry = { at: o.at || new Date().toISOString(), who: o.who, from: result.status, to: o.status, reason: o.reason, source: o.source };
    return Object.assign({}, result, {
      status: o.status, status_set_by: 'expert',
      headline: composeHeadline(o.status, result.documentation) + ' (решение эксперта)',
      original, history: (result.history || []).concat([entry])
    });
  }

  return {
    VERSION, STATUS, AUTO_STATUSES, ALL_STATUSES, RELATION, INDICATIONS, DOC, DOC_LABEL,
    SIGNAL_KINDS, SEVERITY, CONFIDENCE, APPLICABILITY, REGIMEN, DEFAULT_CONFIG, NOT_REG_STATEMENT,
    validate, evaluate, applyExpertOverride
  };
});
