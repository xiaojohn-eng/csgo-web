"""Execute installed particle query and GetLightForPoint arithmetic.
Lightcache faces are explicit harness inputs, not a substitute for the engine's
light selection, occlusion, static lighting, dynamic lighting or cache lifecycle.
"""
from pathlib import Path
import importlib.util,json,struct,sys
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
native=load('particle_query_client',ROOT/'scripts/source-pistol-particles-native.py');client=native.NativeClient()
engine=load('particle_query_engine',ROOT/'scripts/inspect-source-vhv-encoding.py').ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/engine_client.so')
assert engine.identity()['sha256']=='34a96aefd9357a20e7e81f1525f13363e2561c88001d73d24c2b06b0655671f1'
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000)
for segment in engine.segments:
 if segment[0]==1:u.mem_write(segment[3],engine.data[segment[2]:segment[2]+segment[5]])
B=0x6000000;u.mem_map(B,0x100000);stack=B+0xf0000;stop=B+0xff000;position=B;output=B+0x100
faces=[];lightcacheCalls=[]
def ehook(u,at,size,data):
 if at!=0x564080:return
 p=u.reg_read(UC_X86_REG_RDI);target=u.reg_read(UC_X86_REG_RSI)
 lightcacheCalls.append({'position':list(struct.unpack('<3f',u.mem_read(p,12))),'flags':u.reg_read(UC_X86_REG_R8)})
 u.mem_write(target,struct.pack('<18f',*[v for face in faces for v in face])+struct.pack('<I',0))
 sp=u.reg_read(UC_X86_REG_RSP);ret=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,ret)
u.hook_add(UC_HOOK_CODE,ehook)
engine.check(0x565ac4,'e8 b7 e5 ff ff');engine.check(0x565d72,'f3 0f 10 1d 9a 51 3e 00')
assert struct.unpack('<f',engine.code(0x94af14,4))[0]==struct.unpack('<f',struct.pack('<f',1/6))[0]
assert struct.unpack('<d',engine.code(0x93aa58,8))[0]==1
assert struct.unpack('<f',client.u.mem_read(0xfe5bf4,4))[0]==255
obj=client.arena;vt=obj+0x100;isInGameStub=obj+0x200;getLightStub=obj+0x220;point=obj+0x300;result=obj+0x400
client.integer(obj,vt);client.integer(vt+0x68,isInGameStub);client.integer(vt+4,getLightStub);client.integer(0x5490f28,obj)
client.integer(0x100c,0);client.adapters[0x69d1d1]=lambda c:c.return_value(0)
inGame=True;light=[];calls=[]
def ingame(c):c.return_value(1 if inGame else 0)
def getlight(c):
 sp=c.u.reg_read(UC_X86_REG_ESP);target=c.read(sp+4);owner=c.read(sp+8);p=c.read(sp+12);clamp=c.read(sp+16)
 assert owner==obj and clamp==1;calls.append({'position':list(struct.unpack('<3f',c.u.mem_read(p,12))),'clamp':True})
 c.u.mem_write(target,struct.pack('<3f',*light));ret=c.read(sp);c.u.reg_write(UC_X86_REG_ESP,sp+8);c.u.reg_write(UC_X86_REG_EAX,target);c.u.reg_write(UC_X86_REG_EIP,ret)
client.adapters[isInGameStub]=ingame;client.adapters[getLightStub]=getlight
p=[-822.365, -795.642, 180.0];cases=[]
for faces in [[[0,0,0]]*6,[[.1,.2,.3],[.2,.3,.4],[.3,.4,.5],[.4,.5,.6],[.5,.6,.7],[.6,.7,.8]],[[2,.75,.125]]*6,[[1/255,65/255,90/255]]*6]:
 u.mem_write(position,struct.pack('<3f',*p));u.mem_write(stack,struct.pack('<Q',stop))
 for reg,value in [(UC_X86_REG_RDI,position),(UC_X86_REG_RSI,0),(UC_X86_REG_RDX,1),(UC_X86_REG_RCX,0),(UC_X86_REG_R8,output),(UC_X86_REG_R9,0),(UC_X86_REG_RSP,stack)]:u.reg_write(reg,value)
 u.emu_start(0x565a20,stop,count=100000);assert u.reg_read(UC_X86_REG_RIP)==stop
 light=list(struct.unpack('<3f',u.mem_read(output,12)));client.u.mem_write(point,struct.pack('<3f',*p));client.call(0x69d140,[obj,point,result]);color=list(client.u.mem_read(result,4))
 assert color==[int(struct.unpack('<f',struct.pack('<f',v*255))[0])&255 for v in light]+[0]
 cases.append({'lightcacheFaces':faces,'nativeLinearRGB':light,'nativeColor32':color})
inGame=False;before=len(calls);client.call(0x69d140,[obj,point,result]);assert list(client.u.mem_read(result,4))==[255]*4 and len(calls)==before
report={'format':'source-particle-light-query-v1','clientSHA256':client.sha,'engine':engine.identity(),'entries':{'particleQuery':'0x69d140','engineGetLightForPoint':'0x27abe0 -> 0x565a20','lightcache':'0x564080','averageSixFaces':'0x565d58','upperClamp':'0x565be6','byteConversion':'0x69d251'},'cases':cases,'lightcacheCalls':lightcacheCalls,'queryCalls':calls,'notInGame':[255]*4,'boundary':'Installed query/aggregation/clamp/byte instructions executed unmodified. Lightcache is an explicit injected face array with no pending light list, so full worldlight/occlusion/cache behavior is NOT verified.'}
out=ROOT/'output/fidelity-character/particle-orientation/light-query-native.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'output':str(out),'cases':len(cases),'notInGame':report['notInGame']}))
