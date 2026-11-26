// ТЕХНИЧЕСКАЯ СИМУЛЯЦИЯ для тестов: «врач» явно подтверждает время записи как время события.
// Это не доказательство фактической корректности этих времён (ревью цикла 16:30, issue #10) — только способ проверить,
// что при явном подтверждении путь до движка не искажает значения. У списка — поэлементно: индекс, точное время
// элемента и основание для каждого элемента, а не одно основание на весь список.
'use strict';
const CB = require('../../case-builder.js');
function confirmOpts(it, reason) {
  const r = CB.riskyElems(it.candidate);
  if (r.length) return { items: r.map(e => ({ index: e.index, at: e.at, timeIsEvent: true, basisReason: reason + ' — элемент №' + (e.index + 1) + ' «' + (e.fragment || '') + '»' })) };
  return { timeIsEvent: true, basisReason: reason };
}
module.exports = { confirmOpts };
