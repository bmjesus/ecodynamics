'use strict';

// Plot navigation is a view over saved results. Hover uses the full output arrays.
window.EcoPlots = (() => {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const colors = ['#287c67', '#be7b39', '#547ca4', '#9c6f96', '#84914d', '#b36056', '#5b9a99', '#856c48'];
  const views = new Map();
  let nextId = 0;

  function htmlElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function svgElement(tag, attributes = {}, text) {
    const element = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function numberLabel(value, precision = 5) {
    return Number(value).toLocaleString('en-GB', {maximumSignificantDigits: precision});
  }

  function tickLabel(value, domain) {
    const magnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]), 1);
    const precision = Math.min(12, Math.max(5, Math.ceil(Math.log10(magnitude / (domain[1] - domain[0]))) + 2));
    return numberLabel(value, precision);
  }

  function lowerBound(times, time) {
    let low = 0;
    let high = times.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (times[middle] < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function nearestIndex(times, time) {
    const right = lowerBound(times, time);
    if (right === 0) return 0;
    if (right === times.length) return right - 1;
    return time - times[right - 1] <= times[right] - time ? right - 1 : right;
  }

  function constrain(domain, full) {
    const fullSpan = full[1] - full[0];
    const span = Math.max(fullSpan / 1e6, Math.min(domain[1] - domain[0], fullSpan));
    const low = Math.max(full[0], Math.min(domain[0], full[1] - span));
    return [low, low + span];
  }

  function render(container, plots, runs, timeUnit) {
    container.replaceChildren();
    for (const plot of plots) {
      const ids = plot.ids.filter(id => runs.some(run => run.series.some(series => series.id === id)));
      if (ids.length) container.append(createPlot(plot, ids, runs, timeUnit));
    }
    if (!container.childElementCount) {
      container.append(htmlElement('p', 'plot-instructions', 'Choose at least one series to display.'));
    }
  }

  function createPlot(plot, ids, runs, timeUnit) {
    const independent = plot.independent && ids.length === 2;
    const width = 760;
    const height = 270;
    const left = 78;
    const right = width - (independent ? 85 : 25);
    const top = 20;
    const bottom = height - 48;
    const clipId = `plot-clip-${++nextId}`;
    const key = JSON.stringify([plot.title, ids, independent]);
    const seriesFor = (run, id) => run.series.find(series => series.id === id);
    const axisFor = index => independent ? index : 0;
    const fullX = [Math.min(...runs.map(run => run.times[0])), Math.max(...runs.map(run => run.times.at(-1)))];
    if (fullX[0] === fullX[1]) fullX[1] = fullX[0] + 1;
    const fullY = (independent ? ids.map(id => [id]) : [ids]).map(axisIds => {
      let low = Infinity;
      let high = -Infinity;
      for (const run of runs) {
        for (const id of axisIds) {
          const series = seriesFor(run, id);
          if (!series) continue;
          for (const value of series.values) {
            low = Math.min(low, value);
            high = Math.max(high, value);
          }
        }
      }
      const padding = (high - low || Math.abs(high) || 1) * 0.08;
      return [low - padding, high + padding];
    });
    const saved = views.get(key);
    let xDomain = constrain(saved?.x || fullX, fullX);
    let yDomains = fullY.map((domain, index) => constrain(saved?.y[index] || domain, domain));
    let drag = null;
    const card = htmlElement('section', 'chart-card');
    const heading = htmlElement('div', 'plot-heading');
    heading.append(htmlElement('h3', '', plot.title));
    const controls = htmlElement('div', 'plot-controls');
    function button(label, text, action) {
      const control = htmlElement('button', '', text);
      control.type = 'button';
      control.setAttribute('aria-label', `${label} ${plot.title}`);
      control.title = label;
      control.addEventListener('click', action);
      controls.append(control);
      return control;
    }
    button('Zoom in', '+', () => zoom(0.7, (left + right) / 2, (top + bottom) / 2));
    button('Zoom out', '−', () => zoom(1 / 0.7, (left + right) / 2, (top + bottom) / 2));
    const resetButton = button('Reset zoom', 'Reset', reset);
    heading.append(controls);
    card.append(heading);
    const legend = htmlElement('div', 'chart-legend');
    ids.forEach((id, index) => {
      const series = runs.map(run => seriesFor(run, id)).find(Boolean);
      const item = htmlElement('span', '');
      const swatch = htmlElement('i', '');
      swatch.style.background = colors[index % colors.length];
      item.append(swatch, document.createTextNode(`${series.name}${series.unit ? ` (${series.unit})` : ''}${independent ? index ? ' · right axis' : ' · left axis' : ''}`));
      legend.append(item);
    });
    if (runs.length > 1) legend.append(htmlElement('span', '', 'Current run: solid · retained runs: dashed'));
    card.append(legend);
    const viewport = htmlElement('div', 'plot-viewport');
    const svg = svgElement('svg', {class: 'chart-svg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': plot.title, tabindex: '0'});
    const tooltip = htmlElement('div', 'plot-tooltip');
    tooltip.hidden = true;
    viewport.append(svg, tooltip);
    card.append(viewport, htmlElement('p', 'plot-instructions', 'Drag to zoom · Wheel to zoom · Shift-drag to pan · Double-click to reset'));
    const xPixel = time => left + (time - xDomain[0]) / (xDomain[1] - xDomain[0]) * (right - left);
    const timeAt = pixel => xDomain[0] + (pixel - left) / (right - left) * (xDomain[1] - xDomain[0]);
    const yPixel = (value, axis) => bottom - (value - yDomains[axis][0]) / (yDomains[axis][1] - yDomains[axis][0]) * (bottom - top);
    const valueAt = (pixel, domain) => domain[0] + (bottom - pixel) / (bottom - top) * (domain[1] - domain[0]);

    function draw() {
      tooltip.hidden = true;
      svg.replaceChildren();
      svg.dataset.xMin = xDomain[0];
      svg.dataset.xMax = xDomain[1];
      svg.dataset.yDomains = JSON.stringify(yDomains);
      resetButton.disabled = !views.has(key);
      const definitions = svgElement('defs');
      const clip = svgElement('clipPath', {id: clipId});
      clip.append(svgElement('rect', {x: left, y: top, width: right - left, height: bottom - top}));
      definitions.append(clip);
      svg.append(definitions);
      for (let tick = 0; tick < 5; tick++) {
        const y = top + (bottom - top) * tick / 4;
        svg.append(svgElement('path', {d: `M${left},${y} H${right}`, stroke: '#edf1e8'}));
        svg.append(svgElement('text', {x: left - 10, y: y + 3, 'font-size': 9, 'text-anchor': 'end', fill: '#8c9b81'}, tickLabel(valueAt(y, yDomains[0]), yDomains[0])));
        if (independent) svg.append(svgElement('text', {x: right + 10, y: y + 3, 'font-size': 9, fill: colors[1]}, tickLabel(valueAt(y, yDomains[1]), yDomains[1])));
      }
      for (let tick = 0; tick < 6; tick++) {
        const x = left + (right - left) * tick / 5;
        svg.append(svgElement('text', {x, y: bottom + 20, 'font-size': 9, 'text-anchor': 'middle', fill: '#8c9b81'}, tickLabel(timeAt(x), xDomain)));
      }
      svg.append(svgElement('text', {x: (left + right) / 2, y: height - 5, 'text-anchor': 'middle', 'font-size': 9, fill: '#8c9b81'}, `Time (${timeUnit})`));
      const lines = svgElement('g', {'clip-path': `url(#${clipId})`});
      runs.forEach((run, runIndex) => {
        const first = Math.max(0, lowerBound(run.times, xDomain[0]) - 1);
        const last = Math.min(run.times.length - 1, lowerBound(run.times, xDomain[1]));
        const stride = Math.max(1, Math.ceil((last - first) / 2000));
        ids.forEach((id, index) => {
          const series = seriesFor(run, id);
          if (!series) return;
          let path = '';
          function point(sample) {
            path += `${path ? 'L' : 'M'}${xPixel(run.times[sample]).toFixed(3)},${yPixel(series.values[sample], axisFor(index)).toFixed(3)} `;
          }
          for (let sample = first; sample < last; sample += stride) point(sample);
          point(last);
          lines.append(svgElement('path', {class: 'plot-series', d: path, stroke: colors[index % colors.length], 'stroke-width': runIndex === runs.length - 1 ? 2.4 : 1.8, 'stroke-dasharray': runIndex === runs.length - 1 ? 'none' : `${5 + runIndex * 2} ${3 + runIndex}`, opacity: runIndex === runs.length - 1 ? 1 : 0.65, fill: 'none'}));
        });
      });
      svg.append(lines, svgElement('g', {class: 'plot-hover', 'clip-path': `url(#${clipId})`, 'pointer-events': 'none'}));
      svg.append(svgElement('rect', {class: 'plot-selection', x: 0, y: 0, width: 0, height: 0, fill: '#287c6722', stroke: '#287c67', 'pointer-events': 'none'}));
    }

    function remember() {
      views.set(key, {x: [...xDomain], y: yDomains.map(domain => [...domain])});
      draw();
    }

    function reset() {
      drag = null;
      views.delete(key);
      xDomain = [...fullX];
      yDomains = fullY.map(domain => [...domain]);
      draw();
    }

    function zoom(factor, x, y) {
      const anchor = timeAt(x);
      xDomain = constrain(xDomain.map(value => anchor + (value - anchor) * factor), fullX);
      yDomains = yDomains.map((domain, index) => {
        const anchorY = valueAt(y, domain);
        return constrain(domain.map(value => anchorY + (value - anchorY) * factor), fullY[index]);
      });
      remember();
    }

    function position(event) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    }

    function inside(point) {
      return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    }

    function clearHover() {
      tooltip.hidden = true;
      svg.querySelector('.plot-hover').replaceChildren();
    }

    function hover(event, point) {
      clearHover();
      if (!inside(point)) return;
      const time = timeAt(point.x);
      const markers = svg.querySelector('.plot-hover');
      tooltip.replaceChildren(htmlElement('div', 'plot-tooltip-heading', 'Saved sample values'));
      for (const run of [...runs].reverse()) {
        if (time < run.times[0] || time > run.times.at(-1)) continue;
        const sample = nearestIndex(run.times, time);
        const sampleTime = run.times[sample];
        tooltip.append(htmlElement('div', 'plot-tooltip-run', `${run.label} · Time ${numberLabel(sampleTime, 8)} ${timeUnit}`));
        ids.forEach((id, index) => {
          const series = seriesFor(run, id);
          if (!series) return;
          const row = htmlElement('div', 'plot-tooltip-row');
          row.append(htmlElement('span', '', `${series.name}${series.unit ? ` (${series.unit})` : ''}`), htmlElement('strong', '', numberLabel(series.values[sample], 8)));
          tooltip.append(row);
          markers.append(svgElement('circle', {cx: xPixel(sampleTime), cy: yPixel(series.values[sample], axisFor(index)), r: 4, fill: colors[index % colors.length], stroke: '#fff', 'stroke-width': 1.5}));
        });
      }
      const current = runs.at(-1);
      const sampleTime = current.times[nearestIndex(current.times, time)];
      markers.prepend(svgElement('line', {x1: xPixel(sampleTime), x2: xPixel(sampleTime), y1: top, y2: bottom, stroke: '#75998c', 'stroke-dasharray': '3 3'}));
      if (!tooltip.querySelector('.plot-tooltip-row')) return;
      tooltip.hidden = false;
      const rect = viewport.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      tooltip.style.left = `${Math.max(4, Math.min(cursorX + 14, rect.width - tooltip.offsetWidth - 4))}px`;
      tooltip.style.top = `${Math.max(0, Math.min(cursorY + 14, rect.height - tooltip.offsetHeight))}px`;
    }

    svg.addEventListener('wheel', event => {
      const point = position(event);
      if (!inside(point)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      zoom(Math.exp(Math.max(-500, Math.min(500, delta)) * 0.002), point.x, point.y);
    }, {passive: false});
    svg.addEventListener('dblclick', event => {
      event.preventDefault();
      reset();
    });
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const point = position(event);
      if (!inside(point)) return;
      event.preventDefault();
      clearHover();
      drag = {start: point, x: [...xDomain], y: yDomains.map(domain => [...domain]), pan: event.shiftKey};
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
      const point = position(event);
      if (!drag) {
        hover(event, point);
        return;
      }
      point.x = Math.max(left, Math.min(right, point.x));
      point.y = Math.max(top, Math.min(bottom, point.y));
      if (drag.pan) {
        const shiftX = (drag.start.x - point.x) / (right - left) * (drag.x[1] - drag.x[0]);
        xDomain = constrain(drag.x.map(value => value + shiftX), fullX);
        yDomains = drag.y.map((domain, index) => {
          const shiftY = (point.y - drag.start.y) / (bottom - top) * (domain[1] - domain[0]);
          return constrain(domain.map(value => value + shiftY), fullY[index]);
        });
        remember();
      } else {
        const selection = svg.querySelector('.plot-selection');
        selection.setAttribute('x', Math.min(point.x, drag.start.x));
        selection.setAttribute('y', Math.min(point.y, drag.start.y));
        selection.setAttribute('width', Math.abs(point.x - drag.start.x));
        selection.setAttribute('height', Math.abs(point.y - drag.start.y));
      }
    });
    svg.addEventListener('pointerup', event => {
      if (!drag) return;
      const point = position(event);
      point.x = Math.max(left, Math.min(right, point.x));
      point.y = Math.max(top, Math.min(bottom, point.y));
      if (!drag.pan) {
        if (Math.abs(point.x - drag.start.x) > 6) xDomain = constrain([timeAt(Math.min(point.x, drag.start.x)), timeAt(Math.max(point.x, drag.start.x))], fullX);
        if (Math.abs(point.y - drag.start.y) > 6) yDomains = drag.y.map((domain, index) => constrain([valueAt(Math.max(point.y, drag.start.y), domain), valueAt(Math.min(point.y, drag.start.y), domain)], fullY[index]));
        remember();
      }
      drag = null;
      svg.releasePointerCapture(event.pointerId);
    });
    svg.addEventListener('pointercancel', () => {
      if (drag) {
        xDomain = drag.x;
        yDomains = drag.y;
        drag = null;
        remember();
      }
    });
    svg.addEventListener('pointerleave', event => {
      if (!drag && !tooltip.contains(event.relatedTarget)) clearHover();
    });
    tooltip.addEventListener('pointerleave', event => {
      if (!svg.contains(event.relatedTarget)) clearHover();
    });
    svg.addEventListener('keydown', event => {
      if (event.key === '0' || event.key === 'Escape') reset();
      else if (event.key === '+' || event.key === '=') zoom(0.7, (left + right) / 2, (top + bottom) / 2);
      else if (event.key === '-') zoom(1 / 0.7, (left + right) / 2, (top + bottom) / 2);
      else return;
      event.preventDefault();
    });
    draw();
    return card;
  }

  return {render, reset: () => views.clear()};
})();
