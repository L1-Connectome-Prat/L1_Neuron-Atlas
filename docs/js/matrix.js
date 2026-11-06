// Compartment Connectivity and Lineage Innervation heatmaps, with the 2D
// compartment maps and lineage tract view in the side panel.

const DATA  = "data/connectivity";
const SVGNS = "http://www.w3.org/2000/svg";
const $     = (id) => document.getElementById(id);

const FONT  = "Inter, system-ui, sans-serif";
const INK   = { text: "#1d1f23", secondary: "#4a4f57", muted: "#6b6f78", rule: "#9aa0a8", hair: "#d3d6db" };
const MUTED_FILL = "#e6e8ec";
const TRACT_INK  = "#2b3442";
const COLORBAR_W = 116;

let meta = null;
let proj = null;
let link = null;
const cache = new Map();


// ---------------------------------------------------------------------------
// Helpers

function json(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${DATA}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}

function text(parent, str, attrs) {
  const t = el("text", { fill: INK.secondary, ...attrs }, parent);
  t.textContent = str;
  return t;
}

// HTML built with textContent only - labels come from data files
function h(tag, cls, str) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (str !== undefined) e.textContent = str;
  return e;
}

const SIDE = /_(Left|Right|Ipsi|Contra)$/;
const base = (name) => name.replace(SIDE, "");
const side = (name) => (name.match(SIDE) || [])[1] || null;

function colorOf(scale, v) {
  if (v === null || v === undefined) return null;
  const t = Math.pow(Math.min(Math.max(v / scale.vmax, 0), 1), scale.gamma);
  return scale.lut[Math.round(t * (scale.lut.length - 1))];
}

