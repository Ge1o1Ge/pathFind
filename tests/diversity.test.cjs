'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VariableRouteSearch, seriesField, routeDistance, tourFromBest, measureRun } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

const frontier = run => [...(run.next ? [run.next] : []), ...run.queues.flatMap(q => q.items), ...run.stack];
function verify(run, optimum) {
  const tour = tourFromBest(run);
  assert.equal(tour.length, run.n);
  assert.equal(new Set(tour).size, run.n);
  const length = tour.reduce((sum, a, i) => sum + run.dist[a][tour[(i + 1) % run.n]], 0);
  assert.ok(Math.abs(length - run.upper) < 1e-7);
  if (optimum !== undefined) assert.ok(Math.abs(length - optimum) < 1e-7, `${length} / ${optimum}`);
}

test('Переключение сохраняет каждый элемент фронта, оценки, длины и глобальные запреты', () => {
  const run = new VariableRouteSearch(seriesField(12, 0), 0), root = run.next;
  run.diversityEnabled = true;
  run.next = null;
  const cities = Array.from({ length: run.n }, (_, i) => i).filter(i => i !== run.a && i !== run.b);
  const states = cities.map((city, i) => ({ ...run.extend(root, i % 2, city), cost: i + 10, bound: i + 2 }));
  run.next = states[0];
  states.slice(1, 7).forEach(s => run.queueFor(s).add(s));
  run.stack.push(...states.slice(7));
  run.diversityStall = run.diversityNext = 0;
  run.visitPrefix(states[0]);
  const data = states.map(s => ({ cost: s.cost, bound: s.bound, len: s.len.slice() }));
  const mask = run.globalAllowed.slice(), scores = run.edgeAnalysis.edges.map(e => e.score);
  const priority = run.diversityPriority(states[0]);
  for (let i = 0; i < 1000; i++) run.visitPrefix(states[0]);
  assert.ok(run.diversityPriority(states[0]) > priority);
  const selected = run.diversify(), after = [...frontier(run), selected];
  assert.ok(selected);
  assert.equal(after.length, states.length);
  assert.equal(new Set(after).size, states.length);
  assert.ok(states.every(s => after.includes(s)));
  assert.deepEqual(states.map(s => ({ cost: s.cost, bound: s.bound, len: s.len })), data);
  assert.deepEqual(run.globalAllowed, mask);
  assert.deepEqual(run.edgeAnalysis.edges.map(e => e.score), scores);
  assert.equal(run.zeroEvents.length, 0);
  run.diversityNext = 0; run.diversityStackLimit = run.stack.length;
  const parked = frontier(run);
  assert.equal(run.diversify(), null);
  assert.deepEqual(frontier(run), parked);
});

test('Частые переключения и перестройки с тесной очередью совпадают с независимым DP', () => {
  let switches = 0, repairs = 0, count = 0;
  for (let n = 8; n <= 13; n++) for (let field = 0; field < 4; field++) {
    const points = seriesField(n, field);
    for (const integer of [false, true]) {
      const optimum = heldKarp(points.map(p => points.map(q => routeDistance(p, q, integer)))).length;
      for (const warm of [0, n - 2]) {
        const run = new VariableRouteSearch(points, warm, integer);
        run.diversityEnabled = true;
        run.diversityStall = run.diversityNext = 1; run.diversityInterval = 2;
        run.diversityStackLimit = 20; run.queueLimit = 4;
        run.repairInterval = run.repairNext = 8;
        run.completionInterval = run.nextCompletion = 3;
        let previous = run.upper;
        while (!run.done) {
          run.advance(37);
          assert.ok(run.upper <= previous);
          assert.ok(run.bound <= optimum + 1e-7);
          previous = run.upper;
        }
        verify(run, optimum);
        switches += run.diversitySwitches; repairs += run.repairAttempts; count++;
        for (const event of run.zeroEvents) if (event.kind === 'bound') assert.ok(event.bound > event.upper);
      }
    }
  }
  assert.equal(count, 96);
  assert.ok(switches > 0);
  assert.ok(repairs > 0);
});

test('Перестройка прерывается по шагам, имеет конечный бюджет и не затрагивает очередь', async () => {
  const run = new VariableRouteSearch(seriesField(74, 0));
  run.advancePreparation();
  run.repairNext = 0;
  const pending = frontier(run), best = run.best, initial = run.upper;
  run.advance(7);
  assert.ok(run.repair);
  assert.equal(run.repairChecks, 7);
  assert.equal(run.mainSteps, 0);
  assert.equal(run.best, best);
  const paused = [run.repairChecks, run.totalMs];
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([run.repairChecks, run.totalMs], paused);
  while (run.repair) run.advance(1);
  assert.ok(run.repairChecks <= 8 * run.n * run.n);
  assert.ok(run.repairMoves > 0);
  assert.ok(run.upper <= initial);
  assert.deepEqual(frontier(run), pending);
  verify(run);
  const report = JSON.parse(JSON.stringify(run.reportZeros())), measurement = measureRun(run);
  assert.equal(report.work.repairChecks, run.repairChecks);
  assert.equal(measurement.work.repairChecks, run.repairChecks);
  assert.equal(measurement.work.diversityChecks, run.diversityChecks);
  assert.ok(run.totalMs >= run.preparationMs + run.warmupMs + run.searchMs + run.completionMs + run.repairMs);
  run.repairNext = 0;
  const before = run.mainSteps;
  assert.equal(run.hasBackgroundWork, true);
  run.advancePreparation();
  assert.equal(run.hasBackgroundWork, false);
  assert.equal(run.mainSteps, before);
  assert.equal(run.repairAttempts, 2);
});

test('Переданный оптимум сохраняется при независимых перестройках; порционная работа воспроизводима', () => {
  const points = seriesField(16, 8), reference = new VariableRouteSearch(points);
  reference.advance();
  const a = new VariableRouteSearch(points, undefined, false, tourFromBest(reference));
  const b = new VariableRouteSearch(points, undefined, false, tourFromBest(reference));
  a.advancePreparation(); b.advancePreparation();
  const original = a.best;
  for (let i = 0; i < 8; i++) {
    for (const run of [a, b]) { run.repairNext = 0; assert.ok(run.startRepair()); }
    while (a.repair) a.stepRepair();
    while (b.repair) b.advance(1, 0);
    verify(a, reference.upper); verify(b, reference.upper);
    assert.deepEqual(a.best.paths, b.best.paths);
  }
  assert.equal(a.best, original);
  assert.equal(a.repairImprovements, 0);
  assert.equal(a.repairChecks, b.repairChecks);
});
