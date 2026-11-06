'use strict';

const ABSOLUTE_SCORE_LIMITS = [0, 1e-12, 1e-9, 1e-6, 1e-4, 1e-3, 0.01, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1];
const SCORE_COMPONENTS = {
  combined: { label: 'Общий балл', formula: 'M × exp(−C)', prefix: 'edgeScore', runs: 'scoreDistributionRuns', min: 'routeScoreMin' },
  length: { label: 'Длина ребра', formula: 'exp(−d / (rᵢ + rⱼ))', prefix: 'scoreLength', runs: 'scoreLengthRuns', min: 'scoreLengthMin' },
  crossings: { label: 'Пересечения', formula: 'exp(−C)', prefix: 'scoreCrossings', runs: 'scoreCrossingsRuns', min: 'scoreCrossingsMin' },
  bound: { label: 'Рост нижней оценки', formula: 'exp(−(Bₑ − B₀)₊ / mean(r))', prefix: 'scoreBound', runs: 'scoreBoundRuns', min: 'scoreBoundMin' }
};
const scoreDistributionMetrics = {
  scoreDistributionRuns: ['Прогоны с распределением оценок', 'Число завершённых прогонов с исходными абсолютными оценками всех рёбер и отметкой вхождения в итоговый цикл.'],
  ...Object.fromEntries(ABSOLUTE_SCORE_LIMITS.flatMap((_, i) => [
    ['edgeScoreBin' + i + 'All', ['Рёбер карты в корзине ' + i, 'Исходная абсолютная оценка; границы корзины приведены в scoreDistribution.']],
    ['edgeScoreBin' + i + 'Selected', ['Рёбер цикла в корзине ' + i, 'Каждое неориентированное ребро итогового цикла учитывается один раз.']]
  ])),
  ...Object.fromEntries(Object.values(SCORE_COMPONENTS).slice(1).flatMap(c => [
    [c.runs, ['Прогоны с составляющей: ' + c.label, 'Новые завершённые прогоны с отдельными исходными множителями оценки.']],
    [c.min, ['Минимум: ' + c.label, 'Наименьший множитель среди рёбер итогового цикла.']],
    [c.prefix + 'Mean', ['Среднее: ' + c.label, 'Среднее множителя среди рёбер итогового цикла.']],
    ...ABSOLUTE_SCORE_LIMITS.flatMap((_, i) => [
      [c.prefix + 'Bin' + i + 'All', [c.label + ': рёбер карты в корзине ' + i, 'Корзина отдельного множителя до глобальных запретов.']],
      [c.prefix + 'Bin' + i + 'Selected', [c.label + ': рёбер цикла в корзине ' + i, 'Рёбра итогового цикла в корзине отдельного множителя.']]
    ])
  ]))
};

function absoluteScoreBand(score) {
  if (!Number.isFinite(score) || score < 0 || score > 1) return -1;
  if (score === 0) return 0;
  const upper = ABSOLUTE_SCORE_LIMITS.findIndex((limit, i) => i > 0 && score < limit);
  return upper < 0 ? ABSOLUTE_SCORE_LIMITS.length - 1 : upper;
}

function scoreDistributionMeasurements(run) {
  if (!run.done || !run.edgeAnalysis?.done || !run.best) return {};
  const quality = routeScoreQuality(run.edgeAnalysis, run.best.paths);
  const selected = new Set(quality.chosenEdges.map(e => e.id));
  const measurements = {};
  for (const [key, component] of Object.entries(SCORE_COMPONENTS)) {
    const all = ABSOLUTE_SCORE_LIMITS.map(() => 0), chosen = all.slice();
    let minimum = Infinity, sum = 0, valid = true;
    for (const edge of run.edgeAnalysis.edges) {
      // Последующие запреты не изменяют исходные баллы и составляющие.
      const value = key === 'combined' ? edge.initialScore : edge.initialParts?.[key];
      const band = absoluteScoreBand(value);
      if (band < 0) { valid = false; break; }
      all[band]++;
      if (selected.has(edge.id)) { chosen[band]++; minimum = Math.min(minimum, value); sum += value; }
    }
    if (!valid) continue;
    measurements[component.runs] = 1;
    if (key !== 'combined') {
      measurements[component.min] = minimum;
      measurements[component.prefix + 'Mean'] = sum / selected.size;
    }
    for (let i = 0; i < all.length; i++) {
      measurements[component.prefix + 'Bin' + i + 'All'] = all[i];
      measurements[component.prefix + 'Bin' + i + 'Selected'] = chosen[i];
    }
  }
  return measurements;
}

