'use strict';

const ROUTE_ALGORITHMS = { khvastuns: 'khvastuns', 'hvastuns-4': 'Hvastuns-4', 'hvastuns-var': 'Hvastuns-var', 'hvastuns-staged': 'Hvastuns-var · поэтапно', held: 'Held–Karp' };

function isVariableAlgorithm(algorithm) { return algorithm === 'hvastuns-var' || algorithm === 'hvastuns-staged'; }

function createRouteSearch(algorithm, points, limit, integerWeights, initialTour, scoreModel) {
  if (algorithm === 'hvastuns-staged') return new StagedRouteSearch(points, limit, integerWeights, initialTour, scoreModel);
  if (algorithm === 'hvastuns-var') return new VariableRouteSearch(points, limit, integerWeights, initialTour, scoreModel);
  if (algorithm === 'hvastuns-4') return new FourBranchSearch(points, limit, integerWeights, initialTour);
  if (algorithm === 'held') return new HeldKarpSearch(points);
  if (algorithm === 'khvastuns' || algorithm === undefined) return new RouteSearch(points, limit, integerWeights, initialTour);
  throw new Error('Неизвестный алгоритм поиска');
}

class FourBranchSearch extends RouteSearch {
  searchRoot(seed) {
    return { paths: [[this.a], [this.a], [this.b], [this.b]], len: [0, 0, 0, 0],
      ends: [this.a, this.a, this.b, this.b], open: [0, 2, 1, 3],
      free: seed.free, allowed: seed.allowed, g: 0 };
  }

  forest(free) {
    const cached = this.cachedTree(free);
    if (cached !== undefined) return cached;
    const root = this.firstCity(free), cities = [];
    for (let bits = free ^ this.bit[root]; bits; bits &= bits - this.one) cities.push(this.firstCity(bits));
    const cost = this.dist[root].slice();
    let tree = 0, largest = 0;
    while (cities.length) {
      let best = 0;
      for (let i = 1; i < cities.length; i++) if (cost[cities[i]] < cost[cities[best]]) best = i;
      const city = cities[best];
      cities[best] = cities.at(-1);
      cities.pop();
      tree += cost[city];
      largest = Math.max(largest, cost[city]);
      for (const i of cities) cost[i] = Math.min(cost[i], this.dist[city][i]);
    }
    const result = { tree, twoTrees: tree - largest };
    this.rememberTree(free, result);
    return result;
  }

  candidateBound(s) {
    if (s.bound !== undefined) return s.bound;
    const ends = s.ends, d = this.dist, free = s.free;
    const direct = (i, j) => (s.allowed[ends[i]] & this.bit[ends[j]]) ? d[ends[i]][ends[j]] : Infinity;
    let extra;
    if (!s.open.length) extra = 0;
    else if (!free) {
      if (s.open.length === 2) extra = direct(...s.open);
      else extra = Math.min(direct(0, 2) + direct(1, 3), direct(0, 3) + direct(1, 2));
    } else {
      const { tree, twoTrees } = this.forest(free);
      const link = ends.map(e => {
        const options = free & s.allowed[e];
        return options ? d[e][this.near[e].find(j => options & this.bit[j])] : Infinity;
      });
      if (s.open.length === 2) {
        const [a, b] = s.open;
        extra = Math.max(d[ends[a]][ends[b]], tree + link[a] + link[b]);
      } else {
        // Два непустых остатка дают лес из двух деревьев и четыре подключения.
        // Если один остаток пуст, его концы соединяются одним прямым ребром.
        extra = free & (free - this.one) ? twoTrees + link[0] + link[1] + link[2] + link[3] : Infinity;
        for (const a of [0, 1]) for (const b of [2, 3]) {
          extra = Math.min(extra, direct(a, b) + tree + link[1 - a] + link[5 - b]);
        }
        extra = Math.max(extra, Math.min(d[ends[0]][ends[2]] + d[ends[1]][ends[3]],
          d[ends[0]][ends[3]] + d[ends[1]][ends[2]]));
      }
    }
    s.bound = s.g + extra;
    if (this.oneTree && s.open.length) s.bound = Math.max(s.bound, this.oneTree.bound(s.paths));
    return s.bound;
  }

