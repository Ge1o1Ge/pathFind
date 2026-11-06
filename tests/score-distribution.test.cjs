'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EdgeAnalysis, VariableRouteSearch, seriesField, absoluteScoreBand, ABSOLUTE_SCORE_LIMITS,
  scoreDistributionMeasurements, scoreDistribution, emptyStats, addMeasurement, measureRun, statsReport } = require('../tools/lab.cjs');

function fixture() {
  const analysis = new EdgeAnalysis([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  analysis.advance();
  // Рёбра 01, 02, 03, 12, 13, 23; цикл использует 01, 03, 12, 23.
  [0, 1e-13, 0.05, 0.1, 0.7, 1].forEach((score, i) => { analysis.edges[i].initialScore = score; });
  return { done: true, edgeAnalysis: analysis, best: { paths: [[0, 1, 2], [0, 3, 2]] } };
}

test('Абсолютные корзины различают ноль и малые числа, включают границы без пропусков', () => {
  assert.equal(absoluteScoreBand(0), 0);
  assert.equal(absoluteScoreBand(Number.MIN_VALUE), 1);
  for (let i = 1; i < ABSOLUTE_SCORE_LIMITS.length - 1; i++) {
    const edge = ABSOLUTE_SCORE_LIMITS[i];
    assert.equal(absoluteScoreBand(edge), i + 1);
    assert.equal(absoluteScoreBand(edge * (1 - 1e-12)), i);
  }
  assert.equal(absoluteScoreBand(1), ABSOLUTE_SCORE_LIMITS.length - 1);
  for (const value of [-0.1, 1.1, NaN, Infinity, null]) assert.equal(absoluteScoreBand(value), -1);
});

test('Рёбра считаются один раз по исходным абсолютным баллам, без зависимости от медианы и последующих нулей', () => {
  const run = fixture(), before = scoreDistributionMeasurements(run);
  run.edgeAnalysis.edges.forEach(e => { e.score = 0; e.excluded = true; });
  run.edgeAnalysis.scoreReference.median = 1e-100;
  assert.deepEqual(scoreDistributionMeasurements(run), before);
  const row = emptyStats(4);
  addMeasurement(row, { values: {}, work: before }, 0);
  const result = scoreDistribution([row]);
  assert.equal(result.allEdges, 6);
  assert.equal(result.selectedEdges, 4);
  assert.equal(result.bins[0].selected, 1);
  assert.equal(result.bins[1].selected, 0);
  assert.equal(result.bins[absoluteScoreBand(0.05)].selected, 1);
  assert.equal(result.bins.at(-1).selected, 1);
  assert.equal(result.bins[absoluteScoreBand(0.1)].inclusionPercent, 100);
  assert.equal(result.bins[absoluteScoreBand(0.1)].routeSharePercent, 25);
  assert.equal(result.bins[absoluteScoreBand(0.4)].inclusionPercent, null);
  run.done = false;
  assert.deepEqual(scoreDistributionMeasurements(run), {});
});

test('Общий график суммирует рёбра, а не проценты; старые и незавершённые измерения не искажают знаменатель', () => {
  const work = scoreDistributionMeasurements(fixture()), a = emptyStats(4), b = emptyStats(10);
  const other = { ...work, edgeScoreBin0All: 100, edgeScoreBin0Selected: 10 };
  addMeasurement(a, { values: { length: 10 } }, 0);
  addMeasurement(a, { values: {}, work }, 1);
  assert.equal(addMeasurement(a, { values: {}, work }, 1), false);
  addMeasurement(b, { values: {}, work: other }, null);
  const result = scoreDistribution([a, b]);
  assert.equal(result.runs, 2);
  assert.equal(result.completedRuns, 3);
  assert.equal(result.unmeasuredRuns, 1);
  assert.equal(result.bins[0].inclusionPercent, 100 * 11 / 101);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.routeSharePercent, 0), 100);
  assert.equal(scoreDistribution([a, b], 4).runs, 1);
  assert.equal(scoreDistribution([a, b], 10).unmeasuredRuns, 0);
  assert.equal(scoreDistribution([a, b], 12).runs, 0);
  assert.ok(scoreDistribution([]).bins.every(b => b.inclusionPercent === null && b.routeSharePercent === null));
});

test('Итог поиска и JSON сохраняют полное число наблюдений и исходные оценки исключённых рёбер', () => {
  const run = new VariableRouteSearch(seriesField(16, 8));
  const unfinished = measureRun(run);
  assert.equal(unfinished.work.scoreDistributionRuns, undefined);
  run.advance();
  const row = emptyStats(16), measurement = measureRun(run);
  addMeasurement(row, measurement, 0);
  const report = JSON.parse(JSON.stringify(statsReport([row], undefined, 'hvastuns-var')));
  assert.equal(report.scoreDistribution.allEdges, 120);
  assert.equal(report.scoreDistribution.selectedEdges, 16);
  assert.equal(report.sizes[0].scoreDistribution.n, 16);
  const zeros = run.edgeAnalysis.edges.filter(e => e.initialScore === 0).length;
  assert.equal(report.scoreDistribution.bins[0].all, zeros);
  assert.ok(run.zeroEvents.length > zeros);
  assert.equal(report.scoreDistribution.runs, 1);
  assert.ok(report.scoreDistribution.bins.every(b => b.all >= b.selected));
  assert.equal(statsReport([row]).scoreDistribution, undefined);
});

test('Точный минимум сохраняет все цифры, старые замеры без корзин и фильтр размера', () => {
  const a = emptyStats(20), b = emptyStats(30), exact = 0.012345678901234567;
  addMeasurement(a, { values: {}, work: { routeScoreMin: 0.024 } }, 0);
  addMeasurement(a, { values: {}, work: { routeScoreMin: 0.026 } }, 1);
  addMeasurement(b, { values: {}, work: { routeScoreMin: exact } }, null);
  addMeasurement(b, { values: { length: 100 } }, null);
  const result = scoreDistribution([a, b]).selectedMinimum;
  assert.equal(result.value, exact);
  assert.equal(result.observedEmptyBelow, exact);
  assert.equal(result.provenCutoff, false);
  assert.equal(result.runs, 3);
  assert.equal(result.unmeasuredRuns, 1);
  assert.deepEqual(result.sizes, [30]);
  assert.equal(scoreDistribution([a, b], 20).selectedMinimum.value, 0.024);
  assert.equal(scoreDistribution([a, b], 30).selectedMinimum.value, exact);
  assert.equal(JSON.parse(JSON.stringify(statsReport([a, b], undefined, 'hvastuns-var'))).scoreDistribution.selectedMinimum.value, exact);
  addMeasurement(a, { values: {}, work: { routeScoreMin: exact } }, 2);
  assert.deepEqual(scoreDistribution([a, b]).selectedMinimum.sizes, [20, 30]);
  addMeasurement(b, { values: {}, work: { routeScoreMin: 0 } }, null);
  assert.equal(scoreDistribution([a, b]).selectedMinimum.value, 0);
  assert.equal(scoreDistribution([]).selectedMinimum.value, null);
});
