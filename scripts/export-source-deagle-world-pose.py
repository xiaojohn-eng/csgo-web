"""Export every original Deagle world pose descriptor and five aim autolayers."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('export-source-pistol-world-pose.py',[
    ('pistol-candidates','deagle-candidates'),
    ("for weapon in ['glock','usp']:","for weapon in ['deagle']:"),
    ("('4'if weapon=='glock'else'61')","'1'"),
])