function fmt(v, digits = 1) {
  return v === null || v === undefined ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

const compact   = (v) => (v >= 1000 ? `${v / 1000}K` : String(v));
const textWidth = (s, size) => s.length * size * 0.58;

// Runs of consecutive same-side names, broken at spacers
function runs(names) {
  const out = [];
  names.forEach((n, i) => {
    const s = n === "_" ? null : side(n);
    const last = out[out.length - 1];
    if (s && last && last.side === s && last.end === i - 1) last.end = i;
    else if (s) out.push({ side: s, start: i, end: i });
  });
  return out;
}


// ---------------------------------------------------------------------------
// Tooltip - the value leads, the names follow

const tip = $("mx-tooltip");

function showTip(e, value, unit, what, metaLine) {
  tip.replaceChildren();
  const top = h("div");
  top.append(h("span", "value", value), h("span", "unit", unit));
  tip.append(top, h("div", "what", what));
  if (metaLine) tip.append(h("div", "meta", metaLine));
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = `${x}px`;
  tip.style.top  = `${y}px`;
}

const hideTip = () => { tip.hidden = true; };
const named   = (n) => (side(n) ? `${base(n)} (${side(n)})` : base(n));


// ---------------------------------------------------------------------------
// Colour bar: small title, compact ticks, extend-max cap

function colorbar(g, x, y, height, scale, title, subtitle) {
  text(g, title, { x, y, "font-size": 11, "font-weight": 600, fill: INK.text });
  if (subtitle) text(g, subtitle, { x, y: y + 13, "font-size": 10, fill: INK.muted });

  const top = y + (subtitle ? 30 : 18);
  const w   = 10;
  const n   = 64;
  for (let i = 0; i < n; i++) {
    el("rect", { x, y: top + height - (i + 1) * (height / n), width: w, height: height / n + 0.4,
                 fill: scale.lut[Math.round((i / (n - 1)) * (scale.lut.length - 1))] }, g);
  }
  el("path", { d: `M${x} ${top}L${x + w / 2} ${top - 6}L${x + w} ${top}Z`, fill: scale.lut[scale.lut.length - 1] }, g);

  // Top tick first; a label closer than 12px to the previous one is dropped
  let last = -Infinity;
  for (const t of [...scale.ticks].sort((a, b) => b - a)) {
    const ty = top + height * (1 - Math.pow(t / scale.vmax, scale.gamma));
    el("line", { x1: x + w, x2: x + w + 3, y1: ty, y2: ty, stroke: INK.rule, "stroke-width": 1 }, g);
    if (ty - last < 12 && t !== 0) continue;
    text(g, scale.vmax >= 100 ? compact(t) : String(t), { x: x + w + 6, y: ty, "font-size": 10, fill: INK.muted,
                                                           "dominant-baseline": "middle" });
    last = ty;
  }
  return top + height;
}


// ---------------------------------------------------------------------------
// Heatmap figure
//
// rows   : row names shared by every panel
// panels : [{ cols, values[r][c], scale, title, subtitle, mirror, heading, xTitle }]
// Row labels sit left of the first panel, or between the first two panels
// when rowLabels = "between".

function layout(opts, cell) {
  const { rows, panels } = opts;
  const font    = Math.max(Math.min(7, cell), Math.min(11, Math.round(cell * 0.72)));
  const between = opts.rowLabels === "between";
  const rowLab  = Math.max(...rows.map((r) => textWidth(opts.rowText(r), font))) + 10;
  const colLab  = Math.max(...panels.flatMap((p) => p.cols.map((c) => textWidth(base(c), font)))) + 8;
  const left    = (opts.yTitle ? 20 : 0) + (opts.rowGroups ? 22 : 0) + (between ? 0 : rowLab);
  const gapPx   = Math.max(2 * cell, 16);
  const colTop  = opts.colLabels === "top";
  const head    = panels.some((p) => p.heading) ? 30 : 6;
  const top     = colTop ? head + 24 + colLab + 4 : head;

  let x = left;
  const geo = panels.map((p, i) => {
    const g = { x, w: p.cols.length * cell };
    x += g.w + (i < panels.length - 1 ? (between && i === 0 ? rowLab + 12 : gapPx) : 0);
    return g;
  });

  const gridH  = rows.length * cell;
  const labBot = colTop ? head + 18 : top + gridH + 4 + colLab;
  const width  = x + 28 + COLORBAR_W;
  const height = colTop ? top + gridH + 8 : labBot + 30 + (panels.some((p) => p.xTitle) ? 18 : 0) + (opts.padBottom || 0);
  return { font, between, colTop, head, top, geo, gridH, gridR: x, labBot, width, height };
}

const PHONE = matchMedia("(max-width: 760px)");
const TOUCH = matchMedia("(hover: none) and (pointer: coarse)").matches;

function fitCell(container, opts, min, max) {
  if (PHONE.matches) min = Math.max(5, Math.round(min * 0.6));
  const W    = container.clientWidth;
  const H    = container.clientHeight;
  const cols = opts.panels.reduce((s, p) => s + p.cols.length, 0);
  let cell = max;
  for (let k = 0; k < 2; k++) {
    const L  = layout(opts, cell);
    const fx = L.width - cols * cell;
    const fy = L.height - opts.rows.length * cell;
    const byW = (W - fx) / cols;
    cell = Math.floor(opts.fit === "width" ? byW : Math.min(byW, (H - fy) / opts.rows.length));
    cell = Math.max(min, Math.min(max, cell));
  }
  return cell;
}

function drawMatrix(container, opts) {
  const { rows, panels, cell } = opts;
  const L = layout(opts, cell);
  const { font, colTop, head, top, geo, gridH, gridR, labBot, width, height } = L;

  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, xmlns: SVGNS, "font-family": FONT });
  el("rect", { width, height, fill: "#fff" }, svg);
  const bg    = el("g", {}, svg);
  const grid  = el("g", {}, svg);
  const decor = el("g", {}, svg);
  const over  = el("g", { "pointer-events": "none" }, svg);

  const colX = (pi, ci) => geo[pi].x + (panels[pi].mirror ? panels[pi].cols.length - 1 - ci : ci) * cell;

  // Cells, separated by a 1px surface gap
  panels.forEach((p, pi) => {
    el("rect", { x: geo[pi].x, y: top, width: geo[pi].w, height: gridH, fill: "#fff", class: "bg" }, bg);
    p.cols.forEach((c, ci) => {
      if (c === "_") return;
      const cx = colX(pi, ci);
      rows.forEach((r, ri) => {
        const fill = colorOf(p.scale, p.values[ri][ci]);
        if (!fill) return;
        el("rect", { x: cx + 0.5, y: top + ri * cell + 0.5, width: cell - 1, height: cell - 1, fill,
                     class: "cell", "data-r": ri, "data-p": pi, "data-c": ci }, grid);
      });
    });
    if (p.heading) {
      text(decor, p.heading, { x: geo[pi].x + geo[pi].w / 2, y: colTop ? 13 : top - 12, "font-size": 14, "font-weight": 600,
                               fill: INK.text, "text-anchor": "middle" });
    }
  });

  // Hemisphere dividers
  const rowRuns = opts.rowGroups ? runs(rows) : [];
  for (const r of rowRuns.slice(1)) {
    for (const g of geo) {
      el("line", { x1: g.x, x2: g.x + g.w, y1: top + r.start * cell, y2: top + r.start * cell,
                   stroke: INK.rule, "stroke-width": 1 }, decor);
    }
  }
  panels.forEach((p, pi) => {
    runs(p.cols).forEach((r, k, all) => {
      if (k === 0 || all[k - 1].end !== r.start - 1) return;
      const lx = p.mirror ? colX(pi, r.start) + cell : colX(pi, r.start);
      el("line", { x1: lx, x2: lx, y1: top, y2: top + gridH, stroke: INK.rule, "stroke-width": 1 }, decor);
    });
  });

  // Row labels
  const rowX = L.between ? (geo[0].x + geo[0].w + geo[1].x) / 2 : geo[0].x - 6;
  rows.forEach((r, ri) => {
    text(decor, opts.rowText(r), { x: rowX, y: top + ri * cell + cell / 2, "font-size": font,
                                   "text-anchor": L.between ? "middle" : "end",
                                   "dominant-baseline": "middle", class: "tick-label row-label",
                                   "data-kind": "row", "data-r": ri });
  });

  if (opts.rowGroups) {
    const gx = (opts.yTitle ? 20 : 0) + 14;
    for (const r of rowRuns) {
      const y0 = top + r.start * cell + 3;
      const y1 = top + (r.end + 1) * cell - 3;
      el("line", { x1: gx, x2: gx, y1: y0, y2: y1, stroke: INK.hair, "stroke-width": 1.5 }, decor);
      text(decor, r.side, { x: gx - 6, y: (y0 + y1) / 2, "font-size": 10.5, fill: INK.muted, "text-anchor": "middle",
                            transform: `rotate(-90 ${gx - 6} ${(y0 + y1) / 2})` });
    }
  }

  // Column labels and groups
  panels.forEach((p, pi) => {
    p.cols.forEach((c, ci) => {
      if (c === "_") return;
      const cx = colX(pi, ci) + cell / 2;
      const ly = colTop ? top - 5 : top + gridH + 5;
      text(decor, base(c), { x: cx, y: ly, "font-size": font, "text-anchor": colTop ? "start" : "end",
                             "dominant-baseline": "middle",
                             transform: `rotate(-90 ${cx} ${ly})`, class: "tick-label col-label",
                             "data-kind": "col", "data-p": pi, "data-c": ci });
    });
    for (const r of runs(p.cols)) {
      const xa = Math.min(colX(pi, r.start), colX(pi, r.end));
      const xb = Math.max(colX(pi, r.start), colX(pi, r.end)) + cell;
      const gy = colTop ? labBot : labBot + 6;
      el("line", { x1: xa + 3, x2: xb - 3, y1: gy, y2: gy, stroke: INK.hair, "stroke-width": 1.5 }, decor);
      const full = xb - xa >= textWidth(r.side, 10.5) + 10;
      text(decor, full ? r.side : r.side[0], { x: (xa + xb) / 2, y: colTop ? gy - 5 : gy + 14, "font-size": 10.5, fill: INK.muted,
                                               "text-anchor": "middle" });
    }
    if (p.xTitle && !colTop) {
      text(decor, p.xTitle, { x: geo[pi].x + geo[pi].w / 2, y: labBot + 38, "font-size": 11, fill: INK.muted,
                              "text-anchor": "middle" });
    }
  });

  if (opts.yTitle) {
    const cy = top + gridH / 2;
    text(decor, opts.yTitle, { x: 10, y: cy, "font-size": 11, fill: INK.muted, "text-anchor": "middle",
                               transform: `rotate(-90 10 ${cy})` });
  }

  // Colour bars, one per panel, stacked beside the grid
  const cbH = panels.length === 1
    ? Math.max(120, Math.min(320, gridH * 0.6))
    : Math.max(90, Math.min(200, (gridH - (panels.length - 1) * 60) / panels.length - 40));
  let cy = top + 4;
  for (const p of panels) cy = colorbar(decor, gridR + 28, cy, cbH, p.scale, p.title, p.subtitle) + 36;

  // Focus layers
  const mask    = el("path", { fill: "#fff", "fill-opacity": 0.78, "fill-rule": "evenodd" }, over);
  const pinned  = el("rect", { fill: "none", stroke: "#2f5bd3", "stroke-width": 1.5, rx: 1, visibility: "hidden" }, over);
  const outline = el("rect", { fill: "none", stroke: INK.text, "stroke-width": 1.5, rx: 1, visibility: "hidden" }, over);

  const box = (x, y, w, hgt) => `M${x} ${y}h${w}v${hgt}h${-w}Z`;
  const api = {
    svg,
    clear() {
      mask.setAttribute("d", "");
      outline.setAttribute("visibility", "hidden");
      svg.querySelectorAll(".tick-label.on").forEach((t) => t.classList.remove("on"));
    },
    cell(ri, pi, ci) {
      outline.setAttribute("x", colX(pi, ci));
      outline.setAttribute("y", top + ri * cell);
      outline.setAttribute("width", cell);
      outline.setAttribute("height", cell);
      outline.setAttribute("visibility", "visible");
      svg.querySelector(`.row-label[data-r="${ri}"]`)?.classList.add("on");
      svg.querySelector(`.col-label[data-p="${pi}"][data-c="${ci}"]`)?.classList.add("on");
    },
    focusRow(ri) {
      let d = "";
      for (const g of geo) d += box(g.x, top, g.w, gridH) + box(g.x, top + ri * cell, g.w, cell);
      mask.setAttribute("d", d);
      svg.querySelector(`.row-label[data-r="${ri}"]`)?.classList.add("on");
    },
    focusCol(cols) {
      // cols: [[panel, col], ...] - panels without one stay fully masked
      let d = "";
      geo.forEach((g, pi) => {
        d += box(g.x, top, g.w, gridH);
        for (const [p, c] of cols) if (p === pi) d += box(colX(p, c), top, cell, gridH);
      });
      mask.setAttribute("d", d);
      for (const [p, c] of cols) svg.querySelector(`.col-label[data-p="${p}"][data-c="${c}"]`)?.classList.add("on");
    },
    pin(ri) {
      svg.querySelectorAll(".row-label.pinned").forEach((t) => t.classList.remove("pinned"));
      if (ri === null || ri < 0) { pinned.setAttribute("visibility", "hidden"); return; }
      pinned.setAttribute("x", geo[0].x);
      pinned.setAttribute("y", top + ri * cell);
      pinned.setAttribute("width", gridR - geo[0].x);
      pinned.setAttribute("height", cell);
      pinned.setAttribute("visibility", "visible");
      svg.querySelector(`.row-label[data-r="${ri}"]`)?.classList.add("pinned");
    },
  };

  // Pointer events, dispatched to the caller
  let current = "";
  const track = (e) => {
    const t = e.target;
    const d = t.dataset || {};
    if (t.classList.contains("cell")) {
      const key = `c${d.r}.${d.p}.${d.c}`;
      if (key !== current) { current = key; api.clear(); opts.onCell(+d.r, +d.p, +d.c); }
      opts.onCellMove(e, +d.r, +d.p, +d.c);
    } else if (d.kind === "row") {
      if (current !== `r${d.r}`) { current = `r${d.r}`; api.clear(); hideTip(); opts.onRow(+d.r); }
    } else if (d.kind === "col") {
      if (current !== `k${d.p}.${d.c}`) { current = `k${d.p}.${d.c}`; api.clear(); hideTip(); opts.onCol(+d.p, +d.c); }
    } else if (!t.classList.contains("bg")) {
      if (current) { current = ""; api.clear(); hideTip(); opts.onLeave(); }
    }
  };
  const leave = () => { current = ""; api.clear(); hideTip(); opts.onLeave(); };
  svg.addEventListener("mousemove", track);
  svg.addEventListener("mouseleave", leave);
  // Touch has no hover: a tap reads the square, a tap elsewhere clears it
  svg.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") track(e); });
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" && current && !svg.contains(e.target)) leave();
  });
  svg.addEventListener("click", (e) => {
    const d = e.target.dataset || {};
    if (e.target.classList.contains("cell") || d.kind === "row") opts.onClick?.(+d.r);
  });

  container.replaceChildren(svg);
  return api;
}


