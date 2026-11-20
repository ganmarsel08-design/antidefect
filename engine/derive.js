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
 *
 * Третий круг (rules-0.3): сверка назначений бензилпенициллина и гентамицина с текстом протокола и таблицей препаратов
 * (стр. 18) — CF-006/CF-007; доза в Ед/кг хранится в исходных единицах и не пересчитывается; два отсчёта NEC-004;
 * хронология ПП с pn_stopped_at; три состояния интубации (RDS-003) и осмотра (SEP-010); «посев до первой дозы» для
 * RDS-008 — ручная запись или вычисление по отметкам, противоречие — нет данных.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RulesDerive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.5.0-round3';
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
    SAME_TIME: 'одинаковое время — порядок событий не установлен',
    NO_EVENT_AFTER: 'нет события после исходной отметки',
    MIXED_TZ: 'отметки в разных часовых поясах, часовой пояс организации не указан',
    BAD_FACILITY_TZ: 'неверный формат часового пояса организации (нужно +05:00, -03:00 или Z)',
    BAD_DOSE_RECORD: 'неверная запись дозы в мг/кг',
    NO_DOSE: 'нет дозы',
    WEIGHT_NOT_CONFIRMED: 'масса на дату назначения не подтверждена — расчёт по актуальной массе не выполняется',
    BASIS_TEXT_NOT_FOUND: 'содержание особого клинического основания не найдено',
    USE_TYPE_UNKNOWN: 'вид назначения (рутинное / индивидуальное) не указан'
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
    const tz = m[7];
    const off = tz === 'Z' ? 0 : (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(4, 6)));
    return { ms, off };
  }
  const OFFSET_RE = /^(Z|[+-](\d{2}):(\d{2}))$/;
  /** Часовой пояс организации (facility_utc_offset): {off} в минутах, {reason} при неверном формате, null — не указан. */
  function facilityOffset(data) {
    if (!has(data, 'facility_utc_offset')) return null;
    const v = data.facility_utc_offset;
    const m = typeof v === 'string' ? OFFSET_RE.exec(v) : null;
    if (!m) return { reason: REASON.BAD_FACILITY_TZ };
    if (m[1] === 'Z') return { off: 0 };
    const h = Number(m[2]), mi = Number(m[3]);
    if (h > 14 || mi > 59) return { reason: REASON.BAD_FACILITY_TZ };
    return { off: (m[1][0] === '-' ? -1 : 1) * (h * 60 + mi) };
  }
  /**
   * Календарные дни двух отметок в едином поясе (пункт 3 плана): пояс организации, если указан;
   * иначе — общее смещение самих отметок; разные смещения без пояса организации — нет данных.
   */
  function dayPair(a, b, data) {
    const fac = facilityOffset(data);
    let off;
    if (fac && fac.reason) return { reason: fac.reason };
    if (fac) off = fac.off;
    else if (a.off === b.off) off = a.off;
    else return { reason: REASON.MIXED_TZ };
    const di = t => Math.floor((t.ms + off * 60000) / 86400000);
    return { a: di(a), b: di(b) };
  }
  const round = (x, n) => { const f = Math.pow(10, n); return Math.round(x * f) / f; };
  const DOSE_RE = /^\s*(\d+)(?:[.,](\d+))?\s*$/;
  /** Запись дозы в мг/кг как введена: строка («25», «25,0», «25,00») или число; точность — по числу знаков после запятой. */
  function parseDoseRecord(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v < 0) return { reason: REASON.BAD_DOSE_RECORD };
      const t = String(v); const i = t.indexOf('.');
      return { value: v, decimals: i < 0 ? 0 : t.length - i - 1, raw: v };
    }
    const m = typeof v === 'string' ? DOSE_RE.exec(v) : null;
    if (!m) return { reason: REASON.BAD_DOSE_RECORD };
    return { value: Number(m[1] + (m[2] ? '.' + m[2] : '')), decimals: m[2] ? m[2].length : 0, raw: v };
  }
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
      // «после исключения» — только при положительном интервале; одинаковые отметки — порядок не установлен (пункт 1 плана)
      if (b.ms === a.ms) why('abx_stopped_after_sbi_exclusion', REASON.SAME_TIME);
      else set('abx_stopped_after_sbi_exclusion', b.ms > a.ms);
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
        else { const dp = dayPair(on, res, data); if (dp.reason) why('nec_day_from_onset_at_feeding_resumption', dp.reason); else set('nec_day_from_onset_at_feeding_resumption', dp.b - dp.a + 1); }
        if (cf.reason || res.reason) why('nec_day_from_confirmation_at_feeding_resumption', cf.reason || res.reason);
        else if (res.ms < cf.ms) why('nec_day_from_confirmation_at_feeding_resumption', REASON.CONTRADICTORY);
        else { const dp = dayPair(cf, res, data); if (dp.reason) why('nec_day_from_confirmation_at_feeding_resumption', dp.reason); else set('nec_day_from_confirmation_at_feeding_resumption', dp.b - dp.a + 1); }
      }
      if (has(data, 'enteral_feeding_resumed_at')) {
        if (data.gi_passage_restored === false) set('feeding_resumed_after_passage_restored', false);
        else {
          const p = T('gi_passage_restored_at');
          if (res.reason || p.reason) why('feeding_resumed_after_passage_restored', res.reason || p.reason);
          else set('feeding_resumed_after_passage_restored', res.ms >= p.ms);
        }
      } else why('feeding_resumed_after_passage_restored', 'энтеральная нагрузка не возобновлялась или нет записи');
      // Восемь признаков улучшения (стр. 12) — только информационный блок карточки, не критерий (пункт 8 плана).
      const sg = isObj(data.improvement_signs) ? data.improvement_signs : null;
      const cnt = ['improvement_signs_yes_count', 'improvement_signs_no_count', 'improvement_signs_unspecified_count'];
      if (!sg) cnt.forEach(f => why(f, REASON.EMPTY_LIST));
      else {
        const vals = IMPROVEMENT_SIGNS.map(k => (sg[k] === true ? true : sg[k] === false ? false : null));
        set(cnt[0], vals.filter(v => v === true).length);
        set(cnt[1], vals.filter(v => v === false).length);
        set(cnt[2], vals.filter(v => v === null).length);
      }
    })();

    // NEC-005: день начала ПП относительно начала НЭК (1 = день начала заболевания)
    (function () {
      const on = T('nec_onset_at'), pn = T('pn_started_at');
      if (on.reason || pn.reason) { why('pn_start_illness_day', on.reason || pn.reason); return; }
      // Противоречие: «ПП не шло на момент НЭК», а начато раньше НЭК, или «ПП шло», а начато позже (пункт 7 плана).
      if ((data.pn_running_at_nec_onset === false && pn.ms < on.ms) || (data.pn_running_at_nec_onset === true && pn.ms > on.ms)) {
        invalidate(['pn_running_at_nec_onset'], REASON.CONTRADICTORY); why('pn_start_illness_day', REASON.CONTRADICTORY); return;
      }
      const dp = dayPair(on, pn, data);
      if (dp.reason) why('pn_start_illness_day', dp.reason);
      else set('pn_start_illness_day', dp.b - dp.a + 1);
    })();

    // NEC-006: рентгенограммы
    (function () {
      const xs = Array.isArray(data.xrays) ? data.xrays.filter(isObj) : null;
      const names = ['xray_count', 'hours_diagnosis_to_first_xray', 'max_hours_between_xrays', 'xray_vertical_or_lateral_after_deterioration'];
      names.push('hours_deterioration_to_upright_xray');
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
      if (det.reason) { why('xray_vertical_or_lateral_after_deterioration', det.reason); why('hours_deterioration_to_upright_xray', det.reason); }
      else {
        const post = ts.filter(e => e.t.ms >= det.ms);
        const up = post.find(e => e.x.position === 'vertical' || e.x.position === 'lateral');
        if (up) set('hours_deterioration_to_upright_xray', hours(det, up.t));
        else why('hours_deterioration_to_upright_xray', post.length ? 'после ухудшения нет снимка вертикально / в латеропозиции' : REASON.NO_EVENT_AFTER);
        if (!post.length) why('xray_vertical_or_lateral_after_deterioration', REASON.NO_EVENT_AFTER);
        else if (up) set('xray_vertical_or_lateral_after_deterioration', true);
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
      else {
        set('abx_course_hours', hours(a, b));
        const dp = dayPair(a, b, data);
        if (dp.reason) why('abx_course_days', dp.reason); else set('abx_course_days', dp.b - dp.a + 1);
      }
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

    // SEP-003: консилиум и содержание особого клинического основания — раздельно (пункт 2 плана).
    // Основанием считается только изложенный текст основания; консилиум и публикация его не заменяют.
    (function () {
      const text = nonEmptyText(data.clinical_evidence);
      set('ig_basis_text_found', text);
      if (data.consilium_documented === true) set('ig_consilium_status', 'documented');
      else if (data.consilium_documented === false) set('ig_consilium_status', 'recorded_not_held');
      else set('ig_consilium_status', 'no_record');
      const u = data.immunoglobulin_use_type;
      if (u === 'routine') set('ig_use_individualized_with_basis', false);
      else if (u === 'individualized') { if (text) set('ig_use_individualized_with_basis', true); else why('ig_use_individualized_with_basis', REASON.BASIS_TEXT_NOT_FOUND); }
      else why('ig_use_individualized_with_basis', REASON.USE_TYPE_UNKNOWN);
    })();

    // SEP-005/006: три раздельные величины (пункт 4 плана, уточнения 17:34 и 17:53):
    //  1) согласованность записей — записанная доза в мг/кг против мг ÷ масса, округлённых до точности самой записи;
    //  2) вычисленная доза — мг ÷ масса (округление только до 6 знаков: погрешность машинной арифметики);
    //  3) значение для предварительной оценки — вычисленная доза, если масса актуальна на дату назначения
    //     (тот же календарный день по поясу организации и не позже назначения), иначе записанная, иначе нет данных.
    // Клинического допуска нет (Q24); форма записи («25» / «25,0» / «25,00») на оценку не влияет, когда есть вычисленная доза.
    for (const [drug, mg, rec, presc] of [['benzylpenicillin', 'benzylpenicillin_dose_mg', 'benzylpenicillin_dose_mg_kg', 'benzylpenicillin_prescribed_at'],
                                          ['gentamicin', 'gentamicin_dose_mg', 'gentamicin_initial_dose_mg_kg', 'gentamicin_prescribed_at']]) {
      const F = n => `${drug}_${n}`;
      const calc = (typeof data[mg] === 'number' && typeof data.weight_kg === 'number' && data.weight_kg > 0) ? round(data[mg] / data.weight_kg, 6) : null;
      if (calc !== null) set(F('dose_per_kg_calculated'), calc); else why(F('dose_per_kg_calculated'), typeof data[mg] === 'number' ? REASON.NO_WEIGHT : REASON.NO_DOSE);
      const r = parseDoseRecord(data[rec]);
      if (r && r.reason) why(F('dose_records_consistent'), r.reason);
      else if (r && calc !== null) set(F('dose_records_consistent'), round(calc, r.decimals) === r.value);
      else why(F('dose_records_consistent'), r ? 'нет абсолютной дозы или массы для сверки' : 'нет записанной дозы в мг/кг для сверки');
      let wok = false, wreason = REASON.WEIGHT_NOT_CONFIRMED;
      if (calc !== null) {
        const w = T('weight_measured_at'), p = T(presc);
        if (w.reason) wreason = 'время взвешивания: ' + w.reason;
        else if (p.reason) wreason = 'время назначения: ' + p.reason;
        else if (w.ms > p.ms) wreason = 'масса измерена после назначения';
        else { const dp = dayPair(w, p, data); if (dp.reason) wreason = dp.reason; else if (dp.a !== dp.b) wreason = 'масса измерена в другой календарный день'; else wok = true; }
        set(F('weight_confirmed_for_calc'), wok);
        if (!wok) reasons[F('weight_confirmed_for_calc')] = wreason;
      } else why(F('weight_confirmed_for_calc'), 'нет абсолютной дозы или массы');
      if (calc !== null && wok) { set(F('dose_per_kg'), calc); set(F('dose_basis'), 'calculated'); }
      else if (r && !r.reason) { set(F('dose_per_kg'), r.value); set(F('dose_basis'), 'recorded'); }
      else { why(F('dose_per_kg'), calc !== null ? wreason : (r && r.reason) || REASON.NO_DOSE); why(F('dose_basis'), REASON.NO_DOSE); }
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

    // ===== Третий круг (решения врача 20.11.2026) =====
    roundThree(data, unknown, set, why, T);

    const timeline = buildTimeline(src);
    return { data, derived, reasons, unknown, ignored, timeline, version: VERSION };
  }

  // Трёхзначные И / ИЛИ: true / false / null (нет данных).
  const and3 = (...v) => (v.includes(false) ? false : v.includes(null) ? null : true);
  const or3 = (...v) => (v.includes(true) ? true : v.includes(null) ? null : false);
  const num = (d, k) => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? d[k] : null);
  const eqn = (x, y) => (x === null ? null : round(x, 6) === round(y, 6));
  const bool = (d, k) => (d[k] === true ? true : d[k] === false ? false : null);

  // Таблица препаратов протокола сепсиса, стр. 18 (гентамицин): режимы по ГВ и постнатальному возрасту.
  // Возраст и ГВ берутся в полных единицах. Пересекающиеся или неопределённые границы (ровно 28 сут при ГВ ≤29 нед —
  // «8 – 28 суток» и «28 суток и старше»; ровно 7 сут при ГВ 30–34 нед — «младше 7 суток» / «старше 7 суток»)
  // дают оба соседних режима и признак границы; выбор режима программа не делает.
  const GENT_TABLE = Object.freeze([
    { ga: [0, 29], pna: [0, 7], dose: 5, interval: 48, text: '29 недель и меньше, 0 – 7 суток: 5 мг/кг каждые 48 часов' },
    { ga: [0, 29], pna: [8, 28], dose: 4, interval: 36, text: '29 недель и меньше, 8 – 28 суток: 4 мг/кг каждые 36 часов' },
    { ga: [0, 29], pna: [28, Infinity], dose: 4, interval: 24, text: '29 недель и меньше, 28 суток и старше: 4 мг/кг каждые 24 часа' },
    { ga: [30, 34], pna: [0, 6], dose: 4.5, interval: 36, text: '30–34 недели, младше 7 суток: 4,5 мг/кг каждые 36 часов' },
    { ga: [30, 34], pna: [8, Infinity], dose: 4, interval: 24, text: '30–34 недели, старше 7 суток: 4 мг/кг каждые 24 часа' },
    { ga: [35, Infinity], pna: [0, Infinity], dose: 4, interval: 24, text: '35 недель и старше: 4 мг/кг каждые 24 часа' }
  ]);
  function gentamicinTableRows(ga, pna) {
    const g = Math.floor(ga), p = Math.floor(pna);
    let rows = GENT_TABLE.filter(r => g >= r.ga[0] && g <= r.ga[1] && p >= r.pna[0] && p <= r.pna[1]);
    let boundary = rows.length > 1;
    if (!rows.length && g >= 30 && g <= 34 && p === 7) { rows = GENT_TABLE.filter(r => r.ga[0] === 30); boundary = true; } // ровно 7 суток
    return { rows, boundary };
  }
  const BENZ_TABLE = Object.freeze({ units_per_kg: 50000, interval: 8, text: 'Сепсис: младше 7 суток и старше 7 суток — 50 000 Ед/кг/доза в/в каждые 8 часов' });

  function roundThree(data, unknown, set, why, T) {
    // --- SEP-005 / CF-006: бензилпенициллин — текст п. 6 (стр. 12) и таблица препаратов (стр. 18).
    // Доза в Ед/кг хранится в исходных единицах; в мг/кг без проверенного коэффициента не пересчитывается.
    (function () {
      const dose = num(data, 'benzylpenicillin_dose_per_kg'), iv = num(data, 'benzylpenicillin_interval_h');
      const units = num(data, 'benzylpenicillin_dose_units_per_kg');
      const textM = and3(eqn(dose, 25), or3(eqn(iv, 12), and3(bool(data, 'very_severe_condition'), eqn(iv, 8))));
      if (textM === null) why('benzylpenicillin_text_regimen_match', 'нет дозы в мг/кг или интервала для сверки с текстом п. 6'); else set('benzylpenicillin_text_regimen_match', textM);
      let table = null;
      if (iv === null) why('benzylpenicillin_table_regimen_status', 'нет интервала введения');
      else if (iv !== BENZ_TABLE.interval) table = 'differs';
      else if (units !== null) table = units === BENZ_TABLE.units_per_kg ? 'matches' : 'differs';
      else table = 'not_comparable'; // интервал как в таблице, доза записана не в Ед/кг
      if (table) set('benzylpenicillin_table_regimen_status', table);
      let dv = null;
      if ((textM === true && table && table !== 'matches') || (table === 'matches' && textM !== true) || (textM === false && table === 'not_comparable')) dv = true;
      else if (textM !== null && table) dv = false;
      if (dv === null) why('benzylpenicillin_regimen_sources_diverge', 'недостаточно данных для сверки текста п. 6 и таблицы стр. 18');
      else set('benzylpenicillin_regimen_sources_diverge', dv);
    })();

    // --- SEP-006 / CF-007: гентамицин — текст п. 7 (стр. 12–13) и возрастные режимы таблицы (стр. 18).
    (function () {
      const dose = num(data, 'gentamicin_dose_per_kg'), iv = num(data, 'gentamicin_interval_h');
      const textM = and3(eqn(dose, 5), or3(eqn(iv, 36), and3(iv === null ? null : iv < 36, bool(data, 'very_ill'), bool(data, 'gram_negative_culture'))));
      if (textM === null) why('gentamicin_text_regimen_match', 'нет дозы в мг/кг или интервала для сверки с текстом п. 7'); else set('gentamicin_text_regimen_match', textM);
      const ga = num(data, 'gestational_age_weeks'), pna = num(data, 'postnatal_age_days');
      if (ga === null || pna === null || pna < 0) {
        set('gentamicin_table_check_status', 'no_age_data');
        const r = 'нет гестационного или постнатального возраста — сверка с таблицей стр. 18 не выполняется';
        for (const f of ['gentamicin_table_band', 'gentamicin_table_boundary', 'gentamicin_table_regimen_match', 'gentamicin_regimen_sources_diverge']) why(f, r);
        return;
      }
      const { rows, boundary } = gentamicinTableRows(ga, pna);
      set('gentamicin_table_band', rows.map(r => r.text).join(' или '));
      set('gentamicin_table_boundary', boundary);
      if (dose === null || iv === null) {
        set('gentamicin_table_check_status', 'no_regimen_data');
        why('gentamicin_table_regimen_match', 'нет дозы в мг/кг или интервала'); why('gentamicin_regimen_sources_diverge', 'нет дозы в мг/кг или интервала');
        return;
      }
      set('gentamicin_table_check_status', 'checked');
      const tableM = rows.some(r => round(dose, 6) === r.dose && iv === r.interval);
      set('gentamicin_table_regimen_match', tableM);
      // Расхождение — только когда сверка с таблицей выполнена: назначение совпадает с одним положением и не совпадает с другим.
      if ((textM === true && tableM === false) || (tableM === true && textM !== true)) set('gentamicin_regimen_sources_diverge', true);
      else if (textM !== null) set('gentamicin_regimen_sources_diverge', false);
      else why('gentamicin_regimen_sources_diverge', 'недостаточно данных для сверки с текстом п. 7');
    })();

    // --- NEC-004: два отсчёта «не ранее 7-го дня» (от начала и от подтверждения НЭК).
    (function () {
      const a = num(data, 'nec_day_from_onset_at_feeding_resumption'), b = num(data, 'nec_day_from_confirmation_at_feeding_resumption');
      if (a === null && b === null) { why('nec_day_counts_disagree', 'нет ни одного отсчёта'); return; }
      if (a === null || b === null) { set('nec_day_counts_disagree', true); return; } // один отсчёт неизвестен — оценки не совпадают
      set('nec_day_counts_disagree', (a >= 7) !== (b >= 7));
    })();

    // --- NEC-005: время прекращения ПП (pn_stopped_at).
    (function () {
      const st = T('pn_stopped_at');
      if (st.reason) { why('pn_stopped_before_nec_onset', st.reason); return; }
      const on = T('nec_onset_at'), pn = T('pn_started_at');
      if (!pn.reason && st.ms < pn.ms) {
        // прекращено раньше начала — хронология противоречива
        why('pn_stopped_before_nec_onset', REASON.CONTRADICTORY);
        if (has(data, 'pn_start_illness_day')) { delete data.pn_start_illness_day; why('pn_start_illness_day', REASON.CONTRADICTORY); }
        return;
      }
      if (on.reason) { why('pn_stopped_before_nec_onset', on.reason); return; }
      const before = st.ms <= on.ms;
      set('pn_stopped_before_nec_onset', before);
      if (before) {
        const r = 'записанный курс ПП прекращён до начала НЭК — на момент заболевания не проводился; новый курс не записан';
        if (has(data, 'pn_start_illness_day')) { delete data.pn_start_illness_day; why('pn_start_illness_day', r); }
        if (data.pn_running_at_nec_onset === true) { delete data.pn_running_at_nec_onset; why('pn_running_at_nec_onset', REASON.CONTRADICTORY); }
      }
    })();

    // --- SEP-010: ежедневный клинический осмотр при продлении — три состояния (отсутствие записи ≠ «не документирован»).
    (function () {
      const v = data.daily_clinical_exam_documented;
      set('daily_clinical_exam_status', v === true ? 'documented' : v === false ? 'not_documented' : 'no_record');
    })();

    // --- RDS-003: интубация для стабилизации — три состояния; FiO₂-показание — отдельно.
    (function () {
      const v = data.intubation_needed_for_stabilization;
      set('intubation_needed_status', v === true ? 'required' : v === false ? 'not_required' : 'no_record');
      const ga = num(data, 'gestational_age_weeks'), f = num(data, 'fio2');
      const met = or3(and3(ga === null ? null : ga < 26, f === null ? null : f > 0.3), and3(ga === null ? null : ga > 26, f === null ? null : f > 0.4));
      set('surfactant_fio2_indication_status', met === true ? 'met' : met === false ? 'not_met' : 'unknown');
    })();

    // --- RDS-008: «посев до первой дозы» — ручная запись или вычисление по отметкам (как SEP-002).
    // Ручное значение не перезаписывается; противоречие ручной записи и вычисления — нет данных с пояснением.
    (function () {
      const manual = data.blood_culture_before_antibiotics === true ? true : data.blood_culture_before_antibiotics === false ? false : null;
      const computed = typeof data.culture_drawn_before_first_dose === 'boolean' ? data.culture_drawn_before_first_dose : null;
      if (manual !== null && computed !== null && manual !== computed) {
        set('blood_culture_before_antibiotics_basis', 'conflict');
        why('blood_culture_before_antibiotics_resolved', 'ручная запись противоречит отметкам времени забора и введения первой дозы');
      } else if (manual !== null) { set('blood_culture_before_antibiotics_resolved', manual); set('blood_culture_before_antibiotics_basis', 'manual'); }
      else if (computed !== null) { set('blood_culture_before_antibiotics_resolved', computed); set('blood_culture_before_antibiotics_basis', 'computed'); }
      else why('blood_culture_before_antibiotics_resolved', unknown.includes('blood_culture_before_antibiotics') ? REASON.UNKNOWN : 'нет ручной записи и нет полных отметок забора и введения первой дозы');
    })();
  }

  const DERIVED_FIELDS = Object.freeze([
    'hours_sbi_excluded_to_abx_stop', 'abx_stopped_after_sbi_exclusion', 'blood_gas_count', 'hypocapnia_episode_count',
    'minutes_hypocapnia_to_vent_change', 'minutes_suspicion_to_feeding_stop', 'minutes_suspicion_to_ng_tube',
    'nec_day_from_onset_at_feeding_resumption', 'nec_day_from_confirmation_at_feeding_resumption', 'feeding_resumed_after_passage_restored',
    'improvement_signs_yes_count', 'improvement_signs_no_count', 'improvement_signs_unspecified_count', 'pn_start_illness_day', 'xray_count',
    'hours_diagnosis_to_first_xray', 'max_hours_between_xrays', 'xray_vertical_or_lateral_after_deterioration', 'hours_deterioration_to_upright_xray',
    'abx_course_days', 'abx_course_hours',
    'abx_drug_change_count', 'abx_interruption_count', 'extension_reason_count', 'hours_transfer_decision_to_transfer',
    'minutes_indication_to_first_dose', 'culture_drawn_before_first_dose', 'ig_basis_text_found', 'ig_consilium_status', 'ig_use_individualized_with_basis',
    'benzylpenicillin_dose_per_kg_calculated', 'benzylpenicillin_dose_records_consistent', 'benzylpenicillin_weight_confirmed_for_calc',
    'benzylpenicillin_dose_per_kg', 'benzylpenicillin_dose_basis',
    'gentamicin_dose_per_kg_calculated', 'gentamicin_dose_records_consistent', 'gentamicin_weight_confirmed_for_calc',
    'gentamicin_dose_per_kg', 'gentamicin_dose_basis', 'hours_first_dose_to_control_crp',
    // третий круг
    'benzylpenicillin_text_regimen_match', 'benzylpenicillin_table_regimen_status', 'benzylpenicillin_regimen_sources_diverge',
    'gentamicin_text_regimen_match', 'gentamicin_table_check_status', 'gentamicin_table_band', 'gentamicin_table_boundary',
    'gentamicin_table_regimen_match', 'gentamicin_regimen_sources_diverge', 'nec_day_counts_disagree', 'pn_stopped_before_nec_onset',
    'intubation_needed_status', 'surfactant_fio2_indication_status', 'blood_culture_before_antibiotics_resolved', 'blood_culture_before_antibiotics_basis',
    'daily_clinical_exam_status'
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

  return Object.freeze({ VERSION, REASON, DERIVED_FIELDS, IMPROVEMENT_SIGNS, EXTENSION_REASONS, GENT_TABLE, BENZ_TABLE, gentamicinTableRows, parseTs, parseDoseRecord, facilityOffset, derive });
});
