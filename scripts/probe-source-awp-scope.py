"""Execute original i386 CHudScope paint and ScaleFOVByWidthRatio.
Only object getters, VGUI draw transport and external libm are adapters.
The complete original visibility branches, smoothing and geometry execute.
"""
from pathlib import Path
import importlib.util,struct,json,math
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
from elftools.elf.elffile import ELFFile
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('awp_client','%s/scripts/source-awp-client-binary.py'%ROOT);c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
P=0x11000000;W=P+0x10000;VM=P+0x20000;HUD=P+0x30000;PVT=P+0x40000;WVT=P+0x42000;SURFACE=P+0x50000;SVT=P+0x52000;GLOBALS=P+0x60000
STACK=0x12080000;STOP=0x13000000;FLOAT=STOP+0x100;DOUBLE=STOP+0x120;RESULT=STOP+0x180;RET=STOP+0x200;STUB=STOP+0x1000
f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
class NativeScope:
 def __init__(self):
  self.u=u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0,0x6000000);u.mem_map(P,0x100000);u.mem_map(0x12000000,0x100000);u.mem_map(STOP,0x10000)
  with c.PATH.open('rb')as file:
   elf=ELFFile(file)
   for segment in elf.iter_segments():
    if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
  u.mem_write(FLOAT,b'\xd9\x05'+struct.pack('<I',RESULT)+b'\xc3');u.mem_write(DOUBLE,b'\xdd\x05'+struct.pack('<I',RESULT)+b'\xc3')
  u.mem_write(RET,b'\xd9\x1d'+struct.pack('<I',RESULT+16)+b'\xe9'+struct.pack('<i',STOP-(RET+11)))
  self.stubs={};u.hook_add(UC_HOOK_CODE,self.hook)
 def ints(self,at,values):self.u.mem_write(at,struct.pack('<%dI'%len(values),*[v&0xffffffff for v in values]))
 def floats(self,at,values):self.u.mem_write(at,struct.pack('<%df'%len(values),*values))
 def uint(self,at):return struct.unpack('<I',self.u.mem_read(at,4))[0]
 def read(self,at):return struct.unpack('<f',self.u.mem_read(at,4))[0]
 def ret(self,value=0):
  sp=self.u.reg_read(UC_X86_REG_ESP);self.u.reg_write(UC_X86_REG_EAX,value);self.u.reg_write(UC_X86_REG_EIP,self.uint(sp));self.u.reg_write(UC_X86_REG_ESP,sp+4)
 def float(self,value):self.floats(RESULT,[value]);self.u.reg_write(UC_X86_REG_EIP,FLOAT)
 def stub(self,table,slot,name):
  at=STUB+len(self.stubs)*16;self.stubs[at]=name;self.ints(table+slot,[at])
 def hook(self,u,at,size,data):
  if at==STOP:u.emu_stop();return
  sp=u.reg_read(UC_X86_REG_ESP);x=self.context
  if at==0x7d3710:self.ret(P if x['player']else 0)
  elif at==0x7d6930:self.ret(W if x['weapon']else 0)
  elif at==0x9f1900:self.ret(VM if x['viewmodel']else 0)
  elif at==0x7baf32:u.reg_write(UC_X86_REG_EAX,VM if x['correctViewmodelType']else 0);u.reg_write(UC_X86_REG_EIP,at+5)
  elif at==0xbc47b0:self.ints(self.uint(sp+4),[x['width']]);self.ints(self.uint(sp+8),[x['height']]);self.ret()
  elif at in [0x7baf8a,0xbd4063]:
   value=f(math.tan(self.read(sp)));self.ints(sp-4,[at+5]);u.reg_write(UC_X86_REG_ESP,sp-4);self.float(value)
  elif at==0xbd4080:
   value=math.atan(struct.unpack('<d',u.mem_read(sp,8))[0]);u.mem_write(RESULT,struct.pack('<d',value));self.ints(sp-4,[at+5]);u.reg_write(UC_X86_REG_ESP,sp-4);u.reg_write(UC_X86_REG_EIP,DOUBLE)
  elif at in self.stubs:
   name=self.stubs[at]
   if name in ['observerInterpolationState','observerMode','weaponType','zoomLevel','defaultFov','zoomFov']:self.ret(x[name])
   elif name=='observerTarget':self.ret(P if x['observerTarget']else 0)
   elif name=='isPlayer':self.ret(int(x['isPlayer']))
   elif name in ['playerFov','displayInaccuracy','spread','weaponOffset']:self.float(x[name])
   elif name=='color':self.color=[self.uint(sp+i*4)for i in [2,3,4,5]];self.ret()
   elif name=='texture':self.texture=self.uint(sp+8);self.ret()
   elif name in ['rect','line']:
    self.draws.append(dict(kind=name,color=list(self.color),rect=[struct.unpack('<i',u.mem_read(sp+i*4,4))[0]for i in [2,3,4,5]]));self.ret()
   elif name=='polygon':
    n=self.uint(sp+8);pointer=self.uint(sp+12);assert n==4
    self.draws.append(dict(kind='polygon',color=list(self.color),texture=self.texture,vertices=[list(struct.unpack('<4f',u.mem_read(pointer+i*16,16)))for i in range(n)]));self.ret()
 def setup(self,context):
  self.context=dict(player=True,weapon=True,viewmodel=True,correctViewmodelType=True,observerInterpolationState=0,observerMode=0,observerTarget=True,isPlayer=True,weaponType=5,zoomLevel=1,zoomFov=40,defaultFov=90,playerFov=40,scoped=True,displayInaccuracy=.002,spread=.0002,weaponOffset=0,viewmodelX=0,viewmodelY=0,width=1280,height=720,dt=1/64,blur=1,sniperWidth=1);self.context.update(context)
  x=self.context;self.stubs={};self.u.mem_write(P,bytes(0x70000));self.draws=[];self.texture=0;self.color=[0,0,0,255]
  self.ints(P,[PVT]);self.ints(W,[WVT]);self.ints(SURFACE,[SVT]);self.ints(0x596731c,[SURFACE]);self.ints(0x1492c10,[GLOBALS]);self.floats(GLOBALS+0x14,[x['dt']])
  self.u.mem_write(P+0x3854,bytes([int(x['scoped'])]));self.floats(VM+0x2aac,[x['viewmodelX'],x['viewmodelY']]);self.floats(HUD+0x1a8,[x['blur']]);self.ints(HUD+0x19c,[1,2,3]);self.ints(0x54d0fbc,[0x54d0fa0]);self.ints(0x54d0fd0,[x['sniperWidth']])
  for slot,name in {0x6b4:'observerInterpolationState',0x570:'observerMode',0x574:'observerTarget',0x330:'isPlayer',0x5fc:'playerFov',0x600:'defaultFov'}.items():self.stub(PVT,slot,name)
  for slot,name in {0x824:'weaponType',0x81c:'zoomFov',0x834:'zoomLevel',0x8a0:'displayInaccuracy',0x8a4:'spread',0x658:'weaponOffset'}.items():self.stub(WVT,slot,name)
  for slot,name in {0x38:'color',0x40:'rect',0x4c:'line',0x98:'texture',0x1a8:'polygon'}.items():self.stub(SVT,slot,name)
 def call(self,address,args,float_return=False):
  self.ints(STACK,[RET if float_return else STOP,*args]);self.u.reg_write(UC_X86_REG_ESP,STACK);self.u.reg_write(UC_X86_REG_EBP,0)
  self.u.emu_start(address,STOP+0x10000,count=30000);assert self.u.reg_read(UC_X86_REG_EIP)==STOP,hex(self.u.reg_read(UC_X86_REG_EIP))
  return self.read(RESULT+16)if float_return else None
 def paint(self,context):
  self.setup(context);self.call(0x7badb0,[HUD]);return dict(blur=self.read(HUD+0x1a8),draws=self.draws)
 def scale_fov(self,fov,ratio):
  self.context={};bits=lambda v:struct.unpack('<I',struct.pack('<f',v))[0];return self.call(0xbd4040,[bits(fov),bits(ratio)],True)
