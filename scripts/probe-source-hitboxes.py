"""Execute only original pure geometry routines in an isolated x86 interpreter.
No native engine process, filesystem callback, syscall or network is exposed.
"""
from pathlib import Path
import struct,hashlib,json,math,random
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_32,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
SERVER=ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so'
SHA='7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386'
class OriginalTrace:
 def __init__(self):
  raw=SERVER.read_bytes();assert hashlib.sha256(raw).hexdigest()==SHA
  self.u=Uc(UC_ARCH_X86,UC_MODE_32);u=self.u;u.mem_map(0,0x2000000)
  self.externals={}
  with SERVER.open('rb') as f:
   elf=ELFFile(f)
   for s in elf.iter_segments():
    if s['p_type']=='PT_LOAD':u.mem_write(s['p_vaddr'],s.data())
   syms=elf.get_section_by_name('.dynsym')
   for sec in elf.iter_sections():
    if sec['sh_type']=='SHT_REL':
     for rel in sec.iter_relocations():
      if rel['r_info_sym']:
       self.externals[rel['r_offset']]=syms.get_symbol(rel['r_info_sym']).name
  print('AngleMatrix external calls',[(hex(p),self.externals.get(p))for p in (0xef17dd,0xef1812,0xef1848)])
  u.mem_map(0x3000000,0x100000);u.mem_map(0x4000000,0x200000);u.mem_map(0x5000000,4096)
  u.reg_write(UC_X86_REG_CR4,u.reg_read(UC_X86_REG_CR4)|0x600)
  self.calls={};u.hook_add(UC_HOOK_CODE,self.hook)
 def floats(self,p,values):self.u.mem_write(p,struct.pack('<%df'%len(values),*values))
 def ints(self,p,values):self.u.mem_write(p,struct.pack('<%dI'%len(values),*values))
 def read(self,p,n=1):return struct.unpack('<%df'%n,self.u.mem_read(p,n*4))
 def uint(self,p):return struct.unpack('<I',self.u.mem_read(p,4))[0]
 def hook(self,u,address,size,user):
  if address in (0xef17dc,0xef1811,0xef1847):
   assert self.externals[address+1]=='sincosf';sp=u.reg_read(UC_X86_REG_ESP);r=self.read(sp)[0]
   self.floats(self.uint(sp+4),[math.sin(r)]);self.floats(self.uint(sp+8),[math.cos(r)])
   u.reg_write(UC_X86_REG_EIP,address+5)
  elif address==0xe84d80:
   sp=u.reg_read(UC_X86_REG_ESP);dst,src,n=[self.uint(sp+4+i*4)for i in range(3)]
   assert n<0x10000;u.mem_write(dst,bytes(u.mem_read(src,n)));u.reg_write(UC_X86_REG_EAX,dst)
   u.reg_write(UC_X86_REG_EIP,self.uint(sp));u.reg_write(UC_X86_REG_ESP,sp+4)
  elif address in (0xec92d0,0xec3440,0xf02480,0xef17b0):self.calls[hex(address)]=self.calls.get(hex(address),0)+1
 def call(self,entry,args,regs=None):
  u=self.u;sp=0x30f0000;self.ints(sp,[0x5000000,*args]);u.reg_write(UC_X86_REG_ESP,sp)
  for reg,value in (regs or {}).items():u.reg_write(reg,value)
  u.emu_start(entry,0x5000000,count=2000000)
  if u.reg_read(UC_X86_REG_EIP)!=0x5000000:raise RuntimeError('Instruction bound reached')
  return u.reg_read(UC_X86_REG_EAX)
 def angle(self,angles):
  self.floats(0x4010000,angles);self.call(0xef17b0,[0x4010000,0x4010100]);return list(self.read(0x4010100,12))
 def trace(self,hitboxes,matrices,start,end):
  u=self.u;hdr=0x4000000;wrapper=0x4008000;hset=0x4009000;bones=0x4010000;table=0x401e000;ray=0x401f000;out=0x401f100;origin=0x401f200
  self.ints(wrapper,[hdr]);self.ints(hdr+0xa0,[0x100])
  for b in range(len(matrices)):
   self.ints(hdr+0x100+b*216+0xb4,[0x1]);self.floats(bones+b*48,matrices[b]);self.ints(table+b*4,[bones+b*48])
  self.ints(hset,[0,len(hitboxes),12])
  for i,h in enumerate(hitboxes):u.mem_write(hset+12+i*68,bytes.fromhex(h['sourceBytesHex']))
  self.floats(ray,[*start,0,*[b-a for a,b in zip(start,end)],0,*([0]*8)])
  self.ints(ray+64,[0]);u.mem_write(ray+68,b'\1\1'+b'\0'*10)
  u.mem_write(out,bytes(128));self.floats(origin,[0,0,0])
  result=self.call(0xec92d0,[0,ray,wrapper,hset,table,1,origin,0x3f800000,out])
  return dict(hit=bool(result&255),fraction=self.read(out+44)[0],startSolid=bool(u.mem_read(out+55,1)[0]),
   hitbox=self.uint(out+80),group=self.uint(out+68),end=list(self.read(out+12,3)))
def box(group=1,center=0,angles=(0,0,0),radius=0):
 return dict(sourceBytesHex=struct.pack('<ii6fi8f',0,group,center-1,-2,-3,center+1,2,3,0,*angles,radius,0,0,0,0).hex())
