'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouteSearch, seriesField, routeDistance, measureRun } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

function checkTour(run, d, optimum) {
  const [out, back] = run.best.paths, tour = out.concat(back.slice(1, -1).reverse());
  assert.deepEqual([out[0], back[0], out.at(-1), back.at(-1)], [run.a, run.a, run.b, run.b]);
  assert.equal(tour.length, d.length);
  assert.equal(new Set(tour).size, d.length);
  const length = tour.reduce((sum, i, j) => sum + d[i][tour[(j + 1) % d.length]], 0);
  assert.ok(Math.abs(length - optimum) < 1e-8);
  assert.ok(Math.abs(length - run.best.len[0] - run.best.len[1]) < 1e-8);
}

test('Встречный поиск с разминкой и без неё сохраняет оптимум в обеих метриках', () => {
  for (let n = 3; n <= 13; n++) {
    const fields = Array.from({ length: 16 }, (_, i) => seriesField(n, i));
    fields.push(Array.from({ length: n }, (_, x) => ({ x, y: 0 })));
    fields.push(Array.from({ length: n }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) })));
    for (const points of fields) for (const integer of [false, true]) {
      const d = points.map(p => points.map(q => routeDistance(p, q, integer)));
      const optimum = heldKarp(d).length;
      for (const limit of [0, n - 2]) {
        const run = createRouteSearch('hvastuns-4', points, limit, integer);
        const seed = run.best;
        while (!run.done) {
          assert.ok(run.bound <= optimum + 1e-8);
          run.advance(17);
        }
        checkTour(run, d, optimum);
        if (seed && seed.len[0] + seed.len[1] === run.bound) assert.equal(seed, run.best);
      }
    }
  }
});

test('Ветвь 3 может встретиться с 1 или 2, до и после посещения последнего города', () => {
  const line = Array.from({ length: 8 }, (_, x) => ({ x, y: 0 }));
  const run = createRouteSearch('hvastuns-4', line, 0), root = run.next;
  const cities = run.near[run.a].filter(i => root.free & run.bit[i]);
  let s = run.move(root, 0, cities[0]);
  s = run.move(s, 1, cities[1]);
  run.branch(s, Infinity);
  const meetings = run.queues[0].items.filter(child => child.open.length === 2);
  assert.deepEqual(meetings.map(child => child.open.join(',')).sort(), ['0,3', '1,3']);
  for (const a of [0, 1]) {
    const joined = run.join(s, a, 2);
    assert.deepEqual(joined.open, [1 - a, 3]);
    assert.ok(joined.free);
    let current = joined;
    for (const city of cities.slice(2)) current = run.move(current, 3, city);
    const closed = run.join(current, ...current.open);
    assert.equal(new Set(closed.paths.flat()).size, 8);
    assert.equal(closed.paths.flat().length, 10);
  }
  const direct = run.join(root, 0, 2);
  assert.deepEqual(direct.paths[0], [run.a, run.b]);
  const trapped = { ...s, allowed: s.allowed.slice() };
  trapped.allowed[run.b] = 0;
  assert.ok(run.stranded(trapped));
});

test('Четыре ветви охватывают старшие биты и сохраняют возможность продолжить с того же шага', () => {
  const points = seriesField(100, 0), run = createRouteSearch('hvastuns-4', points, 0);
  run.advance(3);
  assert.equal(run.steps, 3);
  assert.equal(run.current.paths.length, 4);
  run.step();
  assert.equal(run.steps, 4);
  const line = Array.from({ length: 100 }, (_, x) => ({ x, y: 0 }));
  const warm = createRouteSearch('hvastuns-4', line);
  assert.ok(warm.done);
  assert.equal(warm.bound, 198);
});

