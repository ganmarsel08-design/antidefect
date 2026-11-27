// Этап 8, issue #10 п.6 — газы крови, ИВЛ/FiO2 по времени, рентгенограммы из таблиц. Только синтетические данные.
// Контракт после ревью ChatGPT к 2177b19 (блокеры 1–6).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../extract/extract.js');
const ex = t => X.extract(t, { tz: '+05:00' });
const cand = (t, f) => ex(t).candidates.find(c => c.field === f);
const okFr = t => { for (const c of ex(t).candidates) for (const f of c.fragments || []) assert.equal(t.slice(f.start, f.end), f.text); };

const KOS_ART = 'Газы артериальной крови\nВремя забора | pH | pCO2, мм рт. ст. | BE\n14.01.2026 08:00 | 7,31 | 52 | -4\n14.01.2026 14:00 | 7.38 | 41 | -2';
test('1. газы крови: явная единица мм рт. ст. и явный артериальный источник; «время забора» — event_time; десятичная точка', () => {
  const c = cand(KOS_ART, 'blood_gases');
  assert.deepEqual(c.value, [{ drawn_at: '2026-01-14T08:00+05:00', ph: 7.31, paco2_mmhg: 52 }, { drawn_at: '2026-01-14T14:00+05:00', ph: 7.38, paco2_mmhg: 41 }]);
  assert.deepEqual(c.time_basis_items.map(x => x.time_basis), ['event_time', 'event_time']);
  okFr(KOS_ART);
});
test('1. венозная, капиллярная, неуказанный источник, без единицы, кПа — не PaCO2', () => {
  assert.equal(cand('Венозная кровь\nДата/время | pH | pCO2\n14.01.2026 08:00 | 7,31 | 52', 'blood_gases'), undefined, 'контрпример ревью');
  assert.equal(cand('Капиллярная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52', 'blood_gases'), undefined);
  assert.equal(cand('КОС\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52', 'blood_gases'), undefined, 'источник не указан');
  assert.equal(cand('Артериальная кровь\nВремя забора | pH | pCO2\n14.01.2026 08:00 | 7,31 | 52', 'blood_gases'), undefined, 'единица не указана');
  assert.equal(cand('Артериальная кровь\nВремя забора | pH | pCO2, кПа\n14.01.2026 08:00 | 7,31 | 6,9', 'blood_gases'), undefined);
  // проба в строке: артериальная — да, венозная — нет
  const t = 'КОС\nВремя забора | Проба | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | артериальная | 7,31 | 52\n14.01.2026 10:00 | венозная | 7,28 | 58';
  assert.deepEqual(cand(t, 'blood_gases').value, [{ drawn_at: '2026-01-14T08:00+05:00', ph: 7.31, paco2_mmhg: 52 }]);
});
test('1. новых физиологических порогов нет: значение передаётся как записано (только с поэлементным подтверждением)', () => {
  const c = cand('Артериальная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 6,85 | 160', 'blood_gases');
  assert.deepEqual(c.value, [{ drawn_at: '2026-01-14T08:00+05:00', ph: 6.85, paco2_mmhg: 160 }], 'критическое значение не скрыто');
  // табличный элемент подтверждается отдельно, даже если тип времени — event_time (блокер 5)
  const CB = require('../case-builder.js');
  const s = CB.createSession({ extraction: ex('Артериальная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 6,85 | 160'), actor: 'т', now: () => 't' });
  const it = s.items.find(i => i.candidate.field === 'blood_gases');
  assert.ok(CB.needsTimeConfirm(it));
  assert.throws(() => CB.confirm(s, it.candidate.id), /поэлементно/);
  assert.deepEqual(CB.confirmGroup(s, it.candidate.group).skipped.includes(it.candidate.id), true);
  assert.ok(!('blood_gases' in CB.build(s).case.data));
});
test('2. смысл колонки времени: общая «Дата/время» → unknown; «время результата» не подменяет время забора', () => {
  const g = cand('Артериальная кровь\nДата/время | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52', 'blood_gases');
  assert.deepEqual(g.time_basis_items.map(x => x.time_basis), ['unknown']);
  assert.equal(cand('Артериальная кровь\nВремя результата | pH | pCO2, мм рт. ст.\n14.01.2026 08:40 | 7,31 | 52', 'blood_gases'), undefined);
  const x = cand('Рентгенография\nДата/время | Исследование | Положение\n02.05.2026 09:30 | Рентгенография ОБП | горизонтально', 'xrays');
  assert.deepEqual(x.time_basis_items.map(e => e.time_basis), ['unknown']);
  const y = cand('Рентгенография\nВремя исследования | Исследование | Положение\n02.05.2026 09:30 | Рентгенография ОБП | горизонтально', 'xrays');
  assert.deepEqual(y.time_basis_items.map(e => e.time_basis), ['event_time']);
});
test('строка без времени, скопированная, неполная — не извлекаются', () => {
  const H = 'Артериальная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n';
  assert.equal(cand(H + '14.01.2026 | 7,31 | 52', 'blood_gases'), undefined);
  assert.equal(cand(H + '14.01.2026 08:00 (скопировано) | 7,31 | 52', 'blood_gases'), undefined);
  assert.equal(cand(H + '14.01.2026 08:00 | 7,31 |', 'blood_gases'), undefined, 'пустая ячейка');
  assert.equal(cand(H + '14.01.2026 08:00 | 7,31', 'blood_gases'), undefined, 'меньше ячеек');
});

