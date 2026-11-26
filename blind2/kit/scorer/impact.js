// Антидефект — слепое тестирование №1. Влияние ошибок извлечения на результаты 30 правил (раздел 6 метода 1.1).
// Движок и правила подключаются из замороженной рабочей копии программы; результаты — технические, не врачебная оценка.
'use strict';
const path = require('path');
const C = require('./common.js');

function loadEnv(repo) {
  const r = p => require(path.resolve(repo, p));
  return { RulesEngine: r('engine/rules-engine.js'), Derive: r('engine/derive.js'), View: r('engine/expert-view.js'), db: r('rules/pilot-rules.json'), expertDecisions: r('rules/expert-decisions.json') };
}

/** Входные поля правила с учётом производных (замыкание по derived_from). */
function ruleInputs(db, rule) {
  const dd = db.data_dictionary, out = new Set(), stack = (rule.required_data || []).map(x => x.field);
  while (stack.length) {
    const f = stack.pop(); if (out.has(f)) continue; out.add(f);
    const d = dd[f]; if (d && d.type === 'derived') for (const g of [].concat(d.derived_from || [], d.derived_from_optional || [])) stack.push(g);
  }
  return out;
}

/** Эталонные входные данные: current-факты частей A и B из любых мест документа. */
function goldData(h, dd, tz) {
  const data = { facility_utc_offset: tz }, ambiguous = [];
  const cur = h.facts.filter(f => f.record_status !== 'superseded' && f.value !== null && f.value !== undefined);
  const by = new Map(); for (const f of cur) { if (!by.has(f.field)) by.set(f.field, []); by.get(f.field).push(f); }
  for (const [F, fs] of by) {
    const type = (dd[F] || {}).type;
    if (C.isList(F)) {
      const seen = []; for (const f of fs) { const k = C.LIST_KEY[F](C.canonElem(F, f.value)); if (!seen.some(x => x.k === k)) seen.push({ k, v: f.value }); }
      data[F] = seen.map(x => x.v); continue;
    }
    if (F === 'gi_passage_restored') {
      const s = fs.slice().sort((a, b) => String(a.event_at || a.event_date).localeCompare(String(b.event_at || b.event_date)));
      data[F] = s[0].value; continue;
    }
    const distinct = []; for (const f of fs) if (!distinct.some(x => C.same(C.canon(x.value, type), C.canon(f.value, type)))) distinct.push(f);
    if (distinct.length === 1) { data[F] = distinct[0].value; continue; }
    const p = fs.filter(f => f.primary === true);
    if (p.length === 1) data[F] = p[0].value; else ambiguous.push(F);
  }
  return { data, ambiguous };
}

/** Данные из кандидатов: mode 'stress' — первое предложенное значение; 'cautious' — только однозначные. */
function extractedData(extraction, mode, tz) {
  const data = { facility_utc_offset: tz };
  for (const c of extraction.candidates || []) {
    if (C.isList(c.field)) { data[c.field] = c.value; continue; }
    if (c.timeline) { if (mode === 'stress' || c.timeline.length === 1) data[c.field] = c.timeline[0].v; continue; }
    if (c.alternatives) { if (mode === 'stress') data[c.field] = c.alternatives[0].value; continue; }
    data[c.field] = c.value;
  }
  return data;
}

function labels(env, data, protocol) {
  const built = { case: { synthetic: true, data, sources: {} }, completeness: { total: 1, decided: 1, complete: true } };
  const v = env.View.view(env, built, [protocol]);
  if (v.final_conclusion !== null && v.final_conclusion !== undefined) throw new Error('движок вернул окончательный вывод');
  const out = {};
  for (const r of v.rules) { out[r.rule_id] = r.label; for (const p of r.parts) out[r.rule_id + '/' + p.part_id] = p.label; }
  return out;
}

