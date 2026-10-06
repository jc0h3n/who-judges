// Small dependency-free chart kit: HTML bars, SVG lines and dot plots, one shared tooltip.
// Marks follow fixed specs: bars <=18px with a 4px rounded data-end, 2px lines, r>=4 dots with a
// 2px surface ring, hairline grids, text in ink tokens (never the series color).

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmtPct = v => (v * 100).toFixed(v > 0 && v < 0.01 ? 1 : 0) + "%";
export const fmtInt = v => Math.round(v).toLocaleString("en-US");
export const fmtSigned = (v, d = 2) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const tickNum = t => (t < 0 ? "−" : "") + Math.abs(t);

// ---- Tooltip ---------------------------------------------------------------------
const tip = document.createElement("div");
tip.className = "tip"; tip.hidden = true; tip.setAttribute("role", "status");
document.body.appendChild(tip);
export function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
}
export const hideTip = () => { tip.hidden = true; };
function bindTips(root) {
  root.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("pointermove", e => showTip(el.dataset.tip, e.clientX, e.clientY));
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); showTip(el.dataset.tip, r.right, r.top); });
    el.addEventListener("blur", hideTip);
  });
}

export function legend(items) {
  return `<div class="legend">${items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join("")}</div>`;
}

// ---- Horizontal bars (one series) -------------------------------------------------
// items: [{label, value, note}] ; value is a share 0..1 unless opts.format says otherwise
export function hbars(el, items, { format = fmtPct, max, tipText } = {}) {
  const m = max ?? Math.max(...items.map(i => i.value), 1e-9);
  el.innerHTML = `<div class="hbars">${items.map(i => `
    <div class="hbar${i.cls ? " " + i.cls : ""}" tabindex="0" data-tip="${esc(tipText ? tipText(i) : `<b>${esc(i.label)}</b><br>${format(i.value)}`)}">
      <span class="hbar-label">${esc(i.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${(100 * i.value / m).toFixed(2)}%"></span>
      <span class="hbar-val">${format(i.value)}</span></span>
    </div>`).join("")}</div>`;
  bindTips(el);
}

// ---- Horizontal stacked bars --------------------------------------------------------
// items: [{label, segments: [{key, value, color}]}] ; values are counts
export function stackedHbars(el, items, keys, noun = "judges") {
  const m = Math.max(...items.map(i => i.segments.reduce((t, s) => t + s.value, 0)), 1);
  el.innerHTML = legend(keys) + `<div class="hbars">${items.map(i => {
    const total = i.segments.reduce((t, s) => t + s.value, 0);
    const detail = i.segments.filter(s => s.value).map(s => `${esc(s.key)}: ${s.value}`).join("<br>");
    return `<div class="hbar" tabindex="0" data-tip="${esc(`<b>${esc(i.label)}</b><br>${total} ${noun}<br>${detail}`)}">
      <span class="hbar-label">${esc(i.label)}</span>
      <span class="hbar-track"><span class="stack" style="width:${(100 * total / m).toFixed(2)}%">${i.segments.filter(s => s.value)
        .map(s => `<span style="flex:${s.value};background:${s.color}"></span>`).join("")}</span>
      <span class="hbar-val">${total}</span></span></div>`;
  }).join("")}</div>`;
  bindTips(el);
}

// ---- Columns (histogram) -----------------------------------------------------------------
// bins: [{label, value, tip}] ; every Nth label shown
export function columns(el, bins, { labelEvery = 1, format = fmtInt } = {}) {
  const m = Math.max(...bins.map(b => b.value), 1);
  el.innerHTML = `<div class="cols">${bins.map((b, i) => `
    <div class="col" tabindex="0" data-tip="${esc(b.tip || `<b>${esc(b.label)}</b><br>${format(b.value)}`)}">
      <span class="col-bar" style="height:${(100 * b.value / m).toFixed(2)}%"></span>
      <span class="col-label">${i % labelEvery === 0 ? esc(b.label) : ""}</span>
    </div>`).join("")}</div>`;
  bindTips(el);
}

// ---- Line chart over Congresses --------------------------------------------------------------
// series: [{label, color, points: [{x, y}]}] ; x = year. Points more than `step` apart are not joined.
export function lines(el, series, { yFormat = fmtPct, xLabel = x => x, marker, yMin, yMax, height = 220, step = 2 } = {}) {
  const W = Math.max(el.clientWidth, 280), H = height, L = 44, R = 12, T = 10, B = 26;
  const xs = series.flatMap(s => s.points.map(p => p.x)), ys = series.flatMap(s => s.points.map(p => p.y));
  if (!xs.length) { el.innerHTML = `<p class="muted">No data for this selection.</p>`; return; }
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = yMin ?? Math.min(...ys), y1 = yMax ?? Math.max(...ys);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const ticks = niceTicks(y0, y1, 4); y0 = Math.min(y0, ticks[0]); y1 = Math.max(y1, ticks.at(-1));
  const sx = x => L + (W - L - R) * (x - x0) / (x1 - x0 || 1);
  const sy = y => T + (H - T - B) * (1 - (y - y0) / (y1 - y0));
  const xt = niceTicks(x0, x1, Math.min(6, Math.floor(W / 90))).filter(t => t >= x0 && t <= x1 && Number.isInteger(t));
  const allX = [...new Set(xs)].sort((a, b) => a - b);
  const path = pts => pts.map((p, i) => `${i && p.x - pts[i - 1].x <= step ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  el.innerHTML = (series.length > 1 ? legend(series) : "") + `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">
      ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/><text class="axis" x="${L - 6}" y="${sy(t) + 4}" text-anchor="end">${yFormat(t)}</text>`).join("")}
      ${xt.map(t => `<text class="axis" x="${sx(t)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(t))}</text>`).join("")}
      ${marker != null && marker >= x0 && marker <= x1 ? `<line class="marker" x1="${sx(marker)}" x2="${sx(marker)}" y1="${T}" y2="${H - B}"/>` : ""}
      ${series.map(s => `<path d="${path(s.points)}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join("")}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <g class="dots"></g>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;
  const svg = el.querySelector("svg"), cross = svg.querySelector(".cross"), dots = svg.querySelector(".dots");
  svg.addEventListener("pointermove", e => {
    const box = svg.getBoundingClientRect();
    const px = (e.clientX - box.left) * W / box.width;
    const raw = x0 + (px - L) / (W - L - R) * (x1 - x0);
    const x = allX.reduce((best, v) => Math.abs(v - raw) < Math.abs(best - raw) ? v : best, allX[0]);
    cross.setAttribute("x1", sx(x)); cross.setAttribute("x2", sx(x)); cross.setAttribute("visibility", "visible");
    const hits = series.map(s => ({ s, p: s.points.find(p => p.x === x) })).filter(h => h.p);
    dots.innerHTML = hits.map(h => `<circle cx="${sx(x)}" cy="${sy(h.p.y)}" r="4.5" style="fill:${h.s.color}" class="ring"/>`).join("");
    showTip(`<b>${esc(xLabel(x, true))}</b>${hits.map(h => `<br><i class="key" style="background:${h.s.color}"></i>${esc(h.s.label)}: ${yFormat(h.p.y)}${h.p.n != null ? ` <span class="muted">(n=${h.p.n})</span>` : ""}`).join("")}`, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); dots.innerHTML = ""; hideTip(); });
}

// ---- Dot plot (scatter or 1-D strip) ------------------------------------------------------------
// points: [{x, y, color, tip}] ; if opts.strip, y is ignored and points are jittered per row key
export function dots(el, points, { xDomain = [-1, 1], yDomain = [-1, 1], xTitle = "", yTitle = "", strip = false, rows = [], height = 360 } = {}) {
  const W = Math.max(el.clientWidth, 280), H = strip ? Math.max(rows.length * 70 + 40, 120) : height;
  const L = strip ? 96 : 44, R = 12, T = 10, B = 34;
  const sx = x => L + (W - L - R) * (x - xDomain[0]) / (xDomain[1] - xDomain[0]);
  const sy = y => T + (H - T - B) * (1 - (y - yDomain[0]) / (yDomain[1] - yDomain[0]));
  const xt = niceTicks(xDomain[0], xDomain[1], 4);
  let pts = points;
  if (strip) {
    const band = (H - T - B) / rows.length;
    // deterministic jitter so the layout is stable across renders
    pts = points.map((p, i) => {
      const r = rows.findIndex(row => row.key === p.row);
      const j = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
      return { ...p, py: T + band * (r + 0.5) + j * band * 0.7 };
    });
  }
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">
      ${xt.map(t => `<line class="grid" x1="${sx(t)}" x2="${sx(t)}" y1="${T}" y2="${H - B}"/><text class="axis" x="${sx(t)}" y="${H - B + 16}" text-anchor="middle">${tickNum(t)}</text>`).join("")}
      ${strip ? rows.map((row, r) => `<text class="axis rowlab" x="${L - 10}" y="${T + (H - T - B) / rows.length * (r + 0.5) + 4}" text-anchor="end">${esc(row.label)}</text>`).join("")
        : niceTicks(yDomain[0], yDomain[1], 4).map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}"/><text class="axis" x="${L - 6}" y="${sy(t) + 4}" text-anchor="end">${tickNum(t)}</text>`).join("")}
      <text class="axis" x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle">${esc(xTitle)}</text>
      ${!strip && yTitle ? `<text class="axis" transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(yTitle)}</text>` : ""}
      ${pts.map((p, i) => `<circle class="ring pt" data-i="${i}" cx="${sx(p.x).toFixed(1)}" cy="${(strip ? p.py : sy(p.y)).toFixed(1)}" r="4" style="fill:${p.color}"/>`).join("")}
    </svg>`;
  const svg = el.querySelector("svg");
  svg.addEventListener("pointermove", e => {
    const c = e.target.closest(".pt");
    if (!c) return hideTip();
    showTip(pts[+c.dataset.i].tip, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", hideTip);
}

export function niceTicks(a, b, n) {
  const span = b - a || 1, step0 = span / Math.max(n, 1);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
  const out = [];
  for (let t = Math.floor(a / step) * step; t <= b + step * 1e-9; t += step) out.push(+t.toFixed(10));
  if (out.at(-1) < b) out.push(+(out.at(-1) + step).toFixed(10));
  return out;
}
