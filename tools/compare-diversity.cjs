'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { VariableRouteSearch, seriesField, tourFromBest } = require('./lab.cjs');
const sizes = (process.argv[2] || '60,70,74').split(',').map(Number);
const count = Number(process.argv[3] || 3), timeout = Number(process.argv[4] || 3000);
if (sizes.some(n => !Number.isInteger(n) || n < 8 || n > 100) || !Number.isInteger(count) || count < 1 || count > 1000 ||
    !Number.isFinite(timeout) || timeout <= 0) throw Error('Запуск: node tools/compare-diversity.cjs [города через запятую] [число полей] [лимит мс]');
const variants = [
  { name: 'без изменений', order: false, repair: false },
  { name: 'смена начала', order: true, repair: false },
  { name: 'перестройка цикла', order: false, repair: true },
  { name: 'оба механизма', order: true, repair: true }
];
for (const variant of variants) {
  const run = new VariableRouteSearch(seriesField(16, 1001));
  run.diversityEnabled = variant.order; run.repairEnabled = variant.repair;
  run.advance();
}
const rows = [];
for (const n of sizes) for (let field = 0; field < count; field++) {
  const points = seriesField(n, field), row = { n, field, points, runs: {} };
  // Чередуем порядок запусков. Время включает создание решателя и всю дополнительную работу.
  const order = variants.map((_, i) => variants[(i + field) % variants.length]);
  for (const variant of order) {
    const started = performance.now(), run = new VariableRouteSearch(points), initial = run.upper;
    run.diversityEnabled = variant.order; run.repairEnabled = variant.repair;
    while (!run.done && performance.now() - started < timeout) run.advance(Infinity, 10);
    row.runs[variant.name] = { done: run.done, initial, length: run.upper, lower: run.bound, totalMs: run.totalMs,
      wallMs: performance.now() - started, mainSteps: run.mainSteps, zeros: run.zeroEvents.length,
      queued: run.pending, stacked: run.stack.length, switches: run.diversitySwitches, probes: run.diversityProbes,
      repairAttempts: run.repairAttempts, repairChecks: run.repairChecks, repairImprovements: run.repairImprovements,
      repairMs: run.repairMs, tour: tourFromBest(run) };
    const tour = tourFromBest(run);
    if (tour.length !== n || new Set(tour).size !== n) throw Error('Некорректный цикл');
    const actual = tour.reduce((sum, city, i) => sum + run.dist[city][tour[(i + 1) % n]], 0);
    if (Math.abs(actual - run.upper) > 1e-7) throw Error('Длина не совпала с маршрутом');
  }
  const completed = Object.values(row.runs).filter(r => r.done);
  if (completed.some(r => Math.abs(r.length - completed[0].length) > 1e-7)) throw Error('Доказанные оптимумы не совпали');
  rows.push(row);
  console.log(`${n} городов, поле ${field}: ` + variants.map(v => {
    const r = row.runs[v.name]; return `${v.name}: L=${r.length.toFixed(2)}, ${r.done ? 'доказан' : 'лимит времени'}`;
  }).join(' · '));
}
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const summary = variants.map(v => {
  const runs = rows.map(row => row.runs[v.name]);
  const paired = rows.filter(row => variants.every(v => row.runs[v.name].done)).map(row => row.runs[v.name]);
  return { вариант: v.name, доказано: runs.filter(r => r.done).length, всего: runs.length,
    среднее_L: average(runs.map(r => r.length)), среднее_нулей: average(runs.map(r => r.zeros)),
    улучшений_перестройкой: runs.reduce((sum, r) => sum + r.repairImprovements, 0),
    совместно_завершено: paired.length, среднее_мс_завершённых_пар: average(paired.map(r => r.totalMs)) };
});
mkdirSync(join(__dirname, '../build'), { recursive: true });
const output = join(__dirname, '../build', `diversity-${sizes.join('-')}-${count}.json`);
writeFileSync(output, JSON.stringify({ sizes, count, timeout, node: process.version, weights: 'euclidean', summary, rows }, null, 2));
console.table(summary);
console.log('Лимит времени не означает доказательство оптимума. ' + output);
