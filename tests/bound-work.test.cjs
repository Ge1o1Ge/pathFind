'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compileFunction } = require('node:vm');
const { heldKarp } = require('../dist/held-karp.js');

// Усиление больших полей проверяем на малых, доступных независимому DP и полному перебору.
const source = ['fields.js', 'one-tree.js', 'search.js', 'edge-analysis.js', 'score-quality.js', 'search-var.js', 'search-staged.js']
  .map(file => readFileSync(join(__dirname, '../dist', file), 'utf8')).join('\n')
  .replace('if (this.wide && this.bound < record)', 'if (this.bound < record)');
const { RouteSearch, VariableRouteSearch, StagedRouteSearch, seriesField } =
  compileFunction(source + ';return {RouteSearch,VariableRouteSearch,StagedRouteSearch,seriesField};')();

test('Достигшая рекорда оценка не запускает остальные расчёты, оставшиеся варианты получают прежний максимум', () => {
  const run = new RouteSearch(seriesField(8, 5), 0), original = run.next;
  const direct = run.dist[run.a][run.b] * 2;
  let trees = 0, msts = 0;
  run.oneTree = { bound: () => { trees++; return direct + 30; } };
  run.lowerBound = () => { msts++; return direct + 50; };
  run.best = { len: [direct, 0] };
  assert.equal(run.candidateBound({ ...original, bound: undefined }), direct);
  assert.equal(trees + msts, 0);
  run.best.len = [direct + 25, 0];
  const cut = { ...original, bound: undefined };
  assert.equal(run.candidateBound(cut), direct + 30);
  assert.equal(trees, 1);
  assert.equal(msts, 0);
  run.best.len = [direct + 20, 0];
  assert.equal(run.candidateBound(cut), direct + 30);
  assert.equal(trees, 1);
  run.best.len = [direct + 100, 0];
  assert.equal(run.candidateBound({ ...original, bound: undefined }), direct + 50);
  assert.equal(trees, 2);
  assert.equal(msts, 1);
});

test('Глобальные нули 1-дерева сохраняют оптимум DP в обеих метриках и вариантах поиска', () => {
  let extraCuts = 0, checks = 0;
  for (let n = 5; n <= 12; n++) for (let index = 0; index < 8; index++) {
    const points = index === 6 ? Array.from({ length: n }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) })) :
      index === 7 ? Array.from({ length: n }, (_, i) => ({ x: i % 4, y: 0 })) : seriesField(n, index);
    for (const Solver of [VariableRouteSearch, StagedRouteSearch]) for (const integer of [false, true]) {
      const run = new Solver(points, 0, integer), optimal = heldKarp(run.dist).length;
      while (!run.done) { run.advance(31); assert.ok(run.bound <= optimal + 1e-7); }
      assert.ok(Math.abs(run.upper - optimal) < 1e-7);
      for (const path of run.best.paths) for (let i = 1; i < path.length; i++) assert.ok(!run.edge(path[i - 1], path[i]).excluded);
      extraCuts += run.edgeOneTreeCuts; checks += run.edgeOneTreeChecks;
      const before = run.edgeOneTreeChecks;
      for (const edge of run.edgeAnalysis.edges) run.checkEdgeBound(edge);
      assert.equal(run.edgeOneTreeChecks, before);
    }
  }
  assert.ok(checks > 0);
  assert.ok(extraCuts > 0);
});

test('Оценка обязательного ребра не превышает ни одного содержащего его тура, равные оптимумы сохранены', () => {
  const fields = [seriesField(7, 12), Array.from({ length: 7 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) })),
    Array.from({ length: 7 }, (_, x) => ({ x, y: 0 }))];
  for (const points of fields) for (const integer of [false, true]) {
    const run = new VariableRouteSearch(points, 0, integer);
    run.advance();
    function visit(path, free, length) {
      if (free.length) {
        for (const city of free) visit([...path, city], free.filter(i => i !== city), length + run.dist[path.at(-1)][city]);
        return;
      }
      length += run.dist[path.at(-1)][path[0]];
      for (let i = 0; i < path.length; i++) {
        const edge = run.edge(path[i], path[(i + 1) % path.length]);
        if (edge.oneTreeBound !== undefined) assert.ok(edge.oneTreeBound <= length + 1e-8);
        if (Math.abs(length - run.upper) < 1e-8) assert.equal(edge.excluded, false);
      }
    }
    visit([0], points.map((_, i) => i).slice(1), 0);
  }
});
