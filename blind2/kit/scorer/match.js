// Антидефект — слепое тестирование (оценщик 1.5, копия 1.4 с изменениями для набора №2). Сопоставление кандидатов извлечения с эталоном одной истории.
// Реализует раздел 4 метода blind1-method-1.1. Не зависит от устройства извлекателя: читает только его вывод.
'use strict';
const C = require('./common.js');

const READABLE = new Set(['body', 'table']);
// 1.5: дозовые поля — по величине дозы, а не по подстроке; время первой дозы (…_dose_administered_at) — поле времени
const DOSE = /^(?!.*_at$)(?:.*_dose_(?:mg|mg_kg|units_per_kg|per_kg(?:_calculated)?)|surfactant_initial_dose_mg_kg)$/;
const TIME_TRAPS = new Set(['document_time_as_event', 'time_without_date', 'date_without_time', 'relative_time', 'midnight_crossing']);
const DOSE_TRAPS = new Set(['unit_not_field_unit', 'dose_without_unit']);
const NEG_TRAPS = new Set(['negation', 'plan', 'conditional']);

function subclass(f, type) {
  if (DOSE.test(f)) return 'доза';
  return { number: 'число', datetime: 'время', date: 'время', tri: 'да/нет', enum: 'перечень', text: 'текст' }[type] || 'значение';
}
/** Тип времени элемента списка по time_basis_items кандидата (самый рискованный из относящихся к элементу); нет данных → null. */
const TBR = { event_time: 0, document_time: 1, unknown: 2 };
function tbOfItems(c, i) {
  const es = (c.time_basis_items || []).filter(x => x.index === i).map(x => (x.time_basis in TBR ? x.time_basis : 'unknown'));
  if (es.length) return es.sort((a, b) => TBR[b] - TBR[a])[0];
  return c.time_basis || null;
}
/** Тип времени (единственный вариант, 1.5): в эталоне время записи фактом НЕ размечается (валидатор: time_kind только event_time);
 *  «время записи выдано за время события» ловит ловушка document_time_as_event (только кандидат с time_basis=event_time).
 *  Здесь: факт с event_time верен по значению, но время подано как запись/неизвестное/без данных → «требует подтверждения». */
function tkAssess(facts, v) {
  if (facts.some(f => f.time_kind === 'document_time')) throw new Error('эталон: time_kind=document_time недопустим (время записи фактом не размечается) — набор должен был не пройти формальную проверку');
  const ks = [...new Set(facts.map(f => f.time_kind || null))];
  const gk = ks.length === 1 ? ks[0] : 'mixed';
  const tb = v && v.tb ? v.tb : null;
  return { gk, tb, tkErr: false, tkConfirm: gk === 'event_time' && tb !== 'event_time', tkMissing: gk === null };
}
const timeOf = (f, e) => (f === 'vent_changes' || f === 'xrays') ? e.at : e.drawn_at;

/** Значения кандидатов поля: [{v (сырое), c (каноническое), frs:[{start,end}], single, kind}] */
function candValues(cands, f, type) {
  const out = [];
  for (const c of cands.filter(x => x.field === f)) {
    if (C.isList(f)) {
      (c.value || []).forEach((e, i) => out.push({ v: e, c: C.canonElem(f, e), frs: [(c.fragments || [])[i] || c].filter(Boolean), single: true, kind: 'элемент', cid: c.id, ck: `${c.id}#e${i}`, tb: tbOfItems(c, i) }));
    } else if (c.timeline) {
      c.timeline.forEach((t, i) => out.push({ v: t.v, c: t.v, at: t.at || null, date: t.date || null, frs: [t.fragment], single: true, kind: 'наблюдение', cid: c.id, ck: `${c.id}#t${i}`, tb: t.time_basis || c.time_basis || null }));
    } else if (c.alternatives) {
      c.alternatives.forEach((a, i) => out.push({ v: a.value, c: C.canon(a.value, type), frs: a.fragments || [], single: false, kind: 'альтернатива', cid: c.id, ck: `${c.id}#a${i}`, tb: a.time_basis || c.time_basis || null }));
    } else {
      out.push({ v: c.value, c: C.canon(c.value, type), frs: c.fragments || [{ start: c.start, end: c.end }], single: true, kind: 'значение', cid: c.id, ck: `${c.id}#v`, tb: c.time_basis || null });
    }
  }
  return out;
}

