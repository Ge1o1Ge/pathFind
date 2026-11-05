'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouteSearch, RouteSearch, seriesField, measureRun, emptyStats, addMeasurement, statsReport } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

function checkResult(run, optimal) {
  const [out, back] = run.best.paths, tour = out.concat(back.slice(1, -1).reverse());
  assert.equal(tour.length, run.n);
  assert.equal(new Set(tour).size, run.n);
  assert.deepEqual([out[0], back[0], out.at(-1), back.at(-1)], [run.a, run.a, run.b, run.b]);
  const actual = tour.reduce((sum, city, i) => sum + run.dist[city][tour[(i + 1) % tour.length]], 0);
  assert.ok(Math.abs(actual - optimal) < 1e-8);
  assert.ok(Math.abs(actual - run.best.len[0] - run.best.len[1]) < 1e-8);
}

test('Проход через город отсекается симметрично; общие концы и равные коллинеарные замены сохраняются', () => {
  for (const integer of [false, true]) {
    const points = [[-2, 0], [2, 0], [0, 0], [0, 2]].map(([x, y]) => ({ x, y }));
    const run = new RouteSearch(points, 0, integer);
    assert.ok(run.blockedByEdge(0, 1)[2] & run.bit[3]);
    assert.ok(run.blockedByEdge(2, 3)[0] & run.bit[1]);
    assert.equal(run.blockedByEdge(0, 1)[0] & run.bit[3], 0);
    const near = new RouteSearch(points.map((p, i) => i === 2 ? { ...p, y: 0.001 } : p), 0, integer);
    assert.equal(near.blockedByEdge(0, 1)[2] & near.bit[3], 0);
    const line = new RouteSearch([0, 4, 1, 3].map(x => ({ x, y: 0 })), 0, integer);
    assert.equal(line.blockedByEdge(0, 1)[2] & line.bit[3], 0);
  }
});

test('Частые достройки сохраняют оптимум Held–Karp, включая исчерпание бюджета и точные попадания в город', () => {
  let attempts = 0, improvements = 0, exhausted = 0, limited = 0;
  for (const algorithm of ['khvastuns', 'hvastuns-4']) for (const integer of [false, true]) {
    for (let field = 0; field < 28; field++) {
      const points = field < 24 ? seriesField(6 + field % 7, field) :
        Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: field % 2 ? Math.floor(i / 3) : 0 }));
      for (const warmup of [0, points.length - 2]) for (const budget of [1, Infinity]) {
        const run = createRouteSearch(algorithm, points, warmup, integer), seed = run.best;
        const optimal = heldKarp(run.dist).length;
        run.nextCompletion = run.completionInterval = 1;
        while (!run.done) {
          assert.ok(run.bound <= optimal + 1e-8);
          if (run.completion && budget === 1) { run.completion.budget = budget; limited++; }
          run.step();
          assert.ok(run.mainSteps + run.completionChecks < 1_000_000);
        }
        checkResult(run, optimal);
        if (seed && seed.len[0] + seed.len[1] === run.bound) assert.equal(run.best, seed);
        attempts += run.completionAttempts;
        improvements += run.completionImprovements;
        exhausted += run.completionExhausted;
      }
    }
  }
  assert.ok(attempts > 0 && improvements > 0 && exhausted > 0 && limited > 0);
});

test('Приостановленная достройка остаётся в нижней границе; ожидание не влияет на время и результат', async () => {
  for (const algorithm of ['khvastuns', 'hvastuns-4']) {
    const points = seriesField(13, 0), run = createRouteSearch(algorithm, points, 0);
    const optimal = heldKarp(run.dist).length;
    run.nextCompletion = run.completionInterval = 1;
    run.step();
    assert.ok(run.completion && !run.done);
    assert.ok(Number.isFinite(run.bound) && run.bound <= optimal + 1e-8);
    run.step();
    const paused = [run.steps, run.completionChecks, run.totalMs, run.completionMs];
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.deepEqual([run.steps, run.completionChecks, run.totalMs, run.completionMs], paused);
    while (!run.done) run.advance(7, 2);
    checkResult(run, optimal);
    const continuous = createRouteSearch(algorithm, points, 0);
    continuous.nextCompletion = continuous.completionInterval = 1;
    continuous.advance();
    assert.deepEqual(run.best.paths, continuous.best.paths);
    for (const key of ['steps', 'completionChecks', 'completionAttempts', 'completionImprovements', 'completionExhausted']) {
      assert.equal(run[key], continuous[key]);
    }
    const values = measureRun(run).work;
    assert.equal(values.totalMs, values.preparationMs + values.warmupMs + values.searchMs + values.completionMs);
    assert.ok(values.searchMs >= 0 && values.completionMs > 0);
    const row = emptyStats(points.length);
    addMeasurement(row, { values: { length: optimal } }, null);
    addMeasurement(row, measureRun(run), null);
    const exported = statsReport([row]).sizes[0].metrics;
    assert.equal(exported.completionChecks.samples, 1);
    assert.equal(exported.completionChecks.mean, run.completionChecks);
  }
});
