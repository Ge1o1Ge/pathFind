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

function initComparison(getPoints, getAlgorithm, record) {
  const start = el('compare-start'), stop = el('compare-stop'), status = el('compare-status');
  const body = el('compare-rows'), table = el('compare-table'), kind = el('compare-kind');
  let worker, local, field, variants, index, firstLength, matches;
  function end(message) {
    if (worker) { worker.onmessage = worker.onerror = null; worker.terminate(); worker = null; }
    if (local) { const cancel = local; local = null; cancel({ type: 'pause' }); }
    field = null;
    start.disabled = false;
    stop.disabled = true;
    status.textContent = message;
  }
  function clear() {
    end('');
    body.replaceChildren();
    table.hidden = true;
    kind.querySelector('[value="warmup"]').disabled = getAlgorithm() === 'held';
    if (getAlgorithm() === 'held') kind.value = 'solvers';
    const solvers = kind.value === 'solvers';
    el('solvers-description').hidden = el('solver-columns').hidden = !solvers;
    el('warmup-description').hidden = el('warmup-columns').hidden = solvers;
  }
  function launch() {
    const { algorithm, limit } = variants[index];
    const options = { type: 'start', algorithm, points: field, warmupLimit: limit };
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
    const row = body.insertRow();
    const solvers = kind.value === 'solvers';
    const values = solvers ? [ROUTE_ALGORITHMS[algorithm], v.length, v.mainSteps, v.completionChecks ?? '—', v.totalMs] :
      [requests.join(', ') + ' → ' + limit, v.warmupCycles, v.insertionChecks, v.twoOptChecks, v.mainSteps,
        v.preparationMs, v.warmupMs, v.searchMs, v.completionMs, v.totalMs, v.length];
    for (const value of values) row.insertCell().textContent = typeof value === 'number' ? clockNumber.format(value) : value;
    if (firstLength === undefined) firstLength = v.length;
    if (Math.abs(firstLength - v.length) > 1e-8) matches = false;
    if (solvers) record(algorithm, field, message.measurement);
    if (++index < variants.length) launch();
    else end(matches ? 'Готово. Оптимальные длины совпали.' : 'Обнаружено расхождение длин.');
  }
  start.onclick = () => {
    clear();
    field = getPoints();
    firstLength = undefined;
    matches = true;
    variants = kind.value === 'solvers' ? Object.keys(ROUTE_ALGORITHMS)
      .filter(id => id !== 'held' || field.length <= 22).map(algorithm => ({ algorithm })) :
      warmupVariants(field.length).map(variant => ({ ...variant, algorithm: getAlgorithm() }));
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
    launch();
  };
  stop.onclick = () => end('Сравнение остановлено. Завершённые прогоны остались в таблице.');
  kind.onchange = clear;
  return { clear };
}