const IVL = 'ИВЛ\nДата/время | Режим | PIP | PEEP | FiO2 | ЧД\n14.01.2026 08:00 | SIMV | 20 | 6 | 0,40 | 50\n14.01.2026 14:00 | SIMV | 18 | 6 | 0,30 | 50\n15.01.2026 08:00 | SIMV | 18 | 5 | 0,30 | 45';
test('3. ИВЛ: разница строк НЕ передаётся в vent_changes; изменение — между наблюдениями, с обеими цитатами и интервалом', () => {
  const e = ex(IVL);
  assert.equal(e.candidates.find(c => c.field === 'vent_changes'), undefined, 'время действия врача неизвестно');
  const ch = e.table_observations.changes;
  const pip = ch.find(x => x.parameter === 'PIP');
  assert.deepEqual(pip.between, ['2026-01-14T08:00+05:00', '2026-01-14T14:00+05:00']);
  assert.equal(pip.from, '20'); assert.equal(pip.to, '18'); assert.match(pip.note, /время действия врача неизвестно/);
  assert.deepEqual(pip.fragments.map(f => IVL.slice(f.start, f.end)), ['14.01.2026 08:00 | SIMV | 20 | 6 | 0,40 | 50', '14.01.2026 14:00 | SIMV | 18 | 6 | 0,30 | 50']);
  assert.equal(e.table_observations.observations.length, 3);
  assert.ok(e.table_observations.observations.every(o => o.time_basis === 'unknown'));
});
test('3. не сравнивать через пропуск, копию, обратное время, смену режима', () => {
  const H = 'ИВЛ\nДата/время | Режим | PIP\n';
  const ch = t => ex(H + t).table_observations.changes.map(x => [x.from, x.to]);
  assert.deepEqual(ch('14.01.2026 08:00 | SIMV | 20\n14.01.2026 10:00 (скопировано) | SIMV | 19\n14.01.2026 14:00 | SIMV | 18'), [], 'копия между строками');
  assert.deepEqual(ch('14.01.2026 08:00 | SIMV | 20\n14.01.2026 | SIMV | 19\n14.01.2026 14:00 | SIMV | 18'), [], 'строка без времени между');
  assert.deepEqual(ch('14.01.2026 14:00 | SIMV | 20\n14.01.2026 08:00 | SIMV | 18'), [], 'обратное время');
  assert.deepEqual(ch('14.01.2026 08:00 | SIMV | 20\n14.01.2026 14:00 | HFOV | 18'), [], 'смена режима');
  assert.deepEqual(ch('14.01.2026 08:00 | SIMV | 20\n14.01.2026 14:00 | SIMV | 18'), [['20', '18']]);
});
test('3. extract → case → derive → RDS-010: изменение по разнице строк не даёт ложного вывода о реакции врача', () => {
  const CB = require('../case-builder.js'), Derive = require('../derive.js'), SIM = require('./tools/time-confirm-sim.js');
  const RE = require('../rules-engine.js'), db = require('../../rules/pilot-rules.json');
  const text = 'Газы артериальной крови\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,52 | 28\n' + IVL.replace('ИВЛ\n', '\nИВЛ\n');
  const s = CB.createSession({ extraction: ex(text), actor: 'т', now: () => 't' });
  for (const it of s.items) if (it.status === CB.STATUS.NEW) CB.confirm(s, it.candidate.id, CB.needsTimeConfirm(it) ? SIM.confirmOpts(it, 'симуляция') : undefined);
  const b = CB.build(s), data = b.case.data;
  assert.ok(!('vent_changes' in data), 'изменения по разнице строк в случай не входят');
  assert.equal(data.blood_gases.length, 1);
  const V = require('../expert-view.js');
  const env = { RulesEngine: RE, Derive, db, expertDecisions: require('../../rules/expert-decisions.json') };
  const r = V.view(env, b, ['РДС']).rules.find(x => x.rule_id === 'RDS-010');
  assert.ok(r, 'RDS-010 оценено');
  assert.ok(!/совпадает/.test(r.label), 'нет ложного «совпадает» по реакции врача: ' + r.label);
});

