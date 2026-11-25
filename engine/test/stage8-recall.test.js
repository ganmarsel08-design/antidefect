// Этап 8 — полнота извлечения на обобщённых формулировках и защиты от ловушек.
// Тексты придуманы заново (не из слепого набора №1). Только синтетические данные.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const TZ = '+05:00';
const run = t => X.extract(t, { tz: TZ });
const val = (t, f) => { const c = run(t).candidates.find(x => x.field === f); return c ? (c.value !== undefined ? c.value : { alternatives: c.alternatives.map(a => a.value) }) : undefined; };
const fragmentsOk = t => { for (const c of run(t).candidates) for (const f of c.fragments || []) assert.equal(t.slice(f.start, f.end), f.text, c.field); };

test('срок гестации и масса: сокращения и разные обороты', () => {
  assert.equal(val('Мальчик, ГВ 33 нед, масса 1,92 кг.', 'gestational_age_weeks'), 33);
  assert.equal(val('Мальчик, ГВ 33 нед, масса 1,92 кг.', 'weight_kg'), 1.92);
  assert.equal(val('Роды на сроке 35 недель.', 'gestational_age_weeks'), 35);
  assert.equal(val('Вес при поступлении 2,05 кг.', 'weight_kg'), 2.05);
  assert.equal(val('Масса при рождении 2450 г (2,45 кг).', 'weight_kg'), 2.45);
  assert.equal(val('Постнатальный возраст 4 суток.', 'postnatal_age_days'), 4);
  assert.equal(val('Областная больница 2 уровня.', 'facility_level'), 2);
});

test('мать и другой ребёнок не дают сведений о пациенте', () => {
  assert.equal(val('У матери предыдущие роды на сроке 30 недель.', 'gestational_age_weeks'), undefined);
  assert.equal(val('Для справки: у второго ребёнка из двойни масса 1,40 кг.', 'weight_kg'), undefined);
  assert.equal(val('Матери в родах введена первая доза антибиотиков: ампициллин + гентамицин.', 'abx_regimen'), undefined);
});

test('родзал: стероиды, пуповина, CPAP с латиницей и кириллицей, давление, смеситель, SpO2', () => {
  const t = 'Родильный зал\nМатери проведена антенатальная стероидная профилактика. Пуповина пережата через 45 сек. ' +
    'С момента рождения начат CPАР с давлением 5 см H2O, кислород через смеситель, стартовая FiO2 0,25. Целевая SpO2 91–95%.';
  assert.equal(val(t, 'antenatal_steroids_given'), true);
  assert.equal(val(t, 'cord_clamp_delay_s'), 45);
  assert.equal(val(t, 'cpap_from_birth'), true);
  assert.equal(val(t, 'cpap_pressure_cmh2o'), 5);
  assert.equal(val(t, 'oxygen_via_blender'), true);
  assert.equal(val(t, 'fio2'), 0.25);
  assert.equal(val(t, 'spo2_target_low'), 91);
  assert.equal(val(t, 'spo2_target_high'), 95);
  fragmentsOk(t);
});

test('отрицания дают «нет», «не указано» — ничего', () => {
  assert.equal(val('Антенатальные стероиды не проводились.', 'antenatal_steroids_given'), false);
  assert.equal(val('Интубация не выполнялась.', 'intubated'), false);
  assert.equal(val('ИВЛ не проводилась.', 'mechanical_ventilation'), false);
  assert.equal(val('Смеситель не использовался.', 'oxygen_via_blender'), false);
  assert.equal(val('Кислород подавался, способ подачи не указан.', 'oxygen_via_blender'), undefined);
  assert.equal(val('Стероиды антенатально — сведений нет.', 'antenatal_steroids_given'), undefined);
  assert.equal(val('Метронидазол не назначался.', 'metronidazole_given'), false);
});

test('план и условие не становятся выполненным действием', () => {
  assert.equal(val('При ухудшении планируется введение сурфактанта.', 'surfactant_given'), undefined);
  assert.equal(val('При сохранении тахипноэ — перевести на ИВЛ.', 'mechanical_ventilation'), undefined);
  assert.equal(val('Решить вопрос о переводе в отделение хирургии.', 'transferred_to_surgery'), undefined);
  assert.equal(val('При нормализации пассажа планируется возобновление кормления.', 'enteral_feeding_resumed_at'), undefined);
});

