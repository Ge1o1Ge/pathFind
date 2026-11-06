'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compileFunction } = require('node:vm');
const { heldKarp } = require('../dist/held-karp.js');
const production = require('../tools/lab.cjs');

// Включаем оценку больших полей на малых входах, где доступен независимый точный контроль.
// Маленький кеш заставляет многократно пройти ветку вытеснения записей.
const source = ['fields.js', 'one-tree.js', 'search.js', 'search-four.js']
  .map(file => readFileSync(join(__dirname, '../dist', file), 'utf8')).join('\n')
  .replace('if (this.wide && this.bound < record)', 'if (this.bound < record)')
  .replace('const MAX_SEEN_STATES = 1_000_000;', 'const MAX_SEEN_STATES = 16;')
  .replace('const MAX_TREE_STATES = 16_000;', 'const MAX_TREE_STATES = 16;')
  .replace('const INITIAL_QUEUE_LIMIT = 4_000;', 'const INITIAL_QUEUE_LIMIT = 4;')
  .replace('const MAX_QUEUE_LIMIT = 32_000;', 'const MAX_QUEUE_LIMIT = 32;')
  .replace('const QUEUE_STALL_STEPS = 25_000;', 'const QUEUE_STALL_STEPS = 8;')
  .replaceAll('if (!this.wide) return;', '')
  .replace('else if (this.wide) this.seenOrder.push(key);', 'else this.seenOrder.push(key);')
  .replace('else if (this.wide) this.treeOrder.push(free);', 'else this.treeOrder.push(free);');
const { OneTreeBound, RouteSearch, createRouteSearch, seriesField, routeDistance } =
  compileFunction(source + ';return {OneTreeBound,RouteSearch,createRouteSearch,seriesField,routeDistance};')();

test('Усиленная оценка и вытеснения кеша сохраняют оптимум с разминкой и без неё', () => {
  let evictions = 0, treeEvictions = 0, queueLimit = 0;
  for (let n = 3; n <= 13; n++) for (let field = 0; field < 12; field++) {
    const points = seriesField(n, field);
    for (const integer of [false, true]) {
      const d = points.map(p => points.map(q => routeDistance(p, q, integer)));
      const optimal = heldKarp(d).length;
      for (const algorithm of ['khvastuns', 'hvastuns-4']) for (const limit of [0, n - 2]) {
        const run = createRouteSearch(algorithm, points, limit, integer);
        while (!run.done) {
          assert.ok(run.bound <= optimal + 1e-8);
          run.advance(7);
          assert.ok(run.seen.size <= 16);
          assert.ok(run.trees.size <= 16);
          queueLimit = Math.max(queueLimit, run.queueLimit);
        }
        const [out, back] = run.best.paths, tour = out.concat(back.slice(1, -1).reverse());
        assert.equal(tour.length, n);
        assert.equal(new Set(tour).size, n);
        assert.ok(Math.abs(run.bound - optimal) < 1e-8);
        assert.ok(Math.abs(tour.reduce((sum, i, j) => sum + d[i][tour[(j + 1) % n]], 0) - optimal) < 1e-8);
        evictions += run.memoEvictions;
        treeEvictions += run.treeEvictions;
      }
    }
  }
  assert.ok(evictions > 0);
  assert.ok(treeEvictions > 0);
  assert.equal(queueLimit, 32);
});

test('Оценка с фиксированными рёбрами не превышает ни одного допустимого завершения', () => {
  const n = 7, points = seriesField(n, 5);
  const d = points.map(p => points.map(q => routeDistance(p, q)));
  const estimate = new OneTreeBound(d, heldKarp(d).length);
  function visit(prefix, free) {
    if (free.length) {
      for (const city of free) visit([...prefix, city], free.filter(i => i !== city));
      return;
    }
    const cycle = [...prefix, 0];
    const length = prefix.reduce((sum, i, j) => sum + d[i][cycle[j + 1]], 0);
    for (const paths of [[], [cycle], [cycle.slice(0, 3)], [cycle.slice(0, 3), cycle.slice(4, 7)],
      [cycle.slice(0, 2), cycle.slice(2, 4), cycle.slice(4, 6), cycle.slice(6)]]) {
      assert.ok(estimate.bound(paths) <= length + 1e-9);
    }
  }
  visit([0], [1, 2, 3, 4, 5, 6]);
});

test('Кеш хранит меньшую цену и после заполнения принимает новые состояния', () => {
  const run = new RouteSearch(seriesField(5, 0), 0);
  for (let i = 0; i < 100; i++) run.rememberState(i, 10, undefined);
  assert.equal(run.seen.size, 16);
  assert.equal(run.memoEvictions, 84);
  assert.equal(run.seen.get(99), 10);
  run.rememberState(99, 10 + 1e-11, 10);
  assert.equal(run.seen.get(99), 10);
  run.rememberState(99, 9, 10);
  assert.equal(run.seen.get(99), 9);
});

test('Обычный вход на 40 городах использует усиленную оценку и совпадает с Concorde', () => {
  const points = production.seriesField(40, 0);
  // Оптимум этого поля подтверждён отдельным запуском Concorde на ceil(1000 × расстояние).
  for (const algorithm of ['khvastuns', 'hvastuns-4', 'hvastuns-var', 'hvastuns-staged']) {
    const run = production.createRouteSearch(algorithm, points, undefined, true);
    assert.ok(run.oneTree);
    run.advance(100000);
    assert.ok(run.done);
    assert.equal(run.best.len[0] + run.best.len[1], 404212);
    assert.ok(run.duplicateCuts > 0);
  }
});
