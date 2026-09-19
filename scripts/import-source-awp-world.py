"""Export the original 94-bone AWP world model and all five original clips."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('import-source-pistol-world.py',[
    ('pistol-candidates','awp-candidates'),
    ("choices=['glock','usp']","choices=['awp']"),
    ("('4'if weapon_id=='glock'else'61')","'9'"),
    ("(7 if weapon_id=='glock'else 15)",'5'),
    ('Source 9way pistol_aim_t layers flags16448 not yet composed; this is a standalone candidate','Original AWP world graph has five ordinary sequences and no aim autolayer wrapper; player AWP graph is separate'),
])
