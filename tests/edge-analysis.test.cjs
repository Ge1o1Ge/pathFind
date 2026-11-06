'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EdgeAnalysis, seriesField } = require('../tools/lab.cjs');

test('Штраф за пересечения учитывает только строго более короткие рёбра', () => {
  const points = [[-5, 0], [5, 0], [0, -1], [0, 1], [-10, -10], [10, -10], [10, 10], [-10, 10]];
  const run = new EdgeAnalysis(points.map(([x, y]) => ({ x, y })));
  run.advance();
  const long = run.edges[run.index[0][1]], short = run.edges[run.index[2][3]];
  assert.ok(!long.excluded && !short.excluded);
  assert.ok(long.crossings > 1 && short.crossings > 0);
  assert.equal(long.shorterCrossings, 1);
  assert.equal(long.burden, short.weight);
  assert.equal(short.shorterCrossings, 0);
  assert.equal(short.burden, 0);
  assert.equal(short.score, Math.exp(-short.burden));
  assert.equal(run.report().edges[run.index[0][1]].shorterCrossings, 1);

  const square = new EdgeAnalysis([[0, 0], [2, 0], [2, 2], [0, 2]].map(([x, y]) => ({ x, y })));
  square.advance();
  for (const [a, b] of [[0, 2], [1, 3]]) {
    const e = square.edges[square.index[a][b]];
    assert.equal(e.crossings, 1);
    assert.equal(e.shorterCrossings, 0);
    assert.equal(e.burden, 0);
    assert.ok(e.excluded);
  }
});

test('Диагонали оболочки исключены, её стороны и длинное граничное ребро сохранены', () => {
  for (const points of [[[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 0], [100, 0], [70, 1], [20, 1]]]) {
    const run = new EdgeAnalysis(points.map(([x, y]) => ({ x, y })));
    run.advance();
    for (const [a, b] of [[0, 2], [1, 3]]) assert.equal(run.edges[run.index[a][b]].score, 0);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) assert.ok(run.edges[run.index[a][b]].score > 0);
    assert.equal(run.best, null);
  }
});

test('Доказанные нули не удаляют рёбра ни одного оптимального тура на малых полях', () => {
  const fields = Array.from({ length: 24 }, (_, i) => seriesField(5 + i % 3, i));
  fields.push(Array.from({ length: 7 }, (_, x) => ({ x, y: 0 })));
  fields.push(Array.from({ length: 6 }, (_, i) => ({ x: i % 3, y: 0 })));
  fields.push(Array.from({ length: 5 }, () => ({ x: 0, y: 0 })));
  for (const points of fields) {
    const run = new EdgeAnalysis(points);
    run.advance();
    let optimal = Infinity, tours = [];
    function enumerate(path, free, length) {
      if (!free.length) {
        length += run.dist[path.at(-1)][0];
        if (length < optimal - 1e-8) { optimal = length; tours = [path]; }
        else if (Math.abs(length - optimal) <= 1e-8) tours.push(path);
        return;
      }
      for (const city of free) enumerate([...path, city], free.filter(i => i !== city), length + run.dist[path.at(-1)][city]);
    }
    enumerate([0], points.map((_, i) => i).slice(1), 0);
    for (const tour of tours) for (let i = 0; i < points.length; i++) {
      const e = run.edges[run.index[tour[i]][tour[(i + 1) % points.length]]];
      assert.ok(!e.excluded);
      assert.ok(e.bound <= optimal + 1e-8);
    }
    const { scores, mask } = run.report();
    for (let i = 0; i < points.length; i++) for (let j = 0; j < points.length; j++) {
      assert.equal(scores[i][j], scores[j][i]);
      assert.equal(mask[i][j], mask[j][i]);
      if (i !== j) assert.equal(scores[i][j] === 0, mask[i][j] === 0);
    }
  }
});

