'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { RouteSearch, seriesField, routeDistance } = require('./lab.cjs');

const n = Number(process.argv[2] || 30), count = Number(process.argv[3] || 200);
if (!Number.isInteger(n) || n < 10 || n > 30 || !Number.isSafeInteger(count) || count < 1)
  throw Error('Запуск: node tools/compare-native.cjs <10–30 городов> <число полей> [Concorde] [khvastuns]');
const windows = process.platform === 'win32', ext = windows ? '.exe' : '';
const build = path.resolve(__dirname, '../build');
const khvastuns = path.resolve(process.argv[5] || path.join(build, 'khvastuns' + ext));
let concorde = path.resolve(process.argv[4] || path.join(__dirname, '../../concorde'));
if (fs.statSync(concorde, { throwIfNoEntry: false })?.isDirectory()) concorde = path.join(concorde, 'concorde' + ext);
const meter = windows ? path.join(build, 'measure-win.exe') : null;
for (const exe of [khvastuns, concorde, meter].filter(Boolean)) {
  if (!fs.statSync(exe, { throwIfNoEntry: false })?.isFile()) throw Error('Не найдена программа: ' + exe);
}
function writeField(dir, points) {
  const lines = ['NAME: field', 'TYPE: TSP', 'DIMENSION: ' + n, 'EDGE_WEIGHT_TYPE: CEIL_2D', 'NODE_COORD_SECTION'];
  points.forEach(({x, y}, i) => lines.push([i + 1, 1000 * x, 1000 * y].join(' ')));
  fs.writeFileSync(path.join(dir, 'field.tsp'), lines.concat('EOF', '').join('\n'));
}
const checks = ['mainSteps', 'bestStep', 'warmupCount', 'greedyChecks', 'insertionChecks',
  'twoOptChecks', 'boundCuts', 'crossingCuts', 'deadEndCuts'];
function run(dir, name, points) {
  const native = name === 'khvastuns', file = name + '.sol';
  const args = native ? ['field.tsp', file] : ['-s', '1', '-x', '-o', file, 'field.tsp'];
  const exe = native ? khvastuns : concorde;
  const start = performance.now();
  const result = spawnSync(meter || exe, meter ? [exe, ...args] : args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  let wallMs = performance.now() - start, cpuMs = null;
  if (result.error) throw result.error;
  let log = result.stdout.trim();
  if (windows) {
    const clock = /\s*OS_TIME ([\d.e+-]+) ([\d.e+-]+)$/.exec(log);
    if (!clock) throw Error(name + ': нет показаний таймера Windows. ' + result.stderr + log.slice(-1000));
    wallMs = Number(clock[1]);
    cpuMs = Number(clock[2]);
    log = log.slice(0, clock.index).trim();
  }
  if (result.status !== 0 && !(windows && !native && result.status === 255)) throw Error(name + ': ' + result.stderr + log);
  let stats, length, internalMs;
  if (native) {
    stats = JSON.parse(log);
    length = stats.length;
    internalMs = stats.solveMs;
  } else {
    const proof = /Optimal Solution:\s*(\d+(?:\.\d+)?)/.exec(log);
    const elapsed = /Total Running Time:\s*([\d.]+)/.exec(log);
    if (!proof || !elapsed) throw Error('Concorde не подтвердил оптимум: ' + log);
    length = Number(proof[1]);
    internalMs = Number(elapsed[1]) * 1000;
  }
  const [size, ...tour] = fs.readFileSync(path.join(dir, file), 'utf8').trim().split(/\s+/).map(Number);
  assert.ok(size === n && tour.length === n && new Set(tour).size === n && tour.every(i => Number.isInteger(i) && i >= 0 && i < n));
  const actual = tour.reduce((sum, city, i) => sum + routeDistance(points[city], points[tour[(i + 1) % n]], true), 0);
  assert.equal(actual, length);
  return { length, wallMs, cpuMs, internalMs, tour, stats };
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = v => +v.toFixed(3);
  return { mean: round(values.reduce((a,b) => a+b, 0) / count),
    median: round((sorted[(count - 1) >> 1] + sorted[count >> 1]) / 2), max: round(sorted.at(-1)) };
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khvastuns-native-'));
const rows = [];
try {
  for (let i = 0; i < count; ++i) {
    const points = seriesField(n, i), row = { field: i + 1 };
    const fieldDir = path.join(dir, String(i + 1));
    fs.mkdirSync(fieldDir);
    writeField(fieldDir, points);
    for (const name of i % 2 ? ['Concorde', 'khvastuns'] : ['khvastuns', 'Concorde']) row[name] = run(fieldDir, name, points);
    const js = new RouteSearch(points, undefined, true);
    // В C++ пока нет периодических достроек: сверяем с тем же режимом JavaScript.
    js.completionInterval = 0;
    js.advance();
    const native = row.khvastuns;
    assert.equal(native.length, row.Concorde.length, 'Оптимум на поле ' + row.field);
    assert.deepEqual(native.tour, js.best.paths[0].concat(js.best.paths[1].slice(1,-1).reverse()), 'Маршрут JS на поле ' + row.field);
    for (const key of checks) assert.equal(native.stats[key], js[key], key + ' на поле ' + row.field);
    rows.push(row);
    if (rows.length % 25 === 0) console.log('Проверено полей: %d/%d', rows.length, count);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
const table = {};
for (const name of ['khvastuns', 'Concorde']) {
  table[name] = { wallMs: summary(rows.map(r => r[name].wallMs)), internalMs: summary(rows.map(r => r[name].internalMs)) };
  if (windows) table[name].cpuMs = summary(rows.map(r => r[name].cpuMs));
}
const wins = rows.filter(r => r.khvastuns.wallMs < r.Concorde.wallMs).length;
console.log('Нативный khvastuns и его контроль JS: без периодических достроек.');
console.log(JSON.stringify({ n, count, wallWinsKhvastuns: wins, table }, null, 2));
fs.mkdirSync(build, { recursive: true });
const output = path.join(build, 'native-' + n + 'x' + count + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
fs.writeFileSync(output, JSON.stringify({ n, count, metric: 'CEIL_2D, coordinates × 1000', wallWinsKhvastuns: wins, table, rows }, null, 2));
console.log(output);
