import * as THREE from "three";
import { TrackballControls }   from "three/addons/controls/TrackballControls.js";
import { LineSegments2 }       from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial }        from "three/addons/lines/LineMaterial.js";


// ---------------------------------------------------------------------------
// Constants

const DATA          = "data";
const NA_DIFF_COLOR = "#8c8c8c";
const NA_SU_COLOR   = "#c4c4c4";
const SU_CLASS_COLOR = "#bdbdbd";
const BRAIN_COLOR   = "#9aa0a8";
const NEUROPIL_COLOR = "#8e9ab4";
const COMP_OPACITY  = 0.18;
const BG_COLOR      = "#ffffff";
const SU_WIDTH      = 0.6;
const SU_OPACITY    = 0.8;
const CAM_DIST      = 800;

const COMPARTMENT_COLORS = [
  "#7fa7d4", "#d49a7f", "#8fc48f", "#bd9bd0", "#cdbd7c", "#7fc4c4",
  "#d08fae", "#a9a97f", "#9a9ad0", "#c9a27f", "#7fcfa9", "#b0b0b0",
];

const DEFAULTS = {
  lineage: "",
  hemi:    "B",
  cat:     "D",
  colorby: "type",
  width:   1.5,
  alpha:   1,
  brainOpacity: 0.1,
  compStyle: {},
  brain:    true,
  neuropil: false,
  comps:   [],
  hidden:  [],
  cam:     null,
};


// ---------------------------------------------------------------------------
// State

const state = structuredClone(DEFAULTS);

let manifest     = null;
let lineageInfo  = null;
let palette      = [];
let neuronObjs   = [];
let groupMats    = new Map();
let groupList    = [];
let compMeshes   = new Map();
let compColor    = new Map();
const contextMeshes = { brain: null, neuropil: null };
let loadToken    = 0;

const bufferCache = new Map();
const $           = (id) => document.getElementById(id);


// ---------------------------------------------------------------------------
// Scene

const canvas   = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(BG_COLOR, 1);

const scene  = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
scene.add(camera);
scene.add(new THREE.AmbientLight(0xffffff, 1.6));

const headlight = new THREE.DirectionalLight(0xffffff, 1.4);
headlight.position.set(0.3, 0.5, 1);
camera.add(headlight);

const neuronGroup = new THREE.Group();
const compGroup   = new THREE.Group();
scene.add(compGroup);
scene.add(neuronGroup);

const controls = new TrackballControls(camera, canvas);
controls.rotateSpeed = 3.0;
controls.zoomSpeed   = 1.2;
controls.panSpeed    = 0.9;
controls.staticMoving = true;

let viewHalfHeight = 60;
const center       = new THREE.Vector3();

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.left   = -viewHalfHeight * aspect;
  camera.right  =  viewHalfHeight * aspect;
  camera.top    =  viewHalfHeight;
  camera.bottom = -viewHalfHeight;
  camera.updateProjectionMatrix();
  controls.handleResize();
  for (const m of groupMats.values()) m.line.resolution.set(w, h);
  requestRender();
}

window.addEventListener("resize", resize);

let dirty = true;

function requestRender() {
  dirty = true;
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
}

controls.addEventListener("change", requestRender);


// ---------------------------------------------------------------------------
// Camera presets (frontal = x right, y down, matching the 2D figures)

const VIEWS = {
  frontal: { dir: [0, 0, -1], up: [0, -1, 0], axes: [0, 1] },
  dorsal:  { dir: [0, -1, 0], up: [0, 0, 1],  axes: [0, 2] },
  lateral: { dir: [1, 0, 0],  up: [0, -1, 0], axes: [2, 1] },
};

let extent = [100, 100, 100];

function fitZoom(axes) {
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const need   = Math.max(extent[axes[1]] / 2, extent[axes[0]] / 2 / aspect) * 1.08;
  return viewHalfHeight / need;
}

function setView(name) {
  const v = VIEWS[name];
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(...v.dir), CAM_DIST);
  camera.up.set(...v.up);
  camera.zoom = fitZoom(v.axes);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.update();
  requestRender();
  scheduleHash();
}

function cameraState() {
  const r = (v) => [v.x, v.y, v.z].map((n) => +n.toFixed(3));
  return [...r(camera.position), ...r(camera.up), ...r(controls.target), +camera.zoom.toFixed(4)];
}

