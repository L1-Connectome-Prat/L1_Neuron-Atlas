"""
Compile the connectivity and innervation views of the L1 Neuron Atlas.

Reads the compartment connectivity and lineage innervation tables from
L1_Compartment-Connectivity, its row / column orders and atlas colormaps, and
the symmetrized meshes and tracts already compiled by build_atlas.py. Writes
JSON under docs/data/connectivity/ for the Compartment Connectivity and
Lineage Innervation tabs, plus docs/data/compartment_colors.json for the
anatomy explorer.

The 2D compartment and tract drawings are orthographic projections of the
full-resolution geometry, simplified below the resolution of the thumbnails
they are drawn in.

"""
import os
import json
import pickle

import numpy as np
import pandas as pd
import seaborn as sns
import matplotlib
from shapely import polygons, union_all, LineString, MultiLineString


#------------------------------------------------------------------------------
PROJECTS_HOME  = os.environ["PROJECTS_HOME"]
CONN_DIR       = f"{PROJECTS_HOME}/L1_Compartment-Connectivity"
HELPERS        = f"{CONN_DIR}/Data_Helpers"
OUTPUTS        = f"{CONN_DIR}/Analysis_Outputs"
ATLAS_DATA     = f"{PROJECTS_HOME}/L1_Neuron-Atlas/docs/data"
OUTPUT_DIR     = f"{ATLAS_DATA}/connectivity"

SPACER         = "_"
MESH_SIMPLIFY  = 0.15
TRACT_SIMPLIFY = 0.1
VNC_NAMES      = {"SEZneu", "VNCneu", "MXneu", "LBneu", "T1neu", "T2neu", "T3neu"} | \
                 {f"A{i}neu" for i in range(1, 10)}

# Figure 2 and Figure 3 colour scales
SCALES = {
    "conn_level1"       : {"cmap" : "Purples", "vmax" : 20000, "gamma" : 0.225,
                           "ticks" : [0, 5000, 10000, 15000, 20000]},
    "conn_level2_brain" : {"cmap" : "Purples", "vmax" : 15000, "gamma" : 0.15,
                           "ticks" : [0, 2000, 8000, 15000]},
    "conn_level2_vnc"   : {"cmap" : "Purples", "vmax" : 400,   "gamma" : 1.0,
                           "ticks" : [0, 100, 200, 300, 400]},
    "innervation_input" : {"cmap" : "light_green", "vmax" : 0.8, "gamma" : 1.0,
                           "ticks" : [0, 0.2, 0.4, 0.6, 0.8]},
    "innervation_output": {"cmap" : "light_red",   "vmax" : 0.8, "gamma" : 1.0,
                           "ticks" : [0, 0.2, 0.4, 0.6, 0.8]},
    # Figure 3 supplementary: Level 2 brain and SEZ-VNC innervation
    "innervation_l2_brain_input" : {"cmap" : "light_green", "vmax" : 0.6, "gamma" : 1.0,
                                    "ticks" : [0, 0.2, 0.4, 0.6]},
    "innervation_l2_brain_output": {"cmap" : "light_red",   "vmax" : 0.6, "gamma" : 1.0,
                                    "ticks" : [0, 0.2, 0.4, 0.6]},
    "innervation_l2_vnc_input"   : {"cmap" : "light_green", "vmax" : 0.2, "gamma" : 1.0,
                                    "ticks" : [0, 0.05, 0.1, 0.15, 0.2]},
    "innervation_l2_vnc_output"  : {"cmap" : "light_red",   "vmax" : 0.2, "gamma" : 1.0,
                                    "ticks" : [0, 0.05, 0.1, 0.15, 0.2]},
}


#------------------------------------------------------------------------------
def write_json(name, obj):
    """Write compact JSON under docs/data/connectivity/."""
    path = f"{OUTPUT_DIR}/{name}"
    os.makedirs(os.path.dirname(path), exist_ok = True)
    with open(path, "w") as fh:
        json.dump(obj, fh, separators = (",", ":"))


