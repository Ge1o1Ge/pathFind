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
let manualDiversity = false;
const maxCities = Number(el('count').max);
let algorithm = el('algorithm').value;
let fieldProfile = normalizeFieldProfile(), fieldDescriptor;
const statisticsContexts = new Map();
function statisticsContext(profile) {
  const key = fieldProfileKey(profile);
  if (!statisticsContexts.has(key)) {
    const selected = () => fieldProfileKey(fieldProfile) === key;
    const current = id => () => selected() && (!isVariableAlgorithm(id) || el('stats-score-model').value === CURRENT_SCORE_MODEL);
    const archive = () => selected() && el('stats-score-model').value === LEGACY_SCORE_MODEL;
    const variableIds = Object.keys(ROUTE_ALGORITHMS).filter(isVariableAlgorithm);
    statisticsContexts.set(key, { profile,
      statistics: Object.fromEntries(Object.keys(ROUTE_ALGORITHMS).map(id => [id, initStatistics(maxCities, id, 'normal', profile, current(id))])),
      proofStatistics: Object.fromEntries(Object.keys(ROUTE_ALGORITHMS).filter(id => id !== 'held')
        .map(id => [id, initStatistics(maxCities, id, 'proof', profile, current(id))])),
      archiveStatistics: Object.fromEntries(variableIds.map(id => [id, initStatistics(maxCities, id, 'normal', profile, archive, LEGACY_SCORE_MODEL, true)])),
      archiveProofStatistics: Object.fromEntries(variableIds.map(id => [id, initStatistics(maxCities, id, 'proof', profile, archive, LEGACY_SCORE_MODEL, true)])) });
  }
  return statisticsContexts.get(key);
}
let { statistics, proofStatistics, archiveStatistics, archiveProofStatistics } = statisticsContext(fieldProfile);
const activeStatistics = () => {
  const archive = isVariableAlgorithm(algorithm) && el('stats-score-model').value === LEGACY_SCORE_MODEL;
  return (el('series-mode').value === 'proof' ? (archive ? archiveProofStatistics : proofStatistics) :
    (archive ? archiveStatistics : statistics))[algorithm];
};
const manualRuns = new Map();
const comparison = initComparison(() => points, () => algorithm,
  (id, field, measurement) => statistics[id].recordManual(field, measurement), () => search);
const clockNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const elapsed = ms => ms < 1000 ? clockNumber.format(ms) + ' мс' : clockNumber.format(ms / 1000) + ' с';

function replaceField(descriptor, countFinished = true) {
  const nextSearch = createManualRun(algorithm, descriptor.points, manualDiversity);
  if (fieldProfileKey(fieldProfile) !== fieldProfileKey(descriptor.profile)) {
    for (const stats of [...Object.values(statistics), ...Object.values(proofStatistics)]) stats.pause();
    fieldProfile = descriptor.profile;
    ({ statistics, proofStatistics, archiveStatistics, archiveProofStatistics } = statisticsContext(fieldProfile));
    if (!isEdgeMode()) activeStatistics().activate();
  }
  rememberFieldProfile(fieldProfile);
  cancelAnimationFrame(frame);
  points = descriptor.points;
  fieldDescriptor = descriptor;
  el('count').value = points.length;
  comparison.clear();
  manualRuns.clear();
  resetEdgeView(); resetZeroView(); resetProbeView();
  search = nextSearch;
  mode = 'ready'; bestView = false; mapSize = '';
  showFieldControls();
  afterStep(countFinished);
  return true;
}

function newField(countFinished = true, freshSeed = true) {
  if (!el('count').reportValidity()) return false;
  try {
    const profile = readFieldControls();
    if (profile.type === 'custom') return replaceField({ profile, seed: null, points: validateFieldPoints(points) }, countFinished);
    const seed = freshSeed ? crypto.getRandomValues(new Uint32Array(1))[0] : el('field-seed').valueAsNumber;
    return replaceField({ profile, seed, points: generateField(el('count').valueAsNumber, seed, profile) }, countFinished);
  } catch (error) { el('field-status').textContent = error.message; return false; }
}