function scoreDistribution(rows, n = null, componentKey = 'combined', scoreModel = CURRENT_SCORE_MODEL) {
  const component = SCORE_COMPONENTS[componentKey];
  if (!component) throw new Error('Неизвестная составляющая оценки.');
  const data = n === null ? rows : rows.filter(row => row.n === n);
  const bins = ABSOLUTE_SCORE_LIMITS.map((upper, i) => {
    const lower = i ? ABSOLUTE_SCORE_LIMITS[i - 1] : 0, upperInclusive = i === 0 || i === ABSOLUTE_SCORE_LIMITS.length - 1;
    return { index: i, lower, upper, lowerInclusive: i !== 1, upperInclusive,
      label: i === 0 ? '0' : (i === 1 ? '(' : '[') + formatEdgeScore(lower) + '; ' + formatEdgeScore(upper) + (upperInclusive ? ']' : ')'),
      all: 0, selected: 0 };
  });
  let runs = 0;
  for (const row of data) {
    const count = row.metrics[component.runs]?.sum;
    if (!count || bins.some(b => !row.metrics[component.prefix + 'Bin' + b.index + 'All'] || !row.metrics[component.prefix + 'Bin' + b.index + 'Selected'])) continue;
    runs += count;
    for (const bin of bins) {
      bin.all += row.metrics[component.prefix + 'Bin' + bin.index + 'All'].sum;
      bin.selected += row.metrics[component.prefix + 'Bin' + bin.index + 'Selected'].sum;
    }
  }
  const completedRuns = data.reduce((sum, row) => sum + row.series + row.manual, 0);
  const allEdges = bins.reduce((sum, b) => sum + b.all, 0), selectedEdges = bins.reduce((sum, b) => sum + b.selected, 0);
  let minimum = null, minimumRuns = 0, minimumSizes = [];
  for (const row of data) {
    const metric = row.metrics[component.min];
    if (!metric?.samples || !Number.isFinite(metric.min) || metric.min < 0 || metric.min > 1) continue;
    minimumRuns += metric.samples;
    // Минимум минимумов сохраняет точное наблюдение, даже если старый прогон не хранил корзины.
    if (minimum === null || metric.min < minimum) { minimum = metric.min; minimumSizes = [row.n]; }
    else if (metric.min === minimum) minimumSizes.push(row.n);
  }
  return { version: 1, basis: componentKey === 'combined' ? 'absolute-initial-score' : 'initial-score-component',
    component: componentKey, scoreModel, formula: componentKey === 'combined' ? scoreModelInfo(scoreModel).formula : component.formula, weighting: 'edge-observations', n,
    runs, completedRuns, unmeasuredRuns: completedRuns - runs, allEdges, selectedEdges,
    selectedMinimum: { value: minimum, runs: minimumRuns, unmeasuredRuns: completedRuns - minimumRuns,
      sizes: minimumSizes, basis: component.min, observedEmptyBelow: minimum, provenCutoff: false },
    bins: bins.map(b => ({ ...b, outside: b.all - b.selected,
      inclusionPercent: b.all ? 100 * b.selected / b.all : null,
      routeSharePercent: selectedEdges ? 100 * b.selected / selectedEdges : null })) };
}

