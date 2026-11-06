'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { separatedClusters } = require('../tools/boundary-fields.cjs');
const { inspectClusterCutoffs } = require('../tools/check-cluster-cutoffs.cjs');
const { VariableRouteSearch, StagedRouteSearch } = require('../tools/lab.cjs');

test('Порог полного балла разрывает два скопления, хотя штраф пересечений нужных рёбер близок к единице', () => {
  const near = inspectClusterCutoffs(separatedClusters(16, 8, 2));
  const far = inspectClusterCutoffs(separatedClusters(16, 8, 10));
  for (const row of [near, far]) {
    assert.equal(row.cutoffs[0].bridgesRetained, 0);
    assert.equal(row.cutoffs[0].components, 2);
    assert.equal(row.cutoffs[0].selectedBelow, 2);
    assert.equal(row.cutoffs[0].selectedBelowCrossingOnly, 0);
    assert.equal(row.selectedBridges.length, 2);
    assert.ok(row.minimumCrossingFactorSelected > 0.01);
    for (const edge of row.selectedBridges) {
      const product = Object.values(edge.factors).reduce((a, b) => a * b, 1);
      assert.ok(Math.abs(product / edge.score - 1) < 1e-12);
      assert.ok(edge.negativeLog10.forcedBound > edge.negativeLog10.crossings);
    }
  }
  assert.ok(far.minimumSelected < near.minimumSelected * 1e-15);
  assert.ok(far.selectedBridges.every(e => e.factors.crossings > 0.99));
});

test('Слабые соединительные рёбра и минимальный положительный Number сохраняются в обоих точных режимах', () => {
  for (const separation of [2, 5, 25, 1000]) {
    const field = separatedClusters(16, 8, separation), reference = inspectClusterCutoffs(field);
    if (separation === 1000) assert.equal(reference.maximumBridgeScore, Number.MIN_VALUE);
    for (const Solver of [VariableRouteSearch, StagedRouteSearch]) {
      const run = new Solver(field.points);
      run.advance(100000);
      assert.ok(run.done);
      assert.ok(Math.abs(run.upper - reference.optimum) < 1e-8);
      for (const path of run.best.paths) for (let i = 1; i < path.length; i++) {
        const edge = run.edge(path[i - 1], path[i]);
        assert.ok(!edge.excluded);
        assert.ok(edge.initialScore > 0);
      }
    }
  }
});
