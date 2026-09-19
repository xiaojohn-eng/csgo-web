"""Private corrected-section AK continuous pose candidates, preserving old GLBs."""
from pathlib import Path
import hashlib,importlib.util,json,sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools'))
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath
cm=ContentManager();cm.clean();provider=VPKContentProvider(TinyPath(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'),SteamAppId.COUNTER_STRIKE_GO);cm.add_child(provider);cm.priority_list=[provider]
spec=importlib.util.spec_from_file_location('ak_pose_candidate_sections',ROOT/'scripts/source-section-decoder.py');section=importlib.util.module_from_spec(spec);spec.loader.exec_module(section)
for team,report_file,sampler_file,exporter in [('t','combat-audit.json','source-character-animation.py','export-source-character-pose.py'),('ct','metadata-preflight.json','source-ct-animation.py','export-source-ct-pose.py')]:
 base=ROOT/f'.reference-assets/source-exports/character-{team}';out=ROOT/f'.reference-assets/source-exports/character-{team}-ak-section-candidate';out.mkdir(parents=True,exist_ok=True)
 report=json.loads((base/report_file).read_text());parsed={};buffers={};original=StudioAnimDesc.read_animations
 try:
  StudioAnimDesc.read_animations=lambda *a,**k:None
  for name in [report['selectedModel'],f'models/player/{team}_animations.mdl']:
   raw=cm.find_file(TinyPath(name));assert raw is not None;content=raw.read();assert hashlib.sha256(content).hexdigest()==report['dependencies'][name]['sha256']
   raw.seek(0);parsed[name]=MdlV49.from_buffer(raw);buffers[name]=raw
 finally:StudioAnimDesc.read_animations=original
 observations=[];restore=section.install_source_section_decoder(observations)
 spec=importlib.util.spec_from_file_location('ak_original_'+team,ROOT/'scripts'/sampler_file);sampler=importlib.util.module_from_spec(spec);spec.loader.exec_module(sampler)
 sampler.sample_combat(parsed[report['selectedModel']],parsed,buffers,cm,report,out);restore();report['sectionDecoder']=observations;(out/'combat-audit.json').write_text(json.dumps(report,indent=2)+'\n')
 source=(ROOT/'scripts'/exporter).read_text().replace("OUT = BASE / 'continuous'",f"OUT = ROOT / '.reference-assets/source-exports/character-{team}-ak-section-candidate/continuous'")
 source=source.replace("metadata_path = BASE / 'combat/source-animation-metadata.json'; frames_path = BASE / 'combat/decoded-frames.npz'","metadata_path = OUT.parent / 'combat/source-animation-metadata.json'; frames_path = OUT.parent / 'combat/decoded-frames.npz'")
 ns={'__file__':str(ROOT/'scripts'/exporter),'__name__':'ak_candidate_export'};exec(compile(source,str(ROOT/'scripts'/exporter),'exec'),ns);ns['main']()
 print('AK_POSE_SECTION_CANDIDATE',team,hashlib.sha256((out/'continuous/pose-data.json').read_bytes()).hexdigest(),flush=True)
