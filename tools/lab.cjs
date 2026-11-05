'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compileFunction } = require('node:vm');

// Запускаем те же скрипты, что и страница, без DOM, таймеров интерфейса и копии алгоритма.
const scripts = ['fields.js', 'one-tree.js', 'search.js', 'search-four.js', 'held-karp.js', 'series-runner.js', 'statistics.js', 'comparison.js'];
const source = scripts.map(name => readFileSync(join(__dirname, '../dist', name), 'utf8')).join('\n');
module.exports = compileFunction(source + '\nreturn { RouteSearch, FourBranchSearch, createRouteSearch, routeDistance, seriesField, warmupVariants, measureRun, measuredValues, emptyStats, addMeasurement, statsReport };')();
