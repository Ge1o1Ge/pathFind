'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouteSearch, seriesField, routeDistance, tourFromBest, measureRun } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');
const algorithms = ['khvastuns', 'hvastuns-4', 'hvastuns-var', 'hvastuns-staged'];

test('Готовый оптимум принят с нулевого шага и подтверждается без разминки в четырёх алгоритмах', () => {
  for (let n = 3; n <= 12; n++) for (let field = 0; field < 6; field++) for (const integer of [false, true]) {
    const points = seriesField(n, field), optimum = heldKarp(points.map(p => points.map(q => routeDistance(p, q, integer))));
    for (const algorithm of algorithms) {
      const input = optimum.tour.slice().reverse(), snapshot = input.slice();
      const run = createRouteSearch(algorithm, points, undefined, integer, input), seed = run.best;
      assert.equal(run.mainSteps, 0);
      assert.equal(run.bestStep, 0);
      assert.equal(run.history[0].step, 0);
      assert.ok(Math.abs(seed.len[0] + seed.len[1] - optimum.length) < 1e-7);
      assert.equal(run.warmupCount, 0);
      assert.equal(run.warmupMs, 0);
      assert.equal(run.warmupCandidates, 0);
      run.advance();
      assert.equal(run.done, true);
      assert.ok(Math.abs(run.best.len[0] + run.best.len[1] - optimum.length) < 1e-7);
      assert.equal(new Set(tourFromBest(run)).size, n);
      assert.deepEqual(input, snapshot);
      assert.equal(measureRun(run).work.warmupCycles, 0);
    }
  }
});

test('Переданный неоптимальный и пересекающийся цикл не подменяет доказательство и может быть улучшен', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  for (const algorithm of algorithms) {
    const run = createRouteSearch(algorithm, points, undefined, false, [0, 2, 1, 3]);
    assert.ok(run.best.len[0] + run.best.len[1] > 40);
    assert.equal(run.done, false);
    run.advance();
    assert.equal(run.best.len[0] + run.best.len[1], 40);
    assert.equal(run.done, true);
  }
});

test('Неполные циклы и повторные города не принимаются как начальный рекорд', () => {
  const points = seriesField(4, 0);
  for (const algorithm of algorithms) for (const tour of [null, [], [0, 1, 2], [0, 1, 1, 3], [0, 1, 2, 4], [0, 1, 2, 3.5], [0, 1, 2, 3, 0]]) {
    assert.throws(() => createRouteSearch(algorithm, points, undefined, false, tour), /Начальный цикл/);
  }
});

test('Готовый цикл на большом поле использует старшие биты и сохранённый оптимум Concorde', () => {
  const points = seriesField(40, 0), baseline = createRouteSearch('khvastuns', points, undefined, true);
  baseline.advance();
  assert.equal(baseline.best.len[0] + baseline.best.len[1], 404212);
  for (const algorithm of algorithms) {
    const run = createRouteSearch(algorithm, points, undefined, true, tourFromBest(baseline));
    run.advance(100000);
    assert.equal(run.done, true);
    assert.equal(run.best.len[0] + run.best.len[1], 404212);
    assert.equal(new Set(tourFromBest(run)).size, 40);
  }
});
