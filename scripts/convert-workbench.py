#!/usr/bin/env python3
"""Private Valve legacy Workbench reference extraction and deterministic GLB conversion.

No unit conversion, centering, generated texture, source editing or third-party add-on.
Run with system Python; Blender's bundled polygon tessellator runs in a child process.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import itertools
import json
import math
from pathlib import Path, PurePosixPath
import re
import stat
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
AREA = ROOT / ".reference-assets/workbench"
EXPECTED_SHA = "b6dfe90aca83ea32f1a4e3c5f488a6b1f3034440c52de65159a8c5c7aa05873e"
SOURCE_URL = "https://media.steampowered.com/apps/csgo/workshop/workbench_materials.zip?v=103"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
TOLERANCE = {"positionSourceUnits": 1e-5, "uv": 2e-6, "normalDirectionRadians": 1e-6, "uvThirdComponent": 2e-6}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


def safe_extract():
    archive = AREA / "workbench_materials.zip"
    raw = archive.read_bytes()
    if sha(raw) != EXPECTED_SHA:
        raise ValueError("Workbench archive SHA-256 differs from the pinned official source")
    dest = AREA / "source"
    if dest.is_symlink():
        raise ValueError("Extraction root must not be a symlink")
    dest.mkdir(exist_ok=True)
    entries, seen = [], set()
    with zipfile.ZipFile(archive) as packed:
        infos = packed.infolist()
        if len(infos) > 100 or sum(i.file_size for i in infos) > 100_000_000:
            raise ValueError("Archive exceeds the pinned reference extraction budget")
        # Validate every member before any writes. Never use extractall.
        for info in infos:
            name = PurePosixPath(info.filename)
            mode = stat.S_IFMT(info.external_attr >> 16)
            if (name.is_absolute() or ".." in name.parts or "\\" in info.filename
                    or ":" in info.filename or name.as_posix() in seen
                    or mode not in (0, stat.S_IFREG, stat.S_IFDIR)
                    or info.flag_bits & 1 or info.file_size > 20_000_000):
                raise ValueError(f"Unsafe ZIP member: {info.filename}")
            seen.add(name.as_posix())
            target = dest / name
            if not target.resolve().is_relative_to(dest.resolve()) or target.is_symlink():
                raise ValueError(f"ZIP path escapes private source area: {info.filename}")
        for info in infos:
            target = dest / info.filename
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            data = packed.read(info)  # ZipFile also verifies CRC.
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target.read_bytes() != data:
                    raise ValueError(f"Existing extracted source differs: {target}")
            else:
                with target.open("xb") as stream:
                    stream.write(data)
            entries.append({"path": info.filename, "bytes": len(data), "sha256": sha(data)})
    return {"sourceUrl": SOURCE_URL, "archiveSha256": EXPECTED_SHA,
            "archiveBytes": len(raw), "archiveEntries": len(infos),
            "extractedBytes": sum(i["bytes"] for i in entries), "files": entries}


def parse_obj(path):
    positions, uv, normals, faces = [], [], [], []
    groups, objects, materials = set(), set(), set()
    face_groups, current_group = [], "default"
    tokens = Counter()
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        a = line.split()
        if not a or a[0].startswith("#"):
            continue
        tokens[a[0]] += 1
        if a[0] in ("v", "vt", "vn"):
            values = tuple(map(float, a[1:]))
            if not all(map(math.isfinite, values)):
                raise ValueError(f"Nonfinite OBJ attribute: {path}")
            {"v": positions, "vt": uv, "vn": normals}[a[0]].append(values)
        elif a[0] == "f":
            corners = []
            for corner in a[1:]:
                ids = corner.split("/")
                if len(ids) != 3 or not all(ids):
                    raise ValueError(f"Missing source UV/normal corner: {path}")
                ids = tuple(int(i) for i in ids)
                indices = tuple(i - 1 if i > 0 else n + i for i, n in
                                zip(ids, (len(positions), len(uv), len(normals))))
                if any(i < 0 or i >= n for i, n in zip(indices, (len(positions), len(uv), len(normals)))):
                    raise ValueError(f"Invalid OBJ index: {path}")
                corners.append(indices)
            if len(corners) not in (3, 4):
                raise ValueError("Pinned archive should contain only triangles and quads")
            faces.append(corners)
            face_groups.append(current_group)
        elif a[0] == "g":
            current_group = " ".join(a[1:])
            groups.add(current_group)
        elif a[0] == "o": objects.add(" ".join(a[1:]))
        elif a[0] in ("mtllib", "usemtl"): materials.add(line)
    if any(len(p) != 3 for p in positions + normals) or any(len(t) != 3 for t in uv):
        raise ValueError("Unexpected homogeneous vertex/UV coordinates in pinned archive")
    return {"positions": positions, "uv": uv, "normals": normals, "faces": faces,
            "faceGroups": face_groups, "groups": sorted(groups), "objects": sorted(objects), "materials": sorted(materials), "tokens": dict(tokens)}


def bounds(points):
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return {"min": lo, "max": hi, "size": [b - a for a, b in zip(lo, hi)]}


def inventory():
    result = safe_extract()
    result["models"] = []
    for path in sorted((AREA / "source/OBJs").glob("*.obj")):
        model = parse_obj(path)
        uv_name = path.stem.replace("m4a1_s", "m4a1-s") + ".tga"
        sheet = (AREA / "source/UVSheets" / uv_name).read_bytes()
        width, height = struct.unpack_from("<HH", sheet, 12)
        result["models"].append({"name": path.stem, "objSha256": sha(path.read_bytes()),
            "vertices": len(model["positions"]), "uvCoordinates": len(model["uv"]),
            "normalCoordinates": len(model["normals"]), "polygons": len(model["faces"]),
            "uvNonzeroThirdComponent": sum(t[2] != 0 for t in model["uv"]),
            "uvOutsideUnitSquare": sum(not (0 <= t[0] <= 1 and 0 <= t[1] <= 1) for t in model["uv"]),
            "uvBounds": {"min": [min(t[i] for t in model["uv"]) for i in range(3)],
                         "max": [max(t[i] for t in model["uv"]) for i in range(3)]},
            "trianglesAfterTriangulation": sum(len(f) - 2 for f in model["faces"]),
            "faceSizes": dict(Counter(map(len, model["faces"]))), "boundsSourceCoordinates": bounds(model["positions"]),
            "groups": model["groups"], "objects": model["objects"], "materialReferences": model["materials"],
            "uvSheet": {"filename": uv_name, "width": width, "height": height,
                        "bitsPerPixel": sheet[16], "imageType": sheet[2], "bytes": len(sheet)}})
    result["finishExamples"] = [{"filename": p.name,
        "parameters": dict(re.findall(r'"([^"\n]+)"\s+"([^"\n]*)"', p.read_text()))}
        for p in sorted((AREA / "source/FinishExamples").glob("*.txt"))]
    result["units"] = "Unverified source coordinate units. No meter/inch assumption or scaling applied."
    write_json(AREA / "inventory.json", result)
    return result


def build_glb(name):
    """Write source corner attributes directly; Blender ONLY picks quad diagonals.

    Blender OBJ import/export was rejected by the source readback gate because it
    changed some authored normal directions. It is not used for attributes here.
    """
    import bpy
    from mathutils import Vector
    from mathutils.geometry import tessellate_polygon
    path = AREA / "source/OBJs" / f"{name}.obj"
    source = parse_obj(path)
    binary, views, accessors = bytearray(), [], []

    def attribute(values, width, component=5126, target=34962):
        while len(binary) % 4:
            binary.append(0)
        fmt = "f" if component == 5126 else "I"
        data = struct.pack("<" + fmt * (len(values) * width), *(v for row in values for v in row))
        start = len(binary)
        binary.extend(data)
        view = len(views)
        views.append({"buffer": 0, "byteOffset": start, "byteLength": len(data), "target": target})
        converted = list(struct.iter_unpack("<" + fmt * width, data))
        accessors.append({"bufferView": view, "componentType": component, "count": len(values),
            "type": {1: "SCALAR", 2: "VEC2", 3: "VEC3"}[width],
            "min": [min(row[i] for row in converted) for i in range(width)],
            "max": [max(row[i] for row in converted) for i in range(width)]})
        return len(accessors) - 1

    groups = defaultdict(list)
    for group, face in zip(source["faceGroups"], source["faces"]):
        groups[group].append(face)
    primitives, fallback_quads = [], 0
    for group in sorted(groups):
        mapping, ps, us, ns, ws, indices = {}, [], [], [], [], []
        for face in groups[group]:
            if len(face) == 3:
                triangles = [(0, 1, 2)]
            else:
                vectors = [Vector(source["positions"][corner[0]]) for corner in face]
                triangles = tessellate_polygon([vectors])
                # Blender 5.2 returns source point indices (confirmed against the
                # installed API), preserving original OBJ corner identity directly.
                if len(triangles) == 2 and all(isinstance(i, int) and 0 <= i < 4 for tri in triangles for i in tri):
                    triangles = [tuple(tri) for tri in triangles]
                else:
                    repeated = len(set(tuple(v) for v in vectors)) < 4
                    collinear = max((vectors[i] - vectors[0]).cross(vectors[j] - vectors[0]).length
                                    for i, j in ((1, 2), (1, 3), (2, 3))) < 1e-9
                    if not repeated and not collinear:
                        raise ValueError(f"Unexpected nondegenerate tessellation result: {name}")
                    # Retain proven degenerate source faces instead of silently
                    # deleting their corners. The fallback is explicitly counted.
                    triangles = [(0, 1, 2), (0, 2, 3)]
                    fallback_quads += 1
            for tri in triangles:
                for i in tri:
                    key = face[i]
                    if key not in mapping:
                        vi, ti, ni = key
                        mapping[key] = len(ps)
                        ps.append(source["positions"][vi])
                        u, v, w = source["uv"][ti]
                        us.append((u, 1 - v))
                        ws.append((w,))
                        ns.append(normalize(source["normals"][ni]))
                    indices.append((mapping[key],))
        primitives.append({"attributes": {"POSITION": attribute(ps, 3), "NORMAL": attribute(ns, 3),
            "TEXCOORD_0": attribute(us, 2), "_SOURCE_TEXCOORD_W": attribute(ws, 1)},
            "indices": attribute(indices, 1, 5125, 34963), "mode": 4, "extras": {"sourceObjGroup": group}})
    document = {"asset": {"version": "2.0", "generator": f"private-workbench-converter/1; Blender tessellator {bpy.app.version_string}"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"name": name, "mesh": 0}],
        "meshes": [{"name": name, "primitives": primitives}], "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views, "accessors": accessors, "extras": {"sourceObjSha256": sha(path.read_bytes()),
            "sourceUnits": "unverified; original XYZ unchanged", "quadFallbackCount": fallback_quads,
            "sourceUvW": "preserved as _SOURCE_TEXCOORD_W; standard TEXCOORD_0 stores u,1-v"}}
    text = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    data = struct.pack("<III", 0x46546C67, 2, 28 + len(text) + len(binary))
    data += struct.pack("<II", len(text), 0x4E4F534A) + text
    data += struct.pack("<II", len(binary), 0x004E4942) + binary
    return data, fallback_quads


def blender_worker(names):
    import bpy
    outputs = []
    for name in names:
        first, fallbacks = build_glb(name)
        second, _ = build_glb(name)
        if first != second:
            raise ValueError(f"Nondeterministic GLB bytes: {name}")
        destination = AREA / "glb" / f"{name}.glb"
        destination.write_bytes(first)
        outputs.append({"name": name, "sha256": sha(first), "bytes": len(first),
                        "blenderVersion": bpy.app.version_string, "repeatExportSameBytes": True, "quadFallbackCount": fallbacks})
        print("WORKBENCH_EXPORTED", name, sha(first), "quadFallbacks", fallbacks, flush=True)
    write_json(AREA / "glb/export-run.json", outputs)


def read_glb(path):
    data = path.read_bytes()
    magic, version, total = struct.unpack_from("<III", data)
    if (magic, version, total) != (0x46546C67, 2, len(data)):
        raise ValueError("Invalid GLB header")
    size, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A:
        raise ValueError("GLB JSON chunk missing")
    document = json.loads(data[20:20 + size])
    bin_size, kind = struct.unpack_from("<II", data, 20 + size)
    if kind != 0x004E4942:
        raise ValueError("GLB BIN chunk missing")
    binary = data[28 + size:28 + size + bin_size]

    def accessor(index):
        a = document["accessors"][index]
        view = document["bufferViews"][a["bufferView"]]
        if "sparse" in a or a.get("normalized"):
            raise ValueError("Unexpected compressed/sparse validation accessor")
        fmt = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}[a["componentType"]]
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        step = view.get("byteStride", struct.calcsize("<" + fmt * width))
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        return [struct.unpack_from("<" + fmt * width, binary, start + i * step) for i in range(a["count"])]
    return document, accessor


def normalize(v):
    length = math.hypot(*v)
    if not length:
        raise ValueError("Zero normal")
    return tuple(x / length for x in v)


def validate(name):
    source = parse_obj(AREA / "source/OBJs" / f"{name}.obj")
    doc, access = read_glb(AREA / "glb" / f"{name}.glb")
    if any(doc.get(k) for k in ("skins", "animations", "images", "textures", "materials")):
        raise ValueError("Unexpected authored-looking resources in static reference export")
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for node in doc.get("nodes", []):
        if (node.get("translation", [0, 0, 0]) != [0, 0, 0] or node.get("scale", [1, 1, 1]) != [1, 1, 1]
                or node.get("rotation", [0, 0, 0, 1]) != [0, 0, 0, 1] or node.get("matrix", identity) != identity):
            raise ValueError("Export introduced a hidden transform instead of original XYZ")
    source_corner_faces = defaultdict(set)
    for fi, face in enumerate(source["faces"]):
        for key in face:
            source_corner_faces[key].add(fi)
    records, grid = {}, defaultdict(list)
    position_key = lambda p: tuple(round(x * 10_000) for x in p)
    for key in source_corner_faces:
        vi, ti, ni = key
        p, uv, n = source["positions"][vi], source["uv"][ti], normalize(source["normals"][ni])
        records[key] = (p, (uv[0], 1 - uv[1]), n, uv[2])  # Preserve source W separately.
        grid[position_key(p)].append(key)
    maxima = {metric: 0.0 for metric in TOLERANCE}
    covered, face_counts, points, triangle_count = set(), Counter(), [], 0
    for mesh in doc["meshes"]:
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                raise ValueError("Expected indexed triangle primitives")
            attributes = primitive["attributes"]
            ps, us, ns = (access(attributes[k]) for k in ("POSITION", "TEXCOORD_0", "NORMAL"))
            ws = access(attributes["_SOURCE_TEXCOORD_W"])
            points.extend(ps)
            vertex_faces = []
            for p, uv, normal, (w,) in zip(ps, us, ns, ws):
                q = position_key(p)
                nearby = itertools.chain.from_iterable(grid[(q[0] + x, q[1] + y, q[2] + z)]
                    for x, y, z in itertools.product((-1, 0, 1), repeat=3))
                matches = []
                n = normalize(normal)
                for key in nearby:
                    original, original_uv, original_n, original_w = records[key]
                    pe = math.dist(p, original)
                    ue = max(abs(a - b) for a, b in zip(uv, original_uv))
                    ne = math.acos(max(-1, min(1, sum(a * b for a, b in zip(n, original_n)))))
                    we = abs(w - original_w)
                    if pe <= TOLERANCE["positionSourceUnits"] and ue <= TOLERANCE["uv"] and ne <= TOLERANCE["normalDirectionRadians"] and we <= TOLERANCE["uvThirdComponent"]:
                        matches.append((pe + ue + ne + we, key, pe, ue, ne, we))
                if not matches:
                    raise ValueError(f"Unmatched actual GLB source corner: {name} p={p} uv={uv} n={normal}")
                matches.sort()
                _, _, pe, ue, ne, we = matches[0]
                for metric, value in zip(maxima, (pe, ue, ne, we)):
                    maxima[metric] = max(maxima[metric], value)
                equivalent = [m[1] for m in matches if m[0] < matches[0][0] + 1e-7]
                covered.update(equivalent)
                vertex_faces.append(set().union(*(source_corner_faces[k] for k in equivalent)))
            indices = [i[0] for i in access(primitive["indices"])]
            for i in range(0, len(indices), 3):
                candidates = set.intersection(*(vertex_faces[j] for j in indices[i:i + 3]))
                candidates = [fi for fi in sorted(candidates) if face_counts[fi] < len(source["faces"][fi]) - 2]
                if not candidates:
                    raise ValueError(f"GLB triangle does not belong to a remaining original polygon: {name}")
                face_counts[candidates[0]] += 1
                triangle_count += 1
    if len(covered) != len(records) or any(face_counts[fi] != len(f) - 2 for fi, f in enumerate(source["faces"])):
        raise ValueError(f"Source corners/polygons were lost during conversion: {name} corners={len(covered)}/{len(records)}")
    return {"name": name, "passed": True, "maxError": maxima, "tolerance": TOLERANCE,
        "sourcePolygons": len(source["faces"]), "glbTriangles": triangle_count,
        "sourceUniqueCorners": len(records), "coveredSourceCorners": len(covered),
        "sourceBounds": bounds(source["positions"]), "glbBounds": bounds(points),
        "sourceObjSha256": sha((AREA / "source/OBJs" / f"{name}.obj").read_bytes()),
        "glbSha256": sha((AREA / "glb" / f"{name}.glb").read_bytes()),
        "allNodeTransformsIdentity": True, "everyTriangleAssignedToOriginalPolygon": True,
        "triangulationFallbackQuads": doc.get("extras", {}).get("quadFallbackCount", 0),
        "uvConvention": "glTF (u,1-v) corresponds to source OBJ (u,v); source W preserved in _SOURCE_TEXCOORD_W",
        "units": "Unverified. Original XYZ coordinate values and magnitude retained."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", default=["ak-47", "m4a4", "awp"])
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--blender", default=BLENDER)
    args = parser.parse_args()
    audit = inventory()
    known = {item["name"] for item in audit["models"]}
    names = sorted(known if args.all else args.models)
    if set(names) - known:
        raise ValueError("Only pinned source archive model names are accepted")
    if args.inventory_only:
        print(json.dumps({"models": len(known), "files": len(audit["files"]), "bytes": audit["extractedBytes"]}))
        return
    (AREA / "glb").mkdir(exist_ok=True)
    if not args.validate_only:
        subprocess.run([args.blender, "--background", "--factory-startup", "--python-exit-code", "1",
                        "--python", str(Path(__file__).resolve()), "--", "--worker", *names], check=True)
    outputs = []
    for name in names:
        result = validate(name)
        write_json(AREA / "glb" / f"{name}.validation.json", result)
        outputs.append(result)
        print("WORKBENCH_VALIDATED", name, json.dumps(result["maxError"]), flush=True)
    write_json(AREA / "validation-run.json", outputs)
    # Re-read extraction: source byte comparison catches any accidental source edit.
    safe_extract()
    print(json.dumps({"convertedAndValidated": len(outputs), "units": "unverified-original-coordinates", "allPassed": True}))


if __name__ == "__main__":
    if "--worker" in sys.argv:
        blender_worker(sys.argv[sys.argv.index("--worker") + 1:])
    else:
        main()
