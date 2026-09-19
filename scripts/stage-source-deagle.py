"""Stage the independently verified Deagle FP exports and freeze their hashes."""
from pathlib import Path
import importlib.util,json
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('stage-source-pistols.py',[
    ("for weapon in ['glock','usp']:","for weapon in ['deagle']:"),
    ('pistol-candidates','deagle-candidates'),
    ("(325 if weapon=='glock'else 716)",'639'),
    ("'pist_glock18'if weapon=='glock'else'pist_223'","'pist_deagle'"),
    ('source-pistol-staged.json','source-deagle-staged.json'),
])
rows=json.loads((pipeline.ROOT/'output/source-deagle-staged.json').read_text())
frozen={row['weapon']+'-'+row['team']:{key:row[key]for key in ['manifestSha256','glbSha256','rigSha256']}for row in rows}
(pipeline.ROOT/'game/source-deagle-contracts.ts').write_text('// Original App740 Deagle FP files; staged after independent source-frame readback.\nexport const SOURCE_DEAGLE_ASSETS = '+json.dumps(frozen,indent=2)+' as const;\n')