def lut(name, n = 256):
    """Sample a matplotlib / seaborn colormap into a list of hex colours."""
    if name == "light_green":
        cmap = sns.light_palette("green", as_cmap = True)
    elif name == "light_red":
        cmap = sns.light_palette("red", as_cmap = True)
    else:
        cmap = matplotlib.colormaps[name]

    return [matplotlib.colors.to_hex(cmap(i / (n - 1))) for i in range(n)]


def strip_side(name):
    """'AL_Left' -> ('AL', 'Left'); '_' -> ('_', None)."""
    if name == SPACER:
        return name, None
    base, side = name.rsplit("_", 1)

    return base, side


def clean(value):
    """Round a float for JSON, keeping NaN as None."""
    return None if pd.isna(value) else round(float(value), 4)


#------------------------------------------------------------------------------
def build_colors():
    """Convert the atlas colormaps to {level : {compartment : hex}}."""
    colors = {}
    for level in ["Level1", "Level2"]:
        with open(f"{HELPERS}/Compartment_Colors_Atlas_{level}.pkl", "rb") as fh:
            raw = pickle.load(fh)
        colors[level.lower()] = {strip_side(k[len("PK_"):])[0] : v[:7].lower()
                                 for k, v in raw.items()}

    with open(f"{ATLAS_DATA}/compartment_colors.json", "w") as fh:
        json.dump(colors, fh, indent = 1)

    return colors


#------------------------------------------------------------------------------
def matrix_block(df, rows, cols):
    """Weights and synapse counts for rows x cols, spacer columns left empty."""
    keyed = df.set_index(["Source_Compartment", "Target_Compartment"])
    block = {"weight" : [], "target_tbars" : [], "source_psds" : [], "total_tbars" : []}
    for r in rows:
        line = {k : [] for k in block}
        for c in cols:
            if c == SPACER or (r, c) not in keyed.index:
                for k in line:
                    line[k].append(None if c == SPACER else 0)
                continue
            rec = keyed.loc[(r, c)]
            line["weight"].append(clean(rec["Weight"]))
            line["target_tbars"].append(int(rec["Target_TBars"]))
            line["source_psds"].append(int(rec["Source_PSDs"]))
            line["total_tbars"].append(int(rec["Total_TBars"]))
        for k in block:
            block[k].append(line[k])

    return block


def build_connectivity():
    """Level 1 and Level 2 compartment connectivity, in the Figure 2 orders."""
    order1 = list(np.load(f"{HELPERS}/Compartment_Order_Level1.npy"))
    order1 = order1[:-4] + [SPACER] + order1[-4:]
    df1    = pd.read_parquet(f"{OUTPUTS}/Connectivity/Compartment_Connectivity_level1.parquet")
    rows1  = order1[:-5]

    write_json("conn_level1.json", {
        "rows"   : rows1,
        "blocks" : [{"key"   : "brain",
                     "label" : "Connection Weight",
                     "cols"  : order1,
                     "scale" : "conn_level1",
                     "data"  : matrix_block(df1, rows1, order1)}]})

    order2     = list(np.load(f"{HELPERS}/Compartment_Order_Level2.npy"))
    order2_vnc = list(np.load(f"{HELPERS}/Compartment_Order_Level2_VNC.npy"))
    df2        = pd.read_parquet(f"{OUTPUTS}/Connectivity/Compartment_Connectivity_level2.parquet")

    write_json("conn_level2.json", {
        "rows"   : order2,
        "blocks" : [{"key"   : "brain",
                     "label" : "Connection Weight (Brain)",
                     "cols"  : order2,
                     "scale" : "conn_level2_brain",
                     "data"  : matrix_block(df2, order2, order2)},
                    {"key"   : "vnc",
                     "label" : "Connection Weight (SEZ-VNC)",
                     "cols"  : order2_vnc,
                     "scale" : "conn_level2_vnc",
                     "data"  : matrix_block(df2, order2, order2_vnc)}]})

    return order1, order2 + [c for c in order2_vnc if c != SPACER]


