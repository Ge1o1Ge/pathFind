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

function initComparison(getPoints) {
  const start = el('compare-start'), stop = el('compare-stop'), status = el('compare-status');
  const body = el('compare-rows'), table = el('compare-table'), kind = el('compare-kind');
  let worker, local, field, variants, index;
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
    const solvers = kind.value === 'solvers';
    el('solvers-description').hidden = el('solver-columns').hidden = !solvers;
    el('warmup-description').hidden = el('warmup-columns').hidden = solvers;
    if (solvers && getPoints().length > 22) {
      start.disabled = true;
      status.textContent = 'Для сравнения с Held–Karp выбери до 22 городов.';
    }
  }
  function launch() {
    const options = { type: 'start', points: field, warmupLimit: variants[index].limit };
    status.textContent = 'Расчёт ' + (index + 1) + ' из ' + variants.length + ' · лимит ' + options.warmupLimit;
    if (worker) worker.postMessage(options);
    else local(options);
  }
  function receive(message) {
    if (!field) return;
    if (!message.done) {
      status.textContent = 'Расчёт ' + (index + 1) + ' из ' + variants.length + ' · лимит ' + variants[index].limit +
        ' · состояний поиска: ' + integer.format(message.mainSteps);
      return;
    }
    const { limit, requests } = variants[index], v = measuredValues(message.measurement);
    const row = body.insertRow();
    for (const value of [requests.join(', ') + ' → ' + limit, v.warmupCycles, v.insertionChecks,
      v.twoOptChecks, v.mainSteps, v.preparationMs, v.warmupMs, v.searchMs, v.totalMs, v.length]) {
      row.insertCell().textContent = typeof value === 'number' ? clockNumber.format(value) : value;
    }
    if (++index < variants.length) launch();
    else end('Готово. Для каждого лимита показано время до подтверждения оптимума.');
  }
  start.onclick = () => {
    clear();
    field = getPoints();
    if (kind.value === 'solvers') {
      if (field.length > 22) return;
      try { worker = new Worker('solver-worker.js'); }
      catch { end('Для этого сравнения открой приложение через локальный сервер или GitHub Pages.'); return; }
      worker.onerror = () => end('Расчёт прерван. Попробуй меньшее поле или открой приложение через локальный сервер.');
      worker.onmessage = ({ data }) => {
        const row = body.insertRow();
        for (const v of [data.name, distance.format(data.length), clockNumber.format(data.ms)]) row.insertCell().textContent = v;
        if (data.done) end(data.matches ? 'Оба алгоритма подтвердили одинаковую длину.' : 'Обнаружено расхождение длин.');
        else status.textContent = 'Идёт расчёт Held–Karp…';
      };
      status.textContent = 'Идёт расчёт khvastuns…';
      start.disabled = true;
      stop.disabled = false;
      table.hidden = false;
      worker.postMessage(field);
      return;
    }
    variants = warmupVariants(field.length);
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