function applyCamera(c) {
  if (!c || c.length !== 10) return false;
  camera.position.set(c[0], c[1], c[2]);
  camera.up.set(c[3], c[4], c[5]);
  controls.target.set(c[6], c[7], c[8]);
  camera.zoom = c[9];
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  controls.update();
  requestRender();
  return true;
}

controls.addEventListener("end", scheduleHash);


// ---------------------------------------------------------------------------
// Colors

function mix(hex, target, t) {
  const a = new THREE.Color(hex);
  return "#" + a.lerp(new THREE.Color(target), t).getHexString();
}

function paletteColor(i) {
  const base = palette[i % palette.length];
  const loop = Math.floor(i / palette.length);
  return loop === 0 ? base : mix(base, "#000000", Math.min(0.3 * loop, 0.7));
}

function pastel(hex) {
  return mix(hex, "#ffffff", 0.55);
}

function groupKey(n) {
  if (state.colorby === "class") {
    return n.category === "Diff" ? `C:${n.acronym}` : "S:all";
  }
  const c = n.cluster ?? "NA";
  return n.category === "Diff" ? `D:${c}` : `S:${c}`;
}

function buildGroups() {
  const present = new Map();
  for (const o of neuronObjs) {
    const k = groupKey(o.n);
    present.set(k, (present.get(k) || 0) + 1);
  }

  const both   = state.cat === "B";
  const groups = [];

  if (state.colorby === "type") {
    for (const t of lineageInfo.types.Diff || []) {
      const key = `D:${t.cluster ?? "NA"}`;
      if (!present.has(key)) continue;
      const color = t.cluster == null ? NA_DIFF_COLOR : paletteColor(t.cluster - 1);
      groups.push({ key, label: t.label, color, section: "Diff", su: false });
    }
    for (const t of lineageInfo.types.SU || []) {
      const key = `S:${t.cluster ?? "NA"}`;
      if (!present.has(key)) continue;
      let color = t.cluster == null ? NA_SU_COLOR : paletteColor(t.cluster - 1);
      if (both && t.cluster != null) color = pastel(color);
      groups.push({ key, label: t.label, color, section: "SU", su: true });
    }
  } else {
    let i = 0;
    for (const acr of lineageInfo.classes) {
      const key = `C:${acr}`;
      if (acr === "NA") {
        if (present.has(key)) groups.push({ key, label: "NA", color: NA_DIFF_COLOR, section: "Diff", su: false });
        continue;
      }
      const color = paletteColor(i++);
      if (present.has(key)) groups.push({ key, label: acr, color, section: "Diff", su: false });
    }
    if (present.has("S:all")) {
      groups.push({ key: "S:all", label: "SU", color: SU_CLASS_COLOR, section: "SU", su: true });
    }
  }

  for (const g of groups) g.count = present.get(g.key);
  return groups;
}

function applyStyles() {
  for (const m of groupMats.values()) { m.line.dispose(); m.soma.dispose(); }
  groupMats.clear();
  groupList = buildGroups();

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const thin = state.cat === "B";

  for (const g of groupList) {
    const su   = g.su && thin;
    const line = new LineMaterial({
      color:      g.color,
      linewidth:  state.width * (su ? SU_WIDTH : 1),
      worldUnits: false,
    });
    line.resolution.set(w, h);
    const soma = new THREE.MeshLambertMaterial({ color: g.color });
    const m    = { line, soma, group: g };
    setNeuronAlpha(m);
    groupMats.set(g.key, m);
  }

  const hidden = new Set(state.hidden);
  for (const o of neuronObjs) {
    const key = groupKey(o.n);
    const m   = groupMats.get(key);
    o.key     = key;
    o.line.material = m.line;
    if (o.soma) o.soma.material = m.soma;
    setVisible(o, !hidden.has(key));
  }

  renderLegend();
  requestRender();
}

function setNeuronAlpha(m) {
  const su = m.group.su && state.cat === "B";
  const op = state.alpha * (su ? SU_OPACITY : 1);
  for (const mat of [m.line, m.soma]) {
    const transparent = op < 1;
    if (mat.transparent !== transparent) mat.needsUpdate = true;
    mat.transparent = transparent;
    mat.opacity     = op;
    mat.depthWrite  = !transparent;
  }
}

function setVisible(o, v) {
  o.line.visible = v;
  if (o.soma) o.soma.visible = v;
}

function applyHidden() {
  const hidden = new Set(state.hidden);
  for (const o of neuronObjs) setVisible(o, !hidden.has(o.key));
  renderLegend();
  requestRender();
  scheduleHash();
}


