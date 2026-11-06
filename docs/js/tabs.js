// Tab switching for the atlas: Anatomy, Compartment Connectivity, Lineage
// Innervation. The heatmap tabs are loaded the first time they are opened.

const TABS    = ["anatomy", "connectivity", "innervation"];
const VERSION = new URL(import.meta.url).search;
const $       = (id) => document.getElementById(id);

let matrix = null;
const mounted = new Set();


// ---------------------------------------------------------------------------
// Link state shared with the other tab scripts

export function getParam(key) {
  return new URLSearchParams(location.hash.slice(1)).get(key);
}

export function setParams(values) {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  history.replaceState(null, "", "#" + p.toString());
}


// ---------------------------------------------------------------------------
// Tabs

async function show(tab) {
  if (!TABS.includes(tab)) tab = "anatomy";

  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`#tabs [data-tab="${t}"]`).setAttribute("aria-selected", t === tab);
  }
  setParams({ tab: tab === "anatomy" ? null : tab });

  if (tab === "anatomy") {
    // The 3D canvas measures itself on resize; it had no size while hidden
    window.dispatchEvent(new Event("resize"));
    return;
  }

  if (!matrix) matrix = await import(`./matrix.js${VERSION}`);
  if (!mounted.has(tab)) {
    mounted.add(tab);
    const link = { getParam, setParams };
    await (tab === "connectivity" ? matrix.mountConnectivity(link) : matrix.mountInnervation(link));
  } else {
    matrix.refresh(tab);
  }
}

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) show(b.dataset.tab);
});


// ---------------------------------------------------------------------------
// About

$("about-open").addEventListener("click", () => { $("about").hidden = false; });
$("about-close").addEventListener("click", () => { $("about").hidden = true; });
$("about").addEventListener("click", (e) => { if (e.target.id === "about") $("about").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("about").hidden = true; });


// ---------------------------------------------------------------------------
// Controls drawer on tablets and phones: the panel slides in over the view.
// On wider screens the CSS keeps the panel in place and none of this shows.

const scrim = document.createElement("div");
scrim.id = "panel-scrim";
document.body.append(scrim);

function setDrawer(open) {
  document.body.classList.toggle("panel-open", open);
  $("panel-toggle").setAttribute("aria-expanded", open);
}

$("panel-toggle").addEventListener("click", () => setDrawer(!document.body.classList.contains("panel-open")));
scrim.addEventListener("click", () => setDrawer(false));
document.querySelectorAll(".drawer-close").forEach((b) => b.addEventListener("click", () => setDrawer(false)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("picker").hidden) setDrawer(false); });
matchMedia("(max-width: 1024px)").addEventListener("change", () => setDrawer(false));
$("tabs").addEventListener("click", () => setDrawer(false));


// A pasted link that only changes the #... part reloads the whole view
window.addEventListener("hashchange", () => location.reload());

show(getParam("tab") || "anatomy");
