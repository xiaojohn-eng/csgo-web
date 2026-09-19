"""Compatibility entry point for the alias-aware original CustomWeapon exporter."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('export-source-customweapon-all-programs.py')),run_name='__main__')