test('Счётчики покрывают все пары; пауза и пошаговый расчёт не меняют оценок', async () => {
  const points = seriesField(20, 1), run = new EdgeAnalysis(points), whole = new EdgeAnalysis(points);
  run.step();
  assert.equal(run.processed, 1);
  assert.equal(run.edges[1].score, null);
  const paused = [run.processed, run.pairVisits, run.totalMs];
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual([run.processed, run.pairVisits, run.totalMs], paused);
  while (!run.done) run.advance(3, 1);
  whole.advance();
  assert.deepEqual(run.report().scores, whole.report().scores);
  const n = points.length, m = n * (n - 1) / 2;
  assert.equal(run.pairVisits + run.spatialSkips, m * (m - 1) / 2);
  assert.equal(run.crossingChecks + run.spatialSkips, n * (n - 1) * (n - 2) * (n - 3) / 8);
  assert.ok(run.spatialSkips > 0);
  assert.equal(run.radiusChecks, 0);
  assert.equal(run.orientationChecks, m * n);
  assert.equal(run.degreeChecks, m * n);
  assert.equal(run.totalMs, run.preparationMs + run.analysisMs);
  assert.ok(run.analysisMs > 0);
  assert.ok(run.edges.every(e => Number.isFinite(e.score) && e.score >= 0 && e.score <= 1));
  assert.equal(run.step(), 0);
});

test('Длинное пересекающее ребро с дальними концами сохраняется в проверке тупика', () => {
  const run = new EdgeAnalysis([[-1, 0], [1, 0], [0, -100], [0, 100]].map(([x, y]) => ({ x, y })));
  run.advance();
  const e = run.edges[run.index[0][1]];
  assert.equal(e.shorterCrossings, 0);
  assert.equal(e.crossings, 1);
  assert.ok(e.excluded);
});

test('Пространственный фильтр и ранние остановки совпадают с полным перебором', () => {
  const fields = Array.from({ length: 24 }, (_, i) => seriesField(5 + i, i));
  fields.push(seriesField(70, 1));
  fields.push(Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) })));
  fields.push(Array.from({ length: 7 }, (_, i) => ({ x: i % 4, y: 0 })));
  let spatialSkips = 0;
  for (const points of fields) {
    const run = new EdgeAnalysis(points);
    run.advance();
    spatialSkips += run.spatialSkips;
    // Независимый полный просмотр: все рёбра, сортировка всех соседей и обход полного графа.
    for (const e of run.edges) {
      const adjacent = points.map(() => []);
      let crossings = 0, shorter = 0, burden = 0;
      for (const f of run.edges) {
        if (f === e) continue;
        if (run.conflicts(e, f)) {
          crossings++;
          if (f.length < e.length) { shorter++; burden += f.weight; }
        } else { adjacent[f.a].push(f.b); adjacent[f.b].push(f.a); }
      }
      let sum = 0, excluded = false;
      for (let i = 0; i < points.length; i++) {
        const need = i === e.a || i === e.b ? 1 : 2;
        const lengths = adjacent[i].map(j => run.dist[i][j]).sort((a, b) => a - b);
        if (lengths.length < need) { excluded = true; sum = Infinity; }
        else sum += lengths.slice(0, need).reduce((s, v) => s + v, 0);
      }
      const first = points.findIndex((_, i) => i !== e.a && i !== e.b), reached = new Set([first]), queue = [first];
      for (let i = 0; i < queue.length; i++) for (const j of adjacent[queue[i]]) {
        if (j !== e.a && j !== e.b && !reached.has(j)) { reached.add(j); queue.push(j); }
      }
      excluded ||= reached.size !== points.length - 2;
      const bound = e.length + sum / 2, extra = Math.max(0, bound - run.baseBound);
      const score = excluded ? 0 : Math.max(Number.MIN_VALUE, Math.exp(-burden));
      assert.equal(e.excluded, excluded);
      assert.equal(e.crossings, crossings);
      assert.equal(e.shorterCrossings, shorter);
      assert.equal(e.bound, bound);
      assert.ok(Math.abs(e.burden - burden) <= 1e-12 * Math.max(1, burden));
      assert.ok(Math.abs(e.score - score) <= 1e-12 * Math.max(Number.MIN_VALUE, score));
    }
  }
  assert.ok(spatialSkips > 0);
});

test('Пары с обработанным городом не проверяются снова; конфликты записаны симметрично', () => {
  const run = new EdgeAnalysis(seriesField(12, 10)), checked = new Set();
  const original = run.conflicts.bind(run);
  run.conflicts = (e, f) => {
    const key = [e.id, f.id].sort((a, b) => a - b).join(':');
    assert.ok(!checked.has(key));
    checked.add(key);
    assert.ok(f.a >= e.a);
    return original(e, f);
  };
  run.advance();
  for (const e of run.edges) {
    const conflicts = run.conflictIds(e.id);
    assert.equal(conflicts.length, e.crossings);
    for (const id of conflicts) assert.ok(run.conflictIds(id).includes(e.id));
  }
});
