"""Process-local SourceIO loading audit; run with Blender --factory-startup.

No models are loaded, no user preferences are saved, and no game files are edited.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import platform
from pathlib import Path
import subprocess
import sys
import time
import traceback

import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".tools" / "SourceIO"
EXPECTED_COMMIT = "cfc2591d096628a35f570aa830ab75cc8665108b"
OUTPUT = ROOT / "output" / "sourceio-smoke.json"
START = time.perf_counter()
report = {
    "scope": "import/register/native-library/interface smoke; no model or animation conversion",
    "expected_commit": EXPECTED_COMMIT,
    "blender_version": bpy.app.version_string,
    "blender_build_hash": bpy.app.build_hash.decode(),
    "python_version": platform.python_version(),
    "machine": platform.machine(),
    "background": bpy.app.background,
    "source_directory": str(SOURCE),
    "user_preferences_saved": False,
    "game_assets_modified": False,
    "source_models_loaded": 0,
    "status": "running",
}
registered = False
sourceio = None

try:
    assert bpy.app.background, "Smoke requires --background"
    assert "--factory-startup" in sys.argv, "Smoke requires --factory-startup"
    assert platform.machine() == "arm64", "Expected native Apple Silicon Blender"
    commit = subprocess.check_output(
        ["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True
    ).strip()
    report["actual_commit"] = commit
    assert commit == EXPECTED_COMMIT, "SourceIO checkout differs from reviewed commit"
    report["source_dirty"] = bool(subprocess.check_output(
        ["git", "-C", str(SOURCE), "status", "--porcelain", "--untracked-files=no"], text=True
    ).strip())
    assert not report["source_dirty"], "SourceIO tracked files differ from reviewed commit"
    report["license_sha256"] = hashlib.sha256((SOURCE / "LICENSE").read_bytes()).hexdigest()

    sys.path.insert(0, str(SOURCE.parent))
    sourceio = importlib.import_module("SourceIO")
    report["sourceio_version"] = list(sourceio.bl_info["version"])
    report["sourceio_min_blender"] = list(sourceio.bl_info["blender"])
    report["import_seconds"] = time.perf_counter() - START

    native = importlib.import_module("SourceIO.library.utils.pylib.macos.pylib")
    native_file = Path(native.__file__).resolve()
    assert native_file.is_relative_to(SOURCE), "Native library escaped project checkout"
    report["native_library"] = str(native_file)
    report["native_sha256"] = hashlib.sha256(native_file.read_bytes()).hexdigest()
    report["native_exports"] = [
        name for name in ("VPKFile", "compression", "image", "mesh", "vtf") if hasattr(native, name)
    ]
    assert len(report["native_exports"]) == 5, "Native module lacks expected SourceIO interfaces"

    before_addons = set(bpy.context.preferences.addons.keys())
    sourceio.register()
    registered = True
    report["register_seconds"] = time.perf_counter() - START
    report["added_preference_addons"] = sorted(set(bpy.context.preferences.addons.keys()) - before_addons)

    operators = {}
    for name in ("mdl", "bsp", "vtf", "vmt"):
        rna = getattr(bpy.ops.sourceio, name).get_rna_type()
        properties = {p.identifier: p for p in rna.properties}
        operators[name] = {"identifier": rna.identifier, "properties": sorted(properties)}
        if name == "mdl":
            expected = {
                "filepath", "files", "discover_resources", "import_textures",
                "import_animations", "import_include_animations", "load_refpose", "use_bvlg",
            }
            assert expected <= properties.keys(), "MDL RNA differs from reviewed interface"
            operators[name]["animation_defaults"] = {
                key: properties[key].default for key in ("import_animations", "import_include_animations")
            }
    report["operators"] = operators
    report["status"] = "passed"
except Exception:
    report["status"] = "failed"
    report["error"] = traceback.format_exc()
finally:
    if registered and sourceio is not None:
        try:
            sourceio.unregister()
            report["unregister"] = "passed"
        except Exception:
            report["unregister"] = "failed"
            report["unregister_error"] = traceback.format_exc()
            report["status"] = "failed"
    report["elapsed_seconds"] = time.perf_counter() - START
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("SOURCEIO_SMOKE " + json.dumps({
        "status": report["status"], "output": str(OUTPUT),
        "machine": report["machine"], "elapsed_seconds": report["elapsed_seconds"],
    }))

if report["status"] != "passed":
    raise RuntimeError(report.get("error", report.get("unregister_error", "SourceIO smoke failed")))
