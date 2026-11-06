'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { generateField, seriesField, seriesSeed, profileSeriesField, encodeField, decodeField, fieldProfileKey,
  statsDatabaseName, VariableRouteSearch, StagedRouteSearch, routeDistance } = require('../tools/lab.cjs');
const { heldKarp } = require('../dist/held-karp.js');

const profiles = [{ type: 'uniform' }, { type: 'clusters', groups: 2, separation: 1000 },
  { type: 'clusters', groups: 5, separation: 10 }, { type: 'outlier', separation: 25 },
  { type: 'convex', height: 1 }, { type: 'convex', height: 0.01 }, { type: 'grid', columns: 0 }, { type: 'grid', columns: 1 }];

test('Seed и код PF1 точно восстанавливают все геометрии, включая старшие размеры', () => {
  for (const p of profiles) for (const n of [3, 16, 31, 100]) for (const seed of [0, 123, 0xffffffff]) {
    const points = generateField(n, seed, p), code = encodeField(p, n, seed);
    assert.deepEqual(generateField(n, seed, p), points);
    assert.deepEqual(decodeField(code).points, points);
    assert.equal(decodeField(code).code, code);
    assert.equal(points.length, n);
    assert.equal(new Set(points.map(q => q.x + ',' + q.y)).size, n);
    assert.ok(points.every(q => q.x >= 0 && q.x <= 100 && q.y >= 0 && q.y <= 50));
  }
});

test('Прежние серии побитно сохранены, их seed доступен в новом коде поля', () => {
  for (const [n, index, hash] of [
    [16, 0, '056539aca3f297b2abd6331f24adf55fc2cfa9332eba0f2394c4cee455365438'],
    [30, 212, 'a9bd0bcc9bb436d25b8cafad74e4984b212bcccf39a6d0eb13b741c321987a80'],
    [100, 7, 'b03fb0fac20dff6606dc3eef4e67d6ba375a5675827a69a91f3b176948025ff8']
  ]) {
    const points = seriesField(n, index);
    assert.equal(createHash('sha256').update(JSON.stringify(points)).digest('hex'), hash);
    assert.deepEqual(profileSeriesField(n, index, { type: 'uniform' }), points);
    assert.deepEqual(decodeField(encodeField({ type: 'uniform' }, n, seriesSeed(n, index))).points, points);
  }
});

test('Версия PF1 закрепляет геометрию генераторов; контур выпуклый, полная решётка сохраняет узлы', () => {
  for (const [p, hash] of [
    [{ type: 'clusters', groups: 3, separation: 10 }, '019c9b7ca21a4497ab48745ee7ac15a67a8755624b2a32015bc4bc3c1b02d7a4'],
    [{ type: 'convex', height: 1 }, 'e66c8f0a39b8d74741b44394b0643a08f84b1440727dc5125378f2e38b9c71e7'],
    [{ type: 'grid', columns: 0 }, 'b88cbdda02c5957d4c360a13d2d0362c46a7a18ea804994d0fa504539198caf9']
  ]) assert.equal(createHash('sha256').update(JSON.stringify(generateField(16, 123, p))).digest('hex'), hash);
  const contour = generateField(100, 13, { type: 'convex', height: 0.01 })
    .sort((a, b) => Math.atan2(a.y - 25, a.x - 50) - Math.atan2(b.y - 25, b.x - 50));
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length], c = contour[(i + 2) % contour.length];
    assert.ok((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0);
  }
  const nodes = seed => generateField(16, seed, { type: 'grid' }).map(p => p.x + ',' + p.y).sort();
  assert.deepEqual(nodes(0), nodes(100));
});

test('Произвольные координаты обратимы без подбора seed; повреждённые входы отвергаются', () => {
  const points = [{ x: -200.123456789, y: 0.000000001 }, { x: 600, y: -90 }, { x: 600, y: -90 }];
  assert.deepEqual(decodeField(encodeField({ type: 'custom' }, 3, null, points)).points, points);
  assert.deepEqual(decodeField(JSON.stringify(points)).points, points);
  assert.deepEqual(decodeField('01 (-200.123456789, 1e-9)02 (600, -90)03 (600, -90)').points, points);
  for (const text of ['PF1.bad', '[]', '[{"x":null,"y":0},{"x":0,"y":1},{"x":1,"y":0}]',
    '01 (0,0)03 (1,0)02 (0,1)', '01 (0,0)02 (1,0)03 (0,1) garbage', '01 (1e30,0)02 (1,0)03 (0,1)',
    'PF1.' + btoa(JSON.stringify({ v: 2, p: { type: 'uniform' }, n: 3, s: 1 }))]) assert.throws(() => decodeField(text));
  assert.throws(() => generateField(16, -1));
  assert.throws(() => generateField(16, 0, { type: 'clusters', groups: 2, separation: NaN }));
});

test('Геометрии и параметры имеют отдельные хранилища, обычные данные остаются по прежнему адресу', () => {
  assert.equal(statsDatabaseName(), 'atlas-route-statistics-v1');
  assert.equal(statsDatabaseName('hvastuns-var', 'proof'), 'atlas-route-statistics-v1-hvastuns-var-proof-score-crossings-v2');
  const names = profiles.map(p => statsDatabaseName('hvastuns-var', 'normal', p));
  assert.equal(new Set(names).size, profiles.length);
  assert.notEqual(statsDatabaseName('hvastuns-var', 'normal', profiles[1]), statsDatabaseName('hvastuns-var', 'proof', profiles[1]));
  assert.equal(fieldProfileKey({ type: 'uniform', groups: 5 }), '');
});

test('Новые граничные поля сохраняют точный результат обоих вариантов против Held–Karp', () => {
  for (const p of profiles) for (const n of [7, 10]) {
    const points = generateField(n, 123, p), optimal = heldKarp(points.map(a => points.map(b => routeDistance(a, b)))).length;
    for (const Solver of [VariableRouteSearch, StagedRouteSearch]) {
      const run = new Solver(points);
      run.advance(100000);
      assert.ok(run.done);
      assert.ok(Math.abs(run.upper - optimal) < 1e-7);
    }
  }
});