const READABLE = new Set(['body', 'table']);
const CAUSE = {
  reading: 'ошибка чтения DOCX',
  unread_warned: 'сведения в дополнительном элементе (программа предупредила о неполном чтении)',
  extractor: 'ошибка извлекателя при корректно прочитанном тексте',
  schema: 'ограничение схемы полей (поле не извлекается программой)',
  engine: 'ограничение движка (одно значение для параметра, меняющегося во времени)',
};
const WARN_TYPE = { textbox: /надпись/, image: /рисунок/, embedded_object: /внедрённый объект/, header: /колонтитул \(header/, footer: /колонтитул \(footer/,
  footnote: /не прочитано: сноски/, endnote: /концевые сноски/, comment: /примечания рецензента/ };
const val = (o, f) => (o[f] === undefined ? null : o[f]);

/**
 * Причины расхождения по полю F (метод 1.3, раздел 7). Возвращает массив причин (по одному полю их может быть несколько).
 * ctx: {sets, format, programText, warnings, refData:{stress,cautious}|null}
 */
function fieldCauses(F, h, g, gReadable, d, mode, ctx, dd) {
  if (!ctx) return [];
  const partA = new Set(ctx.sets.partA);
  const cur = h.facts.filter(f => f.field === F && f.record_status !== 'superseded');
  if (!partA.has(F) && cur.length) return [CAUSE.schema];
  const out = new Set();
  if (F === 'gi_passage_restored' && new Set(cur.map(f => JSON.stringify(f.value))).size > 1) out.add(CAUSE.engine);
  const unread = cur.filter(f => !READABLE.has(f.location)), readable = cur.filter(f => READABLE.has(f.location));
  for (const f of unread) {
    const warned = (ctx.warnings || []).some(w => WARN_TYPE[f.location] && WARN_TYPE[f.location].test(w));
    out.add(warned ? CAUSE.unread_warned : CAUSE.reading);
  }
  const ev = val(d, F), gr = val(gReadable, F);
  const readableOk = C.same(ev, gr);            // всё, что видно в основном тексте, извлечено верно
  if (!readableOk || !cur.length) {             // расхождение не объясняется только дополнительными элементами
    if (ctx.format === 'docx') {
      const lost = readable.some(f => f.quote && !ctx.programText.includes(f.quote));
      const refOk = ctx.refData && C.same(val(ctx.refData[mode], F), gr);
      if (lost || refOk) out.add(CAUSE.reading); else out.add(CAUSE.extractor);
    } else out.add(CAUSE.extractor);
  }
  if (out.size > 1 && out.has(CAUSE.engine) && readableOk) out.delete(CAUSE.extractor);
  return [...out];
}

function impactHistory(env, h, extraction, tz, ctx) {
  const dd = env.db.data_dictionary;
  const g = goldData(h, dd, tz);
  const gReadable = goldData(Object.assign({}, h, { facts: h.facts.filter(f => READABLE.has(f.location)) }), dd, tz).data;
  const gl = labels(env, g.data, h.protocol);
  const res = { history: h.id, protocol: h.protocol, gold_input: g.data, ambiguous_gold_fields: g.ambiguous, gold: gl, modes: {} };
  const c2 = ctx ? Object.assign({}, ctx, { refData: ctx.refExtraction ? { stress: extractedData(ctx.refExtraction, 'stress', tz), cautious: extractedData(ctx.refExtraction, 'cautious', tz) } : null }) : null;
  for (const mode of ['stress', 'cautious']) {
    const d = extractedData(extraction, mode, tz), el = labels(env, d, h.protocol);
    const pairs = [];
    for (const key of Object.keys(gl)) {
      const rule = env.db.rules.find(r => r.rule_id === key.split('/')[0]);
      const inputs = ruleInputs(env.db, rule);
      const dep = g.ambiguous.filter(f => inputs.has(f));
      const diffFields = [...inputs].filter(f => !C.same(val(g.data, f), val(d, f)));
      const a = gl[key], b = el[key];
      // 1.5: часть правила, метку которой движок не выдал (применимость не установлена) — отдельный класс, не «иное»
      let cls = a === b ? 'совпадает' : b === undefined ? 'часть не оценивалась' : b === 'соответствие' ? 'ложное предварительное соответствие'
        : b === 'предварительное отличие' ? 'ложное предварительное отличие'
        : (b === 'недостаточно данных' || /неоднозначность/.test(b)) ? 'переход в «' + b + '»' : 'иное';
      if (dep.length) cls = 'зависит от выбора врача (эталон без primary): ' + cls;
      const fields = (a === b || b === undefined) ? [] : diffFields; // для «часть не оценивалась» причины не считаются — они у родительского правила
      const causes = {}; for (const f of fields) causes[f] = fieldCauses(f, h, g.data, gReadable, d, mode, c2, dd);
      pairs.push({ key, gold: a, extracted: b, cls, depends_on_choice: dep, fields, causes, cause_set: [...new Set(Object.values(causes).flat())] });
    }
    res.modes[mode] = { input: d, pairs };
  }
  return res;
}

/** Нулевой критерий: N — пары, где эталон ≠ «соответствие» (без зависящих от выбора); k — ложные соответствия. */
function falseCompliance(ri, mode) {
  const p = ri.modes[mode].pairs.filter(x => !x.depends_on_choice.length);
  const n = p.filter(x => x.gold !== 'соответствие').length;
  const items = p.filter(x => x.cls === 'ложное предварительное соответствие');
  return { k: items.length, n, items: items.map(x => Object.assign({ history: ri.history }, x)) };
}

module.exports = { loadEnv, ruleInputs, goldData, extractedData, labels, impactHistory, falseCompliance, fieldCauses, CAUSE };