// ---------------------------------------------------------------------------
// Data loading

async function fetchJSON(path) {
  const r = await fetch(`${DATA}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function fetchBuffer(path) {
  if (!bufferCache.has(path)) {
    bufferCache.set(path, fetch(`${DATA}/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.arrayBuffer();
    }));
  }
  return bufferCache.get(path);
}

function status(msg) {
  const el = $("status");
  el.hidden = !msg;
  el.textContent = msg || "";
}

function clearNeurons() {
  for (const o of neuronObjs) {
    o.line.geometry.dispose();
    if (o.soma) o.soma.geometry.dispose();
  }
  neuronGroup.clear();
  neuronObjs = [];
  requestRender();
}

function buildNeuron(n, pos, par) {
  const segs = [];
  const o0   = n.offset;
  for (let i = 0; i < n.n; i++) {
    const p = par[o0 + i];
    if (p < 0) continue;
    const a = (o0 + p) * 3;
    const b = (o0 + i) * 3;
    segs.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
  }

  const geom = new LineSegmentsGeometry();
  geom.setPositions(segs);
  const line = new LineSegments2(geom);
  line.userData.neuron = n;
  neuronGroup.add(line);

  let soma = null;
  if (n.soma) {
    const r = Math.min(Math.max(n.soma[3], 0.3), 6);
    soma    = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14));
    soma.position.set(n.soma[0], n.soma[1], n.soma[2]);
    soma.userData.neuron = n;
    neuronGroup.add(soma);
  }

  return { n, line, soma, pos, par, key: null };
}

async function loadNeurons() {
  const token = ++loadToken;
  clearNeurons();
  $("empty").hidden = !!state.lineage;
  $("legend").hidden = true;
  $("lineage-meta").textContent = "";

  if (!state.lineage) { lineageInfo = null; return; }

  status("Loading…");
  try {
    if (!lineageInfo || lineageInfo.key !== state.lineage) {
      lineageInfo = await fetchJSON(`lineages/${state.lineage}.json`);
    }
    if (token !== loadToken) return;

    const cats  = state.cat === "B" ? ["Diff", "SU"] : [state.cat === "D" ? "Diff" : "SU"];
    const hemis = state.hemi === "B" ? ["Left", "Right"] : [state.hemi === "L" ? "Left" : "Right"];
    const files = cats.flatMap((c) => hemis.map((h) => `${c}_${h}`))
                      .filter((f) => lineageInfo.files[f]);

    const buffers = await Promise.all(files.map((f) => fetchBuffer(lineageInfo.files[f].path)));
    if (token !== loadToken) return;

    files.forEach((f, i) => {
      const nodes = lineageInfo.files[f].nodes;
      const pos   = new Float32Array(buffers[i], 0, nodes * 3);
      const par   = new Int32Array(buffers[i], nodes * 12, nodes);
      for (const n of lineageInfo.neurons) {
        if (n.file === f) neuronObjs.push(buildNeuron(n, pos, par));
      }
    });

    const diff = neuronObjs.filter((o) => o.n.category === "Diff").length;
    const su   = neuronObjs.length - diff;
    $("lineage-meta").textContent = neuronObjs.length
      ? `${diff} Diff · ${su} SU neurons shown`
      : "No neurons for this selection";

    applyStyles();
    status("");
  } catch (err) {
    status(`Failed to load: ${err.message}`);
  }
}


// ---------------------------------------------------------------------------
// Compartments

function meshFromBuffer(buf, nv, nf, material) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf, 0, nv * 3), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, nv * 12, nf * 3), 1));
  geom.computeVertexNormals();
  return new THREE.Mesh(geom, material);
}

function compMaterial(color, opacity) {
  return new THREE.MeshLambertMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });
}

function findComp(id) {
  for (const p of manifest.compartments) {
    if (p.id === id) return p;
    for (const c of p.children) if (c.id === id) return c;
  }
  return null;
}

async function syncCompartments() {
  const wanted = new Set(state.comps);

  for (const [k, mesh] of compMeshes) {
    if (!wanted.has(k)) { mesh.visible = false; }
  }

  await Promise.all([...wanted].map(async (k) => {
    if (compMeshes.has(k)) { compMeshes.get(k).visible = true; return; }
    const [id, side] = k.split(".");
    const comp = findComp(id);
    if (!comp) return;
    const s    = comp.sides[side === "L" ? "Left" : "Right"];
    const buf  = await fetchBuffer(s.file);
    const mesh = meshFromBuffer(buf, s.nv, s.nf, compMaterial(compColorOf(id), compAlphaOf(id)));
    mesh.renderOrder = 1;
    compMeshes.set(k, mesh);
    compGroup.add(mesh);
    mesh.visible = new Set(state.comps).has(k);
  }));

  syncContext();
  renderTree();
  requestRender();
  scheduleHash();
}

