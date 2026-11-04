'use strict';

const SERIES_TARGET = 1000;
const MAX_SERIES_CITIES = 30;
const PLAN_KEY = 'series-plan';
const workMetrics = {
  mainSteps: ['Состояния основного поиска', 'Сколько состояний двух ветвей было обработано до доказательства оптимума. Разминка сюда не входит.'],
  totalMs: ['Весь расчёт, мс', 'Подготовка + разминка + основной поиск до доказательства оптимума. Без отрисовки, пауз и ожидания между порциями расчёта.'],
  preparationMs: ['Подготовка, мс', 'Расстояния, геометрия, начальные структуры и первая нижняя оценка.'],
  warmupMs: ['Разминка, мс', 'Всё построение начальных циклов: жадный маршрут, вставки, поиск соседей 2-opt и сохранение рекорда.'],
  searchMs: ['Основной поиск, мс', 'Активное время перебора и подтверждения оптимума после разминки.'],
  warmupCycles: ['Разные циклы разминки', 'Сколько полных циклов принято в разминке. Не более n − 2, включая первый.'],
  warmupCandidates: ['Кандидаты разминки', 'Сумма проверенных позиций вставки и рассмотренных пар рёбер 2-opt, включая отвергнутые.'],
  insertionChecks: ['Позиции вставки', 'Каждое вычисление прироста длины при попытке вставить город.'],
  twoOptChecks: ['Пары рёбер 2-opt', 'Каждая рассмотренная пара несмежных рёбер, включая проверки без улучшения и повторы.'],
  greedyChecks: ['Проверки жадного старта', 'Сколько раз при построении первого цикла проверялось, свободен ли очередной город. Считаются отдельно от вставок и пар 2-opt.']
};
const statsMetrics = {
  ...workMetrics,
  steps: ['Шаги до завершения (прежняя шкала)', 'Для сравнения со старыми сериями: шаг — принятый цикл разминки или состояние основного поиска. Это разные по стоимости операции.'],
  bestStep: ['Шаг нахождения оптимума', 'Номер шага, на котором впервые найден итоговый рекорд. Первый цикл разминки — шаг 1.'],
  proofSteps: ['Шаги после нахождения оптимума', 'Сколько кандидатов пришлось проверить после последнего улучшения.'],
  ratio: ['Отношение ℓ₁ / ℓ₂', 'Длина первой ветви относительно второй в итоговом оптимальном цикле.'],
  balance: ['Короткая / длинная, %', 'Отношение длин ветвей оптимального цикла без учёта их цвета. При равенстве получается 100 %.'],
  q: ['Баланс Q', 'Отношение энергии ветвей оптимального цикла к энергии двух равных ветвей той же суммарной длины.'],
  l1: ['Длина ветви ℓ₁', 'Длина первой ветви итогового цикла.'],
  l2: ['Длина ветви ℓ₂', 'Длина второй ветви итогового цикла.'],
  length: ['Длина цикла L', 'Сумма длин обеих ветвей итогового цикла.'],
  boundCuts: ['Отсечения по длине', 'Число кандидатов, отброшенных по их индивидуальной нижней оценке.'],
  crossings: ['Отсечения по пересечению', 'Число продолжений, отброшенных из-за пересечения рёбер.'],
  deadEnds: ['Тупики по доступности', 'Число кандидатов, у которых оставшиеся города невозможно соединить в один путь.']
};

function emptyStats(n) {
  return { n, series: 0, manual: 0, byBound: 0, metrics: {} };
}

