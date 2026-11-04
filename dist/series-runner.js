'use strict';

function measureRun(run) {
  const [l1, l2] = run.best.len;
  return {
    byBound: run.finishReason === 'bound',
    includesWarmupSteps: true,
    values: {
      steps: run.steps, bestStep: run.bestStep, proofSteps: run.steps - run.bestStep,
      length: l1 + l2, l1, l2, ratio: l1 / l2,
      balance: Math.min(l1, l2) / Math.max(l1, l2) * 100, q: balanceRatio(run.best.len),
      boundCuts: run.boundCuts, crossings: run.crossingCuts, deadEnds: run.deadEndCuts
    },
    // Старая вкладка может запустить обновлённый worker: она запишет только известные ей values.
    work: {
      mainSteps: run.mainSteps, warmupCycles: run.warmupCount, greedyChecks: run.greedyChecks,
      insertionChecks: run.insertionChecks, twoOptChecks: run.twoOptChecks, warmupCandidates: run.warmupCandidates,
      preparationMs: run.preparationMs, warmupMs: run.warmupMs, searchMs: run.searchMs, totalMs: run.totalMs
    }
  };
}

function measuredValues(measurement) {
  return { ...measurement.values, ...measurement.work };
}

// Один расчёт с короткими порциями работы, чтобы «Стоп» сохранял текущую позицию.
function createSeriesRunner(report, sliceMs) {
  let run = null, timer = null, lastReport = 0;
  const progress = () => ({ steps: run.steps, mainSteps: run.mainSteps, queueLimit: run.queueLimit });

  function tick() {
    run.advance(Infinity, sliceMs);
    if (run.done) {
      const result = { done: true, ...progress(), measurement: measureRun(run) };
      run = null;
      timer = null;
      report(result);
      return;
    }
    if (performance.now() - lastReport >= 250) {
      lastReport = performance.now();
      report({ done: false, ...progress() });
    }
    timer = setTimeout(tick, 0);
  }

  return function command(message) {
    if (message.type === 'pause') {
      clearTimeout(timer);
      timer = null;
      if (run) report({ done: false, ...progress() });
      return;
    }
    if (message.type === 'start') run = new RouteSearch(message.points, message.warmupLimit);
    if (run && timer === null) timer = setTimeout(tick, 0);
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  importScripts('search.js');
  const command = createSeriesRunner(result => self.postMessage(result), 32);
  self.onmessage = event => command(event.data);
}
