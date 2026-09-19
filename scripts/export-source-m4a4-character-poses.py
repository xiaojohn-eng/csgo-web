"""Original m4 (never m4_s) continuous pose libraries for both Dust2 rigs.
Uses frozen original samplers plus the corrected original last-frame section.
Original actor geometry/IBM are reused by SHA, no AK upper pose is substituted.
"""
from pathlib import Path
import ast,hashlib,importlib.util,json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools'))
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath
cm=ContentManager();cm.clean();provider=VPKContentProvider(TinyPath(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk'),SteamAppId.COUNTER_STRIKE_GO);cm.add_child(provider);cm.priority_list=[provider]
spec=importlib.util.spec_from_file_location('m4_character_sections',ROOT/'scripts/source-section-decoder.py');section=importlib.util.module_from_spec(spec);spec.loader.exec_module(section)
for team,report_file,sampler_file,exporter in [('t','combat-audit.json','source-character-animation.py','export-source-character-pose.py'),('ct','metadata-preflight.json','source-ct-animation.py','export-source-ct-pose.py')]:
 base=ROOT/f'.reference-assets/source-exports/character-{team}'
 out=ROOT/f'.reference-assets/source-exports/character-{team}-m4';out.mkdir(parents=True,exist_ok=True)
 report=json.loads((base/report_file).read_text());parsed={};buffers={}
 original=StudioAnimDesc.read_animations
 try:
  StudioAnimDesc.read_animations=lambda *a,**k:None
  for name in [report['selectedModel'],f'models/player/{team}_animations.mdl']:
   raw=cm.find_file(TinyPath(name));assert raw is not None
   content=raw.read();assert hashlib.sha256(content).hexdigest()==report['dependencies'][name]['sha256'],'Original model changed'
   raw.seek(0);parsed[name]=MdlV49.from_buffer(raw);buffers[name]=raw
 finally:StudioAnimDesc.read_animations=original
 observations=[];restore=section.install_source_section_decoder(observations)
 source=(ROOT/'scripts'/sampler_file).read_text()
 token="('AK' in s['name'] and any(word in s['name']"
 assert source.count(token)==1
 source=source.replace(token,"('M4' in s['name'] and not (s['name'].endswith('_M4_s') or '_M4_s_' in s['name']) and any(word in s['name']")
 source=source.replace("+'_Upper_AK'","+'_Upper_M4'").replace("+'_Shoot_AK'","+'_Shoot_M4'").replace('lower+AK upper','lower+M4 upper')
 namespace={'__file__':str(ROOT/'scripts'/sampler_file),'__name__':'m4_original_sampler'}
 exec(compile(source,str(ROOT/'scripts'/sampler_file),'exec'),namespace)
 namespace['sample_combat'](parsed[report['selectedModel']],parsed,buffers,cm,report,out)
 restore();report['sectionDecoder']=observations
 (out/'combat-audit.json').write_text(json.dumps(report,indent=2)+'\n')
 source=(ROOT/'scripts'/exporter).read_text()
 source=source.replace("OUT = BASE / 'continuous'",f"OUT = ROOT / '.reference-assets/source-exports/character-{team}-m4/continuous'")
 source=source.replace("metadata_path = BASE / 'combat/source-animation-metadata.json'; frames_path = BASE / 'combat/decoded-frames.npz'","metadata_path = OUT.parent / 'combat/source-animation-metadata.json'; frames_path = OUT.parent / 'combat/decoded-frames.npz'")
 source=source.replace("state + '_Upper_AK'","state + '_Upper_M4'").replace("state + '_Shoot_AK'","state + '_Shoot_M4'")
 source=source.replace("mainModel=", "weaponId='m4a4', animationExtension='m4', mainModel=")
 # Original character geometry stays in its original directory. A later combined
 # model receipt maps these unchanged body joints with the new world M4 skin.
 source=source.replace("file=glb_path.name", "file=str(glb_path)").replace("file='../character-ct-ak/' + glb_path.name", "file=str(glb_path)")
 ns={'__file__':str(ROOT/'scripts'/exporter),'__name__':'m4_export_data'}
 exec(compile(source,str(ROOT/'scripts'/exporter),'exec'),ns);ns['main']()
 meta=json.loads((out/'continuous/pose-data.json').read_text());assert all(not (s['name'].endswith('_M4_s') or '_M4_s_' in s['name'])for s in meta['sequences'])
 print('M4_CHARACTER_DONE',team,len(meta['descriptors']),sum(d['frames']for d in meta['descriptors']),flush=True)
