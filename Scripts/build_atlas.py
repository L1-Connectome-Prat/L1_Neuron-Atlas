"""
Compile the L1 Neuron Atlas web viewer data.

Reads full-resolution Diff and SU skeletons from L1_Skeletons and the
Level 1 / Level 2 compartment meshes from L1_Compartment-Atlas, transforms
everything into PK_L1CNSsym space, and writes compact binary files plus JSON
manifests under docs/data/ for the static GitHub Pages viewer.

No geometry is resampled or decimated - every skeleton node and every mesh
triangle is kept. Coordinates are written in microns as float32.

"""
import os
import sys
import json
import glob
import shutil
from collections import Counter

import numpy as np
import pandas as pd
import trimesh

import navis
import flybrains


#------------------------------------------------------------------------------
PROJECTS_HOME   = os.environ["PROJECTS_HOME"]
SKELETON_DIR    = f"{PROJECTS_HOME}/L1_Skeletons/Skeletons"
COMPARTMENT_DIR = f"{PROJECTS_HOME}/L1_Compartment-Atlas"
OUTPUT_DIR      = f"{PROJECTS_HOME}/L1_Neuron-Atlas/docs/data"

CATEGORIES      = ["Diff", "SU"]
HEMISPHERES     = ["Left", "Right"]
SOURCE_SPACE    = "PK_L1CNS"
TARGET_SPACE    = "PK_L1CNSsym"
NM_TO_UM        = 1e-3

# Custom Palette Courtesy Sasha Trubetskoy
PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
           "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
           "#dcbeff", "#9A6324", "#800000", "#aaffc3", "#808000",
           "#ffd8b1", "#000075", "#a9a9a9"]

# Level 1 compartment -> nested Level 2 sub-compartments
CB = "Central-Brain_Compartments"
VS = "Ventral-Nerve-Cord/Segments/Individual-Segments"

COMPARTMENT_TREE = [
    ("AL",        f"{CB}/AL",  []),
    ("LAL",       f"{CB}/LAL", ["LALcd", "LALcv", "LALld", "LALlv", "LALm"]),
    ("SLP",       f"{CB}/SLP", ["LH", "SLPcc", "SLPl", "SLPpd", "SLPpv"]),
    ("SMP",       f"{CB}/SMP", ["SMPal", "SMPc"]),
    ("VLP",       f"{CB}/VLP", ["VLPl", "VLPm"]),
    ("VMC",       f"{CB}/VMC", ["VMCc", "VMCl", "VMCm", "VMCpd", "VMCpv"]),
    ("MB-sansCA", f"{CB}/MB",  ["MB-IP", "MB-IT", "MB-IVL", "MB-LA", "MB-LP",
                                "MB-LT", "MB-LVL", "MB-SHA", "MB-UT", "MB-UVL"]),
    ("MB-CA",     f"{CB}/MB",  []),
    ("MB-ACA",    f"{CB}/MB",  []),
    ("TR",        f"{CB}/TR",  ["TRdl", "TRdm", "TRint", "TRv"]),
    ("IPA",       f"{CB}/IP",  []),
    ("IPP",       f"{CB}/IP",  []),
    ("IPLM",      f"{CB}/IP",  []),
    ("LON",       f"{CB}/LON", []),
    ("SEZneu",    "Ventral-Nerve-Cord/Segments/Segment-Sets", ["MXneu", "LBneu"]),
    ("VNCneu",    "Ventral-Nerve-Cord",
                  ["T1neu", "T2neu", "T3neu", "A1neu", "A2neu", "A3neu",
                   "A4neu", "A5neu", "A6neu", "A7neu", "A8neu", "A9neu"]),
]

# Whole-brain context meshes, already in symmetrized space
CONTEXT_MESHES = [
    ("brain",    "CNS",      flybrains.PK_L1CNSsym),
    ("neuropil", "Neuropil", flybrains.PK_L1CBNeuropilsym),
]

CHILD_FOLDER = {"MXneu": VS, "LBneu": VS}
CHILD_FOLDER.update({f"{s}neu": VS for s in ["T1", "T2", "T3"] + [f"A{i}" for i in range(1, 10)]})


#------------------------------------------------------------------------------
def symmetrize(points_nm):
    """Transform native L1 coordinates (nm) to PK_L1CNSsym, returned in microns."""
    out = navis.xform_brain(np.asarray(points_nm, dtype = np.float64),
                            source = SOURCE_SPACE,
                            target = TARGET_SPACE)

    return (out * NM_TO_UM).astype(np.float32)