function applyCityCount() {
  return points.length === el('count').valueAsNumber || newField();
}

function drawMap(s) {
  const w = map.clientWidth, h = map.clientHeight;
  if (!w || !h) return;
  let minX = 0, maxX = 100, minY = 0, maxY = 50;
  if (points.some(p => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 50)) {
    minX = Math.min(...points.map(p => p.x)); maxX = Math.max(...points.map(p => p.x));
    minY = Math.min(...points.map(p => p.y)); maxY = Math.max(...points.map(p => p.y));
    const px = Math.max((maxX - minX) * 0.03, 1), py = Math.max((maxY - minY) * 0.03, 1);
    minX -= px; maxX += px; minY -= py; maxY += py;
  }
  const scale = Math.min((w - 64) / (maxX - minX), (h - 40) / (maxY - minY));
  const ox = (w - scale * (maxX - minX)) / 2 - minX * scale + 5;
  const oy = (h + scale * (maxY - minY)) / 2 + minY * scale - 3;
  const x = i => ox + points[i].x * scale, y = i => oy - points[i].y * scale;
  const key = w + 'x' + h;
  const small = w < 470;
  const radius = small ? 7.5 : 10;
  if (mapSize !== key) {
    mapSize = key;
    map.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    const tickStep = range => {
      const power = 10 ** Math.floor(Math.log10(range / (small ? 5 : 10)));
      return [1, 2, 5, 10].find(k => k * power >= range / (small ? 5 : 10)) * power;
    };
    const dx = tickStep(maxX - minX), dy = tickStep(maxY - minY);
    const grid = scale * dx;
    const ticks = [];
    const format = (px, py, value, anchor) => '<text x="' + px + '" y="' + py + '" text-anchor="' + anchor + '">' + value + '</text>';
    for (let i = Math.ceil(minX / dx) * dx; i <= maxX; i += dx) ticks.push(format(ox + i * scale, h - 7, Number(i.toPrecision(5)), 'middle'));
    for (let j = Math.ceil(minY / dy) * dy; j <= maxY; j += dy) ticks.push(format(7, oy - j * scale + 3, Number(j.toPrecision(5)), 'start'));
    map.innerHTML = '<defs><pattern id="dots" patternUnits="userSpaceOnUse" x="' + ox + '" y="' + oy + '" width="' + grid / 5 + '" height="' + grid / 5 + '"><circle r=".85" cx="1" cy="1" fill="#d0dce9"/></pattern><pattern id="grid" patternUnits="userSpaceOnUse" x="' + ox + '" y="' + oy + '" width="' + grid + '" height="' + grid + '"><path d="M ' + grid + ' 0 H0 V' + grid + '" fill="none" stroke="#dce6f1" stroke-width="1.1"/></pattern></defs>' +
      '<rect width="100%" height="100%" fill="url(#dots)"/><rect width="100%" height="100%" fill="url(#grid)"/><g font-size="9" fill="#8394a9">' + ticks.join('') + format(w - 10, h - 7, 'X', 'middle') + format(10, 13, 'Y', 'middle') + '</g><g id="roads"></g><g id="cities"></g><g id="map-overlay" pointer-events="none"></g>';
  }
  el('map-overlay').innerHTML = '';
  const probe = displayedProbe(), palette = probePalette(probe);
  if (isEdgeMode()) drawEdgeRoads(search, x, y);
  else if (isVarMode() && zeroView) drawZeroRoads(search, x, y);
  else if (probe) drawProbeRoads(s, probe, x, y, small ? 2 : 2.7);
  else el('roads').innerHTML = s.paths.map((path, i) => '<polyline points="' + path.map(j => x(j) + ',' + y(j)).join(' ') + '" fill="none" stroke="' + colors[i] + '" stroke-width="' + (small ? 2 : 2.7) + '" stroke-linejoin="round" stroke-linecap="round"/>').join('');
  const used = s.paths.map(path => new Set(path));
  el('cities').innerHTML = points.map((p, i) => {
    const end = i === search.a ? 'A' : i === search.b ? 'B' : '';
    const side = used.findIndex(cities => cities.has(i));
    const color = (isEdgeMode() && i === edgeFocus) || (isVarMode() && zeroView && i === zeroFocus) ? '#2859df' : side >= 0 ? palette[side] : '#8798ab';
    const label = end ? end + '·' + pad(i + 1) : pad(i + 1);
    const box = end ? '<rect x="' + (small ? -14 : -20) + '" y="' + (-radius - 1) + '" width="' + (small ? 28 : 40) + '" height="' + (2 * radius + 2) + '" rx="5" fill="#25374e" stroke="white" stroke-width="1.5"/>' :
      '<circle r="' + radius + '" fill="white" stroke="' + color + '" stroke-width="1.6"/>';
    return '<g data-city="' + i + '" transform="translate(' + x(i) + ' ' + y(i) + ')"><title>Город ' + pad(i + 1) + (end ? ' · ' + end : '') + ' (' + p.x + ', ' + p.y + ')</title>' + box +
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
  el('details-body').innerHTML = (isEdgeMode() ? '' : paths + '<p>Лучший цикл　<code>' + sequence(cycle) + '</code></p>' + cache) + '<div class="coords">' + points.map((p, i) => '<code>' + pad(i + 1) + ' (' + p.x + ', ' + p.y + ')</code>').join('') + '</div>';
}

function render() {
  const s = displayedState();
  drawMap(s);
  if (isEdgeMode()) renderEdgeMetrics();
  else {
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
      el('pending-count').textContent = integer.format(search.pending + search.stack.length + search.deferredCount + Number(Boolean(search.next)) + Number(Boolean(search.completion)));
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
      if (isVarMode() && search.combinationEnabled) el('bound-method').textContent += ' + свободные степени обеих ветвей B(F)';
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
  }
  el('status').dataset.mode = mode;
  const statusText = search.error ? 'Поле больше лимита' : isEdgeMode() ?
    ({ ready: 'Готов к оценке', running: 'Оценивание', paused: 'Остановлен', done: 'Оценка завершена' })[mode] :
    isVarMode() && mode === 'running' && search.phase !== 'search' ?
      (search.phase === 'matrix' ? 'Подготовка матрицы' : 'Обновление запретов') :
      isVarMode() && mode === 'running' && search.repair ? 'Перестройка цикла' : modeNames[mode];
  if (el('status').textContent !== statusText) el('status').textContent = statusText;
  el('note').textContent = search.error || search.note;
  el('show-best').disabled = !search.best;
  el('show-current').setAttribute('aria-pressed', String(!bestView && !zeroView && !probeView));
  el('show-best').setAttribute('aria-pressed', String(bestView && !zeroView && !probeView));
  renderZeroView();
  renderProbeView();
  el('diversify-search').checked = isVarMode() && search.diversityEnabled;
  el('start-label').textContent = mode === 'paused' ? 'Продолжить' : mode === 'done' ? 'Повторить' : 'Запустить';
  el('start').disabled = mode === 'running' || !!search.error;
  el('stop-search').disabled = mode !== 'running';
  el('single').disabled = mode === 'running' || mode === 'done' || !!search.error;
  el('minus').disabled = fieldProfile.type === 'custom' || points.length <= 3;
  el('plus').disabled = fieldProfile.type === 'custom' || points.length >= Number(el('count').max);
  showDetails(s);
}

function afterStep(countFinished = true) {
  if (search.done) {
    if (countFinished && !isEdgeMode()) statistics[algorithm].recordManual(points, measureRun(search));
    mode = 'done';
    if (!probeView) bestView = !isEdgeMode();
  }
  render();
}

function animate(now) {
  if (mode !== 'running') return;
  if (isVarMode() && search.hasBackgroundWork) {
    // Скорость анимации относится к состояниям поиска. Подготовка и перестройки идут короткими порциями без задержек.
    const advanced = search.advancePreparation(8);
    lastTime = now;
    if (advanced || search.done) afterStep();
    if (mode === 'running') frame = requestAnimationFrame(animate);
    return;
  }
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
  const label = Number.isFinite(rate) ? rate + (isEdgeMode() ? ' рёбер/с' : ' шаг/с') : 'Максимум';
  el('speed-label').textContent = label;
  speed.setAttribute('aria-valuetext', label);
  speed.style.setProperty('--fill', (speed.value * 25) + '%');
  credit = 0;
}

el('start').onclick = () => {
  if (!applyCityCount()) return;
  if (mode === 'done') { search = createManualRun(algorithm, points, manualDiversity); bestView = false; resetZeroView(); resetProbeView(); }
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
el('generate').onclick = () => newField();
el('count').onchange = applyCityCount;
el('count').onblur = () => { if (el('count').validity.valid) applyCityCount(); };
for (const [id, delta] of [['minus', -1], ['plus', 1]]) {
  el(id).onclick = () => { el('count').value = Math.min(Number(el('count').max), Math.max(3, points.length + delta)); newField(); };
}
el('show-current').onclick = () => { bestView = false; zeroView = probeView = false; render(); };
el('show-best').onclick = () => { bestView = true; zeroView = probeView = false; render(); };
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
el('diversify-search').onchange = () => {
  if (!isVarMode()) return;
  manualDiversity = el('diversify-search').checked;
  search.diversityEnabled = manualDiversity;
  if (manualDiversity) search.diversityNext = Math.min(search.diversityNext, search.mainSteps);
  render();
};
el('help').onclick = () => el('dialog').showModal();
el('close').onclick = () => el('dialog').close();
el('dialog').onclick = e => {
  if (e.target !== el('dialog')) return;
  const r = e.target.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
};
function configureAlgorithm() {
  resetProbeView();
  const held = algorithm === 'held', edges = isEdgeMode();
  el('series-mode').querySelector('[value="proof"]').disabled = held;
  if (held) el('series-mode').value = 'normal';
  resetZeroView();
  edgeDrawingKey = '';
  for (const item of document.querySelectorAll('.route-only')) item.hidden = edges;
  for (const item of document.querySelectorAll('.edge-only')) item.hidden = !edges;
  for (const item of document.querySelectorAll('.var-only')) item.hidden = !isVarMode();
  el('page-heading').textContent = edges ? 'Перспективность рёбер' : 'Поиск маршрута';
  el('monitor-title').textContent = edges ? 'Стоимость оценивания' : 'Ход поиска';
  el('speed-title').textContent = edges ? 'Скорость оценивания' : 'Скорость поиска';
  el('stats-tab').disabled = edges;
  el('manual-tab').textContent = edges ? 'Ручной анализ' : 'Ручной поиск';
  el('edge-help').hidden = !edges;
  el('extra-lengths').hidden = true;
  el('algorithm-intro').textContent = {
    khvastuns: 'Две ветви растут от A к B и собирают один цикл.',
    'hvastuns-4': 'Две ветви от A и две от B растут навстречу. Любая ветвь от A может встретиться с любой от B.',
    'hvastuns-var': 'Две ветви с ранжированием по пересечениям. Нижние границы доказывают отсечения; каждый глобальный ноль сохраняется в истории.',
    'hvastuns-staged': 'Сначала проверяем перспективные рёбра, затем подключаем слабые. Доказанные нули исключены навсегда; общий минимум учитывает все этапы.',
    'edge-scores': 'Толщина линии показывает оценку 0–1. Строгие нули отмечаются отдельно. Полный маршрут не строится.',
    held: 'Held–Karp заполняет таблицу по подмножествам городов. Готовый цикл появится на карте после восстановления пути.'
  }[algorithm];
  el('count').max = held ? 22 : maxCities;
  el('count-range').textContent = '3–' + el('count').max;
  for (const item of document.querySelectorAll('.branch-only')) item.hidden = held || edges;
  el('chart-panel').hidden = el('branch-help').hidden = held || edges;
  el('held-help').hidden = !held;
  el('four-help').hidden = algorithm !== 'hvastuns-4';
  el('two-help').hidden = algorithm !== 'khvastuns';
  if (edges) {
    el('manual-panel').hidden = false; el('stats-panel').hidden = true;
    el('manual-tab').setAttribute('aria-pressed', 'true'); el('stats-tab').setAttribute('aria-pressed', 'false');
    el('manual-tab').onclick = () => {};
  } else activeStatistics().activate();
  setSpeed();
}
el('algorithm').onchange = () => {
  cancelAnimationFrame(frame);
  manualRuns.set(algorithm, { search, mode: mode === 'running' ? 'paused' : mode, bestView });
  statistics[algorithm]?.pause();
  proofStatistics[algorithm]?.pause();
  algorithm = el('algorithm').value;
  configureAlgorithm();
  comparison.clear();
  const saved = manualRuns.get(algorithm);
  if (saved) ({ search, mode, bestView } = saved);
  else { search = createManualRun(algorithm, points, manualDiversity); mode = 'ready'; bestView = false; }
  if (isVarMode()) search.diversityEnabled = manualDiversity;
  afterStep();
};
el('series-mode').onchange = () => {
  statistics[algorithm]?.pause();
  proofStatistics[algorithm]?.pause();
  el('stats-metric').value = 'mainSteps';
  activeStatistics().activate();
};
el('stats-score-model').onchange = () => {
  statistics[algorithm]?.pause();
  proofStatistics[algorithm]?.pause();
  activeStatistics().activate();
};
el('stats-export-all').onclick = async event => {
  const button = event.currentTarget, status = el('export-status');
  button.disabled = true;
  try {
    const profiles = await knownFieldProfiles();
    const fieldProfiles = [];
    for (const profile of profiles) {
      const context = statisticsContext(profile);
      fieldProfiles.push({ profile, algorithms: await Promise.all(Object.values(context.statistics).map(stats => stats.report())),
        proofAlgorithms: await Promise.all(Object.values(context.proofStatistics).map(stats => stats.report())),
        scoreArchives: [{ scoreModel: LEGACY_SCORE_MODEL,
          algorithms: await Promise.all(Object.values(context.archiveStatistics).map(stats => stats.report())),
          proofAlgorithms: await Promise.all(Object.values(context.archiveProofStatistics).map(stats => stats.report())) }] });
    }
    const current = fieldProfiles.find(item => fieldProfileKey(item.profile) === fieldProfileKey(fieldProfile));
    downloadStatsReport({ formatVersion: 5, exportedAt: new Date().toISOString(), algorithms: current.algorithms,
      proofAlgorithms: current.proofAlgorithms, scoreArchives: current.scoreArchives, fieldProfiles }, 'all');
    status.textContent = 'JSON всех геометрий, алгоритмов и обоих режимов подготовлен.';
  } catch {
    status.textContent = 'Не удалось прочитать все сводки для экспорта.';
  } finally {
    button.disabled = false;
    status.hidden = false;
  }
};
function displayedState() { return (isVarMode() && probeView && selectedProbeFrame()) || ((bestView || (isVarMode() && zeroView)) && search.best) || search.current; }
document.querySelector('.details').ontoggle = () => showDetails(displayedState());
new ResizeObserver(() => drawMap(displayedState())).observe(map);
new ResizeObserver(() => { if (!isEdgeMode()) drawConvergence(chart, search, balanceView); }).observe(chart);
initEdgeView();
initZeroView();
initProbeView();
initFieldControls();
configureAlgorithm();
setSpeed();
newField(false);
