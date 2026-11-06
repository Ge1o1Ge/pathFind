'use strict';

const MAX_SEEN_STATES = 1_000_000;
const MAX_TREE_STATES = 16_000;
const INITIAL_QUEUE_LIMIT = 4_000;
const MAX_QUEUE_LIMIT = 32_000;
const QUEUE_STALL_STEPS = 25_000;
const COMPLETION_INTERVAL = 512;

function balanceRatio([l1, l2]) {
  const half = (l1 + l2) / 2;
  return ((half / l1) ** 3 + (half / l2) ** 3) / 2;
}

function routeDistance(p, q, integerWeights = false) {
  const dx = p.x - q.x, dy = p.y - q.y;
  return integerWeights ? Math.ceil(Math.sqrt((dx * dx + dy * dy) * 1_000_000)) : Math.hypot(dx, dy);
}

function cycleKey(tour) {
  // Все циклы начинаются в A. Обратный обход проходит по тем же рёбрам.
  const tail = tour.slice(1);
  if (tail[0] > tail.at(-1)) tail.reverse();
  return tail.join(',');
}

function tourFromBest(run) {
  if (!run.best) return null;
  const [out, back] = run.best.paths;
  return out.concat(back.slice(1, -1).reverse());
}

class CandidateQueue {
  constructor() { this.items = []; }
  get first() { return this.items[0]; }
  add(state) {
    const items = this.items;
    let i = items.length;
    items.push(state);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= state.cost) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = state;
  }
  take(state = this.first) {
    const items = this.items;
    if (state !== items[0]) {
      // Поднимаем выбранную альтернативу в корень для обычного извлечения.
      let i = items.indexOf(state);
      if (i < 0) throw new Error('Альтернатива отсутствует в очереди');
      while (i > 0) {
        const parent = (i - 1) >> 1;
        items[i] = items[parent];
        i = parent;
      }
      items[0] = state;
    }
    const first = items[0];
    const last = items.pop();
    if (items.length) {
      let i = 0;
      while (2 * i + 1 < items.length) {
        let child = 2 * i + 1;
        if (child + 1 < items.length && items[child + 1].cost < items[child].cost) child++;
        if (last.cost <= items[child].cost) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return first;
  }
}

class RouteSearch {
  constructor(points, warmupLimit = points.length - 2, integerWeights = false, initialTour) {
    const started = performance.now();
    this.n = points.length;
    this.wide = this.n > 30;
    this.one = this.wide ? 1n : 1;
    this.bit = points.map((_, i) => this.wide ? 1n << BigInt(i) : 1 << i);
    const full = this.wide ? (1n << BigInt(this.n)) - 1n : (1 << this.n) - 1;
    this.lowIndex = this.wide ? new Map(this.bit.map((mask, i) => [mask, i])) : null;
    this.hasInitialTour = initialTour !== undefined;
    this.warmupLimit = this.hasInitialTour ? 0 : Math.min(this.n - 2, Math.max(0, Math.floor(warmupLimit)));
    this.warmupCount = 0;
    this.greedyChecks = 0;
    this.insertionChecks = 0;
    this.twoOptChecks = 0;
    this.integerWeights = integerWeights;
    this.points = points;
    this.dist = points.map(p => points.map(q => routeDistance(p, q, integerWeights)));
    this.turn = points.map(a => points.map(b => points.map(c => {
      const left = (b.x - a.x) * (c.y - a.y), right = (b.y - a.y) * (c.x - a.x);
      // При неуверенном знаке почти коллинеарной тройки сохраняем вариант.
      const tolerance = 8 * Number.EPSILON * (Math.abs(left) + Math.abs(right));
      return Math.abs(left - right) > tolerance ? Math.sign(left - right) : 0;
    })));
    this.edgeBlocks = points.map(() => []);
    this.edgeInteriors = points.map(() => []);
    this.a = 0;
    this.b = 1;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        if (this.dist[i][j] > this.dist[this.a][this.b]) [this.a, this.b] = [i, j];
      }
    }
    this.near = this.dist.map(row => row.map((_, i) => i).sort((i, j) => row[i] - row[j]));
    const seedRoot = {
      paths: [[this.a], [this.a]], len: [0, 0],
      allowed: this.bit.map(mask => full ^ mask),
      forks: [null, null],
      free: full ^ this.bit[this.a] ^ this.bit[this.b], side: 0, cost: 0
    };
    this.next = this.searchRoot(seedRoot);
    this.queues = [new CandidateQueue(), new CandidateQueue()];
    this.queueLimit = INITIAL_QUEUE_LIMIT;
    this.stack = [];
    this.retryFirst = false;
    this.seen = new Map();
    this.seenOrder = [];
    this.seenCursor = 0;
    this.duplicateCuts = 0;
    this.memoEvictions = 0;
    this.trees = new Map();
    this.treeOrder = [];
    this.treeCursor = 0;
    this.treeHits = this.treeMisses = this.treeEvictions = 0;
    this.boundCuts = 0;
    this.crossingCuts = 0;
    this.deadEndCuts = 0;
    this.seekingFirstCycle = true;
    this.done = false;
    this.finishReason = null;
    this.steps = this.bestStep = 0;
    this.completionInterval = COMPLETION_INTERVAL;
    this.nextCompletion = COMPLETION_INTERVAL;
    this.completionAttempts = this.completionChecks = this.completionSolutions = 0;
    this.completionImprovements = this.completionExhausted = this.completionMs = 0;
    this.completionSeed = points.reduce((seed, p, i) => Math.imul(seed ^ (p.x * 1000) ^ (p.y * 1000) ^ i, 16777619) >>> 0, 2166136261);
    this.completion = null;
    this.best = null;
    this.history = [];
    this.bound = this.candidateBound(this.next);
    if (this.hasInitialTour) this.useInitialTour(seedRoot, initialTour);
    const prepared = performance.now();
    this.preparationMs = prepared - started;
    if (this.warmupLimit) this.warmUp(seedRoot);
    const warmed = this.warmupLimit ? performance.now() : prepared;
    this.warmupMs = warmed - prepared;
    const record = this.best ? this.best.len[0] + this.best.len[1] : Infinity;
    if (this.wide && this.bound < record) {
      this.oneTree = new OneTreeBound(this.dist, record);
      this.next.bound = Math.max(this.bound, this.oneTree.bound(this.next.paths));
      this.bound = this.next.bound;
      this.preparationMs += performance.now() - warmed;
    }
    const searchStarted = performance.now();
    this.note = this.hasInitialTour ? 'Полный цикл принят как начальный рекорд. Проверяем, существует ли более короткий.' :
      this.best ? 'До основного поиска проверено циклов: ' + this.warmupCount + '. На карте — самый короткий из них.'
      : 'Разминка отключена. Первый цикл построит основной поиск.';
    this.current = this.best || this.next;
    this.lastQueueProgress = this.steps;
    this.nextCheckpoint = this.steps + 1;
    this.recordProgress();
    this.searchMs = performance.now() - searchStarted;
  }
  get mainSteps() { return this.steps - this.warmupCount; }
  get warmupCandidates() { return this.insertionChecks + this.twoOptChecks; }
  get totalMs() { return this.preparationMs + this.warmupMs + this.searchMs + this.completionMs; }
  searchRoot(seed) { return seed; }
  useInitialTour(root, input) {
    if (!Array.isArray(input) || input.length !== this.n || new Set(input).size !== this.n ||
        input.some(city => !Number.isInteger(city) || city < 0 || city >= this.n)) {
      throw new Error('Начальный цикл должен содержать каждый номер города ровно один раз, без повторения первого в конце.');
    }
    const start = input.indexOf(this.a), tour = input.slice(start).concat(input.slice(0, start)), split = tour.indexOf(this.b);
    let state = root;
    // Принимаем сам маршрут, а длину считаем заново. Чужому значению рекорда и заявлению об оптимальности не доверяем.
    for (let i = 1; i <= split; i++) state = this.extend(state, 0, tour[i]);
    for (let i = this.n - 1; i >= split; i--) state = this.extend(state, 1, tour[i]);
    this.best = state;
    this.history.push({ step: 0, len: state.len, bound: this.bound });
  }
  greedySeed(seed = this.next) {
    while (seed.free) {
      const side = this.shorter(seed);
      const end = seed.paths[side].at(-1);
      const city = this.near[end].find(i => {
        this.greedyChecks++;
        return seed.free & this.bit[i];
      });
      seed = this.extend(seed, side, city);
    }
    return this.close(seed);
  }
  insertionTour() {
    const tour = [this.a, this.b];
    for (const city of this.near[this.a].slice().reverse()) {
      if (city === this.a || city === this.b) continue;
      let position = 1, leastExtra = Infinity;
      for (let i = 0; i < tour.length; i++) {
        this.insertionChecks++;
        const a = tour[i], b = tour[(i + 1) % tour.length];
        const extra = this.dist[a][city] + this.dist[city][b] - this.dist[a][b];
        if (extra < leastExtra) { position = i + 1; leastExtra = extra; }
      }
      tour.splice(position, 0, city);
    }
    return tour;
  }
  warmupNeighbor(tour, visited) {
    let next = null, bestChange = Infinity;
    for (let i = 0; i < this.n - 2; i++) {
      for (let j = i + 2; j < this.n; j++) {
        if (i === 0 && j === this.n - 1) continue;
        this.twoOptChecks++;
        const a = tour[i], b = tour[i + 1], c = tour[j], d = tour[(j + 1) % this.n];
        const change = this.dist[a][c] + this.dist[b][d] - this.dist[a][b] - this.dist[c][d];
        if (change >= bestChange) continue;
        const candidate = tour.slice(0, i + 1).concat(tour.slice(i + 1, j + 1).reverse(), tour.slice(j + 1));
        if (visited.has(cycleKey(candidate))) continue;
        next = candidate;
        bestChange = change;
      }
    }
    return next;
  }
  warmUp(root = this.next) {
    this.best = this.greedySeed(root);
    this.steps = this.bestStep = this.warmupCount = 1;
    this.history.push({ step: this.steps, len: this.best.len, bound: this.bound });
    if (this.warmupLimit === 1) return;
    const [out, back] = this.best.paths;
    const seed = out.concat(back.slice(1, -1).reverse());
    const visited = new Set([cycleKey(seed)]);
    const trail = [seed];
    const consider = tour => {
      visited.add(cycleKey(tour));
      trail.push(tour);
      // Пересчитываем длины ветвей по самим рёбрам перед сохранением полного маршрута.
      const split = tour.indexOf(this.b);
      let state = root;
      for (let i = 1; i <= split; i++) state = this.extend(state, 0, tour[i]);
      for (let i = this.n - 1; i >= split; i--) state = this.extend(state, 1, tour[i]);
      this.steps++;
      if (state.len[0] + state.len[1] < this.best.len[0] + this.best.len[1]) {
        this.best = state;
        this.bestStep = this.steps;
        this.history.push({ step: this.steps, len: state.len, bound: this.bound });
      }
    };
    const inserted = this.insertionTour();
    if (!visited.has(cycleKey(inserted))) consider(inserted);
    while (trail.length && visited.size < this.warmupLimit) {
      const next = this.warmupNeighbor(trail.at(-1), visited);
      if (next) consider(next);
      else trail.pop();
    }
    this.warmupCount = visited.size;
  }
  shorter(s) {
    if (s.paths[0].at(-1) === this.b) return 1;
    if (s.paths[1].at(-1) === this.b) return 0;
    return s.len[0] <= s.len[1] ? 0 : 1;
  }
  extend(s, side, city) {
    const paths = s.paths.slice(), len = s.len.slice();
    const from = paths[side].at(-1);
    len[side] += this.dist[from][city];
    paths[side] = [...paths[side], city];
    const blocked = this.blockedByEdge(from, city);
    const allowed = s.allowed.map((neighbors, i) => neighbors & ~blocked[i]);
    return { paths, len, allowed, forks: s.forks, free: s.free & ~this.bit[city], side, cost: len[side] };
  }
  blockedByEdge(from, to) {
    if (this.edgeBlocks[from][to]) return this.edgeBlocks[from][to];
    const turn = this.turn[from][to];
    const blocked = this.wide ? Array(this.n).fill(0n) : new Int32Array(this.n);
    for (let a = 0; a < this.n; a++) {
      for (let b = a + 1; b < this.n; b++) {
        if (a === from || a === to || b === from || b === to) continue;
        const other = this.turn[a][b];
        const crosses = turn[a] * turn[b] < 0 && other[from] * other[to] < 0;
        const touches = !crosses && (
          ((turn[a] === 0 || turn[b] === 0) && Boolean(this.edgeInterior(from, to) & (this.bit[a] | this.bit[b]))) ||
          ((other[from] === 0 || other[to] === 0) && Boolean(this.edgeInterior(a, b) & (this.bit[from] | this.bit[to]))));
        if (crosses || touches) {
          // Округление и коллинеарное касание могут убрать выигрыш от распутывания.
          // В этих случаях запрещаем пару лишь когда обе замены строго дешевле.
          if (this.integerWeights || touches) {
            const d = this.dist, crossed = d[from][to] + d[a][b];
            const tolerance = this.integerWeights ? 0 : 32 * Number.EPSILON * crossed;
            if (crossed <= Math.max(d[from][a] + d[to][b], d[from][b] + d[to][a]) + tolerance) continue;
          }
          blocked[a] |= this.bit[b];
          blocked[b] |= this.bit[a];
        }
      }
    }
    this.edgeBlocks[from][to] = this.edgeBlocks[to][from] = blocked;
    return blocked;
  }
  edgeInterior(from, to) {
    const cached = this.edgeInteriors[from][to];
    if (cached !== undefined) return cached;
    const a = this.points[from], b = this.points[to];
    let mask = this.wide ? 0n : 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.points[i];
      // Только точное попадание центра города внутрь отрезка, без радиуса кружка на карте.
      if ((b.x - a.x) * (p.y - a.y) === (b.y - a.y) * (p.x - a.x) &&
          (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) < 0) mask |= this.bit[i];
    }
    this.edgeInteriors[from][to] = this.edgeInteriors[to][from] = mask;
    return mask;
  }
  checkedExtension(s, side, city) {
    if (!(s.allowed[s.paths[side].at(-1)] & this.bit[city])) return null;
    const child = this.extend(s, side, city);
    // После последнего свободного города обе дороги в B обязательны и имеют общий конец.
    if (!child.free && child.paths.some(path => {
      const end = path.at(-1);
      return end !== this.b && !(child.allowed[end] & this.bit[this.b]);
    })) return null;
    return child;
  }
  extensionFrame(s) {
    const side = this.shorter(s), end = s.paths[side].at(-1);
    const other = s.paths[1 - side].at(-1);
    return { state: s, side, end, index: 0,
      cities: this.near[end].filter(city => (s.free & this.bit[city]) || (city === this.b && other !== this.b)) };
  }
  completedCycle(s) { return s.free ? null : this.close(s); }
  completionBlocked(s) {
    return this.blockedCity(s, s.paths[0].at(-1), s.paths[1].at(-1)) !== -1;
  }
  randomCompletionFrame(s) {
    const frame = this.extensionFrame(s);
    // Воспроизводимый случайный выбор среди трёх ближайших продолжений.
    this.completionSeed = (Math.imul(1664525, this.completionSeed) + 1013904223) >>> 0;
    const index = Math.floor(this.completionSeed / 4294967296 * Math.min(3, frame.cities.length));
    if (index) frame.cities.unshift(frame.cities.splice(index, 1)[0]);
    return frame;
  }
  startCompletion(s) {
    if (!this.completionInterval || this.mainSteps < this.nextCompletion) return false;
    const started = performance.now();
    this.nextCompletion = this.mainSteps + this.completionInterval;
    this.completionAttempts++;
    this.completion = { root: s, stack: [this.randomCompletionFrame(s)], checks: 0, budget: Math.max(64, 6 * this.n) };
    this.note = 'Пробуем достроить текущие ветви до полного цикла.';
    this.completionMs += performance.now() - started;
    return true;
  }
  stepCompletion() {
    const started = performance.now(), probe = this.completion;
    let outcome = null;
    while (probe.stack.length && probe.stack.at(-1).index === probe.stack.at(-1).cities.length) probe.stack.pop();
    if (!probe.stack.length) outcome = 'exhausted';
    else {
      const frame = probe.stack.at(-1), city = frame.cities[frame.index++];
      probe.checks++;
      this.completionChecks++;
      const child = this.checkedExtension(frame.state, frame.side, city);
      if (child) {
        this.current = child;
        const cycle = this.completedCycle(child);
        if (cycle) {
          this.seekingFirstCycle = false;
          this.completionSolutions++;
          const length = cycle.len[0] + cycle.len[1];
          if (!this.best || length < this.best.len[0] + this.best.len[1]) {
            this.best = cycle;
            this.bestStep = this.steps;
            this.completionImprovements++;
            outcome = 'improved';
          } else outcome = 'cycle';
        } else if (!this.completionBlocked(child)) probe.stack.push(this.randomCompletionFrame(child));
      }
      if (!outcome && probe.checks >= probe.budget) outcome = 'budget';
      this.note = 'Пробная достройка · проверено продолжений ' + probe.checks + ' / ' + probe.budget + '.';
    }
    this.completionMs += performance.now() - started;
    if (outcome) this.finishCompletion(outcome);
  }
  finishCompletion(outcome) {
    const s = this.completion.root;
    this.completion = null;
    this.current = s;
    const record = this.best ? this.best.len[0] + this.best.len[1] : Infinity;
    if (outcome === 'exhausted') {
      this.completionExhausted++;
      this.deadEndCuts++;
      this.note = 'Все допустимые достройки этого состояния исчерпаны. Возвращаемся к альтернативам.';
    } else if (this.candidateBound(s) >= record) {
      this.boundCuts++;
      this.note = 'Новый рекорд исключил улучшение из этого состояния.';
    } else {
      this.branch(s, record);
      if (outcome === 'improved') this.note = 'Пробная достройка улучшила L. Основной поиск продолжается.';
      if (outcome === 'budget') this.note = 'Лимит пробной достройки достигнут. Продолжаем обычный перебор этого состояния.';
    }
    this.recordProgress();
  }
  blockedCity(s, u, v) {
    // Остаток цикла — путь от u до v. Если обе ветви открыты, B лежит внутри пути.
    const inner = u === this.b || v === this.b ? s.free : s.free | this.bit[this.b];
    const vertices = inner | this.bit[u] | this.bit[v];
    for (let bits = inner; bits; bits &= bits - this.one) {
      const city = this.firstCity(bits);
      const neighbors = s.allowed[city] & vertices;
      if (!(neighbors & (neighbors - this.one))) return city;
    }
    const exits = s.allowed[u] & inner;
    if (!exits || (u === v && !(exits & (exits - this.one)))) return u;
    if (!(s.allowed[v] & inner)) return v;
    // После удаления обоих концов внутренние города всё ещё образуют связный путь.
    let frontier = inner & -inner, unseen = inner ^ frontier;
    while (frontier && unseen) {
      const city = this.firstCity(frontier);
      const reached = s.allowed[city] & unseen;
      frontier = (frontier & (frontier - this.one)) | reached;
      unseen ^= reached;
    }
    return unseen ? this.firstCity(unseen) : -1;
  }
  firstCity(bits) {
    const lowest = bits & -bits;
    return this.wide ? this.lowIndex.get(lowest) : 31 - Math.clz32(lowest);
  }
  retryLongerBranch(s) {
    if (this.oneTree) return;
    const side = s.len[0] >= s.len[1] ? 0 : 1;
    let fork = s.forks[side];
    while (fork && !fork.pending.size) fork = fork.previous;
    if (!fork) return;
    const sibling = fork.pending.values().next().value;
    const index = this.stack.lastIndexOf(sibling);
    if (index >= 0) this.stack.splice(index, 1);
    else this.queues[side].take(sibling);
    this.stack.push(sibling);
    this.retryFirst = true;
  }
  close(s) {
    for (let side = 0; side < 2; side++) {
      if (s.paths[side].at(-1) !== this.b) s = this.extend(s, side, this.b);
    }
    return s;
  }
  treeLength(free) {
    const cached = this.cachedTree(free);
    if (cached !== undefined) return cached;
    if (this.wide) return this.wideTreeLength(free);
    // После удаления концов ветвей остаток цикла связывает свободные города и B.
    const cost = this.dist[this.b].slice();
    let left = free, length = 0;
    while (left) {
      let city = -1;
      for (let bits = left; bits; bits &= bits - 1) {
        const i = 31 - Math.clz32(bits & -bits);
        if (city < 0 || cost[i] < cost[city]) city = i;
      }
      left &= ~(1 << city);
      length += cost[city];
      for (let bits = left; bits; bits &= bits - 1) {
        const i = 31 - Math.clz32(bits & -bits);
        cost[i] = Math.min(cost[i], this.dist[city][i]);
      }
    }
    this.rememberTree(free, length);
    return length;
  }
  wideTreeLength(free) {
    // Извлекаем вершины один раз: внутренние циклы Прима работают с номерами, без операций над BigInt.
    const cities = [];
    for (let bits = free; bits; bits &= bits - 1n) cities.push(this.firstCity(bits));
    const cost = this.dist[this.b].slice();
    let length = 0;
    while (cities.length) {
      let best = 0;
      for (let i = 1; i < cities.length; i++) if (cost[cities[i]] < cost[cities[best]]) best = i;
      const city = cities[best];
      cities.splice(best, 1);
      length += cost[city];
      for (const i of cities) cost[i] = Math.min(cost[i], this.dist[city][i]);
    }
    this.rememberTree(free, length);
    return length;
  }
  cachedTree(free) {
    const value = this.trees.get(free);
    if (value === undefined) this.treeMisses++;
    else this.treeHits++;
    return value;
  }
  rememberTree(free, value) {
    if (this.trees.size === MAX_TREE_STATES) {
      if (!this.wide) return;
      // Кеш остовов тоже обновляется: глубокие поддеревья используют другие множества городов.
      this.trees.delete(this.treeOrder[this.treeCursor]);
      this.treeOrder[this.treeCursor] = free;
      this.treeCursor = (this.treeCursor + 1) % MAX_TREE_STATES;
      this.treeEvictions++;
    } else if (this.wide) this.treeOrder.push(free);
    this.trees.set(free, value);
  }
  lowerBound(s, u, v) {
    const remaining = s.free | this.bit[this.b];
    const connection = end => this.dist[end][this.near[end].find(i => remaining & this.bit[i])];
    return s.len[0] + s.len[1] + Math.max(
      this.dist[u][this.b] + this.dist[v][this.b],
      this.treeLength(s.free) + connection(u) + connection(v)
    );
  }
  candidateBound(s) {
    if (s.bound === undefined) {
      const u = s.paths[0].at(-1), v = s.paths[1].at(-1);
      const upper = this.best ? this.best.len[0] + this.best.len[1] : Infinity;
      s.bound = s.len[0] + s.len[1] + (this.dist[u][this.b] + this.dist[v][this.b]);
      // Достигнув рекорда, вариант уже исключён: более дорогие оценки ему не нужны.
      // У оставшихся вариантов вычисляем прежний максимум всех оценок.
      if (s.bound < upper && this.oneTree) s.bound = Math.max(s.bound, this.oneTree.bound(s.paths));
      if (s.bound < upper) s.bound = Math.max(s.bound, this.lowerBound(s, u, v));
    }
    return s.bound;
  }
  rememberState(key, g, previous) {
    if (previous !== undefined) {
      if (g < previous) this.seen.set(key, g);
      return;
    }
    if (this.seen.size === MAX_SEEN_STATES) {
      if (!this.wide) return;
      // Кольцо вытесняет старые записи за O(1), не выключая запоминание новых.
      this.seen.delete(this.seenOrder[this.seenCursor]);
      this.seenOrder[this.seenCursor] = key;
      this.seenCursor = (this.seenCursor + 1) % MAX_SEEN_STATES;
      this.memoEvictions++;
    } else if (this.wide) this.seenOrder.push(key);
    this.seen.set(key, g);
  }
  recordProgress() {
    const total = this.best ? this.best.len[0] + this.best.len[1] : Infinity;
    const exhausted = !this.next && !this.pending && !this.stack.length && !this.completion && !this.deferredCount;
    if (exhausted) {
      this.bound = total;
    } else if (this.steps === this.nextCheckpoint && this.bound < total) {
      // Оптимум покрыт либо рекордом, либо одним из ещё открытых поддеревьев.
      let lower = this.next ? Math.min(total, this.candidateBound(this.next)) : total;
      if (this.completion) lower = Math.min(lower, this.candidateBound(this.completion.root));
      for (const group of this.frontierGroups()) {
        for (const state of group) lower = Math.min(lower, this.candidateBound(state));
      }
      if (lower > this.bound) {
        this.bound = lower;
        this.lastQueueProgress = this.steps;
      }
      if (this.bound < total && this.queueLimit < MAX_QUEUE_LIMIT &&
          this.pending + this.stack.length >= this.queueLimit &&
          this.steps - Math.max(this.bestStep, this.lastQueueProgress) >= QUEUE_STALL_STEPS) {
        this.queueLimit = Math.min(2 * this.queueLimit, MAX_QUEUE_LIMIT);
        this.lastQueueProgress = this.steps;
      }
      this.nextCheckpoint += Math.max(8, Math.ceil((this.steps - this.warmupCount) / 8));
    }
    // Между контрольными точками новый рекорд тоже может достичь уже известной границы.
    if (this.best && this.bound >= total) {
      this.done = true;
      this.finishReason = exhausted ? 'exhausted' : 'bound';
      this.bound = total;
      this.note = exhausted ? 'Все перспективные варианты проверены. Длина лучшего цикла минимальна.'
        : 'Нижняя граница достигла рекорда. Поиск завершён досрочно.';
      this.clearFrontier();
    }
    const previous = this.history.at(-1);
    if (this.best && (!previous || previous.len !== this.best.len || previous.bound !== this.bound)) {
      this.history.push({ step: this.steps, len: this.best.len, bound: this.bound });
    }
  }
  get pending() {
    return this.queues[0].items.length + this.queues[1].items.length;
  }
  get deferredCount() { return 0; }
  frontierGroups() { return [this.stack, this.queues[0].items, this.queues[1].items]; }
  clearFrontier() {
    this.next = null;
    this.completion = null;
    this.stack.length = 0;
    for (const queue of this.queues) queue.items.length = 0;
  }
  queueFor(s) { return this.queues[s.side]; }
  refillQueues() {
    if (this.queueLimit === INITIAL_QUEUE_LIMIT) return;
    // После расширения возвращаем отложенные варианты в очередь, сохраняя каждое поддерево.
    while (this.stack.length && this.pending < this.queueLimit) {
      const state = this.stack.pop();
      this.queueFor(state).add(state);
    }
  }
  choose() {
    if (this.oneTree) {
      // Сильная оценка задаёт порядок возврата к альтернативам на больших полях.
      this.refillQueues();
      if (this.stack.length) return this.stack.pop();
      if (!this.best && this.next) {
        const first = this.next;
        this.next = null;
        return first;
      }
      if (this.next) { this.queues[this.next.side].add(this.next); this.next = null; }
      const [left, right] = this.queues;
      if (!right.first || (left.first && left.first.cost <= right.first.cost)) return left.take();
      return right.take();
    }
    // При большой очереди обходим поддерево в глубину, сохраняя все альтернативы.
    if (this.stack.length) {
      if (this.retryFirst || this.queueLimit === INITIAL_QUEUE_LIMIT || this.pending >= this.queueLimit) {
        this.retryFirst = false;
        return this.stack.pop();
      }
      // Свободные места в расширенной очереди занимают уже отложенные варианты.
      while (this.stack.length && this.pending < this.queueLimit) {
        const state = this.stack.pop();
        this.queues[state.side].add(state);
      }
    }
    // Первый полный вариант перебора ищем по ближайшим допустимым продолжениям.
    if (this.next && (this.seekingFirstCycle || this.pending >= this.queueLimit)) {
      const s = this.next;
      this.next = null;
      return s;
    }
    let side = -1;
    for (let i = 0; i < 2; i++) {
      const alt = this.queues[i].first;
      if (!alt || (this.next && alt.cost > this.next.len[1 - i])) continue;
      if (side < 0 || alt.cost < this.queues[side].first.cost) side = i;
    }
    if (side >= 0) {
      const s = this.queues[side].take();
      if (this.next) this.queues[this.next.side].add(this.next);
      this.next = null;
      return s;
    }
    const s = this.next;
    this.next = null;
    return s;
  }
  advance(limit = Infinity, sliceMs = Infinity) {
    if (limit < 1 || this.done) return 0;
    const start = performance.now(), deadline = start + sliceMs, before = this.steps + this.completionChecks;
    const completionBefore = this.completionMs;
    do {
      if (this.completion) this.stepCompletion();
      else this.processState();
    } while (!this.done && this.steps + this.completionChecks - before < limit && (sliceMs === Infinity || performance.now() < deadline));
    this.searchMs += performance.now() - start - (this.completionMs - completionBefore);
    return this.steps + this.completionChecks - before;
  }
  step() { return this.advance(1); }
  processState() {
    const s = this.choose();
    s.forks[s.side]?.pending.delete(s);
    this.steps++;
    this.current = s;
    const [u, v] = s.paths.map(path => path.at(-1));
    const g = s.len[0] + s.len[1];
    const record = this.best ? this.best.len[0] + this.best.len[1] : Infinity;
    const ends = Math.min(u, v) * this.n + Math.max(u, v);
    // При n ≤ 100 пара концов занимает меньше 14 бит.
    const key = this.wide ? (s.free << 14n) | BigInt(ends) : s.free * this.n * this.n + ends;
    const previous = this.seen.get(key);
    if (!s.free) {
      this.seekingFirstCycle = false;
      this.current = this.close(s);
      const total = this.current.len[0] + this.current.len[1];
      this.note = 'Обе ветви дошли до B. Сравниваем длину полного цикла с рекордом.';
      if (total < record) {
        this.best = this.current;
        this.bestStep = this.steps;
        this.note = 'Найден более короткий полный цикл. Рекорд обновлён.';
      }
    } else if (previous !== undefined && (g === previous || g > previous + 1e-10)) {
      this.duplicateCuts++;
      this.note = 'Такие концы ветвей и свободные города уже встречались с меньшей или равной суммой.';
    } else if (this.candidateBound(s) >= record) {
      this.boundCuts++;
      this.note = 'Нижняя оценка достигла или превысила рекорд. Возвращаемся к альтернативам.';
    } else {
      const blocked = this.blockedCity(s, u, v);
      if (blocked !== -1) {
        this.deadEndCuts++;
        this.note = 'Тупик. Оставшимися рёбрами нельзя завершить цикл через город ' + String(blocked + 1).padStart(2, '0') + '. Возвращаемся к развилке.';
        this.retryLongerBranch(s);
        this.recordProgress();
        return;
      }
      this.rememberState(key, g, previous);
      if (!this.startCompletion(s)) this.branch(s, record);
    }
    this.recordProgress();
  }
  branch(s, record) {
    const { side, end, cities } = this.extensionFrame(s);
    const children = [];
    for (const city of cities) {
      const child = this.checkedExtension(s, side, city);
      if (child && this.oneTree && this.candidateBound(child) >= record) this.boundCuts++;
      else if (child) {
        if (this.oneTree) child.cost = this.candidateBound(child);
        children.push(child);
      } else this.crossingCuts++;
    }
    if (children.length > 1) {
      const forks = s.forks.slice();
      forks[side] = { pending: new Set(children), previous: forks[side] };
      for (const child of children) child.forks = forks;
    }
    if (this.pending >= this.queueLimit || this.stack.length) {
      for (let i = children.length - 1; i >= 0; i--) this.stack.push(children[i]);
    } else {
      this.next = children[0];
      for (const alt of children.slice(1)) this.queues[side].add(alt);
    }
    this.note = children.length
      ? 'Развиваем ветвь ' + (side === 0 ? 'ℓ₁' : 'ℓ₂') + ' из города ' + String(end + 1).padStart(2, '0') + '.'
      : 'Все продолжения отсечены по пересечениям или нижней оценке. Возвращаемся к альтернативам.';
    if (!children.length) this.retryLongerBranch(s);
  }
}