/**
 * scoreHistory({h, text, extraction, dd, sets}) — h: история эталона; text — текст, поданный в extract();
 * extraction — вывод extract(); dd — data_dictionary; sets — {partA, critical}.
 */
function scoreHistory({ h, text, extraction, dd, sets }) {
  const partA = new Set(sets.partA), critical = new Set(sets.critical);
  const cands = extraction.candidates || [];
  const units = [], lp = [], dateOnly = [], unreadFacts = [];
  const quoteSpans = q => C.spans(text, q).map(([s, e]) => [s, e]);
  const fragHits = (frs, facts) => {
    const sp = facts.flatMap(f => quoteSpans(f.quote));
    return frs.some(fr => fr && sp.some(s => C.overlap([fr.start, fr.end], s)));
  };
  const factsA = h.facts.filter(f => partA.has(f.field)); // часть A определяется по словарю (field-sets.json), а не автором
  for (const f of factsA) if (!READABLE.has(f.location)) unreadFacts.push({ fid: f.fid, field: f.field, location: f.location });
  const fields = new Set([...factsA.map(f => f.field), ...cands.map(c => c.field)]);

  for (const F of fields) {
    const type = (dd[F] || {}).type;
    const all = factsA.filter(f => f.field === F && READABLE.has(f.location));
    const cur = all.filter(f => f.record_status !== 'superseded');
    const sup = all.filter(f => f.record_status === 'superseded');
    const cv = candValues(cands, F, type);
    const used = new Set();
    const mk = (u) => { u.history = h.id; u.field = F; u.critical = critical.has(F); u.type = type; units.push(u); return u; };

    if (C.isList(F)) {
      // 1.5: единица = ключ + полное содержание элемента. Точные дубли сворачиваются; два РАЗНЫХ элемента с одним ключом (одно время,
      // разные значения) — разные единицы с пометкой conflict, а не «первый выигрывает». Порядок фактов и кандидатов на результат не влияет.
      const gu = []; for (const f of cur) { const e = C.canonElem(F, f.value), k = C.LIST_KEY[F](e); let u = gu.find(x => x.key === k && C.same(x.elem, e)); if (!u) gu.push(u = { key: k, elem: e, facts: [] }); u.facts.push(f); }
      for (const u of gu) u.conflict = gu.filter(x => x.key === u.key).length > 1;
      gu.sort((a, b) => (a.key + JSON.stringify(a.elem)).localeCompare(b.key + JSON.stringify(b.elem)));
      const nz = v => Object.fromEntries(Object.entries(v.c).map(([k, x]) => [k, x === undefined ? null : x]));
      const supE = sup.map(f => C.canonElem(F, f.value));
      const pending = [];
      // проход 1: точное совпадение элемента; проход 2: совпадение по ключу (расхождение свойств → О)
      const first = new Map();
      for (const u of gu) { const i = cv.findIndex((v, j) => !used.has(j) && C.same(nz(v), u.elem)); if (i >= 0) { used.add(i); first.set(u, i); } }
      for (const u of gu) {
        const i = first.has(u) ? first.get(u) : cv.findIndex((v, j) => !used.has(j) && C.LIST_KEY[F](v.c) === u.key);
        if (!first.has(u) && i >= 0) used.add(i); // (used пополняется до использования ниже)
        if (i < 0) { pending.push(u); continue; }
        const v = cv[i];
        const bad = Object.keys(u.elem).filter(k => !C.same(u.elem[k], v.c[k] === undefined ? null : v.c[k]));
        const tk = tkAssess(u.facts, v), tkBad = !bad.length && tk.tkErr;
        mk({ key: u.key, expected: u.elem, got: v.v, cls: bad.length || tkBad ? 'О' : 'В', sub: bad.length ? 'свойства: ' + bad.join(', ') : tkBad ? 'время записи выдано за время события' : null, silent: bad.length > 0 || tkBad, timeErr: tkBad, conflict: u.conflict || undefined, tk: tk.gk === 'mixed' ? null : tk, ck: v.ck, fragOk: fragHits(v.frs, u.facts), fids: u.facts.map(f => f.fid), quote: u.facts[0].quote });
      }
      for (const u of pending) { // ключ (время) не совпал: ищем элемент с теми же прочими свойствами → ошибка времени
        const i = cv.findIndex((v, j) => !used.has(j) && Object.keys(u.elem).filter(k => !/^(at|drawn_at)$/.test(k)).every(k => C.same(u.elem[k], v.c[k] === undefined ? null : v.c[k])));
        if (i >= 0) { used.add(i); mk({ key: u.key, expected: u.elem, got: cv[i].v, cls: 'О', sub: 'время элемента', silent: true, timeErr: true, ck: cv[i].ck, fragOk: fragHits(cv[i].frs, u.facts), fids: u.facts.map(f => f.fid), quote: u.facts[0].quote }); }
        else mk({ key: u.key, expected: u.elem, got: null, cls: 'П', fids: u.facts.map(f => f.fid), quote: u.facts[0].quote });
      }
      cv.forEach((v, j) => { if (!used.has(j)) lp.push({ history: h.id, field: F, got: v.v, single: true, superseded: supE.some(e => C.same(e, v.c)), frs: v.frs, ck: v.ck, timeField: true, doseField: false }); });
      continue;
    }

    if (F === 'gi_passage_restored') {
      const gu = []; for (const f of cur) { const t = f.event_at || null, d = f.event_date || (t ? t.slice(0, 10) : null); if (!gu.some(u => u.v === f.value && u.at === t && u.date === d)) gu.push({ v: f.value, at: t, date: d, facts: cur.filter(x => x.value === f.value && (x.event_at || null) === t) }); }
      const hit = (u, v) => v.c === u.v && (u.at ? v.at === u.at : (!v.at && v.date === u.date));
      const pending = [];
      for (const u of gu) { const i = cv.findIndex((v, j) => !used.has(j) && hit(u, v)); if (i < 0) { pending.push(u); continue; } used.add(i); const tk = tkAssess(u.facts, cv[i]), tkBad = tk.tkErr && !!u.at; mk({ key: `${u.v}@${u.at || u.date}`, expected: u.v, got: cv[i].v, cls: tkBad ? 'О' : 'В', sub: tkBad ? 'время записи выдано за время события' : null, silent: tkBad ? cv[i].single : undefined, timeErr: tkBad, tk, ck: cv[i].ck, fragOk: fragHits(cv[i].frs, u.facts), fids: u.facts.map(f => f.fid), quote: u.facts[0].quote }); }
      for (const u of pending) {
        const i = cv.findIndex((v, j) => !used.has(j) && (v.date === u.date || (v.at && u.at && v.at.slice(0, 10) === u.at.slice(0, 10))));
        if (i >= 0) { used.add(i); const v = cv[i]; const te = v.c === u.v; mk({ key: `${u.v}@${u.at || u.date}`, expected: { v: u.v, at: u.at, date: u.date }, got: { v: v.c, at: v.at, date: v.date }, cls: 'О', sub: te ? 'время' : 'да/нет', silent: true, timeErr: te, ck: v.ck, negErr: !te && v.c === true && u.v === false, fids: u.facts.map(f => f.fid), quote: u.facts[0].quote }); }
        else mk({ key: `${u.v}@${u.at || u.date}`, expected: u.v, got: null, cls: 'П', fids: u.facts.map(f => f.fid), quote: u.facts[0].quote });
      }
      cv.forEach((v, j) => { if (!used.has(j)) lp.push({ history: h.id, field: F, got: { v: v.c, at: v.at, date: v.date }, single: true, superseded: false, frs: v.frs, ck: v.ck, timeField: true, doseField: false }); });
      continue;
    }

    // обычное поле
    const nullDate = cur.filter(f => f.value === null || f.value === undefined);
    for (const f of nullDate) {
      const sp = quoteSpans(f.quote);
      const inv = cv.filter(v => v.v !== null && v.frs.some(fr => fr && sp.some(s => C.overlap([fr.start, fr.end], s))));
      dateOnly.push({ history: h.id, field: F, fid: f.fid, quote: f.quote, invented: inv.map(v => ({ got: v.v, single: v.single, ck: v.ck })) });
      inv.forEach(v => used.add(cv.indexOf(v)));
    }
    const gu = [];
    for (const f of cur.filter(f => f.value !== null && f.value !== undefined)) { const c = C.canon(f.value, type); let u = gu.find(x => C.same(x.c, c)); if (!u) gu.push(u = { c, v: f.value, facts: [] }); u.facts.push(f); }
    const supC = sup.map(f => C.canon(f.value, type));
    const pending = [];
    for (const u of gu) {
      const si = cv.findIndex((v, j) => !used.has(j) && v.single && C.same(v.c, u.c));
      const ai = si >= 0 ? -1 : cv.findIndex((v, j) => !used.has(j) && !v.single && C.same(v.c, u.c));
      const i = si >= 0 ? si : ai;
      if (i < 0) { pending.push(u); continue; }
      used.add(i);
      const timeF = type === 'datetime' || type === 'date', tk = timeF ? tkAssess(u.facts, cv[i]) : null, tkBad = !!(tk && tk.tkErr);
      // верное значение, но время записи выдано за время события: однозначное — ошибка О (молчаливая, входит в нулевой критерий времени); в альтернативе — ВА с пометкой
      mk({ key: JSON.stringify(u.c), expected: u.v, got: cv[i].v, cls: tkBad && si >= 0 ? 'О' : si >= 0 ? 'В' : 'ВА', sub: tkBad ? 'время записи выдано за время события' : null, silent: tkBad && si >= 0 ? true : undefined, timeErr: tkBad && si >= 0, tk, ck: cv[i].ck, fragOk: fragHits(cv[i].frs, u.facts), fids: u.facts.map(f => f.fid), quote: u.facts[0].quote });
    }
    const wrong = cv.map((v, j) => ({ v, j })).filter(({ v, j }) => !used.has(j) && !supC.some(s => C.same(s, v.c)));
    for (const u of pending) {
      const w = wrong.shift();
      if (w) {
        used.add(w.j);
        mk({ key: JSON.stringify(u.c), expected: u.v, got: w.v.v, cls: 'О', sub: subclass(F, type), silent: w.v.single, ck: w.v.ck, timeErr: type === 'datetime' || type === 'date', doseErr: DOSE.test(F), negErr: type === 'tri' && u.c === false && w.v.c === true, fragOk: fragHits(w.v.frs, u.facts), fids: u.facts.map(f => f.fid), quote: u.facts[0].quote });
      } else mk({ key: JSON.stringify(u.c), expected: u.v, got: null, cls: 'П', fids: u.facts.map(f => f.fid), quote: u.facts[0].quote });
    }
    cv.forEach((v, j) => { if (!used.has(j)) lp.push({ history: h.id, field: F, got: v.v, single: v.single, superseded: supC.some(s => C.same(s, v.c)), frs: v.frs, ck: v.ck, timeField: type === 'datetime' || type === 'date', doseField: DOSE.test(F), tb: v.tb || null }); });
  }

  // ловушки
  const traps = (h.traps || []).map(t => {
    const sp = quoteSpans(t.quote);
    const type = (dd[t.field] || {}).type;
    if (t.type === 'deleted_tracked_text') { // удалённый текст не должен попасть в прочитанный текст
      const leaked = sp.length > 0;
      return { tid: t.tid, history: h.id, type: t.type, field: t.field, quote: t.quote, status: leaked ? 'сработала' : 'выдержана', triggered: leaked ? [{ got: 'удалённый текст в прочитанном тексте', single: true, ck: 'deleted#' + t.tid }] : [] };
    }
    if (!READABLE.has(t.location || 'body')) return { tid: t.tid, history: h.id, type: t.type, field: t.field, status: 'в непрочитываемом месте', triggered: [] };
    if (!sp.length) return { tid: t.tid, history: h.id, type: t.type, field: t.field, status: 'не проверяема: цитата не найдена в поданном тексте', triggered: [] };
    const cv = t.field ? candValues(cands, t.field, type) : [];
    const mnv = t.must_not_value;
    // document_time_as_event: срабатывает только если время из цитаты записи подано как время события (time_basis=event_time)
    const trig = cv.filter(v => v.frs.some(fr => fr && sp.some(s => C.overlap([fr.start, fr.end], s))) &&
      (t.type === 'document_time_as_event' ? v.tb === 'event_time' : (mnv === 'any' || C.same(v.c, C.isList(t.field) ? C.canonElem(t.field, mnv) : C.canon(mnv, type)))));
    return { tid: t.tid, history: h.id, type: t.type, field: t.field, quote: t.quote, status: trig.length ? 'сработала' : 'выдержана', triggered: trig.map(v => ({ got: v.v, single: v.single, ck: v.ck })) };
  });
  // ЛП: тип по пересекающимся ловушкам
  for (const x of lp) {
    const tt = (h.traps || []).filter(t => t.field === x.field && C.spans(text, t.quote).some(s => x.frs.some(fr => fr && C.overlap([fr.start, fr.end], s))));
    x.trap_types = tt.map(t => t.type); x.kind = x.superseded ? 'устаревшее значение' : tt.length ? tt.map(t => t.type).join('+') : 'не объяснено';
  }
  return { history: h.id, protocol: h.protocol, format: h.format, units, lp, traps, dateOnly, unreadFacts };
}

