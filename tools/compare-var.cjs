'use strict';

const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { RouteSearch, VariableRouteSearch, seriesField } = require('./lab.cjs');
const n = Number(process.argv[2] || 30), count = Number(process.argv[3] || 20), timeout = Number(process.argv[4] || 10000);
if (!Number.isInteger(n) || n < 3 || n > 100 || !Number.isInteger(count) || count < 1 || count > 1000 || !Number.isFinite(timeout) || timeout <= 0) {
  throw Error('Запуск: node tools/compare-var.cjs [3–100 городов] [1–1000 полей] [лимит мс на решатель]');
}
const rows = [], names = ['khvastuns', 'Hvastuns-var'];
for (const Solver of [RouteSearch, VariableRouteSearch]) new Solver(seriesField(12, 1001)).advance();
for (let field = 0; field < count; field++) {
  const points = seriesField(n, field), row = { field, n, runs: {} };
  for (const variant of field % 2 ? [1, 0] : [0, 1]) {
    const started = performance.now(), run = new (variant ? VariableRouteSearch : RouteSearch)(points);
    while (!run.done && performance.now() - started < timeout) run.advance(Infinity, 20);
    row.runs[names[variant]] = { done: run.done, totalMs: run.totalMs, mainSteps: run.mainSteps,
      completionChecks: run.completionChecks, length: run.best ? run.best.len[0] + run.best.len[1] : null,
      zeros: run.zeroEvents?.length ?? null, matrixMs: run.edgeMatrixMs ?? null, pruningMs: run.edgePruningMs ?? null };
  }
  const [a, b] = names.map(name => row.runs[name]);
  if (a.done && b.done && Math.abs(a.length - b.length) > 1e-7) throw Error('Длины не совпали на поле ' + field);
  rows.push(row);
}
const paired = rows.filter(row => names.every(name => row.runs[name].done));
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const summary = names.map(name => {
  const runs = paired.map(row => row.runs[name]), times = runs.map(r => r.totalMs).sort((a, b) => a - b);
  return { алгоритм: name, завершено: rows.filter(row => row.runs[name].done).length,
    среднее_мс: average(times), медиана_мс: times.length ? (times[(times.length - 1) >> 1] + times[times.length >> 1]) / 2 : null,
    среднее_состояний: average(runs.map(r => r.mainSteps)), среднее_нулей: name === names[1] ? average(runs.map(r => r.zeros)) : null };
});
const output = join(__dirname, '../build', `var-${n}-${count}.json`);
mkdirSync(join(__dirname, '../build'), { recursive: true });
writeFileSync(output, JSON.stringify({ n, count, timeout, weights: 'euclidean', paired: paired.length, summary, rows }, null, 2));
console.log(`Городов: ${n}. Совместно завершено и сверено: ${paired.length}/${count}. Подготовка и матрица включены; отрисовки нет.`);
console.table(summary);
console.log(output);
