'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RouteSearch, routeDistance, seriesField, warmupVariants, measureRun, measuredValues, addMeasurement, emptyStats, statsReport } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

function exactTourLength(points) {
  // Динамическое программирование по подмножествам без геометрических отсечений и начального рекорда.
  const n = points.length, full = (1 << (n - 1)) - 1;
  const dist = points.map(a => points.map(b => Math.hypot(a.x - b.x, a.y - b.y)));
  const dp = new Float64Array((full + 1) * n).fill(Infinity);
  dp[0] = 0;
  for (let mask = 0; mask < full; mask++) {
    for (let end = 0; end < n; end++) {
      const g = dp[mask * n + end];
      if (!Number.isFinite(g)) continue;
      for (let next = 1; next < n; next++) {
        const bit = 1 << (next - 1);
        if (mask & bit) continue;
        const index = (mask | bit) * n + next;
        dp[index] = Math.min(dp[index], g + dist[end][next]);
      }
    }
  }
  return Math.min(...points.slice(1).map((_, j) => dp[full * n + j + 1] + dist[j + 1][0]));
}

test('Все лимиты сохраняют полный оптимальный цикл, в том числе без начального рекорда', () => {
  for (let n = 3; n <= 12; n++) {
    const fields = Array.from({ length: 12 }, (_, i) => seriesField(n, i));
    fields.push(Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })));
    for (const points of fields) {
      const opt = exactTourLength(points);
      for (const { limit } of warmupVariants(n)) {
        const run = new RouteSearch(points, limit);
        if (!limit) {
          assert.equal(run.best, null);
          assert.equal(run.steps + run.warmupCandidates + run.greedyChecks + run.warmupMs, 0);
        }
        const seed = run.best;
        run.advance();
        const v = measuredValues(measureRun(run));
        assert.ok(run.done && Math.abs(v.length - opt) < 1e-8);
        const [a, b] = run.best.paths, tour = a.concat(b.slice(1, -1).reverse());
        assert.equal(tour.length, n);
        assert.equal(new Set(tour).size, n);
        const length = tour.reduce((sum, city, i) => {
          const next = points[tour[(i + 1) % n]];
          return sum + Math.hypot(points[city].x - next.x, points[city].y - next.y);
        }, 0);
        assert.ok(Math.abs(length - opt) < 1e-8);
        if (seed && seed.len[0] + seed.len[1] === v.length) assert.equal(run.best, seed);
        assert.ok(v.warmupCycles <= limit);
        assert.equal(v.mainSteps + v.warmupCycles, v.steps);
        assert.equal(v.totalMs, v.preparationMs + v.warmupMs + v.searchMs);
      }
    }
  }
});

test('В общей целой метрике сохраняются равные при распутывании варианты; оптимум совпадает с Held–Karp', () => {
  const close = [[0,0],[10000,3],[0,1],[10000,2]].map(([x,y]) => ({x,y}));
  assert.ok(new RouteSearch(close).blockedByEdge(0, 1)[2] & (1 << 3));
  assert.equal(new RouteSearch(close, 0, true).blockedByEdge(0, 1)[2] & (1 << 3), 0);
  for (let i = 0; i < 20; i++) {
    const points = seriesField(11, i), d = points.map(p => points.map(q => routeDistance(p, q, true)));
    const run = new RouteSearch(points, undefined, true);
    run.advance();
    const { length, tour } = heldKarp(d);
    assert.equal(new Set(tour).size, points.length);
    assert.equal(tour.reduce((s, city, i) => s + d[city][tour[(i + 1) % tour.length]], 0), length);
    assert.equal(run.best.len[0] + run.best.len[1], length);
  }
});

test('Потолок включает первый цикл; полный просмотр учитывает даже отвергнутые вставки и развороты', () => {
  const n = 30, points = seriesField(n, 0);
  const cold = new RouteSearch(points, 0), single = new RouteSearch(points, 1);
  assert.ok(single.greedyChecks > 0);
  assert.equal(single.warmupCandidates, 0);
  const tour = cold.insertionTour();
  assert.equal(cold.insertionChecks, n * (n - 1) / 2 - 1);
  assert.equal(cold.warmupNeighbor(tour, { has: () => true }), null);
  assert.equal(cold.twoOptChecks, n * (n - 3) / 2);
  assert.equal(cold.warmupCandidates, cold.insertionChecks + cold.twoOptChecks);
  assert.equal(new RouteSearch(points, 50).warmupCount, 28);
  assert.equal(new RouteSearch(seriesField(3, 0)).warmupCount, 1);
  assert.deepEqual(warmupVariants(12).at(-1), { limit: 10, requests: [10, 20, 50] });
});

test('Ожидание не меняет время; пошаговый и непрерывный поиск обрабатывают те же состояния', async () => {
  const points = seriesField(12, 4), run = new RouteSearch(points, 0);
  run.step();
  assert.equal(run.mainSteps, 1);
  const paused = run.totalMs;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(run.totalMs, paused);
  while (!run.done) run.advance(5);
  const other = new RouteSearch(points, 0);
  other.advance();
  assert.equal(run.mainSteps, other.mainSteps);
  assert.deepEqual(run.best.paths, other.best.paths);
});

test('Ручной поиск до 100 городов проходит старшие биты и доказывает известный оптимум', () => {
  for (const n of [31, 32, 63, 64, 65, 100]) {
    const points = Array.from({ length: n }, (_, i) => ({ x: (i * (n - 1)) % n, y: 0 }));
    const run = new RouteSearch(points, 0, true);
    run.advance(n + 1);
    assert.ok(run.done);
    assert.equal(run.best.len[0] + run.best.len[1], (n - 1) * 2000);
    const [out, back] = run.best.paths;
    const tour = out.concat(back.slice(1, -1).reverse());
    assert.equal(tour.length, n);
    assert.equal(new Set(tour).size, n);
  }
  const points = seriesField(100, 0);
  [points[0], points[1], points[64], points[99]] = [[0, 0], [3, 3], [1, 3], [3, 1]].map(([x, y]) => ({ x, y }));
  const run = new RouteSearch(points);
  assert.ok(run.blockedByEdge(0, 1)[64] & (1n << 99n));
  assert.equal(run.warmupCount, 98);
  run.advance(3);
  assert.equal(run.mainSteps, 3);
});

test('Прежние серийные и ручные результаты не занижают средние новых показателей', () => {
  const row = emptyStats(10);
  const old = { values: { steps: 30 } };
  addMeasurement(row, old, 0);
  assert.equal(statsReport([row]).sizes[0].metrics.totalMs, null);
  addMeasurement(row, { values: { steps: 10, totalMs: 8 } }, null);
  addMeasurement(row, old, 1);
  addMeasurement(row, { values: { steps: 10, totalMs: 2 } }, 2);
  assert.equal(addMeasurement(row, old, 2), false);
  const report = statsReport([row]).sizes[0];
  assert.equal(report.completed, 4);
  assert.deepEqual(report.metrics.totalMs, { min: 2, max: 8, sum: 10, samples: 2, mean: 5 });
  assert.equal(report.metrics.steps.mean, 20);
});
