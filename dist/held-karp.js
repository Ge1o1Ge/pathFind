'use strict';

// В слое конечного города j храним только подмножества, содержащие j.
function dpIndex(mask, j, bit, size) {
  return j * size + ((mask & (bit - 1)) | ((mask >> 1) & -bit));
}

class HeldKarpTable {
  constructor(dist) {
    const n = dist.length;
    if (n < 3 || n > 22) throw new RangeError('Этот эталон Хелда — Карпа рассчитан на 3–22 города.');
    this.dist = dist;
    this.size = 1 << (n - 2);
    this.full = (1 << (n - 1)) - 1;
    this.dp = new Float64Array((n - 1) * this.size);
    this.mask = this.ends = 1;
  }
  fill(limit) {
    const { dist, dp, size, full } = this;
    let mask = this.mask, ends = this.ends, steps = 0;
    while (mask <= full) {
      const bit = ends & -ends, j = 31 - Math.clz32(bit), rest = mask ^ bit;
      let best = rest ? Infinity : dist[0][j + 1];
      for (let bits = rest; bits; bits &= bits - 1) {
        const b = bits & -bits, i = 31 - Math.clz32(b);
        best = Math.min(best, dp[dpIndex(rest, i, b, size)] + dist[i + 1][j + 1]);
      }
      dp[dpIndex(mask, j, bit, size)] = best;
      ends ^= bit;
      if (!ends) ends = ++mask;
      if (++steps >= limit) break;
    }
    this.mask = mask;
    this.ends = ends;
    return steps;
  }
  tour() {
    const { dist, dp, size } = this;
    let mask = this.full, end = 0, length;
    const reverse = [];
    while (mask) {
      let best = Infinity, chosen;
      for (let bits = mask; bits; bits &= bits - 1) {
        const bit = bits & -bits, i = 31 - Math.clz32(bit);
        const cost = dp[dpIndex(mask, i, bit, size)] + dist[i + 1][end];
        if (cost < best) { best = cost; chosen = i; }
      }
      if (end === 0) length = best;
      end = chosen + 1;
      reverse.push(end);
      mask ^= 1 << chosen;
    }
    return { length, tour: [0, ...reverse.reverse()] };
  }
}

function heldKarp(dist) {
  const table = new HeldKarpTable(dist);
  table.fill(Infinity);
  return table.tour();
}

// Held–Karp возвращает полный тур. Разбиваем его на те же два пути A—B для карты и статистики.
class HeldKarpSearch {
  constructor(points) {
    const start = performance.now();
    this.algorithm = 'held';
    this.n = points.length;
    this.dist = points.map(p => points.map(q => routeDistance(p, q)));
    this.a = 0; this.b = 1;
    for (let i = 0; i < this.n; i++) for (let j = i + 1; j < this.n; j++) {
      if (this.dist[i][j] > this.dist[this.a][this.b]) { this.a = i; this.b = j; }
    }
    this.current = { paths: [[this.a], [this.b]], len: [0, 0] };
    this.history = [];
    this.steps = this.searchMs = 0;
    this.done = false;
    this.note = 'Шаг заполняет одно состояние таблицы Held–Karp.';
    if (this.n > 22) this.error = 'Held–Karp доступен до 22 городов. Уменьши размер поля.';

    this.preparationMs = performance.now() - start;
  }
  get mainSteps() { return this.steps; }
  get totalMs() { return this.preparationMs + this.searchMs; }
  finish(tour, length) {
    if (tour.length !== this.n || new Set(tour).size !== this.n ||
        !tour.every(i => Number.isInteger(i) && i >= 0 && i < this.n)) throw new Error('Некорректный тур решателя.');
    const sum = tour.reduce((v, i, j) => v + this.dist[i][tour[(j + 1) % this.n]], 0);
    if (!Number.isFinite(length) || Math.abs(sum - length) > 1e-8) throw new Error('Длина тура расходится с ответом решателя.');
    const pivot = tour.indexOf(this.a), cycle = tour.slice(pivot).concat(tour.slice(0, pivot)), b = cycle.indexOf(this.b);
    const paths = [cycle.slice(0, b + 1), [this.a, ...cycle.slice(b).reverse()]];
    const len = paths.map(p => p.reduce((v, i, j) => j ? v + this.dist[p[j - 1]][i] : 0, 0));
    this.best = this.current = { paths, len };
    this.done = true;
    this.note = 'Получен оптимальный цикл. Посещение городов и длина проверены по рёбрам.';
  }
  advance(limit = Infinity, sliceMs = Infinity) {
    if (limit < 1 || this.done || this.error) return 0;
    const start = performance.now(), before = this.steps;
    if (!this.table) this.table = new HeldKarpTable(this.dist);
    do {
      const batch = Math.min(limit - (this.steps - before), sliceMs === Infinity ? Infinity : 128);
      this.steps += this.table.fill(batch);
      if (this.table.mask > this.table.full) {
        const { tour, length } = this.table.tour();
        this.finish(tour, length);
        this.table = null;
        break;
      }
    } while (this.steps - before < limit && (sliceMs === Infinity || performance.now() - start < sliceMs));
    this.searchMs += performance.now() - start;
    return this.steps - before;
  }
  step() { return this.advance(1); }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { heldKarp };
