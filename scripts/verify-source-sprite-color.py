"""Read the installed build's compiled SpriteCard vertex programs.
The DX9 token stream is evidence; this CPU evaluation is not native GPU execution.
"""
from pathlib import Path
import hashlib,importlib.util,json,math,struct,sys
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);sys.modules[name]=value;spec.loader.exec_module(value);return value
vpkmod=module('sprite_color_vpk',ROOT/'scripts/inventory-source-map.py')
shader=module('sprite_color_vcs',ROOT/'scripts/inspect-source-vhv-encoding.py')
vpk=vpkmod.VPKIndex(ROOT/'.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk')
path='shaders/fxc/spritecard_vs20.vcs';raw=vpk.read(path);digest=hashlib.sha256(raw).hexdigest()
assert digest=='a7929f9d52d7c9a3612d0160e4a460284da7cc8f0ceb63b838bd6204d5a6bb16'
def tokens(code):
 words=struct.unpack('<'+'I'*(len(code)//4),code);assert words[0]==0xfffe0200
 at=1;result=[]
 while at<len(words):
  opcode=words[at]&65535
  if opcode==65535:assert at==len(words)-1;break
  if opcode==65534:at+=1+((words[at]>>16)&32767);continue
  size=(words[at]>>24)&15;result.append((at,words[at:at+size+1]));at+=size+1
 return result
code,selected=shader.vcs_combo(raw,0,0);ops=dict(tokens(code))
expected={88:(0x05000051,0xa00f0001,0x400ccccd,0x3e22f983,0x3f000000,0x3b808081),
 112:(0x0200001f,0x8000000a,0x900f0000),
 202:(0x0200000f,0x80010002,0x90000000),205:(0x0200000f,0x80020002,0x90550000),208:(0x0200000f,0x80040002,0x90aa0000),
 211:(0x03000005,0x80070002,0x80e40002,0xa0000001),
 215:(0x0200000e,0x80010003,0x80000002),218:(0x0200000e,0x80020003,0x80550002),221:(0x0200000e,0x80040003,0x80aa0002),
 224:(0x02000001,0x80080003,0x90ff0000)}
for at,value in expected.items():assert ops[at]==value,(at,ops[at])
# Inspect every physically stored static branch (including grayscale and
# orientation variants); each retains the exact 2.2 constant and COLOR0 power.
count=struct.unpack_from('<I',raw,20)[0];statics=[s for s,_ in struct.iter_unpack('<2I',raw[28:28+8*count]) if s!=0xffffffff]
programs=[]
for static in statics:
 code,receipt=shader.vcs_combo(raw,static,0);instructions=tokens(code)
 assert any(w[0]&65535==81 and 0x400ccccd in w[2:] for _,w in instructions),static
 powers=[at for at,w in instructions if (w[0]&65535 in (15,32)) and len(w)>2 and (w[2]&0xff00ffff)==0x90000000]
 assert powers,static
 programs.append({'static':static,'programSHA256':receipt['programSha256'],'colourPowerTokens':powers})
exponent=struct.unpack('<f',bytes.fromhex('cdcc0c40'))[0]
cases=[]
for rgba in [(0,0,0,.5),(.5,.5,.5,.23),(65/255,77/255,90/255,.8),(99/255,169/255,166/255,1),(1,1,1,1),(.04,.15,.8,0)]:
 # Evaluate the confirmed log2/mul/exp2 instruction slice. A zero input has
 # the limiting result zero, matching pow in the GLSL port.
 out=[0 if c==0 else math.pow(2,math.log2(c)*exponent) for c in rgba[:3]]+[rgba[3]]
 cases.append({'input':rgba,'output':out})
report={'format':'source-spritecard-colour-v1','build':12426148,'container':'platform/platform_pak01','path':path,'bytes':len(raw),'sha256':digest,'selectedProgram':selected,'exactTokens':{str(k):[hex(x) for x in v] for k,v in expected.items()},'formula':'COLOR0.rgb ^ float32(2.2); alpha unchanged before visibility/size/orientation fades','exponent':exponent,'storedStaticProgramsChecked':len(programs),'programs':programs,'cases':cases,'boundary':'Original compiled build tokens decoded and asserted; numeric slice evaluated on CPU. This is not native GPU execution.'}
out=ROOT/'output/fidelity-character/particle-orientation/sprite-color-native.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ('programs','exactTokens')}))
