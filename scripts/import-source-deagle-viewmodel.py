"""Export every original Deagle FP clip with exact source T/CT arm bindings."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
source=(pipeline.ROOT/'scripts/import-source-pistol-viewmodel.py').read_text()
old_map=next(line for line in source.splitlines() if line.startswith('sequence_map='))
sequence_map={'idle1':'idle','shoot1':'fire_1','shoot2':'fire_2','shoot3':'fire_3','shoot_empty':'fire_empty','reload':'reload','draw':'draw','lookat01':'inspect_1','lookat02':'inspect_2'}
pipeline.run('import-source-pistol-viewmodel.py',[
    ('pistol-candidates','deagle-candidates'),
    ("choices=['glock','usp']","choices=['deagle']"),
    ("('4'if weapon_id=='glock'else'61')","'1'"),
    (old_map,'sequence_map='+repr(sequence_map)),
    ('Silencer geometry exported, original named visibility events retained; GLB alone does not apply those events','Original Deagle has no silencer bodygroup; all original sequence events are retained'),
])