function compColorOf(id) {
  return state.compStyle[id]?.c ?? compColor.get(id);
}

function compAlphaOf(id) {
  return state.compStyle[id]?.a ?? COMP_OPACITY;
}

function applyOpacity() {
  for (const [k, mesh] of compMeshes) {
    const id = k.split(".")[0];
    mesh.material.color.set(compColorOf(id));
    mesh.material.opacity = compAlphaOf(id);
  }
  for (const mesh of Object.values(contextMeshes)) {
    if (mesh) mesh.material.opacity = state.brainOpacity;
  }
  requestRender();
}

function syncContext() {
  for (const [key, mesh] of Object.entries(contextMeshes)) {
    if (mesh) mesh.visible = state[key];
  }
  requestRender();
}


// ---------------------------------------------------------------------------
// Compartment color picker

const picker = $("picker");
let pickerId = null;

function openPicker(id, anchor) {
  pickerId = id;
  $("picker-title").textContent = id;
  $("picker-color").value = compColorOf(id);
  $("picker-alpha").value = compAlphaOf(id);
  $("picker-alpha-out").textContent = compAlphaOf(id).toFixed(2);
  picker.hidden = false;

  // Beside the panel on wide screens, under the swatch on narrow ones
  const r      = anchor.getBoundingClientRect();
  const panel  = $("panel").getBoundingClientRect();
  const beside = panel.right + picker.offsetWidth + 16 <= window.innerWidth;
  const left   = beside ? panel.right + 8 : r.left;
  const top    = beside ? r.top - 12 : r.bottom + 6;
  picker.style.left = `${Math.max(8, Math.min(left, window.innerWidth - picker.offsetWidth - 8))}px`;
  picker.style.top  = `${Math.max(8, Math.min(top, window.innerHeight - picker.offsetHeight - 8))}px`;
}

function closePicker() {
  picker.hidden = true;
  pickerId = null;
}

function updatePicked(patch) {
  if (!pickerId) return;
  const cur = state.compStyle[pickerId] || {};
  state.compStyle[pickerId] = { ...cur, ...patch };
  document.querySelectorAll(`.node-row .swatch[data-id="${CSS.escape(pickerId)}"]`)
          .forEach((el) => { el.style.background = compColorOf(pickerId); });
  applyOpacity();
  scheduleHash();
}