test('сурфактант: препарат, место, доза мг/кг', () => {
  const t = 'В родзале введён Куросурф 200 мг/кг.';
  assert.equal(val(t, 'surfactant_given'), true);
  assert.equal(val(t, 'surfactant_drug'), 'Куросурф');
  assert.equal(val(t, 'surfactant_in_delivery_room'), true);
  assert.equal(val(t, 'surfactant_initial_dose_mg_kg'), 200);
  assert.equal(val('Введён порактант альфа 2,5 мл уже в ОРИТН.', 'surfactant_in_delivery_room'), false);
  assert.equal(val('Введён порактант альфа 2,5 мл уже в ОРИТН.', 'surfactant_initial_dose_mg_kg'), undefined, 'мл не пересчитываются в мг/кг');
});

test('антибиотики: первая доза, схема, доза и интервал из строки и из таблицы', () => {
  const t = 'Дневник 05.03.2026\n09:10 — Выявлено показание к АБТ. В 09:20 взят посев крови из отдельной вены (1,0 мл). ' +
    'В 09:40 введена первая доза эмпирической АБТ: ампициллин 100 мг в/в каждые 12 ч + гентамицин 8 мг в/в каждые 36 ч.\n' +
    'Препарат | Доза | Интервал\nГентамицин | 8 мг в/в | каждые 36 ч';
  assert.equal(val(t, 'sepsis_indication_identified_at'), '2026-03-05T09:10+05:00');
  assert.equal(val(t, 'blood_culture_drawn_at'), '2026-03-05T09:20+05:00');
  assert.equal(val(t, 'sample_site'), 'separate_vein');
  assert.equal(val(t, 'sample_volume_ml'), 1);
  assert.equal(val(t, 'first_abx_dose_administered_at'), '2026-03-05T09:40+05:00');
  assert.equal(val(t, 'abx_course_started_at'), '2026-03-05T09:40+05:00');
  assert.deepEqual(val(t, 'abx_regimen'), ['ампициллин', 'гентамицин']);
  assert.equal(val(t, 'initial_empirical_regimen'), 'ampicillin+gentamicin');
  assert.equal(val(t, 'gentamicin_dose_mg'), 8);
  assert.equal(val(t, 'gentamicin_interval_h'), 36);
  fragmentsOk(t);
});

test('доза без единицы или в других единицах не извлекается и не пересчитывается', () => {
  assert.equal(val('Гентамицин: гента 6 в/в.', 'gentamicin_dose_mg'), undefined);
  assert.equal(val('Гентамицин 6000 мкг в/в.', 'gentamicin_dose_mg'), undefined);
  assert.equal(val('БП 50 000 ЕД/кг в/в каждые 12 ч.', 'benzylpenicillin_dose_mg'), undefined);
  assert.equal(val('БП 50 000 ЕД/кг в/в каждые 12 ч.', 'benzylpenicillin_dose_units_per_kg'), 50000);
  assert.equal(val('БП 50 000 ЕД/кг в/в каждые 12 ч.', 'benzylpenicillin_interval_h'), 12);
});

test('интервал одного препарата не переходит к другому', () => {
  const t = 'Введена первая доза АБТ: бензилпенициллин 90 мг в/в каждые 12 ч + гентамицин 9 мг в/в.';
  assert.equal(val(t, 'benzylpenicillin_interval_h'), 12);
  assert.equal(val(t, 'gentamicin_interval_h'), undefined);
});

test('исправленная запись: ошибочное значение убирается, верное остаётся', () => {
  const t = 'Родзал\nНачальная FiO2 0,40.\n06.04.2026 10:00 — Исправленному верить: ошибочно указано FiO2 0,40, верно 0,30.';
  assert.equal(val(t, 'fio2'), 0.3);
  const s = '07.04.2026 09:00 — Подозрение на НЭК 1б.\n08.04.2026 08:00 — Ошибочно указано стадия 1б, верно стадия 2а.';
  assert.equal(val(s, 'nec_stage'), '2а');
});

test('скопированная запись не даёт значений', () => {
  const t = 'Родзал\nСтартовая FiO2 0,30.\n09.04.2026 09:00 — (скопировано из дневника 07.04): FiO2 0,45, фактически дышит воздухом.';
  assert.equal(val(t, 'fio2'), 0.3);
});