test('6. FiO2 по времени — наблюдение вне словаря, как записано (в т. ч. %), fio2 стабилизации не заполняется', () => {
  const e = ex('Дата/время | FiO2, %\n14.01.2026 08:00 | 40\n14.01.2026 14:00 | 30');
  assert.equal(e.candidates.find(c => c.field === 'fio2'), undefined);
  assert.equal(e.candidates.find(c => c.field === 'vent_changes'), undefined);
  assert.deepEqual(e.table_observations.observations.map(o => [o.at, o.values.FiO2.written, o.values.FiO2.unit]), [['2026-01-14T08:00+05:00', '40', '%'], ['2026-01-14T14:00+05:00', '30', '%']]);
  assert.deepEqual(e.table_observations.changes.map(c => [c.parameter, c.from, c.to, c.unit]), [['FiO2', '40', '30', '%']]);
});

const RG = 'Рентгенография\nВремя исследования | Исследование | Положение | Показание | Заключение\n02.05.2026 09:30 | Рентгенография ОБП | горизонтально | экстренно | пневматоз кишечника\n04.05.2026 09:00 | Рентгенография ОБП | вертикально | контроль | свободного газа нет';
test('4. рентгенограммы: время, положение, показание, заключение', () => {
  assert.deepEqual(cand(RG, 'xrays').value, [
    { at: '2026-05-02T09:30+05:00', position: 'horizontal', reason: 'urgent', result: 'пневматоз кишечника' },
    { at: '2026-05-04T09:00+05:00', position: 'vertical', reason: 'planned', result: 'свободного газа нет' }]);
});
test('4. модальность и статус: УЗИ/КТ — не рентген; план — не факт; отрицания положения и срочности', () => {
  const H = 'Исследования\nВремя исследования | Исследование | Положение | Показание | Заключение\n';
  assert.equal(cand(H + '02.05.2026 09:30 | УЗИ брюшной полости | лёжа | экстренно | свободной жидкости нет', 'xrays'), undefined);
  assert.equal(cand(H + '02.05.2026 09:30 | КТ брюшной полости | лёжа | экстренно | без патологии', 'xrays'), undefined);
  assert.equal(cand(H + '02.05.2026 09:30 | УЗИ ОБП | лёжа | экстренно | рентгенография не требуется', 'xrays'), undefined, 'слово в заключении не делает УЗИ рентгеном');
  assert.equal(cand(H + '02.05.2026 09:30 | Рентгенография ОБП (планируется) | вертикально | контроль | —', 'xrays'), undefined);
  assert.equal(cand(H + '02.05.2026 09:30 | Рентгенография ОБП | вертикально | контроль | не выполнено', 'xrays'), undefined);
  const v = cand(H + '02.05.2026 09:30 | Рентгенография ОБП | не вертикально | не экстренно | газ в портальной вене', 'xrays').value[0];
  assert.equal(v.position, null); assert.equal(v.reason, null);
});