  stranded(s) {
    const ends = s.ends;
    let tips = this.wide ? 0n : 0;
    for (const i of s.open) {
      const u = ends[i];
      tips |= this.bit[u];
      let options = s.free;
      if (s.open.length === 4 || !s.free) {
        for (const j of s.open) if ((i < 2) !== (j < 2)) options |= this.bit[ends[j]];
      }
      options &= s.allowed[u];
      if (!options || (s.open.length === 4 && u === ends[i ^ 1] && !(options & (options - this.one)))) return true;
    }
    for (let bits = s.free; bits; bits &= bits - this.one) {
      const options = s.allowed[this.firstCity(bits)] & (s.free | tips);
      if (!(options & (options - this.one))) return true;
    }
    // Каждый остаток пути лежит в одной компоненте свободных городов.
    // Проверяем обе пары A—B и возможность покрыть ими все компоненты.
    const components = [];
    let unseen = s.free;
    while (unseen) {
      let front = unseen & -unseen, component = front;
      unseen ^= front;
      while (front) {
        const reached = s.allowed[this.firstCity(front)] & unseen;
        front = (front & (front - this.one)) | reached;
        component |= reached;
        unseen ^= reached;
      }
      components.push(component);
      if (components.length > s.open.length / 2) return true;
    }
    if (s.open.length === 4 && components.length) {
      const through = (a, b, mask) => Boolean(s.allowed[ends[a]] & mask) && Boolean(s.allowed[ends[b]] & mask);
      const direct = (a, b) => Boolean(s.allowed[ends[a]] & this.bit[ends[b]]);
      const [first, second] = components;
      let possible = false;
      for (const b of [2, 3]) {
        if (second !== undefined) {
          possible ||= through(0, b, first) && through(1, 5 - b, second) ||
            through(0, b, second) && through(1, 5 - b, first);
        } else {
          possible ||= through(0, b, first) && direct(1, 5 - b) ||
            through(1, 5 - b, first) && direct(0, b) ||
            Boolean(first & (first - this.one)) && through(0, b, first) && through(1, 5 - b, first);
        }
      }
      if (!possible) return true;
    }
    return this.forcedDeadEnd(s, tips);
  }

  forcedDeadEnd(s, tips) {
    const need = new Uint8Array(this.n), parent = new Int16Array(this.n);
    const members = this.bit.slice(), allowed = s.allowed.slice();
    let active = s.free | tips, missing = s.open.length / 2;
    for (let i = 0; i < this.n; i++) parent[i] = i;
    for (let bits = s.free; bits; bits &= bits - this.one) {
      need[this.firstCity(bits)] = 2;
      missing++;
    }
    for (const side of s.open) need[s.ends[side]]++;
    const root = i => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const merge = (a, b) => {
      a = root(a); b = root(b);
      parent[a] = b;
      members[b] |= members[a];
    };
    if (s.open.length === 4) {
      merge(s.ends[0], s.ends[1]);
      merge(s.ends[2], s.ends[3]);
    } else merge(s.ends[s.open[0]], s.ends[s.open[1]]);
    while (active) {
      let from = -1, to = -1;
      for (let bits = active; bits; bits &= bits - this.one) {
        const city = this.firstCity(bits);
        let options = allowed[city] & active;
        // Соединять концы уже связанного участка можно только последним ребром цикла.
        if (missing > 1) options &= ~members[root(city)];
        const afterOne = options & (options - this.one);
        if (!options || (need[city] === 2 && !afterOne)) return true;
        const extra = need[city] === 1 ? afterOne : afterOne & (afterOne - this.one);
        if (!extra && from === -1) { from = city; to = this.firstCity(options); }
      }
      if (from === -1) return false;
      // При нехватке альтернатив все оставшиеся рёбра вершины обязательны.
      // Проверяем их последствия на копии, не меняя нарисованные ветви.
      missing--;
      if (--need[from] === 0) active &= ~this.bit[from];
      if (--need[to] === 0) active &= ~this.bit[to];
      allowed[from] &= ~this.bit[to];
      allowed[to] &= ~this.bit[from];
      merge(from, to);
      const blocked = this.blockedByEdge(from, to);
      for (let bits = active; bits; bits &= bits - this.one) {
        const city = this.firstCity(bits);
        allowed[city] &= ~blocked[city];
      }
    }
    return false;
  }

  stateKey(s) {
    const e = s.ends;
    if (s.open.length === 2) {
      const x = e[s.open[0]], y = e[s.open[1]];
      return s.free + '/' + Math.min(x, y) + ',' + Math.max(x, y);
    }
    return s.free + '/' + Math.min(e[0], e[1]) + ',' + Math.max(e[0], e[1]) +
      '/' + Math.min(e[2], e[3]) + ',' + Math.max(e[2], e[3]);
  }