function renderScoreDistribution(rows, kind, scoreModel = CURRENT_SCORE_MODEL) {
  const panel = el('score-distribution'), size = el('distribution-size'), metric = el('distribution-y').value;
  const componentKey = el('distribution-component').value, component = SCORE_COMPONENTS[componentKey];
  const options = rows.filter(row => row.series + row.manual > 0).map(row => row.n), key = options.join(',');
  if (size.sizesKey !== key) {
    const previous = size.value;
    size.innerHTML = '<option value="all">Все размеры</option>' + options.map(n => '<option value="' + n + '">' + n + ' городов</option>').join('');
    if (options.includes(Number(previous))) size.value = previous;
    size.sizesKey = key;
  }
  const report = scoreDistribution(rows, size.value === 'all' ? null : Number(size.value), componentKey, scoreModel);
  el('distribution-basis').textContent = scoreModelInfo(scoreModel).label + ' · ' + component.label + ': ' + report.formula + '. ' +
    (componentKey === 'combined' ? 'Исходный полный балл до запретов по маршрутам.' : 'Отдельный множитель, без остальных штрафов и без маски глобальных запретов. Ноль множителя может быть округлением очень малого числа.') +
    (scoreModel === CURRENT_SCORE_MODEL && ['length', 'bound'].includes(componentKey) ? ' Этот множитель сохранён для диагностики и не участвует в балле v2.' : '') +
    ' Каждое ребро учитывается один раз на прогон. Это проверка эвристики, не доказательство отсечки.';
  el('distribution-summary').textContent = (kind === 'proof' ? 'Подтверждение оптимума' : 'Обычный поиск: серии и ручные прогоны') +
    ' · Прогонов с распределением: ' + integer.format(report.runs) + ' из ' + integer.format(report.completedRuns) +
    ' · Рёбер карт: ' + integer.format(report.allEdges) + ' · В итоговых циклах: ' + integer.format(report.selectedEdges) + '.';
  el('distribution-missing').hidden = !report.unmeasuredRuns;
  el('distribution-missing').textContent = 'Прогонов без подробных корзин: ' + integer.format(report.unmeasuredRuns) +
    '. Минимумы и средние не позволяют восстановить распределение; эти прогоны не входят в график.';
  const minimum = report.selectedMinimum;
  el('distribution-minimum-value').textContent = minimum.value === null ? '—' : String(minimum.value).replace('.', ',');
  el('distribution-minimum-detail').textContent = minimum.value === null ? 'В накопленных данных ещё нет измерений минимума.' :
    'Ниже этого значения рёбра в итоговых циклах не встречались; равенство уже встречалось. Городов на поле с минимумом: ' +
    minimum.sizes.join(', ') + '. Прогонов с замером: ' + integer.format(minimum.runs) + ' из ' + integer.format(report.completedRuns) +
    '. Учитываются также старые прогоны с сохранённым минимумом без корзин. Это наблюдаемая граница, не доказанная отсечка для новых полей.';
  el('distribution-empty').hidden = report.runs > 0;
  el('distribution-content').hidden = !report.runs;
  if (!report.runs) { panel.chartKey = ''; return; }
  const caption = metric === 'inclusionPercent' ? 'По вертикали: вошло в цикл / встретилось на картах в этом диапазоне, %.' :
    'По вертикали: рёбра циклов в этом диапазоне / все рёбра итоговых циклов, %. Сумма столбцов — 100 %.';
  el('distribution-caption').textContent = caption + ' По горизонтали — диапазоны абсолютной исходной оценки. Ширина столбцов одинаковая, ширина диапазонов различается.';
  const chartKey = JSON.stringify([report, metric]);
  if (panel.chartKey === chartKey) return;
  panel.chartKey = chartKey;
  const svg = el('distribution-chart'), width = 980, left = 50, right = 16, top = 25, bottom = 240;
  const bandWidth = (width - left - right) / report.bins.length, chartHeight = bottom - top;
  const percent = value => value === null ? '—' : formatEdgeScore(value) + ' %';
  const tick = value => value > 0 && value < 0.0001 ? value.toExponential(0).replace('e-', 'e−') : formatEdgeScore(value);
  const detail = b => 'Оценка ' + b.label + ': на картах ' + integer.format(b.all) + ', в циклах ' + integer.format(b.selected) +
    '; частота включения ' + percent(b.inclusionPercent) + '; доля среди рёбер результата ' + percent(b.routeSharePercent) + '.';
  const grid = [0, 25, 50, 75, 100].map(value => {
    const y = bottom - chartHeight * value / 100;
    return '<path d="M' + left + ' ' + y + 'H' + (width - right) + '" stroke="#dce6f1"/><text x="' + (left - 9) + '" y="' + (y + 4) + '" text-anchor="end">' + value + '%</text>';
  }).join('');
  const bars = report.bins.map((b, i) => {
    const x = left + i * bandWidth, value = b[metric], height = value === null ? 0 : chartHeight * value / 100;
    const label = i === 0 ? ['0', ''] : [tick(b.lower) + '–', tick(b.upper)];
    return '<g data-score-bin="' + i + '" tabindex="0" role="button" aria-label="' + detail(b) + '"><title>' + detail(b) + '</title>' +
      '<rect class="distribution-hit" x="' + x + '" y="' + top + '" width="' + bandWidth + '" height="' + (chartHeight + 47) + '" fill="transparent"/>' +
      '<rect class="distribution-bar" x="' + (x + 7) + '" y="' + (bottom - height) + '" width="' + (bandWidth - 14) + '" height="' + height + '" rx="2" fill="#2859df"/>' +
      '<text x="' + (x + bandWidth / 2) + '" y="' + (bottom - height - 7) + '" text-anchor="middle">' + percent(b.all ? value : null) + '</text>' +
      label.map((line, j) => '<text x="' + (x + bandWidth / 2) + '" y="' + (bottom + 19 + j * 16) + '" text-anchor="middle">' + line + '</text>').join('') + '</g>';
  }).join('');
  svg.innerHTML = grid + bars;
  const select = event => {
    const bar = event.target.closest('[data-score-bin]');
    if (!bar) return;
    for (const item of svg.querySelectorAll('[data-score-bin]')) item.classList.toggle('selected', item === bar);
    el('distribution-detail').textContent = detail(report.bins[Number(bar.dataset.scoreBin)]);
  };
  if (svg.selectBin) svg.removeEventListener('focusin', svg.selectBin);
  svg.selectBin = select;
  svg.addEventListener('focusin', select);
  svg.onpointerover = svg.onclick = select;
  svg.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(event); } };
  el('distribution-detail').textContent = 'Наведи на столбец или выбери его, чтобы увидеть число наблюдений и обе доли.';
  el('distribution-bins').innerHTML = report.bins.map(b => '<tr><th>' + b.label + '</th><td>' + integer.format(b.all) + '</td><td>' + integer.format(b.selected) +
    '</td><td>' + percent(b.inclusionPercent) + '</td><td>' + percent(b.routeSharePercent) + '</td></tr>').join('');
}