// ---------------------------------------------------------------------------
// 2D compartment maps: flat, depth-ordered fills with a white surface gap.
// The dorsal view is turned to landscape (anterior to the left) so the long
// VNC lies along the card instead of shrinking the brain.

function frame(svgEl, box, rotate) {
  const [x, y, w, h] = box;
  const vb = rotate ? [-(y + h), x, h, w] : box;
  svgEl.setAttribute("viewBox", vb.join(" "));
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgEl.style.aspectRatio = `${vb[2]} / ${vb[3]}`;
  svgEl.replaceChildren();
  return el("g", rotate ? { transform: "rotate(90)" } : {}, svgEl);
}

function compartmentPaths(g, view, level, fillOf) {
  const colors = meta.colors[level];
  return Object.entries(proj[level])
    .filter(([, e]) => e[view])
    .sort((a, b) => b[1][view].depth - a[1][view].depth)
    .map(([name, e]) => {
      const color = colors[base(name)] || "#999";
      return el("path", { d: e[view].d, fill: fillOf(color), stroke: "#fff", "stroke-width": 0.75,
                          "stroke-linejoin": "round", "data-name": name, "data-color": color }, g);
    });
}

function drawMini(svgEl, view, level) {
  const g     = frame(svgEl, proj.viewbox[view], view === "dorsal");
  const paths = compartmentPaths(g, view, level, (c) => c);

  return {
    highlight(names) {
      for (const p of paths) p.setAttribute("fill", names.has(p.dataset.name) ? p.dataset.color : MUTED_FILL);
      for (const p of paths) if (names.has(p.dataset.name)) g.append(p);
    },
    reset() {
      for (const p of paths) {
        p.setAttribute("fill", p.dataset.color);
        g.append(p);
      }
    },
  };
}

