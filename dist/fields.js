'use strict';

function randomField(count, random = Math.random) {
  const cities = [];
  while (cities.length < count) {
    let pick, largest = -1;
    for (let trial = 0; trial < 8; trial++) {
      const p = { x: 4 + Math.floor(random() * 93), y: 3 + Math.floor(random() * 45) };
      const gap = cities.reduce((min, q) => Math.min(min, (p.x - q.x) ** 2 + (p.y - q.y) ** 2), Infinity);
      if (gap > largest) { pick = p; largest = gap; }
    }
    if (largest > 0) cities.push(pick);
  }
  return cities;
}

function seriesField(n, index) {
  // Номер опыта задаёт поле: возобновление серии не заменяет тяжёлый пример другим.
  return randomField(n, fieldRandom(seriesSeed(n, index)));
}

function seriesSeed(n, index) {
  return (Math.imul(n, 0x85ebca6b) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

function fieldRandom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const FIELD_TYPES = { uniform: 'Обычное поле', clusters: 'Несколько скоплений', outlier: 'Облако и удалённый город',
  convex: 'Выпуклый контур', grid: 'Решётка', custom: 'Свои координаты' };

function normalizeFieldProfile(value = { type: 'uniform' }) {
  if (!value || !Object.hasOwn(FIELD_TYPES, value.type)) throw new Error('Неизвестный тип поля.');
  const profile = { type: value.type };
  const number = (key, fallback, min, max, integer = false) => {
    const v = value[key] ?? fallback;
    if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new Error('Некорректный параметр поля: ' + key);
    profile[key] = v;
  };
  if (value.type === 'clusters') number('groups', 2, 2, 8, true);
  if (value.type === 'clusters' || value.type === 'outlier') number('separation', 10, 2, 1000);
  if (value.type === 'convex') number('height', 1, 0.01, 1);
  if (value.type === 'grid') number('columns', 0, 0, 100, true);
  return profile;
}

function fieldProfileKey(profile) {
  const normalized = normalizeFieldProfile(profile);
  return normalized.type === 'uniform' ? '' : btoa(JSON.stringify(normalized)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fieldProfileLabel(profile) {
  const p = normalizeFieldProfile(profile);
  return FIELD_TYPES[p.type] + (p.type === 'clusters' ? ' · групп до ' + p.groups : '') +
    (p.separation ? ' · разнос ' + p.separation : '') + (p.height ? ' · высота ' + p.height : '') +
    (p.type === 'grid' ? ' · столбцы ' + (p.columns || 'авто') : '');
}

function generateField(n, seed, profile = { type: 'uniform' }) {
  const p = normalizeFieldProfile(profile);
  if (!Number.isInteger(n) || n < 3 || n > 100) throw new Error('Нужно от 3 до 100 городов.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed должен быть целым числом от 0 до 4294967295.');
  if (p.type === 'custom') throw new Error('Для своего поля вставь код или координаты.');
  const random = fieldRandom(seed);
  if (p.type === 'uniform') return randomField(n, random);
  const shuffle = points => {
    for (let i = points.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [points[i], points[j]] = [points[j], points[i]]; }
    return points;
  };
  if (p.type === 'convex') {
    const phase = random() * 2 * Math.PI;
    return shuffle(Array.from({ length: n }, (_, i) => {
      const angle = phase + (i + (random() - 0.5) * 0.6) * 2 * Math.PI / n;
      return { x: 50 + 45 * Math.cos(angle), y: 25 + 20 * p.height * Math.sin(angle) };
    }));
  }
  if (p.type === 'grid') {
    const cols = Math.min(n, p.columns || Math.ceil(Math.sqrt(n))), rows = Math.ceil(n / cols);
    const step = Math.min(cols > 1 ? 90 / (cols - 1) : Infinity, rows > 1 ? 40 / (rows - 1) : Infinity);
    // Полная решётка меняет только нумерацию; в неполной seed выбирает занятые узлы.
    return shuffle(Array.from({ length: cols * rows }, (_, i) => ({
      x: 50 + (i % cols - (cols - 1) / 2) * step, y: 25 + (Math.floor(i / cols) - (rows - 1) / 2) * step
    }))).slice(0, n);
  }
  const groups = p.type === 'outlier' ? 2 : Math.min(p.groups, n);
  const radius = p.separation / (2 * Math.sin(Math.PI / groups));
  const centers = Array.from({ length: groups }, (_, i) => ({ x: radius * Math.cos(2 * Math.PI * i / groups),
    y: groups === 2 ? 0 : radius * Math.sin(2 * Math.PI * i / groups) }));
  const points = Array.from({ length: n }, (_, i) => {
    const group = p.type === 'outlier' ? Number(i === n - 1) : Math.floor(i * groups / n);
    return { x: centers[group].x + random() - 0.5, y: centers[group].y + random() - 0.5 };
  });
  const minX = Math.min(...points.map(q => q.x)), maxX = Math.max(...points.map(q => q.x));
  const minY = Math.min(...points.map(q => q.y)), maxY = Math.max(...points.map(q => q.y));
  const scale = Math.min(92 / (maxX - minX || 1), 44 / (maxY - minY || 1));
  return points.map(q => ({ x: 50 + (q.x - (minX + maxX) / 2) * scale, y: 25 + (q.y - (minY + maxY) / 2) * scale }));
}

function profileSeriesField(n, index, profile) {
  return generateField(n, seriesSeed(n, index), profile);
}

function validateFieldPoints(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 100) throw new Error('В поле должно быть 3–100 координат.');
  return points.map(p => {
    const x = Array.isArray(p) ? p[0] : p?.x, y = Array.isArray(p) ? p[1] : p?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) throw new Error('Координаты должны быть конечными числами в пределах ±1 000 000.');
    return { x, y };
  });
}

function encodeField(profile, n, seed, points) {
  const p = normalizeFieldProfile(profile);
  let data;
  if (p.type === 'custom') data = { v: 1, p, xy: validateFieldPoints(points).map(q => [q.x, q.y]) };
  else { generateField(n, seed, p); data = { v: 1, p, n, s: seed }; }
  return 'PF1.' + btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeField(text) {
  const value = text.trim();
  if (value.length > 30000) throw new Error('Код поля слишком длинный.');
  let profile = { type: 'custom' }, seed = null, points;
  if (value.startsWith('PF1.')) {
    let data;
    try { data = JSON.parse(atob(value.slice(4).replaceAll('-', '+').replaceAll('_', '/'))); }
    catch { throw new Error('Не удалось прочитать код PF1.'); }
    if (data.v !== 1) throw new Error('Неизвестная версия генератора.');
    profile = normalizeFieldProfile(data.p);
    if (profile.type === 'custom') points = validateFieldPoints(data.xy);
    else { seed = data.s; points = generateField(data.n, seed, profile); }
  } else if (value.startsWith('[') || value.startsWith('{')) {
    let data;
    try { data = JSON.parse(value); } catch { throw new Error('Некорректный JSON координат.'); }
    points = validateFieldPoints(Array.isArray(data) ? data : data.points);
  } else {
    const source = value.replaceAll('`', '').trim();
    const expression = /(\d+)\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/g;
    const matches = [...source.matchAll(expression)];
    if (!matches.length || source.replace(expression, '').trim() || matches.some((m, i) => Number(m[1]) !== i + 1)) {
      throw new Error('Вставь код PF1, JSON координат или список вида 01 (10, 20)02 (30, 40)…');
    }
    points = validateFieldPoints(matches.map(m => ({ x: Number(m[2]), y: Number(m[3]) })));
  }
  return { profile, seed, points, code: encodeField(profile, points.length, seed, points) };
}