  move(s, side, city) {
    const child = this.extend(s, side, city);
    child.ends = s.ends.slice();
    child.ends[side] = city;
    child.open = s.open;
    child.g = s.g + this.dist[s.ends[side]][city];
    return child;
  }

  join(s, a, b) {
    // Ребро встречи записывается в ветвь от A, включая случай прямого ребра A—B.
    const child = this.move(s, a, s.ends[b]);
    if (s.open.length === 4) {
      child.open = [1 - a, 5 - b];
    } else {
      const paths = [0, 1].map(i => child.paths[i].concat(child.paths[i === a ? b : 5 - b].slice(0, -1).reverse()));
      const len = paths.map(path => path.reduce((sum, city, j) => j ? sum + this.dist[path[j - 1]][city] : 0, 0));
      return { paths, len, open: [], g: len[0] + len[1], bound: len[0] + len[1] };
    }
    return child;
  }

  extensionFrame(s) {
    const side = s.open.reduce((i, j) => s.len[i] <= s.len[j] ? i : j), end = s.ends[side];
    const cities = this.near[end].filter(city => (s.free & this.bit[city]) ||
      ((s.open.length === 4 || !s.free) && s.open.some(i => (i < 2) !== (side < 2) && s.ends[i] === city)));
    return { state: s, side, end, cities, index: 0 };
  }

  checkedExtension(s, side, city) {
    if (!(s.allowed[s.ends[side]] & this.bit[city])) return null;
    if (s.free & this.bit[city]) return this.move(s, side, city);
    // Два ещё не вышедших из одной опоры конца взаимозаменяемы.
    const other = s.open.find(i => (i < 2) !== (side < 2) && s.ends[i] === city);
    return this.join(s, Math.min(side, other), Math.max(side, other));
  }

  completedCycle(s) { return s.open.length ? null : s; }
  completionBlocked(s) { return this.stranded(s); }
  queueFor() { return this.queues[0]; }

  processState() {
    this.refillQueues();
    const s = this.next || this.stack.pop() || this.queues[0].take();
    this.next = null;
    this.steps++;
    this.current = s;
    const record = this.best ? this.best.len[0] + this.best.len[1] : Infinity;
    if (!s.open.length) {
      if (s.g < record) { this.best = s; this.bestStep = this.steps; }
      this.note = 'Обе пары встретились. Полный цикл проверен.';
    } else if (this.candidateBound(s) >= record) {
      this.boundCuts++;
      this.note = 'Нижняя оценка достигла рекорда. Переходим к альтернативам.';
    } else {
      const key = this.stateKey(s), previous = this.seen.get(key);
      if (previous !== undefined && (s.g === previous || s.g > previous + 1e-10)) {
        this.duplicateCuts++;
        this.note = 'Такие свободные города и открытые концы уже достигнуты с меньшей или равной длиной.';
      } else if (this.stranded(s)) {
        this.deadEndCuts++;
        this.note = 'Тупик. Доступность городов, пары концов или обязательные рёбра исключают завершение. Возвращаемся к альтернативам.';
      } else {
        this.rememberState(key, s.g, previous);
        if (!this.startCompletion(s)) this.branch(s, record);
      }
    }
    this.recordProgress();
  }

  branch(s, record) {
    const { side, cities } = this.extensionFrame(s), children = [];
    let legal = 0;
    for (const city of cities) {
      const child = this.checkedExtension(s, side, city);
      if (!child) { this.crossingCuts++; continue; }
      child.cost = this.candidateBound(child);
      if (child.cost === Infinity) { this.deadEndCuts++; continue; }
      legal++;
      if (child.cost >= record) this.boundCuts++;
      else children.push(child);
    }
    if (!legal) this.deadEndCuts++;
    this.note = children.length ? 'Развиваем ветвь ' + (side + 1) + ' от ' + (side < 2 ? 'A' : 'B') + '.'
      : legal ? 'Продолжения достигли рекорда. Переходим к альтернативам.' : 'Тупик. Переходим к отложенной развилке.';
    if (this.pending + children.length <= this.queueLimit && !this.stack.length) {
      for (const child of children) this.queues[0].add(child);
    } else {
      for (let i = children.length - 1; i >= 0; i--) this.stack.push(children[i]);
    }
  }
}
