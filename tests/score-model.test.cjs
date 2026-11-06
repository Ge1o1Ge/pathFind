'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EdgeAnalysis, createRouteSearch, createSeriesRunner, generateField, seriesField, routeDistance,
  measureRun, emptyStats, addMeasurement, statsReport, statsDatabaseName, fieldProfileKey,
  CURRENT_SCORE_MODEL, LEGACY_SCORE_MODEL, scoreModelInfo } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

test('Балл v2 убирает внешние штрафы, сохраняя веса пересечений, нижние границы и строгие нули', () => {
  const profiles = [{ type: 'uniform' }, { type: 'clusters', groups: 2, separation: 1000 },
    { type: 'clusters', groups: 5, separation: 10 }, { type: 'outlier', separation: 50 },
    { type: 'convex' }, { type: 'grid' }];
  let rescued = 0, zeros = 0;
  for (const profile of profiles) {
    const points = generateField(16, 3, profile), current = new EdgeAnalysis(points), legacy = new EdgeAnalysis(points, false, LEGACY_SCORE_MODEL);
    current.advance(); legacy.advance();
    for (const e of current.edges) {
      const old = legacy.edges[e.id];
      for (const key of ['weight', 'burden', 'shorterCrossings', 'crossings', 'excluded', 'bound', 'extra']) assert.equal(e[key], old[key]);
      assert.deepEqual(e.initialParts, old.initialParts);
      assert.deepEqual(current.conflictIds(e.id), legacy.conflictIds(e.id));
      assert.equal(e.initialScore, e.excluded ? 0 : Math.max(Number.MIN_VALUE, Math.exp(-e.burden)));
      assert.equal(old.initialScore, e.excluded ? 0 : Math.max(Number.MIN_VALUE, e.weight * Math.exp(-e.burden - e.extra / legacy.scale)));
      if (!e.excluded && old.initialScore < 1e-20 && e.initialScore > 0.1) rescued++;
      if (e.excluded) zeros++;
    }
    assert.equal(current.report().scoreModel, CURRENT_SCORE_MODEL);
    assert.equal(legacy.report().scoreModel, LEGACY_SCORE_MODEL);
    assert.ok(current.report().formula.endsWith(scoreModelInfo(CURRENT_SCORE_MODEL).formula));
  }
  assert.ok(rescued > 0 && zeros > 0);
  assert.throws(() => new EdgeAnalysis(seriesField(4, 0), false, 'unknown'));
});

test('Обе формулы сохраняют оптимумы DP; экспорт сообщает формулу использованных измерений', () => {
  for (const profile of [{ type: 'clusters', groups: 2, separation: 100 }, { type: 'clusters', groups: 5, separation: 10 },
    { type: 'outlier', separation: 50 }, { type: 'convex' }, { type: 'grid', columns: 4 }]) {
    const points = generateField(12, 17, profile), optimum = heldKarp(points.map(a => points.map(b => routeDistance(a, b)))).length;
    for (const algorithm of ['hvastuns-var', 'hvastuns-staged']) for (const model of [CURRENT_SCORE_MODEL, LEGACY_SCORE_MODEL]) {
      const run = createRouteSearch(algorithm, points, 0, false, undefined, model);
      run.advance(100000);
      assert.ok(run.done);
      assert.ok(Math.abs(run.upper - optimum) < 1e-7);
      const row = emptyStats(points.length), measurement = measureRun(run);
      addMeasurement(row, measurement, 0);
      const report = statsReport([row], undefined, algorithm, 'normal', profile, model);
      assert.equal(measurement.scoreModel, model);
      assert.equal(report.scoreModel, model);
      assert.equal(report.scoreFormula, scoreModelInfo(model).formula);
      assert.equal(report.scoreDistribution.formula, report.scoreFormula);
      assert.equal(report.scoreDistribution.selectedEdges, points.length);
    }
  }
});

test('Базы v2 отделены от точных прежних адресов по алгоритму, геометрии и режиму', () => {
  const names = [];
  for (const algorithm of ['hvastuns-var', 'hvastuns-staged']) for (const kind of ['normal', 'proof']) {
    for (const profile of [{ type: 'uniform' }, { type: 'clusters', groups: 2, separation: 10 }]) {
      const base = 'atlas-route-statistics-v1-' + algorithm + (kind === 'proof' ? '-proof' : '');
      const field = fieldProfileKey(profile) ? '-field-' + fieldProfileKey(profile) : '';
      const legacy = statsDatabaseName(algorithm, kind, profile, LEGACY_SCORE_MODEL), current = statsDatabaseName(algorithm, kind, profile);
      assert.equal(legacy, base + field);
      assert.equal(current, base + '-score-' + CURRENT_SCORE_MODEL + field);
      names.push(legacy, current);
    }
  }
  assert.equal(new Set(names).size, names.length);
  for (const algorithm of ['khvastuns', 'hvastuns-4', 'held']) {
    assert.equal(statsDatabaseName(algorithm), statsDatabaseName(algorithm, 'normal', undefined, LEGACY_SCORE_MODEL));
  }
});

function workerResult(message) {
  return new Promise((resolve, reject) => {
    const command = createSeriesRunner(result => {
      if (result.error) reject(new Error(result.error));
      else if (result.done) resolve(result);
    }, 2);
    command({ type: 'start', ...message });
  });
}

test('Старая вкладка без версии получает v1; новый worker сохраняет версию и в подтверждении', async () => {
  const points = seriesField(14, 6);
  for (const algorithm of ['hvastuns-var', 'hvastuns-staged']) for (const proofSeries of [false, true]) {
    const old = await workerResult({ algorithm, points, proofSeries });
    const explicitOld = await workerResult({ algorithm, points, proofSeries, scoreModel: LEGACY_SCORE_MODEL });
    const current = await workerResult({ algorithm, points, proofSeries, scoreModel: CURRENT_SCORE_MODEL });
    assert.equal(old.measurement.scoreModel, LEGACY_SCORE_MODEL);
    assert.equal(current.measurement.scoreModel, CURRENT_SCORE_MODEL);
    assert.equal(old.measurement.work.mainSteps, explicitOld.measurement.work.mainSteps);
    assert.equal(old.measurement.work.referenceMainSteps, explicitOld.measurement.work.referenceMainSteps);
    assert.equal(old.measurement.work.routeScoreMin, explicitOld.measurement.work.routeScoreMin);
    assert.ok(current.measurement.work.routeScoreMin > old.measurement.work.routeScoreMin);
    assert.ok(Math.abs(current.measurement.values.length - old.measurement.values.length) < 1e-7);
    if (proofSeries) {
      const direct = createRouteSearch(algorithm, points);
      direct.advance();
      assert.equal(current.measurement.work.referenceMainSteps, direct.mainSteps);
    }
  }
});
