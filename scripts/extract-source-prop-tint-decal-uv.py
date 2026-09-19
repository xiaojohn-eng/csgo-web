"""Reuse the frozen exact-oriented-triangle UV2 algorithm with a new output set.
The imported original module only defines functions; its R3 output stays untouched.
"""
from pathlib import Path
import importlib.util
root=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('compound_uv',root/'scripts/extract-source-prop-decal-uv.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.OUT=root/'.reference-assets/source-exports/dust2-vhv/tint-decal'
m.main()
