"""Read back every original Deagle sound and derive exact script event/timing data."""
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
source=(pipeline.ROOT/'scripts/stage-source-pistol-audio.py').read_text()
usp_only=source[source.index('# The original modern USP'):source.index("out = ROOT / 'game/source-pistol-audio.json'")]
pipeline.run('stage-source-pistol-audio.py',[
    ('source-pistol-contracts.ts','source-deagle-contracts.ts'),
    ("for weapon in ('glock', 'usp'):","for weapon in ('deagle',):"),
    (usp_only, ""),
    ('source-pistol-audio.json','source-deagle-audio.json'),
    ('source-pistol-audio-stage.json','source-deagle-audio-stage.json'),
])
