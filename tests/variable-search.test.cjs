'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VariableRouteSearch, RouteSearch, seriesField, routeDistance, measureRun } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

function verifyTour(run, optimum) {
  const [out, back] = run.best.paths, tour = out.concat(back.slice(1, -1).reverse());
  assert.equal(tour.length, run.n);
  assert.equal(new Set(tour).size, run.n);
  assert.deepEqual([out[0], back[0], out.at(-1), back.at(-1)], [run.a, run.a, run.b, run.b]);
  const length = tour.reduce((sum, a, i) => sum + run.dist[a][tour[(i + 1) % run.n]], 0);
  assert.ok(Math.abs(length - optimum) < 1e-7, `${run.n}: ${length} / ${optimum}`);
  assert.ok(Math.abs(run.upper - length) < 1e-7);
  for (let i = 0; i < tour.length; i++) assert.ok(run.globalAllowed[tour[i]] & run.bit[tour[(i + 1) % run.n]]);
}

test('Hvastuns-var совпадает с независимым DP: случайные поля, решётки, линии, совпадающие точки, обе метрики', () => {
  let count = 0;
  for (let n = 3; n <= 13; n++) {
    const fields = Array.from({ length: 12 }, (_, i) => seriesField(n, i));
    fields.push(Array.from({ length: n }, (_, x) => ({ x, y: 0 })));
    fields.push(Array.from({ length: n }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) })));
    fields.push(Array.from({ length: n }, (_, i) => ({ x: i % 3, y: i % 2 })));
    for (const points of fields) for (const integer of [false, true]) {
      const optimum = heldKarp(points.map(p => points.map(q => routeDistance(p, q, integer)))).length;
      for (const warm of [0, n - 2]) {
        const run = new VariableRouteSearch(points, warm, integer), seed = run.best;
        while (!run.done) { run.advance(37); assert.ok(run.bound <= optimum + 1e-7); }
        verifyTour(run, optimum);
        if (seed && seed.len[0] + seed.len[1] === run.upper) assert.equal(seed, run.best);
        assert.equal(run.zeroEvents.length, Object.values(run.zeroCounts).reduce((a, b) => a + b, 0));
        assert.equal(new Set(run.zeroEvents.map(e => e.edge)).size, run.zeroEvents.length);
        assert.ok(run.edgeAnalysis.edges.every(e => (e.score === 0) === !(run.globalAllowed[e.a] & run.bit[e.b])));
        count++;
      }
    }
  }
  assert.equal(count, 660);
});

test('Строгие нули сохраняют все равные оптимальные циклы, а не только один найденный', () => {
  const fields = Array.from({ length: 24 }, (_, i) => seriesField(5 + i % 3, i + 60));
  fields.push(Array.from({ length: 7 }, (_, x) => ({ x, y: 0 })));
  fields.push(Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: 0 })));
  fields.push(Array.from({ length: 6 }, () => ({ x: 0, y: 0 })));
  for (const points of fields) for (const integer of [false, true]) {
    const run = new VariableRouteSearch(points, 0, integer);
    run.advance();
    let optimal = Infinity, tours = [];
    function visit(path, free, length) {
      if (!free.length) {
        length += run.dist[path.at(-1)][0];
        if (length < optimal - 1e-8) { optimal = length; tours = [path]; }
        else if (Math.abs(length - optimal) < 1e-8) tours.push(path);
      } else for (const city of free) visit([...path, city], free.filter(i => i !== city), length + run.dist[path.at(-1)][city]);
    }
    visit([0], points.map((_, i) => i).slice(1), 0);
    verifyTour(run, optimal);
    for (const tour of tours) for (let i = 0; i < tour.length; i++) assert.ok(run.edge(tour[i], tour[(i + 1) % tour.length]).score > 0);
    for (const event of run.zeroEvents) if (event.kind === 'bound') assert.ok(event.bound > event.upper);
  }
});

