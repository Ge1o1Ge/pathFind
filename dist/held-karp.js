'use strict';

// В слое конечного города j храним только подмножества, содержащие j.
function heldKarp(dist) {
  const n = dist.length, m = n - 1;
  if (n < 3 || n > 22) throw new RangeError('Этот эталон Хелда — Карпа рассчитан на 3–22 города.');
  const size = 1 << (m - 1), full = (1 << m) - 1;
  const dp = new Float64Array(m * size);
  const index = (mask, j, bit) => j * size + ((mask & (bit - 1)) | ((mask >> 1) & -bit));
  for (let mask = 1; mask <= full; mask++) {
    for (let ends = mask; ends; ends &= ends - 1) {
      const bit = ends & -ends, j = 31 - Math.clz32(bit), rest = mask ^ bit;
      let best = rest ? Infinity : dist[0][j + 1];
      for (let bits = rest; bits; bits &= bits - 1) {
        const b = bits & -bits, i = 31 - Math.clz32(b);
        best = Math.min(best, dp[index(rest, i, b)] + dist[i + 1][j + 1]);
      }
      dp[index(mask, j, bit)] = best;
    }
  }
  let mask = full, end = 0, length;
  const reverse = [];
  while (mask) {
    let best = Infinity, chosen;
    for (let bits = mask; bits; bits &= bits - 1) {
      const b = bits & -bits, i = 31 - Math.clz32(b);
      const cost = dp[index(mask, i, b)] + dist[i + 1][end];
      if (cost < best) { best = cost; chosen = i; }
    }
    if (end === 0) length = best;
    end = chosen + 1;
    reverse.push(end);
    mask ^= 1 << chosen;
  }
  return { length, tour: [0, ...reverse.reverse()] };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { heldKarp };
