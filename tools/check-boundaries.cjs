'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { VariableRouteSearch, StagedRouteSearch, tourFromBest, routeScoreQuality, routeDistance } = require('./lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');
const { boundaryFields, squareGrid } = require('./boundary-fields.cjs');
const n = Number(process.argv[2] || 16), seeds = Number(process.argv[3] || 3), timeout = Number(process.argv[4] || 3000);
if (!Number.isInteger(n) || n < 6 || n > 20 || !Number.isInteger(seeds) || seeds < 1 || seeds > 100 || !Number.isFinite(timeout) || timeout <= 0) {
  throw Error('Запуск: node tools/check-boundaries.cjs [6–20 городов для DP] [1–100 полей каждого вида] [лимит мс на поиск]');
}
const fields = Array.from({ length: seeds }, (_, seed) => boundaryFields(n, seed).map(field => ({ ...field, seed }))).flat();
for (const size of [36, 64, 100]) {
  fields.push({ ...boundaryFields(size).find(f => f.name === 'Выпуклый эллипс'), seed: 0 });
  fields.push({ ...squareGrid(Math.sqrt(size)), seed: 0 });
}
const rows = [];
for (const [index, field] of fields.entries()) {
  const { points } = field, dist = points.map(p => points.map(q => routeDistance(p, q)));
  const known = field.optimum ?? (field.perimeter ? points.reduce((sum, _, i) => sum + dist[i][(i + 1) % points.length], 0) : null);
  const optimum = points.length <= 20 ? heldKarp(dist).length : known;
  const row = { name: field.name, n: points.length, seed: field.seed, points, optimum,
    reference: points.length <= 20 ? 'Held–Karp' : field.perimeter ? 'Периметр выпуклого контура' : 'n × минимальное расстояние', runs: {} };
  const order = index % 2 ? [StagedRouteSearch, VariableRouteSearch] : [VariableRouteSearch, StagedRouteSearch];
  for (const Solver of order) {
    const started = performance.now(), run = new Solver(points);
    while (!run.done && performance.now() - started < timeout) run.advance(Infinity, 10);
    const quality = routeScoreQuality(run.edgeAnalysis, run.best?.paths);
    row.runs[run.algorithm] = { done: run.done, length: run.upper, lower: run.bound, totalMs: run.totalMs,
      mainSteps: run.mainSteps, minScore: quality?.min ?? null, tour: tourFromBest(run),
      stages: run.stageHistory || null, deferred: run.stageDeferred ?? null, zeros: run.zeroEvents.length,
      edgeLoss: quality ? Object.fromEntries([0.1, 0.05, 0.01, 0.001].map(t => [t, quality.chosenEdges.filter(e => e.score < t).length])) : null };
    if (run.bound > optimum + 1e-7 || run.upper < optimum - 1e-7 || (run.done && Math.abs(run.upper - optimum) > 1e-7)) {
      throw Error(`${field.name}, ${points.length}: расхождение с эталоном ${optimum} (${run.bound} ≤ ${run.upper})`);
    }
  }
  rows.push(row);
  console.log(`${field.name}, ${points.length}, поле ${field.seed}: ` + Object.entries(row.runs).map(([name, r]) =>
    `${name}: ${r.done ? 'доказан' : 'лимит'}, L=${r.length.toFixed(4)}, ${r.mainSteps} состояний`).join(' · '));
}
const summary = [...new Set(rows.map(row => row.name + ' / ' + row.n))].map(group => {
  const sample = rows.filter(r => r.name + ' / ' + r.n === group);
  const proven = sample.filter(r => r.runs['hvastuns-staged'].done);
  const paired = proven.filter(r => r.runs['hvastuns-var'].done);
  const average = (algorithm, key) => paired.length ? paired.reduce((sum, r) => sum + r.runs[algorithm][key], 0) / paired.length : null;
  return { геометрия: group, подтверждено: proven.length + '/' + sample.length,
    минимум_балла: proven.length ? Math.min(...proven.map(r => r.runs['hvastuns-staged'].minScore)) : null,
    полей_с_ребром_ниже_01: proven.filter(r => r.runs['hvastuns-staged'].edgeLoss[0.1] > 0).length,
    исходный_мс: average('hvastuns-var', 'totalMs'), поэтапный_мс: average('hvastuns-staged', 'totalMs') };
});
mkdirSync(join(__dirname, '../build'), { recursive: true });
const output = join(__dirname, '../build', `boundaries-${n}-${seeds}.json`);
writeFileSync(output, JSON.stringify({ n, seeds, timeout, weights: 'euclidean', summary, rows }, null, 2));
console.table(summary);
console.log('Таймауты не считаются доказанными. JSON: ' + output);