// Atlas colour washed toward white, for a quiet backdrop under the tracts
function tint(hex, k = 0.32) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(255 - (255 - c) * k);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}


// ---------------------------------------------------------------------------
// Compartment Connectivity

const conn = { level: "1", maps: [], data: null };

function compName(name) {
  const level = conn.level === "1" ? "level1" : "level2";
  const wrap  = h("span", "pair-name");
  const dot   = h("span", "dot");
  dot.style.background = meta.colors[level][base(name)] || "#999";
  wrap.append(dot, h("b", null, base(name)), h("span", "side", side(name) || ""));
  return wrap;
}

function connReadout(kind, src, tgt, block, ri, ci) {
  const r = $("conn-readout");
  r.replaceChildren();
  if (!kind) {
    r.append(h("div", "idle", `${TOUCH ? "Tap" : "Hover"} a square to read a connection, or a compartment name to follow its row or column.`));
    return;
  }
  if (kind === "cell") {
    const top = h("div");
    top.append(h("span", "value", fmt(block.weight[ri][ci])), h("span", "unit", "weight"));
    const pair = h("div", "pair");
    pair.append(compName(src), h("span", "arrow", "→"), compName(tgt));
    r.append(top, pair, h("div", "meta",
      `${fmt(block.target_tbars[ri][ci], 0)} target T-bars · ${fmt(block.source_psds[ri][ci], 0)} source PSDs`));
    return;
  }
  const pair = h("div", "pair");
  pair.append(h("span", "arrow", kind === "row" ? "Source" : "Target"), compName(src));
  r.append(pair, h("div", "meta", kind === "row" ? "Its row shows every compartment it projects to."
                                                  : "Its column shows every compartment that projects to it."));
}

