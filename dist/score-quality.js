'use strict';

const SCORE_BANDS = [
  ['zero', 'Исходный ноль'], ['low', 'Ниже 0,5 × медианы'], ['below', 'От 0,5 до 1 × медианы'],
  ['median', 'От 1 до 2 × медианы'], ['high', 'От 2 до 5 × медианы'], ['top', 'От 5 × медианы']
];
const scoreQualityMetrics = {
  mapScoreMedian: ['Медиана оценок карты', 'Медиана исходных положительных оценок всех рёбер поля до глобальных обнулений по рекорду.'],
  routeScoreMin: ['Минимальная оценка в цикле', 'Наименьшая исходная оценка среди рёбер итогового цикла.'],
  routeScoreMean: ['Средняя оценка в цикле', 'Среднее исходных оценок рёбер итогового цикла; каждое ребро учитывается один раз.'],
  routeScoreMinRelative: ['Минимум / медиана карты', 'Минимальная оценка ребра цикла, делённая на медиану исходных положительных оценок карты.'],
  routeScoreMeanRelative: ['Средняя / медиана карты', 'Средняя оценка рёбер цикла, делённая на медиану исходных положительных оценок карты.'],
  likelyEdges: ['Перспективных рёбер на карте', 'Исходная оценка не ниже медианы положительных оценок этого поля. Равенство включается.'],
  likelySelected: ['Перспективных рёбер в цикле', 'Сколько рёбер с исходной оценкой не ниже медианы карты вошло в итоговый цикл.'],
  likelyMissed: ['Перспективных рёбер вне цикла', 'Сколько рёбер с исходной оценкой не ниже медианы карты не вошло в найденный оптимальный цикл. При нескольких оптимумах речь об одном найденном.'],
  routeBelowMedian: ['Рёбер цикла ниже медианы', 'Сколько рёбер итогового цикла получили исходную оценку ниже медианы карты.'],
  ...Object.fromEntries(SCORE_BANDS.flatMap(([key, label]) => [
    ['scoreBand_' + key + '_all', ['На карте: ' + label, 'Число рёбер карты в этой группе исходных оценок.']],
    ['scoreBand_' + key + '_selected', ['В цикле: ' + label, 'Число рёбер итогового цикла в этой группе исходных оценок.']]
  ]))
};

