'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VariableRouteSearch, StagedRouteSearch, seriesField, tourFromBest, measureRun, emptyStats, addMeasurement, statsReport } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');
const { boundaryFields } = require('../tools/boundary-fields.cjs');

function verify(run, optimum) {
  const tour = tourFromBest(run);
  assert.equal(tour.length, run.n); assert.equal(new Set(tour).size, run.n);
  assert.ok(Math.abs(run.upper - optimum) < 1e-7);
  assert.ok(Math.abs(tour.reduce((sum, a, i) => sum + run.dist[a][tour[(i + 1) % run.n]], 0) - optimum) < 1e-7);
  assert.ok(tour.every((a, i) => run.globalAllowed[a] & run.bit[tour[(i + 1) % run.n]]));
}
const frontier = run => [...(run.next ? [run.next] : []), ...run.frontierGroups().flat()];
const fixedEdges = state => state.paths.flatMap(path => path.slice(1).map((b, i) => [path[i], b].sort((a, c) => a - c).join('/')));

test('Частые пробы с пересечениями сохраняют DP на граничных полях, обеих метриках и обоих алгоритмах', () => {
  let attempts = 0, moves = 0, forced = 0, improvements = 0;
  for (const n of [8, 12]) for (const field of boundaryFields(n)) for (const integer of [false, true]) {
    for (const Solver of [VariableRouteSearch, StagedRouteSearch]) for (const warm of [0, n - 2]) {
      const run = new Solver(field.points, warm, integer), optimum = heldKarp(run.dist).length;
      run.completionInterval = run.nextCompletion = 1;
      while (!run.done) { run.advance(31); assert.ok(run.bound <= optimum + 1e-7); }
      verify(run, optimum);
      attempts += run.relaxedAttempts; moves += run.relaxedMoves;
      forced += run.relaxedForced; improvements += run.relaxedImprovements;
      assert.ok(run.relaxedMs <= run.completionMs);
    }
  }
  assert.ok(attempts > 0 && moves > 0 && forced > 0 && improvements > 0);
});

test('Распутывание меняет начало копии, сохраняет исходное состояние и очередь, останавливается посреди 2-opt', async () => {
  const run = new VariableRouteSearch(seriesField(16, 7), 0);
  run.completionInterval = run.nextCompletion = 4;
  while (run.completion?.relaxed?.phase !== 'opt') { run.step(); assert.equal(run.done, false); }
  while (run.phase !== 'search') run.step();
  const job = run.completion.relaxed, root = run.completion.root;
  const paths = root.paths.map(p => p.slice()), len = root.len.slice(), allowed = root.allowed.slice();
  const pending = frontier(run), masks = run.globalAllowed.slice(), zeros = run.zeroEvents.length;
  const initial = job.tour.reduce((sum, a, i) => sum + run.dist[a][job.tour[(i + 1) % run.n]], 0);
  const edges = job.tour.map((a, i) => [a, job.tour[(i + 1) % run.n]]);
  assert.ok(edges.some(([a, b]) => edges.some(([c, d]) => new Set([a, b, c, d]).size === 4 &&
    run.turn[a][b][c] * run.turn[a][b][d] < 0 && run.turn[c][d][a] * run.turn[c][d][b] < 0)));
  const mainSteps = run.mainSteps;
  run.advance(7);
  assert.equal(run.relaxedOptChecks, 7);
  assert.equal(run.mainSteps, mainSteps);
  assert.deepEqual(frontier(run), pending);
  assert.deepEqual(run.globalAllowed, masks);
  assert.equal(run.zeroEvents.length, zeros);
  const paused = [run.relaxedOptChecks, run.totalMs, run.relaxedMs];
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([run.relaxedOptChecks, run.totalMs, run.relaxedMs], paused);
  while (run.completion?.relaxed) run.step();
  assert.deepEqual(root.paths, paths); assert.deepEqual(root.len, len);
  assert.ok(root.allowed.every((mask, i) => (mask & allowed[i]) === mask));
  assert.ok(run.upper < initial);
  assert.ok(run.relaxedMoves > 0 && run.relaxedImprovements > 0);
  assert.ok(fixedEdges(root).some(edge => !fixedEdges(run.best).includes(edge)));
  assert.ok(pending.every(state => frontier(run).includes(state)) || run.done);
  run.advance();
  verify(run, heldKarp(run.dist).length);
  const work = measureRun(run).work;
  assert.equal(work.relaxedOptChecks, run.reportZeros().work.relaxedOptChecks);
  const row = emptyStats(run.n);
  addMeasurement(row, { values: { length: run.upper } }, null);
  addMeasurement(row, measureRun(run), null);
  assert.equal(statsReport([row], undefined, 'hvastuns-var').sizes[0].metrics.relaxedOptChecks.samples, 1);
});