function bindPicker() {
  $("picker-color").addEventListener("input", (e) => updatePicked({ c: e.target.value }));
  $("picker-alpha").addEventListener("input", (e) => {
    $("picker-alpha-out").textContent = (+e.target.value).toFixed(2);
    updatePicked({ a: +e.target.value });
  });
  $("picker-reset").addEventListener("click", () => {
    if (!pickerId) return;
    const id = pickerId;
    const sw = document.querySelector(`.node-row .swatch[data-id="${CSS.escape(id)}"]`);
    delete state.compStyle[id];
    if (sw) sw.style.background = compColorOf(id);
    applyOpacity();
    scheduleHash();
    if (sw) openPicker(id, sw);
  });
  $("picker-close").addEventListener("click", closePicker);
  document.addEventListener("pointerdown", (e) => {
    if (!picker.hidden && !picker.contains(e.target) && !e.target.closest(".node-row .swatch")) closePicker();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
  $("panel").addEventListener("scroll", closePicker);
}

function toggleComp(key) {
  const s = new Set(state.comps);
  s.has(key) ? s.delete(key) : s.add(key);
  state.comps = [...s];
  syncCompartments();
}

const expanded = new Set();

function renderTree() {
  const tree = $("tree");
  const on   = new Set(state.comps);
  tree.innerHTML = "";

  const row = (comp, child) => {
    const el = document.createElement("div");
    el.className = "node-row" + (child ? " child" : "");

    const caret = document.createElement("button");
    caret.className = "caret" + (!child && comp.children.length ? "" : " empty");
    caret.textContent = expanded.has(comp.id) ? "▾" : "▸";
    caret.setAttribute("aria-label", `Expand ${comp.id}`);
    caret.onclick = () => {
      expanded.has(comp.id) ? expanded.delete(comp.id) : expanded.add(comp.id);
      renderTree();
    };

    const sw = document.createElement("button");
    sw.className = "swatch";
    sw.dataset.id = comp.id;
    sw.title = `Color / opacity of ${comp.id}`;
    sw.setAttribute("aria-label", `Color and opacity of ${comp.id}`);
    sw.style.background = compColorOf(comp.id);
    sw.onclick = () => (pickerId === comp.id ? closePicker() : openPicker(comp.id, sw));

    const name = document.createElement("span");
    name.className = "node-name";
    name.textContent = comp.id;

    el.append(caret, sw, name);
    for (const side of ["L", "R"]) {
      const chip = document.createElement("button");
      const key  = `${comp.id}.${side}`;
      chip.className = "chip" + (on.has(key) ? " on" : "");
      chip.textContent = side;
      chip.title = `${comp.id} ${side === "L" ? "Left" : "Right"}`;
      chip.onclick = () => toggleComp(key);
      el.append(chip);
    }
    return el;
  };

  for (const p of manifest.compartments) {
    tree.append(row(p, false));
    if (p.children.length) {
      const box = document.createElement("div");
      box.className = "children";
      box.hidden = !expanded.has(p.id);
      for (const c of p.children) box.append(row(c, true));
      tree.append(box);
    }
  }
}


// ---------------------------------------------------------------------------
// Legend

function renderLegend() {
  const body   = $("legend-body");
  const hidden = new Set(state.hidden);
  body.innerHTML = "";
  $("legend").hidden = groupList.length === 0;
  $("legend-title").textContent = state.colorby === "type" ? "Types" : "Classes";

  let section = null;
  const sections = new Set(groupList.map((g) => g.section)).size > 1;

  for (const g of groupList) {
    if (sections && g.section !== section) {
      section = g.section;
      const h = document.createElement("div");
      h.className = "legend-section";
      h.textContent = section;
      body.append(h);
    }
    const el = document.createElement("div");
    el.className = "legend-item" + (hidden.has(g.key) ? " off" : "");
    el.title = g.label;
    el.innerHTML = `<span class="swatch"></span><span class="name"></span><span class="count"></span>`;
    el.querySelector(".swatch").style.background = g.color;
    el.querySelector(".name").textContent = g.label;
    el.querySelector(".count").textContent = g.count;

    let clickTimer = null;
    el.onclick = () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        const s = new Set(state.hidden);
        s.has(g.key) ? s.delete(g.key) : s.add(g.key);
        state.hidden = [...s];
        applyHidden();
      }, 220);
    };
    el.ondblclick = () => {
      clearTimeout(clickTimer);
      const others = groupList.filter((x) => x.key !== g.key).map((x) => x.key);
      const isolated = !hidden.has(g.key) && others.every((k) => hidden.has(k));
      state.hidden = isolated ? [] : others;
      applyHidden();
    };
    body.append(el);
  }
}


// ---------------------------------------------------------------------------
// Tooltip

const raycaster = new THREE.Raycaster();
raycaster.params.Line2 = { threshold: 6 };
raycaster.camera = camera;

let pointerDown  = false;
let hoverPending = false;
let lastPointer  = null;

canvas.addEventListener("pointerdown", () => { pointerDown = true; $("tooltip").hidden = true; });
window.addEventListener("pointerup", () => { pointerDown = false; });
canvas.addEventListener("pointerleave", () => { $("tooltip").hidden = true; });

canvas.addEventListener("pointermove", (e) => {
  if (pointerDown) return;
  lastPointer = e;
  if (hoverPending) return;
  hoverPending = true;
  setTimeout(() => { hoverPending = false; hover(lastPointer); }, 90);
});

function hover(e) {
  const tip = $("tooltip");
  if (!neuronObjs.length || pointerDown) { tip.hidden = true; return; }

  const rect = canvas.getBoundingClientRect();
  const ndc  = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1,
                                 -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);

  const targets = [];
  for (const o of neuronObjs) {
    if (!o.line.visible) continue;
    targets.push(o.line);
    if (o.soma) targets.push(o.soma);
  }
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) { tip.hidden = true; return; }

  const n = hit.object.userData.neuron;
  const g = groupMats.get(groupKey(n))?.group;
  tip.innerHTML = `<b></b><div class="dim"></div><div></div>`;
  tip.children[0].textContent = n.name;
  tip.children[1].textContent = `${n.category} · ${n.hemisphere} · Type ${n.cluster_raw} · ${n.acronym}`;
  tip.children[2].textContent = n.identifier !== "NA" ? n.identifier : (g ? g.label : "");
  tip.hidden = false;

  const x = e.clientX - rect.left + 14;
  const y = e.clientY - rect.top + 14;
  tip.style.left = `${Math.min(x, rect.width - tip.offsetWidth - 8)}px`;
  tip.style.top  = `${Math.min(y, rect.height - tip.offsetHeight - 8)}px`;
}