#------------------------------------------------------------------------------
def innervation_tables(level):
    """Input (PSDs) and output (TBars) fraction tables for one level, by lineage."""
    base = f"{OUTPUTS}/Lineage_Innervation-Focusness"
    return {key : pd.read_parquet(f"{base}/Lineage_Innervation_{name}_level{level}.parquet").set_index("Lineage")
            for key, name in [("input", "PSDs"), ("output", "TBars")]}


def innervation_block(tables, lineages, cols):
    """Input and output fractions for lineages x cols, spacer columns left empty."""
    out = {"cols" : cols}
    for key, df in tables.items():
        df = df.reindex(index = lineages)
        out[key] = [[None if c == SPACER else clean(df.at[lin, c]) for c in cols]
                    for lin in lineages]

    return out


def build_innervation():
    """Lineage input / output fractions in the Figure 3 row order: Level 1 with
    the SEZ and VNC beside the brain, Level 2 as separate brain and SEZ-VNC blocks."""
    cols1    = list(np.load(f"{HELPERS}/Relative_Compartment_Order_Level1.npy"))
    cols1    = cols1[:-4] + [SPACER] + cols1[-4:]
    tables1  = innervation_tables(1)
    lineages = list(tables1["input"].index)

    write_json("innervation_level1.json", {"rows" : lineages, **innervation_block(tables1, lineages, cols1)})

    tables2 = innervation_tables(2)
    brain2  = list(np.load(f"{HELPERS}/Relative_Compartment_Order_Level2.npy"))
    vnc2    = list(np.load(f"{HELPERS}/Relative_Compartment_Order_Level2_VNC.npy"))

    write_json("innervation_level2.json", {"rows"  : lineages,
                                           "brain" : innervation_block(tables2, lineages, brain2),
                                           "vnc"   : innervation_block(tables2, lineages, vnc2)})

    return lineages


#------------------------------------------------------------------------------
def load_mesh(info):
    """Read a compiled [float32 vertices | uint32 faces] mesh."""
    raw   = open(f"{ATLAS_DATA}/{info['file']}", "rb").read()
    verts = np.frombuffer(raw, np.float32, info["nv"] * 3).reshape(-1, 3)
    faces = np.frombuffer(raw, np.uint32, info["nf"] * 3, info["nv"] * 12).reshape(-1, 3)

    return verts, faces


def to_path(geom, ndigits = 2):
    """Shapely (Multi)Polygon -> SVG path string."""
    polys = getattr(geom, "geoms", [geom])
    parts = []
    for poly in polys:
        for ring in [poly.exterior] + list(poly.interiors):
            pts = np.round(np.asarray(ring.coords)[:-1], ndigits)
            parts.append("M" + "L".join(f"{x:g} {y:g}" for x, y in pts) + "Z")

    return "".join(parts)


# Screen coordinates (y down): anterior = (x, y), dorsal = (x, -z)
VIEWS = {"anterior" : ([0, 1], [1, 1], 2),
         "dorsal"   : ([0, 2], [1, -1], 1)}


def project(verts, faces, view):
    """Outline of a mesh in one view, with its mean depth."""
    axes, signs, depth_axis = VIEWS[view]
    tri  = verts[faces][:, :, axes] * np.array(signs)
    geom = union_all(polygons(np.ascontiguousarray(tri))).simplify(MESH_SIMPLIFY)

    return to_path(geom), round(float(verts[:, depth_axis].mean()), 2), geom.bounds


def build_projections(order1, order2):
    """2D anterior and dorsal outlines for every Level 1 and Level 2 compartment."""
    manifest = json.load(open(f"{ATLAS_DATA}/manifest.json"))
    meshes   = {}
    for parent in manifest["compartments"]:
        for comp in [parent] + parent["children"]:
            meshes[comp["id"]] = comp["sides"]

    bounds = {v : [np.inf, np.inf, -np.inf, -np.inf] for v in VIEWS}
    out    = {"level1" : {}, "level2" : {}}

    for level, order in [("level1", order1), ("level2", order2)]:
        for name in order:
            if name == SPACER or name in out[level]:
                continue
            base, side = strip_side(name)
            verts, faces = load_mesh(meshes[base][side])
            entry = {}
            for view in VIEWS:
                if view == "anterior" and base in VNC_NAMES:
                    continue
                path, depth, b = project(verts, faces, view)
                entry[view] = {"d" : path, "depth" : depth}
                bounds[view] = [min(bounds[view][0], b[0]), min(bounds[view][1], b[1]),
                                max(bounds[view][2], b[2]), max(bounds[view][3], b[3])]
            out[level][name] = entry
        print(f"Projections {level}: {len(out[level])}")

    pad = 3
    out["viewbox"] = {v : [round(b[0] - pad, 1), round(b[1] - pad, 1),
                           round(b[2] - b[0] + 2 * pad, 1), round(b[3] - b[1] + 2 * pad, 1)]
                      for v, b in bounds.items()}

    write_json("projections.json", out)


