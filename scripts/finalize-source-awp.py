"""Remove only verified unused zero body tangents; scope normal tangents stay."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('finalize-source-pistol.py',[("['pist_glock18','pist_223']","['awp']")])