def write_mesh(mesh, path):
    """Write a mesh as [float32 vertices | uint32 faces] and return its counts."""
    verts = symmetrize(mesh.vertices)
    faces = np.asarray(mesh.faces, dtype = np.uint32)

    with open(path, "wb") as fh:
        fh.write(verts.tobytes())
        fh.write(faces.tobytes())

    return {"nv": int(len(verts)), "nf": int(len(faces))}


#------------------------------------------------------------------------------
def build_compartments():
    """Convert every Level 1 / Level 2 STL (both hemispheres) to binary meshes."""
    mesh_dir = f"{OUTPUT_DIR}/meshes"
    os.makedirs(mesh_dir, exist_ok = True)

    def entry(name, folder, level):
        sides = {}
        for hemi in HEMISPHERES:
            stl  = f"{COMPARTMENT_DIR}/{folder}/{name}_{hemi}.stl"
            mesh = trimesh.load_mesh(stl)
            info = write_mesh(mesh, f"{mesh_dir}/{name}_{hemi}.bin")
            info["file"] = f"meshes/{name}_{hemi}.bin"
            sides[hemi]  = info
        return {"id": name, "level": level, "sides": sides}

    tree = []
    for name, folder, children in COMPARTMENT_TREE:
        node = entry(name, folder, 1)
        node["children"] = [entry(child, CHILD_FOLDER.get(child, folder), 2)
                            for child in children]
        tree.append(node)
        print(f"Compartment {name} (+{len(children)})")

    return tree


def build_context_meshes():
    """Write the symmetrized brain and neuropil template meshes."""
    mesh_dir = f"{OUTPUT_DIR}/meshes"
    os.makedirs(mesh_dir, exist_ok = True)

    context = {}
    for key, name, template in CONTEXT_MESHES:
        mesh  = template.mesh
        verts = (np.asarray(mesh.vertices) * NM_TO_UM).astype(np.float32)
        faces = np.asarray(mesh.faces, dtype = np.uint32)
        with open(f"{mesh_dir}/{name}.bin", "wb") as fh:
            fh.write(verts.tobytes())
            fh.write(faces.tobytes())

        context[key] = {"file": f"meshes/{name}.bin", "nv": int(len(verts)), "nf": int(len(faces)),
                        "center": verts.mean(axis = 0).round(3).tolist(),
                        "min": verts.min(axis = 0).round(3).tolist(),
                        "max": verts.max(axis = 0).round(3).tolist()}

    return context


#------------------------------------------------------------------------------
def read_swc(path):
    """Read an L1 navis SWC into (meta, node table)."""
    meta = {}
    with open(path) as fh:
        for line in fh:
            if not line.startswith("#"):
                break
            if line.startswith("# Meta:"):
                meta = json.loads(line[len("# Meta:"):])

    nodes = pd.read_csv(path, sep = r"\s+", comment = "#", header = None,
                        names = ["node_id", "label", "x", "y", "z", "radius", "parent_id"])

    return meta, nodes


def parse_cluster(value):
    """Return the integer cluster index from '7', '07' or 's03', else None."""
    value = str(value).lstrip("s")

    return int(value) if value.isdigit() else None


def clean(value):
    """Map empty / nan metadata to 'NA'."""
    return "NA" if value in (None, "", "nan") else str(value)