test('6. повтор колонки — таблица не разбирается, предупреждение', () => {
  const e = ex('Артериальная кровь\nВремя забора | pH | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 7,35 | 52');
  assert.equal(e.candidates.find(c => c.field === 'blood_gases'), undefined);
  assert.ok(e.warnings.some(w => /повторяется колонка ph/.test(w)), e.warnings.join());
});
test('6. таблица без колонки времени или без узнаваемых колонок не разбирается', () => {
  assert.equal(cand('Препарат | Доза\nГентамицин | 6 мг', 'blood_gases'), undefined);
  assert.equal(cand('Дата | Мероприятие\n14.01.2026 08:00 | Осмотр', 'xrays'), undefined);
});
test('6. таблица из DOCX (ячейки через « | ») разбирается так же', async () => {
  const D = require('../extract/docx.js');
  const p = t => '<w:p><w:r><w:t>' + t + '</w:t></w:r></w:p>';
  const row = cs => '<w:tr>' + cs.map(c => '<w:tc>' + p(c) + '</w:tc>').join('') + '</w:tr>';
  const xml = '<w:document><w:body>' + p('Газы артериальной крови') + '<w:tbl>' + row(['Время забора', 'pH', 'pCO2, мм рт. ст.']) + row(['14.01.2026 08:00', '7,31', '52']) + '</w:tbl></w:body></w:document>';
  const r = D.documentXmlToText(xml);
  const c = cand(r.text || r.lines.join('\n'), 'blood_gases');
  assert.deepEqual(c.value, [{ drawn_at: '2026-01-14T08:00+05:00', ph: 7.31, paco2_mmhg: 52 }]);
});

test('5. поэлементный выбор/отклонение: отклонённый элемент не передаётся; причина и цитата в источнике и журнале', () => {
  const CB = require('../case-builder.js');
  const s = CB.createSession({ extraction: ex(KOS_ART), actor: 'т', now: () => 't' });
  const it = s.items.find(i => i.candidate.field === 'blood_gases');
  const [a, b] = CB.riskyElems(it.candidate);
  assert.ok(a.from_table && b.from_table);
  const okA = { index: 0, at: a.at, timeIsEvent: true, basisReason: 'лист КОС 08:00' };
  assert.throws(() => CB.confirm(s, it.candidate.id, { items: [okA, { index: 1, at: b.at, reject: true, reason: '  ' }] }), /причина отклонения/);
  assert.throws(() => CB.confirm(s, it.candidate.id, { items: [okA, { index: 1, at: a.at, reject: true, reason: 'x' }] }), /не совпадает/);
  assert.throws(() => CB.confirm(s, it.candidate.id, { items: [{ index: 0, at: a.at, reject: true, reason: 'x' }, { index: 1, at: b.at, reject: true, reason: 'y' }] }), /отклонены все/);
  assert.throws(() => CB.confirm(s, it.candidate.id, { items: [okA, { index: 0, at: a.at, reject: true, reason: 'x' }, { index: 1, at: b.at, timeIsEvent: true, basisReason: 'y' }] }), /одновременно/);
  CB.confirm(s, it.candidate.id, { items: [okA, { index: 1, at: b.at, reject: true, reason: 'проба венозная по журналу' }] });
  const bl = CB.build(s);
  assert.deepEqual(bl.case.data.blood_gases, [{ drawn_at: '2026-01-14T08:00+05:00', ph: 7.31, paco2_mmhg: 52 }]);
  const src = bl.case.sources.blood_gases;
  assert.deepEqual(src.excluded_elements.map(x => [x.index, x.reason]), [[1, 'проба венозная по журналу']]);
  assert.equal(src.excluded_elements[0].fragment, KOS_ART.slice(src.excluded_elements[0].start, src.excluded_elements[0].start + src.excluded_elements[0].fragment.length));
  assert.deepEqual(src.time_basis_items.map(x => [x.index, x.time_confirmation || null, x.rejected || null]), [[0, 'лист КОС 08:00', null], [1, null, 'проба венозная по журналу']]);
  assert.deepEqual(s.journal.at(-1).time_confirmation, [{ index: 0, at: a.at, reason: 'лист КОС 08:00' }, { index: 1, at: b.at, rejected: true, reason: 'проба венозная по журналу' }]);
});

