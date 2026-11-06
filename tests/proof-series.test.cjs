'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeriesRunner, createRouteSearch, seriesField, tourFromBest, emptyStats, addMeasurement, statsReport, CURRENT_SCORE_MODEL } = require('../tools/lab.cjs');

function calculate(message) {
  return new Promise((resolve, reject) => {
    const command = createSeriesRunner(result => {
      if (result.error) reject(new Error(result.error));
      else if (result.done) resolve(result);
    }, 2);
    command({ type: 'start', scoreModel: CURRENT_SCORE_MODEL, ...message });
  });
}

test('Серия подтверждения повторяет свежий поиск с оптимумом; первый запуск учитывается отдельно', async () => {
  for (const algorithm of ['khvastuns', 'hvastuns-4', 'hvastuns-var', 'hvastuns-staged']) {
    const points = seriesField(16, 8), normal = createRouteSearch(algorithm, points);
    normal.advance();
    const proof = createRouteSearch(algorithm, points, 0, false, tourFromBest(normal));
    proof.advance();
    const result = await calculate({ algorithm, points, proofSeries: true, returnTour: true });
    const { work, values } = result.measurement;
    assert.equal(result.proofSeries, true);
    assert.equal(result.phase, 'proof');
    assert.equal(work.mainSteps, proof.mainSteps);
    assert.equal(work.referenceMainSteps, normal.mainSteps);
    assert.equal(work.referenceCompletionChecks, normal.completionChecks);
    assert.equal(work.warmupCycles, 0);
    assert.equal(work.warmupCandidates, 0);
    assert.equal(values.bestStep, 0);
    assert.ok(Math.abs(values.length - normal.best.len.reduce((a, b) => a + b)) < 1e-7);
    assert.deepEqual(result.tour, tourFromBest(proof));
    assert.equal(work.pairTotalMs, work.referenceTotalMs + work.totalMs);
    assert.ok(work.referenceTotalMs > 0 && work.totalMs > 0);
  }
});

test('Стоп работает до первого поиска и на границе этапов; продолжение даёт ровно один результат', async () => {
  const messages = [];
  let pausedAtProof = false, command, resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const boundary = new Promise(resolve => {
    command = createSeriesRunner(message => {
      messages.push(message);
      if (message.error) rejectDone(new Error(message.error));
      else if (message.done) resolveDone(message);
      else if (message.phase === 'proof' && !pausedAtProof) {
        pausedAtProof = true;
        command({ type: 'pause' });
        resolve();
      }
    }, 1);
  });
  command({ type: 'start', algorithm: 'hvastuns-var', points: seriesField(16, 8), proofSeries: true });
  command({ type: 'pause' });
  assert.equal(messages.at(-1).phase, 'reference');
  assert.equal(messages.at(-1).mainSteps, 0);
  let count = messages.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(messages.length, count);
  command({ type: 'resume' });
  await boundary;
  count = messages.length;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(messages.length, count);
  assert.ok(!messages.some(m => m.done));
  command({ type: 'resume' });
  await done;
  assert.equal(messages.filter(m => m.done).length, 1);
});

test('Обычный запуск и одиночное подтверждение сохраняют прежний протокол; Held не получает ложный идеальный старт', async () => {
  const points = seriesField(12, 2);
  const normal = await calculate({ algorithm: 'khvastuns', points, returnTour: true });
  assert.equal(normal.proofSeries, false);
  assert.equal(normal.phase, 'search');
  assert.equal(normal.measurement.work.referenceTotalMs, undefined);
  const seeded = await calculate({ algorithm: 'khvastuns', points, initialTour: normal.tour });
  assert.equal(seeded.measurement.work.warmupCycles, 0);
  assert.equal(seeded.measurement.values.length, normal.measurement.values.length);
  await assert.rejects(calculate({ algorithm: 'held', points, proofSeries: true }), /Серия подтверждения/);
});

test('Сводка подтверждения содержит свои показатели и не объединяется с обычной', async () => {
  const result = await calculate({ algorithm: 'hvastuns-var', points: seriesField(10, 1), proofSeries: true });
  const ordinary = emptyStats(10), confirmed = emptyStats(10);
  assert.equal(addMeasurement(confirmed, result.measurement, 0), true);
  assert.equal(addMeasurement(confirmed, result.measurement, 0), false);
  const report = statsReport([confirmed], undefined, 'hvastuns-var', 'proof');
  const before = statsReport([ordinary], undefined, 'hvastuns-var');
  assert.equal(report.kind, 'proof');
  assert.equal(report.totals.completed, 1);
  assert.equal(report.seriesTargetPerSize, 1000);
  assert.equal(report.sizes[0].metrics.referenceTotalMs.samples, 1);
  assert.equal(report.sizes[0].metrics.totalMs.mean, result.measurement.work.totalMs);
  assert.equal(before.kind, 'normal');
  assert.equal(before.totals.completed, 0);
  assert.equal(before.sizes[0].metrics.referenceTotalMs, undefined);
  assert.equal(report.metricLabels.mainSteps, 'Состояния подтверждения');
});