test('Пошаговый Held–Karp учитывает каждое состояние один раз и сохраняет тот же цикл', () => {
  const points = seriesField(12, 3);
  const run = createRouteSearch('held', points);
  run.step();
  assert.equal(run.mainSteps, 1);
  while (!run.done) run.advance(19);
  checkTour(run, run.dist, heldKarp(run.dist).length);
  assert.equal(measureRun(run).work.mainSteps, 11 * 2 ** 10);
  assert.equal(measureRun(run).work.warmupCycles, undefined);
  assert.ok(createRouteSearch('held', seriesField(23, 0)).error);
});
test('Тупик со скриншота отсекается за один шаг с сохранением альтернативы', () => {
  // Координаты и ветви восстановлены по сетке скриншота с городами A·49 и B·76.
  const points = [
    [18, 39], [89, 18], [53, 9], [18, 7], [69, 36], [42, 34], [73, 17], [89, 45], [5, 28], [31, 40],
    [34, 17], [89, 32], [19, 26], [52, 24], [5, 42], [6, 14], [71, 45], [77, 4], [39, 5], [49, 44],
    [79, 38], [48, 17], [11, 44], [32, 30], [42, 20], [41, 28], [61, 30], [96, 11], [27, 24], [80, 31],
    [78, 11], [61, 17], [27, 5], [48, 38], [37, 43], [89, 8], [50, 31], [49, 4], [82, 17], [58, 4],
    [24, 14], [69, 8], [24, 34], [94, 39], [95, 16], [6, 39], [12, 22], [78, 23], [4, 5], [16, 19],
    [37, 37], [64, 21], [46, 26], [88, 25], [32, 10], [10, 28], [57, 38], [55, 34], [26, 39], [29, 47],
    [71, 30], [38, 13], [18, 33], [83, 4], [76, 45], [54, 46], [35, 25], [41, 45], [65, 26], [11, 35],
    [77, 18], [66, 3], [4, 22], [29, 19], [67, 16], [96, 47], [63, 43], [58, 47], [63, 11], [33, 45],
    [20, 47], [59, 23], [43, 14], [96, 26], [9, 19], [95, 35], [47, 10], [27, 43], [64, 35], [84, 47],
    [37, 20], [20, 3], [75, 34], [64, 46], [85, 37], [96, 6], [92, 4], [15, 45], [28, 12], [38, 33]
  ].map(([x, y]) => ({ x, y }));
  const paths = [
    [49, 16, 85, 73, 9, 56, 70, 46, 15, 23, 98, 81, 88, 59, 43, 24, 67, 26],
    [49, 4, 92, 33, 41, 99, 55, 62, 83, 87, 3, 40, 79, 42, 31],
    [76, 44, 86, 12, 95, 21, 30, 93, 61, 5, 89, 27, 69, 52, 75, 7, 71, 48, 54],
    [76, 8, 90, 65, 17, 94, 77, 78, 66, 20, 34, 6, 100, 51, 35, 68, 60, 80]
  ];
  const run = createRouteSearch('hvastuns-4', points, 0);
  const root = run.next;
  let state = root;
  for (let side = 0; side < 4; side++) for (const city of paths[side].slice(1)) {
    state = run.move(state, side, city - 1);
  }
  const before = state.allowed.slice();
  assert.ok(run.stranded(state));
  assert.deepEqual(state.allowed, before);
  run.next = state;
  run.queues[0].add({ ...root, cost: 0 });
  // Проверяем именно геометрическое отсечение, независимо от нижней оценки длины.
  run.candidateBound = () => 0;
  run.step();
  assert.equal(run.deadEndCuts, 1);
  assert.equal(run.pending, 1);
  assert.equal(run.queues[0].first.free, root.free);
  assert.equal(run.mainSteps, 1);
});

test('Обязательные ходы сохраняют продолжения известного оптимального цикла', () => {
  for (let n = 3; n <= 14; n++) for (let field = 0; field < 10; field++) {
    const points = seriesField(n, field);
    const d = points.map(p => points.map(q => routeDistance(p, q)));
    const { tour } = heldKarp(d);
    const run = createRouteSearch('hvastuns-4', points, 0), pivot = tour.indexOf(run.a);
    const cycle = tour.slice(pivot).concat(tour.slice(0, pivot));
    const split = cycle.indexOf(run.b);
    const paths = [cycle.slice(0, split + 1), [run.a, ...cycle.slice(split).reverse()]];
    for (const swap of [false, true]) for (let phase = 0; phase < 4; phase++) {
      let state = run.next;
      for (let side = 0; side < 2; side++) {
        const inner = paths[side].slice(1, -1);
        const fromA = (field + phase) % (inner.length + 1);
        const fromB = phase % (inner.length - fromA + 1);
        for (const city of inner.slice(0, fromA)) state = run.move(state, side, city);
        const other = 2 + (swap ? 1 - side : side);
        for (const city of inner.slice(inner.length - fromB).reverse()) state = run.move(state, other, city);
      }
      assert.equal(run.stranded(state), false);
    }
  }
});