// ревью c963363: источник пробы, плановые/отменённые строки
const bgT = t => X.extract(t, { tz: '+05:00' }).candidates.filter(c => c.field === 'blood_gases');
const xrT = t => X.extract(t, { tz: '+05:00' }).candidates.filter(c => c.field === 'xrays');
test('ревью c963363 №1: неартериальная/смешанная/противоречивая проба не попадает в paco2_mmhg', () => {
  const H = 'Время забора | Проба | pH | pCO2, мм рт. ст.\n';
  assert.equal(bgT('Артериальная кровь\n' + H + '14.01.2026 08:00 | смешанная | 7,31 | 52').length, 0, 'смешанная проба при артериальной подписи');
  assert.equal(bgT('Артериальная кровь\n' + H + '14.01.2026 08:00 | неизвестно | 7,31 | 52').length, 0);
  assert.equal(bgT('Не артериальная, венозная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52').length, 0, '«не артериальная»');
  assert.equal(bgT('Артериальная и венозная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52').length, 0, 'противоречие');
  assert.equal(bgT('Проба | Время | pH | pCO2, мм рт. ст.\n\nВенозная кровь (другая таблица) | x\n' + H + '14.01.2026 08:00 | | 7,31 | 52').length, 0, 'чужая подпись не наследуется');
  // положительный контроль
  assert.equal(bgT('Артериальная кровь\nВремя забора | pH | pCO2, мм рт. ст.\n14.01.2026 08:00 | 7,31 | 52').length, 1);
  assert.equal(bgT(H + '14.01.2026 08:00 | артериальная | 7,31 | 52').length, 1);
});
test('ревью c963363 №2: отменённое/не проведённое/отложенное/пустое заключение/план — не xrays', () => {
  const H = 'Время исследования | Исследование | Заключение\n';
  for (const z of ['отменена', 'не проводилась', 'отложена', '']) assert.equal(xrT(H + '14.01.2026 08:00 | Рентгенография ОБП | ' + z).length, 0, z || '(пусто)');
  assert.equal(xrT('План обследования\n' + H + '14.01.2026 08:00 | Рентгенография ОБП | свободный газ не выявлен').length, 0);
  assert.equal(xrT(H + '14.01.2026 08:00 | Рентгенография ОБП | свободный газ не выявлен').length, 1, 'положительный контроль');
});

test('газы крови: сомнение или непригодность пробы/результата в строке — не артериальная проба (самостоятельный поиск ошибок 27.11)', () => {
  const H = 'КОС\nВремя забора | Проба | pH | pCO2, мм рт. ст.\n';
  assert.ok(cand(H + '14.01.2026 08:00 | артериальная | 7,31 | 52', 'blood_gases'), 'положительный контроль');
  for (const row of ['14.01.2026 08:00 | артериальная? | 7,31 | 52',
                     '14.01.2026 08:00 | предположительно артериальная | 7,31 | 52',
                     '14.01.2026 08:00 | артериальная (уточнить) | 7,31 | 52',
                     '14.01.2026 08:00 | артериальная (гемолиз, недостоверно) | 7,31 | 52',
                     '14.01.2026 08:00 | артериальная, результат ошибочный | 7,31 | 52']) {
    assert.equal(cand(H + row, 'blood_gases'), undefined, row);
  }
  // сомнительная строка исключается, соседняя пригодная остаётся
  const t = H + '14.01.2026 08:00 | артериальная (гемолиз) | 7,31 | 52\n14.01.2026 10:00 | артериальная | 7,28 | 58';
  assert.deepEqual(cand(t, 'blood_gases').value, [{ drawn_at: '2026-01-14T10:00+05:00', ph: 7.28, paco2_mmhg: 58 }]);
  // сомнение в столбце результата (без столбца пробы, источник из подписи)
  assert.equal(cand('Артериальная кровь\nВремя забора | pH | pCO2, мм рт. ст. | Примечание\n14.01.2026 08:00 | 7,31 | 52 | результат недостоверен', 'blood_gases'), undefined);
});
