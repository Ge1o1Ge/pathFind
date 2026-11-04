'use strict';

const chartNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

function axisInterval(range) {
  const target = range / 4;
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].find(n => n * power >= target) * power;
}

function drawConvergence(svg, run, balance) {
  const w = svg.clientWidth, h = svg.clientHeight;
  if (!w || !h) return;
  const left = 45, right = w - 17, top = 28, bottom = h - 43;
  const x = step => left + (right - left) * step / Math.max(1, run.steps);
  const sum = row => row.len[0] + row.len[1];
  const rows = run.history;
  const min = balance ? 1 : 0;
  const high = balance ? rows.reduce((max, row) => Math.max(max, balanceRatio(row.len)), 1.1) : sum(rows[0]);
  const interval = axisInterval(Math.max(0.01, high - min));
  const max = min + Math.ceil((high - min) / interval) * interval;
  const y = value => bottom - (bottom - top) * (value - min) / (max - min);
  const number = chartNumber.format;
  const label = (px, py, value, align = 'start') =>
    '<text x="' + px + '" y="' + py + '" text-anchor="' + align + '">' + value + '</text>';
  const line = (x1, y1, x2, y2, stroke, dash = '') =>
    '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-dasharray="' + dash + '"/>';

  const axes = [label(left, 14, balance ? 'Q · отношение энергий' : 'Длина · ед.'), label(right, h - 5, 'Шаг поиска', 'end')];
  for (let i = 0; i <= Math.round((max - min) / interval); i++) {
    const tick = min + i * interval;
    axes.push(line(left, y(tick), right, y(tick), '#dae3ed'), label(left - 7, y(tick) + 3, number(tick), 'end'));
  }
  const divisions = Math.min(run.steps, w < 500 ? 3 : 5);
  for (let i = 0; i <= divisions; i++) {
    const step = divisions ? Math.round(i * run.steps / divisions) : 0;
    axes.push(line(x(step), top, x(step), bottom, '#e8edf2'), label(x(step), bottom + 16, integer.format(step), i === divisions && i > 0 ? 'end' : 'middle'));
  }
  // Горизонтальный отрезок длится до фактического шага следующего изменения.
  function stairs(read) {
    const path = [[x(0), y(read(rows[0]))]];
    let last = read(rows[0]);
    for (const row of rows.slice(1)) {
      const value = read(row);
      if (value !== last) {
        path.push([x(row.step), y(last)], [x(row.step), y(value)]);
        last = value;
      }
    }
    path.push([x(run.steps), y(last)]);
    return path;
  }
  const paths = [];
  const legend = [];
  const latest = rows.at(-1);
  function series(name, color, read, dash = '') {
    const path = stairs(read);
    const value = read(latest);
    paths.push('<polyline points="' + path.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-dasharray="' + dash + '"/>');
    paths.push('<circle cx="' + x(run.steps) + '" cy="' + y(value) + '" r="3" fill="' + color + '"/>');
    legend.push('<span><i style="border-color:' + color + ';border-top-style:' + (dash ? 'dashed' : 'solid') + '"></i>' + name + ' <b>' + (balance ? number(value) : distance.format(value)) + '</b></span>');
  }
  if (balance) {
    paths.push(line(left, y(1), right, y(1), '#67778b', '5 4'));
    series('Баланс Q', '#7650ad', row => balanceRatio(row.len));
    legend.push('<span>Равные ветви <b>Q = 1</b></span>');
  } else {
    const floor = row => row.bound;
    const band = stairs(sum).concat(stairs(floor).reverse());
    paths.push('<polygon points="' + band.join(' ') + '" fill="#199576" fill-opacity=".11"/>');
    series('ℓ₁', '#2859df', row => row.len[0]);
    series('ℓ₂', '#cf6a24', row => row.len[1]);
    series('Рекорд L', '#263b52', sum);
    series('Нижняя граница', '#16816b', floor, '6 4');
    const gap = Math.max(0, sum(latest) - latest.bound);
    legend.push('<span>Разрыв <b>' + (gap > 0 && gap < 0.01 ? '&lt; 0,01' : distance.format(gap)) + ' ед.</b></span>');
  }
  const hover = rows.map((row, i) => {
    const edge = i + 1 < rows.length ? x(rows[i + 1].step) : x(run.steps) + 4;
    const tip = 'Шаг ' + integer.format(row.step) + ' · ℓ₁ = ' + distance.format(row.len[0]) + ' · ℓ₂ = ' + distance.format(row.len[1]) +
      ' · L = ' + distance.format(sum(row)) + ' · Нижняя граница = ' + distance.format(row.bound) + ' · Q = ' + number(balanceRatio(row.len));
    return '<rect x="' + x(row.step) + '" y="' + top + '" width="' + (edge - x(row.step)) + '" height="' + (bottom - top) + '" fill="transparent"><title>' + tip + '</title></rect>';
  });
  if (!run.steps) axes.push(label((left + right) / 2, (top + bottom) / 2, 'Первый цикл · шаг 0', 'middle'));
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.innerHTML = axes.join('') + paths.join('') + hover.join('');
  document.getElementById('chart-values').innerHTML = legend.join('');
}