def main():
 engine=OriginalTrace();identity=[1,0,0,0,0,1,0,0,0,0,1,0]
 raw=SERVER.read_bytes()
 # Real call chain and instruction operands are asserted in addition to SHA.
 for at,value in [(0x5b8327,'e8a40f9100'),(0xec93a2,'c1e0068d3498'),(0xec9444,'8d5624'),(0xec9448,'e863830200'),
  (0xec3456,'0f2f7230'),(0xec345d,'0f834d010000'),(0xec34bf,'f30f104b30'),(0xec352b,'e850ef0300')]:
  assert raw[at:at+len(value)//2]==bytes.fromhex(value),(hex(at),raw[at:at+len(value)//2].hex())
 table=struct.unpack_from('<9I',raw,0x132ef74)
 assert table==(0xec96a8,0xec93e8,0xec9690,0xec9678,0xec9660,0xec9660,0xec9650,0xec9650,0xec9638)
 assert raw[0x11b8b60:0x11b8b60+17]==b'14CBaseAnimating\0'
 assert struct.unpack_from('<2I',raw,0x11b8be0)==(0,0x11b8b74)
 assert struct.unpack_from('<I',raw,0x11b8c28)[0]==0x5b8270
 angle=engine.angle([0,90,0]);assert max(abs(a-b)for a,b in zip(angle,[0,-1,0,0,1,0,0,0,0,0,1,0]))<1e-6
 cases=[]
 for label,boxes,start,end,expected in [
  ('head behind stomach',[box(1,5),box(3,0)],[-20,0,0],[20,0,0],1),
  ('head in front of stomach',[box(1,-5),box(3,0)],[-20,0,0],[20,0,0],0),
  ('stomach behind chest',[box(3,5),box(2,0)],[-20,0,0],[20,0,0],0),
  ('arms in front of chest',[box(4,-5),box(2,0)],[-20,0,0],[20,0,0],1),
  ('box zero radius',[box()],[-20,0,0],[20,0,0],0),
  ('box negative radius',[box(radius=-1)],[-20,0,0],[20,0,0],0),
  ('positive capsule',[box(radius=1)],[-20,0,0],[20,0,0],0),
  ('inside OBB',[box()],[0,0,0],[20,0,0],0),
 ]:
  result=engine.trace(boxes,[identity],start,end);assert result['hit'] and result['hitbox']==expected,(label,result)
  cases.append(dict(label=label,hitboxes=boxes,start=start,end=end,original=result))
 corpus=json.loads((ROOT/'output/tests/source-hitbox-input.json').read_text());rows=[];coincident=[]
 for actor in corpus['actors']:
  assert all(h['extensionFloat32'][3]==0 for h in actor['hitboxes'])
  for sampleIndex,sample in enumerate(actor['samples']):
   source=sample['sourceWorldMatrices'];matrices=[[source[b*16+r+c*4]for r in range(3)for c in range(4)]for b in range(actor['boneCount'])]
   for h in actor['hitboxes']:
    mid=[(a+b)*.5 for a,b in zip(h['min'],h['max'])];rot=engine.angle(h['extensionFloat32'][:3]);local=[sum(rot[r*4+c]*mid[c]for c in range(3))for r in range(3)]
    bone=matrices[h['bone']];center=[sum(bone[r*4+c]*local[c]for c in range(3))+bone[r*4+3]for r in range(3)]
    axis=(h['index']+sampleIndex)%3;start=center.copy();end=center.copy();start[axis]-=100;end[axis]+=100
    result=engine.trace(actor['hitboxes'],matrices,start,end)
    assert result['hit'],(actor['team'],sampleIndex,h['index'])
    rows.append(dict(team=actor['team'],sample=sampleIndex,targetHitbox=h['index'],start=start,end=end,original=result))
    if actor['team']=='t' and sampleIndex==2 and h['index']==15:
     individual=[engine.trace([actor['hitboxes'][i]],matrices,start,end)for i in (15,16)]
     assert individual[0]['fraction']==individual[1]['fraction'] and individual[0]['group']==individual[1]['group']==5
     coincident.append(dict(team='t',sample=2,targetHitbox=15,originalIndividualHitboxes=[15,16],individual=individual,
      meaning='Same float32 original fraction for touching upper/forearm surfaces; binary retains box16 in the full set. Double geometry may distinguish these sub-micrometre entries without changing hitgroup.'))
  print('original CPU corpus',actor['team'],len(actor['samples'])*len(actor['hitboxes']))
 functions={hex(a):dict(bytes=n,sha256=hashlib.sha256(raw[a:a+n]).hexdigest()) for a,n in [(0x5b8270,345),(0xec92d0,1899),(0xec3440,1589),(0xef17b0,375),(0xef0840,252),(0xf02480,2399)]}
 result=dict(serverSha256=SHA,appId=740,build=12426148,functions=functions,groupToBucket=[5,0,2,1,4,4,6,6,3],
  fields=dict(strideBytes=68,bone=0,group=4,min=8,max=20,anglesDegrees=36,radius=48,capsulePredicate='radius > 0; otherwise rotated OBB'),
  interpretation='Original x86 instructions executed in Unicorn. Only sincosf and memcpy are host callbacks; geometry and hitgroup selection are original bytes.',
  limits=['No original client/server process or live shot; original pure CPU trace oracle only.','Actor native scale=1 and ray (not swept hull); gameplay damage, penetration and lag compensation remain separate.'],
  synthetic=cases,actors=[dict(team=a['team'],dataSha256=a['dataSha256'],boneCount=a['boneCount'],samples=[s['input']for s in a['samples']])for a in corpus['actors']],
  rays=rows,coincidentFloat32Surfaces=coincident,executedCalls=engine.calls)
 out=ROOT/'output/tests/source-hitbox-native.json';out.write_text(json.dumps(result,indent=2)+'\n');print('PASS',len(rows),'actual rays',engine.calls)
if __name__=='__main__':main()
