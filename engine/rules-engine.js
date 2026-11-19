/*
 * Антидефект — применение базы медицинских правил (пилот, этап 5).
 *
 * Правила — кандидаты, не подтверждённые экспертом; база не подписана.
 * Поэтому модуль НИКОГДА не формирует окончательный вывод о качестве лечения
 * (ни «соответствует», ни «дефект»): по каждому правилу выдаётся только
 * предварительное наблюдение по буквальному прочтению цитаты, а итог — «Требуется оценка эксперта»
 * или «Недостаточно данных». Обоснование отклонения, записанное врачом, сохраняется и передаётся эксперту.
 *
 * Модуль не меняет входные данные, не использует ИИ и сеть. Принимает только синтетические случаи.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RulesEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.3.0-stage5-pilot';
  const CANDIDATE = 'кандидат, ожидает экспертного подтверждения';
  const STATUS = Object.freeze({ EXPERT: 'Требуется оценка эксперта', INSUFFICIENT: 'Недостаточно данных' });
  const ALLOWED_STATUSES = Object.freeze([STATUS.EXPERT, STATUS.INSUFFICIENT]);
  const BLOCK = Object.freeze({
    RULES_UNAUTHENTICATED: 'база правил не подписана и не аутентифицирована — окончательный вывод заблокирован',
    RULE_UNCONFIRMED: 'правило — кандидат, не подтверждено экспертом',
    RULE_STATUS_INVALID: 'статус правила изменён без записи подтверждения эксперта — правило не используется',
    AMBIGUOUS: 'в правиле есть неоднозначность, требующая решения врача',
    AMBIGUITY_ACTIVE: 'неоднозначность правила затрагивает этот случай — наблюдение не формируется до решения эксперта'
  });
  const OBS = Object.freeze({
    CONSISTENT: 'совпадает_с_буквальным_прочтением',
    DIFFERS: 'отличается_от_буквального_прочтения',
    NOT_APPLIED_ALLOWED: 'не_применено_допускается_протоколом',
    NOT_ASSESSED: 'не_оценено_нет_данных',
    NOT_APPLICABLE: 'правило_неприменимо',
    RULE_REJECTED: 'правило_не_используется',
    AMBIGUOUS_PENDING: 'неоднозначность_ожидает_экспертного_решения'
  });
  const CONFLICT_LABEL = Object.freeze({
    'противоречие': 'Расхождение положений протокола — требуется решение эксперта',
    'неоднозначность_маршрутизации': 'Неоднозначность маршрутизации — требуется экспертное толкование'
  });
  const OBS_LABEL = Object.freeze({
    [OBS.CONSISTENT]: 'Совпадает с буквальным прочтением (предварительно)',
    [OBS.DIFFERS]: 'Отличается от буквального прочтения (предварительно)',
    [OBS.NOT_APPLIED_ALLOWED]: 'Не применено — протокол это допускает',
    [OBS.NOT_ASSESSED]: 'Недостаточно данных',
    [OBS.NOT_APPLICABLE]: 'Правило неприменимо',
    [OBS.RULE_REJECTED]: 'Правило не используется',
    [OBS.AMBIGUOUS_PENDING]: 'Неоднозначность — ожидает экспертного решения'
  });
  const WEIGHT = Object.freeze({
    'обязательно': 'отличие от требования протокола (кандидат) — нужна оценка эксперта и обоснование',
    'рекомендуется': 'отличие от рекомендации — может быть допустимым при обосновании',
    'не_рекомендуется': 'применено то, что протокол не рекомендует — нужна оценка эксперта и обоснование',
    'противопоказано': 'применено противопоказанное — нужна срочная оценка эксперта',
    'может_применяться': 'вариант, допускаемый протоколом, не применён — отклонением не является'
  });
  // Поля, которые указывают на реальные персональные данные: пилот такие случаи не принимает.
  const PERSONAL_KEYS = /^(name|full_name|patient_name|fio|фио|iin|иин|snils|passport|address|phone|birth_date|date_of_birth|history_no|номер_истории)$/i;

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function assertSynthetic(c) {
    if (!isObj(c)) throw new TypeError('случай должен быть объектом');
    if (c.synthetic !== true) throw new Error('пилот принимает только синтетические случаи (synthetic: true)');
    const scan = (o, path) => {
      for (const k of Object.keys(o)) {
        if (PERSONAL_KEYS.test(k)) throw new Error('во входных данных поле персональных данных: ' + path + k);
        if (isObj(o[k])) scan(o[k], path + k + '.');
      }
    };
    scan(c, '');
  }

  // Трёхзначная логика: true / false / null (нет данных). missing собирает отсутствующие поля.
  // Отсутствующие поля сообщаются, только если от них зависит ответ узла.
  function evalNode(node, data, missing) {
    if (node.all || node.any) {
      const isAll = !!node.all;
      const local = new Set();
      let res = isAll;
      for (const n of (isAll ? node.all : node.any)) {
        const sub = new Set();
        const v = evalNode(n, data, sub);
        if (v === null) sub.forEach(x => local.add(x));
        if (isAll) { if (v === false) res = false; else if (v === null && res !== false) res = null; }
        else { if (v === true) res = true; else if (v === null && res !== true) res = null; }
      }
      if (res === null) local.forEach(x => missing.add(x));
      return res;
    }
    const has = Object.prototype.hasOwnProperty.call(data, node.field) && data[node.field] !== null && data[node.field] !== undefined;
    if (node.op === 'present') return has;
    if (!has) { missing.add(node.field); return null; }
    const v = data[node.field];
    switch (node.op) {
      case 'is_true': return v === true;
      case 'is_false': return v === false;
      case 'eq': return v === node.value;
      case 'in': return Array.isArray(node.value) && node.value.includes(v);
      case 'gt': return typeof v === 'number' ? v > node.value : null;
      case 'gte': return typeof v === 'number' ? v >= node.value : null;
      case 'lt': return typeof v === 'number' ? v < node.value : null;
      case 'lte': return typeof v === 'number' ? v <= node.value : null;
      default: throw new Error('неизвестная операция: ' + node.op);
    }
  }

  function ruleUsable(r) {
    if (r.status === CANDIDATE && !r.expert_confirmation) return true;
    if (r.status !== CANDIDATE && r.expert_confirmation) return true; // подтверждён, но база всё равно не подписана
    return false;
  }

  function justificationOf(c, id) {
    const j = isObj(c.justifications) ? c.justifications[id] : undefined;
    if (!isObj(j)) return { recorded: false, complete: false, value: null };
    const complete = typeof j.text === 'string' && j.text.trim().length > 0 && typeof j.author === 'string' && j.author.trim().length > 0;
    return { recorded: true, complete, value: { text: j.text || '', author: j.author || '', recorded_at: j.recorded_at || null } };
  }

  function evaluateRule(r, data, c) {
    const out = {
      rule_id: r.rule_id, protocol: r.protocol, doc_id: r.doc_id, normativity: r.normativity, kind: r.kind,
      requirement: r.requirement.description, quotes: r.source.quotes.map(q => ({ page: q.page, text: q.text })),
      section: r.source.section, rule_status: r.status,
      applicability: null, observation: null, observation_weight: null,
      provisional: true, final: false, expert_review_required: true,
      missing_data: [], ambiguities: (r.ambiguities || []).map(a => ({ id: a.id, text: a.text, blocking: a.blocking || 'no', scope: a.scope || 'requirement' })),
      active_ambiguities: [], protocol_conflicts: (r.protocol_conflicts || []).slice(),
      exceptions_and_caveats: (r.exceptions_and_caveats || []).slice(),
      blocked_by: [BLOCK.RULES_UNAUTHENTICATED], justification: null, justification_complete: false
    };
    if (r.status === CANDIDATE) out.blocked_by.push(BLOCK.RULE_UNCONFIRMED);
    if (out.ambiguities.length) out.blocked_by.push(BLOCK.AMBIGUOUS);
    if (!ruleUsable(r)) {
      out.blocked_by.push(BLOCK.RULE_STATUS_INVALID);
      out.applicability = 'не_определено';
      out.observation = OBS.RULE_REJECTED;
      out.observation_label = OBS_LABEL[out.observation];
      return out;
    }
    const miss = new Set();
    const app = evalNode(r.applicability.condition, data, miss);
    if (app === null) {
      out.applicability = 'не_определено';
      out.observation = OBS.NOT_ASSESSED;
      out.missing_data = [...miss].sort();
      return withJustification(out, r, c);
    }
    const active = activeAmbiguities(r, data, app);
    if (active.length) {
      // До решения эксперта по неоднозначности не формируется ни «совпадает», ни «отличается».
      out.applicability = app ? 'применимо' : 'зависит_от_неоднозначности';
      out.observation = OBS.AMBIGUOUS_PENDING;
      out.active_ambiguities = active;
      out.blocked_by.push(BLOCK.AMBIGUITY_ACTIVE);
      return withJustification(out, r, c);
    }
    if (app === false) {
      out.applicability = 'неприменимо';
      out.observation = OBS.NOT_APPLICABLE;
      out.observation_label = OBS_LABEL[out.observation];
      return out;
    }
    out.applicability = 'применимо';
    const missCheck = new Set();
    const ok = evalNode(r.requirement.check, data, missCheck);
    if (ok === null) {
      out.observation = OBS.NOT_ASSESSED;
      out.missing_data = [...missCheck].sort();
    } else if (ok) {
      out.observation = OBS.CONSISTENT;
    } else if (r.normativity === 'может_применяться') {
      out.observation = OBS.NOT_APPLIED_ALLOWED;
      out.observation_weight = WEIGHT['может_применяться'];
    } else {
      out.observation = OBS.DIFFERS;
      out.observation_weight = WEIGHT[r.normativity] || WEIGHT['обязательно'];
    }
    return withJustification(out, r, c);
  }

  function withJustification(out, r, c) {
    const j = justificationOf(c, r.rule_id);
    out.justification = j.value;
    out.justification_complete = j.complete;
    out.observation_label = OBS_LABEL[out.observation];
    return out;
  }

  // Неоднозначность снимается только решением эксперта в подтверждённом правиле.
  function activeAmbiguities(r, data, app) {
    const ids = [];
    for (const a of r.ambiguities || []) {
      if (!a.blocking || a.blocking === 'no') continue;
      if (a.decision && r.expert_confirmation) continue;
      const scope = a.scope || 'requirement';
      if (scope === 'requirement' && app !== true) continue;
      if (a.blocking === 'always') { ids.push(a.id); continue; }
      if (a.blocking === 'when' && a.blocks_when && evalNode(a.blocks_when, data, new Set()) === true) ids.push(a.id);
      else if (a.blocking !== 'when') ids.push(a.id); // неизвестный вид блокировки — считать блокирующей
    }
    return ids;
  }

  /**
   * Применить базу правил к синтетическому случаю.
   * @param {object} db   — база правил (rules/pilot-rules.json)
   * @param {object} c    — { synthetic: true, data: {...}, justifications: { RULE_ID: {text, author} } }
   * @param {object} opt  — { protocols: ['rds','nek','sepsis'] } — какие протоколы применять
   */
  function evaluate(db, c, opt) {
    if (!isObj(db) || !Array.isArray(db.rules)) throw new TypeError('нет базы правил');
    assertSynthetic(c);
    const data = isObj(c.data) ? c.data : {};
    const only = opt && Array.isArray(opt.protocols) ? new Set(opt.protocols) : null;
    const results = db.rules.filter(r => !only || only.has(r.protocol)).map(r => evaluateRule(r, data, c));

    // Противоречия — свойство текста протокола, объявленное в базе (protocol_conflicts).
    // Они показываются, когда случай попадает в описанную ситуацию, и НЕ выводятся из того,
    // что два правила дали разные наблюдения.
    // Показываются только когда выполнены условия применения ВСЕХ правил из cf.rules
    // и клиническое условие active_when.
    const byId = new Map(results.map(x => [x.rule_id, x]));
    const conflicts = (db.protocol_conflicts || [])
      .filter(cf => Array.isArray(cf.rules) && cf.rules.length &&
        cf.rules.every(id => byId.has(id) && byId.get(id).applicability === 'применимо') &&
        evalNode(cf.active_when, data, new Set()) === true)
      .map(cf => ({ id: cf.id, type: cf.type || 'противоречие', label: CONFLICT_LABEL[cf.type] || CONFLICT_LABEL['противоречие'],
        rules: cf.rules.slice(), related_rules: (cf.related_rules || []).slice(), description: cf.description,
        quotes: cf.quotes.map(q => ({ protocol: q.protocol, page: q.page, text: q.text })),
        note: 'требуется экспертное толкование' }));
    const assessed = results.filter(x => x.observation === OBS.AMBIGUOUS_PENDING ||
      (x.applicability === 'применимо' && x.observation !== OBS.NOT_ASSESSED));
    const status = assessed.length ? STATUS.EXPERT : STATUS.INSUFFICIENT;
    const count = o => results.filter(x => x.observation === o).length;
    return {
      engine_version: VERSION,
      rules_db: { name: db.name, schema_version: db.schema_version, authenticated: false, declared_authenticated: db.authenticated === true },
      status,
      final_conclusion: null,
      final_conclusion_reason: BLOCK.RULES_UNAUTHENTICATED + '; ' + BLOCK.RULE_UNCONFIRMED,
      blocked_by: [BLOCK.RULES_UNAUTHENTICATED],
      summary: {
        rules_total: results.length,
        applicable: results.filter(x => x.applicability === 'применимо').length,
        consistent_literal: count(OBS.CONSISTENT),
        differs_literal: count(OBS.DIFFERS),
        not_assessed: count(OBS.NOT_ASSESSED),
        not_applicable: count(OBS.NOT_APPLICABLE),
        rejected_rules: count(OBS.RULE_REJECTED),
        ambiguous_pending_expert: count(OBS.AMBIGUOUS_PENDING),
        justifications_recorded: results.filter(x => x.justification).length
      },
      conflicts,
      results,
      note: 'Предварительные наблюдения по неподтверждённым правилам. Это не оценка качества лечения. Отклонение может быть обосновано врачом; итог определяет эксперт.'
    };
  }

  return Object.freeze({ VERSION, CANDIDATE, STATUS, ALLOWED_STATUSES, BLOCK, OBS, OBS_LABEL, CONFLICT_LABEL, evaluate, evalNode });
});
