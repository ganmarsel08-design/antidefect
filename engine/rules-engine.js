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
 *
 * Этап 6 (схема rules-0.2): части проверки внутри правила (M1), хронология и вычисляемые поля
 * через derive.js (M2), «неизвестно» ≠ «нет» и источник факта (M3), категории обоснования (M4),
 * карточка эксперта (M5), клинические комментарии врача из отдельного файла решений (M6).
 * Ни одно из этих добавлений не создаёт нового исхода и не снимает запрет на окончательный вывод.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./derive.js'));
  else root.RulesEngine = factory(root.RulesDerive);
})(typeof self !== 'undefined' ? self : this, function (Derive) {
  'use strict';

  const VERSION = '0.4.1-stage6';
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
  // Итог правила из частей — самый осторожный исход (M1): неоднозначность → отличается → нет данных → совпадает.
  const CAUTION = Object.freeze([OBS.AMBIGUOUS_PENDING, OBS.DIFFERS, OBS.NOT_ASSESSED, OBS.NOT_APPLIED_ALLOWED, OBS.CONSISTENT]);
  // Категории обоснования (M4). Категория показывается эксперту и никогда не меняет исход.
  const JUSTIFICATION_CATEGORIES = Object.freeze({
    clinical_indication: 'клиническое показание',
    drug_unavailable: 'препарата нет в отделении',
    local_practice: 'местная практика',
    physician_or_consilium_decision: 'решение врача или консилиума',
    other: 'иное'
  });
  const CARD = Object.freeze({
    DIFFERS_JUSTIFIED: 'Отличается, обоснование есть — требуется оценка эксперта',
    DIFFERS_UNJUSTIFIED: 'Отличается, обоснование не записано — требуется оценка эксперта',
    COMMENT_NOTE: 'клинический комментарий врача — требует отдельной проверки; в оценке не участвует',
    EXPERT_DECISION_EMPTY: 'решение эксперта не внесено'
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
    const value = { text: j.text || '', author: j.author || '', recorded_at: j.recorded_at || null };
    if (j.category !== undefined) {
      value.category = j.category;
      value.category_label = JUSTIFICATION_CATEGORIES[j.category] || 'категория не из перечня';
    }
    for (const k of ['source', 'reference']) if (j[k] !== undefined) value[k] = j[k];
    if (j.category === 'drug_unavailable' && isObj(j.drug_unavailable)) {
      const u = j.drug_unavailable;
      value.drug_unavailable = { drug: u.drug || null, checked_at: u.checked_at || null, confirmed_by: u.confirmed_by || null };
    }
    return { recorded: true, complete, value };
  }

  function combine(obs) {
    for (const o of CAUTION) if (obs.includes(o)) return o;
    return null;
  }
  function partsOfAmbiguity(a) {
    if (Array.isArray(a.parts)) return a.parts;
    if (typeof a.part === 'string') return [a.part];
    return null;
  }

  function weightOf(r) { return WEIGHT[r.normativity] || WEIGHT['обязательно']; }

  function evaluateCheck(check, r, data) {
    const miss = new Set();
    const ok = evalNode(check, data, miss);
    if (ok === null) return { observation: OBS.NOT_ASSESSED, missing: [...miss].sort() };
    if (ok) return { observation: OBS.CONSISTENT, missing: [] };
    if (r.normativity === 'может_применяться') return { observation: OBS.NOT_APPLIED_ALLOWED, missing: [], weight: WEIGHT['может_применяться'] };
    return { observation: OBS.DIFFERS, missing: [], weight: weightOf(r) };
  }

  function evaluatePart(p, r, data) {
    const out = { part_id: p.part_id, description: p.description, applicability: null, observation: null, observation_label: null,
      missing_data: [], active_ambiguities: [] };
    const miss = new Set();
    const app = p.applicability ? evalNode(p.applicability.condition, data, miss) : true;
    const amb = activeAmbiguities(r, data, app, p.part_id);
    if (app === null) {
      out.applicability = 'не_определено'; out.observation = OBS.NOT_ASSESSED; out.missing_data = [...miss].sort();
    } else if (amb.length) {
      out.applicability = app ? 'применимо' : 'зависит_от_неоднозначности'; out.observation = OBS.AMBIGUOUS_PENDING; out.active_ambiguities = amb;
    } else if (app === false) {
      out.applicability = 'неприменимо'; out.observation = OBS.NOT_APPLICABLE;
    } else {
      out.applicability = 'применимо';
      const e = evaluateCheck(p.check, r, data);
      out.observation = e.observation; out.missing_data = e.missing;
      if (e.weight) out.observation_weight = e.weight;
    }
    out.observation_label = OBS_LABEL[out.observation];
    return out;
  }

  function evaluateRule(r, data, c, ctx) {
    const parts = Array.isArray(r.requirement.parts) ? r.requirement.parts : null;
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
    if (parts) out.parts = [];
    if (r.status === CANDIDATE) out.blocked_by.push(BLOCK.RULE_UNCONFIRMED);
    if (out.ambiguities.length) out.blocked_by.push(BLOCK.AMBIGUOUS);
    if (!ruleUsable(r)) {
      out.blocked_by.push(BLOCK.RULE_STATUS_INVALID);
      out.applicability = 'не_определено';
      out.observation = OBS.RULE_REJECTED;
      out.observation_label = OBS_LABEL[out.observation];
      return finish(out, r, c, data, ctx, false);
    }
    const miss = new Set();
    const app = evalNode(r.applicability.condition, data, miss);
    if (app === null) {
      out.applicability = 'не_определено';
      out.observation = OBS.NOT_ASSESSED;
      out.missing_data = [...miss].sort();
      return finish(out, r, c, data, ctx, true);
    }
    const active = activeAmbiguities(r, data, app, null);
    if (active.length) {
      // До решения эксперта по неоднозначности не формируется ни «совпадает», ни «отличается».
      // Части правила при неоднозначности уровня правила не оцениваются (никакого скрытого результата).
      out.applicability = app ? 'применимо' : 'зависит_от_неоднозначности';
      out.observation = OBS.AMBIGUOUS_PENDING;
      out.active_ambiguities = active;
      out.blocked_by.push(BLOCK.AMBIGUITY_ACTIVE);
      return finish(out, r, c, data, ctx, true);
    }
    if (app === false) {
      out.applicability = 'неприменимо';
      out.observation = OBS.NOT_APPLICABLE;
      out.observation_label = OBS_LABEL[out.observation];
      return finish(out, r, c, data, ctx, false);
    }
    out.applicability = 'применимо';
    if (!parts) {
      const e = evaluateCheck(r.requirement.check, r, data);
      out.observation = e.observation;
      out.missing_data = e.missing;
      if (e.weight) out.observation_weight = e.weight;
      return finish(out, r, c, data, ctx, true);
    }
    // M1: части проверки; итог — самый осторожный исход применимых частей.
    out.parts = parts.map(p => evaluatePart(p, r, data));
    const applied = out.parts.filter(p => p.observation !== OBS.NOT_APPLICABLE);
    if (!applied.length) {
      out.applicability = 'неприменимо';
      out.applicability_note = 'ни одна часть проверки не применима к случаю';
      out.observation = OBS.NOT_APPLICABLE;
      return finish(out, r, c, data, ctx, false);
    }
    out.observation = combine(applied.map(p => p.observation));
    out.active_ambiguities = [...new Set(applied.flatMap(p => p.active_ambiguities))];
    out.missing_data = [...new Set(applied.flatMap(p => p.missing_data))].sort();
    if (out.observation === OBS.AMBIGUOUS_PENDING) out.blocked_by.push(BLOCK.AMBIGUITY_ACTIVE);
    if (out.observation === OBS.DIFFERS || out.observation === OBS.NOT_APPLIED_ALLOWED) {
      const w = applied.find(p => p.observation === out.observation);
      out.observation_weight = w && w.observation_weight ? w.observation_weight : weightOf(r);
    }
    return finish(out, r, c, data, ctx, true);
  }

  function finish(out, r, c, data, ctx, withJust) {
    if (withJust) withJustification(out, r, c); else out.observation_label = OBS_LABEL[out.observation];
    out.card = buildCard(out, r, c, data, ctx);
    return out;
  }

  // M5: карточка наблюдения для эксперта. Только отображение — исход не меняется.
  function fieldsOf(node) {
    if (!node) return [];
    if (node.all) return node.all.flatMap(fieldsOf);
    if (node.any) return node.any.flatMap(fieldsOf);
    return [node.field];
  }
  // Подстановка {поле} в текст подписи из данных случая (только отображение, на исход не влияет).
  // Числа — до 4 знаков, десятичная запятая; строки — как записаны. Нет значения → подпись не показывается.
  function fillTemplate(text, data) {
    let missing = false;
    const out = text.replace(/\{([a-z0-9_]+)\}/g, (_, f) => {
      const v = data[f];
      if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v * 1e4) / 1e4).replace('.', ',');
      if (typeof v === 'string' && v.trim()) return v;
      missing = true; return '';
    });
    return missing ? null : out;
  }
  function buildCard(out, r, c, data, ctx) {
    const labels = [];
    for (const cl of r.card_labels || []) {
      const on = cl.when ? evalNode(cl.when, data, new Set()) === true : true;
      if (!on) continue;
      const text = fillTemplate(cl.label, data);
      if (text === null) continue;
      labels.push({ id: cl.id, text, first: cl.first === true, quotes: (cl.quotes || []).map(q => ({ protocol: q.protocol, page: q.page, text: q.text })) });
    }
    labels.sort((a, b) => (b.first === true) - (a.first === true));
    if (out.observation === OBS.DIFFERS) labels.push({ id: 'differs', text: out.justification_complete ? CARD.DIFFERS_JUSTIFIED : CARD.DIFFERS_UNJUSTIFIED, first: false, quotes: [] });
    const fields = [...new Set((r.required_data || []).map(d => d.field).concat(r.display_fields || []))];
    const src = isObj(c.sources) ? c.sources : {};
    const facts = fields.map(f => {
      const present = Object.prototype.hasOwnProperty.call(data, f) && data[f] !== null && data[f] !== undefined;
      const fact = { field: f, value: present ? data[f] : null, derived: (ctx.dictionary[f] || {}).type === 'derived' };
      if (!present) fact.reason = ctx.derived.reasons[f] || (ctx.derived.unknown.includes(f) ? Derive.REASON.UNKNOWN : 'нет записи');
      if (fact.derived) fact.computed_by = 'engine/derive.js';
      if (isObj(src[f])) fact.source = { document: src[f].document || null, fragment: src[f].fragment || null, author: src[f].author || null, recorded_at: src[f].recorded_at || null, confidence: src[f].confidence || null };
      else if (!fact.derived && present) fact.source = null;
      return fact;
    });
    const roots = new Set(fields);
    const timeline = ctx.derived.timeline.filter(e => roots.has(e.field.split('[')[0]));
    const reasonOf = f => ctx.derived.reasons[f] || (ctx.derived.unknown.includes(f) ? Derive.REASON.UNKNOWN : 'нет записи');
    const present = f => Object.prototype.hasOwnProperty.call(data, f) && data[f] !== null && data[f] !== undefined;
    const missingReasons = {};
    for (const f of out.missing_data) missingReasons[f] = reasonOf(f);
    // Для вычисляемого поля — какие исходные отметки нужны (из словаря данных).
    const sourcesOf = f => { const e = ctx.dictionary[f]; return e && Array.isArray(e.derived_from) ? e.derived_from.filter(x => !present(x)) : []; };
    const missingSources = {};
    for (const f of out.missing_data) { const s = sourcesOf(f); if (s.length) missingSources[f] = s; }
    // При неоднозначности уровня правила проверка не выполняется; показываются только пробелы в данных
    // для неё — без какого-либо исхода (никакого скрытого результата).
    let gaps = [];
    if (out.observation === OBS.AMBIGUOUS_PENDING && !(out.parts && out.parts.length)) {
      const checks = Array.isArray(r.requirement.parts) ? r.requirement.parts.map(p => p.check) : [r.requirement.check];
      gaps = [...new Set(checks.flatMap(fieldsOf))].filter(f => !present(f)).sort().map(f => ({ field: f, reason: reasonOf(f), needs: sourcesOf(f) }));
    }
    if (gaps.length) labels.push({ id: 'gaps_behind_ambiguity', text: 'Кроме неоднозначности, для проверки не хватает данных: ' + gaps.map(g => g.field + ' — ' + g.reason).join('; '), first: false, quotes: [] });
    const comments = ctx.comments[r.rule_id] || [];
    return {
      rule_id: r.rule_id, normativity: r.normativity, observation: out.observation, observation_label: out.observation_label || OBS_LABEL[out.observation],
      labels,
      quotes: r.source.quotes.map(q => ({ page: q.page, text: q.text })),
      triggered_condition: out.applicability === 'применимо' ? r.applicability.description : null,
      parts: (out.parts || []).map(p => ({ part_id: p.part_id, description: p.description, observation: p.observation, observation_label: p.observation_label, missing_data: p.missing_data, active_ambiguities: p.active_ambiguities })),
      facts, timeline, missing_data: out.missing_data.slice(), missing_reasons: missingReasons, missing_sources: missingSources,
      data_gaps_behind_ambiguity: gaps,
      active_ambiguities: out.active_ambiguities.map(id => { const a = (r.ambiguities || []).find(x => x.id === id); return { id, text: a ? a.text : '' }; }),
      protocol_conflicts: out.protocol_conflicts.slice(),
      justification: out.justification,
      clinical_comments: comments.map(x => ({ text: x.text, author: x.author, date: x.date, note: CARD.COMMENT_NOTE })),
      expert_decision: null, expert_decision_note: CARD.EXPERT_DECISION_EMPTY
    };
  }

  function withJustification(out, r, c) {
    const j = justificationOf(c, r.rule_id);
    out.justification = j.value;
    out.justification_complete = j.complete;
    out.observation_label = OBS_LABEL[out.observation];
    return out;
  }

  // Неоднозначность снимается только решением эксперта в подтверждённом правиле.
  // part === null — неоднозначности уровня правила; иначе — относящиеся к этой части.
  function activeAmbiguities(r, data, app, part) {
    const ids = [];
    for (const a of r.ambiguities || []) {
      if (!a.blocking || a.blocking === 'no') continue;
      const ap = partsOfAmbiguity(a);
      if (part === null ? ap !== null : !(ap && ap.includes(part))) continue;
      if (a.decision && r.expert_confirmation) continue;
      const scope = a.scope || 'requirement';
      if (scope === 'requirement' && app !== true) continue;
      if (a.blocking === 'always') { ids.push(a.id); continue; }
      // Условие может быть своим для каждой части (blocks_when_by_part), иначе — общее blocks_when.
      const when = part !== null && isObj(a.blocks_when_by_part) && a.blocks_when_by_part[part] ? a.blocks_when_by_part[part] : a.blocks_when;
      if (a.blocking === 'when' && when && evalNode(when, data, new Set()) === true) ids.push(a.id);
      else if (a.blocking !== 'when') ids.push(a.id); // неизвестный вид блокировки — считать блокирующей
      else if (!when) ids.push(a.id); // blocking=when без условия — считать блокирующей
    }
    return ids;
  }

  // M6: клинические комментарии врача берутся из отдельного файла решений экспертизы (rules/expert-decisions.json).
  function commentsOf(ed) {
    const m = {};
    if (!isObj(ed) || !Array.isArray(ed.clinical_comments)) return m;
    for (const x of ed.clinical_comments) {
      if (!isObj(x) || typeof x.rule_id !== 'string') continue;
      (m[x.rule_id] = m[x.rule_id] || []).push({ text: x.text_verbatim, author: x.author, date: x.date });
    }
    return m;
  }

  /**
   * Применить базу правил к синтетическому случаю.
   * @param {object} db   — база правил (rules/pilot-rules.json)
   * @param {object} c    — { synthetic: true, data: {...}, justifications: { RULE_ID: {text, author} } }
   * @param {object} opt  — { protocols: ['rds','nek','sepsis'], expert_decisions: <rules/expert-decisions.json> }
   *   c.sources[field] = {document, fragment, author, recorded_at, confidence} — источник факта (M3);
   *   c.justifications[rule_id] = {text, author, recorded_at, category, source, reference, drug_unavailable} (M4).
   */
  function evaluate(db, c, opt) {
    if (!isObj(db) || !Array.isArray(db.rules)) throw new TypeError('нет базы правил');
    assertSynthetic(c);
    const derived = Derive.derive(isObj(c.data) ? c.data : {});
    const data = derived.data;
    const only = opt && Array.isArray(opt.protocols) ? new Set(opt.protocols) : null;
    const ctx = { derived, comments: commentsOf(opt && opt.expert_decisions), dictionary: isObj(db.data_dictionary) ? db.data_dictionary : {} };
    const results = db.rules.filter(r => !only || only.has(r.protocol)).map(r => evaluateRule(r, data, c, ctx));

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
      derived: { values: derived.derived, reasons: derived.reasons, unknown_fields: derived.unknown, manual_values_ignored: derived.ignored },
      results,
      note: 'Предварительные наблюдения по неподтверждённым правилам. Это не оценка качества лечения. Отклонение может быть обосновано врачом; итог определяет эксперт.'
    };
  }

  return Object.freeze({ VERSION, CANDIDATE, STATUS, ALLOWED_STATUSES, BLOCK, OBS, OBS_LABEL, CONFLICT_LABEL, CAUTION, JUSTIFICATION_CATEGORIES, CARD, evaluate, evalNode });
});
