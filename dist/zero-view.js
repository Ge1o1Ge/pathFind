'use strict';

let zeroView = false, zeroCursor = -1, zeroFocus = -1, zeroSelected = -1, zeroOptionsKey = '';
function isVarMode() { return isVariableAlgorithm(algorithm); }
function resetZeroView() { zeroView = false; zeroCursor = zeroFocus = zeroSelected = -1; zeroOptionsKey = ''; }
function zeroPosition() {
  return zeroCursor < 0 ? search.zeroEvents.length - 1 : Math.min(zeroCursor, search.zeroEvents.length - 1);
}
function selectedZeroEvent() {
  const position = zeroPosition(), index = zeroSelected < 0 ? position : zeroSelected;
  const event = index <= position ? search.zeroEvents[index] : null;
  return event && (zeroFocus < 0 || event.a === zeroFocus || event.b === zeroFocus) ? event : null;
}
function zeroEventText(event) {
  const edge = pad(event.a + 1) + ' — ' + pad(event.b + 1);
  const number = value => value === null ? '—' : distance.format(value);
  return edge + ' · шаг ' + integer.format(event.step) + (event.step === 0 ? ' (подготовка)' : '') +
    ' · ' + event.reason + ' Рекорд U: ' + number(event.upper) +
    (event.kind === 'bound' ? '; Bₑ: ' + number(event.bound) + ' > U (сравнение до округления).' : '.') +
    (event.cause?.city !== undefined ? ' Город: ' + pad(event.cause.city + 1) + '.' : '') +
    (event.cause?.edge !== undefined ? (() => { const e = search.edgeAnalysis.edges[event.cause.edge]; return ' Обязательное ребро: ' + pad(e.a + 1) + ' — ' + pad(e.b + 1) + '.'; })() : '');
}
function drawZeroRoads(run, x, y) {
  const position = zeroPosition(), selected = selectedZeroEvent();
  const lines = [];
  for (let i = 0; i <= position; i++) {
    const event = run.zeroEvents[i];
    if (zeroFocus >= 0 && event.a !== zeroFocus && event.b !== zeroFocus) continue;
    const fresh = i === position;
    const coordinates = ' x1="' + x(event.a) + '" y1="' + y(event.a) + '" x2="' + x(event.b) + '" y2="' + y(event.b) + '"';
    // Прозрачная полоса делает тонкое пунктирное ребро удобным для выбора между штрихами.
    lines.push('<g data-zero="' + i + '"><title>' + zeroEventText(event) + '</title>' +
      '<line' + coordinates + ' stroke="' + (fresh ? '#d13c4f' : '#8292a5') + '" stroke-width="' + (fresh ? 1.8 : 0.8) +
      '" stroke-opacity="' + (fresh ? 0.8 : 0.35) + '" stroke-dasharray="' + (fresh ? '5 3' : '2 5') + '"/>' +
      '<line' + coordinates + ' stroke="transparent" stroke-width="10" pointer-events="stroke"/></g>');
  }
  if (el('zero-route').checked && run.best) {
    lines.push(...run.best.paths.map((path, i) => '<polyline points="' + path.map(j => x(j) + ',' + y(j)).join(' ') +
      '" fill="none" stroke="' + colors[i] + '" stroke-width="2.5" pointer-events="none"/>'));
  }
  if (selected) {
    const pointer = zeroPointer(selected, x, y);
    lines.push(pointer.line);
    el('map-overlay').innerHTML = pointer.marker;
  }
  el('roads').innerHTML = lines.join('');
}
function zeroPointer(event, x, y) {
  const ax = x(event.a), ay = y(event.a), bx = x(event.b), by = y(event.b);
  const mx = (ax + bx) / 2, my = (ay + by) / 2, direction = my < 56 ? 1 : -1;
  const labelX = Math.max(44, Math.min(map.clientWidth - 44, mx)), labelY = my + direction * 35;
  const coordinates = ' x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '"';
  // Подпись выводим поверх городов; само ребро оставляем под ними, чтобы не перекрыть номера концов.
  return { line: '<g pointer-events="none"><line' + coordinates + ' stroke="white" stroke-width="7" stroke-opacity=".9"/>' +
    '<line' + coordinates + ' stroke="#a21e37" stroke-width="3"/></g>',
    marker: '<g class="zero-pointer" pointer-events="none" aria-label="Выбрано ребро ' + pad(event.a + 1) + ' — ' + pad(event.b + 1) + '">' +
    '<circle cx="' + ax + '" cy="' + ay + '" r="14" fill="none" stroke="#a21e37" stroke-width="2"/>' +
    '<circle cx="' + bx + '" cy="' + by + '" r="14" fill="none" stroke="#a21e37" stroke-width="2"/>' +
    '<circle cx="' + mx + '" cy="' + my + '" r="5" fill="white" stroke="#a21e37" stroke-width="2"/>' +
    '<path d="M' + labelX + ',' + labelY + ' L' + mx + ',' + (my + direction * 8) +
      ' M' + (mx - 4) + ',' + (my + direction * 14) + ' L' + mx + ',' + (my + direction * 8) + ' L' + (mx + 4) + ',' + (my + direction * 14) +
      '" fill="none" stroke="#a21e37" stroke-width="2"/>' +
    '<rect x="' + (labelX - 40) + '" y="' + (labelY - 11) + '" width="80" height="22" rx="5" fill="#a21e37"/>' +
    '<text x="' + labelX + '" y="' + (labelY + 4) + '" text-anchor="middle" fill="white" font-size="11" font-weight="600">' +
      pad(event.a + 1) + '–' + pad(event.b + 1) + ' = 0</text></g>' };
}
function renderZeroView() {
  el('zero-controls').hidden = !isVarMode() || !zeroView;
  el('show-zeros').setAttribute('aria-pressed', String(isVarMode() && zeroView));
  if (!isVarMode()) return;
  el('var-stages').hidden = search.algorithm !== 'hvastuns-staged';
  if (!el('var-stages').hidden) {
    el('var-stages').textContent = 'Этап ' + (search.stageIndex + 1) + ' / ' + search.stageThresholds.length +
      ' · Минимальный балл: ' + formatEdgeScore(search.stageThreshold) + ' · Отложено до следующих этапов: ' + integer.format(search.deferredCount) +
      ' · Отсечено доказанным нулём: ' + integer.format(search.stageZeroCuts) +
      ' · Досрочных открытий из-за очереди: ' + integer.format(search.stageEarlyOpens) +
      '. Общая нижняя граница учитывает и отложенные варианты.';
  }
  renderScoreQuality(search);
  const run = search, analysis = run.edgeAnalysis;
  const chain = run.chainSummary(displayedState());
  el('var-chain').textContent = chain ? 'Показанные ветви · средний −ln(s): ℓ₁ = ' + distance.format(chain.meanPenalties[0]) +
    ', ℓ₂ = ' + distance.format(chain.meanPenalties[1]) + ', вместе = ' + distance.format(chain.meanPenalty) +
    ' · B(F): ' + (chain.impossible ? 'тупик' : chain.bound === null ? 'ещё не вычислена' : distance.format(chain.bound)) +
    '. Логарифмический штраф — эвристика порядка, не вероятность цепочки.' : 'Оценки цепочек появятся после подготовки матрицы.';
  el('var-combination').textContent = 'B(F) · вычислений: ' + integer.format(run.combinationEvaluations) +
    ' · Усилений границы: ' + integer.format(run.combinationRaised) + ' · Дополнительных отсечений: ' + integer.format(run.combinationCuts) +
    ' · Проверок соседей: ' + integer.format(run.combinationChecks) + ' · Время: ' + elapsed(run.combinationMs) + ' (уже входит в расчёт)';
  el('var-progress').textContent = 'Матрица: ' + analysis.processed + ' / ' + analysis.edges.length + ' рёбер · ' +
    ({ matrix: 'подготовка', filter: 'обновление запретов', search: run.done ? 'поиск завершён' : 'поиск' })[run.phase] +
    ' · Глобальных нулей: ' + integer.format(run.zeroEvents.length) + ' · Обязательных рёбер: ' + run.requiredCount;
  const counts = run.zeroCounts;
  el('var-counts').textContent = 'Геометрические тупики: ' + counts.geometry + ' · Bₑ > U: ' + counts.bound +
    ' (дополнительно через 1-дерево: ' + integer.format(run.edgeOneTreeCuts) + ')' +
    ' · Степень 2: ' + counts.degree + ' · Конфликт с обязательным: ' + counts.crossing + ' · Ранний подцикл: ' + counts.subtour;
  el('var-work').textContent = 'Матрица: ' + elapsed(run.edgeMatrixMs) + ' · Обновления и управление: ' + elapsed(run.edgePruningMs) +
    ' · Сравнений Bₑ с U: ' + integer.format(run.edgeBoundChecks) + ' · Отсечено готовых состояний маской: ' + integer.format(run.globalStateCuts) +
    ' · Продолжений: ' + integer.format(run.globalEdgeCuts);
  el('var-diversity').hidden = !run.diversityEnabled;
  el('var-diversity').textContent = 'Смен начала ветвей: ' + integer.format(run.diversitySwitches) +
    ' · Кандидатов переключения: ' + integer.format(run.diversityChecks) + ' · Достроек после переключения: ' + integer.format(run.diversityProbes) +
    ' · Максимум повторов начального ребра: ' + integer.format(run.diversityMaxVisits) +
    ' · Выбор: ' + elapsed(run.diversityMs) + ' (в основном поиске)';
  el('var-repair').textContent = 'Перестроек полного цикла: ' + integer.format(run.repairAttempts) +
    ' · Проверено пар: ' + integer.format(run.repairChecks) + ' · Улучшений L: ' + integer.format(run.repairImprovements) +
    ' · Время: ' + elapsed(run.repairMs) + ' (в общем расчёте)';
  el('var-relaxed').textContent = 'Достройка с распутыванием' +
    (run.completion?.relaxed ? (run.completion.relaxed.phase === 'uncross' ? ' · убираем оставшиеся пересечения' : run.completion.relaxed.phase === 'opt' ? ' · идёт 2-opt' : run.completion.relaxed.phase === 'fill' ? ' · добавляем все оставшиеся города' : ' · собираем пробный цикл') : '') +
    ' · Попыток: ' + integer.format(run.relaxedAttempts) + ' · Проверок продолжения: ' + integer.format(run.relaxedBuildChecks) +
    ' · Пар 2-opt: ' + integer.format(run.relaxedOptChecks) + ' · Циклов: ' + integer.format(run.relaxedCycles) +
    ' · Разворотов: ' + integer.format(run.relaxedMoves) + ' · Улучшений L: ' + integer.format(run.relaxedImprovements) +
    ' · Возвратов к обычной достройке: ' + integer.format(run.relaxedFailures) +
    ' · Принудительных заполнений: ' + integer.format(run.relaxedForced) +
    ' · Убрано недопустимых связей: ' + integer.format(run.relaxedRepairedEdges) +
    ' · Распутывание: ' + integer.format(run.relaxedUncrossChecks) + ' проверок / ' + integer.format(run.relaxedUncrossMoves) + ' замен' +
    (run.relaxedTrace?.remainingCrossings === undefined ? '' : ' · Осталось пересечений в последней пробе: ' + run.relaxedTrace.remainingCrossings) +
    ' · Время: ' + elapsed(run.relaxedMs) + ' (входит во время достроек)';
  if (!zeroView) return;
  const slider = el('zero-step'), index = zeroPosition(), current = run.zeroEvents[index];
  slider.max = Math.max(0, run.zeroEvents.length - 1); slider.value = Math.max(0, index); slider.disabled = !current;
  slider.style.setProperty('--fill', (index > 0 ? index / Number(slider.max) * 100 : 0) + '%');
  const positionText = current ? 'Обнуление ' + (index + 1) + ' / ' + run.zeroEvents.length + ' · шаг поиска ' +
    integer.format(current.step) + (current.step === 0 ? ' · подготовка' : '') : 'Пока нет доказанных нулей';
  slider.setAttribute('aria-valuetext', positionText);
  el('zero-position').textContent = positionText;
  const key = [index, zeroFocus].join('/');
  if (key !== zeroOptionsKey) {
    zeroOptionsKey = key;
    el('zero-edge').innerHTML = '<option value="-1">Выбери линию на карте</option>' + run.zeroEvents.slice(0, index + 1)
      .filter(e => zeroFocus < 0 || e.a === zeroFocus || e.b === zeroFocus)
      .map(e => '<option value="' + e.index + '">' + pad(e.a + 1) + ' — ' + pad(e.b + 1) + ' · шаг ' + e.step + ' · ' + e.reason + '</option>').join('');
  }
  const event = selectedZeroEvent();
  el('zero-edge').value = event?.index ?? -1;
  el('zero-detail').textContent = event ? zeroEventText(event) :
    'Красная линия — текущее обнуление; серые исключены ранее. Выбери ребро для причины запрета.';
  el('zero-clear').disabled = zeroFocus < 0;
}
function initZeroView() {
  el('show-zeros').onclick = () => { zeroView = true; probeView = false; render(); };
  el('zero-step').oninput = () => { zeroCursor = Number(el('zero-step').value); zeroSelected = -1; render(); };
  el('zero-latest').onclick = () => { zeroCursor = -1; zeroSelected = -1; render(); };
  el('zero-route').onchange = render;
  el('zero-clear').onclick = () => { zeroFocus = zeroSelected = -1; render(); };
  el('zero-edge').onchange = () => { zeroSelected = Number(el('zero-edge').value); render(); };
  el('zero-export').onclick = () => downloadStatsReport({ ...search.reportZeros(), exportedAt: new Date().toISOString() }, search.algorithm + '-zeros');
  map.addEventListener('click', event => {
    if (!isVarMode() || !zeroView) return;
    const city = event.target.closest('[data-city]'), edge = event.target.closest('[data-zero]');
    if (city) { const i = Number(city.dataset.city); zeroFocus = zeroFocus === i ? -1 : i; zeroSelected = -1; }
    else if (edge) zeroSelected = Number(edge.dataset.zero);
    else return;
    render();
  });
}