function statsReport(rows, plan = initialPlan()) {
  function counts(series, manual, byBound, withWarmupSteps) {
    const completed = series + manual;
    return { series, manual, completed, withWarmupSteps, byBound, byBoundPercent: completed ? 100 * byBound / completed : null };
  }
  let series = 0, manual = 0, byBound = 0, withWarmupSteps = 0;
  const sizes = rows.filter(row => row.n <= MAX_SERIES_CITIES || row.manual > 0).map(row => {
    series += row.series;
    manual += row.manual;
    byBound += row.byBound;
    withWarmupSteps += row.withWarmupSteps || 0;
    const samples = counts(row.series, row.manual, row.byBound, row.withWarmupSteps || 0);
    const metrics = {};
    for (const key of Object.keys(statsMetrics)) {
      const m = row.metrics[key];
      metrics[key] = m ? { ...m, mean: m.sum / (m.samples ?? samples.completed) } : null;
    }
    const batchStart = plan.starts[row.n] || 0;
    return { n: row.n, ...samples, batchStart, seriesTarget: row.n <= MAX_SERIES_CITIES ? batchStart + SERIES_TARGET : null, metrics };
  });
  return {
    formatVersion: 1, algorithm: 'khvastuns', exportedAt: new Date().toISOString(), seriesTargetPerSize: SERIES_TARGET,
    metricLabels: Object.fromEntries(Object.entries(statsMetrics).map(([key, [label]]) => [key, label])),
    totals: counts(series, manual, byBound, withWarmupSteps), sizes
  };
}

function addMeasurement(row, measurement, index) {
  // Две вкладки могут закончить одно поле серии. Индекс проверяется внутри транзакции.
  if (index !== null && row.series !== index) return false;
  if (index === null) row.manual++;
  else row.series++;
  if (measurement.byBound) row.byBound++;
  if (measurement.includesWarmupSteps) row.withWarmupSteps = (row.withWarmupSteps || 0) + 1;
  for (const [name, value] of Object.entries(measuredValues(measurement))) {
    const metric = row.metrics[name];
    if (metric) {
      metric.min = Math.min(metric.min, value);
      metric.max = Math.max(metric.max, value);
      metric.sum += value;
    } else row.metrics[name] = { min: value, max: value, sum: value };
    // В старых прогонах этих замеров нет: они не входят в знаменатель среднего.
    if (name in workMetrics) row.metrics[name].samples = (row.metrics[name].samples || 0) + 1;
  }
  return true;
}

function openStatsDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('atlas-route-statistics-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sizes', { keyPath: 'n' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function initialPlan() {
  return { n: PLAN_KEY, revision: 0, resetAt: 0, cleared: {}, starts: {}, only: null };
}

function generation(plan, n) {
  return plan.cleared[n] ?? plan.resetAt;
}

function statsKey(plan, n) {
  // После сброса старые вкладки могут писать по прежнему ключу, но не в новую выборку.
  const version = generation(plan, n);
  return version ? [version, n] : n;
}

function readStatistics(db, cityCounts, edit) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sizes', edit ? 'readwrite' : 'readonly');
    const store = tx.objectStore('sizes');
    const read = store.getAll();
    let snapshot;
    read.onsuccess = () => {
      const records = new Map(read.result.map(item => [String(item.n), item]));
      const plan = records.get(PLAN_KEY) || initialPlan();
      const rows = cityCounts.map(n => {
        const saved = records.get(String(statsKey(plan, n)));
        return saved?.row || saved || emptyStats(n);
      });
      const changed = edit ? edit(store, plan, rows) : false;
      if (changed) store.put(plan);
      snapshot = { plan, rows, changed };
    };
    tx.oncomplete = () => resolve(snapshot);
    tx.onabort = () => reject(tx.error || new Error('Не удалось получить статистику'));
  });
}

function saveMeasurement(db, plan, n, measurement, index) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sizes', 'readwrite');
    const sizes = tx.objectStore('sizes');
    const key = statsKey(plan, n);
    const control = sizes.get(PLAN_KEY);
    const read = sizes.get(key);
    let row;
    read.onsuccess = () => {
      const active = control.result || initialPlan();
      if (generation(active, n) !== generation(plan, n) || (index !== null && active.revision !== plan.revision)) return;
      row = read.result?.row || read.result || emptyStats(n);
      if (addMeasurement(row, measurement, index)) sizes.put(Array.isArray(key) ? { n: key, row } : row);
    };
    tx.oncomplete = () => resolve(row);
    tx.onabort = () => reject(tx.error || new Error('Запись статистики прервана'));
  });
}