function scoreBand(score, median) {
  if (score === 0) return 0;
  const ratio = score / median;
  return ratio < 0.5 ? 1 : ratio < 1 ? 2 : ratio < 2 ? 3 : ratio < 5 ? 4 : 5;
}
function routeScoreQuality(analysis, paths) {
  if (!analysis?.done || !paths) return null;
  if (analysis.qualityPaths === paths) return analysis.qualityResult;
  if (!analysis.scoreReference) {
    const positive = analysis.edges.map(e => e.initialScore).filter(score => score > 0).sort((a, b) => a - b);
    const lower = positive[(positive.length - 1) >> 1], upper = positive[positive.length >> 1];
    const median = positive.length ? lower + (upper - lower) / 2 : null;
    const counts = SCORE_BANDS.map(() => 0);
    for (const e of analysis.edges) counts[scoreBand(e.initialScore, median)]++;
    analysis.scoreReference = { median, counts, positiveCount: positive.length };
  }
  const { median, counts, positiveCount } = analysis.scoreReference;
  const edgeIds = path => {
    const ids = new Set();
    for (let i = 1; i < path.length; i++) ids.add(analysis.index[path[i - 1]][path[i]]);
    return [...ids].filter(id => id >= 0);
  };
  const relative = score => median && Number.isFinite(score / median) ? score / median : null;
  const summarize = ids => {
    const edges = ids.map(id => analysis.edges[id]);
    const minimum = edges.length ? edges.reduce((a, b) => a.initialScore <= b.initialScore ? a : b) : null;
    const mean = edges.length ? edges.reduce((sum, e) => sum + e.initialScore, 0) / edges.length : null;
    return { count: edges.length, min: minimum?.initialScore ?? null, mean,
      minRelative: minimum ? relative(minimum.initialScore) : null, meanRelative: mean === null ? null : relative(mean),
      weakest: minimum ? { id: minimum.id, a: minimum.a, b: minimum.b, score: minimum.initialScore } : null };
  };
  const branches = paths.map(path => summarize(edgeIds(path)));
  const chosen = [...new Set(paths.flatMap(edgeIds))];
  const bands = SCORE_BANDS.map(([key, label], i) => ({ key, label, all: counts[i], selected: 0 }));
  for (const id of chosen) bands[scoreBand(analysis.edges[id].initialScore, median)].selected++;
  const likelyEdges = bands.slice(3).reduce((sum, band) => sum + band.all, 0);
  const likelySelected = bands.slice(3).reduce((sum, band) => sum + band.selected, 0);
  const result = { basis: 'initial-positive-median', median, positiveCount, totalEdges: analysis.edges.length,
    ...summarize(chosen), likelyEdges, likelySelected, likelyMissed: likelyEdges - likelySelected,
    belowMedian: chosen.length - likelySelected, branches,
    bands: bands.map(b => ({ ...b, outside: b.all - b.selected, selectedPercent: b.all ? 100 * b.selected / b.all : null })),
    chosenEdges: chosen.map(id => { const e = analysis.edges[id]; return { id, a: e.a, b: e.b, score: e.initialScore }; }) };
  analysis.qualityPaths = paths;
  analysis.qualityResult = result;
  return result;
}
function routeScoreMeasurements(quality) {
  if (!quality) return {};
  const metrics = { mapScoreMedian: quality.median, routeScoreMin: quality.min, routeScoreMean: quality.mean,
    routeScoreMinRelative: quality.minRelative, routeScoreMeanRelative: quality.meanRelative,
    likelyEdges: quality.likelyEdges, likelySelected: quality.likelySelected, likelyMissed: quality.likelyMissed,
    routeBelowMedian: quality.belowMedian };
  for (const band of quality.bands) {
    metrics['scoreBand_' + band.key + '_all'] = band.all;
    metrics['scoreBand_' + band.key + '_selected'] = band.selected;
  }
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(value)));
}
function formatEdgeScore(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 100000)) return value.toExponential(3).replace('.', ',');
  return new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 4 }).format(value);
}
function renderScoreQuality(run) {
  const quality = routeScoreQuality(run.edgeAnalysis, run.best?.paths);
  el('quality-status').textContent = !run.edgeAnalysis.done ? 'Ожидаем завершения матрицы оценок.' : !run.best ?
    'Ожидаем первый полный маршрут.' : run.done ? 'Оценки рёбер найденного оптимального цикла.' : 'Оценки рёбер текущего рекорда. Оптимальность ещё не подтверждена.';
  el('quality-content').hidden = !quality;
  if (!quality) return;
  el('quality-median').textContent = formatEdgeScore(quality.median);
  el('quality-min').textContent = formatEdgeScore(quality.min);
  el('quality-mean').textContent = formatEdgeScore(quality.mean);
  el('quality-min-relative').textContent = formatEdgeScore(quality.minRelative) + ' × медиана';
  el('quality-mean-relative').textContent = formatEdgeScore(quality.meanRelative) + ' × медиана';
  el('quality-weakest').textContent = quality.weakest ? 'Ребро ' + pad(quality.weakest.a + 1) + ' — ' + pad(quality.weakest.b + 1) : '';
  el('quality-missed').textContent = quality.likelyMissed + ' / ' + quality.likelyEdges;
  el('quality-hit').textContent = 'Из ' + quality.count + ' рёбер цикла ' + quality.likelySelected + ' имеют оценку ≥ медианы. Ниже медианы: ' + quality.belowMedian + '.';
  el('quality-branches').textContent = quality.branches.map((b, i) => 'ℓ' + (i + 1) + ': минимум ' + formatEdgeScore(b.min) +
    ', средняя ' + formatEdgeScore(b.mean) + ', рёбер ' + b.count).join(' · ');
  if (el('quality-bands').quality === quality) return;
  el('quality-bands').quality = quality;
  el('quality-bands').innerHTML = quality.bands.map(b => '<tr><th>' + b.label + '</th><td>' + b.all + '</td><td>' + b.selected +
    '</td><td>' + b.outside + '</td><td>' + (b.selectedPercent === null ? '—' : clockNumber.format(b.selectedPercent) + ' %') + '</td></tr>').join('');
}