def main():
 engine=NativeScope();rows=[];gates=[];projection=[];chains=[]
 for size in [(640,480),(1280,720),(1920,1080),(1024,768),(1001,777),(2560,1080)]:
  for zoom in [40,10]:
   for amount in [0,.002,.008,.07,.37,1]:
    for width in [1,2,3]:
     context=dict(width=size[0],height=size[1],zoomFov=zoom,playerFov=zoom,displayInaccuracy=amount,sniperWidth=width)
     rows.append(dict(input=context,original=engine.paint(context)))
 for field,values in dict(player=[False],weapon=[False],viewmodel=[False],correctViewmodelType=[False],observerInterpolationState=[0,1,2],observerMode=[0,1,2,3,4,5,6],observerTarget=[False],isPlayer=[False],weaponType=[1,3,5],scoped=[False],zoomFov=[0,90],playerFov=[90]).items():
  for value in values:
   context={field:value};gates.append(dict(input=context,original=engine.paint(context)))
 for fov in [1,10,40,65,90,110,150]:
  for ratio in [.5,.75,1,4/3,16/9,21/9]:projection.append(dict(fov=fov,ratio=f(ratio),original=engine.scale_fov(fov,ratio)))
 for initial in [1,2]:
  blur=initial;frames=[]
  for tick in range(240):
   context=dict(blur=blur,displayInaccuracy=.37 if 30<=tick<60 else .002,scoped=not(120<=tick<140),playerFov=90 if 120<=tick<140 else 40,viewmodelX=math.sin(tick*.1)*.03,viewmodelY=math.cos(tick*.1)*.02)
   result=engine.paint(context);frames.append(dict(input=context,original=result));blur=result['blur']
  chains.append(dict(initial=initial,frames=frames))
 report=dict(status='original_i386_scope_paint_and_fov_scaling_executed',clientSha256=c.SHA,paint='0x7badb0',scaleFov='0xbd4040',rows=rows,gates=gates,projection=projection,chains=chains,
  limits=['Complete original Paint and FOV scale instructions; object/observer/schema getters and VGUI drawing calls are explicit adapters.','External tanf/atan use host libm float/double ABI; no complete Linux libm ULP claim.','Canvas/GPU pixel blending and complete renderer/observer state machine are separate.'])
 (ROOT/'output/tests/source-awp-scope-native.json').write_text(json.dumps(report,separators=(',',':'))+'\n');print(json.dumps(dict(rows=len(rows),gates=len(gates),projection=len(projection),frames=sum(len(x['frames'])for x in chains))))
if __name__=='__main__':main()
