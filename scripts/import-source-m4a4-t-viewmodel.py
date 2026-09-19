"""Original M4A4 plus T48 arms, with repaired source sections and exact two IBMs."""
from pathlib import Path
import ast,hashlib,importlib.util,json,struct,sys,re
ROOT=Path(__file__).resolve().parents[1]
# Reuse the verified M4 draw/section/model adapter up to its original export.
source=(ROOT/'scripts/import-source-m4a4.py').read_text();source=source[:source.index("spec = importlib.util.spec_from_file_location('m4a4_items'")]
source=source.replace("'.reference-assets/source-exports/m4a4'","'.reference-assets/source-exports/m4a4-t-arms'").replace('models/weapons/ct_arms_idf.mdl','models/weapons/t_arms.mdl')
exec(compile(source,'m4-t-original-export','exec'),globals())
# Run only the original generic metadata/texture reader on the actual T MDL.
source=(ROOT/'scripts/import-source-ct-viewmodel.py').read_text();source=source[source.index("spec = importlib.util.spec_from_file_location('ct_viewmodel_items'"):]
source=source.replace('models/weapons/ct_arms_idf.mdl','models/weapons/t_arms.mdl').replace("['ct_arms']","['t_arms']").replace("'ct-metadata.json'","'t-metadata.json'").replace('ctExactInverseBind','armsExactInverseBind')
exec(compile(source,'original-t-arms-metadata','exec'),globals())
arms=metadata
source=(ROOT/'scripts/import-source-m4a4.py').read_text();source=source[source.index('# Both original skins'):source.index('event_names =')]
exec(compile(source,'exact-m4-t-inverse-binds','exec'),globals())
result=dict(weaponId='m4a4',itemDefinition=16,arms=arms,glb=audit['glb'],sourceModels=audit['source_models'],sectionDecoder=section_observations,exactInverseBind=bind_rows)
(OUT/'m4a4-metadata.json').write_text(json.dumps(result,indent=2,default=lambda v:v.tolist())+'\n')
print('M4_T_EXPORT',audit['glb']['sha256'])