#------------------------------------------------------------------------------
def chains(par, offset, count):
    """Unbranched runs of a skeleton, as lists of local node indices."""
    kids = np.zeros(count, int)
    for i in range(count):
        p = par[offset + i]
        if p >= 0:
            kids[p] += 1

    runs = []
    for i in range(count):
        if par[offset + i] < 0 or kids[i] == 1:
            continue
        run = [i]
        j   = i
        while True:
            p = par[offset + j]
            if p < 0:
                break
            run.append(p)
            if kids[p] != 1 or par[offset + p] < 0:
                break
            j = p
        runs.append(run)

    return runs


def build_tracts(lineages):
    """Anterior 2D projections of each lineage's right-hemisphere tracts. Their
    joint extent is added to projections.json as the tract view's frame."""
    manifest = json.load(open(f"{ATLAS_DATA}/manifest.json"))
    keys     = {l["name"] : l["key"] for l in manifest["lineages"]}
    index    = {}
    box      = [np.inf, np.inf, -np.inf, -np.inf]

    for name in lineages:
        key = keys.get(name)
        if key is None:
            continue
        info = json.load(open(f"{ATLAS_DATA}/lineages/{key}.json"))
        if "Tract_Right" not in info["files"]:
            continue

        f     = info["files"]["Tract_Right"]
        raw   = open(f"{ATLAS_DATA}/{f['path']}", "rb").read()
        pos   = np.frombuffer(raw, np.float32, f["nodes"] * 3).reshape(-1, 3)
        par   = np.frombuffer(raw, np.int32, f["nodes"], f["nodes"] * 12)

        lines = []
        count = 0
        for n in info["neurons"]:
            if n.get("tract_file") != "Tract_Right":
                continue
            count += 1
            off = n["tract_offset"]
            for run in chains(par, off, n["tract_n"]):
                xy = pos[off + np.array(run)][:, [0, 1]]
                if len(xy) > 1:
                    lines.append(LineString(xy))

        geom  = MultiLineString(lines).simplify(TRACT_SIMPLIFY)
        b     = geom.bounds
        box   = [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
        parts = []
        for line in getattr(geom, "geoms", [geom]):
            pts = np.round(np.asarray(line.coords), 2)
            parts.append("M" + "L".join(f"{x:g} {y:g}" for x, y in pts))

        write_json(f"tracts/{key}.json", {"name" : name, "neurons" : count, "d" : "".join(parts)})
        index[name] = key

    write_json("tracts/index.json", index)

    pad  = 3
    path = f"{OUTPUT_DIR}/projections.json"
    proj = json.load(open(path))
    proj["viewbox"]["tract"] = [round(box[0] - pad, 1), round(box[1] - pad, 1),
                                round(box[2] - box[0] + 2 * pad, 1), round(box[3] - box[1] + 2 * pad, 1)]
    write_json("projections.json", proj)
    print(f"Tracts: {len(index)} lineages")


#------------------------------------------------------------------------------
def main():
    colors           = build_colors()
    order1, order2   = build_connectivity()
    lineages         = build_innervation()

    write_json("meta.json", {"scales"  : {k : {**v, "lut" : lut(v["cmap"])} for k, v in SCALES.items()},
                             "colors"  : colors})

    build_projections(order1, order2)
    build_tracts(lineages)


if __name__ == "__main__":
    main()
