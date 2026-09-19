"""Execute installed server.so AddSequenceLayers original x86 instructions.
Only lookup adapters are stubbed for the actual non-virtual standalone MDL;
AccumulatePose requests are recorded, not replaced by fabricated bone animation.
"""
from pathlib import Path
import hashlib,json,struct
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1];server=ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so';raw=server.read_bytes();SHA='7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386';assert hashlib.sha256(raw).hexdigest()==SHA
u=Uc(UC_ARCH_X86,UC_MODE_32);u.mem_map(0,0x2000000)
with server.open('rb')as file:
 for segment in ELFFile(file).iter_segments():
  if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
P=0x3000000;STACK=0x3100000;STOP=0x3200000;u.mem_map(P,0x10000);u.mem_map(STACK,0x10000);u.mem_map(STOP,0x1000)
f=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
def ints(at,values):u.mem_write(at,struct.pack('<%dI'%len(values),*[v&0xffffffff for v in values]))
def floats(at,values):u.mem_write(at,struct.pack('<%df'%len(values),*values))
def uint(at):return struct.unpack('<I',u.mem_read(at,4))[0]
def ret(value=0):sp=u.reg_read(UC_X86_REG_ESP);u.reg_write(UC_X86_REG_EAX,value);u.reg_write(UC_X86_REG_EIP,uint(sp));u.reg_write(UC_X86_REG_ESP,sp+4)
requests=[]
def hook(u,at,size,_):
 sp=u.reg_read(UC_X86_REG_ESP)
 if at==STOP:u.emu_stop()
 elif at==0x921880:ret(uint(sp+12)) # iRelativeSeq: no include-model/virtual mapping
 elif at==0x921990:ret(uint(sp+12)) # GetSharedPoseParameter: same original model index
 elif at==0x921900:ret(P+0x1000+uint(sp+8)*20) # original mstudioposeparamdesc_t layout
 elif at==0xebc4a0:
  requests.append(dict(sequence=uint(sp+16),cycle=struct.unpack('<f',u.mem_read(sp+20,4))[0],weight=struct.unpack('<f',u.mem_read(sp+24,4))[0]));ret()
u.hook_add(UC_HOOK_CODE,hook)
assert raw[0xebcf20:0xebcf26].hex()=='5589e5575653'
assert raw[0xebd1fd:0xebd205].hex()=='f30f5d0d50ec1801'
source=json.loads((ROOT/'.reference-assets/source-exports/pistol-candidates/inventory.json').read_text());cases=[];max_error=0
for weapon in source['weapons']:
 mdl=next(m for m in weapon['models']if m['role']=='model_world');seq=next(s for s in mdl['sequences']if s['name']=='pistol_aim_t');assert len(seq['autoLayers'])==5
 for active in range(5):
  for val in [-.5,0,.01,.1,.25,.5,.75,.9,.99,1,1.5]:
   for weight in [0,.3,1]:
    for cycle in [.23,.87]:
     u.mem_write(P,bytes(0x8000));u.mem_write(STACK,bytes(0x10000));ints(P,[P+0x100,0,P+0x200]);ints(P+0x400+0x94,[5,0x100])
     for i,p in enumerate(mdl['poseParameters']):floats(P+0x1000+i*20+8,[p['start'],p['end'],p['loop']])
     params=[0]*len(mdl['poseParameters']);params[seq['autoLayers'][active]['pose_id']]=val;floats(P+0x200,params)
     for i,layer in enumerate(seq['autoLayers']):
      assert layer['flags']==16448 and layer['start']==layer['end']==0 and layer['peak']==0 and layer['tail']==1
      u.mem_write(P+0x500+i*24,struct.pack('<hhI4f',layer['sequence_id'],layer['pose_id'],layer['flags'],layer['start'],layer['peak'],layer['tail'],layer['end']))
     sp=STACK+0x8000;ints(sp,[STOP,P,0,0,P+0x400,seq['index'],0,0,0,0]);floats(sp+24,[cycle,weight,0]);u.reg_write(UC_X86_REG_ESP,sp);u.reg_write(UC_X86_REG_EBP,0);requests.clear();u.emu_start(0xebcf20,STOP,count=10000);assert u.reg_read(UC_X86_REG_EIP)==STOP
     assert len(requests)==5
     expected=[]
     for layer in seq['autoLayers']:
      p=mdl['poseParameters'][layer['pose_id']];a=f(params[layer['pose_id']]);s=f(f(f(p['end']-p['start'])*a)+f(p['start']-layer['peak']));s=f(s/f(layer['tail']-layer['peak']));s=min(1,max(0,s));square=f(s*s);s=min(1,max(0,f(f(3*square)-f(f(s+s)*square))));expected.append(f(s*f(weight)))
     error=max(abs(r['weight']-e)for r,e in zip(requests,expected));max_error=max(max_error,error);assert error==0
     cases.append(dict(weapon=weapon['name'],active=active,value=val,parentWeight=weight,cycle=cycle,requests=list(requests),expectedWeights=expected))
report=dict(status='passed-original-x86-layer-weight-requests',sourceServerSHA256=SHA,entry='0xebcf20',specialBranch='0xebd180..0xebd255',caseCount=len(cases),maximumFloat32WeightError=max_error,
 result='start=end=0 AND POSE: remap original normalized pose; clamp((physicalPose-peak)/(tail-peak),0,1); optional clamped SimpleSpline; multiply parentWeight; retain parent cycle. Original order preserved.',
 boundary='Actual original layer request path only. Lookup adapters model standalone non-virtual MDL. AccumulatePose requests captured; original bone decoding/blending validated separately.',cases=cases)
(ROOT/'output/tests/source-pistol-autolayers-native.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(cases),max_error)
