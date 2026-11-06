'use strict';

function measureRun(run) {
  const [l1, l2] = run.best.len;
  if (run.algorithm === 'held') {
    const work = { totalMs: run.totalMs, preparationMs: run.preparationMs, searchMs: run.searchMs };
    if (run.steps != null) work.mainSteps = run.steps;
    return { values: { length: l1 + l2, l1, l2, ratio: l1 / l2,
      balance: Math.min(l1, l2) / Math.max(l1, l2) * 100, q: balanceRatio(run.best.len) }, work };
  }
  return {
    ...(isVariableAlgorithm(run.algorithm) ? { scoreModel: run.edgeAnalysis.scoreModel ?? LEGACY_SCORE_MODEL } : {}),
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
      duplicateCuts: run.duplicateCuts, memoEvictions: run.memoEvictions, seenStates: run.seen.size,
      treeHits: run.treeHits, treeMisses: run.treeMisses, treeEvictions: run.treeEvictions,
      completionAttempts: run.completionAttempts, completionChecks: run.completionChecks,
      completionSolutions: run.completionSolutions, completionImprovements: run.completionImprovements,
      completionExhausted: run.completionExhausted, completionMs: run.completionMs,
      preparationMs: run.preparationMs, warmupMs: run.warmupMs, searchMs: run.searchMs, totalMs: run.totalMs,
      ...(run.algorithm === 'hvastuns-staged' ? { stageDeferred: run.stageDeferred, stageReleased: run.stageReleased,
        stageZeroCuts: run.stageZeroCuts, stageProbeSkips: run.stageProbeSkips, stageEarlyOpens: run.stageEarlyOpens,
        stageTransitions: run.stageHistory.length - 1, stageFinalThreshold: run.stageThreshold } : {}),
      ...(isVariableAlgorithm(run.algorithm) ? { edgeMatrixMs: run.edgeMatrixMs, edgePruningMs: run.edgePruningMs,
        combinationEvaluations: run.combinationEvaluations, combinationChecks: run.combinationChecks,
        combinationCacheHits: run.combinationCacheHits, combinationRaised: run.combinationRaised,
        combinationCuts: run.combinationCuts, combinationImpossible: run.combinationImpossible, combinationMs: run.combinationMs,
        globalZeros: run.zeroEvents.length, globalStateCuts: run.globalStateCuts, globalEdgeCuts: run.globalEdgeCuts,
        edgeBoundChecks: run.edgeBoundChecks, requiredEdges: run.requiredCount,
        edgeOneTreeChecks: run.edgeOneTreeChecks, edgeOneTreeCuts: run.edgeOneTreeCuts,
        diversityAttempts: run.diversityAttempts, diversitySwitches: run.diversitySwitches, diversityChecks: run.diversityChecks,
        diversityProbes: run.diversityProbes, diversityMaxVisits: run.diversityMaxVisits, diversityMs: run.diversityMs,
        repairAttempts: run.repairAttempts, repairChecks: run.repairChecks, repairMoves: run.repairMoves,
        repairImprovements: run.repairImprovements, repairMs: run.repairMs,
        relaxedAttempts: run.relaxedAttempts, relaxedBuildChecks: run.relaxedBuildChecks, relaxedOptChecks: run.relaxedOptChecks,
        relaxedMoves: run.relaxedMoves, relaxedCycles: run.relaxedCycles, relaxedImprovements: run.relaxedImprovements,
        relaxedFailures: run.relaxedFailures, relaxedLimited: run.relaxedLimited, relaxedMs: run.relaxedMs,
        relaxedForced: run.relaxedForced, relaxedFillChecks: run.relaxedFillChecks,
        relaxedFilledCities: run.relaxedFilledCities, relaxedRepairedEdges: run.relaxedRepairedEdges,
        relaxedUncrossChecks: run.relaxedUncrossChecks, relaxedUncrossMoves: run.relaxedUncrossMoves,
        relaxedUncrossLimited: run.relaxedUncrossLimited, relaxedCrossingsLeft: run.relaxedCrossingsLeft,
        ...scoreDistributionMeasurements(run),
        ...routeScoreMeasurements(routeScoreQuality(run.edgeAnalysis, run.best.paths)) } : {})
    }
  };
}

