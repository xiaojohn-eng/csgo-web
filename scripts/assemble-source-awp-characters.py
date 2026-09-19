"""Original player surfaces/IBMs plus original AWP world rig, byte-preserving.
The selected body pose is the freshly decoded AWP family, not AK/pistol poses.
"""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('assemble-source-pistol-characters.py',[
 ("P=BASE/'pistol-candidates'", "P=BASE/'awp-character-candidates'"),
 ("family=P/f'character-{team}-pistol/continuous'", "family=P/f'character-{team}-awp-family/continuous'"),
 ("basepose['animationExtension']=='pistol'", "basepose['animationExtension']=='awp'"),
 ("for weapon in ['glock','usp']:", "for weapon in ['awp']:"),
 ("w=P/f'{weapon}-world'", "w=BASE/f'awp-candidates/{weapon}-world'"),
 ('source-pistol-character-rig-v1','source-awp-character-rig-v1'),
 ('passed-byte-preserving-pistol-assembly','passed-byte-preserving-awp-assembly'),
 ('PISTOL_CHARACTER_ASSEMBLY','AWP_CHARACTER_ASSEMBLY'),
])