async function renderConn() {
  const fig  = $("conn-figure");
  const data = await json(`conn_level${conn.level}.json`);
  conn.data  = data;

  const level = conn.level === "1" ? "level1" : "level2";
  conn.maps   = [drawMini($("mini-anterior"), "anterior", level), drawMini($("mini-dorsal"), "dorsal", level)];
  connReadout(null);

  const panels = data.blocks.map((b) => ({
    cols:     b.cols,
    values:   b.data.weight,
    scale:    meta.scales[b.scale],
    title:    data.blocks.length > 1 ? (b.key === "vnc" ? "SEZ–VNC" : "Brain") : "Connection weight",
    subtitle: data.blocks.length > 1 ? "connection weight" : "",
    xTitle:   b.key === "vnc" ? "Target SEZ–VNC segment" : "Target neuropil compartment",
  }));

  const opts = { rows: data.rows, rowText: base, panels, rowGroups: true, yTitle: "Source neuropil compartment" };
  opts.cell  = fitCell(fig, opts, conn.level === "1" ? 12 : 7, conn.level === "1" ? 24 : 12);

  const light = (names) => conn.maps.forEach((m) => m.highlight(new Set(names)));
  const api = drawMatrix(fig, {
    ...opts,
    onCell(ri, pi, ci) {
      const src = data.rows[ri];
      const tgt = data.blocks[pi].cols[ci];
      api.cell(ri, pi, ci);
      light([src, tgt]);
      connReadout("cell", src, tgt, data.blocks[pi].data, ri, ci);
    },
    onCellMove(e, ri, pi, ci) {
      const b = data.blocks[pi].data;
      showTip(e, fmt(b.weight[ri][ci]), "weight", `${named(data.rows[ri])} → ${named(data.blocks[pi].cols[ci])}`,
              `${fmt(b.target_tbars[ri][ci], 0)} target T-bars · ${fmt(b.source_psds[ri][ci], 0)} source PSDs`);
    },
    onRow(ri) {
      api.focusRow(ri);
      light([data.rows[ri]]);
      connReadout("row", data.rows[ri]);
    },
    onCol(pi, ci) {
      api.focusCol([[pi, ci]]);
      light([data.blocks[pi].cols[ci]]);
      connReadout("col", data.blocks[pi].cols[ci]);
    },
    onLeave() {
      conn.maps.forEach((m) => m.reset());
      connReadout(null);
    },
  });

}

