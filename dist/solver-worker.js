'use strict';

importScripts('search.js', 'held-karp.js');
self.onmessage = ({ data: points }) => {
  const run = new RouteSearch(points);
  run.advance();
  const length = run.best.len[0] + run.best.len[1];
  self.postMessage({ name: 'khvastuns', length, ms: run.totalMs });
  const start = performance.now();
  const result = heldKarp(points.map(a => points.map(b => routeDistance(a, b))));
  self.postMessage({ name: 'Held–Karp', length: result.length, ms: performance.now() - start,
    done: true, matches: Math.abs(result.length - length) <= 1e-8 });
};
