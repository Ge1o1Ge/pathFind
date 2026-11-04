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
    }
  };
}

// Один расчёт с короткими порциями работы, чтобы «Стоп» сохранял текущую позицию.
function createSeriesRunner(report, sliceMs) {
  let run = null, timer = null, lastReport = 0;

  function tick() {
    const deadline = performance.now() + sliceMs;
    while (!run.done && performance.now() < deadline) run.step();
    if (run.done) {
      const result = { done: true, steps: run.steps, queueLimit: run.queueLimit, measurement: measureRun(run) };
      run = null;
      timer = null;
      report(result);
      return;
    }
    if (performance.now() - lastReport >= 250) {
      lastReport = performance.now();
      report({ done: false, steps: run.steps, queueLimit: run.queueLimit });
    }
    timer = setTimeout(tick, 0);
  }

  return function command(message) {
    if (message.type === 'pause') {
      clearTimeout(timer);
      timer = null;
      if (run) report({ done: false, steps: run.steps, queueLimit: run.queueLimit });
      return;
    }
    if (message.type === 'start') run = new RouteSearch(message.points);
    if (run && timer === null) timer = setTimeout(tick, 0);
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  importScripts('search.js');
  const command = createSeriesRunner(result => self.postMessage(result), 32);
  self.onmessage = event => command(event.data);
}
