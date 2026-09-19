"""Combine unchanged original PISTOL-family body buffers with Deagle world buffers."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('assemble-source-pistol-characters.py',[
    ("P=BASE/'pistol-candidates'","P=BASE/'deagle-candidates'"),
    ("family=P/f'character-{team}-pistol/continuous'","family=BASE/f'pistol-candidates/character-{team}-pistol/continuous'"),
    ("for weapon in ['glock','usp']:","for weapon in ['deagle']:"),
])
