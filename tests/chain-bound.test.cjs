'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VariableRouteSearch, StagedRouteSearch, seriesField, measureRun } = require('../tools/lab.cjs');
const { boundaryFields } = require('../tools/boundary-fields.cjs');

test('Оценка двух закреплённых ветвей не превышает ни одного совместимого полного цикла', () => {
  let checked = 0;
  for (const field of boundaryFields(7).slice(0, 9)) for (const integer of [false, true]) {
    const run = new VariableRouteSearch(field.points, 0, integer), root = run.next;
    run.advancePreparation();
    function visit(tour, free) {
      if (free.length) {
        for (const city of free) visit([...tour, city], free.filter(i => i !== city));
        return;
      }
      const edges = tour.map((a, i) => [a, tour[(i + 1) % run.n]]);
      if (edges.some(([a, b]) => !(run.globalAllowed[a] & run.bit[b]))) return;
      const length = edges.reduce((sum, [a, b]) => sum + run.dist[a][b], 0);
      const split = tour.indexOf(run.b), paths = [tour.slice(0, split + 1), [run.a].concat(tour.slice(split).reverse())];
      for (let left = 1; left <= paths[0].length; left++) for (let right = 1; right <= paths[1].length; right++) {
        let state = root;
        for (let i = 1; i < left; i++) state = run.extend(state, 0, paths[0][i]);
        for (let i = 1; i < right; i++) state = run.extend(state, 1, paths[1][i]);
        if (edges.some(([a, b]) => !(state.allowed[a] & run.bit[b]))) continue;
        const bound = run.combinationBound(state);
        assert.ok(bound <= length + 1e-8, `${field.name}: ${bound} > ${length}`);
        checked++;
      }
    }
    visit([run.a], Array.from({ length: run.n }, (_, i) => i).filter(i => i !== run.a));
  }
  assert.ok(checked > 10000, String(checked));
});

test('Нехватка связей исключает только состояние; новый глобальный запрет обновляет кеш оценки', () => {
  const run = new VariableRouteSearch(seriesField(12, 8), 0);
  run.advancePreparation();
  const root = run.next, before = run.candidateBound(root), evaluations = run.combinationEvaluations;
  assert.ok(Number.isFinite(before));
  run.candidateBound(root);
  assert.equal(run.combinationEvaluations, evaluations);
  assert.ok(run.combinationCacheHits > 0);
  const edge = run.edgeAnalysis.edges.find(e => !e.excluded && !e.required);
  // Искусственный запрет проверяет обновление кеша, а не обоснование самого глобального запрета.
  run.banEdge(edge, 'bound', 'Тест обновления оценки комбинации');
  const after = run.candidateBound(root);
  assert.ok(after >= before);
  assert.equal(run.combinationEvaluations, evaluations + 1);
  const zeros = run.zeroEvents.length, masks = run.globalAllowed.slice();
  const dead = { ...root, allowed: root.allowed.slice(), combinationVersion: undefined };
  dead.allowed[run.a] = run.bit[run.b];
  assert.equal(run.candidateBound(dead), Infinity);
  assert.ok(run.combinationImpossible > 0);
  assert.equal(run.zeroEvents.length, zeros);
  assert.deepEqual(run.globalAllowed, masks);
});

test('Короткое закреплённое ребро не используется повторно для заполнения свободных степеней', () => {
  const run = new VariableRouteSearch([0, 1, 99, 100].map(x => ({ x, y: 0 })), 0);
  run.advancePreparation();
  const state = run.extend(run.next, 0, 1);
  // Ребро 0–1 уже занято. Оставшиеся минимумы: 99, 98, 1+98, 1+99; вместе с F оценка равна 199.
  assert.ok(Math.abs(run.combinationBound(state) - 199) < 1e-8);
  assert.equal(run.zeroEvents.length, 0);
});

test('Логарифмы обновляются по добавленному ребру и не теряют очень малые положительные баллы', () => {
  const run = new VariableRouteSearch(Array.from({ length: 8 }, (_, x) => ({ x, y: 0 })), 0);
  run.advancePreparation();
  const root = run.next, cities = run.points.map((_, i) => i).filter(i => i !== run.a && i !== run.b);
  run.edge(run.a, cities[0]).initialScore = 1e-300;
  run.edge(cities[0], cities[1]).initialScore = 1e-250;
  const first = run.extend(root, 0, cities[0]), second = run.extend(first, 0, cities[1]);
  assert.deepEqual(run.chainSummary(root).logSums, [0, 0]);
  const summary = run.chainSummary(second), expected = -Math.log(1e-300) - Math.log(1e-250);
  assert.equal(summary.logSums[0], expected);
  assert.equal(summary.meanPenalty, expected / 2);
  assert.equal(summary.meanPenalties[1], 0);
  assert.equal(run.chainSummary(first).meanPenalty, -Math.log(1e-300));
  assert.ok(Number.isFinite(summary.meanPenalty));
  assert.equal(run.zeroEvents.some(e => e.edge === run.edge(run.a, cities[0]).id), false);
});

test('Новые измерения входят в оба варианта и не меняются во время паузы', async () => {
  let raised = 0, cuts = 0;
  for (const Solver of [VariableRouteSearch, StagedRouteSearch]) {
    const run = new Solver(seriesField(16, 8), 0);
    run.advance(200);
    const snapshot = [run.mainSteps, run.combinationEvaluations, run.combinationMs];
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.deepEqual([run.mainSteps, run.combinationEvaluations, run.combinationMs], snapshot);
    run.advance();
    raised += run.combinationRaised; cuts += run.combinationCuts;
    const work = measureRun(run).work, report = run.reportZeros();
    assert.equal(work.combinationEvaluations, run.combinationEvaluations);
    assert.equal(report.chain.best.edgeCount, run.n);
    assert.ok(work.combinationMs <= work.totalMs);
  }
  assert.ok(raised > 0 && cuts > 0);
});
