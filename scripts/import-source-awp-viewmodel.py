"""Export all seven original AWP FP clips and exact T/CT arms bindings."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
source=(pipeline.ROOT/'scripts/import-source-pistol-viewmodel.py').read_text()
old_map=next(line for line in source.splitlines() if line.startswith('sequence_map='))
sequence_map={'awp_idle':'idle','awp_fire':'fire','awp_draw':'draw','awp_reload':'reload','lookat01':'inspect','lookat01_prepare':'inspect_prepare','lookat01_loop':'inspect_loop'}
pipeline.run('import-source-pistol-viewmodel.py',[
    ('pistol-candidates','awp-candidates'),
    ("choices=['glock','usp']","choices=['awp']"),
    ("('4'if weapon_id=='glock'else'61')","'9'"),
    (old_map,'sequence_map='+repr(sequence_map)),
    ('events={};pending=list(sorted(event_names))', "event_names.update(name for name in catalog['soundEvents'] if name.startswith('weapon_awp.'));event_names.add('default.clipempty_rifle')\nevents={};pending=list(sorted(event_names))"),
    ('Silencer geometry exported, original named visibility events retained; GLB alone does not apply those events','Original AWP scope body and normal texture retained; optical zoom/HUD rendering is a separate client feature'),
])
