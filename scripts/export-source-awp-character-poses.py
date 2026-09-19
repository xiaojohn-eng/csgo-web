"""Decode the actual T/CT AWP family and its complete original autolayer closure.
Body geometry/IBM comes from the original player; no pistol/rifle pose fallback.
"""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('export-source-pistol-character-poses.py',[
 ('pistol-candidates','awp-character-candidates'),
 ('character-{team}-pistol','character-{team}-awp-family'),
 ("('pistol' in s['name'].lower() and any(word in s['name']", "('AWP' in s['name'] and any(word in s['name']"),
 ("'_Upper_PISTOL'", "'_Upper_AWP'"),
 ("'_Shoot_Pistol'", "'_Shoot_AWP'"),
 ("weaponId='pistol-family-candidate', animationExtension='pistol'", "weaponId='awp-family-candidate', animationExtension='awp'"),
 ('PISTOL_CHARACTER_DONE','AWP_CHARACTER_DONE'),
])
