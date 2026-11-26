/*
 * Антидефект — этап 7. Сборка случая для движка правил из сведений, проверенных врачом.
 *
 * В движок передаются ТОЛЬКО подтверждённые или исправленные врачом значения. Неподтверждённые и
 * отклонённые сведения не передаются. Все действия пишутся в журнал (кто, когда, что, было → стало, фрагмент).
 * Критические значения подтверждаются только по одному; групповое подтверждение их пропускает.
 * Поле с несколькими значениями (альтернативы или динамика во времени) не подтверждается, пока врач
 * не выберет одно значение: программа сама глобальное значение не выбирает.
 *
 * Модуль не подключает движок правил и не знает клинической логики. Часовой пояс — параметр организации.
 * Только синтетические данные на этапе 7.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntidefectCaseBuilder = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.8.0-dev';
  const STATUS = { NEW: 'не подтверждено', OK: 'подтверждено', EDITED: 'исправлено', REJECTED: 'отклонено' };
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const needsChoice = c => Array.isArray(c.alternatives) || (Array.isArray(c.timeline) && !('value' in c));
  /*
   * Этап 8 (issue #10, ревью №15): время записи (document_time) и время неизвестного типа (unknown) нельзя превратить
   * во время события обычным подтверждением. Нужно явное подтверждение «это время события» и основание; оба пишутся
   * в журнал и в источник значения. Тип берётся у выбранной альтернативы / наблюдения (по индексу), у списка — у элементов.
   */
  const RISKY = b => b === 'document_time' || b === 'unknown';
  const ISO_DT = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
  // Временное поле: *_at, значение-дата-время, список с типами элементов. Тип времени у такого поля обязателен;
  // если его нет (старое извлечение, ручная правка) — на границе case-builder он считается unknown (ревью ae85d85).
  const isTimeField = (c, v) => !c.manual && (/_at$/.test(c.field || '') || (typeof v === 'string' && ISO_DT.test(v)) || Array.isArray(c.time_basis_items));
  function basisOf(c, choice) {
    let b;
    if (choice && c.alternatives && c.alternatives[choice.index]) b = c.alternatives[choice.index].time_basis;
    else if (choice && c.timeline_basis && c.timeline_basis[choice.index]) b = c.timeline_basis[choice.index].time_basis;
    else if (c.timeline_basis && c.timeline && c.timeline.length === 1) b = c.timeline_basis[0].time_basis;
    else if (c.time_basis_items) b = c.time_basis_items.some(x => x.time_basis === 'unknown' || !x.time_basis) ? 'unknown' : c.time_basis_items.some(x => RISKY(x.time_basis)) ? 'document_time' : 'event_time';
    else b = c.time_basis;
    if (b) return b;
    const v = choice && c.alternatives && c.alternatives[choice.index] ? c.alternatives[choice.index].value : c.value;
    return isTimeField(c, v) ? 'unknown' : null;
  }
  const needsTimeConfirm = it => RISKY(basisOf(it.candidate, it.choice));
  // основание — непустая строка после trim
  const reasonOf = r => (typeof r === 'string' && r.trim() ? r.trim() : null);
  const explicitEvent = o => !!(o && o.timeIsEvent === true && reasonOf(o.basisReason));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ── Списки: подтверждение поэлементно (ревью цикла 16:30, issue #10). Каждый элемент со временем записи / unknown
  // подтверждается отдельно: индекс, точное время элемента (сверяется) и непустое основание; цитата берётся из
  // извлечения. Одно основание на весь список не принимается.
  const atOf = v => { if (typeof v === 'string' && ISO_DT.test(v)) return v; if (v && typeof v === 'object') for (const k of Object.keys(v)) if (typeof v[k] === 'string' && ISO_DT.test(v[k])) return v[k]; return null; };
  const RANK = { event_time: 0, document_time: 1, unknown: 2 };
  function listElems(c) {
    if (!Array.isArray(c.time_basis_items) || !Array.isArray(c.value)) return null;
    return c.value.map((v, i) => {
      const es = c.time_basis_items.filter(x => (x.index != null ? x.index === i : same(x.value, v)));
      const basis = es.length ? es.map(x => (x.time_basis in RANK ? x.time_basis : 'unknown')).sort((a, b) => RANK[b] - RANK[a])[0] : (atOf(v) ? 'unknown' : null);
      const fe = es.find(x => x.fragment), fr = c.fragments && c.fragments[i];
      return { index: i, value: v, at: atOf(v), basis, fragment: fe ? fe.fragment : fr ? fr.text : null, start: fe ? fe.start : fr ? fr.start : null };
    });
  }
  const riskyElems = c => (listElems(c) || []).filter(e => RISKY(e.basis));
  /** Элементы, которые должны быть подтверждены: при исправлении — только те, чьё время осталось в новом значении. */
  function requiredElems(it) {
    const r = riskyElems(it.candidate);
    if (it.status === STATUS.EDITED && Array.isArray(it.value)) return r.filter(e => it.value.some(v => atOf(v) === e.at));
    return r;
  }
  function elemConfirm(c, need, items, where) {
    if (!Array.isArray(items)) throw new Error(where + ': у списка ' + c.field + ' время записи / неизвестного типа подтверждается поэлементно — для каждого такого элемента укажите его время и основание');
    const out = [];
    for (const e of need) {
      const g = items.find(x => x && x.index === e.index);
      if (!g || g.timeIsEvent !== true) throw new Error(where + ': ' + c.field + ', элемент №' + (e.index + 1) + ' (' + e.at + ') не подтверждён как время события');
      if (g.at !== e.at) throw new Error(where + ': ' + c.field + ', элемент №' + (e.index + 1) + ': время элемента не совпадает (' + g.at + ' ≠ ' + e.at + ')');
      const r = reasonOf(g.basisReason);
      if (!r) throw new Error(where + ': ' + c.field + ', элемент №' + (e.index + 1) + ': не указано основание');
      out.push({ index: e.index, at: e.at, basis: e.basis, fragment: e.fragment, start: e.start, reason: r });
    }
    for (const g of items) if (!g || !need.some(e => e.index === g.index)) throw new Error(where + ': ' + c.field + ': элемент ' + (g && g.index != null ? '№' + (g.index + 1) : '?') + ' не требует подтверждения времени или не существует');
    return out;
  }
  /** Подтверждение времени действительно для текущего значения. */
  function confirmedOK(it) {
    const tc = it.time_confirmation;
    if (!tc) return false;
    if (riskyElems(it.candidate).length) {
      const need = requiredElems(it);
      if (!need.length) return !!reasonOf(tc.reason);
      return Array.isArray(tc.items) && need.every(e => tc.items.some(x => x.index === e.index && x.at === e.at && reasonOf(x.reason)));
    }
    return !!reasonOf(tc.reason);
  }
  const tcLog = tc => (!tc ? null : tc.items ? tc.items.map(x => ({ index: x.index, at: x.at, reason: x.reason })) : tc.reason);

  /**
   * createSession({extraction, actor, now, synthetic}) — extraction = результат AntidefectExtract.extract().
   * now — функция времени (для тестов); по умолчанию new Date().toISOString().
   */
  function createSession(o) {
    if (!o || !o.extraction || !Array.isArray(o.extraction.candidates)) throw new Error('createSession: нужен результат извлечения');
    if (!/^[+-]\d\d:\d\d$/.test(o.extraction.tz || '')) throw new Error('createSession: в извлечении не указан часовой пояс организации');
    const s = {
      version: 0,
      tz: o.extraction.tz,
      document_id: o.extraction.document_id || null,
      synthetic: o.synthetic !== false,
      actor: o.actor || 'эксперт',
      now: o.now || (() => new Date().toISOString()),
      items: o.extraction.candidates.map(c => ({ candidate: clone(c), status: STATUS.NEW, value: 'value' in c ? clone(c.value) : undefined, choice: null })),
      journal: [],
      warnings: (o.extraction.warnings || []).slice(),
    };
    return s;
  }

  function find(s, id) {
    const it = s.items.find(x => x.candidate.id === id);
    if (!it) throw new Error('нет сведения ' + id);
    return it;
  }
  function log(s, it, action, from, to, extra) {
    s.version++;
    s.journal.push(Object.assign({ seq: s.journal.length + 1, at: s.now(), actor: s.actor, action, candidate_id: it ? it.candidate.id : null,
      field: it ? it.candidate.field : null, from: clone(from), to: clone(to), fragment: it ? it.candidate.fragment : null }, extra || {}));
  }

  /** Выбор одного значения из альтернатив или из динамики (index — номер альтернативы/наблюдения). */
  function choose(s, id, index, opts) {
    const it = find(s, id), c = it.candidate;
    const list = c.alternatives ? c.alternatives.map(a => ({ value: a.value, fragment: a.fragments[0].text }))
      : c.timeline ? c.timeline.map(t => ({ value: t.v, fragment: t.fragment.text, at: t.at, date: t.date })) : null;
    if (!list || !list[index]) throw new Error('choose: у сведения ' + id + ' нет варианта ' + index);
    const from = it.value;
    const fr = c.alternatives ? c.alternatives[index].fragments[0] : c.timeline ? c.timeline[index].fragment : null;
    it.value = clone(list[index].value); it.choice = Object.assign({ index, fragment_start: fr ? fr.start : null, fragment_end: fr ? fr.end : null }, list[index]);
    const basis = basisOf(c, it.choice);
    // выбор с временем записи / неизвестного типа — ещё не подтверждение времени события; перевыбор снимает прежнее подтверждение
    const conf = RISKY(basis) && explicitEvent(opts) ? { basis, reason: reasonOf(opts.basisReason) } : null;
    it.time_confirmation = conf;
    it.status = RISKY(basis) && !conf ? STATUS.NEW : STATUS.OK;
    log(s, it, 'выбор значения', from, it.value, { chosen_index: index, chosen_fragment: list[index].fragment, chosen_fragment_start: it.choice.fragment_start, chosen_at: list[index].at || list[index].date || null,
      time_basis: basis, time_confirmation: conf ? conf.reason : null, reason: opts && opts.reason || null });
  }

  function confirm(s, id, opts) {
    const it = find(s, id);
    if (needsChoice(it.candidate) && !it.choice) throw new Error('confirm: у сведения ' + it.candidate.field + ' несколько значений — сначала выберите одно');
    const basis = basisOf(it.candidate, it.choice);
    if (RISKY(basis) && riskyElems(it.candidate).length) {
      const items = elemConfirm(it.candidate, riskyElems(it.candidate), opts && opts.items, 'confirm');
      const from = it.status; it.status = STATUS.OK; it.time_confirmation = { basis, items };
      log(s, it, 'подтверждено', from, it.value, { time_basis: basis, time_confirmation: tcLog(it.time_confirmation) });
      return it;
    }
    if (RISKY(basis) && !(opts && opts.timeIsEvent === true))
      throw new Error('confirm: у сведения ' + it.candidate.field + ' время записи врача или время неизвестного типа — подтвердите явно, что это время события, и укажите основание (или исправьте значение)');
    if (RISKY(basis) && !reasonOf(opts.basisReason)) throw new Error('confirm: у сведения ' + it.candidate.field + ' не указано основание, почему это время события');
    const from = it.status; it.status = STATUS.OK; it.time_confirmation = RISKY(basis) ? { basis, reason: reasonOf(opts.basisReason) } : null;
    log(s, it, 'подтверждено', from, it.value, { time_basis: basis, time_confirmation: it.time_confirmation ? it.time_confirmation.reason : null });
  }

  /** Групповое подтверждение некритических неподтверждённых сведений группы (после просмотра). */
  function confirmGroup(s, group) {
    const done = [], skipped = [];
    for (const it of s.items) {
      if (it.candidate.group !== group || it.status !== STATUS.NEW) continue;
      if (it.candidate.critical || needsChoice(it.candidate) || needsTimeConfirm(it)) { skipped.push(it.candidate.id); continue; }
      it.status = STATUS.OK; done.push(it.candidate.id);
    }
    s.version++;
    s.journal.push({ seq: s.journal.length + 1, at: s.now(), actor: s.actor, action: 'групповое подтверждение', group, candidate_ids: done,
      skipped_critical_or_multi: skipped, field: null, from: null, to: null, fragment: null });
    return { confirmed: done, skipped };
  }

  function edit(s, id, value, opts) {
    const it = find(s, id);
    const basis = basisOf(it.candidate, it.choice), reason = reasonOf(opts && opts.reason);
    // время записи / неизвестного типа: «исправление» на то же значение — не исправление, а обход явного подтверждения
    // (ревью ae85d85). Для прочих полей контракт этапа 7 сохранён: правка на то же значение допустима и не меняет данные.
    if (RISKY(basis) && same(value, it.value)) throw new Error('edit: значение сведения ' + it.candidate.field + ' не изменено — время записи подтверждается только явно («это время события» + основание)');
    if (RISKY(basis) && !reason) throw new Error('edit: у сведения ' + it.candidate.field + ' время записи врача или время неизвестного типа — укажите основание исправления (откуда время события)');
    // список: элементы со временем записи, чьё время осталось в новом значении, подтверждаются поэлементно
    let items = null;
    if (RISKY(basis) && riskyElems(it.candidate).length) {
      const keep = Array.isArray(value) ? riskyElems(it.candidate).filter(e => value.some(v => atOf(v) === e.at)) : [];
      if (keep.length) items = elemConfirm(it.candidate, keep, opts && opts.items, 'edit');
    }
    const from = it.value; it.value = clone(value); it.status = STATUS.EDITED; it.choice = it.choice || null;
    it.time_confirmation = RISKY(basis) ? Object.assign({ basis, reason, by: 'исправление' }, items ? { items } : {}) : null;
    log(s, it, 'исправлено', from, value, { reason: reason, time_basis: basis, time_confirmation: tcLog(it.time_confirmation) });
  }

  function reject(s, id, opts) {
    const it = find(s, id);
    const from = it.value; it.status = STATUS.REJECTED; it.time_confirmation = null;
    log(s, it, 'отклонено', from, null, { reason: opts && opts.reason || null });
  }

  /**
   * Значение, внесённое врачом вручную (например, постнатальный возраст, которого нет в тексте).
   * Фрагмента текста у него нет; источник — «введено врачом». Пишется в журнал.
   */
  function addManual(s, field, value, opts) {
    if (!field || typeof field !== 'string') throw new Error('addManual: нужно поле');
    if (s.items.some(x => x.candidate.field === field && x.status !== STATUS.REJECTED)) throw new Error('addManual: поле ' + field + ' уже есть — исправьте существующее значение');
    const id = 'm' + (s.items.filter(x => x.candidate.manual).length + 1);
    const it = { candidate: { id, field, manual: true, fragment: null, fragments: [], critical: true, group: opts && opts.group || 'Внесено врачом' }, status: STATUS.EDITED, value: clone(value), choice: null };
    s.items.push(it);
    log(s, it, 'внесено врачом', null, value, { reason: opts && opts.reason || null });
    return id;
  }

  /** Сбор случая. Неподтверждённое и отклонённое не попадает в data. */
  function build(s) {
    const data = { facility_utc_offset: s.tz }, sources = {};
    const pending = [], rejected = [], used = [], unconfirmed = [];
    for (const it of s.items) {
      const c = it.candidate;
      const unconf = () => unconfirmed.push({ field: c.field, time_basis: basisOf(c, it.choice), status: it.status, fragment: it.choice ? it.choice.fragment : c.fragment,
        elements: riskyElems(c).map(e => ({ index: e.index, at: e.at, fragment: e.fragment })) });
      if (it.status === STATUS.NEW) { pending.push(c.field); if (!c.manual && RISKY(basisOf(c, it.choice))) unconf(); continue; }
      if (it.status === STATUS.REJECTED) { rejected.push(c.field); continue; }
      if (it.value === undefined) { pending.push(c.field); continue; }
      // защита на границе: время записи / неизвестного типа без явного подтверждения не передаётся, как бы ни был выставлен статус
      if (!c.manual && RISKY(basisOf(c, it.choice)) && !confirmedOK(it)) {
        pending.push(c.field); unconf(); continue; }
      data[c.field] = clone(it.value);
      sources[c.field] = { document: s.document_id, fragment: c.manual ? null : it.choice ? it.choice.fragment : c.fragment,
        author: s.actor, confidence: c.manual ? 'введено врачом' : it.status === STATUS.EDITED ? 'исправлено врачом' : 'подтверждено врачом' };
      if (!c.manual) { const b = basisOf(c, it.choice); if (b) { sources[c.field].time_basis = b; if (it.time_confirmation && it.time_confirmation.reason) sources[c.field].time_confirmation = it.time_confirmation.reason; }
        if (c.time_basis_items) sources[c.field].time_basis_items = clone(c.time_basis_items).map(x => {
          const ci = it.time_confirmation && it.time_confirmation.items && it.time_confirmation.items.find(y => y.index === x.index);
          return ci ? Object.assign(x, { time_confirmation: ci.reason }) : x; }); }
      used.push(c.field);
    }
    const total = s.items.length, decided = total - s.items.filter(x => x.status === STATUS.NEW).length;
    return {
      case: { synthetic: s.synthetic, data, sources },
      // complete — решение есть по всем извлечённым сведениям; source_complete — исходный документ прочитан полностью
      // complete требует и решения по каждому сведению, и отсутствия задержанных (время записи без подтверждения):
      // статус, выставленный в обход подтверждения, не делает проверку завершённой и не открывает выгрузку
      completeness: { total, decided, pending: pending.length, rejected: rejected.length, used: used.length, complete: decided === total && pending.length === 0,
        time_unconfirmed: unconfirmed,
        source_complete: s.warnings.length === 0, source_warnings: s.warnings.slice() },
      pending_fields: pending, rejected_fields: rejected,
      version: s.version,
    };
  }

  /** Отпечаток передаваемых в движок данных: карточки «устарели», только если он изменился. */
  function fingerprint(built) { return JSON.stringify(built.case.data); }

  return { VERSION, STATUS, createSession, choose, confirm, confirmGroup, edit, reject, addManual, build, fingerprint, needsChoice, needsTimeConfirm, basisOf, listElems, riskyElems };
}));
