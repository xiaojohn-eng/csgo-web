"""Private AK final-section candidates. Never overwrite current/public AK files."""
from pathlib import Path
import hashlib,importlib.util,json,sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools'))
import SourceIO
spec=importlib.util.spec_from_file_location('ak_last_sections',ROOT/'scripts/source-section-decoder.py');section=importlib.util.module_from_spec(spec);spec.loader.exec_module(section)
selected=sys.argv[sys.argv.index('--team')+1]if '--team'in sys.argv else 't';assert selected in ('t','ct')
# Run the other team in a separate factory-startup process; orphan actions in
# Blender's datablocks otherwise cause .001 clip suffixes on the second model.
for team in [selected]:
 out=ROOT/f'.reference-assets/source-exports/ak47-{team}-section-candidate';out.mkdir(parents=True,exist_ok=True);observations=[];restore=section.install_source_section_decoder(observations)
 if team=='t':
  original=ROOT/'scripts/import-source-weapon.py'
  sys.argv=[sys.argv[0],'--background','--factory-startup','--','--confirmed-complete','--model','models/weapons/v_rif_ak47.mdl','--arms-model','models/weapons/t_arms.mdl','--export-glb','--output-dir',str(out)]
  source=original.read_text()
 else:
  original=ROOT/'scripts/import-source-ct-viewmodel.py';source=original.read_text().replace("'.reference-assets/source-exports/ak47-ct-arms'", "'.reference-assets/source-exports/ak47-ct-section-candidate'")
  sys.argv=[sys.argv[0],'--background','--factory-startup']
 exec(compile(source,str(original),'exec'),{'__file__':str(original),'__name__':'__main__'})
 restore();audit=json.loads((out/'audit.json').read_text());audit['sectionDecoder']=observations;(out/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')
 print('AK_SECTION_CANDIDATE',team,audit['glb']['sha256'],flush=True)
