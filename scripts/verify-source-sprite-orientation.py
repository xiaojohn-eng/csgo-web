"""Run the installed client's orientation parameter dispatch; retain the pinned
Valve shader's meaning separately. This does not execute a native GPU shader."""
from pathlib import Path
import importlib.util,json,hashlib,struct,urllib.request
from unicorn.x86_const import UC_X86_REG_EAX,UC_X86_REG_EBP,UC_X86_REG_EIP,UC_X86_REG_ESP
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('particle_native',ROOT/'scripts/source-pistol-particles-native.py');native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native);c=native.NativeClient()
OUT=ROOT/'output/fidelity-character/particle-orientation';OUT.mkdir(parents=True,exist_ok=True)
# C_OP_RenderSprites::Render selects a material's orientation parameter, then
# clamps the exact PCF instance field at +0x98 and calls SetIntValue.
assert bytes(c.u.mem_read(0xd37cd3,7))==bytes.fromhex('83 bf 98 00 00 00 03')
assert bytes(c.u.mem_read(0xd37cf1,3))==bytes.fromhex('ff 57 14')
obj=c.arena;vtable=obj+0x100;renderer=obj+0x200;frame=obj+0x400;stub=obj+0x500
c.integer(obj,vtable);c.integer(vtable+0x14,stub);c.integer(frame+8,renderer)
seen=[]
def set_int(c):
 sp=c.u.reg_read(UC_X86_REG_ESP);assert c.read(sp+4)==obj;seen.append(c.read(sp+8));c.return_value(0)
c.adapters[stub]=set_int;c.adapters[0xd37cf4]=lambda c:c.u.reg_write(UC_X86_REG_EIP,c.ret)
cases=[]
for orientation in [-1,0,1,2,3,4]:
 c.integer(renderer+0x98,orientation);c.u.reg_write(UC_X86_REG_EBP,frame);c.u.reg_write(UC_X86_REG_EAX,obj);c.call(0xd37ccb)
 assert seen[-1]==max(0,min(3,orientation));cases.append({'pcfOrientationType':orientation,'materialOrientation':seen[-1]})
commit='b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474';path='src/materialsystem/stdshaders/spritecard_vsxx.fxc'
url=f'https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/{commit}/{path}'
local=ROOT/'output/fidelity-character/shader-reference/spritecard_vsxx.fxc'
shader=local.read_bytes() if local.exists() else urllib.request.urlopen(url).read()
assert b'#if ORIENTATION == 1' in shader and b'// Z-aligned case' in shader and b'normalize(cross(up, v2p))' in shader
report={'format':'source-sprite-orientation-native-v1','clientSHA256':c.sha,'entry':'0xd37ccb','fieldOffset':'0x98','setIntCall':'0xd37cf1','cases':cases,'shaderReference':{'url':url,'sha256':hashlib.sha256(shader).hexdigest(),'orientation1':'World Z upright, horizontally facing camera; collapse at distance <= radius/2; smoothstep tint up to radius.'},'boundary':'Original installed CPU orientation material dispatch executed. Orientation shader math is the cited official pinned SDK reference, not an executed CSGO GPU result.'}
(OUT/'orientation-native.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