test('После лимита сборки все оставшиеся города попадают в полный пробный цикл без отсечения исходного состояния', () => {
  const run = new VariableRouteSearch(seriesField(12, 5), 0);
  run.advancePreparation();
  const root = run.next; run.next = null;
  run.nextCompletion = 0;
  assert.ok(run.startCompletion(root));
  const paths = root.paths.map(path => path.slice());
  run.completion.relaxed.budget = 1;
  while (run.completion?.relaxed?.phase !== 'opt') run.step();
  assert.equal(run.relaxedForced, 1);
  assert.equal(run.relaxedFailures, 0);
  assert.equal(run.completionExhausted, 0);
  assert.equal(run.deadEndCuts, 0);
  assert.equal(run.completion.root, root);
  assert.deepEqual(root.paths, paths);
  assert.equal(new Set(run.completion.relaxed.tour).size, run.n);
  assert.equal(run.completion.relaxed.tour.length, run.n);
  assert.ok(Number.isFinite(run.upper));
  assert.ok(run.relaxedTrace.frames.some(frame => frame.phase === 'fill'));
  assert.ok(run.relaxedTrace.frames.some(frame => frame.phase === 'seed'));
  run.advance(); verify(run, heldKarp(run.dist).length);
});

test('Глобальные нули и порог этапа обязательны для обычной сборки и новых рёбер 2-opt', () => {
  const run = new StagedRouteSearch(seriesField(12, 8), 0);
  run.advancePreparation();
  const edge = run.edgeAnalysis.edges.find(e => !e.excluded && !e.required);
  run.stageThresholds[0] = 1;
  assert.equal(run.relaxedEdgeAllowed(edge.a, edge.b), false);
  run.stageIndex = run.stageThresholds.length - 1;
  assert.equal(run.relaxedEdgeAllowed(edge.a, edge.b), true);
  // Искусственный запрет проверяет соблюдение общей маски пробой.
  run.banEdge(edge, 'bound', 'Тест запрета в достройке с пересечениями');
  assert.equal(run.relaxedEdgeAllowed(edge.a, edge.b), false);
  const tour = [0, 2, 1, 3], points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const small = new VariableRouteSearch(points, 0), job = { tour: tour.slice(), i: 0, j: 2, change: 0, move: null, checks: 0, budget: 32 };
  while (!small.stepTwoOpt(job, () => false)) {}
  assert.deepEqual(job.tour, tour);
});

test('Полный пробный цикл с нулями сразу уменьшает верхнюю границу, не отменяя запретов основного поиска', () => {
  const run = new VariableRouteSearch(seriesField(16, 0), 0);
  run.advancePreparation();
  const masks = run.globalAllowed.slice(), root = run.next; run.next = null; run.nextCompletion = 0;
  run.startCompletion(root); run.completion.relaxed.budget = 1;
  while (run.completion?.relaxed?.phase !== 'opt') run.step();
  const trace = run.relaxedTrace, seed = trace.frames.find(frame => frame.phase === 'seed');
  assert.ok(seed.blocked.length > 0);
  assert.equal(run.relaxedOptChecks, 0);
  assert.equal(run.upper, seed.len[0] + seed.len[1]);
  assert.ok(Number.isFinite(run.upper));
  assert.deepEqual(run.globalAllowed, masks);
  for (const [a, b] of seed.blocked) assert.equal(Boolean(run.globalAllowed[a] & run.bit[b]), false);
  assert.equal(run.relaxedImprovements, 1);
  run.advance(); verify(run, heldKarp(run.dist).length);
  assert.ok(run.relaxedRepairedEdges > 0);
  const report = JSON.parse(JSON.stringify(run.reportZeros()));
  assert.ok(report.lastProbe.frames.length <= 128);
  assert.equal(report.lastProbe.frames[0].phase, 'source');
  assert.equal(measureRun(run).work.relaxedForced, run.relaxedForced);
});

test('Распутывание сначала убирает запрещённую связь, даже если такая перестройка временно длиннее', () => {
  const run = new VariableRouteSearch([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 0);
  const job = { tour: [0, 1, 2, 3], i: 0, j: 2, change: 0, move: null, checks: 0, budget: 32, moves: 0, repaired: 0 };
  // Искусственная маска проверяет приоритет ремонта; это не доказательство запрета стороны квадрата.
  const allowed = (a, b) => !(Math.min(a, b) === 0 && Math.max(a, b) === 1);
  run.stepTwoOpt(job, allowed, true);
  assert.equal(job.repaired, 1);
  assert.ok(job.tour.every((a, i) => allowed(a, job.tour[(i + 1) % 4])));
  assert.ok(job.tour.reduce((sum, a, i) => sum + run.dist[a][job.tour[(i + 1) % 4]], 0) > 4);
});

test('Фоновая проба на большом поле не продвигает основной поиск и имеет конечный бюджет', () => {
  const run = new VariableRouteSearch(seriesField(40, 8));
  run.advancePreparation(); run.nextCompletion = 1;
  while (!run.completion?.relaxed && !run.done) run.step();
  assert.ok(run.completion?.relaxed);
  const steps = run.mainSteps, root = run.completion.root;
  assert.equal(run.hasBackgroundWork, true);
  run.advancePreparation();
  assert.equal(run.mainSteps, steps);
  assert.ok(run.relaxedBuildChecks <= Math.max(64, 6 * run.n));
  assert.ok(run.relaxedOptChecks <= 8 * run.n * run.n);
  assert.ok(!run.completion?.relaxed);
  assert.ok(run.completion?.root === root || !run.completion);
});