function measuredValues(measurement) {
  return { ...measurement.values, ...measurement.work };
}

// Один расчёт с короткими порциями работы, чтобы «Стоп» сохранял текущую позицию.
function createSeriesRunner(report, sliceMs) {
  let run = null, timer = null, lastReport = 0, returnTour = false;
  let settings = null, phase = 'search', reference = null, initialTour = null;
  const progress = () => ({ steps: run?.steps || 0, mainSteps: run?.mainSteps || 0, queueLimit: run?.queueLimit,
    completionChecks: run?.completionChecks || 0,
    relaxedChecks: (run?.relaxedBuildChecks || 0) + (run?.relaxedFillChecks || 0) + (run?.relaxedOptChecks || 0) +
      (run?.relaxedUncrossChecks || 0), phase });
  const schedule = () => { timer = setTimeout(tick, 0); };
  function fail(error) {
    clearTimeout(timer);
    run = reference = initialTour = null;
    timer = null;
    report({ error: error.message || String(error) });
  }

  function tick() {
    timer = null;
    try {
      // Новый решатель получает только координаты и цикл. Очередь, кеш и нижняя граница не переносятся.
      if (!run && initialTour) run = createRouteSearch(settings.algorithm, settings.points, 0, false, initialTour, settings.scoreModel);
      run.advance(Infinity, sliceMs);
      if (run.error) throw new Error(run.error);
      if (run.done) {
        if (phase === 'reference') {
          reference = measureRun(run);
          initialTour = tourFromBest(run);
          run = null;
          phase = 'proof';
          schedule();
          report({ done: false, ...progress() });
          return;
        }
        const measurement = measureRun(run);
        if (settings.proofSeries) {
          const expected = reference.values.length, actual = measurement.values.length;
          if (Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) {
            throw new Error('Длины исходного оптимума и повторного поиска не совпали: ' + expected + ' / ' + actual + '. Поле не записано.');
          }
          Object.assign(measurement.work, { referenceTotalMs: reference.work.totalMs,
            referenceMainSteps: reference.work.mainSteps, referenceCompletionChecks: reference.work.completionChecks,
            pairTotalMs: reference.work.totalMs + measurement.work.totalMs });
        }
        const result = { done: true, ...progress(), proofSeries: Boolean(settings.proofSeries), measurement,
          ...(returnTour ? { tour: tourFromBest(run) } : {}) };
        run = reference = initialTour = null;
        report(result);
        return;
      }
      schedule();
      if (performance.now() - lastReport >= 250) {
        lastReport = performance.now();
        report({ done: false, ...progress() });
      }
    } catch (error) { fail(error); }
  }

  return function command(message) {
    if (message.type === 'pause') {
      clearTimeout(timer);
      timer = null;
      if (run || initialTour) report({ done: false, ...progress() });
      return;
    }
    if (message.type === 'start') {
      clearTimeout(timer); timer = null;
      // Старая вкладка не передаёт версию: сохраняем прежнюю формулу для её старой базы.
      settings = { ...message, scoreModel: message.scoreModel ?? LEGACY_SCORE_MODEL };
      reference = initialTour = null;
      phase = message.proofSeries ? 'reference' : 'search';
      returnTour = Boolean(message.returnTour);
      try {
        if (message.proofSeries && (message.algorithm === 'held' || message.initialTour !== undefined)) {
          throw new Error('Серия подтверждения доступна для khvastuns, Hvastuns-4 и обоих вариантов Hvastuns-var и сначала сама получает оптимальный цикл.');
        }
        run = createRouteSearch(message.algorithm, message.points, message.warmupLimit, false, message.initialTour, settings.scoreModel);
      } catch (error) { fail(error); return; }
    }
    if ((run || initialTour) && timer === null) schedule();
  };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  importScripts('one-tree.js', 'search.js', 'search-four.js', 'held-karp.js', 'edge-analysis.js', 'score-quality.js', 'score-distribution.js', 'search-var.js', 'search-staged.js');
  const command = createSeriesRunner(result => self.postMessage(result), 32);
  self.onmessage = event => command(event.data);
}
