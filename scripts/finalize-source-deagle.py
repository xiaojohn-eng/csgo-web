"""Remove only verified unused invalid Deagle tangent semantics, keeping BIN bytes."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('finalize-source-pistol.py',[("['pist_glock18','pist_223']","['pist_deagle']")])