// ---------------------------------------------------------------------------
// Export

function filename(ext) {
  const lin = lineageInfo ? lineageInfo.name.replace(/[\/\s]/g, "") : "L1";
  return `L1-Atlas_${lin}_${state.colorby}.${ext}`;
}

function download(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

function renderToDataURL(scale, transparent, onlyMeshes = false) {
  const w   = canvas.clientWidth;
  const h   = canvas.clientHeight;
  const dpr = renderer.getPixelRatio();

  const hiddenObjs = [];
  if (onlyMeshes) {
    for (const o of neuronGroup.children) if (o.visible) { o.visible = false; hiddenObjs.push(o); }
  }

  renderer.setPixelRatio(scale);
  renderer.setSize(w, h, false);
  renderer.setClearColor(BG_COLOR, transparent ? 0 : 1);
  renderer.render(scene, camera);
  const url = canvas.toDataURL("image/png");

  for (const o of hiddenObjs) o.visible = true;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  renderer.setClearColor(BG_COLOR, 1);
  renderer.render(scene, camera);
  return url;
}

function exportPNG() {
  const scale = +$("png-scale").value;
  download(renderToDataURL(scale, $("png-transparent").checked), filename("png"));
}

function neuronPolylines(o) {
  // Split the tree into unbranched chains, each walked from a leaf or
  // branch point up to the next branch point or root
  const { n, par } = o;
  const kids = new Int32Array(n.n);
  for (let i = 0; i < n.n; i++) {
    const p = par[n.offset + i];
    if (p >= 0) kids[p]++;
  }
  const chains = [];
  for (let i = 0; i < n.n; i++) {
    if (par[n.offset + i] < 0) continue;
    if (kids[i] === 1) continue;
    const chain = [i];
    let j = i;
    while (true) {
      const p = par[n.offset + j];
      if (p < 0) break;
      chain.push(p);
      if (kids[p] !== 1 || par[n.offset + p] < 0) break;
      j = p;
    }
    chains.push(chain);
  }
  return chains;
}

function exportSVG() {
  const w     = canvas.clientWidth;
  const h     = canvas.clientHeight;
  const under = renderToDataURL(2, true, true);
  const v     = new THREE.Vector3();
  const pxPerUm = h / ((camera.top - camera.bottom) / camera.zoom);

  const project = (x, y, z) => {
    v.set(x, y, z).project(camera);
    return [(v.x + 1) * 0.5 * w, (1 - v.y) * 0.5 * h, v.z];
  };

  const visible = neuronObjs.filter((o) => o.line.visible);
  const items   = visible.map((o) => {
    const pts = new Array(o.n.n);
    let depth = 0;
    for (let i = 0; i < o.n.n; i++) {
      const k = (o.n.offset + i) * 3;
      pts[i]  = project(o.pos[k], o.pos[k + 1], o.pos[k + 2]);
      depth  += pts[i][2];
    }
    return { o, pts, depth: depth / o.n.n };
  });
  items.sort((a, b) => b.depth - a.depth);

  const byGroup = new Map();
  for (const it of items) {
    if (!byGroup.has(it.o.key)) byGroup.set(it.o.key, []);
    byGroup.get(it.o.key).push(it);
  }

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  out.push(`<defs><clipPath id="frame"><rect width="${w}" height="${h}"/></clipPath></defs>`);
  if (!$("png-transparent").checked) out.push(`<rect width="${w}" height="${h}" fill="${BG_COLOR}"/>`);
  out.push(`<image id="compartments" width="${w}" height="${h}" xlink:href="${under}" href="${under}"/>`);
  out.push(`<g id="neurons" clip-path="url(#frame)" fill="none" stroke-linecap="round" stroke-linejoin="round">`);

  for (const g of groupList) {
    const list = byGroup.get(g.key);
    if (!list) continue;
    const m = groupMats.get(g.key).line;
    out.push(`<g id="${esc(g.label)}" stroke="${g.color}" stroke-width="${m.linewidth}"${m.opacity < 1 ? ` stroke-opacity="${m.opacity}"` : ""}>`);
    for (const it of list) {
      let d = "";
      for (const chain of neuronPolylines(it.o)) {
        chain.forEach((idx, k) => {
          const p = it.pts[idx];
          d += `${k ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
        });
      }
      out.push(`<path data-name="${esc(it.o.n.name)}" d="${d}"/>`);
      if (it.o.soma) {
        const s = it.o.n.soma;
        const c = project(s[0], s[1], s[2]);
        const r = Math.min(Math.max(s[3], 0.3), 6) * pxPerUm * camera.zoom;
        out.push(`<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${r.toFixed(2)}" fill="${g.color}"${m.opacity < 1 ? ` fill-opacity="${m.opacity}"` : ""} stroke="none"/>`);
      }
    }
    out.push(`</g>`);
  }
  out.push(`</g></svg>`);

  const blob = new Blob([out.join("\n")], { type: "image/svg+xml" });
  const url  = URL.createObjectURL(blob);
  download(url, filename("svg"));
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


// ---------------------------------------------------------------------------
// URL state

let hashTimer = null;

function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 300);
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.lineage)        p.set("l", state.lineage);
  if (state.hemi !== "B")   p.set("h", state.hemi);
  if (state.cat !== "D")    p.set("c", state.cat);
  if (state.colorby !== "type") p.set("col", state.colorby);
  if (state.width !== DEFAULTS.width)     p.set("w", state.width);
  if (state.brainOpacity !== DEFAULTS.brainOpacity) p.set("bo", state.brainOpacity);
  if (state.alpha !== DEFAULTS.alpha)     p.set("na", state.alpha);
  const cs = Object.entries(state.compStyle)
                   .map(([id, v]) => `${id}~${(v.c || "").replace("#", "")}~${v.a ?? ""}`);
  if (cs.length)            p.set("cs", cs.join(","));
  if (!state.brain)         p.set("bm", "0");
  if (state.neuropil)       p.set("np", "1");
  if (state.comps.length)   p.set("comp", state.comps.join(","));
  if (state.hidden.length)  p.set("hide", state.hidden.join(","));
  p.set("cam", cameraState().join(","));
  history.replaceState(null, "", "#" + p.toString());
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = structuredClone(DEFAULTS);
  if (p.has("l"))    s.lineage = p.get("l");
  if (p.has("h"))    s.hemi    = p.get("h");
  if (p.has("c"))    s.cat     = p.get("c");
  if (p.has("col"))  s.colorby = p.get("col");
  if (p.has("w"))    s.width   = +p.get("w");
  if (p.has("bo"))   s.brainOpacity = +p.get("bo");
  if (p.has("na"))   s.alpha   = +p.get("na");
  if (p.get("cs")) {
    for (const item of p.get("cs").split(",")) {
      const [id, c, a] = item.split("~");
      const v = {};
      if (c) v.c = `#${c}`;
      if (a) v.a = +a;
      s.compStyle[id] = v;
    }
  }
  if (p.has("bm"))   s.brain    = p.get("bm") !== "0";
  if (p.has("np"))   s.neuropil = p.get("np") === "1";
  if (p.get("comp")) s.comps   = p.get("comp").split(",");
  if (p.get("hide")) s.hidden  = p.get("hide").split(",");
  if (p.get("cam"))  s.cam     = p.get("cam").split(",").map(Number);
  return s;
}


// ---------------------------------------------------------------------------
// Controls

function bindSeg(id, key, onChange) {
  const el = $(id);
  const sync = () => el.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === state[key]));
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.v === state[key]) return;
    state[key] = b.dataset.v;
    sync();
    onChange();
    scheduleHash();
  });
  sync();
  return sync;
}

