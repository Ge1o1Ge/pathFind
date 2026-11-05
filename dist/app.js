'use strict';

const el = id => document.getElementById(id);
const map = el('map');
const chart = el('convergence-chart');
const distance = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('ru-RU');
const pad = n => String(n).padStart(2, '0');
const colors = ['#2859df', '#cf6a24', '#13836d', '#8053b1'];
const armNames = ['ℓ₁', 'ℓ₂', 'ℓ₃', 'ℓ₄'];
const rates = [1, 10, 60, 600, Infinity];
const modeNames = { ready: 'Готов к запуску', running: 'Идёт поиск', paused: 'Остановлен', done: 'Минимум доказан' };
let points, search, mode, bestView, frame = 0, lastTime = 0, credit = 0, mapSize = '';
let balanceView = false;
const maxCities = Number(el('count').max);
let algorithm = el('algorithm').value;
const statistics = Object.fromEntries(Object.keys(ROUTE_ALGORITHMS).map(id => [id, initStatistics(maxCities, id)]));
const manualRuns = new Map();
const comparison = initComparison(() => points, () => algorithm,
  (id, field, measurement) => statistics[id].recordManual(field, measurement));
const clockNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const elapsed = ms => ms < 1000 ? clockNumber.format(ms) + ' мс' : clockNumber.format(ms / 1000) + ' с';

function newField(countFinished = true) {
  if (!el('count').reportValidity()) return false;
  cancelAnimationFrame(frame);
  points = randomField(el('count').valueAsNumber);
  comparison.clear();
  manualRuns.clear();
  search = createRouteSearch(algorithm, points);
  mode = 'ready';
  bestView = false;
  mapSize = '';
  afterStep(countFinished);
  return true;
}

function applyCityCount() {
  return points.length === el('count').valueAsNumber || newField();
}

function drawMap(s) {
  const w = map.clientWidth, h = map.clientHeight;
  if (!w || !h) return;
  const scale = Math.min((w - 64) / 100, (h - 40) / 50);
  const ox = (w - scale * 100) / 2 + 5, oy = (h + scale * 50) / 2 - 3;
  const x = i => ox + points[i].x * scale, y = i => oy - points[i].y * scale;
  const key = w + 'x' + h;
  const small = w < 470;
  const radius = small ? 7.5 : 10;
  if (mapSize !== key) {
    mapSize = key;
    map.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    const grid = scale * 10;
    const ticks = [];
    const format = (px, py, value, anchor) => '<text x="' + px + '" y="' + py + '" text-anchor="' + anchor + '">' + value + '</text>';
    for (let i = 0; i <= 100; i += small ? 20 : 10) ticks.push(format(ox + i * scale, h - 7, i, 'middle'));
    for (let j = 0; j <= 50; j += 10) ticks.push(format(7, oy - j * scale + 3, j, 'start'));
    map.innerHTML = '<defs><pattern id="dots" patternUnits="userSpaceOnUse" x="' + ox + '" y="' + oy + '" width="' + grid / 5 + '" height="' + grid / 5 + '"><circle r=".85" cx="1" cy="1" fill="#d0dce9"/></pattern><pattern id="grid" patternUnits="userSpaceOnUse" x="' + ox + '" y="' + oy + '" width="' + grid + '" height="' + grid + '"><path d="M ' + grid + ' 0 H0 V' + grid + '" fill="none" stroke="#dce6f1" stroke-width="1.1"/></pattern></defs>' +
      '<rect width="100%" height="100%" fill="url(#dots)"/><rect width="100%" height="100%" fill="url(#grid)"/><g font-size="9" fill="#8394a9">' + ticks.join('') + format(w - 10, h - 7, 'X', 'middle') + format(10, 13, 'Y', 'middle') + '</g><g id="roads"></g><g id="cities"></g>';
  }
  el('roads').innerHTML = s.paths.map((path, i) => '<polyline points="' + path.map(j => x(j) + ',' + y(j)).join(' ') + '" fill="none" stroke="' + colors[i] + '" stroke-width="' + (small ? 2 : 2.7) + '" stroke-linejoin="round" stroke-linecap="round"/>').join('');
  const used = s.paths.map(path => new Set(path));
  el('cities').innerHTML = points.map((p, i) => {
    const end = i === search.a ? 'A' : i === search.b ? 'B' : '';
    const side = used.findIndex(cities => cities.has(i));
    const color = side >= 0 ? colors[side] : '#8798ab';
    const label = end ? end + '·' + pad(i + 1) : pad(i + 1);
    const box = end ? '<rect x="' + (small ? -14 : -20) + '" y="' + (-radius - 1) + '" width="' + (small ? 28 : 40) + '" height="' + (2 * radius + 2) + '" rx="5" fill="#25374e" stroke="white" stroke-width="1.5"/>' :
      '<circle r="' + radius + '" fill="white" stroke="' + color + '" stroke-width="1.6"/>';
    return '<g transform="translate(' + x(i) + ' ' + y(i) + ')"><title>Город ' + pad(i + 1) + (end ? ' · ' + end : '') + ' (' + p.x + ', ' + p.y + ')</title>' + box +
      '<text y=".35em" text-anchor="middle" font-size="' + (small ? 8 : 10) + '" font-weight="600" fill="' + (end ? 'white' : color) + '">' + label + '</text></g>';
  }).join('');
}

