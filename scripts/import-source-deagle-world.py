"""Export the original Deagle world mesh, IBM and seven simple source sequences."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('import-source-pistol-world.py',[
    ('pistol-candidates','deagle-candidates'),
    ("choices=['glock','usp']","choices=['deagle']"),
    ("('4'if weapon_id=='glock'else'61')","'1'"),
    ("(7 if weapon_id=='glock'else 15)",'7'),
])
