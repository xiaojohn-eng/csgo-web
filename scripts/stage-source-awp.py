"""Stage all independently verified AWP FP clips, raw scope textures and sounds."""
from pathlib import Path
import importlib.util,json
spec=importlib.util.spec_from_file_location('awp_pipeline',Path(__file__).with_name('source-awp-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('stage-source-pistols.py',[
    ("for weapon in ['glock','usp']:","for weapon in ['awp']:"),
    ('pistol-candidates','awp-candidates'),
    ("(325 if weapon=='glock'else 716)",'435'),
    ("'pist_glock18'if weapon=='glock'else'pist_223'","'awp'"),
    ("stems=[gun,gun+'_exponent']","stems=[gun,gun+'_exponent','scope','scope_normal']"),
    ('clips=clips,soundEvents=', 'clips=clips,sourceSequences=fp["sequences"],soundEvents='),
    ('source-pistol-staged.json','source-awp-staged.json'),
])
rows=json.loads((pipeline.ROOT/'output/source-awp-staged.json').read_text())
frozen={row['weapon']+'-'+row['team']:{key:row[key]for key in ['manifestSha256','glbSha256','rigSha256']}for row in rows}
(pipeline.ROOT/'game/source-awp-contracts.ts').write_text('// Original App740 AWP FP files; all source frames and raw IBMs verified.\nexport const SOURCE_AWP_ASSETS = '+json.dumps(frozen,indent=2)+' as const;\n')
