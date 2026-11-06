'use strict';

class VariableRouteSearch extends RouteSearch {
  constructor(points, warmupLimit = points.length - 2, integerWeights = false, initialTour, scoreModel = CURRENT_SCORE_MODEL) {
    super(points, warmupLimit, integerWeights, initialTour);
    const started = performance.now();
    this.algorithm = 'hvastuns-var';
    this.edgeAnalysis = new EdgeAnalysis(points, integerWeights, scoreModel);
    const full = this.bit.reduce((mask, bit) => mask | bit, this.wide ? 0n : 0);
    this.globalAllowed = this.bit.map(bit => full ^ bit);
    this.degrees = new Uint16Array(this.n).fill(this.n - 1);
    this.requiredDegrees = new Uint8Array(this.n);
    this.zeroEvents = [];
    this.zeroFrames = [];
    this.zeroCounts = { geometry: 0, bound: 0, degree: 0, crossing: 0, subtour: 0 };
    this.globalVersion = this.globalStateCuts = this.globalEdgeCuts = this.edgeBoundChecks = 0;
    this.edgeOneTreeChecks = this.edgeOneTreeCuts = 0;
    this.combinationEnabled = this.chainRankingEnabled = true;
    this.combinationEvaluations = this.combinationChecks = this.combinationCacheHits = 0;
    this.combinationRaised = this.combinationCuts = this.combinationImpossible = this.combinationMs = 0;
    this.residualDegree = new Int8Array(this.n);
    this.fixedNeighbors = this.bit.map(() => this.wide ? 0n : 0);
    this.requiredCount = 0;
    this.vertexQueue = new Set();
    this.requiredQueue = [];
    this.subtourDirty = false;
    this.searchComplete = this.done;
    this.done = false;
    this.phase = 'matrix';
    this.filteredUpper = Infinity;
    this.diversityEnabled = false;
    this.diversityStall = 4096;
    this.diversityInterval = 1024;
    this.diversityStackLimit = 2048;
    this.diversityNext = this.diversityStall;
    this.diversityLastProgress = this.mainSteps;
    this.diversityUpper = this.upper;
    this.diversityBound = this.bound;
    this.prefixVisits = new Float64Array(this.edgeAnalysis.edges.length);
    this.recentPrefixVisits = new Float64Array(this.edgeAnalysis.edges.length);
    this.diversityAttempts = this.diversitySwitches = this.diversityChecks = this.diversityProbes = 0;
    this.diversityMaxVisits = this.diversityMs = 0;
    this.diversitySeed = this.completionSeed ^ 0x6a09e667;
    this.lastPrefix = '';
    this.repairEnabled = true;
    this.repairInterval = 4096;
    this.repairNext = this.repairInterval;
    this.repairSeed = this.completionSeed ^ 0xbb67ae85;
    this.repair = null;
    this.repairAttempts = this.repairChecks = this.repairMoves = this.repairImprovements = this.repairMs = 0;
    this.relaxedEnabled = true;
    this.relaxedAttempts = this.relaxedBuildChecks = this.relaxedOptChecks = this.relaxedMoves = 0;
    this.relaxedCycles = this.relaxedImprovements = this.relaxedFailures = this.relaxedLimited = this.relaxedMs = 0;
    this.relaxedForced = this.relaxedFillChecks = this.relaxedFilledCities = this.relaxedRepairedEdges = 0;
    this.relaxedUncrossChecks = this.relaxedUncrossMoves = this.relaxedUncrossLimited = this.relaxedCrossingsLeft = 0;
    this.relaxedTrace = null;
    this.variantMs = performance.now() - started;
    this.note = 'Готовим матрицу рёбер. Начальный полный маршрут сохранён.';
  }
  get totalMs() { return super.totalMs + (this.variantMs || 0) + (this.repairMs || 0); }
  get upper() { return this.best ? this.best.len[0] + this.best.len[1] : Infinity; }
  get edgeMatrixMs() { return this.edgeAnalysis?.totalMs || 0; }
  get edgePruningMs() { return Math.max(0, (this.variantMs || 0) - this.edgeMatrixMs); }
  edge(a, b) { return this.edgeAnalysis.edges[this.edgeAnalysis.index[a][b]]; }
  edgePenalty(a, b) {
    const edge = this.edge(a, b);
    return edge.logPenalty ??= edge.initialScore > 0 ? -Math.log(edge.initialScore) : Infinity;
  }
  chainPenalties(state) {
    if (!state.chainLogSums) state.chainLogSums = state.paths.map(path =>
      path.slice(1).reduce((sum, city, i) => sum + this.edgePenalty(path[i], city), 0));
    return state.chainLogSums;
  }
  chainSummary(state) {
    if (!this.edgeAnalysis.done || !state) return null;
    const sums = this.chainPenalties(state), counts = state.paths.map(path => path.length - 1);
    const edgeCount = counts[0] + counts[1];
    const bound = edgeCount === this.n ? state.len[0] + state.len[1] : state.combinationBound;
    return { logSums: sums, meanPenalties: sums.map((sum, i) => counts[i] ? sum / counts[i] : 0),
      meanPenalty: edgeCount ? (sums[0] + sums[1]) / edgeCount : 0, edgeCount,
      bound: Number.isFinite(bound) ? bound : null, impossible: bound === Infinity };
  }
  extend(state, side, city) {
    const child = super.extend(state, side, city);
    if (this.edgeAnalysis?.done && this.chainRankingEnabled) {
      child.chainLogSums = this.chainPenalties(state).slice();
      child.chainLogSums[side] += this.edgePenalty(state.paths[side].at(-1), city);
    }
    return child;
  }
  combinationBound(state) {
    const { residualDegree: need, fixedNeighbors: fixed } = this;
    need.fill(2); fixed.fill(this.wide ? 0n : 0);
    // Учитываем обе ветви: у занятого внутреннего города больше нет свободных связей.
    for (const path of state.paths) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ((fixed[a] & this.bit[b]) || --need[a] < 0 || --need[b] < 0) return Infinity;
      fixed[a] |= this.bit[b]; fixed[b] |= this.bit[a];
    }
    let active = this.wide ? 0n : 0;
    for (let i = 0; i < this.n; i++) if (need[i]) active |= this.bit[i];
    let extra = 0;
    for (let i = 0; i < this.n; i++) if (need[i]) {
      let remaining = need[i];
      // Уже выбранное ребро нельзя добрать второй раз, даже если оба его конца ещё открыты.
      const allowed = state.allowed[i] & this.globalAllowed[i] & active & ~fixed[i] & ~this.bit[i];
      for (const other of this.near[i]) {
        this.combinationChecks++;
        if (!(allowed & this.bit[other])) continue;
        extra += this.dist[i][other];
        if (!--remaining) break;
      }
      if (remaining) return Infinity;
    }
    const g = state.len[0] + state.len[1], bound = g + extra / 2;
    // Каждое добавляемое ребро учтено с двух концов. Округление оставляем в пользу продолжения.
    return Math.max(g, bound - 64 * this.n * Number.EPSILON * Math.max(1, Math.abs(bound)));
  }
  candidateBound(state) {
    if (this.edgeAnalysis?.done && !this.syncState(state)) return Infinity;
    const base = super.candidateBound(state);
    if (!this.combinationEnabled || !this.edgeAnalysis?.done || base >= this.upper) return base;
    if (state.combinationVersion !== this.globalVersion) {
      const started = performance.now();
      state.combinationBound = this.combinationBound(state);
      state.combinationVersion = this.globalVersion;
      this.combinationMs += performance.now() - started;
      this.combinationEvaluations++;
      if (state.combinationBound > base) this.combinationRaised++;
      if (state.combinationBound === Infinity) this.combinationImpossible++;
    } else this.combinationCacheHits++;
    if (state.combinationBound >= this.upper && !state.combinationCutCounted) {
      state.combinationCutCounted = true;
      this.combinationCuts++;
    }
    // Запрет относится ко всей комбинации. Ни одно её ребро здесь не обнуляется глобально.
    return Math.max(base, state.combinationBound);
  }
  banEdge(e, kind, reason, cause = null) {
    if (!(this.globalAllowed[e.a] & this.bit[e.b])) return;
    if (e.required) throw new Error('Противоречие доказательств: обязательное ребро запрещено.');
    this.globalAllowed[e.a] &= ~this.bit[e.b];
    this.globalAllowed[e.b] &= ~this.bit[e.a];
    this.degrees[e.a]--; this.degrees[e.b]--;
    this.vertexQueue.add(e.a); this.vertexQueue.add(e.b);
    e.excluded = true; e.score = 0; e.reason = reason;
    this.globalVersion++;
    this.zeroCounts[kind]++;
    const event = { index: this.zeroEvents.length, edge: e.id, a: e.a, b: e.b,
      step: this.mainSteps, totalStep: this.steps, matrixStep: this.edgeAnalysis.processed,
      phase: this.phase, kind, reason, bound: Number.isFinite(e.bound) ? e.bound : null,
      upper: Number.isFinite(this.upper) ? this.upper : null, cause };
    this.zeroEvents.push(event);
    let frame = this.zeroFrames.at(-1);
    if (!frame || frame.step !== event.step) {
      frame = { step: event.step, start: event.index, end: event.index, upper: event.upper };
      this.zeroFrames.push(frame);
    }
    frame.end = event.index;
  }
  requireEdge(e) {
    if (e.required) return;
    e.required = true;
    this.requiredCount++;
    this.requiredDegrees[e.a]++; this.requiredDegrees[e.b]++;
    this.vertexQueue.add(e.a); this.vertexQueue.add(e.b);
    this.requiredQueue.push(e.id);
    this.subtourDirty = true;
  }
  checkEdgeBound(e) {
    if (!(this.globalAllowed[e.a] & this.bit[e.b])) return;
    this.edgeBoundChecks++;
    if (this.oneTree && e.oneTreeBound === undefined) {
      // Поправки 1-дерева постоянны: оценку с обязательным ребром считаем один раз.
      // Она относится ко всем турам с ребром, независимо от текущих ветвей и маски.
      e.geometricBound = e.bound;
      e.oneTreeBound = this.oneTree.bound([[e.a, e.b]]);
      e.bound = Math.max(e.bound, e.oneTreeBound);
      this.edgeOneTreeChecks++;
    }
    // Строгое неравенство сохраняет все равные оптимумы. Ошибка суммирования округляется в пользу ребра.
    const tolerance = 64 * this.n * Number.EPSILON * Math.max(1, Math.abs(e.bound), this.upper);
    if (Number.isFinite(this.upper) && e.bound > this.upper + tolerance) {
      const strengthened = e.oneTreeBound > this.upper + tolerance && e.geometricBound <= this.upper + tolerance;
      if (strengthened) this.edgeOneTreeCuts++;
      this.banEdge(e, 'bound', strengthened ? 'Оценка через 1-дерево с обязательным ребром строго выше длины найденного цикла.' :
        'Нижняя оценка с этим ребром строго выше длины найденного цикла.');
    }
  }
  beginFiltering() {
    this.phase = 'filter';
    this.filterIndex = 0;
    this.filterUpper = this.upper;
  }
  propagateVertex(city) {
    if (this.degrees[city] < 2 || this.requiredDegrees[city] > 2) {
      throw new Error('Противоречие доказательств степени города ' + (city + 1));
    }
    for (let bits = this.globalAllowed[city]; bits; bits &= bits - this.one) {
      const other = this.firstCity(bits), e = this.edge(city, other);
      if (this.degrees[city] === 2) this.requireEdge(e);
      else if (this.requiredDegrees[city] === 2 && !e.required) {
        this.banEdge(e, 'degree', 'У города уже две обязательные связи.', { city });
      }
    }
  }
  propagateSubtours() {
    const parent = Array.from({ length: this.n }, (_, i) => i), size = Array(this.n).fill(1);
    const root = i => { while (parent[i] !== i) i = parent[i]; return i; };
    for (const e of this.edgeAnalysis.edges) if (e.required) {
      const a = root(e.a), b = root(e.b);
      if (a !== b) { parent[b] = a; size[a] += size[b]; }
    }
    for (const e of this.edgeAnalysis.edges) {
      const a = root(e.a), b = root(e.b);
      if (!e.required && a === b && size[a] < this.n) {
        this.banEdge(e, 'subtour', 'Ребро замкнуло бы обязательный путь в цикл раньше посещения всех городов.');
      }
    }
  }
  filterStep() {
    this.note = 'Обновляем общую маску рёбер: ' + Math.min(this.filterIndex, this.edgeAnalysis.edges.length) +
      ' / ' + this.edgeAnalysis.edges.length + '. Глобальных нулей: ' + this.zeroEvents.length + '.';
    if (this.filterIndex < this.edgeAnalysis.edges.length) {
      this.checkEdgeBound(this.edgeAnalysis.edges[this.filterIndex++]);
    } else if (this.vertexQueue.size) {
      const city = this.vertexQueue.values().next().value;
      this.vertexQueue.delete(city);
      this.propagateVertex(city);
    } else if (this.requiredQueue.length) {
      const id = this.requiredQueue.pop();
      for (const other of this.edgeAnalysis.conflictIds(id)) {
        this.banEdge(this.edgeAnalysis.edges[other], 'crossing', 'Конфликт с обязательным ребром: распутывание строго улучшает цикл.', { edge: id });
      }
    } else if (this.subtourDirty) {
      this.subtourDirty = false;
      this.propagateSubtours();
    } else {
      this.filteredUpper = this.filterUpper;
      this.phase = 'search';
      this.done = this.searchComplete;
      this.note = this.done ? 'Минимум доказан. История глобальных нулей сохранена.' : 'Матрица обновлена. Продолжаем поиск двумя ветвями.';
    }
  }
  recordProgress() {
    super.recordProgress();
    if (!this.edgeAnalysis) return;
    if (this.upper < this.diversityUpper || this.bound > this.diversityBound) {
      this.diversityLastProgress = this.mainSteps;
      this.diversityNext = this.mainSteps + this.diversityStall;
      this.recentPrefixVisits.fill(0);
      this.diversityUpper = this.upper;
      this.diversityBound = this.bound;
      this.repairNext = this.mainSteps + this.repairInterval;
    }
    if (this.done) this.searchComplete = true;
    if (this.upper < this.filteredUpper) { this.done = false; this.beginFiltering(); }
  }
  syncState(s) {
    if (s.globalVersion === this.globalVersion) return true;
    for (const path of s.paths) {
      for (let i = 1; i < path.length; i++) {
        if (!(this.globalAllowed[path[i - 1]] & this.bit[path[i]])) return false;
      }
      // Родительский close добавляет последние связи без выбора: проверяем их заранее.
      const end = path.at(-1);
      if (!s.free && end !== this.b && !(this.globalAllowed[end] & this.bit[this.b])) return false;
    }
    s.allowed = s.allowed.map((mask, i) => mask & this.globalAllowed[i]);
    s.globalVersion = this.globalVersion;
    return true;
  }
  checkedExtension(s, side, city) {
    if (!this.edgeAnalysis) return super.checkedExtension(s, side, city);
    if (!this.syncState(s) || !(this.globalAllowed[s.paths[side].at(-1)] & this.bit[city])) {
      this.globalEdgeCuts++; return null;
    }
    const child = super.checkedExtension(s, side, city);
    if (child && !this.syncState(child)) { this.globalEdgeCuts++; return null; }
    return child;
  }
  extensionFrame(s) {
    const frame = super.extensionFrame(s);
    if (!this.edgeAnalysis) return frame;
    frame.cities.sort((a, b) => this.edge(frame.end, b).score - this.edge(frame.end, a).score || this.dist[frame.end][a] - this.dist[frame.end][b]);
    return frame;
  }
  searchPrefix(s) {
    if (!s.searchPrefix) {
      const edges = [];
      for (const path of s.paths) for (let i = 1; i < Math.min(path.length, 4); i++) {
        edges.push({ id: this.edgeAnalysis.index[path[i - 1]][path[i]], weight: 1 / i });
      }
      s.searchPrefix = { edges, key: edges.map(e => e.id).sort((a, b) => a - b).join(',') };
    }
    return s.searchPrefix;
  }
  visitPrefix(s) {
    if (!this.diversityEnabled) return;
    const prefix = this.searchPrefix(s);
    this.lastPrefix = prefix.key;
    for (const { id } of prefix.edges) {
      this.diversityMaxVisits = Math.max(this.diversityMaxVisits, ++this.prefixVisits[id]);
      if (!this.edgeAnalysis.edges[id].required) this.recentPrefixVisits[id]++;
    }
  }
  diversityPriority(s) {
    let penalty = 0, weight = 0;
    for (const edge of this.searchPrefix(s).edges) {
      if (this.edgeAnalysis.edges[edge.id].required) continue;
      penalty += edge.weight * Math.log1p(this.recentPrefixVisits[edge.id] / this.diversityInterval);
      weight += edge.weight;
    }
    // Это только цена выбора из очереди. Сохранённые cost, bound, длины и коэффициенты рёбер не меняются.
    return s.cost + 2 * this.edgeAnalysis.scale * (weight ? penalty / weight : 0);
  }
  diversify() {
    if (!this.diversityEnabled || this.mainSteps < this.diversityNext ||
        this.mainSteps - this.diversityLastProgress < this.diversityStall ||
        this.stack.length >= this.diversityStackLimit ||
        this.pending + this.stack.length + Number(Boolean(this.next)) < 2) return null;
    const started = performance.now();
    this.diversityNext = this.mainSteps + this.diversityInterval;
    this.diversityAttempts++;
    // Сохраняем next до перехода в другое поддерево: последующее ветвление может записать новый next.
    if (this.next) { this.queueFor(this.next).add(this.next); this.next = null; }
    const candidates = new Map();
    for (const source of [...this.queues, this.stack]) {
      const items = source === this.stack ? source : source.items;
      if (!items.length) continue;
      candidates.set(items[0], source);
      candidates.set(items.at(-1), source);
      for (let i = 0; i < Math.min(32, items.length); i++) {
        this.diversitySeed = (Math.imul(1664525, this.diversitySeed) + 1013904223) >>> 0;
        candidates.set(items[Math.floor(this.diversitySeed / 4294967296 * items.length)], source);
      }
    }
    let selected = null, least = Infinity, changed = false;
    for (const state of candidates.keys()) {
      this.diversityChecks++;
      const otherPrefix = this.searchPrefix(state).key !== this.lastPrefix;
      const priority = this.diversityPriority(state);
      if (!selected || (otherPrefix && !changed) || (otherPrefix === changed && priority < least)) {
        selected = state; least = priority; changed = otherPrefix;
      }
    }
    if (selected) {
      const source = candidates.get(selected);
      if (source === this.stack) source.splice(source.indexOf(selected), 1);
      else source.take(selected);
      if (changed) this.diversitySwitches++;
      selected.diversityProbe = true;
    }
    this.diversityMs += performance.now() - started;
    return selected;
  }
  repairDue() {
    return this.repairEnabled && this.best && this.n >= 8 && !this.completion && this.mainSteps >= this.repairNext;
  }
  startRepair() {
    if (!this.repairDue()) return false;
    this.repairNext = this.mainSteps + this.repairInterval;
    this.repairAttempts++;
    const tour = tourFromBest(this), cuts = Array.from({ length: this.n - 1 }, (_, i) => i + 1);
    // Четыре разных разреза меняют порядок участков; каждый город остаётся в полном цикле ровно один раз.
    for (let i = 0; i < 4; i++) {
      this.repairSeed = (Math.imul(1664525, this.repairSeed) + 1013904223) >>> 0;
      const j = i + Math.floor(this.repairSeed / 4294967296 * (cuts.length - i));
      [cuts[i], cuts[j]] = [cuts[j], cuts[i]];
    }
    const [a, b, c, d] = cuts.slice(0, 4).sort((x, y) => x - y);
    this.repair = { tour: tour.slice(0, a).concat(tour.slice(c, d), tour.slice(b, c), tour.slice(a, b), tour.slice(d)),
      i: 0, j: 2, change: 0, move: null, checks: 0, budget: 8 * this.n * this.n };
    return true;
  }
  stepTwoOpt(job, allowed, repairInvalid = false) {
    const { tour, i, j } = job;
    if (!(i === 0 && j === this.n - 1)) {
      job.checks++;
      const a = tour[i], b = tour[i + 1], c = tour[j], d = tour[(j + 1) % this.n];
      const change = this.dist[a][c] + this.dist[b][d] - this.dist[a][b] - this.dist[c][d];
      // Небольшие округления не должны запускать бесконечное переставление равных участков.
      const tolerance = 32 * Number.EPSILON * Math.max(1, this.dist[a][b] + this.dist[c][d]);
      const gain = repairInvalid ? Number(!allowed(a, b)) + Number(!allowed(c, d)) : 0;
      if ((gain > (job.invalidGain || 0) || (gain === (job.invalidGain || 0) && change < job.change - tolerance)) &&
          (!allowed || (allowed(a, c) && allowed(b, d)))) {
        job.change = change; job.move = [i, j]; job.invalidGain = gain;
      }
    }
    if (++job.j === this.n) { job.i++; job.j = job.i + 2; }
    const complete = job.i >= this.n - 2, exhausted = job.checks >= job.budget;
    if (complete || exhausted || (repairInvalid && job.invalidGain > 0)) {
      if (job.move) {
        const [from, to] = job.move;
        job.tour = tour.slice(0, from + 1).concat(tour.slice(from + 1, to + 1).reverse(), tour.slice(to + 1));
        job.moves = (job.moves || 0) + 1;
        job.repaired = (job.repaired || 0) + (job.invalidGain || 0);
      }
      if (!job.move || exhausted) return true;
      job.i = 0; job.j = 2; job.move = null; job.change = 0; job.invalidGain = 0;
    }
    return false;
  }
  stepRepair() {
    const job = this.repair, checks = job.checks, moves = job.moves || 0;
    const done = this.stepTwoOpt(job);
    this.repairChecks += job.checks - checks;
    this.repairMoves += (job.moves || 0) - moves;
    if (done) { this.acceptRepair(job.tour); this.repair = null; }
    if (this.repair) this.note = 'Перестройка полного цикла · проверено пар рёбер ' + job.checks + ' / ' + job.budget + '.';
  }
  acceptRepair(tour) {
    const split = tour.indexOf(this.b), paths = [tour.slice(0, split + 1), [this.a].concat(tour.slice(split).reverse())];
    const len = paths.map(path => path.slice(1).reduce((sum, city, i) => sum + this.dist[path[i]][city], 0));
    // Любой полный цикл даёт верхнюю границу. Неудачная перестройка ничего не говорит о допустимости рёбер.
    if (len[0] + len[1] < this.upper) {
      this.best = { paths, len };
      this.bestStep = this.steps;
      this.repairImprovements++;
      this.recordProgress();
      this.note = 'Перестройка полного цикла улучшила L. Обновляем доказанные запреты.';
    } else this.note = 'Перестройка не улучшила рекорд. Продолжаем основной поиск.';
  }
  startCompletion(s) {
    if (s.diversityProbe && this.completionInterval) {
      this.nextCompletion = this.mainSteps;
      this.diversityProbes++;
    }
    if (!super.startCompletion(s)) return false;
    if (this.relaxedEnabled) {
      const started = performance.now();
      const copy = { paths: s.paths.map(path => path.slice()), len: s.len.slice(), free: s.free };
      this.completion.relaxed = { phase: 'build', stack: [this.randomCompletionFrame(copy)], checks: 0,
        budget: Math.max(64, 6 * this.n), deepest: copy };
      this.relaxedAttempts++;
      this.relaxedTrace = { id: this.relaxedAttempts, step: this.mainSteps, status: 'running', threshold: this.stageThreshold || 0,
        frames: [], dropped: 0, improvements: 0, forced: false };
      this.recordRelaxedFrame(copy, 'source', 'Исходные ветви');
      const elapsed = performance.now() - started;
      this.relaxedMs += elapsed; this.completionMs += elapsed;
    }
    return true;
  }
  relaxedEdgeAllowed(a, b) {
    return Boolean(this.globalAllowed[a] & this.bit[b]) && this.edge(a, b).initialScore >= (this.stageThreshold || 0);
  }
  relaxedExtend(state, side, city) {
    const paths = state.paths.slice(), len = state.len.slice();
    len[side] += this.dist[paths[side].at(-1)][city];
    paths[side] = [...paths[side], city];
    // У пробной копии нет локальных масок, нижних оценок и записи в кеше точного поиска.
    return { paths, len, free: state.free & ~this.bit[city] };
  }
  recordRelaxedFrame(state, phase, label, crossings) {
    if (!this.relaxedTrace) return;
    const blocked = [], below = [];
    for (const path of state.paths) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (!(this.globalAllowed[a] & this.bit[b])) blocked.push([a, b]);
      else if (this.edge(a, b).initialScore < (this.stageThreshold || 0)) below.push([a, b]);
    }
    const frames = this.relaxedTrace.frames;
    // Храним только последнюю пробу с ограниченным числом кадров; начальные ветви сохраняем всегда.
    if (frames.length >= 128) { frames.splice(1, 1); this.relaxedTrace.dropped++; }
    frames.push({ paths: state.paths.map(path => path.slice()), len: state.len.slice(), phase, label, blocked, below,
      upper: Number.isFinite(this.upper) ? this.upper : null, ...(crossings === undefined ? {} : { crossings }) });
  }
  relaxedFallback(reason = 'Исчерпаны варианты или бюджет сборки') {
    const job = this.completion.relaxed;
    if (job.phase === 'build') {
      job.phase = 'fill'; job.fill = job.deepest; job.fillSide = this.shorter(job.fill);
      job.stack.length = 0;
      this.relaxedForced++; this.relaxedTrace.forced = true;
      this.current = job.fill;
      this.recordRelaxedFrame(job.fill, 'fill', 'Принудительно добавляем оставшиеся города');
      this.note = reason + '. Вставляем все оставшиеся города перед B в пробной копии.';
      return;
    }
    this.relaxedFailures++;
    this.relaxedTrace.status = 'failed'; this.relaxedTrace.reason = reason;
    this.recordRelaxedFrame(this.current, 'failed', reason);
    this.completion.relaxed = null;
    this.current = this.completion.root;
    this.note = 'Проба с пересечениями не собралась. Продолжаем обычную ограниченную достройку.';
  }
  stepRelaxedBuild(job) {
    if (job.checks >= job.budget) { this.relaxedFallback(); return; }
    while (job.stack.length && job.stack.at(-1).index === job.stack.at(-1).cities.length) job.stack.pop();
    if (!job.stack.length) { this.relaxedFallback(); return; }
    const frame = job.stack.at(-1), city = frame.cities[frame.index++];
    job.checks++; this.relaxedBuildChecks++;
    if (!this.relaxedEdgeAllowed(frame.end, city)) return;
    let child = this.relaxedExtend(frame.state, frame.side, city);
    if (child.paths[0].length + child.paths[1].length > job.deepest.paths[0].length + job.deepest.paths[1].length) job.deepest = child;
    this.current = child;
    this.recordRelaxedFrame(child, 'build', 'Достройка с пересечениями');
    if (child.free) job.stack.push(this.randomCompletionFrame(child));
    else {
      for (let side = 0; side < 2; side++) if (child.paths[side].at(-1) !== this.b) {
        if (job.checks >= job.budget) { this.relaxedFallback(); return; }
        job.checks++; this.relaxedBuildChecks++;
        if (!this.relaxedEdgeAllowed(child.paths[side].at(-1), this.b)) return;
        child = this.relaxedExtend(child, side, this.b);
      }
      this.beginRelaxedOpt(job, child);
    }
    this.note = job.phase === 'build' ? 'Достраиваем копию ветвей с разрешёнными пересечениями.' : 'Пробный полный цикл собран. Распутываем его через 2-opt.';
  }
  stepRelaxedFill(job) {
    const state = job.fill;
    if (state.free) {
      const end = state.paths[job.fillSide].at(-1), candidates = [];
      for (const city of this.near[end]) {
        this.relaxedFillChecks++;
        if (state.free & this.bit[city]) candidates.push(city);
        if (candidates.length === 3) break;
      }
      this.completionSeed = (Math.imul(1664525, this.completionSeed) + 1013904223) >>> 0;
      const city = candidates[Math.floor(this.completionSeed / 4294967296 * candidates.length)];
      job.fill = this.relaxedExtend(state, job.fillSide, city);
      this.relaxedFilledCities++;
      this.current = job.fill;
      this.recordRelaxedFrame(job.fill, 'fill', 'Добавляем все оставшиеся города · временные нули разрешены');
    } else {
      let cycle = state;
      for (let side = 0; side < 2; side++) if (cycle.paths[side].at(-1) !== this.b) cycle = this.relaxedExtend(cycle, side, this.b);
      this.beginRelaxedOpt(job, cycle);
    }
  }
  beginRelaxedOpt(job, cycle) {
    const [out, back] = cycle.paths;
    job.phase = 'opt'; job.tour = out.concat(back.slice(1, -1).reverse());
    job.stack.length = 0; job.checks = 0; job.budget = 8 * this.n * this.n;
    job.i = 0; job.j = 2; job.change = 0; job.move = null; job.moves = job.repaired = job.invalidGain = 0;
    this.current = cycle; this.relaxedCycles++; this.completionSolutions++;
    this.recordRelaxedFrame(cycle, 'seed', 'Полный пробный цикл до распутывания');
    this.considerRelaxedTour(job);
  }
  considerRelaxedTour(job) {
    if (job.tour.length !== this.n || new Set(job.tour).size !== this.n ||
        job.tour.some(city => !Number.isInteger(city) || city < 0 || city >= this.n)) return false;
    const cycle = this.relaxedTourState(job.tour);
    this.seekingFirstCycle = false;
    if (cycle.len[0] + cycle.len[1] >= this.upper) return true;
    // Любой полный цикл даёт верхнюю границу, даже если он содержит нули матрицы оптимальных туров.
    this.best = cycle; this.bestStep = this.steps; job.improved = true;
    this.relaxedImprovements++; this.completionImprovements++; this.relaxedTrace.improvements++;
    this.recordProgress();
    if (this.searchComplete) {
      this.relaxedTrace.status = 'proved';
      this.recordRelaxedResult(job, 'Достигнута общая нижняя граница');
    }
    return true;
  }
  relaxedTourState(tour) {
    const split = tour.indexOf(this.b), paths = [tour.slice(0, split + 1), [this.a].concat(tour.slice(split).reverse())];
    const len = paths.map(path => path.slice(1).reduce((sum, city, i) => sum + this.dist[path[i]][city], 0));
    return { paths, len };
  }
  stepRelaxedOpt(job) {
    const checks = job.checks, moves = job.moves, repaired = job.repaired;
    const done = this.stepTwoOpt(job, (a, b) => this.relaxedEdgeAllowed(a, b), true);
    this.relaxedOptChecks += job.checks - checks;
    this.relaxedMoves += job.moves - moves;
    this.relaxedRepairedEdges += job.repaired - repaired;
    if (job.moves !== moves) {
      this.current = this.relaxedTourState(job.tour);
      this.recordRelaxedFrame(this.current, 'opt', '2-opt · перестройка ' + job.moves);
      this.considerRelaxedTour(job);
      if (!this.completion) return;
    }
    if (!done) {
      this.note = 'Перестраиваем пробный цикл через 2-opt · пар рёбер ' + job.checks + ' / ' + job.budget + '.';
      return;
    }
    job.optLimited = job.checks >= job.budget;
    if (job.optLimited) this.relaxedLimited++;
    if (!this.considerRelaxedTour(job)) { this.relaxedFallback('Некорректный полный цикл'); return; }
    if (!this.completion) return;
    job.phase = 'uncross'; job.i = 0; job.j = 2; job.checks = 0; job.budget = this.n ** 3; job.uncrossMoves = 0;
    const crossings = this.countProbeCrossings(job.tour);
    this.relaxedTrace.uncross = { initialCrossings: crossings, budget: job.budget };
    this.current = this.relaxedTourState(job.tour);
    this.recordRelaxedFrame(this.current, 'uncross', 'Убираем оставшиеся пересечения', crossings);
    this.note = 'Локальная перестройка закончена. Отдельно распутываем оставшиеся пересечения.';
  }
  probeEdgesCross(a, b, c, d) {
    return this.turn[a][b][c] * this.turn[a][b][d] < 0 && this.turn[c][d][a] * this.turn[c][d][b] < 0;
  }
  countProbeCrossings(tour) {
    let count = 0;
    for (let i = 0; i < this.n - 2; i++) for (let j = i + 2; j < this.n; j++) {
      if (i === 0 && j === this.n - 1) continue;
      this.relaxedUncrossChecks++;
      if (this.probeEdgesCross(tour[i], tour[i + 1], tour[j], tour[(j + 1) % this.n])) count++;
    }
    return count;
  }
  recordRelaxedResult(job, label) {
    const crossings = this.countProbeCrossings(job.tour);
    this.relaxedTrace.remainingCrossings = crossings;
    this.relaxedCrossingsLeft += crossings;
    this.current = this.relaxedTourState(job.tour);
    this.recordRelaxedFrame(this.current, 'result', label, crossings);
  }
  stepRelaxedUncross(job) {
    const { tour, i, j } = job;
    let move = false;
    if (!(i === 0 && j === this.n - 1)) {
      job.checks++; this.relaxedUncrossChecks++;
      const a = tour[i], b = tour[i + 1], c = tour[j], d = tour[(j + 1) % this.n];
      const touches = (this.turn[a][b][c] === 0 && this.edgeAnalysis.inside(a, b, c)) ||
        (this.turn[a][b][d] === 0 && this.edgeAnalysis.inside(a, b, d)) ||
        (this.turn[c][d][a] === 0 && this.edgeAnalysis.inside(c, d, a)) ||
        (this.turn[c][d][b] === 0 && this.edgeAnalysis.inside(c, d, b));
      if (this.probeEdgesCross(a, b, c, d) || touches) {
        const length = this.integerWeights ? (u, v) => routeDistance(this.points[u], this.points[v]) : (u, v) => this.dist[u][v];
        const before = length(a, b) + length(c, d), after = length(a, c) + length(b, d);
        // Геометрическая длина строго убывает: равные коллинеарные замены не могут зациклить пробу.
        if (after < before - 32 * Number.EPSILON * Math.max(1, before)) {
          // Маска и порог относятся к точному перебору. В полной пробной копии временные нули допустимы.
          job.tour = tour.slice(0, i + 1).concat(tour.slice(i + 1, j + 1).reverse(), tour.slice(j + 1));
          move = true; job.uncrossMoves++; this.relaxedUncrossMoves++;
          this.current = this.relaxedTourState(job.tour);
          this.recordRelaxedFrame(this.current, 'uncross', 'Распутывание · замена ' + job.uncrossMoves);
          this.considerRelaxedTour(job);
          if (!this.completion) return;
        }
      }
    }
    if (++job.j === this.n) { job.i++; job.j = job.i + 2; }
    const complete = !move && job.i >= this.n - 2;
    if (move) { job.i = 0; job.j = 2; }
    if (!complete && job.checks < job.budget) {
      this.note = 'Убираем пересечения пробного цикла · замен ' + job.uncrossMoves + ' · проверок ' + job.checks + ' / ' + job.budget + '.';
      return;
    }
    const limited = !complete && job.checks >= job.budget;
    if (limited) this.relaxedUncrossLimited++;
    Object.assign(this.relaxedTrace.uncross, { checks: job.checks, moves: job.uncrossMoves, limited, optLimited: job.optLimited });
    this.relaxedTrace.status = job.improved ? 'improved' : 'unchanged';
    this.recordRelaxedResult(job, limited ? 'Лимит распутывания достигнут' : 'Проход распутывания завершён');
    // Исходное состояние по-прежнему покрывает своё поддерево. Неудача эвристики не доказывает тупик.
    return job.improved ? 'improved' : 'cycle';
  }
  stepCompletion() {
    const job = this.completion.relaxed;
    if (!job) { super.stepCompletion(); return; }
    const started = performance.now();
    const outcome = job.phase === 'build' ? this.stepRelaxedBuild(job) : job.phase === 'fill' ? this.stepRelaxedFill(job) :
      job.phase === 'uncross' ? this.stepRelaxedUncross(job) : this.stepRelaxedOpt(job);
    const elapsed = performance.now() - started;
    this.relaxedMs += elapsed; this.completionMs += elapsed;
    if (outcome) {
      const resumed = performance.now();
      this.finishCompletion(outcome);
      this.searchMs += performance.now() - resumed;
    }
  }
  choose() {
    if (this.selectedState) { const s = this.selectedState; this.selectedState = null; return s; }
    this.refillQueues();
    const alternative = this.diversify();
    if (alternative) return alternative;
    if (this.stack.length) return this.stack.pop();
    if (this.next) { this.queueFor(this.next).add(this.next); this.next = null; }
    const [a, b] = this.queues;
    return (!b.first || (a.first && a.first.cost <= b.first.cost) ? a : b).take();
  }
  retryLongerBranch() {}
  deferChild() { return false; }
  processState() {
    const state = this.choose();
    if (!this.syncState(state)) {
      this.steps++; this.globalStateCuts++;
      this.current = state;
      this.note = 'Отложенное состояние содержит глобально запрещённое ребро.';
      this.recordProgress();
      return;
    }
    this.visitPrefix(state);
    this.selectedState = state;
    super.processState();
  }
  branch(s, record) {
    const { side, end, cities } = this.extensionFrame(s), children = [];
    for (const city of cities) {
      const child = this.checkedExtension(s, side, city);
      if (!child) { this.crossingCuts++; continue; }
      const bound = this.candidateBound(child);
      if (bound >= record) { this.boundCuts++; continue; }
      // Средний логарифмический штраф сравнивает цепочки разной длины; это не вероятность и не нижняя граница.
      const sums = this.chainRankingEnabled ? this.chainPenalties(child) : null;
      const penalty = sums ? (sums[0] + sums[1]) / (child.paths[0].length + child.paths[1].length - 2) : 1 - this.edge(end, city).score;
      child.cost = bound + this.edgeAnalysis.scale * penalty;
      if (this.deferChild(child)) continue;
      children.push(child);
    }
    if (this.pending >= this.queueLimit || this.stack.length) {
      for (let i = children.length - 1; i >= 0; i--) this.stack.push(children[i]);
    } else {
      this.next = children[0];
      for (const child of children.slice(1)) this.queueFor(child).add(child);
    }
    this.note = 'Продолжения упорядочены по нижней оценке и перспективности цепочек.';
  }
  advancePreparation(sliceMs = Infinity) { return this.advance(Infinity, sliceMs, true); }
  get hasBackgroundWork() { return this.phase !== 'search' || Boolean(this.completion?.relaxed || this.repair || this.repairDue()); }
  advance(limit = Infinity, sliceMs = Infinity, preparationOnly = false) {
    if (this.done || limit < 1 || (preparationOnly && !this.hasBackgroundWork)) return 0;
    const started = performance.now(), previous = this.searchMs + this.completionMs + this.repairMs;
    let work = 0;
    do {
      if (this.phase === 'matrix') {
        const e = this.edgeAnalysis.edges[this.edgeAnalysis.processed];
        this.edgeAnalysis.advance(1);
        if (e.excluded) this.banEdge(e, 'geometry', e.reason);
        else this.checkEdgeBound(e);
        if (this.edgeAnalysis.done) this.beginFiltering();
        this.note = 'Матрица рёбер: ' + this.edgeAnalysis.processed + ' / ' + this.edgeAnalysis.edges.length + '. Глобальных нулей: ' + this.zeroEvents.length + '.';
      } else if (this.phase === 'filter') {
        this.filterStep();
      } else if (this.completion?.relaxed) {
        // Счётчики этой пробы отдельные: одна порция не должна ждать шага основного перебора.
        this.stepCompletion();
      } else if (this.repair || this.repairDue()) {
        const repairStarted = performance.now();
        if (!this.repair) this.startRepair();
        this.stepRepair();
        this.repairMs += performance.now() - repairStarted;
      } else super.advance(1);
      work++;
    } while (!this.done && work < limit && (!preparationOnly || this.hasBackgroundWork) && performance.now() - started < sliceMs);
    this.variantMs += Math.max(0, performance.now() - started - (this.searchMs + this.completionMs + this.repairMs - previous));
    return work;
  }
  reportZeros() {
    return { ...this.edgeAnalysis.report(), algorithm: this.algorithm, done: this.done, phase: this.phase,
      edgeBounds: 'bound = max(geometricBound, oneTreeBound), если доступно 1-дерево. Строгие границы независимы от формулы эвристического балла, указанной в scoreModel.',
      upper: Number.isFinite(this.upper) ? this.upper : null, mainSteps: this.mainSteps,
      best: this.best ? { paths: this.best.paths, len: this.best.len } : null,
      scoreQuality: routeScoreQuality(this.edgeAnalysis, this.best?.paths),
      chain: { rankingEnabled: this.chainRankingEnabled, boundEnabled: this.combinationEnabled,
        source: 'initialScore', current: this.chainSummary(this.current), best: this.chainSummary(this.best) },
      lastProbe: this.relaxedTrace,
      zeroCounts: this.zeroCounts, zeroEvents: this.zeroEvents, zeroFrames: this.zeroFrames,
      work: { matrixMs: this.edgeMatrixMs, pruningMs: this.edgePruningMs, totalMs: this.totalMs,
        edgeBoundChecks: this.edgeBoundChecks, globalStateCuts: this.globalStateCuts, globalEdgeCuts: this.globalEdgeCuts,
        edgeOneTreeChecks: this.edgeOneTreeChecks, edgeOneTreeCuts: this.edgeOneTreeCuts,
        combinationEvaluations: this.combinationEvaluations, combinationChecks: this.combinationChecks,
        combinationCacheHits: this.combinationCacheHits, combinationRaised: this.combinationRaised,
        combinationCuts: this.combinationCuts, combinationImpossible: this.combinationImpossible, combinationMs: this.combinationMs,
        diversityAttempts: this.diversityAttempts, diversitySwitches: this.diversitySwitches, diversityChecks: this.diversityChecks,
        diversityProbes: this.diversityProbes, diversityMaxVisits: this.diversityMaxVisits, diversityMs: this.diversityMs,
        repairAttempts: this.repairAttempts, repairChecks: this.repairChecks, repairMoves: this.repairMoves,
        repairImprovements: this.repairImprovements, repairMs: this.repairMs,
        relaxedAttempts: this.relaxedAttempts, relaxedBuildChecks: this.relaxedBuildChecks, relaxedOptChecks: this.relaxedOptChecks,
        relaxedMoves: this.relaxedMoves, relaxedCycles: this.relaxedCycles, relaxedImprovements: this.relaxedImprovements,
        relaxedFailures: this.relaxedFailures, relaxedLimited: this.relaxedLimited, relaxedMs: this.relaxedMs,
        relaxedForced: this.relaxedForced, relaxedFillChecks: this.relaxedFillChecks,
        relaxedFilledCities: this.relaxedFilledCities, relaxedRepairedEdges: this.relaxedRepairedEdges,
        relaxedUncrossChecks: this.relaxedUncrossChecks, relaxedUncrossMoves: this.relaxedUncrossMoves,
        relaxedUncrossLimited: this.relaxedUncrossLimited, relaxedCrossingsLeft: this.relaxedCrossingsLeft },
      diversity: { enabled: this.diversityEnabled, stall: this.diversityStall, interval: this.diversityInterval,
        stackLimit: this.diversityStackLimit, edgeVisits: Array.from(this.prefixVisits) },
      repair: { enabled: this.repairEnabled, interval: this.repairInterval, budget: 8 * this.n * this.n },
      relaxed: { enabled: this.relaxedEnabled, buildBudget: Math.max(64, 6 * this.n), optBudget: 8 * this.n * this.n,
        uncrossBudget: this.n ** 3 } };
  }
}
