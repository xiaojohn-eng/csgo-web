"""Read App740 original Deagle item/model/material metadata into its own candidate."""
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location('deagle_pipeline', Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline = importlib.util.module_from_spec(spec); spec.loader.exec_module(pipeline)
pipeline.run('inventory-source-pistols.py', [
    ('pistol-candidates', 'deagle-candidates'),
    ("for id in ['4','61']:", "for id in ['1']:"),
])
