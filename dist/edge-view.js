'use strict';

let edgeFocus = -1, edgeSelected = -1, edgeDrawingKey = '';
function isEdgeMode() { return algorithm === 'edge-scores'; }
function createManualRun(id, points, diversityEnabled = false) {
  const run = id === 'edge-scores' ? new EdgeAnalysis(points) : createRouteSearch(id, points);
  if (isVariableAlgorithm(id)) run.diversityEnabled = diversityEnabled;
  return run;
}
function resetEdgeView() { edgeFocus = edgeSelected = -1; edgeDrawingKey = ''; }
function edgeScoreText(score) {
  if (score === null) return 'ещё не оценено';
  if (score === 0) return '0 · доказанное исключение';
  return score < 0.000001 ? '< 0,000001' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 }).format(score);
}
function drawEdgeRoads(run, x, y) {
  const threshold = Number(el('edge-threshold').value) / 100, zeros = el('edge-show-excluded').checked;
  const key = [mapSize, run.processed, threshold, zeros, edgeFocus, edgeSelected].join('/');
  if (key === edgeDrawingKey) return;
  edgeDrawingKey = key;
  const visible = run.edges.map((edge, i) => ({ edge, i })).filter(({ edge: e }) => e.score !== null &&
    (edgeFocus < 0 || e.a === edgeFocus || e.b === edgeFocus) && (e.excluded ? zeros : e.score >= threshold));
  visible.sort((a, b) => a.edge.score - b.edge.score || a.i - b.i);
  el('roads').innerHTML = visible.map(({ edge: e, i }) => {
    const selected = i === edgeSelected;
    const width = (e.excluded ? 0.9 : 0.5 + 6 * e.score) + (selected ? 1.5 : 0);
    const title = pad(e.a + 1) + ' — ' + pad(e.b + 1) + ' · ' + edgeScoreText(e.score) +
      (e.reason ? ' · ' + e.reason : '');
    return '<line data-edge="' + i + '" x1="' + x(e.a) + '" y1="' + y(e.a) + '" x2="' + x(e.b) + '" y2="' + y(e.b) +
      '" stroke="' + (e.excluded ? '#ba3b45' : selected ? '#172d52' : '#2859df') +
      '" stroke-width="' + width.toFixed(2) + '" stroke-opacity="' + (selected ? 1 : e.excluded ? 0.6 : 0.2 + 0.8 * e.score) +
      '"' + (e.excluded ? ' stroke-dasharray="4 4"' : '') + '><title>' + title + '</title></line>';
  }).join('');
  el('edge-visible').textContent = 'Показано ' + visible.length + ' / ' + run.edges.length;
}
function renderEdgeMetrics() {
  const run = search;
  el('edge-progress').textContent = integer.format(run.processed) + ' / ' + integer.format(run.edges.length);
  for (const [id, value] of Object.entries({ excluded: run.excludedCount, pairs: run.crossingChecks,
    visits: run.pairVisits, 'spatial-skips': run.spatialSkips, neighbors: run.neighborChecks,
    connectivity: run.connectivityChecks, degrees: run.degreeChecks })) {
    el('edge-' + id).textContent = integer.format(value);
  }
  el('edge-total-time').textContent = elapsed(run.totalMs);
  el('edge-prep-time').textContent = elapsed(run.preparationMs);
  el('edge-analysis-time').textContent = elapsed(run.analysisMs);
  el('edge-threshold-label').textContent = clockNumber.format(Number(el('edge-threshold').value) / 100);
  el('edge-threshold').style.setProperty('--fill', el('edge-threshold').value + '%');
  el('edge-clear').disabled = edgeFocus < 0 && edgeSelected < 0;
  const e = run.edges[edgeSelected], number = value => Number.isFinite(value) ? distance.format(value) : '∞';
  el('edge-detail').innerHTML = e ? '<b>' + pad(e.a + 1) + ' — ' + pad(e.b + 1) + ' · оценка ' + edgeScoreText(e.score) + '</b>' +
    (e.score === null ? '' : '<br>Длина: ' + number(e.length) + ' · конфликтующих связей всего: ' + e.crossings +
      ' · из них короче: ' + e.shorterCrossings + ' · сумма весов коротких C: ' + number(e.burden) +
      '<br>Балл v2: M × exp(−C). Длина и прирост границы не входят в балл.' +
      '<br>Нижняя оценка с ребром Bₑ: ' + number(e.bound) +
      ' · исходная B₀: ' + number(run.baseBound) + ' · прирост: ' + number(e.extra) +
      (e.excluded ? '<br><b>Причина нуля:</b> ' + e.reason : '<br>Ребро не исключено. Оценка не гарантирует присутствия в оптимуме.')) :
    edgeFocus >= 0 ? 'Связи города ' + pad(edgeFocus + 1) + '. Выбери линию для подробностей.' : 'Выбери ребро на карте.';
  const m = run.edges.length;
  el('edge-complexity').textContent = 'Для ' + run.n + ' городов: ' + integer.format(m) + ' рёбер, ' +
    integer.format(m * (m - 1) / 2) + ' различных пар до фильтра: каждую проверяем один раз, конфликт записываем обоим рёбрам. ' +
    'Худшее время O(n⁴); память конфликтов O(n⁴) бит, геометрии O(n³). Матрица конфликтов: ' + integer.format(run.conflictBits.byteLength) + ' байт. ' +
    'Проверок прямоугольников: ' + integer.format(run.boxChecks) + '. Подготовка: ' + integer.format(m) +
    ' расстояний и ' + integer.format(run.orientationChecks) + ' ориентаций троек.';
}
function initEdgeView() {
  for (const id of ['edge-threshold', 'edge-show-excluded']) el(id).oninput = () => { if (isEdgeMode()) render(); };
  el('edge-clear').onclick = () => { resetEdgeView(); render(); };
  map.addEventListener('click', event => {
    if (!isEdgeMode()) return;
    const city = event.target.closest('[data-city]'), edge = event.target.closest('[data-edge]');
    if (city) {
      const i = Number(city.dataset.city);
      edgeFocus = edgeFocus === i ? -1 : i;
      edgeSelected = -1;
    } else if (edge) edgeSelected = Number(edge.dataset.edge);
    else return;
    render();
  });
  el('edge-export').onclick = () => downloadStatsReport({ ...search.report(), exportedAt: new Date().toISOString() }, 'edge-scores');
}