function syncLevel() {
  $("conn-level").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === conn.level));
}

// The weight formula, typeset with KaTeX when it loads; plain text otherwise

const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
const WEIGHT_TEX = String.raw`\begin{aligned} w(s \rightarrow t) &= \Big(\sum_{i \in \mathcal{S}} \mathrm{PSDs}_i(s)\Big) \\ &\times \frac{\sum_{i \in \mathcal{S}} \mathrm{TBars}_i(t)}{\sum_{j \in t} \mathrm{TBars}_j(t)} \end{aligned}`;

async function typesetFormula() {
  try {
    const css = document.createElement("link");
    css.rel  = "stylesheet";
    css.href = `${KATEX}katex.min.css`;
    document.head.append(css);
    const { default: katex } = await import(`${KATEX}katex.mjs`);
    katex.render(WEIGHT_TEX, $("conn-formula"), { displayMode: true, throwOnError: false });
    $("conn-terms").querySelectorAll("dt[data-tex]").forEach((dt) => {
      katex.render(dt.dataset.tex, dt, { throwOnError: false });
    });
  } catch { /* the plain-text fallback stays */ }
}

export async function mountConnectivity(l) {
  link = l;
  typesetFormula();
  await loadShared();
  conn.level = link.getParam("lvl") === "2" ? "2" : "1";
  syncLevel();
  $("conn-level").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.v === conn.level) return;
    conn.level = b.dataset.v;
    syncLevel();
    link.setParams({ lvl: conn.level === "2" ? "2" : null });
    renderConn();
  };
  await renderConn();
}