const syncers = [];

function syncInputs() {
  $("lineage").value = state.lineage;
  $("width").value   = state.width;
  $("alpha").value   = state.alpha;
  $("alpha-out").textContent   = state.alpha.toFixed(2);
  $("opacity").value = state.brainOpacity;
  $("width-out").textContent   = `${state.width}px`;
  $("opacity-out").textContent = state.brainOpacity.toFixed(2);
  $("brain").checked    = state.brain;
  $("neuropil").checked = state.neuropil;
  syncers.forEach((f) => f());
}

function bindControls() {
  const sel = $("lineage");
  for (const l of manifest.lineages) {
    const opt = document.createElement("option");
    const d   = (l.counts.Diff_Left || 0) + (l.counts.Diff_Right || 0);
    const s   = (l.counts.SU_Left || 0) + (l.counts.SU_Right || 0);
    opt.value = l.key;
    opt.textContent = `${l.name}  (${d} Diff${s ? `, ${s} SU` : ""})`;
    sel.append(opt);
  }
  sel.addEventListener("change", () => {
    state.lineage = sel.value;
    state.hidden  = [];
    loadNeurons();
    scheduleHash();
  });

  syncers.push(bindSeg("hemi", "hemi", () => { loadNeurons(); }));
  syncers.push(bindSeg("cat", "cat", () => { state.hidden = []; loadNeurons(); }));
  syncers.push(bindSeg("colorby", "colorby", () => { state.hidden = []; if (lineageInfo) applyStyles(); }));

  $("views").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setView(b.dataset.v);
  });

  $("width").addEventListener("input", (e) => {
    state.width = +e.target.value;
    $("width-out").textContent = `${state.width}px`;
    const thin = state.cat === "B";
    for (const m of groupMats.values()) {
      m.line.linewidth = state.width * (m.group.su && thin ? SU_WIDTH : 1);
    }
    requestRender();
    scheduleHash();
  });

  $("alpha").addEventListener("input", (e) => {
    state.alpha = +e.target.value;
    $("alpha-out").textContent = state.alpha.toFixed(2);
    for (const m of groupMats.values()) setNeuronAlpha(m);
    requestRender();
    scheduleHash();
  });

  $("opacity").addEventListener("input", (e) => {
    state.brainOpacity = +e.target.value;
    $("opacity-out").textContent = state.brainOpacity.toFixed(2);
    applyOpacity();
    scheduleHash();
  });

  for (const key of ["brain", "neuropil"]) {
    $(key).addEventListener("change", (e) => {
      state[key] = e.target.checked;
      syncContext();
      scheduleHash();
    });
  }

  $("comp-clear").addEventListener("click", () => { state.comps = []; syncCompartments(); });

  $("legend-all").addEventListener("click", () => { state.hidden = []; applyHidden(); });
  $("legend-none").addEventListener("click", () => { state.hidden = groupList.map((g) => g.key); applyHidden(); });

  $("export-png").addEventListener("click", exportPNG);
  $("export-svg").addEventListener("click", exportSVG);

  $("copy-link").addEventListener("click", async () => {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      flash($("copy-link"), "Copied");
    } catch {
      prompt("Copy this link:", location.href);
    }
  });

  $("clear-all").addEventListener("click", () => {
    Object.assign(state, structuredClone(DEFAULTS));
    expanded.clear();
    closePicker();
    syncInputs();
    applyOpacity();
    syncCompartments();
    loadNeurons();
    setView("frontal");
  });
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1200);
}


