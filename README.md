# An Interactive Atlas of Neurons in the Larval Brain

This repository hosts a browser atlas of the first-instar *Drosophila* larval (L1) connectome. It draws the differentiated (Diff) and small undifferentiated (SU) neurons and tracts of [L1_Skeletons](https://github.com/KandimallaPrat/L1_Skeletons), the compartments of [L1_Compartment-Atlas](https://github.com/L1-Connectome-Prat/L1_Compartment-Atlas), the classes and types of [L1_Neuron-Typing](https://github.com/L1-Connectome-Prat/L1_Neuron-Typing), and the compartment connectivity and lineage innervation of [L1_Compartment-Connectivity](https://github.com/L1-Connectome-Prat/L1_Compartment-Connectivity), all in symmetrized space. The data and the definitions behind them are described in those repositories.

The atlas is published at **https://l1-connectome-prat.github.io/L1_Neuron-Atlas/** and runs in any current browser without installation. One address serves all three views: Anatomy, Compartment Connectivity, and Lineage Innervation.

## Aim

The typing analysis divides each lineage into classes and types, and its per-lineage figures show those units from fixed orientations. Following one type through a particular compartment, comparing its left and right copies, or following its tract requires the anatomy to be rotated freely and the drawn elements to be chosen. The connectivity figures of the paper are static heatmaps in which a weight is read by eye and a compartment is located from its name alone. The atlas provides the anatomy for every lineage at full resolution, and the Figure 2 and Figure 3 heatmaps with each value and compartment one hover away.

## The Viewer

### Anatomy

**Neurons.** One lineage is shown at a time. The hemisphere control restricts the view to the left side, the right side, or both, and the neuron control selects Diff neurons, SU neurons, or both. The view is rotated by dragging, panned by right-dragging, and zoomed by scrolling.

**Color.** Neurons are colored by type, by class, or by lineage. Type labels follow `Lineage_Cluster_Acronym`, and the colors follow the palette of the typing figures. When both populations are shown, SU types take a pastel version of their color and are drawn with thinner lines. In class mode SU neurons are grey, and in lineage mode the whole lineage is drawn in a single color.

**Legend.** Clicking a name in the legend hides or shows that group, and double-clicking isolates it. Clicking the color bar opens a picker for the color and opacity of that group. A changed color applies to both the full skeletons and the tracts of that group.

**Skeletons.** The line width and neuron opacity sliders apply to every neuron in view. The **Soma** checkbox shows or hides the somas. The **Tract** checkbox replaces each Diff skeleton with its tract, and SU neurons remain as full skeletons.

**Compartments.** The **Brain Mesh** and **Neuropil** checkboxes add the whole CNS and the central-brain neuropil, with a shared Brain opacity slider. The compartment list holds the Level 1 compartments, each expanding to its Level 2 sub-compartments, and the `L` and `R` buttons show a compartment in either hemisphere. Compartments are colored with the atlas palette of the compartment-atlas figure, and a compartment's color square opens the same color and opacity picker as the legend.

### Compartment Connectivity

The Level 1 and Level 2 connection weights of Figure 2 are drawn in the figure's order and color scale, with the source compartment on the rows and the target on the columns. Level 1 places the SEZ and VNC targets after the central-brain block. Level 2 sets the 80 × 80 brain block and the SEZ–VNC block side by side on shared rows, each with its own color scale. Hovering a square reports its weight and the T-bar and PSD counts behind it. Hovering a compartment name follows its row or column across every block. An anterior view of the central brain and a dorsal view with the SEZ and VNC sit beside the heatmap: a square highlights its source and target compartments, and a name highlights that compartment alone.

### Lineage Innervation

The input (PSD) and output (TBar) fractions of Figure 3 are drawn as the figure's mirrored pair, with the lineages in the figure's row order and the compartments ipsilateral and contralateral to each lineage. Level 1 includes the SEZ and VNC beside the brain, and Level 2 is divided into brain and SEZ-VNC views. Hovering a lineage draws the tracts of its right-hemisphere Diff neurons over an anterior view of the Level 1 compartments, and clicking a lineage keeps it in view.

### Export and Sharing

The anatomy view is exported as a PNG or an SVG. In the SVG the neurons are vector paths grouped by type or class over a raster of the compartments. The address records the state of the atlas, including the open view, the connectivity and innervation levels, and a kept lineage, so a copied link reopens the same view. **Copy link** copies it from the anatomy view. **Clear all** returns the anatomy view to its starting state.

## Work in Progress

The Compartment Connectivity and Lineage Innervation views are first versions of those figures in the atlas. The Level 2 innervation views use the color scales of the Figure 3 supplementary panels. The SEZ and VNC colors of the atlas palette are a neutral slate ramp, since the compartment-atlas figure defines none.

## Data Pipeline

Both build scripts read the companion repositories through the `PROJECTS_HOME` environment variable and write the files the atlas loads into `docs/data/`. The compiled files are committed, so the atlas can be republished without rerunning either build.

**Anatomy.** `Scripts/build_atlas.py` transforms every skeleton, tract, and compartment from `PK_L1CNS` to `PK_L1CNSsym` and writes them at full resolution. suNB and Dev neurons are left out. The full build runs from the repository root.

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

**Connectivity.** `Scripts/build_connectivity.py` reads the Level 1 and Level 2 connectivity tables, the Level 1 and Level 2 lineage innervation tables, their row and column orders, and the atlas colormaps `Compartment_Colors_Atlas_Level1.pkl` and `Compartment_Colors_Atlas_Level2.pkl` from L1_Compartment-Connectivity. It projects the compiled compartment meshes and right-hemisphere tracts into the 2D anterior and dorsal views, and writes `docs/data/connectivity/` and `docs/data/compartment_colors.json`. It reads the output of `build_atlas.py`, so it runs after it, from the repository root.

```bash
python Scripts/build_connectivity.py
```

A build is previewed by serving `docs/` from the repository root and opening `http://localhost:8000`. After a build is committed and pushed, GitHub Pages republishes the atlas.

```bash
python -m http.server -d docs 8000
```

## Requirements

The anatomy build uses `navis`, the [navis-flybrains fork](https://github.com/KandimallaPrat/navis-flybrains) for the `PK_L1CNS` transforms and templates, `trimesh`, `numpy`, and `pandas`. The connectivity build adds `shapely` for the 2D projections and `matplotlib` and `seaborn` for the figure color scales. The atlas is plain HTML and JavaScript built on Three.js, published with GitHub Pages from the `docs/` folder of the `main` branch.

## Repository Layout

```
.
├── Logo/                        atlas logo source images
├── Scripts/
│   ├── build_atlas.py           compiles skeletons, tracts, and meshes into docs/data/
│   └── build_connectivity.py    compiles the heatmaps, 2D projections, and atlas palette
└── docs/                        the published atlas
    ├── index.html               atlas page and its three views
    ├── js/
    │   ├── app.js               anatomy view
    │   ├── tabs.js              view switching and shared link state
    │   └── matrix.js            compartment connectivity and lineage innervation views
    ├── css/style.css            atlas styling
    ├── img/                     logo and browser icons cropped from Logo/L1-Logo.png
    └── data/
        ├── manifest.json        palette, compartment hierarchy, lineage index
        ├── compartment_colors.json  atlas palette for Level 1 and Level 2
        ├── meshes/              compartment, Brain Mesh, and Neuropil meshes
        ├── lineages/            per-lineage neuron metadata, skeletons, and tracts
        └── connectivity/        heatmap data, color scales, 2D projections, lineage tracts
```