function showDetails(s) {
  if (!document.querySelector('.details').open) return;
  const sequence = path => path.map(i => pad(i + 1)).join(' → ');
  const paths = s.paths.map((p, i) => '<p>Ветвь ' + armNames[i] + '　<code>' + sequence(p) + '</code></p>').join('');
  const cycle = search.best ? [...search.best.paths[0], ...search.best.paths[1].slice(0, -1).reverse()] : [];
  const cache = search.seen ? '<p>Запомнено состояний　<code>' + integer.format(search.seen.size) + ' / ' + integer.format(MAX_SEEN_STATES) +
    '</code></p><p>Вытеснено старых записей　<code>' + integer.format(search.memoEvictions) + '</code></p>' : '';
  el('details-body').innerHTML = paths + '<p>Лучший цикл　<code>' + sequence(cycle) + '</code></p>' + cache + '<div class="coords">' + points.map((p, i) => '<code>' + pad(i + 1) + ' (' + p.x + ', ' + p.y + ')</code>').join('') + '</div>';
}

function render() {
  const s = (bestView && search.best) || search.current;
  drawMap(s);
  if (search.history.length) drawConvergence(chart, search, balanceView);
  const four = s.paths.length === 4;
  el('extra-lengths').hidden = !four;
  for (const item of document.querySelectorAll('.arm-extra')) item.hidden = !four;
  if (four) { el('l3').textContent = distance.format(s.len[2]); el('l4').textContent = distance.format(s.len[3]); }
  el('coverage').textContent = new Set(s.paths.flat()).size + ' / ' + points.length + ' городов';
  el('steps').textContent = integer.format(search.mainSteps);
  el('l1').textContent = search.best ? distance.format(s.len[0]) : '—';
  el('l2').textContent = search.best ? distance.format(s.len[1]) : '—';
  el('best').textContent = search.best ? distance.format(search.best.len[0] + search.best.len[1]) : '—';
  if (algorithm !== 'held') {
    el('crossing-cuts').textContent = integer.format(search.crossingCuts);
    el('dead-end-cuts').textContent = integer.format(search.deadEndCuts);
    el('queue-limit').textContent = integer.format(search.queueLimit);
    el('pending-count').textContent = integer.format(search.pending + search.stack.length + Number(Boolean(search.next)) + Number(Boolean(search.completion)));
    el('seen-count').textContent = integer.format(search.seen.size);
    el('seen-limit').textContent = integer.format(MAX_SEEN_STATES);
    el('tree-cache-count').textContent = integer.format(search.trees.size);
    el('tree-cache-limit').textContent = integer.format(MAX_TREE_STATES);
    el('tree-cache-hits').textContent = integer.format(search.treeHits);
    el('tree-cache-misses').textContent = integer.format(search.treeMisses);
    el('tree-cache-evictions').textContent = integer.format(search.treeEvictions);
    el('duplicate-cuts').textContent = integer.format(search.duplicateCuts);
    el('memo-evictions').textContent = integer.format(search.memoEvictions);
    el('bound-method').textContent = search.oneTree ? '1-дерево с фиксированными рёбрами + прежняя оценка' : 'Оценка по остовному дереву';
    el('warmup-count').textContent = search.warmupCount + ' / ' + search.warmupLimit;
    el('warmup-candidates').textContent = integer.format(search.warmupCandidates);
    el('insertion-checks').textContent = integer.format(search.insertionChecks);
    el('two-opt-checks').textContent = integer.format(search.twoOptChecks);
    el('greedy-checks').textContent = integer.format(search.greedyChecks);
    el('warmup-time').textContent = elapsed(search.warmupMs);
    for (const key of ['attempts', 'checks', 'solutions', 'improvements', 'exhausted']) {
      el('completion-' + key).textContent = integer.format(search['completion' + key[0].toUpperCase() + key.slice(1)]);
    }
    el('completion-time').textContent = elapsed(search.completionMs);
  }
  el('prep-time').textContent = elapsed(search.preparationMs);
  el('main-time').textContent = elapsed(search.searchMs);
  el('total-time').textContent = elapsed(search.totalMs);
  el('status').dataset.mode = mode;
  const statusText = search.error ? 'Поле больше лимита' : modeNames[mode];
  if (el('status').textContent !== statusText) el('status').textContent = statusText;
  el('note').textContent = search.error || search.note;
  el('show-best').disabled = !search.best;
  el('show-current').setAttribute('aria-pressed', String(!bestView));
  el('show-best').setAttribute('aria-pressed', String(bestView));
  el('start-label').textContent = mode === 'paused' ? 'Продолжить' : mode === 'done' ? 'Повторить' : 'Запустить';
  el('start').disabled = mode === 'running' || !!search.error;
  el('stop-search').disabled = mode !== 'running';
  el('single').disabled = mode === 'running' || mode === 'done' || !!search.error;
  el('minus').disabled = points.length <= 3;
  el('plus').disabled = points.length >= Number(el('count').max);
  showDetails(s);
}