test('посев крови: результат, время получения результата, возбудитель', () => {
  const t = '12.04.2026 11:00 — Посев крови положительный (получен 12.04.2026 10:20): Klebsiella pneumoniae.';
  assert.equal(val(t, 'blood_culture_result'), 'положительный');
  assert.equal(val(t, 'culture_result_at'), '2026-04-12T10:20+05:00');
  const u = '12.04.2026 11:00 — Посев крови положительный: Klebsiella pneumoniae.';
  assert.equal(val(u, 'pathogen'), 'Klebsiella pneumoniae');
  assert.equal(val(u, 'gram_negative_culture'), true);
  assert.equal(val(u, 'culture_result_at'), undefined, 'время записи не выдаётся за время получения результата');
  assert.equal(val('Получен предварительный отрицательный посев крови.', 'blood_culture_result'), undefined);
});

test('СРБ: исходный и контрольный, отказ — без значения', () => {
  const t = '05.03.2026 09:20 — Исходный СРБ взят.\n06.03.2026 05:30 — Контрольный СРБ: 6 мг/л.\nКонтрольный СРБ через 48 ч не выполнялся.';
  assert.deepEqual(val(t, 'crp_samples'), [{ drawn_at: '2026-03-05T09:20+05:00', purpose: 'baseline' }, { drawn_at: '2026-03-06T05:30+05:00', purpose: 'control' }]);
});

test('НЭК: подозрение, начало, прекращение кормления, зонд, катетеры, стадия, хирург, перевод', () => {
  const t = 'Эпизод (10.06.2026)\n' +
    '06:40 — На фоне энтерального кормления вздутие живота. В 06:40 выставлено подозрение на НЭК (время начала заболевания 10.06.2026 06:30).\n' +
    '06:50 — Кормление прекращено. Установлен НГЗ №8 F. Стоял ПВК, ПАК не стоял. В 07:05 ПВК удалён.\n' +
    '08:00 — Диагноз НЭК подтверждён, стадия 2б. Проведена дистанционная консультация детского хирурга. Выполнен перевод в отделение неонатальной хирургии.';
  assert.equal(val(t, 'nec_suspected_at'), '2026-06-10T06:40+05:00');
  assert.equal(val(t, 'nec_onset_at'), '2026-06-10T06:30+05:00');
  assert.equal(val(t, 'feeding_at_nec_suspicion'), 'active');
  assert.equal(val(t, 'enteral_feeding_stopped_at'), '2026-06-10T06:50+05:00');
  assert.equal(val(t, 'ng_tube_placed'), true);
  assert.equal(val(t, 'ng_tube_size_f'), 8);
  assert.equal(val(t, 'uvc_present'), true);
  assert.equal(val(t, 'uac_present'), false);
  assert.equal(val(t, 'uvc_removed_at'), '2026-06-10T07:05+05:00');
  assert.equal(val(t, 'nec_stage'), '2б');
  assert.equal(val(t, 'nec_confirmed_at'), '2026-06-10T08:00+05:00');
  assert.equal(val(t, 'surgeon_consult_format'), 'remote');
  assert.equal(val(t, 'transferred_to_surgery'), true);
  fragmentsOk(t);
});

test('НЭК: «несмотря на подозрение», отказ от зонда, кормление не прекращено', () => {
  const t = '10:00 — Несмотря на подозрение на НЭК, кормление не отменено, зонд не устанавливался.';
  assert.equal(val(t, 'enteral_feeding_stopped'), undefined);
  assert.equal(val(t, 'ng_tube_placed'), undefined);
  assert.equal(val(t, 'nec_suspected_at'), undefined);
});

test('пассаж: динамика «не восстановлен» → «восстановлен» с собственным временем', () => {
  const t = '05.06.2026 10:00 — Пассаж по ЖКТ ещё не восстановлен.\n08.06.2026 09:00 — Осмотр. Пассаж восстановлен 08.06.2026 в 08:30.';
  const c = run(t).candidates.find(x => x.field === 'gi_passage_restored');
  assert.deepEqual(c.timeline.map(x => [x.v, x.at]), [[false, '2026-06-05T10:00+05:00'], [true, '2026-06-08T08:30+05:00']]);
  assert.equal(val(t, 'gi_passage_restored_at'), '2026-06-08T08:30+05:00');
});

test('время записи раньше заголовка в пределах нескольких часов — та же дата; через полночь — нет', () => {
  assert.equal(val('Дневник 14.01.2026\n07:00 — Масса 1,30 кг (взвешен в 06:50).', 'weight_measured_at'), '2026-01-14T06:50+05:00');
  assert.equal(val('14.01.2026 23:50 — Масса 1,30 кг (взвешен в 00:10).', 'weight_measured_at'), undefined);
});

