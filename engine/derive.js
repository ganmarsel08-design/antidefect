/*
 * Антидефект — вычисляемые поля и хронология (этап 6, M2/M3).
 *
 * Интервалы считает программа по отметкам времени, а не человек.
 * Правила:
 *  - отметка принимается только полной: дата, время и часовой пояс (2026-01-05T10:00+05:00 или …Z);
 *  - нет отметки, только дата без времени, нет часового пояса → интервал не считается, причина сохраняется;
 *  - невозможный порядок отметок (доза раньше назначения, конец курса раньше начала и т. п.) →
 *    «противоречивая хронология», интервал не считается;
 *  - отметки не достраиваются, точка отсчёта не придумывается;
 *  - значение «unknown»/«неизвестно» = нет данных (никогда не «нет»); пустой список = нет записи;
 *  - значения вычисляемых полей, введённые вручную, не используются.
 *
 * Модуль не меняет входные данные.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RulesDerive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.4.0-stage6';
  const REASON = Object.freeze({
    NO_TS: 'нет отметки времени',
    DATE_ONLY: 'только дата без времени',
    NO_TZ: 'нет часового пояса',
    BAD_TS: 'неверный формат отметки времени',
    CONTRADICTORY: 'противоречивая хронология',
    UNKNOWN: 'указано «неизвестно» — нет данных',
    EMPTY_LIST: 'нет записей',
    MANUAL_IGNORED: 'значение вычисляется программой; введённое вручную не используется',
    COURSE_RUNNING: 'курс продолжается — окончательная длительность не вычисляется',
    COURSE_STATUS_UNKNOWN: 'неизвестно, завершён ли курс',
    NO_THRESHOLD: 'порог PaCO₂ не задан',
    THRESHOLD_NO_SOURCE: 'порог PaCO₂ указан без источника',
    NO_WEIGHT: 'нет массы тела',
    DOSE_MISMATCH: 'доза в мг и записанная доза в мг/кг не согласуются',
    SAME_TIME: 'одинаковое время — порядок не установлен',
    NO_EVENT_AFTER: 'нет события после исходной отметки'
  });
  const UNKNOWN_VALUES = new Set(['unknown', 'неизвестно', 'no_record']);
  const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/;
  const TS_NOTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const IMPROVEMENT_SIGNS = Object.freeze([
    'abdomen_not_distended_not_tender', 'no_pathological_gastric_residuals', 'ileus_resolved', 'spontaneous_stool',
    'labs_normalized', 'no_us_bowel_wall_inflammation', 'no_ascites', 'peristalsis_restored'
  ]);
  const EXTENSION_REASONS = Object.freeze(['not_fully_recovered', 'pathogen_identified', 'nec', 'osteomyelitis', 'catheter_associated_infection', 'other']);

  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function has(d, k) { return Object.prototype.hasOwnProperty.call(d, k) && d[k] !== null && d[k] !== undefined; }
  function nonEmptyText(v) { return typeof v === 'string' && v.trim().length > 0; }

  /** Разбор отметки времени: {ms, date:'YYYY-MM-DD' (по часовому поясу самой отметки)} или {reason}. */
  function parseTs(v) {
    if (v === null || v === undefined || v === '') return { reason: REASON.NO_TS };
    if (typeof v === 'string' && UNKNOWN_VALUES.has(v)) return { reason: REASON.UNKNOWN };
    if (typeof v !== 'string') return { reason: REASON.BAD_TS };
    if (DATE_RE.test(v)) return { reason: REASON.DATE_ONLY };
    if (TS_NOTZ_RE.test(v)) return { reason: REASON.NO_TZ };
    const m = TS_RE.exec(v);
    if (!m) return { reason: REASON.BAD_TS };
    const [, y, mo, d, h, mi, s] = m.map(x => x);
    const Y = +y, M = +mo, D = +d, H = +h, MI = +mi, S = s ? +s : 0;
    const probe = new Date(Date.UTC(Y, M - 1, D, H, MI, S));
    if (probe.getUTCFullYear() !== Y || probe.getUTCMonth() !== M - 1 || probe.getUTCDate() !== D || H > 23 || MI > 59 || S > 59) return { reason: REASON.BAD_TS };
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) return { reason: REASON.BAD_TS };
    return { ms, date: `${y}-${mo}-${d}` };
  }
  function dayIndex(date) { const [y, m, d] = date.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; }
  const round = (x, n) => { const f = Math.pow(10, n); return Math.round(x * f) / f; };
  const hours = (a, b) => round((b.ms - a.ms) / 3600000, 2);
  const minutes = (a, b) => round((b.ms - a.ms) / 60000, 1);

  /**
   * @returns {{data:object, derived:object, reasons:object, unknown:string[], ignored:string[], timeline:Array}}
   *  data — входные данные без «неизвестно» плюс вычисленные поля (для условий правил);
   *  reasons[field] — почему вычисляемое поле не получено.
   */
  function derive(input) {
    const src = isObj(input) ? input : {};
    const data = {};
    const unknown = [];
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (typeof v === 'string' && UNKNOWN_VALUES.has(v)) { unknown.push(k); continue; }
      if (Array.isArray(v) && v.length === 0) { unknown.push(k); continue; } // пустой список — нет записи, а не «ничего не было»
      data[k] = v;
    }
    const derived = {}, reasons = {}, ignored = [];
    for (const f of DERIVED_FIELDS) if (has(data, f)) { ignored.push(f); delete data[f]; }
    const set = (f, v) => { derived[f] = v; data[f] = v; };
    const why = (f, r) => { reasons[f] = r; };
    const T = f => (has(data, f) ? parseTs(data[f]) : (unknown.includes(f) ? { reason: REASON.UNKNOWN } : { reason: REASON.NO_TS }));
    const invalidate = (fields, r) => { for (const f of fields) if (has(data, f)) { delete data[f]; reasons[f] = r; } };

    // RDS-007: исключение ТБИ → отмена АБТ
    (function () {
      const a = T('sbi_excluded_at'), b = T('antibiotics_stopped_at');
      if (a.reason || b.reason) { const r = a.reason || b.reason; why('hours_sbi_excluded_to_abx_stop', r); why('abx_stopped_after_sbi_exclusion', r); return; }
      const h = hours(a, b);
      set('hours_sbi_excluded_to_abx_stop', h);
      set('abx_stopped_after_sbi_exclusion', h > 0);
    })();

    // RDS-010: газы крови, порог из источника, реакция врача
    (function () {
      const gases = Array.isArray(data.blood_gases) ? data.blood_gases.filter(g => isObj(g) && typeof g.paco2_mmhg === 'number') : null;
      if (!gases || gases.length === 0) {
        why('blood_gas_count', REASON.EMPTY_LIST); why('hypocapnia_episode_count', REASON.EMPTY_LIST); why('minutes_hypocapnia_to_vent_change', REASON.EMPTY_LIST);
        return;
      }
      set('blood_gas_count', gases.length);
      if (typeof data.paco2_hypocapnia_threshold !== 'number') { why('hypocapnia_episode_count', REASON.NO_THRESHOLD); why('minutes_hypocapnia_to_vent_change', REASON.NO_THRESHOLD); return; }
      if (!nonEmptyText(data.threshold_source)) { why('hypocapnia_episode_count', REASON.THRESHOLD_NO_SOURCE); why('minutes_hypocapnia_to_vent_change', REASON.THRESHOLD_NO_SOURCE); return; }
      const low = gases.filter(g => g.paco2_mmhg < data.paco2_hypocapnia_threshold);
      set('hypocapnia_episode_count', low.length);
      if (!low.length) { why('minutes_hypocapnia_to_vent_change', 'гипокапнии нет'); return; }
      const lowT = low.map(g => parseTs(g.drawn_at));
      const bad = lowT.find(t => t.reason);
      if (bad) { why('minutes_hypocapnia_to_vent_change', bad.reason); return; }
      const first = lowT.reduce((m, t) => (t.ms < m.ms ? t : m));
      const changes = (Array.isArray(data.vent_changes) ? data.vent_changes : []).map(v => parseTs(isObj(v) ? v.at : null)).filter(t => !t.reason && t.ms >= first.ms);
      if (!changes.length) { why('minutes_hypocapnia_to_vent_change', REASON.NO_EVENT_AFTER); return; }
      set('minutes_hypocapnia_to_vent_change', minutes(first, changes.reduce((m, t) => (t.ms < m.ms ? t : m))));
    })();

    // NEC-001: статус на момент подозрения; интервалы показываются
    (function () {
      const s = T('nec_suspected_at');
      if (data.feeding_at_nec_suspicion === 'already_stopped' && has(data, 'feeding_stopped_before_suspicion_at') && !s.reason) {
        const b = parseTs(data.feeding_stopped_before_suspicion_at);
        if (!b.reason && b.ms > s.ms) invalidate(['feeding_at_nec_suspicion'], REASON.CONTRADICTORY);
      }
      if (data.feeding_at_nec_suspicion === 'active' && has(data, 'enteral_feeding_stopped_at') && !s.reason) {
        const b = parseTs(data.enteral_feeding_stopped_at);
        if (!b.reason && b.ms < s.ms) invalidate(['feeding_at_nec_suspicion', 'enteral_feeding_stopped'], REASON.CONTRADICTORY);
      }
      if (data.ng_tube_present_at_suspicion === false && data.ng_tube_placed === true && has(data, 'ng_tube_placed_at') && !s.reason) {
        const b = parseTs(data.ng_tube_placed_at);
        if (!b.reason && b.ms < s.ms) invalidate(['ng_tube_present_at_suspicion', 'ng_tube_placed'], REASON.CONTRADICTORY);
      }
      for (const [f, to] of [['minutes_suspicion_to_feeding_stop', 'enteral_feeding_stopped_at'], ['minutes_suspicion_to_ng_tube', 'ng_tube_placed_at']]) {
        const b = T(to);
        if (s.reason || b.reason) why(f, s.reason || b.reason); else set(f, minutes(s, b));
      }
    })();

    // NEC-003/004: дни заболевания, признаки улучшения
    (function () {
      const on = T('nec_onset_at'), cf = T('nec_confirmed_at'), res = T('enteral_feeding_resumed_at');
      if (!on.reason && !cf.reason && cf.ms < on.ms) {
        for (const f of ['nec_day_from_onset_at_feeding_resumption', 'nec_day_from_confirmation_at_feeding_resumption']) why(f, REASON.CONTRADICTORY);
      } else {
        if (on.reason || res.reason) why('nec_day_from_onset_at_feeding_resumption', on.reason || res.reason);
        else if (res.ms < on.ms) why('nec_day_from_onset_at_feeding_resumption', REASON.CONTRADICTORY);
        else set('nec_day_from_onset_at_feeding_resumption', dayIndex(res.date) - dayIndex(on.date) + 1);
        if (cf.reason || res.reason) why('nec_day_from_confirmation_at_feeding_resumption', cf.reason || res.reason);
        else if (res.ms < cf.ms) why('nec_day_from_confirmation_at_feeding_resumption', REASON.CONTRADICTORY);
        else set('nec_day_from_confirmation_at_feeding_resumption', dayIndex(res.date) - dayIndex(cf.date) + 1);
      }
      if (has(data, 'enteral_feeding_resumed_at')) {
        if (data.gi_passage_restored === false) set('feeding_resumed_after_passage_restored', false);
        else {
          const p = T('gi_passage_restored_at');
          if (res.reason || p.reason) why('feeding_resumed_after_passage_restored', res.reason || p.reason);
          else set('feeding_resumed_after_passage_restored', res.ms >= p.ms);
        }
      } else why('feeding_resumed_after_passage_restored', 'энтеральная нагрузка не возобновлялась или нет записи');
      const sg = isObj(data.improvement_signs) ? data.improvement_signs : null;
      if (!sg) { why('improvement_achieved', REASON.EMPTY_LIST); why('improvement_signs_documented_count', REASON.EMPTY_LIST); }
      else {
        const vals = IMPROVEMENT_SIGNS.map(k => (sg[k] === true ? true : sg[k] === false ? false : null));
        set('improvement_signs_documented_count', vals.filter(v => v === true).length);
        if (vals.some(v => v === false)) set('improvement_achieved', false);
        else if (vals.every(v => v === true)) set('improvement_achieved', true);
        else why('improvement_achieved', 'отмечены не все признаки улучшения (стр. 12)');
      }
    })();

    // NEC-005: день начала ПП относительно начала НЭК (1 = день начала заболевания)
    (function () {
      const on = T('nec_onset_at'), pn = T('pn_started_at');
      if (on.reason || pn.reason) why('pn_start_illness_day', on.reason || pn.reason);
      else set('pn_start_illness_day', dayIndex(pn.date) - dayIndex(on.date) + 1);
    })();

    // NEC-006: рентгенограммы
    (function () {
      const xs = Array.isArray(data.xrays) ? data.xrays.filter(isObj) : null;
      const names = ['xray_count', 'hours_diagnosis_to_first_xray', 'max_hours_between_xrays', 'xray_vertical_or_lateral_after_deterioration'];
      if (!xs || !xs.length) { names.forEach(n => why(n, REASON.EMPTY_LIST)); return; }
      const ts = xs.map(x => ({ x, t: parseTs(x.at) }));
      const bad = ts.find(e => e.t.reason);
      if (bad) { names.forEach(n => why(n, 'у снимка: ' + bad.t.reason)); return; }
      ts.sort((a, b) => a.t.ms - b.t.ms);
      set('xray_count', ts.length);
      const dx = T('nec_diagnosed_at');
      if (dx.reason) { why('hours_diagnosis_to_first_xray', dx.reason); why('max_hours_between_xrays', dx.reason); }
      else {
        const after = ts.filter(e => e.t.ms >= dx.ms);
        if (!after.length) { why('hours_diagnosis_to_first_xray', REASON.NO_EVENT_AFTER); why('max_hours_between_xrays', REASON.NO_EVENT_AFTER); }
        else {
          set('hours_diagnosis_to_first_xray', hours(dx, after[0].t));
          if (after.length < 2) why('max_hours_between_xrays', 'один снимок после диагноза');
          else { let mx = 0; for (let i = 1; i < after.length; i++) mx = Math.max(mx, hours(after[i - 1].t, after[i].t)); set('max_hours_between_xrays', mx); }
        }
      }
      const det = T('deterioration_at');
      if (det.reason) why('xray_vertical_or_lateral_after_deterioration', det.reason);
      else {
        const post = ts.filter(e => e.t.ms >= det.ms);
        if (!post.length) why('xray_vertical_or_lateral_after_deterioration', REASON.NO_EVENT_AFTER);
        else if (post.some(e => e.x.position === 'vertical' || e.x.position === 'lateral')) set('xray_vertical_or_lateral_after_deterioration', true);
        else if (post.every(e => e.x.position === 'horizontal')) set('xray_vertical_or_lateral_after_deterioration', false);
        else why('xray_vertical_or_lateral_after_deterioration', 'положение снимка не указано');
      }
    })();

    // Курс АБТ (NEC-008, SEP-008, SEP-009, SEP-010): календарные сутки от первой до последней дозы
    // (Q14 открыт; по умолчанию — календарные сутки, перерывы и смены препарата только показываются).
    (function () {
      const names = ['abx_course_days', 'abx_course_hours'];
      const a = T('abx_course_started_at'), b = T('abx_course_ended_at');
      if (data.course_completed === false) names.forEach(n => why(n, REASON.COURSE_RUNNING));
      else if (data.course_completed !== true) names.forEach(n => why(n, REASON.COURSE_STATUS_UNKNOWN));
      else if (a.reason || b.reason) names.forEach(n => why(n, a.reason || b.reason));
      else if (b.ms < a.ms) names.forEach(n => why(n, REASON.CONTRADICTORY));
      else { set('abx_course_days', dayIndex(b.date) - dayIndex(a.date) + 1); set('abx_course_hours', hours(a, b)); }
      for (const [f, list] of [['abx_drug_change_count', 'drug_changes'], ['abx_interruption_count', 'interruptions']]) {
        if (Array.isArray(data[list])) set(f, data[list].length);
      }
      if (Array.isArray(data.extension_reason)) {
        const ok = data.extension_reason.filter(x => EXTENSION_REASONS.includes(x));
        set('extension_reason_count', ok.length);
      } else why('extension_reason_count', REASON.EMPTY_LIST);
    })();

    // NEC-010: решение о переводе → перевод (показывается)
    (function () {
      const a = T('transfer_decision_at'), b = T('transferred_at');
      if (a.reason || b.reason) why('hours_transfer_decision_to_transfer', a.reason || b.reason);
      else if (b.ms < a.ms) why('hours_transfer_decision_to_transfer', REASON.CONTRADICTORY);
      else set('hours_transfer_decision_to_transfer', hours(a, b));
    })();

    // SEP-001: от выявления показания до ФАКТИЧЕСКОГО введения первой дозы
    (function () {
      const i = T('sepsis_indication_identified_at'), o = T('first_abx_dose_ordered_at'), g = T('first_abx_dose_administered_at');
      if (!o.reason && !g.reason && g.ms < o.ms) { why('minutes_indication_to_first_dose', REASON.CONTRADICTORY); return; }
      if (i.reason || g.reason) { why('minutes_indication_to_first_dose', i.reason || g.reason); return; }
      if (g.ms < i.ms) { why('minutes_indication_to_first_dose', REASON.CONTRADICTORY); return; }
      set('minutes_indication_to_first_dose', minutes(i, g));
    })();

    // SEP-002: забор крови до первой ВВЕДЁННОЙ дозы; время результата — отдельно
    (function () {
      const d = T('blood_culture_drawn_at'), g = T('first_abx_dose_administered_at'), r = T('culture_result_at');
      if (!d.reason && !r.reason && r.ms < d.ms) { why('culture_drawn_before_first_dose', REASON.CONTRADICTORY); return; }
      if (d.reason || g.reason) { why('culture_drawn_before_first_dose', d.reason || g.reason); return; }
      if (d.ms === g.ms) { why('culture_drawn_before_first_dose', REASON.SAME_TIME); return; }
      set('culture_drawn_before_first_dose', d.ms < g.ms);
    })();

    // SEP-003: индивидуальное назначение иммуноглобулина с документированным особым основанием (C2)
    (function () {
      const ev = nonEmptyText(data.clinical_evidence);
      let basis = null;
      if (data.consilium_documented === true || ev) basis = true;
      else if (data.consilium_documented === false) basis = false;
      if (basis === null) why('ig_special_basis_documented', 'нет сведений о консилиуме и клиническом основании');
      else set('ig_special_basis_documented', basis);
      const u = data.immunoglobulin_use_type;
      if (u === 'routine') set('ig_use_individualized_with_basis', false);
      else if (u === 'individualized') { if (basis === null) why('ig_use_individualized_with_basis', 'нет сведений об особом основании'); else set('ig_use_individualized_with_basis', basis); }
      else why('ig_use_individualized_with_basis', 'вид назначения (рутинное / индивидуальное) не указан');
    })();

    // SEP-005/006: доза на кг из мг и массы (или записанная доза в мг/кг)
    for (const [out, mg, perKg] of [['benzylpenicillin_dose_per_kg', 'benzylpenicillin_dose_mg', 'benzylpenicillin_dose_mg_kg'],
                                     ['gentamicin_dose_per_kg', 'gentamicin_dose_mg', 'gentamicin_initial_dose_mg_kg']]) {
      const calc = (typeof data[mg] === 'number' && typeof data.weight_kg === 'number' && data.weight_kg > 0) ? round(data[mg] / data.weight_kg, 2) : null;
      const rec = typeof data[perKg] === 'number' ? data[perKg] : null;
      if (calc !== null && rec !== null && Math.abs(calc - rec) > 0.02 * Math.max(calc, rec)) why(out, REASON.DOSE_MISMATCH);
      else if (calc !== null) set(out, calc);
      else if (rec !== null) set(out, rec);
      else why(out, typeof data[mg] === 'number' ? REASON.NO_WEIGHT : 'нет дозы');
    }

    // SEP-007: от первой введённой дозы до ЗАБОРА контрольного СРБ (не до результата)
    (function () {
      const g = T('first_abx_dose_administered_at');
      const s = Array.isArray(data.crp_samples) ? data.crp_samples.filter(x => isObj(x) && x.purpose === 'control') : null;
      if (!s || !s.length) { why('hours_first_dose_to_control_crp', 'нет контрольного СРБ'); return; }
      if (g.reason) { why('hours_first_dose_to_control_crp', g.reason); return; }
      const ts = s.map(x => ({ d: parseTs(x.drawn_at), r: x.result_at ? parseTs(x.result_at) : null }));
      const bad = ts.find(e => e.d.reason);
      if (bad) { why('hours_first_dose_to_control_crp', 'забор СРБ: ' + bad.d.reason); return; }
      if (ts.some(e => e.r && !e.r.reason && e.r.ms < e.d.ms) || ts.some(e => e.d.ms < g.ms)) { why('hours_first_dose_to_control_crp', REASON.CONTRADICTORY); return; }
      const first = ts.reduce((m, e) => (e.d.ms < m.d.ms ? e : m));
      set('hours_first_dose_to_control_crp', hours(g, first.d));
    })();

    const timeline = buildTimeline(src);
    return { data, derived, reasons, unknown, ignored, timeline, version: VERSION };
  }

  const DERIVED_FIELDS = Object.freeze([
    'hours_sbi_excluded_to_abx_stop', 'abx_stopped_after_sbi_exclusion', 'blood_gas_count', 'hypocapnia_episode_count',
    'minutes_hypocapnia_to_vent_change', 'minutes_suspicion_to_feeding_stop', 'minutes_suspicion_to_ng_tube',
    'nec_day_from_onset_at_feeding_resumption', 'nec_day_from_confirmation_at_feeding_resumption', 'feeding_resumed_after_passage_restored',
    'improvement_achieved', 'improvement_signs_documented_count', 'pn_start_illness_day', 'xray_count', 'hours_diagnosis_to_first_xray',
    'max_hours_between_xrays', 'xray_vertical_or_lateral_after_deterioration', 'abx_course_days', 'abx_course_hours',
    'abx_drug_change_count', 'abx_interruption_count', 'extension_reason_count', 'hours_transfer_decision_to_transfer',
    'minutes_indication_to_first_dose', 'culture_drawn_before_first_dose', 'ig_special_basis_documented', 'ig_use_individualized_with_basis',
    'benzylpenicillin_dose_per_kg', 'gentamicin_dose_per_kg', 'hours_first_dose_to_control_crp'
  ]);

  // Хронология для карточки эксперта: все поля *_at и отметки внутри списков.
  function buildTimeline(src) {
    const ev = [];
    const push = (field, v, extra) => {
      const t = parseTs(v);
      ev.push(Object.assign({ field, value: v, ms: t.ms === undefined ? null : t.ms, valid: !t.reason, reason: t.reason || null }, extra || {}));
    };
    for (const k of Object.keys(src)) {
      if (/_at$/.test(k)) push(k, src[k]);
      else if (Array.isArray(src[k])) src[k].forEach((x, i) => {
        if (isObj(x)) for (const kk of Object.keys(x)) if (/(^at$|_at$|^from$|^to$)/.test(kk) && typeof x[kk] === 'string' && /\d{4}-\d{2}-\d{2}/.test(x[kk])) push(`${k}[${i}].${kk}`, x[kk]);
      });
    }
    return ev.sort((a, b) => (a.ms === null) - (b.ms === null) || (a.ms || 0) - (b.ms || 0)).map(({ ms, ...e }) => e);
  }

  return Object.freeze({ VERSION, REASON, DERIVED_FIELDS, IMPROVEMENT_SIGNS, EXTENSION_REASONS, parseTs, derive });
});
