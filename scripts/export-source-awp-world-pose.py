"""Retain all original AWP world frames, masks, sequence metadata and attachments."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('export-source-pistol-world-pose.py',[
    ('pistol-candidates','awp-candidates'),
    ("for weapon in ['glock','usp']:","for weapon in ['awp']:"),
    ("('4'if weapon=='glock'else'61')","'9'"),
    ("'source-pistol-world-pose-v1'","'source-awp-world-pose-v1'"),
    ("'output/tests/source-pistol-autolayers-native.json'","'No world auto layers in original w_snip_awp.mdl'"),
])
