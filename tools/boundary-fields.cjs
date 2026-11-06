'use strict';

const { seriesField } = require('./lab.cjs');

function boundaryFields(n, seed = 0) {
  let randomState = seed + 1;
  const random = () => { randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0; return randomState / 4294967296; };
  const polygon = (rx, ry) => Array.from({ length: n }, (_, i) => {
    const angle = 2 * Math.PI * (i + 0.1 * seed) / n;
    return { x: 50 + rx * Math.cos(angle), y: 25 + ry * Math.sin(angle) };
  });
  const cols = Math.ceil(Math.sqrt(n)), spacing = Math.min(90 / (cols - 1), 40 / (Math.ceil(n / cols) - 1 || 1));
  const twoClusters = Array.from({ length: n }, (_, i) => ({ x: (i < n / 2 ? 8 : 88) + random() * 4, y: 23 + random() * 4 }));
  const outliers = Array.from({ length: n }, (_, i) => i === n - 1 ? { x: 96, y: 45 } : { x: 9 + random() * 10, y: 5 + random() * 10 });
  return [
    { name: 'Окружность', points: polygon(20, 20), perimeter: true },
    { name: 'Выпуклый эллипс', points: polygon(45, 18), perimeter: true },
    { name: 'Узкий выпуклый контур', points: polygon(45, 0.03), perimeter: true },
    { name: 'Решётка', points: Array.from({ length: n }, (_, i) => ({ x: 5 + i % cols * spacing, y: 5 + Math.floor(i / cols) * spacing })) },
    { name: 'Прямая', points: Array.from({ length: n }, (_, i) => ({ x: 5 + 90 * i / (n - 1), y: 25 })) },
    { name: 'Узкая полоса', points: Array.from({ length: n }, (_, i) => ({ x: 5 + 90 * i / (n - 1), y: 25 + 0.02 * random() })) },
    { name: 'Два скопления', points: twoClusters },
    { name: 'Облако с выбросом', points: outliers },
    { name: 'Совпадающие точки', points: Array.from({ length: n }, (_, i) => ({ x: 20 + i % 3, y: 20 + i % 2 })) },
    { name: 'Случайное поле', points: seriesField(n, seed) }
  ];
}

function squareGrid(side) {
  const spacing = 40 / (side - 1);
  const points = Array.from({ length: side * side }, (_, i) => ({ x: 20 + i % side * spacing, y: 5 + Math.floor(i / side) * spacing }));
  // Для чётной стороны этот цикл проходит только по рёбрам минимальной длины — его оптимум известен точно.
  const tour = [0];
  for (let row = 0; row < side; row++) {
    const columns = Array.from({ length: side - 1 }, (_, i) => i + 1);
    if (row % 2) columns.reverse();
    for (const col of columns) tour.push(row * side + col);
  }
  for (let row = side - 1; row > 0; row--) tour.push(row * side);
  return { name: 'Решётка ' + side + '×' + side, points, tour, optimum: points.length * spacing };
}

function separatedClusters(n, left, separation, seed = 0) {
  if (!Number.isInteger(n) || n < 3 || n > 100 || !Number.isInteger(left) || left < 1 || left >= n ||
      !Number.isFinite(separation) || separation <= 1 || !Number.isInteger(seed)) {
    throw new RangeError('Нужны 3–100 городов, две непустые группы, разнос больше одной ширины группы и целый seed.');
  }
  let state = seed + 1;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  const width = 92 / (separation + 1), groups = Array.from({ length: n }, (_, i) => Number(i >= left));
  // При изменении разноса сохраняем внутреннюю геометрию; общий масштаб помещает поле в прежнюю карту.
  const points = groups.map(group => ({ x: 4 + width * (group * separation + random()), y: 25 + width * (random() - 0.5) }));
  return { name: 'Два скопления ' + left + '+' + (n - left), n, left, separation, seed, width, points, groups };
}

module.exports = { boundaryFields, squareGrid, separatedClusters };
