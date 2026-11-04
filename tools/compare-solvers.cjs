'use strict';

const { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { RouteSearch, seriesField, routeDistance } = require('./lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

const [size = '18', number = '6', concordePath] = process.argv.slice(2);
const n = Number(size), count = Number(number), integer = !!concordePath;
if (!Number.isInteger(n) || n < 3 || n > (integer ? 30 : 22) || !Number.isSafeInteger(count) || count < 1) {
  throw new Error('Запуск: node tools/compare-solvers.cjs <города: 3–22, с Concorde до 30> <число полей> [путь к Concorde]');
}
function findConcorde(input) {
  const path = resolve(input);
  const info = statSync(path, { throwIfNoEntry: false });
  if (info?.isFile()) return path;
  const name = process.platform === 'win32' ? 'concorde.exe' : 'concorde';
  if (info?.isDirectory()) {
    for (const file of [join(path, name), join(path, 'concorde', name)]) {
      if (statSync(file, { throwIfNoEntry: false })?.isFile()) return file;
    }
    console.error('В папке %s и её подпапке concorde не найден %s.', path, name);
  } else {
    console.error('Путь к Concorde не найден: %s', path);
  }
  console.error('Передай третьим аргументом путь к файлу %s или к папке с ним.', name);
  process.exit(1);
}
const exe = integer ? findConcorde(concordePath) : null;
const matrix = points => points.map(p => points.map(q => routeDistance(p, q, integer)));
function concorde(dist) {
  const dir = mkdtempSync(join(tmpdir(), 'khvastuns-field-'));
  try {
    const header = ['NAME: field', 'TYPE: TSP', 'DIMENSION: ' + n, 'EDGE_WEIGHT_TYPE: EXPLICIT',
      'EDGE_WEIGHT_FORMAT: LOWER_DIAG_ROW', 'EDGE_WEIGHT_SECTION'];
    writeFileSync(join(dir, 'field.tsp'), header.concat(dist.map((r, i) => r.slice(0, i + 1).join(' ')), 'EOF').join('\n') + '\n');
    const result = spawnSync(exe, ['-s', '1', '-x', '-o', 'tour.sol', 'field.tsp'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    const log = result.stdout + '\n' + result.stderr;
    const proof = /Optimal Solution:\s*(\d+(?:\.\d+)?)/i.exec(log);
    const finished = /Total Running Time:\s*([\d.]+)/i.exec(log);
    // Сборка для Cygwin иногда возвращает 255 и при доказанном оптимуме.
    // Требуем штатный финал, явный оптимум и отдельно сверяем тур из нового файла.
    if ((!proof || !finished) || (result.status !== 0 && !(process.platform === 'win32' && result.status === 255))) {
      throw new Error('Concorde: код ' + result.status + ', сигнал ' + result.signal + ': ' + log.slice(-1500));
    }
    const [size, ...tour] = readFileSync(join(dir, 'tour.sol'), 'utf8').trim().split(/\s+/).map(Number);
    if (size !== n) throw new Error('Неверная размерность решения Concorde');
    return { length: Number(proof[1]), tour, reportedMs: Number(finished[1]) * 1000 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const solvers = {
  khvastuns(points) {
    const run = new RouteSearch(points, undefined, integer);
    run.advance();
    const [out, back] = run.best.paths;
    return { length: run.best.len[0] + run.best.len[1], tour: out.concat(back.slice(1, -1).reverse()) };
  }
};
if (n <= 22) solvers['Held–Karp'] = points => heldKarp(matrix(points));
if (exe) solvers.Concorde = points => concorde(matrix(points));

const names = Object.keys(solvers), times = Object.fromEntries(names.map(name => [name, []]));
const nativeTimes = [];
// Прогрев JS отдельно от замеров. Concorde при каждом запуске получает новый процесс.
const warm = seriesField(14, count + 1);
solvers.khvastuns(warm);
if (solvers['Held–Karp']) solvers['Held–Karp'](warm);
for (let field = 0; field < count; field++) {
  const points = seriesField(n, field), d = matrix(points);
  let opt;
  for (let j = 0; j < names.length; j++) {
    const name = names[(j + field) % names.length], start = performance.now();
    const { length, tour, reportedMs } = solvers[name](points);
    times[name].push(performance.now() - start);
    if (reportedMs !== undefined) nativeTimes.push(reportedMs);
    const valid = tour.length === n && tour.every(i => Number.isInteger(i) && i >= 0 && i < n) && new Set(tour).size === n;
    const actual = valid ? tour.reduce((s, city, i) => s + d[city][tour[(i + 1) % n]], 0) : NaN;
    const tolerance = integer ? 0 : 1e-8;
    if (!Number.isFinite(actual) || !Number.isFinite(length) || Math.abs(actual - length) > tolerance ||
        (opt !== undefined && Math.abs(length - opt) > tolerance)) throw new Error(name + ': расхождение на поле №' + (field + 1));
    opt = length;
  }
}
console.log('Городов: %d. Совпавших оптимумов: %d/%d. Веса: %s.', n, count, count, integer ? 'ceil(1000 × расстояние)' : 'без округления');
console.table(names.map(name => {
  const t = times[name].sort((a, b) => a - b), round = x => +x.toFixed(3);
  return { алгоритм: name, среднее_мс: round(t.reduce((s, x) => s + x, 0) / count),
    медиана_мс: round((t[(count - 1) >> 1] + t[count >> 1]) / 2), максимум_мс: round(t.at(-1)) };
}));
if (exe) console.log('Время Concorde в таблице включает обмен файлами и запуск процесса. Внутренний таймер Concorde: в среднем %s мс (разрешение 10 мс).',
  (nativeTimes.reduce((s, t) => s + t, 0) / count).toFixed(1));
