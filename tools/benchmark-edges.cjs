'use strict';

const { EdgeAnalysis, seriesField } = require('./lab.cjs');
const repeats = Number(process.argv[2] || 5);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 100) throw Error('Запуск: node tools/benchmark-edges.cjs [1–100 повторов]');
for (let i = 0; i < 3; i++) new EdgeAnalysis(seriesField(30, 1000 + i)).advance();
const rows = [];
for (const n of [10, 20, 30, 50, 70, 100]) {
  const times = [], points = seriesField(n, 0);
  let run;
  for (let i = 0; i < repeats; i++) {
    run = new EdgeAnalysis(points);
    run.advance();
    times.push(run.totalMs);
  }
  times.sort((a, b) => a - b);
  rows.push({ городов: n, рёбер: run.edges.length, после_фильтра: run.pairVisits, отсечено_областью: run.spatialSkips,
    проверок_пересечений: run.crossingChecks,
    нулей: run.excludedCount, минимум_мс: +times[0].toFixed(2),
    медиана_мс: +((times[(repeats - 1) >> 1] + times[repeats >> 1]) / 2).toFixed(2), максимум_мс: +times.at(-1).toFixed(2) });
}
console.log('Оценивание без поиска маршрута. Подготовка включена, отрисовки нет. Повторов на одном поле:', repeats);
console.table(rows);
