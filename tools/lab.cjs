'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compileFunction } = require('node:vm');

// Запускаем те же скрипты, что и страница, без DOM, таймеров интерфейса и копии алгоритма.
const scripts = ['fields.js', 'search.js', 'series-runner.js', 'statistics.js', 'comparison.js'];
const source = scripts.map(name => readFileSync(join(__dirname, '../dist', name), 'utf8')).join('\n');
module.exports = compileFunction(source + '\nreturn { RouteSearch, routeDistance, seriesField, warmupVariants, measureRun, measuredValues, emptyStats, addMeasurement, statsReport };')();