/**
 * Сводка нулевых критериев по истории (метод 1.4, раздел 6).
 * Ошибка = конкретное значение кандидата (ключ ck). Одна и та же ошибка, классифицированная одновременно как О,
 * ЛП и срабатывание ловушки, считается один раз. N = возможности из эталона (единицы, факты «дата без времени»,
 * проверяемые ловушки) + опасные однозначные ЛП, не связанные ни с одной из этих возможностей.
 */
function zeroCounts(r) {
  const mk = () => ({ n: 0, errs: new Map(), lpOnly: 0 });
  const z = { dose: mk(), time: mk(), negplan: mk() };
  const err = (c, ck, item) => { if (!c.errs.has(ck)) c.errs.set(ck, item); };
  for (const u of r.units) {
    if (DOSE.test(u.field)) { z.dose.n++; if (u.cls === 'О' && u.silent) err(z.dose, u.ck, u); }
    const timey = u.type === 'datetime' || u.type === 'date' || C.isList(u.field) || u.field === 'gi_passage_restored';
    if (timey) { z.time.n++; if (u.cls === 'О' && u.silent && u.timeErr) err(z.time, u.ck, u); }
    // «нет» в эталоне: обычное поле да/нет или наблюдение динамики пассажа (gi_passage_restored) — метод 1.4
    const expectedNo = u.field === 'gi_passage_restored'
      ? (u.expected !== null && typeof u.expected === 'object' ? u.expected.v === false : u.expected === false)
      : u.type === 'tri' && !C.isList(u.field) && JSON.parse(u.key) === false;
    if (expectedNo) { z.negplan.n++; if (u.negErr) err(z.negplan, u.ck, u); }
  }
  for (const d of r.dateOnly) { z.time.n++; for (const v of d.invented.filter(v => v.single)) err(z.time, v.ck, d); }
  for (const t of r.traps) {
    if (t.status !== 'сработала' && t.status !== 'выдержана') continue;
    if (DOSE_TRAPS.has(t.type)) { z.dose.n++; for (const v of t.triggered.filter(v => v.single)) err(z.dose, v.ck, t); }
    if (TIME_TRAPS.has(t.type)) { z.time.n++; for (const v of t.triggered.filter(v => v.single)) err(z.time, v.ck, t); }
    if (NEG_TRAPS.has(t.type)) { z.negplan.n++; for (const v of t.triggered) err(z.negplan, v.ck, t); }
  }
  // опасные однозначные ЛП: доза — в полях доз; время — в полях даты-времени, элементах списков, наблюдениях динамики
  // время записи (ловушка document_time_as_event), поданное как запись/неизвестное, — не опасное ложное извлечение: программа не выдала его за время события
  for (const x of r.lp.filter(x => x.single && !((x.trap_types || []).includes('document_time_as_event') && x.tb !== 'event_time'))) {
    if (x.doseField && !z.dose.errs.has(x.ck)) { z.dose.errs.set(x.ck, x); z.dose.lpOnly++; }
    if (x.timeField && !z.time.errs.has(x.ck)) { z.time.errs.set(x.ck, x); z.time.lpOnly++; }
  }
  const out = {};
  for (const [k, c] of Object.entries(z)) out[k] = { k: c.errs.size, n: c.n + c.lpOnly, items: [...c.errs.values()] };
  return out;
}

module.exports = { scoreHistory, zeroCounts, candValues, tkAssess, READABLE, DOSE };
