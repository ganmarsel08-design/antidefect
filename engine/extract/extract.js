/*
 * Антидефект — этап 7. Извлечение сведений из текста истории (локально, без ИИ и без сети).
 *
 * Модуль НЕ знает о движке правил: не подключает rules-engine.js, derive.js и pilot-rules.json
 * (это проверяется тестом). Он только находит в тексте кандидатов значений полей словаря.
 *
 * Принципы:
 *  - каждое значение связано с точным фрагментом исходного текста (start/end — смещения в тексте,
 *    fragment === text.slice(start, end));
 *  - значение не придумывается: нет записи — нет кандидата; «сведений нет», «не указано», «в работе»
 *    не превращаются в «нет»; «нет» ставится только при явном отрицании;
 *  - дата-время берётся только если в той же записи (строке) есть и дата, и время; дата без времени
 *    не превращается в 00:00; часовой пояс — параметр организации (opts.tz), а не часовой пояс устройства;
 *  - единицы не пересчитываются (мл → мг/кг, ЕД → мг, часы → сутки не выполняются);
 *  - доза, единица, интервал, препарат и время связываются только внутри одной записи (строки);
 *  - если одно поле получает разные значения, все они возвращаются как альтернативы — выбирает врач;
 *  - поля-«состояния во времени» (gi_passage_restored) возвращаются как динамика наблюдений.
 *
 * Только синтетические данные на этапе 7.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntidefectExtract = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '0.8.0-dev';
  const DT = '(\\d\\d)\\.(\\d\\d)\\.(\\d{4}) (\\d\\d):(\\d\\d)';
  const L = 'А-Яа-яЁё';
  const NOT_BEFORE = `(?<![${L}])`; // начало слова для кириллицы (\b в JS не работает с кириллицей)

  /** Поля, которые врач подтверждает только по одному (решение 4 от 20.11). */
  const CRITICAL = /^(weight_kg|weight_measured_at|birth_weight_g|gestational_age_weeks|postnatal_age_days|.*_dose_.*|.*_interval_h|.*_units_.*|.*_administered_at|.*_prescribed_at|rds_diagnosed|nec_stage|nec_suspected|sepsis_suspected|early_onset_sepsis_suspected|red_flag_count|risk_factor_or_sign_count|cpap_pressure_cmh2o|fio2|spo2_target_.*|sepsis_indication_identified_at|blood_culture_drawn_at|abx_course_(started|ended)_at|gi_passage_restored)$/;
  const group = f => /^(gestational|birth_weight|weight|postnatal|facility)/.test(f) ? 'Ребёнок и организация'
    : /^(antenatal|rds_|cord_|condition_allows|cpap|oxygen|fio2|intubat|surfactant|spo2|mechanical|blood_gases|vent_|paco2|threshold)/.test(f) ? 'Родзал и респираторная поддержка'
    : /^(nec_|feeding|enteral|ng_|uvc|uac|pn_|gi_|xrays|clinical_|deterioration|surgeon|current_department|transferred|surgical_)/.test(f) ? 'НЭК'
    : /^(abx_course|course_completed)/.test(f) ? 'Курс АБТ' : 'Инфекция и антибактериальная терапия';

  const GRAM_NEGATIVE_FULL = ['Escherichia coli', 'Klebsiella pneumoniae', 'Pseudomonas aeruginosa', 'Enterobacter cloacae', 'Serratia marcescens', 'Acinetobacter baumannii'];
  const GRAM_NEGATIVE = ['E. coli', 'K. pneumoniae', 'P. aeruginosa', 'E. cloacae', 'S. marcescens', 'A. baumannii'];
  const ABX = 'ампициллин|гентамицин|метронидазол|бензилпенициллин|цефотаксим|амикацин|ванкомицин|меропенем|цефтазидим|амоксициллин';

  const num = s => Number(String(s).replace(/\s/g, '').replace(',', '.'));
  const iso = (m, i, tz) => `${m[i + 2]}-${m[i + 1]}-${m[i]}T${m[i + 3]}:${m[i + 4]}${tz}`;

  /** Разбивка на записи (строки) со смещениями. */
  function records(text) {
    const out = []; let pos = 0;
    for (const line of text.split('\n')) { out.push({ line, start: pos }); pos += line.length + 1; }
    return out;
  }

  /*
   * Дата и время (этап 8). Форматы даты: ДД.ММ.ГГГГ, ДД/ММ/ГГГГ, ДД.ММ.ГГ, «ДД месяца ГГГГ г.».
   * Время: ЧЧ:ММ. Между датой и временем допускается «в»: «06.08.2026 в 09:45».
   */
  const MONTHS = { январ: '01', феврал: '02', март: '03', апрел: '04', ма: '05', июн: '06', июл: '07', август: '08', сентябр: '09', октябр: '10', ноябр: '11', декабр: '12' };
  const DATE_SRC = '(?<![\\d.\\/])(\\d\\d)[.\\/](\\d\\d)[.\\/](\\d{4}|\\d\\d)(?![\\d.\\/])';
  const DATE_RE = new RegExp(DATE_SRC, 'g');
  const MDATE_RE = /(?<![\d])(\d{1,2}) (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) (\d{4})(?: ?г\.?)?/g;
  const ymd = (d, mo, y) => `${y.length === 2 ? '20' + y : y}-${mo}-${d}`;
  const monthNum = w => { for (const k of Object.keys(MONTHS)) if (w.startsWith(k)) return MONTHS[k]; return null; };
  /** Все даты в строке: [{date, index, end}]. */
  function datesIn(line) {
    const out = []; let m;
    DATE_RE.lastIndex = 0; while ((m = DATE_RE.exec(line))) out.push({ date: ymd(m[1], m[2], m[3]), index: m.index, end: m.index + m[0].length });
    MDATE_RE.lastIndex = 0; while ((m = MDATE_RE.exec(line))) out.push({ date: ymd(m[1].padStart(2, '0'), monthNum(m[2]), m[3]), index: m.index, end: m.index + m[0].length });
    return out.sort((x, y) => x.index - y.index);
  }
  const TIME_SRC = '(?<![\\d:.,])([01]\\d|2[0-3]):([0-5]\\d)(?![\\d:])';
  /** Все отметки времени: {time, date|null, index, end} — дата берётся, если стоит непосредственно перед временем. */
  function timesIn(line) {
    const ds = datesIn(line), out = []; const re = new RegExp(TIME_SRC, 'g'); let m;
    while ((m = re.exec(line))) {
      const d = ds.filter(x => x.end <= m.index && /^,?\s*(?:г\.?\s*)?(?:в\s+)?$/.test(line.slice(x.end, m.index))).pop();
      out.push({ time: m[1] + ':' + m[2], date: d ? d.date : null, index: d ? d.index : m.index, end: m.index + m[0].length, tIndex: m.index });
    }
    return out;
  }
  /** Заголовок записи: «ДАТА ВРЕМЯ —» / «ДАТА ВРЕМЯ |» (ближайший слева) или «ЧЧ:ММ —» в начале строки при дате контекста. */
  function headerDT(line, idx, ctx) {
    let best = null;
    for (const t of timesIn(line)) {
      if (t.index > idx) break;
      if (t.date && /^\s*(?:—|–|\|)/.test(line.slice(t.end))) best = t;
    }
    if (best) return best;
    const m = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*(?:—|–)/.exec(line);
    if (m && ctx && ctx.date && ctx.ok) return { time: m[1] + ':' + m[2], date: ctx.date, index: line.indexOf(m[1]), end: line.indexOf(m[1]) + 5, tIndex: line.indexOf(m[1]) };
    return null;
  }
  /** Границы предложения (части записи), в котором стоит позиция idx: «.», «;», «!», «?» + пробел. */
  function clause(line, idx) {
    let s = 0, e = line.length; const re = /[.;!?](?=\s)/g; let m;
    while ((m = re.exec(line))) {
      if (/\d/.test(line[m.index - 1] || '') && /\d/.test(line[m.index + 2] || '')) continue; // 22. 06 — не граница
      if (/(?:\s|^)(?:ст|рт|г|мм|в\/в|в\/м)$/.test(line.slice(Math.max(0, m.index - 4), m.index)) && /^\s+[а-яё]/.test(line.slice(m.index + 1))) continue; // «рт. ст. »
      if (m.index < idx) s = m.index + 1; else { e = m.index; break; }
    }
    return { s, e };
  }
  /** Время, которое относится не к самому событию (назначение, план, ошибочная запись). */
  const FOREIGN_TIME = /(?:назнач[\wА-Яа-яЁё]*|планир[\wА-Яа-яЁё]*|ошибочно[^,]*|вместо|после\s+\S+(?:\s+\S+)?|через\s+\S+(?:\s+\S+)?|до\s+\S+)\s*\(?\s*(?:в\s+)?$/;
  /** Скобки, внутри которых стоит позиция: [открывающая, закрывающая] или null. */
  function parenAt(line, i) { const o = line.lastIndexOf('(', i), c0 = line.lastIndexOf(')', i - 1); if (o < 0 || c0 > o) return null; const c = line.indexOf(')', i); return c < 0 ? null : [o, c]; }
  /**
   * Часть предложения, относящаяся к одному действию: границы — запятая, точка с запятой, тире, союзы «и», «а также»
   * (вне скобок). Явное время приписывается только действию из той же части.
   */
  function commaSeg(line, i) {
    const cl = clause(line, i); let s = cl.s, e = cl.e, depth = 0;
    for (let k = cl.s; k < cl.e; k++) {
      const ch = line[k];
      if (ch === '(') { depth++; continue; } if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
      if (depth) continue;
      let len = 0;
      if ((ch === ',' || ch === ';') && !/\d/.test(line[k + 1] || '')) len = 1;
      else { const w = /^ (?:и|а также|—|–) /.exec(line.slice(k, k + 10)); if (w && k > cl.s) len = w[0].length; }
      if (!len) continue;
      if (k < i) s = k + len; else { e = k; break; }
      k += len - 1;
    }
    return { s, e };
  }
  const minutes = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const iv = (date, time, tz) => `${date}T${time}${tz}`;
  /**
   * Время события по позиции idx (этап 8, исправление ошибки привязки из слепого теста №1).
   * 1) Время в том же предложении важнее заголовка записи: «22.06.2026 08:30 — … Кормление прекращено в 08:40» → 08:40.
   * 2) В предложении больше одного разного времени → неоднозначно → null (нет значения лучше неверного).
   * 3) Время без даты берёт дату заголовка записи (или дату контекста — заголовка раздела); если оно раньше
   *    времени заголовка (возможен переход через полночь или запись задним числом) → null.
   * 4) Своего времени в предложении нет → время заголовка записи.
   * 5) Время, к которому относится «назначена в», «после …», «через …», «ошибочно», событием не считается.
   * Возвращает {value, index, end} — фрагмент должен покрывать и событие, и использованное время.
   */
  function eventDT(line, idx, tz, ctx) {
    const h = headerDT(line, idx, ctx), cl = clause(line, idx);
    const own = []; const pe = parenAt(line, idx), seg = commaSeg(line, idx); let elsewhere = false;
    for (const t of timesIn(line)) {
      if (t.tIndex < cl.s || t.tIndex >= cl.e) continue;
      if (h && t.tIndex === h.tIndex) continue; // сам заголовок записи
      if (FOREIGN_TIME.test(line.slice(Math.max(cl.s, t.index - 40), t.index))) continue;
      const pt = parenAt(line, t.tIndex);
      if (pt && !(pe && pe[0] === pt[0])) continue; // время в скобках относится к тому, что в скобках
      if (pe && !(pt && pt[0] === pe[0])) continue; // событие в скобках — только время из тех же скобок
      if (t.tIndex < seg.s || t.tIndex >= seg.e) { elsewhere = true; continue; } // время другого действия через запятую
      own.push(t);
    }
    if (!own.length && elsewhere) return null; // в предложении есть время другого действия — не подставляем заголовок
    const hv = h ? iv(h.date, h.time, tz) : null;
    if (own.length) {
      const base = h ? h : (ctx && ctx.ok && ctx.date ? { date: ctx.date, time: ctx.last || '00:00' } : null);
      const vals = own.map(t => {
        if (t.date) return iv(t.date, t.time, tz);
        if (!base) return null; // дата неизвестна
        if (t.time < base.time && minutes(base.time) - minutes(t.time) > 360) return null; // намного раньше заголовка (возможен переход через полночь) — не угадываем дату
        return iv(base.date, t.time, tz);
      });
      const uniq = [...new Set(vals)];
      if (uniq.length !== 1 || uniq[0] === null) return null;
      if (hv && uniq[0] === hv) return { value: hv, index: h.index, end: h.end };
      const t = own[0]; return { value: uniq[0], index: t.index, end: t.end };
    }
    return h ? { value: hv, index: h.index, end: h.end } : null;
  }
  /** Кандидат «поле = время события»: фрагмент охватывает и событие, и время. */
  const atField = (f, d, m) => ({ f, v: d.value, s: Math.min(d.index, m.index), e: Math.max(d.end, m.index + m[0].length) });
  /** Отметка с датой без времени в начале записи («08.06.2026 — …»). */
  function eventDateOnly(line, idx) {
    const m = /^(\d\d)\.(\d\d)\.(\d{4}) — /.exec(line) || /(?:^|[.;] )(\d\d)\.(\d\d)\.(\d{4}) — /.exec(line.slice(0, idx + 1));
    return m && m.index <= idx ? { date: `${m[3]}-${m[2]}-${m[1]}`, index: m.index } : null;
  }

  /*
   * Правила. Каждое: re — выражение по одной записи; emit(m, ctx) → список {f, v, s?, e?} где s/e — смещения
   * фрагмента внутри строки (по умолчанию — всё совпадение).
   */
  const RULES = [
    // ── ребёнок
    { re: /[Сс]рок гестации (\d{2}) недел[ьяи]/g, emit: m => [{ f: 'gestational_age_weeks', v: +m[1] }] },
    { re: /[Мм]асса при рождении (\d{3,4}) г(?![А-Яа-я])/g, emit: m => [{ f: 'birth_weight_g', v: +m[1] }] },
    { re: new RegExp(DT + ' — масса (\\d+,\\d+) кг', 'g'), emit: (m, c) => [{ f: 'weight_kg', v: num(m[6]), s: m.index + m[0].indexOf('масса') }, { f: 'weight_measured_at', v: iso(m, 1, c.tz) }] },
    { re: /(?:постнатальный )?возраст (\d+) сут(?:ок|ки)/g, emit: m => [{ f: 'postnatal_age_days', v: +m[1] }] },
    { re: /организация (\d)-го уровня/g, emit: m => [{ f: 'facility_level', v: +m[1] }] },
    { re: /[Дд]етской хирургической службы в организации нет/g, emit: () => [{ f: 'surgical_department_available', v: false }] },

    // ── РДС: родзал
    { re: /получила полный курс антенатальных стероидов/g, emit: () => [{ f: 'antenatal_steroids_given', v: true }] },
    { re: /[Аа]нтенатальные стероиды не вводились/g, emit: () => [{ f: 'antenatal_steroids_given', v: false }] },
    { re: /отнесён к группе риска развития РДС/g, emit: () => [{ f: 'rds_risk', v: true }] },
    { re: /[Сс]остояние позволяло отсроченное пережатие пуповины/g, emit: () => [{ f: 'condition_allows_delayed_clamping', v: true }] },
    { re: /[Пп]уповина пережата через (\d+) секунд/g, emit: m => [{ f: 'cord_clamp_delay_s', v: +m[1] }] },
    { re: /(?:СРАР|CPAP) (?:начат )?с момента рождения/g, emit: () => [{ f: 'cpap_from_birth', v: true }] },
    { re: /(?:СРАР|CPAP)[^.]*?(давление (\d+(?:,\d+)?) см H2O)/g, emit: m => { const s = m.index + m[0].indexOf(m[1]); return [{ f: 'cpap_pressure_cmh2o', v: num(m[2]), s, e: s + m[1].length }]; } },
    { re: /[Кк]ислород подавался через кислородно-воздушный смеситель/g, emit: () => [{ f: 'oxygen_given', v: true }, { f: 'oxygen_via_blender', v: true }] },
    { re: /[Кк]ислород подавался без кислородно-воздушного смесителя/g, emit: () => [{ f: 'oxygen_given', v: true }, { f: 'oxygen_via_blender', v: false }] },
    { re: /[Вв] родильном зале подавался кислород/g, emit: () => [{ f: 'oxygen_given', v: true }] },
    // FiO2 — только при стабилизации / в родильном зале (FiO2 при последующем ухудшении в ОРИТН сюда не идёт)
    { re: /FiO2 при стабилизации до (0,\d+)/g, emit: m => [{ f: 'fio2', v: num(m[1]) }] },
    { re: /[Вв] родильном зале подавался кислород, FiO2 (0,\d+)/g, emit: m => [{ f: 'fio2', v: num(m[1]) }] },
    { re: new RegExp(NOT_BEFORE + '(?<!не )для стабилизации потребовалась интубация', 'g'), emit: () => [{ f: 'intubation_needed_for_stabilization', v: true }, { f: 'intubated', v: true }] },
    { re: /[Ии]нтубация для стабилизации не потребовалась/g, emit: () => [{ f: 'intubation_needed_for_stabilization', v: false }] },
    { re: new RegExp(NOT_BEFORE + 'интубирован, ИВЛ', 'g'), emit: () => [{ f: 'intubated', v: true }, { f: 'mechanical_ventilation', v: true }] },
    { re: /ИВЛ \((?:SIMV|IPPV|SIPPV|HFOV|A\/C)\)/g, emit: () => [{ f: 'mechanical_ventilation', v: true }] },
    { re: /[Сс]урфактант введён в родильном зале/g, emit: () => [{ f: 'surfactant_given', v: true }, { f: 'surfactant_in_delivery_room', v: true }] },
    { re: /[Сс]урфактант в родильном зале не вводился/g, emit: () => [{ f: 'surfactant_in_delivery_room', v: false }] },
    { re: /(?:[Вв]ведён сурфактант|[Ээ]ндотрахеально введён сурфактант)/g, emit: () => [{ f: 'surfactant_given', v: true }] },
    { re: /(порактант альфа|берактант|калфактант|сурфактант-БЛ) (\d+(?:,\d+)?) (мг\/кг|мл)/g,
      emit: m => { const r = [{ f: 'surfactant_drug', v: m[1] }]; if (m[3] === 'мг/кг') r.push({ f: 'surfactant_initial_dose_mg_kg', v: num(m[2]) }); return r; } },
    { re: /Диагноз: РДС/g, emit: () => [{ f: 'rds_diagnosed', v: true }] },
    { re: /[Оо]ксигенотерапия после начальной стабилизации продолжена/g, emit: () => [{ f: 'oxygen_after_stabilization', v: true }] },
    { re: /целевая SpO2 (\d{2})[–-](\d{2}) ?%/g, emit: m => [{ f: 'spo2_target_low', v: +m[1] }, { f: 'spo2_target_high', v: +m[2] }] },
    { re: /[Пп]орог гипокапнии[^:]*: (PaCO2 ниже (\d+) мм рт\. ст\.)(?: \(([^)]+)\))?/g,
      emit: m => { const s = m.index + m[0].indexOf(m[1]); const r = [{ f: 'paco2_hypocapnia_threshold', v: +m[2], s, e: s + m[1].length }];
        if (m[3]) { const s2 = m.index + m[0].indexOf(m[3]); r.push({ f: 'threshold_source', v: m[3], s: s2, e: s2 + m[3].length }); } return r; } },
    { re: new RegExp(DT + ' — pH (\\d,\\d+), PaCO2 (\\d+) мм рт\\. ст\\.', 'g'), list: 'blood_gases', emit: (m, c) => [{ f: 'blood_gases', v: { drawn_at: iso(m, 1, c.tz), ph: num(m[6]), paco2_mmhg: +m[7] } }] },
    { re: new RegExp(DT + ' — (PIP|PEEP|FiO2|Частота) (?:снижен|снижена|повышен|повышена) с (\\d+(?:,\\d+)?) до (\\d+(?:,\\d+)?)', 'g'), list: 'vent_changes',
      emit: (m, c) => [{ f: 'vent_changes', v: { at: iso(m, 1, c.tz), parameter: m[6], from: num(m[7]), to: num(m[8]) } }] },

    // ── антибактериальная терапия (общие)
    { re: /[Нн]ачата антибактериальная терапия/g, emit: () => [{ f: 'antibiotics_started', v: true }] },
    { re: /[Аа]нтибактериальная терапия: /g, emit: () => [{ f: 'antibiotics_started', v: true }] },
    { re: /[Аа]нтибактериальная терапия не назначалась/g, emit: () => [{ f: 'antibiotics_started', v: false }] },
    { re: /[Кк]ровь на посев взята (\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)/g, emit: (m, c) => [{ f: 'blood_culture_drawn_at', v: iso(m, 1, c.tz) }] },
    { re: /[Пп]ервая доза (?!антибиотик)[а-яё]+ введена (\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)/g, emit: (m, c) => [{ f: 'first_abx_dose_administered_at', v: iso(m, 1, c.tz) }] },
    { re: new RegExp(DT + ' — кровь на посев взята', 'g'), emit: (m, c) => [{ f: 'blood_culture_drawn_at', v: iso(m, 1, c.tz) }] },
    { re: /из периферической вены/g, when: l => /посев/.test(l), emit: () => [{ f: 'sample_site', v: 'separate_vein' }] },
    { re: /кровь на посев взята[^.]*?(\d+,\d+) мл/g, emit: m => { const s = m.index + m[0].lastIndexOf(m[1]); return [{ f: 'sample_volume_ml', v: num(m[1]), s, e: s + m[1].length + 3 }]; } },
    { re: new RegExp(DT + ' — введена первая доза антибиотик(?:а|ов)', 'g'), emit: (m, c) => [{ f: 'antibiotics_started', v: true }, { f: 'first_abx_dose_administered_at', v: iso(m, 1, c.tz) }, { f: 'abx_course_started_at', v: iso(m, 1, c.tz) }] },
    { re: new RegExp(DT + ' — первая доза антибиотик(?:а|ов)', 'g'), emit: (m, c) => [{ f: 'antibiotics_started', v: true }, { f: 'abx_course_started_at', v: iso(m, 1, c.tz) }] },
    { re: new RegExp(DT + ' — последняя доза антибиотик(?:а|ов)', 'g'), emit: (m, c) => [{ f: 'abx_course_ended_at', v: iso(m, 1, c.tz) }] },
    { re: /курс завершён/g, emit: () => [{ f: 'course_completed', v: true }] },
    { re: /[Аа]нтибактериальная терапия продолжается/g, emit: () => [{ f: 'course_completed', v: false }] },
    { re: /(?:антибиотик(?:а|ов): |[Аа]нтибактериальная терапия: |[Пп]ервичная схема: )((?:(?:ABX)(?:, | \+ )?)+)/g, g: 'o', special: 'regimen' },
    { re: /[Мм]етронидазол не назначен/g, emit: () => [{ f: 'metronidazole_given', v: false }] },
    { re: /[Аа]нтибиотики отменены|[Аа]нтибактериальная терапия отменена/g, emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz, c.ctx); return d ? [atField('antibiotics_stopped_at', d, m)] : []; } },

    // ── посев, ТБИ
    { re: /посев крови (отрицательный|положительный)/g, emit: (m, c) => { const r = [{ f: 'blood_culture_result', v: m[1] }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('culture_result_at', d, m)); return r; } },
    { re: /посев крови положительный: ([A-Z]\. [a-z]+)/g, emit: m => { const s = m.index + m[0].indexOf(m[1]); const r = [{ f: 'pathogen', v: m[1], s, e: s + m[1].length }];
        if (GRAM_NEGATIVE.includes(m[1])) r.push({ f: 'gram_negative_culture', v: true, note: 'предложено по справочнику грамотрицательных возбудителей; подтверждает врач' }); return r; } },
    { re: /(?<!не )тяжёлая бактериальная инфекция исключена/g, emit: (m, c) => { const r = [{ f: 'serious_bacterial_infection_excluded', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('sbi_excluded_at', d, m)); return r; } },

    // ── сепсис
    { re: /показание к антибактериальной терапии/g, emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz, c.ctx); return d ? [atField('sepsis_indication_identified_at', d, m)] : []; } },
    { re: /факторов риска(?: и клинических признаков сепсиса)? — (\d+)/g, emit: m => [{ f: 'risk_factor_or_sign_count', v: +m[1] }] },
    { re: /признаков «Красного флага» нет/g, emit: () => [{ f: 'red_flag_count', v: 0 }] },
    { re: /«Красный флаг» — (\d+)/g, emit: m => [{ f: 'red_flag_count', v: +m[1] }] },
    { re: /[Пп]одозрение на ранний неонатальный сепсис/g, emit: () => [{ f: 'sepsis_suspected', v: true }, { f: 'early_onset_sepsis_suspected', v: true }] },
    { re: new RegExp(DT + ' — (исходный|контрольный) СРБ взят', 'g'), list: 'crp_samples', emit: (m, c) => [{ f: 'crp_samples', v: { drawn_at: iso(m, 1, c.tz), purpose: m[6] === 'исходный' ? 'baseline' : 'control' } }] },
    { re: /[Мм]енингит не подозревается|менингит исключён/g, emit: () => [{ f: 'meningitis', v: false }] },
    { re: /[Сс]остояние улучшается/g, emit: () => [{ f: 'improving', v: true }] },
    { re: /[Фф]акторов высокого риска[^.]*? нет/g, emit: () => [{ f: 'high_risk_factors', v: false }] },
    { re: /бензилпенициллин (\d[\d ]*?(?:,\d+)?) (мг|ЕД) \((\d[\d ]*?(?:,\d+)?) (мг\/кг|ЕД\/кг)\) в\/в каждые (\d+) ч/g, special: 'benzyl' },
    { re: /гентамицин (\d+(?:,\d+)?) мг \((\d+(?:,\d+)?) мг\/кг\) в\/в(?:,? (?:каждые (\d+) ч|вторая доза через (\d+) ч))?/g, special: 'genta' },
    { re: /[Ии]ммуноглобулин не вводился/g, emit: () => [{ f: 'immunoglobulin_given', v: false }] },
    { re: /введён иммуноглобулин человека нормальный|иммуноглобулин назначен индивидуально/g,
      emit: m => { const r = [{ f: 'immunoglobulin_given', v: true }]; if (/индивидуально/.test(m[0])) r.push({ f: 'immunoglobulin_use_type', v: 'individualized' }); return r; } },
    { re: /с целью лечения сепсиса/g, when: l => /иммуноглобулин/i.test(l), emit: () => [{ f: 'immunoglobulin_purpose', v: 'sepsis_treatment_or_prophylaxis' }] },
    { re: /рутинно по схеме отделения/g, when: l => /иммуноглобулин/i.test(l), emit: () => [{ f: 'immunoglobulin_use_type', v: 'routine' }] },
    { re: /по решению консилиума(?: \([^)]*\))?/g, emit: () => [{ f: 'consilium_documented', v: true }] },
    { re: /Основание: ([^\n]+?)\.?$/g, when: l => /иммуноглобулин/i.test(l), emit: m => { const s = m.index + m[0].indexOf(m[1]); return [{ f: 'clinical_evidence', v: m[1], s, e: s + m[1].length }]; } },

    // ── НЭК
    { re: /Подозрение на НЭК/g, emit: (m, c) => { const r = [{ f: 'nec_suspected', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('nec_suspected_at', d, m)); return r; } },
    { re: new RegExp('Начало заболевания — ' + DT, 'g'), emit: (m, c) => [{ f: 'nec_onset_at', v: iso(m, 1, c.tz) }] },
    { re: /[Ээ]нтеральное кормление (?:на момент подозрения )?проводилось/g, when: (l, all) => /НЭК/.test(all), emit: () => [{ f: 'feeding_at_nec_suspicion', v: 'active' }] },
    { re: /(?<!не )[Кк]ормление прекращено/g, emit: (m, c) => { const r = [{ f: 'enteral_feeding_stopped', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('enteral_feeding_stopped_at', d, m)); return r; } },
    { re: /[Кк]ормление не прекращено/g, emit: () => [{ f: 'enteral_feeding_stopped', v: false }] },
    { re: /установлен назогастральный зонд(?: (\d+) Fr)?/g, emit: (m, c) => { const r = [{ f: 'ng_tube_placed', v: true }]; if (m[1]) r.push({ f: 'ng_tube_size_f', v: +m[1] });
        const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('ng_tube_placed_at', d, m)); return r; } },
    { re: /[Нн]азогастральный зонд стоял/g, emit: () => [{ f: 'ng_tube_present_at_suspicion', v: true }] },
    { re: /исправно функционировал/g, when: l => /зонд/.test(l), emit: () => [{ f: 'ng_tube_functioning_at_suspicion', v: true }] },
    { re: /стоял пупочный венозный катетер/g, emit: () => [{ f: 'uvc_present', v: true }] },
    { re: new RegExp('ПВК удалён ' + DT, 'g'), emit: (m, c) => [{ f: 'uvc_removed', v: true }, { f: 'uvc_removed_at', v: iso(m, 1, c.tz) }] },
    { re: /ПВК сохранён/g, emit: () => [{ f: 'uvc_removed', v: false }] },
    { re: /[Пп]упочный артериальный катетер не устанавливался/g, emit: () => [{ f: 'uac_present', v: false }] },
    { re: /[Пп]олное парентеральное питание(?: \([^)]*\))?/g, emit: (m, c) => { const r = [{ f: 'pn_type', v: 'full' }]; if (/проводилось на момент начала заболевания/.test(c.line)) r.push({ f: 'pn_running_at_nec_onset', v: true, e: c.line.indexOf('проводилось на момент начала заболевания') + 'проводилось на момент начала заболевания'.length }); return r; } },
    { re: /[Пп]арентеральное питание не проводилось/g, emit: () => [{ f: 'pn_running_at_nec_onset', v: false }] },
    { re: /только \d+% глюкоза/g, emit: () => [{ f: 'pn_type', v: 'glucose_only' }] },
    { re: /частичное парентеральное питание/g, emit: () => [{ f: 'pn_type', v: 'partial' }] },
    { re: /НЭК (\d[абв])(?![А-Яа-я])/g, emit: (m, c) => { const r = [{ f: 'nec_stage', v: m[1] }];
        if (/диагноз/i.test(c.line.slice(Math.max(0, m.index - 20), m.index))) { const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('nec_diagnosed_at', d, m), atField('nec_confirmed_at', d, m)); } return r; } },
    { re: /(очная|дистанционная) консультация детского хирурга(?: [^:(]*?\((телемедицина)\))?(?:[^:]*): ([^\n]+?)\.?$/g, special: 'surgeon' },
    { re: new RegExp(DT + ' — (?:(контрольная|плановая) )?рентгенография в (горизонтальном|вертикальном|латеральном) положении: ([^.\\n]+)', 'g'), list: 'xrays',
      emit: (m, c) => [{ f: 'xrays', v: { at: iso(m, 1, c.tz), position: { горизонтальном: 'horizontal', вертикальном: 'vertical', латеральном: 'lateral' }[m[7]], reason: m[6] ? 'planned' : null, result: m[8] } }] },
    { re: /[Кк]линического ухудшения не было/g, emit: () => [{ f: 'clinical_deterioration', v: false }] },
    { re: new RegExp(NOT_BEFORE + '(?<!не )клиническое ухудшение', 'g'), emit: (m, c) => { const r = [{ f: 'clinical_deterioration', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('deterioration_at', d, m)); return r; } },
    { re: /(?<!не )клинико-лабораторное улучшение(?! в записи не)/g, emit: () => [{ f: 'clinical_lab_improvement_documented', v: true }] },
    { re: /пассаж(?: по ЖКТ)? не восстановлен/g, special: 'passage_false' },
    { re: /(?<!не )пассаж восстановлен/g, special: 'passage_true' },
    { re: /[Ээ]нтеральная нагрузка возобновлена/g, emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz, c.ctx); return d ? [atField('enteral_feeding_resumed_at', d, m)] : []; } },
    { re: /[Рр]ебёнок находится в ОРИТН/g, emit: () => [{ f: 'current_department', v: 'nicu' }] },
    { re: /в хирургический стационар не переведён/g, emit: () => [{ f: 'transferred_to_surgery', v: false }] },
  ];
  for (const r of RULES) if (r.special === 'regimen') r.re = new RegExp(r.re.source.replace('ABX', ABX), 'g');

  function special(kind, m, c) {
    const L0 = m.index;
    if (kind === 'regimen') {
      const drugs = m[1].split(/, | \+ /).map(s => s.trim()).filter(Boolean);
      const s = L0 + m[0].indexOf(m[1]);
      const r = [{ f: 'abx_regimen', v: drugs, s, e: s + m[1].length }];
      if (drugs.includes('метронидазол') && administered(c, m.index)) {
        r.push({ f: 'metronidazole_given', v: true, s, e: s + m[1].length });
        const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('metronidazole_given_at', d, m));
      }
      if (/[Пп]ервичная схема/.test(m[0])) {
        const set = drugs.slice().sort().join('+');
        const v = set === 'бензилпенициллин+гентамицин' ? 'benzylpenicillin+gentamicin' : set === 'ампициллин+гентамицин' ? 'ampicillin+gentamicin' : 'другое';
        r.push({ f: 'initial_empirical_regimen', v, s: L0 }, { f: 'empirical_regimen', v, s: L0 });
      }
      return r;
    }
    if (kind === 'dose') {
      const drug = drugName(m[1]); if (!drug) return [];
      const between = c.line.slice(m.index + m[1].length, m.index + m[0].indexOf(m[2], m[1].length));
      if (new RegExp('\\+|' + DRUG_ALT, 'i').test(between)) return []; // число относится к другому препарату
      const n = num(m[2].replace(' ', '')), unit = m[3].toLowerCase(); const r = [];
      // интервал: «каждые N ч» в той же части записи до следующего препарата или «+»
      const after = c.line.slice(m.index + m[0].length); const stop = after.search(new RegExp('\\+|' + LW + '(?:' + DRUG_ALT + ')' + RW, 'i'));
      const scope = stop >= 0 ? after.slice(0, stop) : after; const iv = /каждые (\d+) ?ч/.exec(scope);
      const ivPos = iv ? m.index + m[0].length + iv.index : 0;
      const sN = m.index + m[0].indexOf(m[2], m[1].length), eN = sN + m[2].length + 1 + m[3].length;
      const given = administered(c, m.index);
      if (drug === 'гентамицин') {
        if (given) r.push({ f: 'gentamicin_given', v: true });
        if (unit === 'мг') r.push({ f: 'gentamicin_dose_mg', v: n, s: m.index, e: eN });
        if (unit === 'мг/кг' || m[4]) r.push({ f: 'gentamicin_initial_dose_mg_kg', v: num(m[4] || m[2]) });
        if (iv) r.push({ f: 'gentamicin_interval_h', v: +iv[1], s: ivPos, e: ivPos + iv[0].length });
      } else if (drug === 'бензилпенициллин') {
        if (given) r.push({ f: 'benzylpenicillin_given', v: true });
        if (unit === 'мг') r.push({ f: 'benzylpenicillin_dose_mg', v: n, s: m.index, e: eN });
        if (unit === 'мг/кг' || m[4]) r.push({ f: 'benzylpenicillin_dose_mg_kg', v: num(m[4] || m[2]) });
        if (unit === 'ед/кг') r.push({ f: 'benzylpenicillin_dose_units_per_kg', v: n, s: m.index, e: eN });
        if (iv) r.push({ f: 'benzylpenicillin_interval_h', v: +iv[1], s: ivPos, e: ivPos + iv[0].length });
      } else if (drug === 'метронидазол' && given) r.push({ f: 'metronidazole_given', v: true });
      return r;
    }
    if (kind === 'regimenClause') {
      const cl = clause(c.line, m.index), rest = c.line.slice(m.index + m[0].length, cl.e);
      const drugs = [...new Set((rest.match(new RegExp(LW + '(?:' + DRUG_ALT + ')' + RW, 'g')) || []).map(drugName))];
      if (drugs.length < 2 || /НЭК/.test(c.text) && !/эмпирическ/.test(m[0])) return [];
      const set = drugs.slice().sort().join('+');
      const v = set === 'бензилпенициллин+гентамицин' ? 'benzylpenicillin+gentamicin' : set === 'ампициллин+гентамицин' ? 'ampicillin+gentamicin' : 'другое';
      return [{ f: 'abx_regimen', v: drugs, e: cl.e }, { f: 'initial_empirical_regimen', v, e: cl.e }];
    }
    if (kind === 'regimen8') {
      const drugs = [...new Set((m[0].match(new RegExp(LW + '(?:' + DRUG_ALT + ')' + RW, 'g')) || []).map(drugName))];
      if (drugs.length < 2) return [];
      const cl = clause(c.line, m.index), t = c.line.slice(cl.s, cl.e);
      if (/замен|смен|отмен|прекращ/i.test(t)) return []; // смена или отмена схемы — не стартовая схема
      const r = [];
      if (drugs.includes('метронидазол') && administered(c, m.index)) r.push({ f: 'metronidazole_given', v: true });
      // схема — только стартовая (первая доза / эмпирическая); «гентамицин назначен» без дозы не даёт gentamicin_given
      if (/эмпирическ|стартов/.test(t) || (/перв[\wА-Яа-яЁё]* доз/.test(t) && !/НЭК/.test(c.text))) {
        r.push({ f: 'abx_regimen', v: drugs });
        const set = drugs.slice().sort().join('+');
        const v = set === 'бензилпенициллин+гентамицин' ? 'benzylpenicillin+gentamicin' : set === 'ампициллин+гентамицин' ? 'ampicillin+gentamicin' : 'другое';
        r.push({ f: 'initial_empirical_regimen', v });
      }
      return r;
    }
    if (kind === 'benzyl') {
      const r = [...(administered(c, m.index) ? [{ f: 'benzylpenicillin_given', v: true }] : []), { f: 'benzylpenicillin_interval_h', v: +m[5], s: L0 + m[0].lastIndexOf('каждые') }];
      if (m[2] === 'мг') r.push({ f: 'benzylpenicillin_dose_mg', v: num(m[1]), e: L0 + ('бензилпенициллин ' + m[1] + ' мг').length });
      const sk = L0 + m[0].indexOf('(');
      if (m[4] === 'мг/кг') r.push({ f: 'benzylpenicillin_dose_mg_kg', v: num(m[3]), s: sk, e: sk + m[3].length + 7 });
      if (m[4] === 'ЕД/кг') r.push({ f: 'benzylpenicillin_dose_units_per_kg', v: num(m[3]), s: sk, e: sk + m[3].length + 7 });
      const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('benzylpenicillin_prescribed_at', d, m));
      // эмпирическая схема: бензилпенициллин и гентамицин назначены в одной и той же записи
      const g = /гентамицин (\d+(?:,\d+)?) мг/.exec(c.line.slice(m.index));
      if (g) { const e = m.index + g.index + g[0].length; r.push({ f: 'initial_empirical_regimen', v: 'benzylpenicillin+gentamicin', s: L0, e }, { f: 'empirical_regimen', v: 'benzylpenicillin+gentamicin', s: L0, e }); }
      return r;
    }
    if (kind === 'genta') {
      const r = [...(administered(c, m.index) ? [{ f: 'gentamicin_given', v: true }] : []), { f: 'gentamicin_dose_mg', v: num(m[1]), e: L0 + ('гентамицин ' + m[1] + ' мг').length }];
      const sk = L0 + m[0].indexOf('(');
      r.push({ f: 'gentamicin_initial_dose_mg_kg', v: num(m[2]), s: sk, e: sk + m[2].length + 7 });
      if (m[3] || m[4]) r.push({ f: 'gentamicin_interval_h', v: +(m[3] || m[4]), s: L0 + m[0].search(/каждые|вторая доза/) });
      const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('gentamicin_prescribed_at', d, m));
      return r;
    }
    if (kind === 'surgeon') {
      const r = [{ f: 'surgeon_consult_status', v: 'done' }, { f: 'surgeon_consult_format', v: m[1] === 'очная' ? 'in_person' : 'remote' }];
      const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('surgeon_consult_at', d, m));
      const s = L0 + m[0].lastIndexOf(m[3]);
      r.push({ f: /показано/.test(m[3]) ? 'surgeon_conclusion' : 'surgeon_recommendations', v: m[3], s, e: s + m[3].length });
      return r;
    }
    if (kind === 'passage_false' || kind === 'passage_true') {
      const v = kind === 'passage_true';
      const d = eventDT(c.line, m.index, c.tz, c.ctx), dd = d ? null : eventDateOnly(c.line, m.index);
      const obs = { v, at: d ? d.value : null, date: d ? d.value.slice(0, 10) : dd ? dd.date : null };
      const r = [{ f: 'gi_passage_restored', obs, s: d ? Math.min(d.index, m.index) : dd ? dd.index : m.index, e: d ? Math.max(d.end, m.index + m[0].length) : m.index + m[0].length }];
      if (v && d) r.push(atField('gi_passage_restored_at', d, m));
      return r;
    }
    return [];
  }


  /* ── Защиты от ловушек (этап 8) ───────────────────────────────────────────────────────────── */
  const LW = '(?<![А-Яа-яЁёA-Za-z])', RW = '(?![А-Яа-яЁёA-Za-z])';
  const SECTION_DR = /[Рр]одзал|[Рр]одильн[\wА-Яа-яЁё]* зал|РОДЗАЛ|[Сс]табилизац|[Пп]ервичн[\wА-Яа-яЁё]* реаниматц|[Пп]ервичн[\wА-Яа-яЁё]* реанимац/;
  const SECTION_NICU = /ОРИТН|[Дд]невник|[Нн]аблюдени|[Пп]оступлени/;
  const isHeading = l => l.length < 90 && !/\s(?:—|–)\s/.test(l) && !/\|/.test(l) && !/[.;]\s+[А-ЯЁ]/.test(l.trim().replace(/^\d+\.\s+/, ''));
  /** Части записи, разделённые «,», «;», «.», «|», «—» и скобками; возвращает {s, e} части вокруг idx. */
  function segment(line, idx) {
    let s = 0, e = line.length; const re = /[,;|()]|[.!?](?=\s|$)|\s[—–]\s/g; let m;
    while ((m = re.exec(line))) { if (m.index < idx) s = m.index + m[0].length; else { e = m.index; break; } }
    return { s, e };
  }
  const NEG = new RegExp(LW + '(?:не|нет|без|ни)' + RW + '|отсутств|исключ', 'i');
  const UNKNOWN = /не (?:указан|отмечен|записан|отражен|зафиксирован|уточн)|сведений\s*(?:в [^,;.]*)?нет|нет сведений|_{3,}/i;
  const PLAN = /планиру|запланир|решено начать|решить вопрос|рассмотреть|при необходимости|в случае|(?:^|\s)если\s|рекомендован|показано|продолжен[\wА-Яа-яЁё]* до получения/i;
  const COND_CLAUSE = /^\s*(?:\d\d:\d\d\s*—\s*)?(?:При|при)\s/;
  const OTHER = /[Мм]атер|[Мм]ать[\s:,]|у матери|[Мм]атеринск|у (?:первого|второго|другого|соседн)[\wА-Яа-яЁё]* ребён|соседн[\wА-Яа-яЁё]* койк|предыдущ[\wА-Яа-яЁё]* ребён|в анамнезе|[Дд]ля справки/;
  function blocked(g, line, s, e) {
    const sg = segment(line, s), seg = line.slice(sg.s, sg.e), cl = clause(line, s), cls = line.slice(cl.s, cl.e);
    if (g.includes('u') && UNKNOWN.test(seg)) return true;
    if (g.includes('n') && NEG.test(seg.replace(line.slice(s, e), ' '))) return true;
    if (g.includes('p') && (PLAN.test(seg) || COND_CLAUSE.test(cls))) return true;
    if (g.includes('o') && OTHER.test(cls)) return true;
    return false;
  }
  /** Участки строки: скопированный текст (до «фактически»/«исправленному верить») и значение, названное ошибочным. */
  function guardSpans(line) {
    const copy = [], wrong = []; let m;
    const cre = /скопирован[\wА-Яа-яЁё]*|копи[яию]\s|копипаст[\wА-Яа-яЁё]*/gi;
    while ((m = cre.exec(line))) { const rest = line.slice(m.index); const f = /фактически|исправленному верить|верно\s/i.exec(rest); const cl = clause(line, m.index); copy.push([m.index, f ? m.index + f.index : cl.e]); }
    const wre = /ошибочно\s+(?!скопир)(?:указан[\wА-Яа-яЁё]*|написан[\wА-Яа-яЁё]*|было|записан[\wА-Яа-яЁё]*)?/gi;
    while ((m = wre.exec(line))) { const rest = line.slice(m.index); const f = /верно\s|исправленному верить|исправлено на/i.exec(rest); if (f) wrong.push([m.index, m.index + f.index]); }
    return { copy, wrong };
  }
  const inSpan = (sp, i) => sp.some(([a, b]) => i >= a && i < b);

  /* ── Этап 8: обобщённые формулировки (полнота). g — защиты: u — «не указано», n — отрицание в той же части,
   *    p — план/условие, o — мать, другой ребёнок, анамнез. ─────────────────────────────────────────── */
  const CPAP = '(?:n|н|Н|N)?[CС][PР][AА][PР]';
  const SURF = 'Куросурф|[Пп]орактант альфа|[Кк]урасурф|Сурванта|[Бб]ерактант|[Кк]алфактант|[Сс]урфактант-БЛ|[Аа]львеофакт';
  const DRUGS = { ампициллин: 'ампициллин', гентамицин: 'гентамицин', гента: 'гентамицин', метронидазол: 'метронидазол', бензилпенициллин: 'бензилпенициллин', БП: 'бензилпенициллин',
    цефотаксим: 'цефотаксим', цефтриаксон: 'цефтриаксон', амикацин: 'амикацин', ванкомицин: 'ванкомицин', меропенем: 'меропенем', цефтазидим: 'цефтазидим', амоксициллин: 'амоксициллин' };
  const DRUG_ALT = 'ампициллин|гентамицин|метронидазол|бензилпенициллин|цефотаксим|цефтриаксон|амикацин|ванкомицин|меропенем|цефтазидим|амоксициллин|БП';
  const DRUG_RE = LW + '(' + DRUG_ALT + ')' + RW;
  const drugName = w => DRUGS[w] || DRUGS[w.toLowerCase()] || null;
  const tm = (f, val) => (m, c) => { const r = val === undefined ? [] : [{ f: val[0], v: val[1] }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField(f, d, m)); return r; };
  const T = (f, v) => () => [{ f, v }];
  /**
   * Поля *_given в словаре — «препарат назначен / включён в терапию» (словарь полей). Ставятся только при прямой
   * записи назначения или введения («назначено:», «введена первая доза», «начаты», «АБТ: …», строка листа назначений)
   * и не ставятся при плане, условии, отказе («не назначен») или записи «фактически не вводился» — тогда решает врач
   * (ревью ChatGPT к PR №13: план ≠ назначение ≠ введение).
   */
  const ADMIN = /введ[её]н|вводил|получа(?:ет|л)|[Нн]ачат[аыо]?(?![а-яё])|первая доза|[Нн]азначен[аоы]?(?![а-яё])|терапи[яи]\s*:|АБТ\s*:|схем[аеы]?\s*:/;
  const NOT_ADMIN = /не (?:вводил|введ[её]н|получал|назнача|назначен|начат)|фактически не|отмен[её]н\S* до введения/i;
  function administered(c, idx) {
    const cl = clause(c.line, idx), t = c.line.slice(cl.s, cl.e);
    // перечень после «назначено:» через «;» — одно предложение
    const ps = c.line.slice(0, idx).search(/[.!?]\s+[^.!?]*$/); const sent = c.line.slice(ps < 0 ? 0 : ps + 1, cl.e);
    if (NOT_ADMIN.test(c.line)) return false;
    if (!ADMIN.test(t) && ADMIN.test(sent) && !PLAN.test(sent)) return true;
    if (!ADMIN.test(t) && !/\|/.test(c.line)) return false;
    const sg = segment(c.line, idx);
    if (PLAN.test(c.line.slice(sg.s, sg.e)) || PLAN.test(t) || COND_CLAUSE.test(t)) return false;
    return true;
  }
  const RULES8 = [
    // ребёнок
    { re: new RegExp(LW + '(?:ГВ|[Сс]рок[\\wА-Яа-яЁё]*(?: гестации)?|гестационн[\\wА-Яа-яЁё]* возраст[\\wА-Яа-яЁё]*)\\s*:?\\s*(\\d{2})\\s*(?:нед|недел)', 'g'), g: 'o', emit: m => [{ f: 'gestational_age_weeks', v: +m[1] }] },
    { re: /(?:[Мм]асса|[Вв]ес)(?: тела)?(?: при поступлении)?\s*:?\s*(\d,\d{1,2}) кг/g, g: 'o', emit: m => [{ f: 'weight_kg', v: num(m[1]) }] },
    { re: /[Вв]звешивани[\wА-Яа-яЁё]*[^:.;]{0,20}:\s*(\d,\d{1,2}) кг/g, emit: m => [{ f: 'weight_kg', v: num(m[1]) }] },
    { re: /[Мм]асса при рождении \d{3,4} г \((\d,\d{1,2}) кг\)/g, emit: m => { const s = m.index + m[0].lastIndexOf(m[1]); return [{ f: 'weight_kg', v: num(m[1]), s, e: s + m[1].length + 3 }]; } },
    { re: /(?:[Мм]асса|[Вв]ес) \d,\d{1,2} кг \((\d{3,4}) г\)/g, when: l => /родил|рожд/.test(l), emit: m => { const s = m.index + m[0].lastIndexOf(m[1]); return [{ f: 'birth_weight_g', v: +m[1], s, e: s + m[1].length + 2 }]; } },
    { re: /взвешен[\wА-Яа-яЁё]* в ([01]\d|2[0-3]):[0-5]\d/g, emit: tm('weight_measured_at') },
    { re: /(?:возраст|на) (\d{1,2})(?:-е)? сут(?:ок|ки|ки жизни)(?: жизни)?/g, g: 'o', emit: m => [{ f: 'postnatal_age_days', v: +m[1] }] },
    { re: /(?<![\d,.])(\d)(?:-го)? уров(?:ень|ня|не|нем)/g, when: l => /центр|организац|учрежден|[Рр]одильн[\wА-Яа-яЁё]* дом|стационар|больниц/.test(l), emit: m => [{ f: 'facility_level', v: +m[1] }] },
    { re: /имеется (?:отделение|служба)[^.;)]{0,30}хирурги/g, emit: T('surgical_department_available', true) },
    { re: /нет (?:неонатальной |детской )?хирургической служб/g, emit: T('surgical_department_available', false) },
    // РДС: родзал
    { re: /курс[\wА-Яа-яЁё]* профилактики РДС плода|антенатальн[\wА-Яа-яЁё]* стероидн[\wА-Яа-яЁё]* профилактик|(?:дексаметазон|бетаметазон)[\wА-Яа-яЁё]* антенатально|антенатальн[\wА-Яа-яЁё]* (?:курс[\wА-Яа-яЁё]* )?(?:стероид|дексаметазон|бетаметазон)/gi, g: 'nup', emit: T('antenatal_steroids_given', true) },
    { re: /[Аа]нтенатальн[\wА-Яа-яЁё]* стероид[\wА-Яа-яЁё]* не (?:вводил|проводил|получал|назнача)|[Сс]тероиды антенатально не (?:вводил|проводил|получал)/g, g: 'u', emit: T('antenatal_steroids_given', false) },
    { re: /групп[\wА-Яа-яЁё]* (?:высокого )?риска (?:по |развития )?РДС/g, g: 'np', emit: T('rds_risk', true) },
    { re: /[Сс]остояние[^.;]{0,30}?позвол[\wА-Яа-яЁё]+[^.;]{0,15}?отсроченн[\wА-Яа-яЁё]* пережати/g, g: 'n', emit: T('condition_allows_delayed_clamping', true) },
    { re: /пережат[\wА-Яа-яЁё]*[^.;]{0,30}?(?:через|на) (\d+)(?:-й)? ?(?:сек|секунд)/g, g: 'p', emit: m => [{ f: 'cord_clamp_delay_s', v: +m[1] }] },
    { re: /(?:[Дд]иагноз[\wА-Яа-яЁё]*:?|выставлен[\wА-Яа-яЁё]* диагноз:?|[Уу]становлен[\wА-Яа-яЁё]* диагноз:?)\s*(?:[а-яё]+\s+){0,2}(?:РДС|[Рр]еспираторн[\wА-Яа-яЁё]* дистресс-синдром)/g, g: 'np', emit: T('rds_diagnosed', true) },
    { re: new RegExp('(?:[Сс] (?:момента )?рождения|[Сс] первых минут(?: после рождения)?)[^.;]{0,60}?' + CPAP + '|' + CPAP + '[^.;]{0,25}?с (?:момента )?рождения', 'g'), g: 'np', emit: T('cpap_from_birth', true) },
    { re: new RegExp(CPAP + '[^.;]{0,60}?давлени[\\wА-Яа-яЁё]* (\\d+(?:,\\d)?) ?см (?:H2O|Н2О|вод)', 'g'), g: 'p', when: (l, all) => true,
      emit: (m, c) => { if (!(c.section === 'dr' || /рождени|начальн|стартов/.test(m[0]))) return []; const s = m.index + m[0].lastIndexOf(m[1]); return [{ f: 'cpap_pressure_cmh2o', v: num(m[1]), s, e: s + m[1].length + 7 }]; } },
    { re: /начальным давлением (\d+(?:,\d)?) ?см (?:H2O|Н2О|вод)/g, emit: m => [{ f: 'cpap_pressure_cmh2o', v: num(m[1]) }] },
    { re: /[Кк]ислород подавался|[Пп]одача кислорода|[Кк]ислород через смеситель|подавался \d+ ?% кислород|[Кк]ислородо?терапи[\wА-Яа-яЁё]* (?:через|\()смесител/g, g: 'unp', emit: T('oxygen_given', true) },
    { re: /через (?:кислородно-воздушный )?смеситель|[Кк]ислородо?терапи[\wА-Яа-яЁё]* \(смеситель\)/g, g: 'unp', when: l => /[Кк]ислород/.test(l), emit: T('oxygen_via_blender', true) },
    { re: /[Сс]меситель не (?:использовал|применял)|без (?:кислородно-воздушного )?смесителя|напрямую от разводки/g, g: 'u', emit: T('oxygen_via_blender', false) },
    { re: /(?:[Сс]тартов[\wА-Яа-яЁё]*|[Нн]ачальн[\wА-Яа-яЁё]*) FiO2 (0,\d\d?)|FiO2 (0,\d\d?)/g, g: 'p',
      emit: (m, c) => { const v = m[1] || m[2]; if (!(m[1] || c.section === 'dr' || /верно\s+$/.test(c.line.slice(Math.max(0, m.index - 12), m.index)) || /смесител|родзал/.test(c.line.slice(Math.max(0, m.index - 40), m.index)))) return []; return [{ f: 'fio2', v: num(v) }]; } },
    { re: /верно (0,\d\d?)/g, when: l => /FiO2/.test(l), emit: m => [{ f: 'fio2', v: num(m[1]) }] },
    { re: /[Ии]нтубаци[\wА-Яа-яЁё]* для стабилизации не (?:требовал|потребовал)[\wА-Яа-яЁё]*/g, emit: T('intubation_needed_for_stabilization', false) },
    { re: /[Ии]нтубаци[\wА-Яа-яЁё]* не (?:проводил|выполнял)[\wА-Яа-яЁё]*/g, emit: T('intubated', false) },
    { re: /(?:аппаратн[\wА-Яа-яЁё]* )?ИВЛ не (?:проводил|требовал|выполнял)[\wА-Яа-яЁё]*/g, emit: T('mechanical_ventilation', false) },
    { re: /переведён[\wА-Яа-яЁё]* на ИВЛ|[Нн]а аппаратной ИВЛ/g, g: 'np', emit: T('mechanical_ventilation', true) },
    { re: new RegExp('(?:[Вв]вед[её]н[\\wА-Яа-яЁё]*)[^.;]{0,60}?(' + SURF + '|сурфактант)|(' + SURF + ')[^.;]{0,25}?введ[её]н', 'g'), g: 'npo',
      emit: (m, c) => { const cl = clause(c.line, m.index), t = c.line.slice(cl.s, cl.e); const r = [{ f: 'surfactant_given', v: true }];
        const dn = new RegExp('(' + SURF + ')(?: \\((?:' + SURF + ')\\))?').exec(t); if (dn) r.push({ f: 'surfactant_drug', v: dn[0], s: cl.s + dn.index, e: cl.s + dn.index + dn[0].length });
        if (/родзал|родильн[\wА-Яа-яЁё]* зал/.test(t)) r.push({ f: 'surfactant_in_delivery_room', v: true }); else if (/ОРИТН/.test(t)) r.push({ f: 'surfactant_in_delivery_room', v: false });
        const ds = /(\d+) ?мг\/кг/.exec(t); if (ds) r.push({ f: 'surfactant_initial_dose_mg_kg', v: +ds[1], s: cl.s + ds.index, e: cl.s + ds.index + ds[0].length });
        return r; } },
    { re: /[Сс]урфактант в (?:родзале|родильном зале) не вводил[\wА-Яа-яЁё]*/g, emit: T('surfactant_in_delivery_room', false) },
    { re: /(?:[Цц]елев[\wА-Яа-яЁё]*[^.;|]{0,40}?SpO2|SpO2 целев[\wА-Яа-яЁё]*)\s*:?\s*(?:от\s*)?(\d{2})\s*%?\s*(?:[–-]|до)\s*(\d{2})\s*%/g, g: 'p',
      emit: m => [{ f: 'spo2_target_low', v: +m[1] }, { f: 'spo2_target_high', v: +m[2] }] },
    // АБТ
    { re: /[Пп]ерв[\wА-Яа-яЁё]* доз[\wА-Яа-яЁё]* (?:[а-яё]+ )?(?:АБТ|антибиотик[\wА-Яа-яЁё]*|эмпирическ[\wА-Яа-яЁё]*|метронидазол[\wА-Яа-яЁё]* и АБТ)[^.;]{0,15}?введен[\wА-Яа-яЁё]*|[Вв]веден[\wА-Яа-яЁё]* перв[\wА-Яа-яЁё]* доз[\wА-Яа-яЁё]* (?:эмпирическ[\wА-Яа-яЁё]* )?(?:АБТ|антибиотик[\wА-Яа-яЁё]*|схем[\wА-Яа-яЁё]*|курс[\wА-Яа-яЁё]*)/g, g: 'po',
      emit: (m, c) => { const r = [{ f: 'antibiotics_started', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('first_abx_dose_administered_at', d, m), atField('abx_course_started_at', d, m)); return r; } },
    { re: /[Пп]ерв[\wА-Яа-яЁё]* доз[\wА-Яа-яЁё]* (?:эмпирическ[\wА-Яа-яЁё]* )?(?:АБТ|антибиотик[\wА-Яа-яЁё]*|схем[\wА-Яа-яЁё]*)\s*:\s*/g, g: 'po', special: 'regimenClause' },
    { re: /[Нн]ачат[\wА-Яа-яЁё]* (?:АБТ|антибактериальн[\wА-Яа-яЁё]* терапи[\wА-Яа-яЁё]*)|(?:АБТ|[Аа]нтибактериальн[\wА-Яа-яЁё]* терапи[\wА-Яа-яЁё]*) начат[\wА-Яа-яЁё]*/g, g: 'npo',
      emit: (m, c) => { const r = [{ f: 'antibiotics_started', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('abx_course_started_at', d, m)); return r; } },
    { re: /[Пп]оследн[\wА-Яа-яЁё]* доз[\wА-Яа-яЁё]* (?:курса )?(?:АБТ|антибиотик[\wА-Яа-яЁё]*)/g, g: 'np', emit: tm('abx_course_ended_at') },
    { re: /[Кк]урс (?:АБТ )?завершён|полный \d+-суточный курс завершён/g, g: 'np', emit: (m, c) => { const r = [{ f: 'course_completed', v: true }]; if (/^[Кк]урс АБТ/.test(m[0])) { const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('abx_course_ended_at', d, m)); } return r; } },
    { re: /(?:[Аа]нтибактериальн[\wА-Яа-яЁё]* терапи[\wА-Яа-яЁё]*|АБТ|[Аа]нтибиотик[\wА-Яа-яЁё]*) (?:отменен|прекращ)[\wА-Яа-яЁё]*|[Кк]урс АБТ прекращ[\wА-Яа-яЁё]*/g, g: 'npo', emit: tm('antibiotics_stopped_at') },
    { re: /(?:[Вв]ыявлен[\wА-Яа-яЁё]*|[Оо]пределен[\wА-Яа-яЁё]*|выставлен[\wА-Яа-яЁё]*[^.;]{0,40}?)\s*(?:и\s+)?показани[\wА-Яа-яЁё]* к (?:АБТ|антибактериальн)/g, g: 'np', emit: tm('sepsis_indication_identified_at') },
    { re: /(?:[Пп]одозрени[\wА-Яа-яЁё]* на|[Зз]аподозрен[\wА-Яа-яЁё]*) (?:(ранн[\wА-Яа-яЁё]*|поздн[\wА-Яа-яЁё]*) неонатальн[\wА-Яа-яЁё]* сепсис|(РНС|ПНС))/g, g: 'np',
      emit: m => { const r = [{ f: 'sepsis_suspected', v: true }]; if (/ранн|РНС/.test(m[0])) r.push({ f: 'early_onset_sepsis_suspected', v: true }); return r; } },
    { re: /(?:[Вв]зят[\wА-Яа-яЁё]*|[Зз]абран[\wА-Яа-яЁё]*|[Зз]абор[\wА-Яа-яЁё]*)[^.;]{0,25}?посев[\wА-Яа-яЁё]*|[Вв]зят[\wА-Яа-яЁё]* кровь[^.;]{0,50}?на посев/g, g: 'npo',
      emit: (m, c) => { const cl = clause(c.line, m.index), t = c.line.slice(cl.s, cl.e); const r = []; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('blood_culture_drawn_at', d, m));
        const sv = /отдельн[\wА-Яа-яЁё]* (?:периферическ[\wА-Яа-яЁё]* )?вен/.exec(t); if (sv) r.push({ f: 'sample_site', v: 'separate_vein', s: cl.s + sv.index, e: cl.s + sv.index + sv[0].length });
        const vol = /(\d+,\d+) ?мл/.exec(t); if (vol) r.push({ f: 'sample_volume_ml', v: num(vol[1]), s: cl.s + vol.index, e: cl.s + vol.index + vol[0].length }); return r; } },
    { re: /[Пп]осев[\wА-Яа-яЁё]* кров[\wА-Яа-яЁё]*[^.;]{0,40}?([Оо]трицательн|[Пп]оложительн)[\wА-Яа-яЁё]*|([Оо]трицательн|[Пп]оложительн)[\wА-Яа-яЁё]* посев[\wА-Яа-яЁё]* кров[\wА-Яа-яЁё]*/g, g: 'po',
      emit: (m, c) => { if (/предварительн/.test(c.line.slice(Math.max(0, m.index - 20), m.index + m[0].length))) return []; const v = (m[1] || m[2]).toLowerCase() === 'отрицательн' ? 'отрицательный' : 'положительный'; const r = [{ f: 'blood_culture_result', v }];
        const tail = c.line.slice(m.index + m[0].length); const rt = /^\s*\((?:результат[\wА-Яа-яЁё]*|получен[\wА-Яа-яЁё]*)\s*(?:получен\s*)?/.exec(tail);
        if (rt) { const d = eventDT(c.line, m.index + m[0].length + rt[0].length, c.tz, c.ctx); if (d) r.push(atField('culture_result_at', d, m)); }
        const p = /^:?\s*([A-Z][a-z]+ [a-z]+|[A-Z]\. [a-z]+)/.exec(tail);
        if (v === 'положительный' && p) { const s = m.index + m[0].length + p.index + p[0].indexOf(p[1]); r.push({ f: 'pathogen', v: p[1], s, e: s + p[1].length });
          if (GRAM_NEGATIVE.includes(p[1]) || GRAM_NEGATIVE_FULL.includes(p[1])) r.push({ f: 'gram_negative_culture', v: true, s, e: s + p[1].length, note: 'предложено по справочнику грамотрицательных возбудителей; подтверждает врач' }); }
        return r; } },
    { re: /(?:[Ии]сходн[\wА-Яа-яЁё]*|[Кк]онтрольн[\wА-Яа-яЁё]*) (?:CРБ|СРБ)|(?:CРБ|СРБ) \((исходн|контрол)/g, g: 'npu',
      emit: (m, c) => { if (/\|/.test(c.line) && !/^\s*\d\d[.\/]\d\d[.\/]\d{2,4} [0-2]\d:[0-5]\d\s*\|/.test(c.line)) return [];
        const d = eventDT(c.line, m.index, c.tz, c.ctx); if (!d) return []; return [Object.assign(atField('crp_samples', d, m), { v: { drawn_at: d.value, purpose: /сходн/.test(m[0]) ? 'baseline' : 'control' } })]; }, list: 'crp_samples' },
    { re: /[Мм]енингит (?:клинически )?исключён/g, g: 'p', emit: T('meningitis', false) },
    { re: /ТБИ исключена|[Тт]яжёл[\wА-Яа-яЁё]* бактериальн[\wА-Яа-яЁё]* инфекци[\wА-Яа-яЁё]* исключена/g, g: 'p', emit: (m, c) => { const r = [{ f: 'serious_bacterial_infection_excluded', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('sbi_excluded_at', d, m)); return r; } },
    { re: /[Ии]ммуноглобулин не (?:назнача|вводил)[\wА-Яа-яЁё]*/g, emit: T('immunoglobulin_given', false) },
    { re: /(\d+) признак[\wА-Яа-яЁё]* «?Красного флага/g, emit: m => [{ f: 'red_flag_count', v: +m[1] }] },
    { re: new RegExp(DRUG_RE + '[^.;]{0,25}?\\s*[|]?\\s*(\\d+(?:,\\d+)?(?: \\d{3})?) ?(мг|ЕД\\/кг|мг\\/кг)(?![А-Яа-я\\/])(?:\\s*\\((\\d+(?:,\\d+)?) ?мг\\/кг\\))?', 'gi'), g: 'nop', special: 'dose' },
    { re: new RegExp(DRUG_RE + '(?:\\s*\\([^)]{0,30}\\))?(?:\\s*(?:\\+|,)\\s*' + LW + '(?:' + DRUG_ALT + ')' + RW + '(?:\\s*\\([^)]{0,30}\\))?)+', 'g'), g: 'o', special: 'regimen8' },
    // НЭК
    { re: /(?:[Пп]одозрени[\wА-Яа-яЁё]* на|[Пп]одозрение и подтверждение) НЭК/g, g: 'np', emit: (m, c) => { if (/[Нн]есмотря/.test(c.line.slice(Math.max(0, m.index - 12), m.index))) return []; const r = [{ f: 'nec_suspected', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('nec_suspected_at', d, m)); return r; } },
    { re: /(?:НЭК|[Сс]тади[\wА-Яа-яЁё]*)\s*(?:стади[\wА-Яа-яЁё]*\s*)?(\d[абв])(?![А-Яа-я])/g, g: 'p', emit: m => [{ f: 'nec_stage', v: m[1] }] },
    { re: /(?:время )?начал[\wА-Яа-яЁё]* (?:заболевания )?(\d\d[.\/]\d\d[.\/]\d{2,4} (?:в )?[0-2]\d:[0-5]\d)/g, when: l => /НЭК/.test(l), emit: (m, c) => { const d = eventDT(c.line, m.index + m[0].indexOf(m[1]), c.tz, c.ctx); return d ? [atField('nec_onset_at', d, m)] : []; } },
    { re: /диагноз НЭК подтвержд[\wА-Яа-яЁё]*|подтвержд[\wА-Яа-яЁё]* (?:стади[\wА-Яа-яЁё]* )?НЭК|[Пп]одозрение и подтверждение НЭК/g, g: 'np', emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz, c.ctx); return d ? [atField('nec_diagnosed_at', d, m), atField('nec_confirmed_at', d, m)] : []; } },
    { re: /[Нн]а фоне энтеральн[\wА-Яа-яЁё]* кормлени|[Нн]а момент подозрения проводил[\wА-Яа-яЁё]* энтеральн[\wА-Яа-яЁё]* (?:кормлени|питани)/g, g: 'n', emit: T('feeding_at_nec_suspicion', 'active') },
    { re: /[Нн]а момент подозрения энтеральн[\wА-Яа-яЁё]* (?:кормлени|питани)[\wА-Яа-яЁё]* уже не проводил/g, emit: T('feeding_at_nec_suspicion', 'already_stopped') },
    { re: /(?:[Ээ]нтеральн[\wА-Яа-яЁё]* )?(?:кормлени|питани)[\wА-Яа-яЁё]*\s+(?:немедленно\s+)?(?:прекращен|отменен|остановлен)[\wА-Яа-яЁё]*/g, g: 'np', when: l => !/(?:ПП|парентеральн)[\wА-Яа-яЁё]* (?:прекращ|отмен)/.test(l),
      emit: (m, c) => { if (/(?:парентеральн|ПП)/.test(c.line.slice(Math.max(0, m.index - 15), m.index))) return []; const r = [{ f: 'enteral_feeding_stopped', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('enteral_feeding_stopped_at', d, m)); return r; } },
    { re: /[Уу]становлен[\wА-Яа-яЁё]* (?:назогастральн[\wА-Яа-яЁё]* зонд|НГЗ)|(?:НГЗ|[Нн]азогастральн[\wА-Яа-яЁё]* зонд) установлен/g, g: 'np',
      emit: (m, c) => { const r = [{ f: 'ng_tube_placed', v: true }]; const sz = /№ ?(\d+) ?(?:F|Fr)/.exec(c.line.slice(m.index, m.index + 60)); if (sz) { const s = m.index + sz.index; r.push({ f: 'ng_tube_size_f', v: +sz[1], s, e: s + sz[0].length }); }
        const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('ng_tube_placed_at', d, m)); return r; } },
    { re: /(?:НГЗ|[Нн]азогастральн[\wА-Яа-яЁё]* зонд)\s+(?:уже\s+)?стоял/g, g: 'n', emit: T('ng_tube_present_at_suspicion', true) },
    { re: /(?:НГЗ|[Нн]азогастральн[\wА-Яа-яЁё]* зонд) не стоял/g, emit: T('ng_tube_present_at_suspicion', false) },
    { re: /стоял[\wА-Яа-яЁё]* (?:пупочн[\wА-Яа-яЁё]* венозн[\wА-Яа-яЁё]* катетер|ПВК)|(?:ПВК|[Пп]упочн[\wА-Яа-яЁё]* венозн[\wА-Яа-яЁё]* катетер) стоял/g, g: 'n', emit: T('uvc_present', true) },
    { re: /ПАК не стоял|[Пп]упочн[\wА-Яа-яЁё]* артериальн[\wА-Яа-яЁё]* катетер не (?:стоял|устанавлива)/g, emit: T('uac_present', false) },
    { re: /ПВК удалён/g, g: 'p', emit: (m, c) => { const r = [{ f: 'uvc_removed', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('uvc_removed_at', d, m)); return r; } },
    { re: /[Пп]олн[\wА-Яа-яЁё]* (?:парентеральн[\wА-Яа-яЁё]* питани[\wА-Яа-яЁё]*|ПП)\s*(?:\([^)]*\)\s*)?(?:начат|проводил)/g, g: 'np', emit: T('pn_type', 'full') },
    { re: /только \d+ ?% глюкоз/g, emit: T('pn_type', 'glucose_only') },
    { re: /[Пп]роведена (очная|дистанционная) консультация (?:неонатального |детского )?хирурга/g, g: 'p', emit: (m, c) => { const r = [{ f: 'surgeon_consult_status', v: 'done' }, { f: 'surgeon_consult_format', v: m[1] === 'очная' ? 'in_person' : 'remote' }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('surgeon_consult_at', d, m)); return r; } },
    { re: /[Кк]онсультаци[\wА-Яа-яЁё]* (?:детского |неонатального )?хирурга не проводил[\wА-Яа-яЁё]*/g, emit: T('surgeon_consult_status', 'documented_not_done') },
    { re: /(?:выполнен|осуществлён)[\wА-Яа-яЁё]* (?:внутрибольничный |межбольничный )?перевод в (?:отделение (?:неонатальной |детской )?хирургии|хирурги)/g, g: 'np',
      emit: m => { const r = [{ f: 'transferred_to_surgery', v: true }]; if (/отделение/.test(m[0])) r.push({ f: 'current_department', v: 'neonatal_surgery' }); return r; } },
    { re: /перевод в (?:хирургию|хирургический стационар|отделение хирургии) не выполн[\wА-Яа-яЁё]*/g, emit: T('transferred_to_surgery', false) },
    { re: /[Кк]линическ[\wА-Яа-яЁё]* ухудшени[\wА-Яа-яЁё]*[^.;]{0,40}?не было/g, emit: T('clinical_deterioration', false) },
    { re: /[Кк]линическое ухудшение/g, g: 'np', emit: (m, c) => { const r = [{ f: 'clinical_deterioration', v: true }]; const d = eventDT(c.line, m.index, c.tz, c.ctx); if (d) r.push(atField('deterioration_at', d, m)); return r; } },
    { re: /[Пп]ассаж[\wА-Яа-яЁё]*(?: по ЖКТ)?\s+(?:ещё\s+)?не восстановлен/g, special: 'passage_false' },
    { re: /(?:[Фф]ункция пассажа|[Пп]ассаж)(?: по ЖКТ)? восстановлен/g, g: 'np', special: 'passage_true' },
    { re: /(?:[Ээ]нтеральн[\wА-Яа-яЁё]* )?(?:кормлени[\wА-Яа-яЁё]*|нагрузк[\wА-Яа-яЁё]*) возобновлен[\wА-Яа-яЁё]*/g, g: 'np', emit: tm('enteral_feeding_resumed_at') },
    { re: /[Мм]етронидаз[\wА-Яа-яЁё]* не (?:назнача|вводил|включ)[\wА-Яа-яЁё]*/g, emit: T('metronidazole_given', false) },
    { re: /перв[\wА-Яа-яЁё]* доз[\wА-Яа-яЁё]* метронидазол[\wА-Яа-яЁё]*/g, g: 'np', emit: tm('metronidazole_given_at') },
  ];
  // формулировки в начале предложения пишутся с заглавной: регистр в правилах этапа 8 не важен
  for (const r of RULES8) { if (!r.re.flags.includes('i')) r.re = new RegExp(r.re.source, r.re.flags + 'i'); RULES.push(r); }

  /**
   * extract(text, {tz, documentId}) → {version, document_id, tz, candidates[], warnings[]}
   * Кандидат: {id, field, value | timeline, alternatives?, fragment, start, end, fragments[], status:'не подтверждено',
   *            critical, group, note?}
   */
  function extract(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') throw new TypeError('extract: нужен текст');
    const tz = opts.tz;
    if (!/^[+-]\d\d:\d\d$/.test(tz || '')) throw new Error('extract: не задан часовой пояс организации (opts.tz, например "+05:00")');
    const hits = [], superseded = [];
    const ctx = { date: null, ok: false, last: null }; let section = null;
    for (const rec of records(text)) {
      const line = rec.line;
      // контекст: заголовок раздела с одной датой задаёт дату для записей «ЧЧ:ММ —»
      const ds = datesIn(line);
      if (isHeading(line)) {
        section = SECTION_DR.test(line) ? 'dr' : SECTION_NICU.test(line) ? 'nicu' : section;
        const uniq = [...new Set(ds.map(d => d.date))];
        if (uniq.length === 1 && !/[–-]\s*\d/.test(line.slice(ds[0].end, ds[0].end + 4))) { ctx.date = uniq[0]; ctx.ok = true; ctx.last = null; }
        else if (ds.length) { ctx.date = null; ctx.ok = false; }
      }
      // переход через полночь в пределах одной даты контекста: время «назад» → контекст больше не надёжен
      const lt = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*(?:—|–)/.exec(line);
      if (lt && ctx.ok) { const t = lt[1] + ':' + lt[2]; if (ctx.last && t < ctx.last) ctx.ok = false; else ctx.last = t; }
      const spans = guardSpans(line);
      const c = { line, tz, ctx: Object.assign({}, ctx), section, text };
      for (const rule of RULES) {
        if (rule.when && !rule.when(line, text)) continue;
        rule.re.lastIndex = 0; let m;
        while ((m = rule.re.exec(line))) {
          if (m[0].length === 0) { rule.re.lastIndex++; continue; }
          if (inSpan(spans.copy, m.index)) continue; // скопированный фрагмент — не источник
          if (rule.g && blocked(rule.g, line, m.index, m.index + m[0].length)) continue;
          const out = rule.special ? special(rule.special, m, c) : rule.emit(m, c);
          const old = inSpan(spans.wrong, m.index);
          for (const o of out) {
            const s = rec.start + (o.s !== undefined ? o.s : m.index);
            const e = rec.start + (o.e !== undefined ? o.e : m.index + m[0].length);
            const hit = Object.assign({}, o, { start: s, end: Math.max(e, s + 1), list: rule.list || null });
            if (old) superseded.push(hit); else hits.push(hit);
          }
        }
      }
    }
    // одинаковые значения одного поля из пересекающихся фрагментов (старое и новое правило) — одно попадание
    const key = h => h.f + '|' + JSON.stringify(h.v !== undefined ? h.v : h.obs);
    for (let i = hits.length - 1; i >= 0; i--) if (hits.some((x, j) => j < i && key(x) === key(hits[i]) && x.start < hits[i].end && hits[i].start < x.end)) hits.splice(i, 1);
    // значение, прямо названное ошибочным («ошибочно указано X, верно Y»), убирается и в других местах
    for (let i = hits.length - 1; i >= 0; i--) if (superseded.some(x => x.f === hits[i].f && JSON.stringify(x.v) === JSON.stringify(hits[i].v) && x.v !== undefined)) hits.splice(i, 1);
    // группировка по полю
    const byField = new Map();
    for (const h of hits) { if (!byField.has(h.f)) byField.set(h.f, []); byField.get(h.f).push(h); }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const candidates = [];
    let n = 0;
    for (const [f, hs] of byField) {
      hs.sort((a, b) => a.start - b.start);
      const base = { id: 'c' + (++n), field: f, status: 'не подтверждено', critical: CRITICAL.test(f), group: group(f) };
      const frag = h => ({ text: text.slice(h.start, h.end), start: h.start, end: h.end });
      if (f === 'gi_passage_restored') {
        const timeline = hs.map(h => Object.assign({}, h.obs, { fragment: frag(h) }));
        const values = [...new Set(timeline.map(t => t.v))];
        const c = Object.assign(base, { timeline, fragment: timeline[0].fragment.text, start: timeline[0].fragment.start, end: timeline[0].fragment.end, fragments: timeline.map(t => t.fragment) });
        if (values.length === 1 && timeline.length === 1) c.value = timeline[0].v; // одно наблюдение — обычное значение
        else c.note = 'Несколько наблюдений во времени. Движок принимает одно значение — выбирает врач; автоматического выбора нет.';
        candidates.push(c); continue;
      }
      if (hs[0].list) {
        const items = []; const frs = [];
        for (const h of hs) if (!items.some(x => same(x, h.v))) { items.push(h.v); frs.push(frag(h)); }
        candidates.push(Object.assign(base, { value: items, fragment: frs[0].text, start: frs[0].start, end: frs[0].end, fragments: frs })); continue;
      }
      const distinct = [];
      for (const h of hs) { const d = distinct.find(x => same(x.v, h.v)); if (d) d.frs.push(frag(h)); else distinct.push({ v: h.v, frs: [frag(h)], note: h.note }); }
      const c = Object.assign(base, { value: distinct[0].v, fragment: distinct[0].frs[0].text, start: distinct[0].frs[0].start, end: distinct[0].frs[0].end, fragments: distinct[0].frs });
      if (distinct[0].note) c.note = distinct[0].note;
      if (distinct.length > 1) {
        c.alternatives = distinct.map(d => ({ value: d.v, fragments: d.frs }));
        delete c.value; c.note = 'В тексте разные значения. Выбирает врач.';
      }
      candidates.push(c);
    }
    candidates.sort((a, b) => a.start - b.start);
    candidates.forEach((c, i) => { c.id = 'c' + (i + 1); });
    return { version: VERSION, document_id: opts.documentId || null, tz, candidates, warnings: opts.warnings ? opts.warnings.slice() : [] };
  }

  return { VERSION, extract, CRITICAL, group, records };
}));
