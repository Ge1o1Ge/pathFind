'use strict';

let probeView = false, probeCursor = -1, probeTraceId = 0;
const probeBuildColors = ['#963ec0', '#078b98'], probeOptColors = ['#158357', '#cb3d86'];
function resetProbeView() { probeView = false; probeCursor = -1; probeTraceId = 0; }
function selectedProbeFrame() {
  const trace = search.relaxedTrace;
  if (!trace?.frames.length) return null;
  if (trace.id !== probeTraceId) { probeTraceId = trace.id; probeCursor = -1; }
  return trace.frames[probeCursor < 0 ? trace.frames.length - 1 : Math.min(probeCursor, trace.frames.length - 1)];
}
function displayedProbe() {
  if (!isVarMode() || bestView || zeroView) return null;
  if (probeView) return selectedProbeFrame();
  if (search.completion?.relaxed) return search.relaxedTrace?.frames.at(-1);
  return search.completion ? { phase: 'exact', label: 'Обычная ограниченная достройка', blocked: [], below: [] } : null;
}
function probePalette(probe) {
  if (!probe || probe.phase === 'source') return colors;
  return ['opt', 'uncross', 'result'].includes(probe.phase) ? probeOptColors : probeBuildColors;
}
function drawProbeRoads(state, probe, x, y, width) {
  const palette = probePalette(probe), blocked = new Set(probe.blocked.map(([a, b]) => Math.min(a, b) + '/' + Math.max(a, b)));
  const lines = [];
  state.paths.forEach((path, side) => path.slice(1).forEach((b, i) => {
    const a = path[i], zero = blocked.has(Math.min(a, b) + '/' + Math.max(a, b));
    lines.push('<line x1="' + x(a) + '" y1="' + y(a) + '" x2="' + x(b) + '" y2="' + y(b) +
      '" stroke="' + (zero ? '#c93644' : palette[side]) + '" stroke-width="' + width +
      '" stroke-linecap="round"' + (zero ? ' stroke-dasharray="6 4"' : '') + '><title>' +
      (zero ? 'Временное нулевое ребро пробного цикла' : probe.label) + '</title></line>');
  }));
  el('roads').innerHTML = lines.join('');
}
function renderProbeView() {
  const available = isVarMode() && Boolean(search.relaxedTrace?.frames.length);
  el('show-probe').disabled = !available;
  el('show-probe').setAttribute('aria-pressed', String(isVarMode() && probeView));
  el('probe-controls').hidden = !isVarMode() || !probeView;
  const probe = displayedProbe(), palette = probePalette(probe);
  for (let i = 0; i < 2; i++) {
    el('legend-line-' + i).style.background = palette[i];
    el('legend-arm-' + i).textContent = (probe && probe.phase !== 'source' ? 'Проба ' : 'Ветвь ') + armNames[i];
  }
  const zeroLegend = el('probe-zero-legend'), mapStatus = el('probe-map-status');
  zeroLegend.hidden = !isVarMode();
  zeroLegend.style.visibility = probe?.blocked.length ? 'visible' : 'hidden';
  mapStatus.hidden = !isVarMode();
  mapStatus.classList.toggle('is-probe', Boolean(probe));
  mapStatus.textContent = probe ? (probeView ? 'Кадр пробы · ' : 'Пробный расчёт · ') + probe.label +
    (probe.crossings === undefined ? '' : ' · поперечных пересечений: ' + probe.crossings) +
    (probe.blocked.length ? ' · временных нулевых рёбер: ' + probe.blocked.length : '') +
    (probe.below.length ? ' · ниже порога этапа: ' + probe.below.length : '') :
    zeroView ? 'История обнулений' : bestView ? 'Лучший найденный цикл' : 'Текущие ветви';
  mapStatus.title = mapStatus.textContent;
  if (!available || !probeView) return;
  const trace = search.relaxedTrace, frame = selectedProbeFrame(), slider = el('probe-frame');
  const index = probeCursor < 0 ? trace.frames.length - 1 : Math.min(probeCursor, trace.frames.length - 1);
  slider.max = trace.frames.length - 1; slider.value = index;
  slider.style.setProperty('--fill', (trace.frames.length > 1 ? index / (trace.frames.length - 1) * 100 : 0) + '%');
  slider.setAttribute('aria-valuetext', frame.label + ' · кадр ' + (index + 1));
  el('probe-position').textContent = 'Проба № ' + trace.id + ' · шаг ' + integer.format(trace.step) +
    ' · кадр ' + (index + 1) + ' / ' + trace.frames.length;
  el('probe-previous').disabled = index === 0; el('probe-next').disabled = index === trace.frames.length - 1;
  const status = { running: 'Проба не завершена', improved: 'Проба улучшила рекорд', unchanged: 'Проба не улучшила рекорд',
    failed: 'Проба прекращена', proved: 'Достигнута общая нижняя граница' }[trace.status];
  el('probe-result').textContent = status + ' · улучшений L: ' + trace.improvements +
    (trace.remainingCrossings === undefined ? '' : ' · осталось поперечных пересечений: ' + trace.remainingCrossings) +
    (trace.uncross?.limited ? ' · достигнут лимит распутывания' : '') +
    (trace.forced ? ' · использовано принудительное заполнение всех городов' : '') +
    (trace.dropped ? ' · промежуточных кадров пропущено: ' + trace.dropped : '') + '. Основной перебор хранится отдельно.';
}
function initProbeView() {
  el('show-probe').onclick = () => { probeView = true; bestView = zeroView = false; probeCursor = -1; render(); };
  el('probe-frame').oninput = () => { probeCursor = Number(el('probe-frame').value); render(); };
  el('probe-latest').onclick = () => { probeCursor = -1; render(); };
  for (const [id, delta] of [['probe-previous', -1], ['probe-next', 1]]) el(id).onclick = () => {
    const frames = search.relaxedTrace.frames;
    probeCursor = Math.max(0, Math.min(frames.length - 1, (probeCursor < 0 ? frames.length - 1 : probeCursor) + delta));
    render();
  };
}