function initStatistics(maxCities) {
  const minCities = Number(el('count').min);
  const cityCounts = Array.from({ length: maxCities - minCities + 1 }, (_, i) => minCities + i);
  let rows = cityCounts.map(emptyStats), plan = initialPlan();
  const recordedFields = new WeakMap();
  const average = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  const database = openStatsDatabase();
  let ready = false, running = false, task = null, worker = null, localRunner = null;
  let exporting = false, changing = false;
  let error = '', paintTimer = null;

  function merge(row) {
    const i = row.n - minCities, old = rows[i];
    if (old && row.series + row.manual >= old.series + old.manual) rows[i] = row;
  }
  function applySnapshot(snapshot) {
    if (snapshot.plan.revision < plan.revision) return;
    if (snapshot.plan.revision !== plan.revision) {
      running = false;
      task = null;
      if (worker) { worker.onmessage = worker.onerror = null; worker.terminate(); worker = null; }
      if (localRunner) { localRunner({ type: 'pause' }); localRunner = null; }
      plan = snapshot.plan;
      rows = snapshot.rows;
      el('export-status').hidden = true;
    } else snapshot.rows.forEach(merge);
    ready = true;
    paint();
  }
  async function refresh() {
    applySnapshot(await readStatistics(await database, cityCounts));
  }
  function remaining(row) {
    return row.n <= MAX_SERIES_CITIES && row.series < (plan.starts[row.n] || 0) + SERIES_TARGET;
  }
  function share(wins, total) {
    return total ? average.format(100 * wins / total) + ' %' : '—';
  }
  function paint() {
    clearTimeout(paintTimer);
    paintTimer = null;
    el('stats-tab').textContent = running ? 'Сбор сложности · идёт' : 'Сбор сложности';
    if (el('stats-panel').hidden) return;
    const busy = !ready || changing;
    el('stats-export').disabled = busy || exporting;
    el('stats-reset').disabled = busy || running || exporting;
    el('series-add').disabled = busy || running || exporting;
    const metric = el('stats-metric').value;
    const batch = plan.only === null ? rows.filter(row => row.n <= MAX_SERIES_CITIES) : [rows[plan.only - minCities]];
    const completed = batch.reduce((s, row) => s + row.series - (plan.starts[row.n] || 0), 0);
    const total = rows.reduce((s, row) => s + row.series + row.manual, 0);
    const byBound = rows.reduce((s, row) => s + row.byBound, 0);
    const target = batch.length * SERIES_TARGET;
    el('series-progress').max = target;
    el('series-progress').value = completed;
    el('series-total').textContent = integer.format(completed) + ' / ' + integer.format(target);
    el('series-start').disabled = busy || running || !rows.some(remaining);
    el('series-stop').disabled = !running;
    el('series-start-label').textContent = plan.only !== null && completed >= target ? 'Продолжить общую серию'
      : task || completed ? 'Продолжить серию' : 'Запустить серию';
    const position = task ? ' · ' + task.n + ' гор., поле ' + (task.index + 1) + ' · состояний поиска: ' + integer.format(task.mainSteps) +
      ' · порог очереди ' + integer.format(task.queueLimit) : '';
    const scope = plan.only !== null && !task ? ' · ' + plan.only + ' гор.' : '';
    el('series-state').textContent = (!ready ? 'Ожидание хранилища' : completed >= target ? 'Серия завершена' : running ? 'Идёт сбор' : task || completed ? 'Остановлено' : 'Готово к запуску') + scope + position;
    el('series-error').hidden = !error;
    el('series-error').textContent = error;
    el('overall-bound').textContent = 'Всего завершено по границе ' + share(byBound, total) + ' (' + integer.format(byBound) + ' из ' + integer.format(total) + ').';
    el('metric-description').textContent = statsMetrics[metric][1];
    el('stats-rows').innerHTML = rows.filter(row => row.n <= MAX_SERIES_CITIES || row.manual > 0).map(row => {
      const count = row.series + row.manual, m = row.metrics[metric];
      const measured = m ? m.samples ?? count : 0;
      const values = m ? [m.min, m.max, m.sum / measured].map(v => average.format(v)) : ['—', '—', '—'];
      return '<tr><th scope="row">' + row.n + '</th><td>' + integer.format(row.series) + '</td><td>' + integer.format(row.manual) + '</td>' +
        '<td>' + integer.format(measured) + '</td>' + values.map(v => '<td>' + v + '</td>').join('') + '<td title="' + row.byBound + ' из ' + count + '">' + share(row.byBound, count) + '</td>' +
        '<td class="row-actions">' + (row.n > MAX_SERIES_CITIES ? 'Только вручную' : ['restart', 'add'].map(action => {
          const label = action === 'restart' ? 'Заново' : 'Ещё 1 000';
          return '<button class="outline" data-action="' + action + '" data-n="' + row.n + '" aria-label="' + label + ', ' + row.n + ' городов"' +
            (busy || running || exporting ? ' disabled' : '') + '>' + label + '</button>';
        }).join(' ')) + '</td></tr>';
    }).join('');
  }
  function schedulePaint() {
    if (paintTimer === null) paintTimer = setTimeout(paint, 150);
  }
  function storageError() {
    running = false;
    if (task && !task.result) command({ type: 'pause' });
    error = 'Не удалось сохранить или прочитать статистику. Проверь доступ браузера к локальному хранилищу.';
    paint();
  }
  async function commit(n, measurement, index) {
    const started = plan;
    const db = await database;
    const saved = await saveMeasurement(db, started, n, measurement, index);
    if (!saved) { await refresh(); return; }
    if (plan.revision !== started.revision) return;
    merge(saved);
    schedulePaint();
  }
  async function finishTask(current) {
    if (current.saving) return;
    current.saving = true;
    try {
      await commit(current.n, current.result, current.index);
      if (task !== current) return;
      task = null;
      if (running) nextField();
    } catch {
      if (task !== current) return;
      current.saving = false;
      storageError();
    }
  }
  function receive(message) {
    if (!task) return;
    task.mainSteps = message.mainSteps;
    task.queueLimit = message.queueLimit ?? INITIAL_QUEUE_LIMIT;
    if (message.done) {
      task.result = message.measurement;
      finishTask(task);
    }
    schedulePaint();
  }
  function command(message) {
    if (!worker && !localRunner) {
      if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
        try { worker = new Worker('series-runner.js'); } catch { /* Локальный расчёт доступен ниже. */ }
      }
      if (worker) {
        worker.onmessage = event => receive(event.data);
        worker.onerror = () => {
          worker.terminate();
          worker = null;
          localRunner = createSeriesRunner(receive, 8);
          if (task && !task.result) {
            localRunner({ type: 'start', points: task.points });
            if (!running) localRunner({ type: 'pause' });
          }
        };
      } else localRunner = createSeriesRunner(receive, 8);
    }
    if (worker) worker.postMessage(message);
    else localRunner(message);
  }
  function nextField() {
    const row = rows.find(r => (plan.only === null || plan.only === r.n) && remaining(r));
    if (!row) { running = false; paint(); return; }
    task = { n: row.n, index: row.series, points: seriesField(row.n, row.series), mainSteps: 0, queueLimit: INITIAL_QUEUE_LIMIT };
    command({ type: 'start', points: task.points });
  }

  const updates = typeof BroadcastChannel === 'function' ? new BroadcastChannel('atlas-route-series') : null;
  if (updates) updates.onmessage = () => refresh().catch(storageError);

  async function changeSeries(action, n = null) {
    if (!ready || running || changing || exporting) return;
    if (action === 'reset' || action === 'restart') {
      const affected = n === null ? rows : [rows[n - minCities]];
      const series = affected.reduce((sum, row) => sum + row.series, 0);
      const manual = affected.reduce((sum, row) => sum + row.manual, 0);
      const question = n === null ? 'Сбросить всю статистику?' : 'Начать заново для ' + n + ' городов?';
      const detail = 'Серийных результатов к удалению: ' + integer.format(series) + ', ручных: ' + integer.format(manual) + '.';
      if (!window.confirm(question + '\n' + detail)) return;
    }
    const revision = plan.revision;
    changing = true;
    error = '';
    paint();
    try {
      const snapshot = await readStatistics(await database, cityCounts, (store, next, saved) => {
        if (next.revision !== revision) return false;
        next.revision++;
        next.only = n;
        if (action === 'reset') {
          store.clear();
          next.resetAt = next.revision;
          next.starts = {};
          next.cleared = {};
          saved.forEach((row, i) => { saved[i] = emptyStats(row.n); });
        } else if (action === 'restart') {
          store.delete(statsKey(next, n));
          next.cleared[n] = next.revision;
          next.starts[n] = 0;
          saved[n - minCities] = emptyStats(n);
        } else if (action === 'add') {
          for (const row of saved) {
            if (row.n <= MAX_SERIES_CITIES && (n === null || n === row.n)) next.starts[row.n] = row.series;
          }
        }
        return true;
      });
      applySnapshot(snapshot);
      if (snapshot.changed && plan.revision === snapshot.plan.revision) {
        updates?.postMessage(plan.revision);
        if (action !== 'reset') startSeries();
      } else error = 'План серии изменён в другой вкладке. Данные обновлены.';
    } catch {
      error = 'Не удалось изменить серию в локальном хранилище. Попробуй ещё раз.';
    } finally {
      changing = false;
      paint();
    }
  }

  function selectMode(stats) {
    el('manual-panel').hidden = stats;
    el('stats-panel').hidden = !stats;
    el('manual-tab').setAttribute('aria-pressed', String(!stats));
    el('stats-tab').setAttribute('aria-pressed', String(stats));
    if (stats) { paint(); refresh().catch(storageError); }
  }
  el('manual-tab').onclick = () => selectMode(false);
  el('stats-tab').onclick = () => selectMode(true);
  el('stats-metric').innerHTML = Object.entries(statsMetrics).map(([key, m]) => '<option value="' + key + '">' + m[0] + '</option>').join('');
  el('stats-metric').onchange = paint;
  el('stats-export').onclick = async () => {
    if (!ready || exporting || changing) return;
    exporting = true;
    paint();
    const status = el('export-status');
    try {
      const snapshot = await readStatistics(await database, cityCounts);
      const report = statsReport(snapshot.rows, snapshot.plan);
      const file = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pathfind-results-' + report.exportedAt.replace(/[:.]/g, '-') + '.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'JSON подготовлен. Завершённых прогонов в сводке — ' + integer.format(report.totals.completed) + '.';
    } catch {
      status.textContent = 'Не удалось скачать сводку. Попробуй ещё раз.';
    } finally {
      exporting = false;
      status.hidden = false;
      paint();
    }
  };
  function startSeries() {
    running = true;
    error = '';
    if (!task) nextField();
    else if (task.result) finishTask(task);
    else command({ type: 'resume' });
    paint();
  }
  el('series-start').onclick = () => {
    if (running || !ready || changing) return;
    if (plan.only !== null && !remaining(rows[plan.only - minCities])) changeSeries('resume-all');
    else startSeries();
  };
  el('series-add').onclick = () => changeSeries('add');
  el('stats-reset').onclick = () => changeSeries('reset');
  el('stats-rows').onclick = event => {
    const button = event.target.closest('button[data-action]');
    if (button) changeSeries(button.dataset.action, Number(button.dataset.n));
  };
  el('series-stop').onclick = () => {
    running = false;
    if (task && !task.result) command({ type: 'pause' });
    paint();
  };
  window.addEventListener('focus', () => { if (!el('stats-panel').hidden) refresh().catch(storageError); });
  refresh().catch(storageError);
  return {
    recordManual(points, run) {
      if (!ready) {
        refresh().then(() => this.recordManual(points, run)).catch(storageError);
        return;
      }
      const version = generation(plan, points.length);
      if (recordedFields.get(points) === version) return;
      recordedFields.set(points, version);
      commit(points.length, measureRun(run), null).catch(() => {
        if (recordedFields.get(points) === version) recordedFields.delete(points);
        storageError();
      });
    }
  };
}
