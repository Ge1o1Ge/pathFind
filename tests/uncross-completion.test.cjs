'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VariableRouteSearch, StagedRouteSearch, seriesField, measureRun } = require('../tools/lab.cjs');

function crossings(points, tour) {
  const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let i = 0; i < tour.length; i++) for (let j = i + 2; j < tour.length; j++) {
    if (i === 0 && j === tour.length - 1) continue;
    const [a, b, c, d] = [tour[i], tour[(i + 1) % tour.length], tour[j], tour[(j + 1) % tour.length]].map(k => points[k]);
    if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) count++;
  }
  return count;
}
const frameTour = frame => frame.paths[0].concat(frame.paths[1].slice(1, -1).reverse());
function startProbe(run) {
  run.advancePreparation();
  const root = run.next; run.next = null; run.nextCompletion = 0;
  assert.ok(run.startCompletion(root));
  run.completion.relaxed.budget = 1;
  while (run.completion?.relaxed?.phase !== 'uncross') { run.step(); assert.equal(run.done, false); }
  return root;
}

test('После лимита 2-opt проба на 100 городах убирает оставшиеся пересечения в обоих режимах', async () => {
  for (const Solver of [VariableRouteSearch, StagedRouteSearch]) for (const field of [0, 1]) {
    const points = seriesField(100, field), run = new Solver(points), root = startProbe(run);
    const paths = root.paths.map(p => p.slice()), job = run.completion.relaxed;
    assert.ok(crossings(points, job.tour) > 0);
    assert.equal(run.relaxedLimited, 1);
    const mainSteps = run.mainSteps, checks = run.relaxedUncrossChecks;
    run.advance(7);
    assert.equal(run.relaxedUncrossChecks - checks, 7);
    const paused = [run.mainSteps, run.relaxedUncrossChecks, run.totalMs];
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual([run.mainSteps, run.relaxedUncrossChecks, run.totalMs], paused);
    while (run.completion?.relaxed) run.step();
    const last = run.relaxedTrace.frames.at(-1), tour = frameTour(last);
    assert.equal(last.phase, 'result');
    assert.equal(tour.length, 100); assert.equal(new Set(tour).size, 100);
    assert.equal(crossings(points, tour), 0);
    assert.equal(last.crossings, 0);
    assert.equal(run.relaxedTrace.remainingCrossings, 0);
    assert.ok(run.relaxedUncrossMoves > 0);
    assert.equal(run.relaxedUncrossLimited, 0);
    assert.equal(run.mainSteps, mainSteps);
    assert.deepEqual(root.paths, paths);
    assert.ok(job.checks <= run.n ** 3);
    assert.equal(measureRun(run).work.relaxedUncrossChecks, run.reportZeros().work.relaxedUncrossChecks);
  }
});

test('Распутывание копии может временно использовать запрещённое ребро без изменения маски точного поиска', () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const run = new StagedRouteSearch(points, 0);
  run.advancePreparation();
  run.best = { paths: [[0, 1, 2], [0, 3, 2]], len: [2, 2] };
  // Искусственная маска проверяет независимость пробной геометрии от запретов основного перебора.
  run.globalAllowed[0] &= ~run.bit[1]; run.globalAllowed[1] &= ~run.bit[0];
  run.stageThresholds[0] = 1;
  const masks = run.globalAllowed.slice(), best = run.best, root = run.next;
  const job = { tour: [0, 2, 1, 3], phase: 'uncross', i: 0, j: 2, checks: 0, budget: 64, uncrossMoves: 0 };
  run.completion = { root, relaxed: job };
  run.relaxedTrace = { frames: [], improvements: 0, uncross: { initialCrossings: 1 } };
  while (!run.stepRelaxedUncross(job)) {}
  assert.equal(crossings(points, job.tour), 0);
  assert.equal(run.relaxedUncrossMoves, 1);
  assert.ok(job.tour.some((a, i) => !(run.globalAllowed[a] & run.bit[job.tour[(i + 1) % job.tour.length]])));
  assert.deepEqual(run.globalAllowed, masks);
  assert.equal(run.best, best);
  assert.equal(run.next, root);
});

test('Исчерпание отдельного бюджета явно сохраняет число оставшихся пересечений и не отсекает исходное состояние', () => {
  const points = seriesField(100, 0), run = new VariableRouteSearch(points), root = startProbe(run);
  const paths = root.paths.map(p => p.slice()), previous = run.upper;
  run.completion.relaxed.budget = 1;
  while (run.completion?.relaxed) run.step();
  const last = run.relaxedTrace.frames.at(-1), remaining = crossings(points, frameTour(last));
  assert.ok(remaining > 0);
  assert.equal(last.crossings, remaining);
  assert.equal(run.relaxedTrace.remainingCrossings, remaining);
  assert.equal(run.relaxedTrace.uncross.limited, true);
  assert.match(last.label, /Лимит/);
  assert.equal(run.relaxedUncrossLimited, 1);
  assert.equal(run.relaxedCrossingsLeft, remaining);
  assert.equal(run.completionExhausted, 0);
  assert.equal(run.deadEndCuts, 0);
  assert.ok(run.upper <= previous);
  assert.deepEqual(root.paths, paths);
});
