'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VariableRouteSearch, generateField, SCORE_COMPONENTS, measureRun, scoreDistribution, emptyStats, addMeasurement,
  routeScoreQuality, absoluteScoreBand, statsReport } = require('../tools/lab.cjs');

test('Каждая составляющая имеет свои корзины, точный минимум и неизменные исходные множители', () => {
  const profile = { type: 'clusters', groups: 2, separation: 10 };
  const run = new VariableRouteSearch(generateField(12, 5, profile));
  run.advance();
  assert.ok(run.done);
  const row = emptyStats(12), quality = routeScoreQuality(run.edgeAnalysis, run.best.paths), chosen = new Set(quality.chosenEdges.map(e => e.id));
  const original = measureRun(run);
  addMeasurement(row, original, 0);
  for (const key of Object.keys(SCORE_COMPONENTS)) {
    const score = e => key === 'combined' ? e.initialScore : e.initialParts[key];
    const result = scoreDistribution([row], null, key), selected = run.edgeAnalysis.edges.filter(e => chosen.has(e.id));
    assert.equal(result.allEdges, 66);
    assert.equal(result.selectedEdges, 12);
    assert.equal(result.selectedMinimum.value, Math.min(...selected.map(score)));
    assert.equal(result.runs, 1);
    for (const bin of result.bins) {
      assert.equal(bin.all, run.edgeAnalysis.edges.filter(e => absoluteScoreBand(score(e)) === bin.index).length);
      assert.equal(bin.selected, selected.filter(e => absoluteScoreBand(score(e)) === bin.index).length);
    }
    const saved = JSON.stringify(result);
    for (const edge of run.edgeAnalysis.edges) { edge.score = 0; edge.bound = 1e12; }
    assert.equal(JSON.stringify(scoreDistribution([row], null, key)), saved);
  }
  assert.deepEqual(measureRun(run).work, original.work);
  const report = JSON.parse(JSON.stringify(statsReport([row], undefined, 'hvastuns-var', 'normal', profile)));
  assert.equal(report.fieldProfile.groups, 2);
  assert.equal(Object.keys(report.scoreDistributions).length, 4);
  assert.equal(report.scoreDistributions.crossings.selectedMinimum.value, report.scoreDistribution.selectedMinimum.value);
});

test('Старые общие баллы не подменяют отсутствующие замеры составляющих, режимы не теряют прежний минимум', () => {
  const old = emptyStats(8), run = new VariableRouteSearch(generateField(8, 1));
  run.advance();
  const measured = measureRun(run), legacy = { ...measured, work: Object.fromEntries(Object.entries(measured.work)
    .filter(([key]) => !/^score(Length|Crossings|Bound)/.test(key))) };
  addMeasurement(old, legacy, 0);
  assert.equal(scoreDistribution([old]).runs, 1);
  assert.equal(scoreDistribution([old], null, 'crossings').runs, 0);
  assert.equal(scoreDistribution([old], null, 'crossings').selectedMinimum.value, null);
  addMeasurement(old, measured, 1);
  const parts = scoreDistribution([old], null, 'crossings');
  assert.equal(parts.runs, 1);
  assert.equal(parts.unmeasuredRuns, 1);
  assert.equal(parts.allEdges, 28);
  assert.equal(parts.selectedMinimum.runs, 1);
  assert.equal(scoreDistribution([old]).runs, 2);
});
