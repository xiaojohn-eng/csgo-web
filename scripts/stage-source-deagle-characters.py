"""Freeze Deagle character assets only after independent graph/IBM readback."""
from pathlib import Path
import importlib.util,json
spec=importlib.util.spec_from_file_location('deagle_pipeline',Path(__file__).with_name('source-deagle-pipeline.py'))
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
pipeline.run('stage-source-pistol-characters.py',[
    ('pistol-candidates','deagle-candidates'),
    ("for weapon in ['glock','usp']:","for weapon in ['deagle']:"),
    ("('pist_glock18'if weapon=='glock'else'pist_223')","'pist_deagle'"),
    ('source-pistol-character-staged.json','source-deagle-character-staged.json'),
    ('Glock phongalbedoboost','Deagle phongalbedoboost'),
    ('action layers and USP visibility','action layers and original magazine visibility'),
])
rows=json.loads((pipeline.ROOT/'output/source-deagle-character-staged.json').read_text())
frozen={row['team']+'-'+row['weapon']:{key:row[key]for key in ['poseVersion','manifestSha256','modelSha256','rigSha256']}for row in rows}
(pipeline.ROOT/'game/source-deagle-character-contracts.ts').write_text('// Original Deagle character stage, frozen after independent body/world graph validation.\nexport const SOURCE_DEAGLE_CHARACTERS = '+json.dumps(frozen,indent=2)+' as const;\n')

type_source=(pipeline.ROOT/'game/source-pistol-character-contracts.ts').read_text()
type_source=type_source[type_source.index('export type SourcePistolCharacterManifest='):]
type_source=type_source.replace('SourcePistol','SourceDeagle').replace("'glock'|'usp'","'deagle'").replace('93|95','93')
with (pipeline.ROOT/'game/source-deagle-character-contracts.ts').open('a') as target: target.write('\n'+type_source)
