'use strict';

function warmupVariants(n) {
  const limits = new Map();
  for (const requested of [0, 2, 5, 10, 20, 50]) {
    const limit = Math.min(requested, n - 2);
    if (!limits.has(limit)) limits.set(limit, []);
    limits.get(limit).push(requested);
  }
  return Array.from(limits, ([limit, requests]) => ({ limit, requests }));
}

function initComparison(getPoints, getAlgorithm, record, getRun) {
  const start = el('compare-start'), stop = el('compare-stop'), status = el('compare-status');
  const body = el('compare-rows'), table = el('compare-table'), kind = el('compare-kind');
  let worker, local, field, variants, index, firstLength, matches, initialTour, report;
  function end(message) {
    if (worker) { worker.onmessage = worker.onerror = null; worker.terminate(); worker = null; }
    if (local) { const cancel = local; local = null; cancel({ type: 'pause' }); }
    field = null;
    start.disabled = false;
    stop.disabled = true;
    status.textContent = message;
    if (report) report.status = message;
  }
  function clear() {
    end('');
    body.replaceChildren();
    table.hidden = true;
    report = null;
    initialTour = undefined;
    el('compare-export').disabled = true;
    kind.querySelector('[value="warmup"]').disabled = getAlgorithm() === 'held';
    kind.querySelector('[value="proof"]').disabled = getAlgorithm() === 'held';
    if (getAlgorithm() === 'held') kind.value = 'solvers';
    el('solvers-description').hidden = el('solver-columns').hidden = kind.value !== 'solvers';
    el('warmup-description').hidden = el('warmup-columns').hidden = kind.value !== 'warmup';
    el('proof-description').hidden = el('proof-columns').hidden = kind.value !== 'proof';
  }
  function launch() {
    const { algorithm, limit } = variants[index];
    const options = { type: 'start', algorithm, points: field, warmupLimit: limit, scoreModel: CURRENT_SCORE_MODEL };
    if (kind.value === 'proof') {
      options.returnTour = true;
      if (index === 1) options.initialTour = initialTour;
    }
    status.textContent = 'Расчёт ' + (index + 1) + ' из ' + variants.length + ' · ' + ROUTE_ALGORITHMS[algorithm];
    if (worker) worker.postMessage(options);
    else local(options);
  }
  function receive(message) {
    if (!field) return;
    if (message.error) { end(message.error); return; }
    if (!message.done) {
      status.textContent = 'Расчёт ' + (index + 1) + ' из ' + variants.length + ' · ' + ROUTE_ALGORITHMS[variants[index].algorithm] +
        ' · состояний поиска: ' + integer.format(message.mainSteps) +
        (message.completionChecks ? ' · продолжений достройки: ' + integer.format(message.completionChecks) : '');
      return;
    }
    const { algorithm, limit, requests } = variants[index], v = measuredValues(message.measurement);
    if (isVariableAlgorithm(algorithm) && message.measurement.scoreModel !== CURRENT_SCORE_MODEL) {
      end('Версия оценки исполнителя не совпала. Обнови страницу; результат не записан.'); return;
    }
    const row = body.insertRow();
    const solvers = kind.value === 'solvers', proof = kind.value === 'proof';
    if (proof && index === 0) {
      if (!message.tour) { end('Для повторного запуска не получен полный цикл.'); return; }
      initialTour = message.tour;
      report.initialTour = initialTour;
    }
    const values = solvers ? [ROUTE_ALGORITHMS[algorithm], v.length, v.mainSteps, v.completionChecks ?? '—', v.totalMs] :
      proof ? [index === 0 ? (message.reused ? 'Обычный · готовый замер' : 'Обычный запуск') : 'Готовый оптимум со старта',
        v.length, v.mainSteps, v.completionChecks, v.preparationMs, v.warmupMs, v.edgeMatrixMs ?? '—', v.totalMs] :
      [requests.join(', ') + ' → ' + limit, v.warmupCycles, v.insertionChecks, v.twoOptChecks, v.mainSteps,
        v.preparationMs, v.warmupMs, v.searchMs, v.completionMs, v.totalMs, v.length];
    for (const value of values) row.insertCell().textContent = typeof value === 'number' ? clockNumber.format(value) : value;
    if (firstLength === undefined) firstLength = v.length;
    if (Math.abs(firstLength - v.length) > 1e-8) matches = false;
    if (solvers) record(algorithm, field, message.measurement);
    report.results.push({ algorithm, ...(proof ? { initialOptimalTour: index === 1, reused: Boolean(message.reused) } : { limit }), measurement: message.measurement });
    el('compare-export').disabled = false;
    if (++index < variants.length) launch();
    else {
      report.done = true;
      end(matches ? (proof ? 'Готово. Начальный оптимум подтверждён повторным поиском. Подготовка включена; эти прогоны не добавлены в обычную статистику.' :
        'Готово. Оптимальные длины совпали.') : 'Обнаружено расхождение длин.');
    }
  }
  start.onclick = () => {
    clear();
    field = getPoints();
    firstLength = undefined;
    matches = true;
    variants = kind.value === 'solvers' ? Object.keys(ROUTE_ALGORITHMS)
      .filter(id => id !== 'held' || field.length <= 22).map(algorithm => ({ algorithm })) :
      kind.value === 'proof' ? [{ algorithm: getAlgorithm() }, { algorithm: getAlgorithm() }] :
      warmupVariants(field.length).map(variant => ({ ...variant, algorithm: getAlgorithm() }));
    report = { formatVersion: 1, scoreModel: CURRENT_SCORE_MODEL, kind: kind.value, points: field, done: false, results: [] };
    index = 0;
    if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
      try { worker = new Worker('series-runner.js'); } catch { /* Доступен расчёт в текущей вкладке. */ }
    }
    if (worker) {
      worker.onmessage = event => receive(event.data);
      worker.onerror = () => end('Сравнение прервано из-за ошибки расчёта.');
    } else local = createSeriesRunner(receive, 8);
    start.disabled = true;
    stop.disabled = false;
    table.hidden = false;
    const previous = kind.value === 'proof' ? getRun?.() : null;
    if (previous?.done && previous.best && previous.points === field && !previous.hasInitialTour) {
      receive({ done: true, reused: true, tour: tourFromBest(previous), measurement: measureRun(previous) });
    } else launch();
  };
  stop.onclick = () => end('Сравнение остановлено. Завершённые прогоны остались в таблице.');
  kind.onchange = clear;
  el('compare-export').onclick = () => {
    if (report) downloadStatsReport({ ...report, exportedAt: new Date().toISOString() }, 'comparison-' + report.kind);
  };
  return { clear };
}
