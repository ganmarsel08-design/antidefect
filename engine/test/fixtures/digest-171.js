'use strict';
// Отпечаток результата одного синтетического случая для регрессии 171 случая (третий круг).
// Используется и для замороженной базовой линии (коммит 2eeb6ae), и для проверки текущей версии:
// одинаковая функция с обеих сторон, поэтому сравнение побайтовое.
// В отпечаток входит всё, что видит эксперт по правилу случая: исход, применимость, части,
// активные неоднозначности, недостающие данные с причинами, подписи карточки, пробелы за неоднозначностью,
// активные противоречия случая, статус и final_conclusion.

function digestRule(r) {
  return {
    observation: r.observation,
    applicability: r.applicability,
    active_ambiguities: r.active_ambiguities.slice(),
    parts: (r.parts || []).map(p => [p.part_id, p.observation, p.active_ambiguities.slice(), p.missing_data.slice()]),
    missing_data: r.missing_data.slice(),
    missing_reasons: Object.assign({}, r.card.missing_reasons),
    labels: r.card.labels.map(l => [l.id, l.text]),
    gaps: (r.card.data_gaps_behind_ambiguity || []).map(g => g.field),
    justification_complete: r.justification_complete
  };
}

function digest(o, ruleId) {
  const r = o.results.find(x => x.rule_id === ruleId);
  return {
    rule: digestRule(r),
    conflicts: o.conflicts.map(c => c.id),
    status: o.status,
    final_conclusion: o.final_conclusion
  };
}

module.exports = { digest, digestRule };
