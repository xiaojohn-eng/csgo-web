"""Run original App740 hitbox instructions on independent AWP body pose matrices."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('probe-source-pistol-hitboxes.py',[
 ("for weapon in ('glock','usp'):", "for weapon in ('awp',):"),
 ('pistol-candidates','awp-character-candidates'),
 ('source-pistol-hitbox-native.json','source-awp-character-hitbox-native.json'),
 ('complete pistol body matrices, including explicit reload/silencer layers','complete AWP body matrices, including original Reload_AWP layers'),
 ('original pistol pose rays','original AWP pose rays'),
])
