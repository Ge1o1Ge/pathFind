'use strict';

// Любой полный цикл — дерево на городах 1…n−1 плюс два разных ребра города 0.
// Добавки к рёбрам π[i] + π[j] меняют цену каждого цикла ровно на 2Σπ.
class OneTreeBound {
  constructor(dist, upper) {
    const n = this.n = dist.length;
    const largest = Math.max(...dist.map(row => Math.max(...row)));
    // Двоичный масштаб и округление вниз дают нижнюю оценку в целых числах.
    // Суммы до 100 рёбер и поправок помещаются в точное целое Number.
    this.scale = 2 ** Math.min(20, 30 - Math.ceil(Math.log2(largest || 1)));
    this.base = dist.map(row => row.map(d => Math.floor(d * this.scale)));
    this.weight = dist.map(() => new Float64Array(n));
    this.edges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) this.edges.push([i, j]);
    this.parent = new Int16Array(n);
    this.fixedDegree = new Int16Array(n);
    this.rootNeighbor = new Uint8Array(n);
    this.degree = new Int16Array(n);
    const pi = new Float64Array(n);
    let bestPi = pi.slice(), best = -Infinity, rate = 1.5, stale = 0;
    for (let iteration = 0; iteration < 64; iteration++) {
      this.setWeights(pi);
      const value = this.minimum([]);
      if (value > best) { best = value; bestPi = pi.slice(); stale = 0; }
      else if (++stale === 8) { rate /= 2; stale = 0; }
      let norm = 0;
      for (const d of this.degree) norm += (d - 2) ** 2;
      if (!norm || value >= upper * this.scale) break;
      const step = Number.isFinite(upper) ? rate * (upper * this.scale - value) / norm :
        rate * best / (n * (1 + iteration));
      for (let i = 1; i < n; i++) {
        pi[i] = Math.max(-(2 ** 30), Math.min(2 ** 30, pi[i] + Math.round(step * (this.degree[i] - 2))));
      }
    }
    this.setWeights(bestPi);
    this.rootBound = best / this.scale;
  }
  setWeights(pi) {
    this.offset = 2 * pi.reduce((s, v) => s + v, 0);
    const w = this.weight;
    for (const [a, b] of this.edges) w[a][b] = w[b][a] = this.base[a][b] + pi[a] + pi[b];
    this.edges.sort(([a, b], [c, d]) => w[a][b] - w[c][d]);
  }
  find(i) {
    const parent = this.parent;
    while (i !== parent[i]) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  minimum(paths) {
    const { n, parent, fixedDegree, rootNeighbor, degree, weight } = this;
    for (let i = 0; i < n; i++) parent[i] = i;
    fixedDegree.fill(0);
    rootNeighbor.fill(0);
    let count = 0, rootEdges = 0, total = -this.offset;
    // Сначала фиксируем рёбра уже нарисованных ветвей, включая ребро встречи.
    for (const path of paths) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (++fixedDegree[a] > 2 || ++fixedDegree[b] > 2) return Infinity;
      if (a === 0 || b === 0) {
        const other = a || b;
        if (rootNeighbor[other]) return Infinity;
        rootNeighbor[other] = 1;
        rootEdges++;
      } else {
        const u = this.find(a), v = this.find(b);
        if (u === v) return Infinity;
        parent[u] = v;
      }
      total += weight[a][b];
      count++;
    }
    degree.set(fixedDegree);
    for (const [a, b] of this.edges) {
      if (count === n) break;
      if (fixedDegree[a] === 2 || fixedDegree[b] === 2) continue;
      if (a === 0) {
        if (rootEdges === 2 || rootNeighbor[b]) continue;
        rootEdges++;
      } else {
        const u = this.find(a), v = this.find(b);
        if (u === v) continue;
        parent[u] = v;
      }
      degree[a]++; degree[b]++;
      total += weight[a][b];
      count++;
    }
    return count === n ? total : Infinity;
  }
  bound(paths) { return this.minimum(paths) / this.scale; }
}