// ---------------------------------------------------------------------------
// Init

async function init() {
  manifest = await fetchJSON("manifest.json");
  palette  = manifest.palette;

  let i = 0;
  for (const p of manifest.compartments) {
    compColor.set(p.id, COMPARTMENT_COLORS[i++ % COMPARTMENT_COLORS.length]);
    for (const c of p.children) compColor.set(c.id, COMPARTMENT_COLORS[i++ % COMPARTMENT_COLORS.length]);
  }

  const brain = manifest.context.brain;
  center.set(...brain.center);
  extent = [0, 1, 2].map((k) => brain.max[k] - brain.min[k]);
  viewHalfHeight = Math.max(...extent) * 0.55;

  Object.assign(state, readHash());
  bindControls();
  bindPicker();
  syncInputs();
  resize();
  if (!applyCamera(state.cam)) setView("frontal");
  animate();

  const colors = { brain: BRAIN_COLOR, neuropil: NEUROPIL_COLOR };
  await Promise.all(Object.keys(contextMeshes).map(async (key) => {
    const info = manifest.context[key];
    const buf  = await fetchBuffer(info.file);
    const mesh = meshFromBuffer(buf, info.nv, info.nf, compMaterial(colors[key], state.brainOpacity));
    mesh.renderOrder   = 0;
    contextMeshes[key] = mesh;
    compGroup.add(mesh);
  }));
  applyOpacity();
  syncContext();

  await syncCompartments();
  await loadNeurons();
}

init().catch((err) => status(`Failed to start: ${err.message}`));
