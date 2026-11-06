'use strict';

const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { EdgeAnalysis, ABSOLUTE_SCORE_LIMITS, absoluteScoreBand, LEGACY_SCORE_MODEL } = require('./lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');
const { separatedClusters } = require('./boundary-fields.cjs');

function componentsAbove(analysis, threshold) {
  const parent = Array.from({ length: analysis.n }, (_, i) => i);
  const root = i => { while (parent[i] !== i) i = parent[i]; return i; };
  for (const e of analysis.edges) if (e.initialScore > 0 && e.initialScore >= threshold) parent[root(e.a)] = root(e.b);
  return new Set(parent.map((_, i) => root(i))).size;
}

function inspectClusterCutoffs(field, thresholds = [0.01, 0.001, 1e-6, 1e-12, 1e-30], scoreModel = LEGACY_SCORE_MODEL) {
  const started = performance.now(), analysis = new EdgeAnalysis(field.points, false, scoreModel);
  analysis.advance();
  const analysisMs = performance.now() - started, cross = e => field.groups[e.a] !== field.groups[e.b];
  const bridges = analysis.edges.filter(cross);
  const bestBridge = bridges.reduce((a, b) => a.initialScore >= b.initialScore ? a : b);
  const referenceStarted = performance.now();
  // На больших полях разрыв графа доказывает потерю любого тура без вычисления оптимума.
  const reference = field.n <= 20 ? heldKarp(analysis.dist) : null;
  const referenceMs = performance.now() - referenceStarted;
  const selected = reference ? reference.tour.map((a, i) => analysis.edges[analysis.index[a][reference.tour[(i + 1) % field.n]]]) : null;
  if (reference) {
    const length = selected.reduce((sum, e) => sum + e.length, 0);
    if (new Set(reference.tour).size !== field.n || Math.abs(length - reference.length) > 1e-8) throw Error('Некорректный эталонный маршрут');
  }
  const bins = ABSOLUTE_SCORE_LIMITS.map(() => ({ all: 0, selected: 0 }));
  for (const e of analysis.edges) bins[absoluteScoreBand(e.initialScore)].all++;
  for (const e of selected || []) bins[absoluteScoreBand(e.initialScore)].selected++;
  const edgeData = e => {
    const penalties = { length: e.length / (analysis.local[e.a] + analysis.local[e.b] || analysis.scale),
      crossings: e.burden, forcedBound: e.extra / analysis.scale };
    // Логарифмические вклады сохраняются и тогда, когда произведение округлилось до минимального Number.
    const factors = Object.fromEntries(Object.entries(penalties).map(([key, value]) => [key, Math.exp(-value)]));
    return { a: e.a, b: e.b, score: e.initialScore, length: e.length, betweenGroups: cross(e),
      shorterCrossings: e.shorterCrossings, penalties, factors,
      negativeLog10: Object.fromEntries(Object.entries(penalties).map(([key, value]) => [key, value / Math.LN10])),
      crossingOnlyScore: factors.crossings,
      withoutLengthScore: Math.exp(-penalties.crossings - penalties.forcedBound) };
  };
  return { ...field, scoreModel, analysisMs, referenceMs, reference: reference ? 'Held–Karp, исходные евклидовы расстояния' : null,
    optimum: reference?.length ?? null, tour: reference?.tour ?? null, selectedEdges: selected?.map(edgeData) ?? null,
    minimumSelected: selected ? Math.min(...selected.map(e => e.initialScore)) : null,
    minimumCrossingFactorSelected: selected ? Math.min(...selected.map(e => Math.exp(-e.burden))) : null,
    selectedBridges: selected?.filter(cross).map(edgeData) ?? null,
    maximumBridgeScore: bestBridge.initialScore, strongestBridge: edgeData(bestBridge),
    clampedPositiveBridges: bridges.filter(e => e.initialScore === Number.MIN_VALUE).length, bins,
    cutoffs: thresholds.map(threshold => ({ threshold,
      selectedBelow: selected ? selected.filter(e => e.initialScore < threshold).length : null,
      selectedBelowCrossingOnly: selected ? selected.filter(e => Math.exp(-e.burden) < threshold).length : null,
      bridgesRetained: bridges.filter(e => e.initialScore > 0 && e.initialScore >= threshold).length,
      components: componentsAbove(analysis, threshold) })) };
}

