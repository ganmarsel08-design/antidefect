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

  /** Ближайшая слева отметка «ДД.ММ.ГГГГ ЧЧ:ММ —» в той же записи (время заголовка записи). */
  function headerDT(line, idx) {
    const re = new RegExp(DT + ' — ', 'g'); let m, best = null;
    while ((m = re.exec(line)) && m.index <= idx) best = m;
    return best;
  }
  /** Границы предложения (части записи), в котором стоит позиция idx: «.», «;», «!», «?» + пробел. */
  function clause(line, idx) {
    let s = 0, e = line.length; const re = /[.;!?](?=\s)/g; let m;
    while ((m = re.exec(line))) {
      if (/\d/.test(line[m.index - 1] || '') && /\d/.test(line[m.index + 2] || '')) continue; // 22. 06 — не граница
      if (m.index < idx) s = m.index + 1; else { e = m.index; break; }
    }
    return { s, e };
  }
  const TIME_RE = /(?:(\d\d)\.(\d\d)\.(\d{4}) )?(?<![\d:.])([01]\d|2[0-3]):([0-5]\d)(?![\d:])/g;
  /**
   * Время события по позиции idx (этап 8, исправление ошибки привязки из слепого теста №1).
   * 1) Время в том же предложении важнее заголовка записи: «22.06.2026 08:30 — … Кормление прекращено в 08:40» → 08:40.
   * 2) В предложении больше одного разного времени → неоднозначно → null (нет значения лучше неверного).
   * 3) Время без даты берёт дату заголовка записи; если оно раньше времени заголовка (возможен переход через
   *    полночь или запись задним числом) → null.
   * 4) Своего времени в предложении нет → время заголовка записи, как раньше.
   * Возвращает {value, index, end} — фрагмент должен покрывать и событие, и использованное время.
   */
  function eventDT(line, idx, tz) {
    const h = headerDT(line, idx), cl = clause(line, idx);
    const own = []; TIME_RE.lastIndex = 0; let m;
    while ((m = TIME_RE.exec(line))) {
      if (m.index < cl.s || m.index >= cl.e) continue;
      if (h && m.index === h.index) continue; // сам заголовок записи
      own.push(m);
    }
    const hv = h ? iso(h, 1, tz) : null;
    if (own.length) {
      const vals = own.map(t => {
        if (t[1]) return `${t[3]}-${t[2]}-${t[1]}T${t[4]}:${t[5]}${tz}`;
        if (!h) return null; // дата неизвестна
        if (`${t[4]}:${t[5]}` < `${h[4]}:${h[5]}`) return null; // раньше заголовка — не угадываем дату
        return `${h[3]}-${h[2]}-${h[1]}T${t[4]}:${t[5]}${tz}`;
      });
      const uniq = [...new Set(vals)];
      if (uniq.length !== 1 || uniq[0] === null) return null;
      if (hv && vals.length === 1 && uniq[0] === hv) return { value: hv, index: h.index, end: h.index + 16 };
      const t = own[0]; return { value: uniq[0], index: t.index, end: t.index + t[0].length };
    }
    return h ? { value: hv, index: h.index, end: h.index + 16 } : null;
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
    { re: /(?:антибиотик(?:а|ов): |[Аа]нтибактериальная терапия: |[Пп]ервичная схема: )((?:(?:ABX)(?:, | \+ )?)+)/g, special: 'regimen' },
    { re: /[Мм]етронидазол не назначен/g, emit: () => [{ f: 'metronidazole_given', v: false }] },
    { re: /[Аа]нтибиотики отменены|[Аа]нтибактериальная терапия отменена/g, emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz); return d ? [atField('antibiotics_stopped_at', d, m)] : []; } },

    // ── посев, ТБИ
    { re: /посев крови (отрицательный|положительный)/g, emit: (m, c) => { const r = [{ f: 'blood_culture_result', v: m[1] }]; const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('culture_result_at', d, m)); return r; } },
    { re: /посев крови положительный: ([A-Z]\. [a-z]+)/g, emit: m => { const s = m.index + m[0].indexOf(m[1]); const r = [{ f: 'pathogen', v: m[1], s, e: s + m[1].length }];
        if (GRAM_NEGATIVE.includes(m[1])) r.push({ f: 'gram_negative_culture', v: true, note: 'предложено по справочнику грамотрицательных возбудителей; подтверждает врач' }); return r; } },
    { re: /(?<!не )тяжёлая бактериальная инфекция исключена/g, emit: (m, c) => { const r = [{ f: 'serious_bacterial_infection_excluded', v: true }]; const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('sbi_excluded_at', d, m)); return r; } },

    // ── сепсис
    { re: /показание к антибактериальной терапии/g, emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz); return d ? [atField('sepsis_indication_identified_at', d, m)] : []; } },
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
    { re: /Подозрение на НЭК/g, emit: (m, c) => { const r = [{ f: 'nec_suspected', v: true }]; const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('nec_suspected_at', d, m)); return r; } },
    { re: new RegExp('Начало заболевания — ' + DT, 'g'), emit: (m, c) => [{ f: 'nec_onset_at', v: iso(m, 1, c.tz) }] },
    { re: /[Ээ]нтеральное кормление (?:на момент подозрения )?проводилось/g, when: (l, all) => /НЭК/.test(all), emit: () => [{ f: 'feeding_at_nec_suspicion', v: 'active' }] },
    { re: /(?<!не )[Кк]ормление прекращено/g, emit: (m, c) => { const r = [{ f: 'enteral_feeding_stopped', v: true }]; const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('enteral_feeding_stopped_at', d, m)); return r; } },
    { re: /[Кк]ормление не прекращено/g, emit: () => [{ f: 'enteral_feeding_stopped', v: false }] },
    { re: /установлен назогастральный зонд(?: (\d+) Fr)?/g, emit: (m, c) => { const r = [{ f: 'ng_tube_placed', v: true }]; if (m[1]) r.push({ f: 'ng_tube_size_f', v: +m[1] });
        const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('ng_tube_placed_at', d, m)); return r; } },
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
        if (/диагноз/i.test(c.line.slice(Math.max(0, m.index - 20), m.index))) { const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('nec_diagnosed_at', d, m), atField('nec_confirmed_at', d, m)); } return r; } },
    { re: /(очная|дистанционная) консультация детского хирурга(?: [^:(]*?\((телемедицина)\))?(?:[^:]*): ([^\n]+?)\.?$/g, special: 'surgeon' },
    { re: new RegExp(DT + ' — (?:(контрольная|плановая) )?рентгенография в (горизонтальном|вертикальном|латеральном) положении: ([^.\\n]+)', 'g'), list: 'xrays',
      emit: (m, c) => [{ f: 'xrays', v: { at: iso(m, 1, c.tz), position: { горизонтальном: 'horizontal', вертикальном: 'vertical', латеральном: 'lateral' }[m[7]], reason: m[6] ? 'planned' : null, result: m[8] } }] },
    { re: /[Кк]линического ухудшения не было/g, emit: () => [{ f: 'clinical_deterioration', v: false }] },
    { re: new RegExp(NOT_BEFORE + '(?<!не )клиническое ухудшение', 'g'), emit: (m, c) => { const r = [{ f: 'clinical_deterioration', v: true }]; const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('deterioration_at', d, m)); return r; } },
    { re: /(?<!не )клинико-лабораторное улучшение(?! в записи не)/g, emit: () => [{ f: 'clinical_lab_improvement_documented', v: true }] },
    { re: /пассаж(?: по ЖКТ)? не восстановлен/g, special: 'passage_false' },
    { re: /(?<!не )пассаж восстановлен/g, special: 'passage_true' },
    { re: /[Ээ]нтеральная нагрузка возобновлена/g, emit: (m, c) => { const d = eventDT(c.line, m.index, c.tz); return d ? [atField('enteral_feeding_resumed_at', d, m)] : []; } },
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
      if (drugs.includes('метронидазол')) {
        r.push({ f: 'metronidazole_given', v: true, s, e: s + m[1].length });
        const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('metronidazole_given_at', d, m));
      }
      if (/[Пп]ервичная схема/.test(m[0])) {
        const set = drugs.slice().sort().join('+');
        const v = set === 'бензилпенициллин+гентамицин' ? 'benzylpenicillin+gentamicin' : set === 'ампициллин+гентамицин' ? 'ampicillin+gentamicin' : 'другое';
        r.push({ f: 'initial_empirical_regimen', v, s: L0 }, { f: 'empirical_regimen', v, s: L0 });
      }
      return r;
    }
    if (kind === 'benzyl') {
      const r = [{ f: 'benzylpenicillin_given', v: true }, { f: 'benzylpenicillin_interval_h', v: +m[5], s: L0 + m[0].lastIndexOf('каждые') }];
      if (m[2] === 'мг') r.push({ f: 'benzylpenicillin_dose_mg', v: num(m[1]), e: L0 + ('бензилпенициллин ' + m[1] + ' мг').length });
      const sk = L0 + m[0].indexOf('(');
      if (m[4] === 'мг/кг') r.push({ f: 'benzylpenicillin_dose_mg_kg', v: num(m[3]), s: sk, e: sk + m[3].length + 7 });
      if (m[4] === 'ЕД/кг') r.push({ f: 'benzylpenicillin_dose_units_per_kg', v: num(m[3]), s: sk, e: sk + m[3].length + 7 });
      const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('benzylpenicillin_prescribed_at', d, m));
      // эмпирическая схема: бензилпенициллин и гентамицин назначены в одной и той же записи
      const g = /гентамицин (\d+(?:,\d+)?) мг/.exec(c.line.slice(m.index));
      if (g) { const e = m.index + g.index + g[0].length; r.push({ f: 'initial_empirical_regimen', v: 'benzylpenicillin+gentamicin', s: L0, e }, { f: 'empirical_regimen', v: 'benzylpenicillin+gentamicin', s: L0, e }); }
      return r;
    }
    if (kind === 'genta') {
      const r = [{ f: 'gentamicin_given', v: true }, { f: 'gentamicin_dose_mg', v: num(m[1]), e: L0 + ('гентамицин ' + m[1] + ' мг').length }];
      const sk = L0 + m[0].indexOf('(');
      r.push({ f: 'gentamicin_initial_dose_mg_kg', v: num(m[2]), s: sk, e: sk + m[2].length + 7 });
      if (m[3] || m[4]) r.push({ f: 'gentamicin_interval_h', v: +(m[3] || m[4]), s: L0 + m[0].search(/каждые|вторая доза/) });
      const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('gentamicin_prescribed_at', d, m));
      return r;
    }
    if (kind === 'surgeon') {
      const r = [{ f: 'surgeon_consult_status', v: 'done' }, { f: 'surgeon_consult_format', v: m[1] === 'очная' ? 'in_person' : 'remote' }];
      const d = eventDT(c.line, m.index, c.tz); if (d) r.push(atField('surgeon_consult_at', d, m));
      const s = L0 + m[0].lastIndexOf(m[3]);
      r.push({ f: /показано/.test(m[3]) ? 'surgeon_conclusion' : 'surgeon_recommendations', v: m[3], s, e: s + m[3].length });
      return r;
    }
    if (kind === 'passage_false' || kind === 'passage_true') {
      const v = kind === 'passage_true';
      const d = eventDT(c.line, m.index, c.tz), dd = d ? null : eventDateOnly(c.line, m.index);
      const obs = { v, at: d ? d.value : null, date: d ? d.value.slice(0, 10) : dd ? dd.date : null };
      const r = [{ f: 'gi_passage_restored', obs, s: d ? Math.min(d.index, m.index) : dd ? dd.index : m.index, e: d ? Math.max(d.end, m.index + m[0].length) : m.index + m[0].length }];
      if (v && d) r.push(atField('gi_passage_restored_at', d, m));
      return r;
    }
    return [];
  }

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
    const hits = [];
    for (const rec of records(text)) {
      const line = rec.line;
      for (const rule of RULES) {
        if (rule.when && !rule.when(line, text)) continue;
        rule.re.lastIndex = 0; let m;
        while ((m = rule.re.exec(line))) {
          const out = rule.special ? special(rule.special, m, { line, tz }) : rule.emit(m, { line, tz });
          for (const o of out) {
            const s = rec.start + (o.s !== undefined ? o.s : m.index);
            const e = rec.start + (o.e !== undefined ? o.e : m.index + m[0].length);
            hits.push(Object.assign({}, o, { start: s, end: Math.max(e, s + 1), list: rule.list || null }));
          }
          if (m[0].length === 0) rule.re.lastIndex++;
        }
      }
    }
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
