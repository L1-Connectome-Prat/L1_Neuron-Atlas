# L1 Neuron Atlas

An interactive 3D atlas of the neurons of the first-instar *Drosophila* larval
(L1) connectome. The atlas brings together three companion repositories: the
skeletons from [L1_Skeletons](https://github.com/KandimallaPrat/L1_Skeletons),
the neuropil compartments from
[L1_Compartment-Atlas](https://github.com/L1-Connectome-Prat/L1_Compartment-Atlas),
and the morphological typing from
[L1_Neuron-Typing](https://github.com/L1-Connectome-Prat/L1_Neuron-Typing). Every neuron can be viewed in the context of its
lineage, its type, and the compartments it innervates.

The viewer runs in the browser at
**https://l1-connectome-prat.github.io/L1_Neuron-Atlas/** and needs no
installation.

## Using the Viewer

Choose a lineage from the dropdown to load its neurons. One lineage is shown at
a time, and the hemisphere buttons restrict the view to the left side, the
right side, or both. The neuron buttons choose between differentiated (Diff)
neurons, Small Undifferentiated (SU) neurons, or the two together. Drag to
rotate, right-drag to pan, and scroll to zoom. The Frontal, Dorsal and Lateral
buttons return the camera to a standard orientation.

Neurons can be colored by **Type** or by **Class**. Type is the NBLAST
morphological cluster from L1_Neuron-Typing, and each type is labelled
`Lineage_Cluster_Acronym`, for example `BAla3/4_01_Tdl`. The colors follow the
same 18-color palette used in the typing figures; lineages with more than 18
types cycle back through the palette in darker shades. When Diff and SU neurons
are shown together, the SU types take a pastel version of their color and are
drawn with thinner, slightly transparent lines so the two populations remain
distinguishable. Class is the innervation acronym of each neuron, and in this
mode all SU neurons are drawn in grey.

The legend lists each type or class with its neuron count. Clicking an entry
hides or shows that group, and double-clicking isolates it. Hovering over a
neuron shows its full name and innervation identifier.

The anatomy is shown in two layers. The **Brain Mesh** and **Neuropil**
checkboxes add the whole CNS and the central-brain neuropil as context, and
their transparency is set together by the Brain opacity slider. Below them,
the compartment list holds the Level 1 compartments, each of which expands to
its Level 2 sub-compartments. The `L` and `R` buttons beside every compartment
show it in either hemisphere. Clicking a compartment's color square opens a
picker for its color and opacity. Line width and neuron opacity are set with
the sliders beneath the color controls.

The current view can be exported as a PNG at 1×, 2× or 4× resolution, with an
optional transparent background, or as an SVG. In the SVG the neurons are
vector paths grouped by type or class, ready for editing in Illustrator or
Inkscape, and the shaded compartments sit beneath them as an embedded image.
Both exports use the camera orientation on screen.

**Copy link** places the full state of the view in the address: the lineage,
every toggle, the hidden groups, the compartments and their colors, and the
camera. Anyone who opens the link sees the same view. **Clear all** returns
the viewer to its starting state.

## Data

The atlas contains the 3,120 Diff and 1,022 SU neurons across 99 lineages.
suNB and Dev neurons are excluded. All geometry is kept at full resolution:
every skeleton node and every mesh triangle from the source files is present.
Skeletons and compartments were transformed from the native `PK_L1CNS` space
into the symmetrized `PK_L1CNSsym` space before export, so the left and right
hemispheres are directly comparable. Coordinates are in microns.

The compiled files live in `docs/data/`. `manifest.json` holds the palette,
the compartment hierarchy and the lineage index. Each lineage has a JSON file
with the metadata, types and classes of its neurons, and one binary file per
category and hemisphere holding the node coordinates (float32 xyz) followed by
the parent of each node (int32). Each compartment is stored as a binary file of
float32 vertices followed by uint32 triangle indices.

## Rebuilding the Data

**Full build.** `Scripts/build_atlas.py` reads the SWC skeletons and their
`# Meta:` typing from `L1_Skeletons/Skeletons/{Diff,SU}_Skeletons/`, the
Level 1 and Level 2 STL meshes from `L1_Compartment-Atlas/`, and the brain and
neuropil templates (`PK_L1CNSsym`, `PK_L1CBNeuropilsym`) from flybrains. It
transforms everything into `PK_L1CNSsym` and rewrites `docs/data/` from
scratch. Run it after the skeletons or the typing change; it takes about
twenty minutes.

```bash
python Scripts/build_atlas.py
```

**Brain and neuropil only.** The `--context-only` flag rewrites just the Brain
Mesh and Neuropil and leaves the neurons and compartments in place. It takes a
few seconds.

```bash
python Scripts/build_atlas.py --context-only
```

After a rebuild, commit `docs/` and push. GitHub Pages republishes the site
within a minute or two. To preview a build before pushing, serve the folder
locally and open `http://localhost:8000`:

```bash
python -m http.server -d docs 8000
```

## Requirements

The build script uses `navis` and the
[navis-flybrains fork](https://github.com/KandimallaPrat/navis-flybrains),
which provides the `PK_L1CNS` transforms and templates, together with
`trimesh`, `numpy` and `pandas`. It reads the companion repositories through
the `PROJECTS_HOME` environment variable. The viewer itself is plain HTML and
JavaScript built on Three.js, loaded from a CDN.

The site is published with GitHub Pages from the `docs/` folder of the `main`
branch (Settings → Pages → Deploy from a branch → `main` / `docs`).

## Repository Layout

```
.
├── Scripts/
│   └── build_atlas.py   compiles the skeletons and meshes into docs/data/
└── docs/                the published site
    ├── index.html       viewer page
    ├── js/app.js        viewer logic
    ├── css/style.css    viewer styling
    └── data/            compiled neurons, compartments and manifest
```