function main() {
  const n = Number(process.argv[2] || 16), seeds = Number(process.argv[3] || 3);
  if (!Number.isInteger(n) || n < 8 || n > 20 || !Number.isInteger(seeds) || seeds < 1 || seeds > 100) {
    throw Error('Запуск: node tools/check-cluster-cutoffs.cjs [8–20 городов для DP] [1–100 полей на расклад]');
  }
  const separations = [2, 5, 10, 25, 100, 1000], rows = [];
  for (const left of [Math.floor(n / 2), Math.floor(n / 4), 1]) for (const separation of separations) {
    for (let seed = 0; seed < seeds; seed++) rows.push(inspectClusterCutoffs(separatedClusters(n, left, separation, seed)));
    console.log('Проверено: ' + left + '+' + (n - left) + ', разнос / ширина = ' + separation + ', полей: ' + seeds);
  }
  for (const left of [50, 1]) for (const separation of [5, 25, 100]) rows.push(inspectClusterCutoffs(separatedClusters(100, left, separation)));
  const groups = [...new Set(rows.map(r => r.n + ':' + r.left + ':' + r.separation))];
  const summary = groups.map(key => {
    const sample = rows.filter(r => r.n + ':' + r.left + ':' + r.separation === key);
    const minimums = sample.map(r => r.minimumSelected).filter(x => x !== null);
    return { группы: sample[0].left + '+' + (sample[0].n - sample[0].left), разнос_к_ширине: sample[0].separation,
      полей: sample.length, минимум_в_оптимуме: minimums.length ? Math.min(...minimums) : null,
      максимум_среди_всех_мостов: Math.max(...sample.map(r => r.maximumBridgeScore)),
      полей_с_потерей_ребра_при_001: minimums.length ? sample.filter(r => r.cutoffs[0].selectedBelow > 0).length : null,
      разрывов_графа_при_001: sample.filter(r => r.cutoffs[0].components > 1).length };
  });
  const output = join(__dirname, '../build', 'cluster-cutoffs-' + n + '-' + seeds + '.json');
  const referenceRows = rows.filter(row => row.reference), chosen = referenceRows.flatMap(row => row.selectedEdges);
  const factorSummary = ['length', 'crossings', 'forcedBound'].map(factor => ({ factor,
    runs: referenceRows.length, selectedEdges: chosen.length,
    minimumSelected: Math.min(...chosen.map(e => e.factors[factor])),
    selectedBelow001: chosen.filter(e => e.factors[factor] < 0.01).length,
    fieldsBelow001: referenceRows.filter(row => row.selectedEdges.some(e => e.factors[factor] < 0.01)).length }));
  mkdirSync(join(__dirname, '../build'), { recursive: true });
  writeFileSync(output, JSON.stringify({ weights: 'euclidean', score: 'initialScore', scoreModel: LEGACY_SCORE_MODEL, n, seeds,
    separationMeaning: 'Расстояние между центрами квадратов групп / ширина одного квадрата. Геометрия внутри групп одинакова при изменении разноса.',
    interpretation: 'Ребро эталона ниже порога означает потерю этого оптимального тура. Более сильная проверка: components > 1 исключает любой полный цикл, включая альтернативные оптимумы.',
    scoreLimits: ABSOLUTE_SCORE_LIMITS, summary, factorSummary, rows }, null, 2));
  console.table(summary);
  console.log('Каждый множитель отдельно: порог 0,01 на рёбрах эталонных оптимумов');
  console.table(factorSummary);
  console.log('Координаты, эталонные циклы, точные баллы и проверки нескольких порогов: ' + output);
}

if (require.main === module) main();
module.exports = { inspectClusterCutoffs, componentsAbove };
