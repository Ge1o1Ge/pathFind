'use strict';

const SERIES_TARGET = 1000;
const statsMetrics = {
  steps: ['Шаги до завершения', 'Все проверенные пары ветвей до подтверждения минимума.'],
  bestStep: ['Шаг нахождения оптимума', 'Шаг последнего улучшения рекорда. Ноль означает, что оптимальным был начальный цикл.'],
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

function addMeasurement(row, measurement, index) {
  // Две вкладки могут закончить одно поле серии. Индекс проверяется внутри транзакции.
  if (index !== null && row.series !== index) return false;
  if (index === null) row.manual++;
  else row.series++;
  if (measurement.byBound) row.byBound++;
  for (const [name, value] of Object.entries(measurement.values)) {
    const metric = row.metrics[name];
    if (metric) {
      metric.min = Math.min(metric.min, value);
      metric.max = Math.max(metric.max, value);
      metric.sum += value;
    } else row.metrics[name] = { min: value, max: value, sum: value };
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

function saveMeasurement(db, n, measurement, index) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sizes', 'readwrite');
    const sizes = tx.objectStore('sizes');
    const read = sizes.get(n);
    let row;
    read.onsuccess = () => {
      row = read.result || emptyStats(n);
      if (addMeasurement(row, measurement, index)) sizes.put(row);
    };
    tx.oncomplete = () => resolve(row);
    tx.onabort = () => reject(tx.error || new Error('Запись статистики прервана'));
  });
}

function seriesField(n, index) {
  // Номер опыта задаёт поле: возобновление серии не заменяет тяжёлый пример другим.
  let seed = Math.imul(n, 0x85ebca6b) ^ Math.imul(index + 1, 0x9e3779b1);
  return randomField(n, () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
}

function initStatistics(maxCities) {
  const minCities = Number(el('count').min);
  const rows = Array.from({ length: maxCities - minCities + 1 }, (_, i) => emptyStats(minCities + i));
  const recordedFields = new WeakSet();
  const average = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  const database = openStatsDatabase();
  let ready = false, running = false, task = null, worker = null, localRunner = null;
  let error = '', paintTimer = null;

  function merge(row) {
    const i = row.n - minCities, old = rows[i];
    if (old && row.series + row.manual >= old.series + old.manual) rows[i] = row;
  }
  async function refresh() {
    const db = await database;
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction('sizes').objectStore('sizes').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    records.forEach(merge);
    ready = true;
    paint();
  }
  function share(wins, total) {
    return total ? average.format(100 * wins / total) + ' %' : '—';
  }
  function paint() {
    clearTimeout(paintTimer);
    paintTimer = null;
    el('stats-tab').textContent = running ? 'Сбор сложности · идёт' : 'Сбор сложности';
    if (el('stats-panel').hidden) return;
    const metric = el('stats-metric').value;
    const completed = rows.reduce((s, row) => s + row.series, 0);
    const total = rows.reduce((s, row) => s + row.series + row.manual, 0);
    const byBound = rows.reduce((s, row) => s + row.byBound, 0);
    const target = rows.length * SERIES_TARGET;
    el('series-progress').max = target;
    el('series-progress').value = completed;
    el('series-total').textContent = integer.format(completed) + ' / ' + integer.format(target);
    el('series-start').disabled = !ready || running || completed === target;
    el('series-stop').disabled = !running;
    el('series-start-label').textContent = task || completed ? 'Продолжить серию' : 'Запустить серию';
    const position = task ? ' · ' + task.n + ' гор., поле ' + (task.index + 1) + ' · ' + integer.format(task.steps) + ' шагов' : '';
    el('series-state').textContent = (!ready ? 'Ожидание хранилища' : completed === target ? 'Серия завершена' : running ? 'Идёт сбор' : task || completed ? 'Остановлено' : 'Готово к запуску') + position;
    el('series-error').hidden = !error;
    el('series-error').textContent = error;
    el('overall-bound').textContent = 'Всего завершено по границе ' + share(byBound, total) + ' (' + integer.format(byBound) + ' из ' + integer.format(total) + ').';
    el('metric-description').textContent = statsMetrics[metric][1];
    el('stats-rows').innerHTML = rows.map(row => {
      const count = row.series + row.manual, m = row.metrics[metric];
      const values = m ? [m.min, m.max, m.sum / count].map(v => average.format(v)) : ['—', '—', '—'];
      return '<tr><th scope="row">' + row.n + '</th><td>' + integer.format(row.series) + '</td><td>' + integer.format(row.manual) + '</td>' +
        values.map(v => '<td>' + v + '</td>').join('') + '<td title="' + row.byBound + ' из ' + count + '">' + share(row.byBound, count) + '</td></tr>';
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
    const db = await database;
    merge(await saveMeasurement(db, n, measurement, index));
    schedulePaint();
  }
  async function finishTask(current) {
    if (current.saving) return;
    current.saving = true;
    try {
      await commit(current.n, current.result, current.index);
      task = null;
      if (running) nextField();
    } catch {
      current.saving = false;
      storageError();
    }
  }
  function receive(message) {
    if (!task) return;
    task.steps = message.steps;
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
    const row = rows.find(r => r.series < SERIES_TARGET);
    if (!row) { running = false; paint(); return; }
    task = { n: row.n, index: row.series, points: seriesField(row.n, row.series), steps: 0 };
    command({ type: 'start', points: task.points });
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
  el('series-start').onclick = () => {
    if (running || !ready) return;
    running = true;
    error = '';
    if (!task) nextField();
    else if (task.result) finishTask(task);
    else command({ type: 'resume' });
    paint();
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
      if (recordedFields.has(points)) return;
      recordedFields.add(points);
      commit(points.length, measureRun(run), null).catch(() => {
        recordedFields.delete(points);
        storageError();
      });
    }
  };
}
