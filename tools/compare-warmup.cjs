'use strict';

const { RouteSearch, seriesField, warmupVariants, measureRun, measuredValues } = require('./lab.cjs');
const n = Number(process.argv[2] ?? 20), count = Number(process.argv[3] ?? 12);
if (!Number.isInteger(n) || n < 3 || n > 30 || !Number.isSafeInteger(count) || count < 1) {
  throw new Error('Запуск: node tools/compare-warmup.cjs <города: 3–30> <число полей>');
}
const variants = warmupVariants(n);
const rows = variants.map(({ limit, requests }) => ({
  запрос: requests.join('/'), лимит: limit, циклы: 0, вставки: 0, пары: 0, состояния: 0,
  подготовка_мс: 0, разминка_мс: 0, поиск_мс: 0, всего_мс: 0
}));
function solve(points, limit) {
  const run = new RouteSearch(points, limit);
  run.advance();
  return measuredValues(measureRun(run));
}
// Даём движку прогреться отдельно от замеров, на других координатах.
for (let i = 0; i < variants.length; i++) solve(seriesField(14, count + i), variants[i].limit);
for (let field = 0; field < count; field++) {
  const points = seriesField(n, field);
  let optimal;
  // Меняем первый лимит от поля к полю, чтобы порядок не давал преимущества одному варианту.
  for (let j = 0; j < variants.length; j++) {
    const i = (j + field) % variants.length;
    const v = solve(points, variants[i].limit), row = rows[i];
    if (optimal !== undefined && Math.abs(v.length - optimal) > 1e-8) throw new Error('Разные оптимумы на поле ' + (field + 1));
    optimal = v.length;
    row.циклы += v.warmupCycles;
    row.вставки += v.insertionChecks;
    row.пары += v.twoOptChecks;
    row.состояния += v.mainSteps;
    row.подготовка_мс += v.preparationMs;
    row.разминка_мс += v.warmupMs;
    row.поиск_мс += v.searchMs;
    row.всего_мс += v.totalMs;
  }
}
console.log('Городов: %d, одинаковых полей для каждого лимита: %d. Средние на поле:', n, count);
for (const row of rows) {
  for (const key of Object.keys(row).slice(2)) row[key] = Number((row[key] / count).toFixed(3));
}
console.table(rows);