test('Пауза в матрице и обновлении запретов, история шагов, отдельные счётчики и старшие биты', async () => {
  const points = seriesField(16, 8), run = new VariableRouteSearch(points, 0), whole = new VariableRouteSearch(points, 0);
  run.advance(3);
  assert.equal(run.mainSteps, 0);
  assert.equal(run.edgeAnalysis.processed, 3);
  const time = run.totalMs;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(run.totalMs, time);
  while (run.phase === 'matrix') run.step();
  assert.equal(run.phase, 'filter');
  while (!run.done) run.advance(7, 1);
  whole.advance();
  assert.deepEqual(run.best.paths, whole.best.paths);
  assert.deepEqual(run.zeroEvents, whole.zeroEvents);
  assert.ok(run.zeroFrames.length > 1);
  assert.ok(run.zeroEvents.some(e => e.step > 0 && e.kind === 'bound'));
  const report = JSON.parse(JSON.stringify(run.reportZeros()));
  assert.deepEqual(report.zeroEvents, run.zeroEvents);
  const measurement = measureRun(run);
  assert.equal(measurement.work.globalZeros, run.zeroEvents.length);
  assert.ok(run.totalMs >= run.preparationMs + run.warmupMs + run.searchMs + run.completionMs + run.edgeMatrixMs);
  const line = new VariableRouteSearch(Array.from({ length: 100 }, (_, x) => ({ x, y: 0 })));
  assert.equal(line.done, false);
  line.advance();
  verifyTour(line, 198);
  assert.equal(line.mainSteps, 0);
  assert.ok(typeof line.globalAllowed[99] === 'bigint');
});

test('Новые глобальные запреты проверяются у отложенных состояний и замыкающих рёбер', () => {
  const run = new VariableRouteSearch(seriesField(10, 4), 0);
  while (run.phase !== 'search') run.step();
  const root = run.next;
  const edge = run.edgeAnalysis.edges.find(e => !e.excluded && !e.required && e.a === run.a && e.b !== run.b);
  // Искусственно меняем маску, чтобы проверить обслуживание уже созданного состояния.
  const state = run.extend(root, 0, edge.b);
  assert.ok(run.syncState(state));
  run.banEdge(edge, 'bound', 'Тест обновления маски');
  assert.equal(run.syncState(state), false);
  assert.equal(run.checkedExtension(root, 0, edge.b), null);
  const closing = new VariableRouteSearch(seriesField(8, 30));
  while (closing.phase !== 'search') closing.step();
  const state2 = { ...closing.best, paths: closing.best.paths.map(p => p.slice(0, -1)), free: 0, globalVersion: undefined };
  const end = state2.paths[0].at(-1);
  closing.globalAllowed[end] &= ~closing.bit[closing.b]; closing.globalVersion++;
  assert.equal(closing.syncState(state2), false);
});

test('Большое поле и периодические достройки сохраняют результат базового решателя', () => {
  const points = seriesField(40, 0), run = new VariableRouteSearch(points), base = new RouteSearch(points);
  base.advance();
  run.completionInterval = run.nextCompletion = 3;
  run.advance();
  verifyTour(run, base.best.len[0] + base.best.len[1]);
  assert.ok(run.completionChecks + run.relaxedBuildChecks > 0);
});

test('Подготовку можно пройти без задержки анимации и без пропуска состояний поиска', () => {
  const points = seriesField(16, 8), run = new VariableRouteSearch(points, 0), whole = new VariableRouteSearch(points, 0);
  assert.equal(run.advancePreparation(0), 1);
  assert.equal(run.edgeAnalysis.processed, 1);
  run.advancePreparation();
  assert.equal(run.phase, 'search');
  assert.equal(run.mainSteps, 0);
  assert.equal(run.done, false);
  assert.equal(run.advancePreparation(), 0);
  let updates = 0;
  while (!run.done) {
    if (run.phase === 'search') run.step();
    else {
      const before = run.mainSteps;
      run.advancePreparation();
      assert.equal(run.mainSteps, before);
      updates++;
    }
  }
  whole.advance();
  assert.ok(updates > 0);
  assert.deepEqual(run.best.paths, whole.best.paths);
  assert.deepEqual(run.zeroEvents, whole.zeroEvents);
  assert.equal(run.mainSteps, whole.mainSteps);
});
