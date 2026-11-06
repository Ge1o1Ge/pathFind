'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StagedRouteSearch, VariableRouteSearch, seriesField, routeDistance, tourFromBest, measureRun } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');
const { boundaryFields, squareGrid } = require('../tools/boundary-fields.cjs');

function verify(run, optimum) {
  const tour = tourFromBest(run);
  assert.equal(tour.length, run.n);
  assert.equal(new Set(tour).size, run.n);
  const length = tour.reduce((sum, a, i) => sum + run.dist[a][tour[(i + 1) % tour.length]], 0);
  assert.ok(Math.abs(length - optimum) < 1e-7, `${length} / ${optimum}`);
  assert.ok(Math.abs(length - run.upper) < 1e-7);
  assert.ok(tour.every((a, i) => run.globalAllowed[a] & run.bit[tour[(i + 1) % tour.length]]));
}

test('Поэтапный поиск совпадает с независимым DP на граничных геометриях и обеих метриках', () => {
  let count = 0, transitions = 0, zeroCuts = 0, early = 0;
  for (const n of [6, 8, 10, 12, 14]) for (const field of boundaryFields(n)) for (const integer of [false, true]) {
    const optimum = heldKarp(field.points.map(p => field.points.map(q => routeDistance(p, q, integer)))).length;
    for (const warm of [0, n - 2]) {
      const run = new StagedRouteSearch(field.points, warm, integer);
      // Часть запусков намеренно рано подключает отложенные очереди и часто использует пробные достройки.
      if (n % 4 === 0) run.stageMemoryLimit = 3;
      run.completionInterval = run.nextCompletion = 3;
      while (!run.done) {
        run.advance(31);
        assert.ok(run.bound <= optimum + 1e-7, field.name + ': завышена нижняя граница');
      }
      verify(run, optimum);
      assert.equal(run.deferredCount, 0);
      transitions += run.stageHistory.length - 1; zeroCuts += run.stageZeroCuts; early += run.stageEarlyOpens; count++;
    }
  }
  assert.equal(count, 200);
  assert.ok(transitions > 0 && zeroCuts > 0 && early > 0);
});

test('Пустая активная очередь не завершает поиск при отложенных вариантах; они сохраняют нижнюю границу', () => {
  const points = seriesField(14, 6), run = new StagedRouteSearch(points, 0);
  // У оценки пересечений возможна единица: тестовый порог выше неё откладывает все продолжения.
  run.stageThresholds = [1.01, 0.9, 0.5, 0.1, 0];
  run.advancePreparation(); run.step();
  assert.equal(run.pending, 0);
  assert.equal(run.stack.length, 0);
  assert.ok(run.deferredCount > 0);
  assert.equal(run.done, false);
  assert.ok(Number.isFinite(run.bound));
  const optimum = heldKarp(run.dist).length;
  while (!run.done) { run.advance(7); assert.ok(run.bound <= optimum + 1e-7); }
  verify(run, optimum);
  assert.ok(run.stageHistory.some(h => h.reason === 'exhausted'));
});

test('Доказанный ноль навсегда исключает уже отложенное состояние, включая его кешированную оценку', () => {
  const run = new StagedRouteSearch(seriesField(14, 6), 0), root = run.next;
  run.stageThresholds = [0.999, 0.9, 0.5, 0.1, 0];
  run.advancePreparation(); run.step();
  const state = run.stageQueues.flatMap(q => q.items).find(s => s.paths.some(p => p.length > 1));
  const path = state.paths.find(p => p.length > 1), edge = run.edge(path[0], path[1]);
  assert.ok(Number.isFinite(run.candidateBound(state)));
  // Искусственный запрет проверяет обслуживание очереди; это не проверка доказательства выбранного ребра.
  run.banEdge(edge, 'bound', 'Тест глобального запрета в отложенной очереди');
  assert.equal(run.candidateBound(state), Infinity);
  assert.equal(run.stageZeroCuts, 1);
  run.stageIndex = run.stageThresholds.length - 1;
  assert.equal(run.syncState(state), false);
  assert.equal(run.stageZeroCuts, 1);
  assert.equal(run.checkedExtension(root, 0, path[1]), null);
  assert.equal(edge.score, 0);
});

test('Пауза, начальный оптимум и отчёт этапов сохраняются на старших битах', async () => {
  const grid = squareGrid(6), run = new StagedRouteSearch(grid.points, undefined, false, grid.tour);
  const seed = run.best;
  run.advance(5);
  const paused = [run.mainSteps, run.totalMs, run.edgeAnalysis.processed];
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([run.mainSteps, run.totalMs, run.edgeAnalysis.processed], paused);
  run.advance();
  verify(run, grid.optimum);
  assert.equal(run.best, seed);
  assert.equal(run.warmupCount, 0);
  const report = JSON.parse(JSON.stringify(run.reportZeros()));
  assert.deepEqual(report.stages.thresholds, [0.1, 0.05, 0.01, 0.001, 0]);
  assert.equal(measureRun(run).work.stageFinalThreshold, run.stageThreshold);
  assert.equal(measureRun(run).work.scoreDistributionRuns, 1);
});

test('Замыкающие рёбра тоже откладываются; исчерпание ограниченной достройки не отсекает весь остаток', () => {
  const points = boundaryFields(12).find(f => f.name === 'Два скопления').points;
  const run = new StagedRouteSearch(points, 0), base = new VariableRouteSearch(points, 0);
  run.stageThresholds = [0.999, 0.9, 0.5, 0.1, 0];
  // Здесь проверяется именно исчерпание обычной достройки с порогом, без эвристической заготовки.
  run.relaxedEnabled = false;
  run.completionInterval = run.nextCompletion = 1;
  run.advance(); base.advance();
  verify(run, base.upper);
  assert.ok(run.stageProbeSkips > 0);
  assert.ok(run.stageHistory.length > 1);
});
