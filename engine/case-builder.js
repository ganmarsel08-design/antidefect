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

  const VERSION = '0.7.0-stage7';
  const STATUS = { NEW: 'не подтверждено', OK: 'подтверждено', EDITED: 'исправлено', REJECTED: 'отклонено' };
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const needsChoice = c => Array.isArray(c.alternatives) || (Array.isArray(c.timeline) && !('value' in c));

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
    it.value = clone(list[index].value); it.choice = Object.assign({ index }, list[index]); it.status = STATUS.OK;
    log(s, it, 'выбор значения', from, it.value, { chosen_fragment: list[index].fragment, chosen_at: list[index].at || list[index].date || null, reason: opts && opts.reason || null });
  }

  function confirm(s, id) {
    const it = find(s, id);
    if (needsChoice(it.candidate) && !it.choice) throw new Error('confirm: у сведения ' + it.candidate.field + ' несколько значений — сначала выберите одно');
    const from = it.status; it.status = STATUS.OK;
    log(s, it, 'подтверждено', from, it.value);
  }

  /** Групповое подтверждение некритических неподтверждённых сведений группы (после просмотра). */
  function confirmGroup(s, group) {
    const done = [], skipped = [];
    for (const it of s.items) {
      if (it.candidate.group !== group || it.status !== STATUS.NEW) continue;
      if (it.candidate.critical || needsChoice(it.candidate)) { skipped.push(it.candidate.id); continue; }
      it.status = STATUS.OK; done.push(it.candidate.id);
    }
    s.version++;
    s.journal.push({ seq: s.journal.length + 1, at: s.now(), actor: s.actor, action: 'групповое подтверждение', group, candidate_ids: done,
      skipped_critical_or_multi: skipped, field: null, from: null, to: null, fragment: null });
    return { confirmed: done, skipped };
  }

  function edit(s, id, value, opts) {
    const it = find(s, id);
    const from = it.value; it.value = clone(value); it.status = STATUS.EDITED; it.choice = it.choice || null;
    log(s, it, 'исправлено', from, value, { reason: opts && opts.reason || null });
  }

  function reject(s, id, opts) {
    const it = find(s, id);
    const from = it.value; it.status = STATUS.REJECTED;
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
    const pending = [], rejected = [], used = [];
    for (const it of s.items) {
      const c = it.candidate;
      if (it.status === STATUS.NEW) { pending.push(c.field); continue; }
      if (it.status === STATUS.REJECTED) { rejected.push(c.field); continue; }
      if (it.value === undefined) { pending.push(c.field); continue; }
      data[c.field] = clone(it.value);
      sources[c.field] = { document: s.document_id, fragment: c.manual ? null : it.choice ? it.choice.fragment : c.fragment,
        author: s.actor, confidence: c.manual ? 'введено врачом' : it.status === STATUS.EDITED ? 'исправлено врачом' : 'подтверждено врачом' };
      used.push(c.field);
    }
    const total = s.items.length, decided = total - s.items.filter(x => x.status === STATUS.NEW).length;
    return {
      case: { synthetic: s.synthetic, data, sources },
      completeness: { total, decided, pending: pending.length, rejected: rejected.length, used: used.length, complete: decided === total },
      pending_fields: pending, rejected_fields: rejected,
      version: s.version,
    };
  }

  /** Отпечаток передаваемых в движок данных: карточки «устарели», только если он изменился. */
  function fingerprint(built) { return JSON.stringify(built.case.data); }

  return { VERSION, STATUS, createSession, choose, confirm, confirmGroup, edit, reject, addManual, build, fingerprint, needsChoice };
}));
