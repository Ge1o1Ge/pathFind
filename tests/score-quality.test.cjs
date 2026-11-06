'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EdgeAnalysis, VariableRouteSearch, seriesField, routeScoreQuality, routeScoreMeasurements,
  formatEdgeScore, measureRun, emptyStats, addMeasurement, statsReport } = require('../tools/lab.cjs');

function fixture(scores) {
  const analysis = new EdgeAnalysis([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  analysis.advance();
  analysis.edges.forEach((edge, i) => { edge.score = edge.initialScore = scores[i]; });
  return analysis;
}
const paths = [[0, 1, 2], [0, 3, 2]];

test('Качество ранжирования: медиана положительных оценок, границы групп и не вошедшие рёбра', () => {
  // Порядок рёбер: 01, 02, 03, 12, 13, 23. В цикл входят 01, 03, 12, 23.
  const analysis = fixture([0, 0.1, 0.2, 0.3, 0.4, 0.5]), result = routeScoreQuality(analysis, paths);
  assert.equal(result.median, 0.3);
  assert.equal(result.min, 0);
  assert.equal(result.mean, 0.25);
  assert.equal(result.meanRelative, 0.25 / 0.3);
  assert.deepEqual([result.likelyEdges, result.likelySelected, result.likelyMissed, result.belowMedian], [3, 2, 1, 2]);
  assert.deepEqual(result.branches.map(b => [b.min, b.mean]), [[0, 0.15], [0.2, 0.35]]);
  assert.equal(result.bands.reduce((sum, b) => sum + b.all, 0), 6);
  assert.equal(result.bands.reduce((sum, b) => sum + b.selected, 0), 4);
  assert.equal(result.bands[0].selectedPercent, 100);
  assert.equal(result.bands[3].all, 3);
  assert.equal(result.bands[3].selected, 2);
  analysis.edges.forEach(e => { e.score = 0; e.excluded = true; });
  assert.deepEqual(routeScoreQuality(analysis, paths.map(p => p.slice())), result);
});

test('Относительные показатели не меняются при общем падении оценок; равенство медиане включено', () => {
  const scores = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const normal = routeScoreQuality(fixture(scores), paths), tiny = routeScoreQuality(fixture(scores.map(s => s * 1e-10)), paths);
  assert.ok(Math.abs(normal.meanRelative - tiny.meanRelative) < 1e-12);
  assert.equal(normal.likelyMissed, tiny.likelyMissed);
  assert.deepEqual(normal.bands, tiny.bands);
  assert.notEqual(formatEdgeScore(tiny.mean), '0');
  assert.ok(formatEdgeScore(tiny.mean).includes('e-'));
  const equal = routeScoreQuality(fixture(Array(6).fill(0.2)), paths);
  assert.deepEqual([equal.likelyEdges, equal.likelySelected, equal.likelyMissed, equal.minRelative], [6, 4, 2, 1]);
  assert.equal(routeScoreQuality(fixture([0, 0, 0.1, 0.2, 0.3, 0.4]), paths).median, 0.25);
});

test('Исходные оценки сохраняются после запретов; статистика и JSON учитывают только новые замеры', () => {
  const run = new VariableRouteSearch(seriesField(16, 8));
  assert.equal(routeScoreQuality(run.edgeAnalysis, run.best.paths), null);
  run.advance();
  assert.ok(run.edgeAnalysis.edges.some(e => e.initialScore > 0 && e.score === 0));
  const quality = routeScoreQuality(run.edgeAnalysis, run.best.paths), measurement = measureRun(run);
  const row = emptyStats(16);
  addMeasurement(row, { values: { length: 300 } }, 0);
  addMeasurement(row, measurement, 1);
  const metric = statsReport([row], undefined, 'hvastuns-var').sizes[0].metrics.routeScoreMin;
  assert.deepEqual(metric, { min: quality.min, max: quality.min, sum: quality.min, mean: quality.min, samples: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(run.reportZeros())).scoreQuality, quality);
  assert.equal(measurement.work.likelyMissed, quality.likelyMissed);
  assert.ok(Object.values(routeScoreMeasurements(quality)).every(Number.isFinite));
  assert.equal(quality.count, run.n);
});