// ---------------------------------------------------------------------------
// Lineage Innervation

const inn = { level: "1", region: "brain", data: null, index: null, pinned: null, shown: null, path: null, api: null };

function innReadout(name, neurons) {
  const r = $("inn-readout");
  r.replaceChildren();
  if (!name) {
    r.append(h("div", "idle", TOUCH ? "Tap a lineage to keep its tracts in view." : "Hover a lineage to preview its tracts. Click it to keep it in view."));
    return;
  }
  r.append(h("div", "value", name));
  r.append(h("div", "meta", neurons === null ? "No Diff Neurons"
                                             : `${neurons} Diff Neuron${neurons === 1 ? "" : "s"}`));
  if (inn.pinned === name) {
    const kept = h("div", "kept");
    const btn  = h("button", "link", "Release");
    btn.onclick = () => togglePin(name);
    kept.append(h("span", "chip-level", "Kept"), btn);
    r.append(kept);
  }
}

async function drawTract(name) {
  const svgEl = $("tract-map");
  if (!inn.path) {
    const [ax, ay, aw, ah] = proj.viewbox.anterior;
    const [tx, ty, tw, th] = proj.viewbox.tract;
    const x0 = Math.min(ax, tx), y0 = Math.min(ay, ty);
    const g  = frame(svgEl, [x0, y0, Math.max(ax + aw, tx + tw) - x0, Math.max(ay + ah, ty + th) - y0], false);
    compartmentPaths(g, "anterior", "level1", (c) => tint(c));
    inn.path = el("path", { fill: "none", stroke: TRACT_INK, "stroke-width": 0.6, "stroke-opacity": 0.85,
                            "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
  }

  inn.shown = name;
  if (!name) { inn.path.setAttribute("d", ""); innReadout(null); return; }

  const key = inn.index[name];
  if (!key) { inn.path.setAttribute("d", ""); innReadout(name, null); return; }
  const t = await json(`tracts/${key}.json`);
  if (inn.shown !== name) return;
  inn.path.setAttribute("d", t.d);
  innReadout(name, t.neurons);
}

function togglePin(name) {
  inn.pinned = inn.pinned === name ? null : name;
  inn.api?.pin(inn.pinned ? inn.data.rows.indexOf(inn.pinned) : null);
  link.setParams({ lin: inn.pinned });
  drawTract(inn.pinned ?? name);
}

// Level 1 keeps the SEZ and VNC beside the brain; Level 2 shows the brain
// and the SEZ-VNC segments as separate figures, on the Figure 3 scales.
async function innBlock() {
  if (inn.level === "1") {
    const d = await json("innervation_level1.json");
    return { rows: d.rows, block: d, scales: ["innervation_input", "innervation_output"], cell: [11, 15] };
  }
  const d = await json("innervation_level2.json");
  const r = inn.region;
  return { rows: d.rows, block: d[r], scales: [`innervation_l2_${r}_input`, `innervation_l2_${r}_output`],
           cell: r === "brain" ? [6, 12] : [11, 15] };
}

async function renderInn() {
  const fig = $("inn-figure");
  const { rows, block, scales, cell } = await innBlock();
  inn.data = { rows };

  const panels = [
    { cols: block.cols, values: block.input, scale: meta.scales[scales[0]], mirror: true,
      heading: "Input", title: "Input", subtitle: "fraction of PSDs" },
    { cols: block.cols, values: block.output, scale: meta.scales[scales[1]], mirror: false,
      heading: "Output", title: "Output", subtitle: "fraction of TBars" },
  ];

  const opts = { rows, rowText: (r) => r, panels, rowLabels: "between", fit: "width", padBottom: 24 };
  opts.cell  = fitCell(fig, opts, cell[0], cell[1]);

  const preview = (ri) => drawTract(ri === null ? inn.pinned : rows[ri]);
  const api = drawMatrix(fig, {
    ...opts,
    onCell(ri, pi, ci) { api.cell(ri, pi, ci); preview(ri); },
    onCellMove(e, ri, pi, ci) {
      showTip(e, fmt(panels[pi].values[ri][ci], 3), pi === 0 ? "input fraction" : "output fraction",
              `${rows[ri]} · ${named(block.cols[ci])}`);
    },
    onRow(ri)     { api.focusRow(ri); preview(ri); },
    onCol(pi, ci) { api.focusCol([[0, ci], [1, ci]]); },
    onLeave()     { preview(null); },
    onClick(ri)   { togglePin(rows[ri]); },
  });

  inn.api = api;
  if (inn.pinned) api.pin(rows.indexOf(inn.pinned));
}

function syncInn() {
  $("inn-level").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === inn.level));
  $("inn-region").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === inn.region));
  $("inn-region-block").hidden = inn.level !== "2";
  $("inn-chip").textContent = inn.level === "1" ? "Level 1"
                            : `Level 2 · ${inn.region === "brain" ? "Brain" : "SEZ–VNC"}`;
  link.setParams({ ilvl: inn.level === "2" ? "2" : null,
                   ireg: inn.level === "2" && inn.region === "vnc" ? "vnc" : null });
}