function afterStep(countFinished = true) {
  if (search.done) {
    if (countFinished) statistics[algorithm].recordManual(points, measureRun(search));
    mode = 'done';
    bestView = true;
  }
  render();
}

function animate(now) {
  if (mode !== 'running') return;
  const rate = rates[Number(el('speed').value)];
  const delta = Math.max(0, Math.min(now - lastTime, 100));
  lastTime = now;
  const turbo = rate === Infinity;
  if (!turbo) credit += delta * rate / 1000;
  const advanced = search.advance(turbo ? Infinity : Math.floor(credit), 8);
  if (!turbo) credit -= advanced;
  if (advanced || search.done) afterStep();
  if (mode === 'running') frame = requestAnimationFrame(animate);
}

function setSpeed() {
  const speed = el('speed'), rate = rates[Number(speed.value)];
  const label = Number.isFinite(rate) ? rate + ' шаг/с' : 'Максимум';
  el('speed-label').textContent = label;
  speed.setAttribute('aria-valuetext', label);
  speed.style.setProperty('--fill', (speed.value * 25) + '%');
  credit = 0;
}

el('start').onclick = () => {
  if (!applyCityCount()) return;
  if (mode === 'done') { search = createRouteSearch(algorithm, points); bestView = false; }
  if (search.done) { afterStep(); return; }
  mode = 'running';
  credit = 1;
  lastTime = performance.now();
  render();
  frame = requestAnimationFrame(animate);
};
el('stop-search').onclick = () => { cancelAnimationFrame(frame); mode = 'paused'; render(); };
el('single').onclick = () => {
  if (!applyCityCount()) return;
  search.step();
  mode = 'paused';
  afterStep();
};
el('generate').onclick = newField;
el('count').onchange = applyCityCount;
el('count').onblur = () => { if (el('count').validity.valid) applyCityCount(); };
for (const [id, delta] of [['minus', -1], ['plus', 1]]) {
  el(id).onclick = () => { el('count').value = Math.min(Number(el('count').max), Math.max(3, points.length + delta)); newField(); };
}
el('show-current').onclick = () => { bestView = false; render(); };
el('show-best').onclick = () => { bestView = true; render(); };
const lengthCaption = el('chart-caption').textContent;
function setChartMode(balance) {
  balanceView = balance;
  el('length-mode').setAttribute('aria-pressed', String(!balance));
  el('balance-mode').setAttribute('aria-pressed', String(balance));
  el('chart-caption').textContent = balance
    ? 'Q сравнивает энергию ветвей с энергией равных ветвей той же суммарной длины. При Q = 1 ветви равны. Даже у кратчайшего цикла Q может быть больше 1.'
    : lengthCaption;
  drawConvergence(chart, search, balanceView);
}
el('length-mode').onclick = () => setChartMode(false);
el('balance-mode').onclick = () => setChartMode(true);
el('speed').oninput = setSpeed;
el('help').onclick = () => el('dialog').showModal();
el('close').onclick = () => el('dialog').close();
el('dialog').onclick = e => {
  if (e.target !== el('dialog')) return;
  const r = e.target.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
};
function configureAlgorithm() {
  const held = algorithm === 'held';
  el('algorithm-intro').textContent = {
    khvastuns: 'Две ветви растут от A к B и собирают один цикл.',
    'hvastuns-4': 'Две ветви от A и две от B растут навстречу. Любая ветвь от A может встретиться с любой от B.',
    held: 'Held–Karp заполняет таблицу по подмножествам городов. Готовый цикл появится на карте после восстановления пути.'
  }[algorithm];
  el('count').max = held ? 22 : maxCities;
  el('count-range').textContent = '3–' + el('count').max;
  for (const item of document.querySelectorAll('.branch-only')) item.hidden = held;
  el('chart-panel').hidden = el('branch-help').hidden = held;
  el('held-help').hidden = !held;
  el('four-help').hidden = algorithm !== 'hvastuns-4';
  el('two-help').hidden = algorithm !== 'khvastuns';
  statistics[algorithm].activate();
}
el('algorithm').onchange = () => {
  cancelAnimationFrame(frame);
  manualRuns.set(algorithm, { search, mode: mode === 'running' ? 'paused' : mode, bestView });
  statistics[algorithm].pause();
  algorithm = el('algorithm').value;
  configureAlgorithm();
  comparison.clear();
  const saved = manualRuns.get(algorithm);
  if (saved) ({ search, mode, bestView } = saved);
  else { search = createRouteSearch(algorithm, points); mode = 'ready'; bestView = false; }
  afterStep();
};
el('stats-export-all').onclick = async event => {
  const button = event.currentTarget, status = el('export-status');
  button.disabled = true;
  try {
    const algorithms = await Promise.all(Object.values(statistics).map(stats => stats.report()));
    downloadStatsReport({ formatVersion: 2, exportedAt: new Date().toISOString(), algorithms }, 'all');
    status.textContent = 'JSON со сводками трёх алгоритмов подготовлен.';
  } catch {
    status.textContent = 'Не удалось прочитать все сводки для экспорта.';
  } finally {
    button.disabled = false;
    status.hidden = false;
  }
};
document.querySelector('.details').ontoggle = () => showDetails(bestView ? search.best : search.current);
new ResizeObserver(() => drawMap(bestView ? search.best : search.current)).observe(map);
new ResizeObserver(() => drawConvergence(chart, search, balanceView)).observe(chart);
configureAlgorithm();
setSpeed();
newField(false);
