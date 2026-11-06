'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { compileFunction } = require('node:vm');

// Запускаем те же скрипты, что и страница, без DOM, таймеров интерфейса и копии алгоритма.
const scripts = ['fields.js', 'one-tree.js', 'search.js', 'search-four.js', 'held-karp.js', 'edge-analysis.js', 'score-quality.js', 'score-distribution.js', 'search-var.js', 'search-staged.js', 'series-runner.js', 'statistics.js', 'comparison.js'];
const source = scripts.map(name => readFileSync(join(__dirname, '../dist', name), 'utf8')).join('\n');
module.exports = compileFunction(source + '\nreturn { EdgeAnalysis, VariableRouteSearch, StagedRouteSearch, RouteSearch, FourBranchSearch, HeldKarpSearch, createRouteSearch, createSeriesRunner, routeDistance, seriesField, warmupVariants, measureRun, measuredValues, emptyStats, addMeasurement, statsReport, routeScoreQuality, routeScoreMeasurements, formatEdgeScore, tourFromBest, ABSOLUTE_SCORE_LIMITS, absoluteScoreBand, scoreDistributionMeasurements, scoreDistribution, SCORE_COMPONENTS, seriesSeed, generateField, profileSeriesField, normalizeFieldProfile, fieldProfileKey, fieldProfileLabel, encodeField, decodeField, statsDatabaseName, CURRENT_SCORE_MODEL, LEGACY_SCORE_MODEL, scoreModelInfo };')();
