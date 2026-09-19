"""Bounded read-only last-section audit of the two existing 92-descriptor pose sets."""
import ast
import importlib.util
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools'))
import numpy as np
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.load_animations import _resolve_ani_file,_get_block_table
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AniBoneFlags,ANIM_DTYPE
from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48,Quat48S
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath
report={'frameDecoder':{'observations':[]}}
tree=ast.parse((ROOT/'scripts/source-character-animation.py').read_text())
function=next(n for n in ast.walk(tree)if isinstance(n,ast.FunctionDef)and n.name=='decode')
exec(compile(ast.Module(body=[function],type_ignores=[]),'original-character-frame-adapter','exec'),globals())
StudioAnimDesc._read_frame_animations=decode
spec=importlib.util.spec_from_file_location('character_section_review',ROOT/'scripts/source-section-decoder.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
cm=ContentManager();cm.clean();provider=VPKContentProvider(TinyPath(str(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')),SteamAppId.COUNTER_STRIKE_GO);cm.add_child(provider);cm.priority_list=[provider]
observations=[];original=StudioAnimDesc.read_animations
for team in ('t','ct'):
 source='models/player/'+team+'_animations.mdl';path=TinyPath(source);raw=cm.find_file(path);assert raw is not None
 StudioAnimDesc.read_animations=lambda *a,**k:None
 mdl=MdlV49.from_buffer(raw);StudioAnimDesc.read_animations=original;restore=module.install_source_section_decoder(observations)
 metadata=json.loads((ROOT/f'.reference-assets/source-exports/character-{team}/combat/source-animation-metadata.json').read_text())
 ani=_resolve_ani_file(mdl,cm,path);blocks=_get_block_table(mdl,raw);assert ani is not None
 before=len(observations)
 for d in metadata['descriptors']:
  if d['sections']:mdl.anim_descs[d['index']].read_animations(raw,mdl.bones,ani.buffer,blocks)
 for row in observations[before:]:row['sourceModel']=source
 restore()
result={'scope':'read-only existing continuous T/CT 92-descriptor sets, sectioned subset only','sourceSDK':'https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.cpp#L70','observations':observations,'sourceFilesModified':False}
(ROOT/'output/source-character-section-review.json').write_text(json.dumps(result,indent=2)+'\n')
print('CHARACTER_SECTIONS',json.dumps([{k:r[k]for k in ('sourceModel','animation','sourceioPreviousMaxComponentDifference','lastFrameMaxComponentDifference')}for r in observations]))
