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
  let seed = Math.imul(n, 0x85ebca6b) ^ Math.imul(index + 1, 0x9e3779b1);
  return randomField(n, () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
}
