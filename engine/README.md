# Модуль «Отклонение от протокола + обоснование»

Этапы 1–3 ТЗ v0.5 (`docs/deviation-module-spec.md`): модель данных, независимые проверки, механизм статусов, подтверждения с происхождением, журнал решений эксперта и простой интерфейс аудита. Реестр протоколов и инструкций не подключён (этап 4). Тестовая версия: только синтетические данные.

- `deviation-engine.js` — модуль без зависимостей, без ИИ и без сети. В браузере доступен как `window.DeviationEngine`, в Node — через `require`.
- `audit.html` — интерфейс аудита. Открыть в браузере (рядом должен лежать `deviation-engine.js`). Кнопка «Загрузить синтетический пример» показывает весь сценарий.
- `test/deviation.test.js` — 34 синтетических случая и проверки порогов, подтверждений, полноты реестра, черновика, устаревания, валидации, журнала, неизменности входа (50 тестов).

## Запуск тестов

```
node --test engine/test/*.test.js
```

Нужен Node.js 18 или новее.

## Использование

```js
const r = DeviationEngine.evaluate(deviation, config);   // r.ok, r.status, r.headline, r.missing ...
const b = DeviationEngine.attestBibliographic({found, metadata_match, method: 'manual', checked_by});
const a = DeviationEngine.attestExpertAssessment({applicability, regimen_match, assessed_by});
const r2 = DeviationEngine.applyExpertOverride(r, {who, status, reason, source});
```

Все данные в тестах синтетические: препараты, дозы, диапазоны и цитаты вымышлены и не являются клиническими рекомендациями. Реальные данные пациентов не использовать до проверки требований РК.

## Сценарий интерфейса

`engine/test/ui/audit-ui.scenario.js` — проход по интерфейсу в браузере (Playwright): пример, подтверждения, полнота реестра, устаревание, повторная проверка, черновик при «невозможно проверить».

```
npm i playwright && npx playwright install chromium
node engine/test/ui/audit-ui.scenario.js
```
