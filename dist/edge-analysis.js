'use strict';

const CURRENT_SCORE_MODEL = 'crossings-v2';
const LEGACY_SCORE_MODEL = 'product-v1';
function scoreModelInfo(model = CURRENT_SCORE_MODEL) {
  if (model === CURRENT_SCORE_MODEL) return { id: model, label: 'Пересечения · v2', formula: 'M × exp(−C)' };
  if (model === LEGACY_SCORE_MODEL) return { id: model, label: 'Прежнее произведение · v1', formula: 'M × exp(−d / (rᵢ + rⱼ)) × exp(−C) × exp(−(Bₑ − B₀)₊ / mean(r))' };
  throw new Error('Неизвестная версия оценки рёбер.');
}

class EdgeAnalysis {
  constructor(points, integerWeights = false, scoreModel = CURRENT_SCORE_MODEL) {
    const started = performance.now();
    this.scoreModel = scoreModelInfo(scoreModel).id;
    this.points = points;
    this.n = points.length;
    this.integerWeights = integerWeights;
    this.edges = [];
    this.index = Array.from({ length: this.n }, () => new Int32Array(this.n).fill(-1));
    this.dist = points.map(() => new Float64Array(this.n));
    for (let a = 0; a < this.n; a++) for (let b = a + 1; b < this.n; b++) {
      this.dist[a][b] = this.dist[b][a] = routeDistance(points[a], points[b], integerWeights);
    }
    this.near = this.dist.map((row, i) => points.map((_, j) => j).filter(j => j !== i).sort((a, b) => row[a] - row[b]));
    this.local = this.near.map((row, i) => (this.dist[i][row[0]] + this.dist[i][row[1]]) / 2);
    this.baseBound = this.local.reduce((sum, value) => sum + value, 0);
    this.scale = this.baseBound / this.n || 1;
    for (let a = 0; a < this.n; a++) for (let b = a + 1; b < this.n; b++) {
      const length = this.dist[a][b], local = this.local[a] + this.local[b] || this.scale;
      this.index[a][b] = this.index[b][a] = this.edges.length;
      this.edges.push({ id: this.edges.length, a, b, length, weight: Math.exp(-length / local), score: null, excluded: false,
        crossings: 0, shorterCrossings: 0, burden: 0,
        minX: Math.min(points[a].x, points[b].x), maxX: Math.max(points[a].x, points[b].x),
        minY: Math.min(points[a].y, points[b].y), maxY: Math.max(points[a].y, points[b].y) });
    }
    this.spatial = this.edges.slice().sort((e, f) => e.minX - f.minX || e.id - f.id);
    this.spatialNext = new Int32Array(this.edges.length).fill(-1);
    this.spatialPrevious = new Int32Array(this.edges.length).fill(-1);
    this.spatialHead = this.spatial[0].id;
    for (let i = 1; i < this.spatial.length; i++) {
      const previous = this.spatial[i - 1].id, current = this.spatial[i].id;
      this.spatialNext[previous] = current;
      this.spatialPrevious[current] = previous;
    }
    this.turn = new Int8Array(this.n ** 3);
    this.orientationChecks = 0;
    for (let a = 0; a < this.n; a++) for (let b = a + 1; b < this.n; b++) for (let c = 0; c < this.n; c++) {
      const p = points[a], q = points[b], r = points[c];
      const left = (q.x - p.x) * (r.y - p.y), right = (q.y - p.y) * (r.x - p.x);
      const value = Math.abs(left - right) > 8 * Number.EPSILON * (Math.abs(left) + Math.abs(right)) ? Math.sign(left - right) : 0;
      this.turn[(a * this.n + b) * this.n + c] = value;
      this.orientationChecks++;
    }
    this.blocked = new Uint8Array(this.edges.length);
    this.conflictWords = Math.ceil(this.edges.length / 32);
    this.conflictBits = new Uint32Array(this.edges.length * this.conflictWords);
    this.processed = this.pairVisits = this.crossingChecks = this.neighborChecks = this.connectivityChecks = 0;
    this.boxChecks = this.radiusChecks = this.spatialSkips = this.radiusSkips = 0;
    this.excludedCount = this.degreeChecks = 0;
    this.analysisMs = 0;
    this.preparationMs = performance.now() - started;
    this.done = false;
    this.note = 'Оценим каждое ребро, не строя полный маршрут.';
    this.current = { paths: [], len: [] };
    this.history = [];
    this.best = null;
    this.a = this.b = -1;
  }
  get totalMs() { return this.preparationMs + this.analysisMs; }
  inside(a, b, c) {
    const p = this.points[a], q = this.points[b], r = this.points[c];
    return (q.x - p.x) * (r.y - p.y) === (q.y - p.y) * (r.x - p.x) &&
      (r.x - p.x) * (r.x - q.x) + (r.y - p.y) * (r.y - q.y) < 0;
  }
  conflicts(e, f) {
    const { a, b } = e, { a: c, b: d } = f;
    if (a === c || a === d || b === c || b === d) return false;
    this.crossingChecks++;
    const n = this.n, turn = this.turn, ab = (a * n + b) * n, cd = (c * n + d) * n;
    const crosses = turn[ab + c] * turn[ab + d] < 0 && turn[cd + a] * turn[cd + b] < 0;
    const touches = !crosses && ((turn[ab + c] === 0 && this.inside(a, b, c)) ||
      (turn[ab + d] === 0 && this.inside(a, b, d)) || (turn[cd + a] === 0 && this.inside(c, d, a)) ||
      (turn[cd + b] === 0 && this.inside(c, d, b)));
    if (!crosses && !touches) return false;
    // Обе перестановки дешевле: при любом направлении обхода одна из них даёт улучшенный цикл.
    // Равные коллинеарные замены не запрещаем.
    const old = e.length + f.length, dist = this.dist;
    return old > Math.max(dist[a][c] + dist[b][d], dist[a][d] + dist[b][c]) + 32 * Number.EPSILON * old;
  }
  conflictIds(id) {
    const result = [], offset = id * this.conflictWords;
    for (let word = 0; word < this.conflictWords; word++) {
      let bits = this.conflictBits[offset + word];
      while (bits) {
        result.push(word * 32 + 31 - Math.clz32(bits & -bits));
        bits &= bits - 1;
      }
    }
    return result;
  }
  components(a, b) {
    const unseen = [];
    for (let i = 0; i < this.n; i++) if (i !== a && i !== b) unseen.push(i);
    let components = 0;
    while (unseen.length) {
      const queue = [unseen.pop()];
      components++;
      for (let head = 0; head < queue.length && unseen.length; head++) {
        const city = queue[head];
        for (let j = unseen.length - 1; j >= 0; j--) {
          this.connectivityChecks++;
          if (this.blocked[this.index[city][unseen[j]]]) continue;
          queue.push(unseen[j]);
          unseen[j] = unseen.at(-1);
          unseen.pop();
        }
      }
    }
    return components;
  }
  evaluate(e) {
    const { n } = this, { a, b } = e;
    // Удаляем обработанное ребро из списка за O(1). После города исчезают все его оставшиеся связи.
    const previous = this.spatialPrevious[e.id], next = this.spatialNext[e.id];
    if (previous === -1) this.spatialHead = next;
    else this.spatialNext[previous] = next;
    if (next !== -1) this.spatialPrevious[next] = previous;
    this.blocked.fill(0);
    for (const id of this.conflictIds(e.id)) this.blocked[id] = 1;
    const before = this.pairVisits;
    for (let id = this.spatialHead; id !== -1; id = this.spatialNext[id]) {
      const f = this.edges[id];
      // Непересекающиеся прямоугольники отрезков исключают и пересечение, и касание.
      if (f.minX > e.maxX) break;
      // Список содержит только последующие рёбра; результат записываем обоим отрезкам.
      this.boxChecks++;
      if (f.maxX < e.minX || f.minY > e.maxY || f.maxY < e.minY) continue;
      this.pairVisits++;
      if (this.conflicts(e, f)) {
        this.blocked[f.id] = 1;
        this.conflictBits[e.id * this.conflictWords + (f.id >>> 5)] |= 1 << (f.id & 31);
        this.conflictBits[f.id * this.conflictWords + (e.id >>> 5)] |= 1 << (e.id & 31);
        e.crossings++; f.crossings++;
        // Штрафуем только перекрытие более короткой связи; равные длины не учитываем.
        if (f.length < e.length) { e.shorterCrossings++; e.burden += f.weight; }
        if (e.length < f.length) { f.shorterCrossings++; f.burden += e.weight; }
      }
    }
    this.spatialSkips += this.edges.length - 1 - e.id - (this.pairVisits - before);
    let sum = 0, blocked = -1;
    for (let i = 0; i < n; i++) {
      this.degreeChecks++;
      let need = i === a || i === b ? 1 : 2, value = 0;
      // Достаточно нужного числа ближайших допустимых соседей; дальние уже не улучшают оценку.
      for (const j of this.near[i]) {
        this.neighborChecks++;
        const id = this.index[i][j];
        if (id === e.id || this.blocked[id]) continue;
        value += this.dist[i][j];
        if (--need === 0) break;
      }
      if (need) { value = Infinity; if (blocked === -1) blocked = i; }
      sum += value;
    }
    // Для связности сохраняем все города и допустимые связи, независимо от длины и радиуса.
    const components = this.components(a, b);
    e.bound = e.length + sum / 2;
    e.extra = Math.max(0, e.bound - this.baseBound);
    // Сохраняем отдельные исходные множители до любых глобальных запретов поиска.
    e.initialParts = { length: e.weight, crossings: Math.exp(-e.burden), bound: Math.exp(-e.extra / this.scale) };
    e.excluded = blocked !== -1 || components > 1;
    e.reason = blocked !== -1 ? 'Не хватает допустимых связей у города ' + String(blocked + 1).padStart(2, '0') :
      components > 1 ? 'Внутренние города разделены на ' + components + ' компоненты; один оставшийся путь невозможен.' : '';
    // Это эвристическая оценка, а не частота появления ребра в оптимальных циклах.
    // Положительную оценку не округляем до строгого нуля.
    // Длина и прирост границы остаются диагностикой. В новой оценке работает только штраф пересечений.
    const value = this.scoreModel === LEGACY_SCORE_MODEL ? e.weight * Math.exp(-e.burden - e.extra / this.scale) : e.initialParts.crossings;
    e.score = e.excluded ? 0 : Math.max(Number.MIN_VALUE, value);
    // Исходная оценка нужна для проверки ранжирования: последующие запреты её не меняют.
    e.initialScore = e.score;
    if (e.excluded) this.excludedCount++;
    this.processed++;
    this.done = this.processed === this.edges.length;
    this.note = this.done ? 'Все рёбра оценены. Полный маршрут не строился.' :
      'Оценено рёбер: ' + this.processed + ' / ' + this.edges.length + '.';
  }
  advance(limit = Infinity, sliceMs = Infinity) {
    if (this.done || limit < 1) return 0;
    const started = performance.now(), before = this.processed;
    do {
      this.evaluate(this.edges[this.processed]);
    } while (!this.done && this.processed - before < limit && performance.now() - started < sliceMs);
    this.analysisMs += performance.now() - started;
    return this.processed - before;
  }
  step() { return this.advance(1); }
  report() {
    const matrix = this.index.map(row => Array.from(row, i => i === -1 ? null : this.edges[i].score));
    const mask = this.index.map(row => Array.from(row, i => i === -1 ? 0 : this.edges[i].score === null ? null : Number(!this.edges[i].excluded)));
    return { algorithm: 'edge-scores', formatVersion: 3, scoreModel: this.scoreModel, done: this.done, n: this.n, points: this.points,
      weights: this.integerWeights ? 'ceil(1000*d)' : 'euclidean',
      description: 'Эвристические оценки, не откалиброванные вероятности. Диагональ scores — null. Нулевой mask означает доказанное исключение.',
      formula: 'r_i=(d_i1+d_i2)/2; w_ij=exp(-d_ij/(r_i+r_j)); C(e)=sum(w_f по конфликтующим f с d_f<d_e); s(e)=' + scoreModelInfo(this.scoreModel).formula,
      baseBound: this.baseBound, scores: matrix, mask,
      initialScores: this.index.map(row => Array.from(row, i => i === -1 ? null : this.edges[i].initialScore ?? null)),
      work: { edges: this.edges.length, processed: this.processed, excluded: this.excludedCount,
        distances: this.edges.length, orientationChecks: this.orientationChecks, pairVisits: this.pairVisits,
        boxChecks: this.boxChecks, radiusChecks: this.radiusChecks, spatialSkips: this.spatialSkips, radiusSkips: this.radiusSkips,
        possiblePairs: this.edges.length * (this.edges.length - 1) / 2, conflictBytes: this.conflictBits.byteLength,
        crossingChecks: this.crossingChecks, neighborChecks: this.neighborChecks, connectivityChecks: this.connectivityChecks,
        degreeChecks: this.degreeChecks, preparationMs: this.preparationMs, analysisMs: this.analysisMs, totalMs: this.totalMs },
      edges: this.edges.map(e => ({ ...e, bound: Number.isFinite(e.bound) ? e.bound : null })) };
  }
}
