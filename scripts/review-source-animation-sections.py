"""Read-only original AK/M4 section audit, no model/production file writes."""
import ast
import importlib.util
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools'))
import numpy as np
from SourceIO.library.models.mdl.v49 import MdlV49
from SourceIO.library.models.mdl.load_animations import load_animations_from_mdl
from SourceIO.library.models.mdl.structs.local_animation import StudioAnimDesc,AniBoneFlags,ANIM_DTYPE
from SourceIO.library.models.mdl.structs.frame_anim import StudioFrameAnim
from SourceIO.library.models.mdl.structs.compressed_vectors import Quat48,Quat48S
from SourceIO.library.shared.app_id import SteamAppId
from SourceIO.library.shared.content_manager import ContentManager
from SourceIO.library.shared.content_manager.providers.vpk_provider import VPKContentProvider
from SourceIO.library.utils import TinyPath
report={'frame_animation_adapter':{'observations':[]}}
tree=ast.parse((ROOT/'scripts/import-source-weapon.py').read_text())
function=next(n for n in ast.walk(tree)if isinstance(n,ast.FunctionDef)and n.name=='read_csgo_frame_animation')
exec(compile(ast.Module(body=[function],type_ignores=[]),'original-frame-adapter','exec'),globals())
StudioAnimDesc._read_frame_animations=read_csgo_frame_animation
spec=importlib.util.spec_from_file_location('section_review',ROOT/'scripts/source-section-decoder.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
cm=ContentManager();cm.clean();provider=VPKContentProvider(TinyPath(str(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')),SteamAppId.COUNTER_STRIKE_GO);cm.add_child(provider);cm.priority_list=[provider]
observations=[];module.install_source_section_decoder(observations)
for model in ('v_rif_ak47','v_rif_m4a1'):
 path=TinyPath('models/weapons/'+model+'.mdl');raw=cm.find_file(path);assert raw is not None
 before=len(observations);mdl=MdlV49.from_buffer(raw);animations=load_animations_from_mdl(mdl,raw,cm,path)
 for row in observations[before:]:row['sourceModel']=str(path)
result={'scope':'read-only original final frame section vs pinned SourceIO sequential section decode','sourceSDK':'https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/studio.cpp#L70',
 'observations':observations,'sourceFilesModified':False}
(ROOT/'output/source-animation-section-review.json').write_text(json.dumps(result,indent=2)+'\n')
print('SECTION_REVIEW',json.dumps([{k:r[k]for k in ('sourceModel','animation','sourceioPreviousMaxComponentDifference','lastFrameMaxComponentDifference','lastFrameChangedChannels')}for r in observations]))