#------------------------------------------------------------------------------
def build_lineage(key):
    """Compile every Diff + SU skeleton in one lineage folder."""
    out_dir = f"{OUTPUT_DIR}/lineages/{key}"
    os.makedirs(out_dir, exist_ok = True)

    neurons = []
    files   = {}
    name    = None

    for cat in CATEGORIES:
        for hemi in HEMISPHERES:
            swcs = sorted(glob.glob(f"{SKELETON_DIR}/{cat}_Skeletons/{key}/{hemi}/*.swc"))
            if not swcs:
                continue

            positions = []
            parents   = []
            offset    = 0

            for swc in swcs:
                meta, nodes = read_swc(swc)
                name        = meta["lineage"]

                ids    = nodes.node_id.values
                order  = np.argsort(ids)
                idx    = np.searchsorted(ids, nodes.parent_id.values, sorter = order)
                idx    = np.clip(idx, 0, len(ids) - 1)
                parent = np.where(nodes.parent_id.values < 0, -1, order[idx]).astype(np.int32)

                xyz  = symmetrize(nodes[["x", "y", "z"]].values)
                soma = nodes.index[nodes.label == 1]
                if len(soma):
                    s    = soma[0]
                    soma = xyz[s].round(3).tolist() + [round(float(nodes.radius[s]) * NM_TO_UM, 3)]
                else:
                    soma = None

                neurons.append({
                    "id":          int(meta["id"]),
                    "category":    cat,
                    "hemisphere":  hemi,
                    "cluster":     parse_cluster(meta.get("cluster")),
                    "cluster_raw": clean(meta.get("cluster")),
                    "acronym":     clean(meta.get("acronym")),
                    "identifier":  clean(meta.get("identifier")),
                    "name":        meta.get("name", meta["id"]),
                    "file":        f"{cat}_{hemi}",
                    "offset":      offset,
                    "n":           int(len(xyz)),
                    "soma":        soma,
                })

                positions.append(xyz)
                parents.append(parent)
                offset += len(xyz)

            with open(f"{out_dir}/{cat}_{hemi}.bin", "wb") as fh:
                fh.write(np.concatenate(positions).tobytes())
                fh.write(np.concatenate(parents).tobytes())

            files[f"{cat}_{hemi}"] = {"path": f"lineages/{key}/{cat}_{hemi}.bin",
                                      "nodes": int(offset)}

    # Type groups: one per cluster, labelled Lineage_Cluster_Acronym
    types = {}
    for cat in CATEGORIES:
        groups = {}
        for n in (n for n in neurons if n["category"] == cat):
            groups.setdefault(n["cluster"], []).append(n["acronym"])
        types[cat] = []
        for cluster in sorted(groups, key = lambda c: (c is None, c or 0)):
            acr    = Counter(a for a in groups[cluster] if a != "NA").most_common(1)
            acr    = acr[0][0] if acr else "NA"
            prefix = "" if cat == "Diff" else "s"
            tag    = "NA" if cluster is None else f"{prefix}{cluster:02d}"
            label  = f"{name}_{tag}" if cat == "SU" else f"{name}_{tag}_{acr}"
            types[cat].append({"cluster": cluster, "label": label,
                               "acronyms": sorted(set(groups[cluster]))})

    # Class groups: Diff acronyms ordered by their lowest cluster
    first = {}
    for n in (n for n in neurons if n["category"] == "Diff"):
        c = n["cluster"] if n["cluster"] is not None else 999
        first[n["acronym"]] = min(first.get(n["acronym"], 999), c)
    classes = sorted(first, key = lambda a: (a == "NA", first[a], a))

    info = {"name": name, "key": key, "files": files,
            "types": types, "classes": classes, "neurons": neurons}

    with open(f"{OUTPUT_DIR}/lineages/{key}.json", "w") as fh:
        json.dump(info, fh, separators = (",", ":"))

    counts = {f: sum(1 for n in neurons if n["file"] == f) for f in files}

    return {"name": name, "key": key, "counts": counts}


#------------------------------------------------------------------------------
def update_context():
    """Rewrite only the context meshes and their manifest entry."""
    path = f"{OUTPUT_DIR}/manifest.json"
    with open(path) as fh:
        manifest = json.load(fh)

    manifest.pop("cns", None)
    manifest["context"] = build_context_meshes()

    with open(path, "w") as fh:
        json.dump(manifest, fh, indent = 1)


def main():
    if os.path.isdir(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    tree    = build_compartments()
    context = build_context_meshes()

    keys = sorted({os.path.basename(p) for cat in CATEGORIES
                   for p in glob.glob(f"{SKELETON_DIR}/{cat}_Skeletons/*")})

    lineages = []
    for key in keys:
        lineages.append(build_lineage(key))
        print(f"Lineage {key}: {lineages[-1]['counts']}")

    lineages.sort(key = lambda l: l["name"].lower())

    manifest = {"space": TARGET_SPACE, "units": "um", "palette": PALETTE,
                "context": context, "compartments": tree, "lineages": lineages}

    with open(f"{OUTPUT_DIR}/manifest.json", "w") as fh:
        json.dump(manifest, fh, indent = 1)


if __name__ == "__main__":
    if "--context-only" in sys.argv:
        update_context()
    else:
        main()
