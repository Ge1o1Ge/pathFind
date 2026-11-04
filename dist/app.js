'use strict';

const el = id => document.getElementById(id);
const map = el('map');
const chart = el('convergence-chart');
const distance = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('ru-RU');
const pad = n => String(n).padStart(2, '0');
const colors = ['#2859df', '#cf6a24'];
const rates = [1, 10, 60, 600, Infinity];
const modeNames = { ready: 'Готов к запуску', running: 'Идёт поиск', paused: 'Остановлен', done: 'Минимум доказан' };
let points, search, mode, bestView, frame = 0, lastTime = 0, credit = 0, mapSize = '';
let balanceView = false;
const maxCities = Number(el('count').max);
const statistics = initStatistics(maxCities);

function randomField(count, random = Math.random) {
  const cities = [];
  while (cities.length < count) {
    let pick, largest = -1;
    for (let trial = 0; trial < 8; trial++) {
      const p = { x: 4 + Math.floor(random() * 93), y: 3 + Math.floor(random() * 45) };
      const gap = cities.reduce((min, q) => Math.min(min, (p.x - q.x) ** 2 + (p.y - q.y) ** 2), Infinity);
      if (gap > largest) { pick = p; largest = gap; }
    }
    if (largest > 0) cities.push(pick);
  }
  return cities;
}

function newField(countFinished = true) {
  if (!el('count').reportValidity()) return false;
  cancelAnimationFrame(frame);
  points = randomField(el('count').valueAsNumber);
  search = new RouteSearch(points);
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
    const side = used[0].has(i) ? 0 : used[1].has(i) ? 1 : -1;
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
  const paths = s.paths.map((p, i) => '<p>Ветвь ' + (i ? 'ℓ₂' : 'ℓ₁') + '　<code>' + sequence(p) + '</code></p>').join('');
  const cycle = [...search.best.paths[0], ...search.best.paths[1].slice(0, -1).reverse()];
  const cache = '<p>Запомнено состояний　<code>' + integer.format(search.seen.size) + ' / ' + integer.format(MAX_SEEN_STATES) + '</code></p>';
  el('details-body').innerHTML = paths + '<p>Лучший цикл　<code>' + sequence(cycle) + '</code></p>' + cache + '<div class="coords">' + points.map((p, i) => '<code>' + pad(i + 1) + ' (' + p.x + ', ' + p.y + ')</code>').join('') + '</div>';
}

function render() {
  const s = bestView ? search.best : search.current;
  drawMap(s);
  drawConvergence(chart, search, balanceView);
  el('coverage').textContent = new Set(s.paths.flat()).size + ' / ' + points.length + ' городов';
  el('steps').textContent = integer.format(search.steps);
  el('crossing-cuts').textContent = integer.format(search.crossingCuts);
  el('dead-end-cuts').textContent = integer.format(search.deadEndCuts);
  el('queue-limit').textContent = integer.format(search.queueLimit);
  el('l1').textContent = distance.format(s.len[0]);
  el('l2').textContent = distance.format(s.len[1]);
  el('best').textContent = distance.format(search.best.len[0] + search.best.len[1]);
  el('warmup-count').textContent = integer.format(search.warmupCount);
  el('status').dataset.mode = mode;
  if (el('status').textContent !== modeNames[mode]) el('status').textContent = modeNames[mode];
  el('note').textContent = search.note;
  el('show-current').setAttribute('aria-pressed', String(!bestView));
  el('show-best').setAttribute('aria-pressed', String(bestView));
  el('start-label').textContent = mode === 'paused' ? 'Продолжить' : mode === 'done' ? 'Повторить' : 'Запустить';
  el('start').disabled = mode === 'running';
  el('stop-search').disabled = mode !== 'running';
  el('single').disabled = mode === 'running' || mode === 'done';
  el('minus').disabled = points.length <= 3;
  el('plus').disabled = points.length >= maxCities;
  showDetails(s);
}

function afterStep(countFinished = true) {
  if (search.done) {
    if (countFinished) statistics.recordManual(points, search);
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
  const before = search.steps;
  const deadline = performance.now() + 8;
  while (!search.done && (turbo || credit >= 1) && performance.now() < deadline) {
    search.step();
    if (!turbo) credit--;
  }
  if (search.steps !== before) afterStep();
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
  if (mode === 'done') { search = new RouteSearch(points); bestView = false; }
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
  el(id).onclick = () => { el('count').value = Math.min(maxCities, Math.max(3, points.length + delta)); newField(); };
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
document.querySelector('.details').ontoggle = () => showDetails(bestView ? search.best : search.current);
new ResizeObserver(() => drawMap(bestView ? search.best : search.current)).observe(map);
new ResizeObserver(() => drawConvergence(chart, search, balanceView)).observe(chart);
setSpeed();
newField(false);
