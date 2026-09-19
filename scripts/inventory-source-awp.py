"""Read original App740 AWP models, sequences, VMTs and item definition 9."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('inventory-source-pistols.py',[
    ('pistol-candidates','awp-candidates'),
    ("for id in ['4','61']:","for id in ['9']:"),
])