test('время в скобках относится к тому, что в скобках', () => {
  const t = '06.08.2026 10:30 — Посев крови отрицательный (результат получен 06.08.2026 в 09:45), ТБИ исключена.';
  assert.equal(val(t, 'culture_result_at'), '2026-08-06T09:45+05:00');
  assert.equal(val(t, 'sbi_excluded_at'), '2026-08-06T10:30+05:00');
});

// Ревью ChatGPT к PR №13: план и отказ ≠ назначение; *_given в словаре — «назначен / включён в терапию».
test('план, отказ и «фактически не вводился» не дают *_given', () => {
  assert.equal(val('14.01.2026 07:30 — Планируется гентамицин 6 мг в/в каждые 36 ч.', 'gentamicin_given'), undefined);
  assert.equal(val('14.01.2026 07:30 — Планируется гентамицин 6 мг в/в каждые 36 ч.', 'gentamicin_dose_mg'), undefined);
  assert.equal(val('14.01.2026 07:30 — Назначен гентамицин 6 мг в/в каждые 36 ч. Фактически не вводился.', 'gentamicin_given'), undefined);
  assert.equal(val('14.01.2026 07:30 — Гентамицин не назначен, в старом листе указано 6 мг.', 'gentamicin_given'), undefined);
  assert.equal(val('14.01.2026 07:30 — Гентамицин не назначен, в старом листе указано 6 мг.', 'gentamicin_dose_mg'), undefined);
  assert.equal(val('При ухудшении — бензилпенициллин 90 мг в/в каждые 12 ч.', 'benzylpenicillin_given'), undefined);
  assert.equal(val('При появлении пневматоза — добавить метронидазол 7,5 мг в/в.', 'metronidazole_given'), undefined);
  assert.equal(val('Рассмотреть ампициллин + гентамицин + метронидазол.', 'metronidazole_given'), undefined);
});

test('прямое назначение или введение дают *_given', () => {
  assert.equal(val('14.01.2026 07:30 — Назначено: гентамицин 6 мг в/в каждые 36 ч.', 'gentamicin_given'), true);
  assert.equal(val('14.01.2026 07:40 — Введена первая доза АБТ: бензилпенициллин 90 мг в/в.', 'benzylpenicillin_given'), true);
  assert.equal(val('Начаты ампициллин + гентамицин + метронидазол.', 'metronidazole_given'), true);
  assert.equal(val('Дата | Препарат | Доза\n14.01.2026 | Гентамицин | 6 мг в/в каждые 36 ч', 'gentamicin_given'), true);
});

// Повторное ревью ChatGPT к PR №13.
test('«из периферической вены» не даёт separate_vein; «из отдельной вены» — даёт', () => {
  assert.equal(val('18.03.2026 00:25 — Кровь на посев взята из периферической вены.', 'sample_site'), undefined);
  assert.equal(val('18.03.2026 00:25 — Кровь на посев взята из отдельной периферической вены.', 'sample_site'), 'separate_vein');
});
test('иммуноглобулин: «назначен» и «назначен, фактически не вводился» не дают «введён»', () => {
  assert.equal(val('Иммуноглобулин назначен индивидуально.', 'immunoglobulin_given'), undefined);
  assert.equal(val('Иммуноглобулин назначен индивидуально.', 'immunoglobulin_use_type'), 'individualized');
  assert.equal(val('Иммуноглобулин назначен индивидуально, фактически не вводился.', 'immunoglobulin_given'), undefined);
  assert.equal(val('Введён иммуноглобулин человека нормальный.', 'immunoglobulin_given'), true);
  assert.equal(val('Иммуноглобулин не вводился.', 'immunoglobulin_given'), false);
});
test('время исключения ТБИ: время записи — только если исключение в первом предложении записи', () => {
  assert.equal(val('06.08.2026 10:30 — Посев крови отрицательный, ТБИ исключена.', 'sbi_excluded_at'), '2026-08-06T10:30+05:00');
  assert.equal(val('06.08.2026 10:30 — Пересмотр АБТ. Состояние стабильное, ТБИ исключена.', 'sbi_excluded_at'), undefined);
  assert.equal(val('06.08.2026 10:30 — Пересмотр АБТ. В 10:20 ТБИ исключена.', 'sbi_excluded_at'), '2026-08-06T10:20+05:00');
});
test('*_given антибиотиков помечены: «назначен», не подтверждение введения', () => {
  const c = run('Назначено: гентамицин 6 мг в/в каждые 36 ч.').candidates.find(x => x.field === 'gentamicin_given');
  assert.match(c.note, /назначен/); assert.match(c.note, /введения подтверждаются отдельно/);
});
