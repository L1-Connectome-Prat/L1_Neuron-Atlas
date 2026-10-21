# An Interactive Atlas of Neurons in the Larval Brain

This repository hosts a browser viewer for the differentiated (Diff) and small undifferentiated (SU) neurons of the first-instar *Drosophila* larval (L1) connectome. It draws the skeletons and tracts of [L1_Skeletons](https://github.com/KandimallaPrat/L1_Skeletons), the compartments of [L1_Compartment-Atlas](https://github.com/L1-Connectome-Prat/L1_Compartment-Atlas), and the classes and types of [L1_Neuron-Typing](https://github.com/L1-Connectome-Prat/L1_Neuron-Typing) together in symmetrized space. The data and the definitions behind them are described in those repositories.

The viewer is published at **https://l1-connectome-prat.github.io/L1_Neuron-Atlas/** and runs in any current browser without installation.

## Aim

The typing analysis divides each lineage into classes and types, and its per-lineage figures show those units from fixed orientations. Following one type through a particular compartment, comparing its left and right copies, or following its tract requires the anatomy to be rotated freely and the drawn elements to be chosen. The atlas provides that view for every lineage at full resolution.

## The Viewer

**Neurons.** One lineage is shown at a time. The hemisphere control restricts the view to the left side, the right side, or both, and the neuron control selects Diff neurons, SU neurons, or both. The view is rotated by dragging, panned by right-dragging, and zoomed by scrolling.

**Color.** Neurons are colored by type, by class, or by lineage. Type labels follow `Lineage_Cluster_Acronym`, and the colors follow the palette of the typing figures. When both populations are shown, SU types take a pastel version of their color and are drawn with thinner lines. In class mode SU neurons are grey, and in lineage mode the whole lineage is drawn in a single color.

**Legend.** Clicking a name in the legend hides or shows that group, and double-clicking isolates it. Clicking the color bar opens a picker for the color and opacity of that group. A changed color applies to both the full skeletons and the tracts of that group.

**Skeletons.** The line width and neuron opacity sliders apply to every neuron in view. The **Soma** checkbox shows or hides the somas. The **Tract** checkbox replaces each Diff skeleton with its tract, and SU neurons remain as full skeletons.

**Anatomy.** The **Brain Mesh** and **Neuropil** checkboxes add the whole CNS and the central-brain neuropil, with a shared Brain opacity slider. The compartment list holds the Level 1 compartments, each expanding to its Level 2 sub-compartments, and the `L` and `R` buttons show a compartment in either hemisphere. A compartment's color square opens the same color and opacity picker as the legend.

**Export and sharing.** The current view is exported as a PNG or as an SVG, in which the neurons are vector paths grouped by type or class over a raster of the compartments. **Copy link** writes the full state of the view into the address, so the link reopens the same view. **Clear all** returns the viewer to its starting state.

## Data Pipeline

`Scripts/build_atlas.py` reads the companion repositories through the `PROJECTS_HOME` environment variable, transforms every skeleton, tract, and compartment from `PK_L1CNS` to `PK_L1CNSsym`, and writes the files the viewer loads into `docs/data/`. Geometry is kept at full resolution. suNB and Dev neurons are left out. The compiled files are committed, so the viewer can be republished without rerunning the build.

The full build runs from the repository root.

```bash
python Scripts/build_atlas.py
```

Two partial builds, also run from the repository root, refresh only the Brain Mesh and Neuropil or only the tracts.

```bash
python Scripts/build_atlas.py --context-only
```

```bash
python Scripts/build_atlas.py --tracts-only
```

A build is previewed by serving `docs/` from the repository root and opening `http://localhost:8000`. After a build is committed and pushed, GitHub Pages republishes the viewer.

```bash
python -m http.server -d docs 8000
```

## Requirements

The build uses `navis`, the [navis-flybrains fork](https://github.com/KandimallaPrat/navis-flybrains) for the `PK_L1CNS` transforms and templates, `trimesh`, `numpy`, and `pandas`. The viewer is plain HTML and JavaScript built on Three.js, published with GitHub Pages from the `docs/` folder of the `main` branch.

## Repository Layout

```
.
├── Scripts/
│   └── build_atlas.py     compiles skeletons, tracts, and meshes into docs/data/
└── docs/                  the published viewer
    ├── index.html         viewer page
    ├── js/app.js          viewer logic
    ├── css/style.css      viewer styling
    └── data/
        ├── manifest.json  palette, compartment hierarchy, lineage index
        ├── meshes/        compartment, Brain Mesh, and Neuropil meshes
        └── lineages/      per-lineage neuron metadata, skeletons, and tracts
```
