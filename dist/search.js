'use strict';

const MAX_SEEN_STATES = 250_000;
const INITIAL_QUEUE_LIMIT = 4_000;
const MAX_QUEUE_LIMIT = 16_000;
const QUEUE_STALL_STEPS = 25_000;
const WARMUP_CYCLES = 10;

function balanceRatio([l1, l2]) {
  const half = (l1 + l2) / 2;
  return ((half / l1) ** 3 + (half / l2) ** 3) / 2;
}

function cycleKey(tour) {
  // Все циклы начинаются в A. Обратный обход проходит по тем же рёбрам.
  const tail = tour.slice(1);
  if (tail[0] > tail.at(-1)) tail.reverse();
  return tail.join(',');
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
  constructor(points) {
    this.n = points.length;
    this.dist = points.map(p => points.map(q => Math.hypot(p.x - q.x, p.y - q.y)));
    this.turn = points.map(a => points.map(b => points.map(c => {
      const left = (b.x - a.x) * (c.y - a.y), right = (b.y - a.y) * (c.x - a.x);
      // При неуверенном знаке почти коллинеарной тройки сохраняем вариант.
      const tolerance = 8 * Number.EPSILON * (Math.abs(left) + Math.abs(right));
      return Math.abs(left - right) > tolerance ? Math.sign(left - right) : 0;
    })));
    this.edgeBlocks = points.map(() => []);
    this.a = 0;
    this.b = 1;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        if (this.dist[i][j] > this.dist[this.a][this.b]) [this.a, this.b] = [i, j];
      }
    }
    this.near = this.dist.map(row => row.map((_, i) => i).sort((i, j) => row[i] - row[j]));
    this.next = {
      paths: [[this.a], [this.a]], len: [0, 0],
      allowed: points.map((_, i) => ((1 << this.n) - 1) ^ (1 << i)),
      forks: [null, null],
      free: ((1 << this.n) - 1) ^ (1 << this.a) ^ (1 << this.b), side: 0, cost: 0
    };
    this.queues = [new CandidateQueue(), new CandidateQueue()];
    this.queueLimit = INITIAL_QUEUE_LIMIT;
    this.stack = [];
    this.retryFirst = false;
    this.seen = new Map();
    this.trees = new Map();
    this.boundCuts = 0;
    this.crossingCuts = 0;
    this.deadEndCuts = 0;
    this.seekingFirstCycle = true;
    this.done = false;
    this.finishReason = null;
    let seed = this.next;
    while (seed.free) {
      const side = this.shorter(seed);
      const end = seed.paths[side].at(-1);
      const city = this.near[end].find(i => seed.free & (1 << i));
      seed = this.extend(seed, side, city);
    }
    this.best = this.close(seed);
    this.steps = 1;
    this.bestStep = 1;
    this.bound = this.candidateBound(this.next);
    this.history = [{ step: this.steps, len: this.best.len, bound: this.bound }];
    this.warmUp();
    this.note = 'До основного поиска проверено циклов: ' + this.warmupCount + '. На карте — самый короткий из них.';
    this.current = this.best;
    this.lastQueueProgress = this.steps;
    this.nextCheckpoint = this.steps + 1;
    this.recordProgress();
  }
  insertionTour() {
    const tour = [this.a, this.b];
    for (const city of this.near[this.a].slice().reverse()) {
      if (city === this.a || city === this.b) continue;
      let position = 1, leastExtra = Infinity;
      for (let i = 0; i < tour.length; i++) {
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
  warmUp() {
    const [out, back] = this.best.paths;
    const seed = out.concat(back.slice(1, -1).reverse());
    const visited = new Set([cycleKey(seed)]);
    const trail = [seed];
    const consider = tour => {
      visited.add(cycleKey(tour));
      trail.push(tour);
      // Пересчитываем длины ветвей по самим рёбрам перед сохранением полного маршрута.
      const split = tour.indexOf(this.b);
      let state = this.next;
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
    while (trail.length && visited.size < WARMUP_CYCLES) {
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
    return { paths, len, allowed, forks: s.forks, free: s.free & ~(1 << city), side, cost: len[side] };
  }
  blockedByEdge(from, to) {
    if (this.edgeBlocks[from][to]) return this.edgeBlocks[from][to];
    const turn = this.turn[from][to];
    const blocked = new Int32Array(this.n);
    for (let a = 0; a < this.n; a++) {
      for (let b = a + 1; b < this.n; b++) {
        if (turn[a] * turn[b] >= 0) continue;
        const other = this.turn[a][b];
        if (other[from] * other[to] < 0) {
          blocked[a] |= 1 << b;
          blocked[b] |= 1 << a;
        }
      }
    }
    this.edgeBlocks[from][to] = this.edgeBlocks[to][from] = blocked;
    return blocked;
  }
  checkedExtension(s, side, city) {
    if (!(s.allowed[s.paths[side].at(-1)] & (1 << city))) return null;
    const child = this.extend(s, side, city);
    // После последнего свободного города обе дороги в B обязательны и имеют общий конец.
    if (!child.free && child.paths.some(path => {
      const end = path.at(-1);
      return end !== this.b && !(child.allowed[end] & (1 << this.b));
    })) return null;
    return child;
  }
  blockedCity(s, u, v) {
    // Остаток цикла — путь от u до v. Если обе ветви открыты, B лежит внутри пути.
    const inner = u === this.b || v === this.b ? s.free : s.free | (1 << this.b);
    const vertices = inner | (1 << u) | (1 << v);
    for (let bits = inner; bits; bits &= bits - 1) {
      const city = 31 - Math.clz32(bits & -bits);
      const neighbors = s.allowed[city] & vertices;
      if (!(neighbors & (neighbors - 1))) return city;
    }
    const exits = s.allowed[u] & inner;
    if (!exits || (u === v && !(exits & (exits - 1)))) return u;
    if (!(s.allowed[v] & inner)) return v;
    // После удаления обоих концов внутренние города всё ещё образуют связный путь.
    let frontier = inner & -inner, unseen = inner ^ frontier;
    while (frontier && unseen) {
      const city = 31 - Math.clz32(frontier & -frontier);
      const reached = s.allowed[city] & unseen;
      frontier = (frontier & (frontier - 1)) | reached;
      unseen ^= reached;
    }
    return unseen ? 31 - Math.clz32(unseen & -unseen) : -1;
  }
  retryLongerBranch(s) {
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
    if (this.trees.has(free)) return this.trees.get(free);
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
    if (this.trees.size < 16000) this.trees.set(free, length);
    return length;
  }
  lowerBound(s, u, v) {
    const remaining = s.free | (1 << this.b);
    const connection = end => this.dist[end][this.near[end].find(i => remaining & (1 << i))];
    return s.len[0] + s.len[1] + Math.max(
      this.dist[u][this.b] + this.dist[v][this.b],
      this.treeLength(s.free) + connection(u) + connection(v)
    );
  }
  candidateBound(s) {
    if (s.bound === undefined) s.bound = this.lowerBound(s, s.paths[0].at(-1), s.paths[1].at(-1));
    return s.bound;
  }
  recordProgress() {
    const total = this.best.len[0] + this.best.len[1];
    const exhausted = !this.next && !this.pending && !this.stack.length;
    if (exhausted) {
      this.bound = total;
    } else if (this.steps === this.nextCheckpoint && this.bound < total) {
      // Оптимум покрыт либо рекордом, либо одним из ещё открытых поддеревьев.
      let lower = this.next ? Math.min(total, this.candidateBound(this.next)) : total;
      for (const group of [this.stack, this.queues[0].items, this.queues[1].items]) {
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
    if (this.bound >= total) {
      this.done = true;
      this.finishReason = exhausted ? 'exhausted' : 'bound';
      this.bound = total;
      this.note = exhausted ? 'Все перспективные варианты проверены. Длина лучшего цикла минимальна.'
        : 'Нижняя граница достигла рекорда. Поиск завершён досрочно.';
      this.next = null;
      this.stack.length = 0;
      for (const queue of this.queues) queue.items.length = 0;
    }
    const previous = this.history.at(-1);
    if (!previous || previous.len !== this.best.len || previous.bound !== this.bound) {
      this.history.push({ step: this.steps, len: this.best.len, bound: this.bound });
    }
  }
  get pending() {
    return this.queues[0].items.length + this.queues[1].items.length;
  }
  choose() {
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
  step() {
    if (this.done) return;
    const s = this.choose();
    s.forks[s.side]?.pending.delete(s);
    this.steps++;
    this.current = s;
    const [u, v] = s.paths.map(path => path.at(-1));
    const g = s.len[0] + s.len[1];
    const record = this.best.len[0] + this.best.len[1];
    const key = (s.free * this.n + Math.min(u, v)) * this.n + Math.max(u, v);
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
      if (previous !== undefined || this.seen.size < MAX_SEEN_STATES) this.seen.set(key, g);
      const side = this.shorter(s), end = side === 0 ? u : v;
      const other = side === 0 ? v : u;
      const children = [];
      for (const city of this.near[end]) {
        if ((s.free & (1 << city)) || (city === this.b && other !== this.b)) {
          const child = this.checkedExtension(s, side, city);
          if (child) children.push(child);
          else this.crossingCuts++;
        }
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
        : 'Все продолжения из этого состояния дают пересечение. Возвращаемся к альтернативам.';
      if (!children.length) this.retryLongerBranch(s);
    }
    this.recordProgress();
  }
}
