'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { VariableRouteSearch, StagedRouteSearch, seriesField, measureRun } = require('./lab.cjs');
const sizes = (process.argv[2] || '30,40').split(',').map(Number), fields = Number(process.argv[3] || 6);
const timeout = Number(process.argv[4] || 2000), algorithm = process.argv[5] || 'hvastuns-var';
if (sizes.some(n => !Number.isInteger(n) || n < 3 || n > 100) || !Number.isInteger(fields) || fields < 1 || fields > 1000 ||
    !Number.isFinite(timeout) || timeout <= 0 || !['hvastuns-var', 'hvastuns-staged'].includes(algorithm)) {
  throw Error('Запуск: node tools/compare-chain.cjs [размеры через запятую] [полей 1–1000] [лимит мс] [hvastuns-var|hvastuns-staged]');
}
const Solver = algorithm === 'hvastuns-var' ? VariableRouteSearch : StagedRouteSearch;
const variants = [
  { name: 'Без добавок', bound: false, chain: false }, { name: 'Только B(F)', bound: true, chain: false },
  { name: 'Только H', bound: false, chain: true }, { name: 'B(F) + H', bound: true, chain: true }
];
// Прогрев той же реализации. Эти запуски не входят в сводку.
for (const variant of variants) {
  const run = new Solver(seriesField(16, 123));
  run.combinationEnabled = variant.bound; run.chainRankingEnabled = variant.chain; run.advance();
}
const rows = [];
for (const n of sizes) for (let field = 0; field < fields; field++) {
  const points = seriesField(n, field), row = { n, field, points, runs: {} };
  const order = variants.slice(field % 4).concat(variants.slice(0, field % 4));
  let optimum;
  for (const variant of order) {
    const started = performance.now(), run = new Solver(points);
    run.combinationEnabled = variant.bound; run.chainRankingEnabled = variant.chain;
    while (!run.done && performance.now() - started < timeout) run.advance(Infinity, 10);
    row.runs[variant.name] = { done: run.done, lower: run.bound, upper: run.upper, ...measureRun(run).work };
    if (run.done) {
      if (optimum !== undefined && Math.abs(optimum - run.upper) > 1e-7) throw Error(`Расхождение на ${n}, поле ${field}`);
      optimum = run.upper;
    }
  }
  if (optimum !== undefined && Object.values(row.runs).some(r => r.lower > optimum + 1e-7 || r.upper < optimum - 1e-7)) {
    throw Error(`Граница исключила контрольный оптимум на ${n}, поле ${field}`);
  }
  rows.push(row);
  console.log(`${n}, поле ${field}: ` + variants.map(v => `${v.name}: ${row.runs[v.name].done ? 'готово' : 'лимит'}`).join(' · '));
}
const summary = sizes.flatMap(n => {
  const sample = rows.filter(row => row.n === n), paired = sample.filter(row => Object.values(row.runs).every(r => r.done));
  return variants.map(v => {
    const average = key => paired.length ? paired.reduce((sum, row) => sum + row.runs[v.name][key], 0) / paired.length : null;
    return { города: n, вариант: v.name, завершено: sample.filter(row => row.runs[v.name].done).length,
      общих_полей: paired.length, мс: average('totalMs'), состояния: average('mainSteps'),
      вычислений_BF: average('combinationEvaluations'), отсечений_BF: average('combinationCuts'), мс_BF: average('combinationMs') };
  });
});
mkdirSync(join(__dirname, '../build'), { recursive: true });
const output = join(__dirname, '../build', `chain-${algorithm}-${sizes.join('-')}-${fields}.json`);
writeFileSync(output, JSON.stringify({ algorithm, sizes, fields, timeout, summary, rows }, null, 2));
console.table(summary);
console.log('Средние — только по полям, завершённым всеми четырьмя вариантами. JSON: ' + output);