function segHandler(id, key) {
  $(id).onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.v === inn[key]) return;
    inn[key] = b.dataset.v;
    syncInn();
    renderInn();
  };
}

export async function mountInnervation(l) {
  link = l;
  await loadShared();
  const [d1, index] = await Promise.all([json("innervation_level1.json"), json("tracts/index.json")]);
  inn.index  = index;
  inn.level  = link.getParam("ilvl") === "2" ? "2" : "1";
  inn.region = link.getParam("ireg") === "vnc" ? "vnc" : "brain";
  const lin  = link.getParam("lin");
  inn.pinned = lin && d1.rows.includes(lin) ? lin : null;
  syncInn();
  segHandler("inn-level", "level");
  segHandler("inn-region", "region");
  await renderInn();
  drawTract(inn.pinned);
}


// ---------------------------------------------------------------------------
// Shared

async function loadShared() {
  if (!meta) [meta, proj] = await Promise.all([json("meta.json"), json("projections.json")]);
}

export function refresh(tab) {
  if (tab === "connectivity" && conn.data) renderConn();
  if (tab === "innervation" && inn.data) renderInn();
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$("tab-connectivity").hidden && conn.data) renderConn();
    if (!$("tab-innervation").hidden && inn.data) renderInn();
  }, 200);
});
