'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createRouteSearch, seriesField, tourFromBest, measureRun } = require('./lab.cjs');
const n = Number(process.argv[2] || 30), count = Number(process.argv[3] || 20);
const algorithm = process.argv[4] || 'hvastuns-var', timeout = Number(process.argv[5] || 10000);
if (!Number.isInteger(n) || n < 3 || n > 100 || !Number.isInteger(count) || count < 1 || count > 1000 ||
    !['khvastuns', 'hvastuns-4', 'hvastuns-var', 'hvastuns-staged'].includes(algorithm) || !Number.isFinite(timeout) || timeout <= 0) {
  throw Error('Запуск: node tools/compare-proof.cjs [3–100 городов] [1–1000 полей] [hvastuns-var|hvastuns-staged|khvastuns|hvastuns-4] [лимит мс]');
}
function solve(points, initialTour) {
  const started = performance.now(), run = createRouteSearch(algorithm, points, undefined, false, initialTour);
  while (!run.done && performance.now() - started < timeout) run.advance(Infinity, 20);
  return run;
}
const warm = solve(seriesField(10, 1000));
if (warm.done) solve(warm.points, tourFromBest(warm));
const rows = [];
for (let field = 0; field < count; field++) {
  const points = seriesField(n, field), source = solve(points);
  const row = { field, source: { done: source.done, totalMs: source.totalMs }, normal: null, proof: null };
  if (source.done) {
    row.initialTour = tourFromBest(source);
    row.optimum = source.best.len[0] + source.best.len[1];
    // Сначала получаем эталон; затем чередуем порядок двух свежих замеров, чтобы второй режим не получал постоянного преимущества прогрева.
    for (const kind of field % 2 ? ['proof', 'normal'] : ['normal', 'proof']) {
      const run = solve(points, kind === 'proof' ? row.initialTour : undefined);
      row[kind] = { done: run.done, totalMs: run.totalMs, mainSteps: run.mainSteps };
      if (run.done) {
        row[kind].measurement = measureRun(run);
        if (Math.abs(row[kind].measurement.values.length - row.optimum) > 1e-7) throw Error('Длины не совпали на поле ' + field);
      }
    }
  }
  rows.push(row);
}
const paired = rows.filter(row => row.normal?.done && row.proof?.done);
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const summary = ['normal', 'proof'].map(kind => ({ режим: kind === 'normal' ? 'Обычный запуск' : 'Оптимум со старта',
  завершено: rows.filter(row => row[kind]?.done).length, среднее_мс: mean(paired.map(row => row[kind].totalMs)),
  среднее_состояний: mean(paired.map(row => row[kind].mainSteps)) }));
mkdirSync(join(__dirname, '../build'), { recursive: true });
const file = join(__dirname, `../build/proof-${algorithm}-${n}-${count}.json`);
writeFileSync(file, JSON.stringify({ algorithm, n, count, timeout, paired: paired.length, weights: 'euclidean', summary, rows }, null, 2));
console.log(`${algorithm}: ${n} городов, совместно завершено и сверено ${paired.length}/${count}. Подготовка включена; получение готового тура во второй замер не входит.`);
console.table(summary);
console.log(file);
