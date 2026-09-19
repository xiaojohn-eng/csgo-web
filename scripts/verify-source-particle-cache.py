"""Executed original static Lightcache selection/folding and BSP leaf clipping."""
from pathlib import Path
import importlib.util,json,struct,sys,math
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
m=load('el',ROOT/'scripts/inspect-source-vhv-encoding.py');e=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/engine_client.so');b=load('idx',ROOT/'scripts/source-binary-index.py').open_binary(e.path)
assert e.identity()['sha256']=='34a96aefd9357a20e7e81f1525f13363e2561c88001d73d24c2b06b0655671f1'
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000)
for s in e.segments:
 if s[0]==1:u.mem_write(s[3],e.data[s[2]:s[2]+s[5]])
B=0x6000000;u.mem_map(B,0x1000000);top=B+0x1000;stop=B+0xffff00;stack=B+0xff0000;hooks={};visited=[]
def alloc(n=0x100):
 global top
 a=top;top+=(n+15)&~15;return a
def q(a,v):u.mem_write(a,struct.pack('<Q',v))
def i(a,v):u.mem_write(a,struct.pack('<i',v))
def ff(a,v):u.mem_write(a,struct.pack('<f',v))
def ret(value=0):
 sp=u.reg_read(UC_X86_REG_RSP);a=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,a);u.reg_write(UC_X86_REG_RAX,value)
def scalar(reg,kind='f'):return struct.unpack('<'+kind,u.reg_read(reg).to_bytes(16,'little')[:4 if kind=='f' else 8])[0]
def retf(value):u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',value),'little'));ret()
def hook(u,at,size,data):
 visited.append(at)
 if len(visited)>60:del visited[:30]
 if at in hooks:hooks[at]()
u.hook_add(UC_HOOK_CODE,hook)
# Original registration records give all compiler defaults, without executing a live config.
start,n=b.function_of(0x1daaea);regs={};vars=[]
for ins in b.instructions(start,n):
 if ins.mnemonic=='lea'and'rip'in ins.op_str:regs[ins.op_str.split(',')[0]]=b.lea_target(ins.address)
 if ins.mnemonic=='call'and ins.op_str in('0x64de30','0x64def0'):vars.append((regs['rdi'],b.string_at(regs['rsi']),float(b.string_at(regs['rdx']))))
for base,name,value in vars:
 obj=alloc();vt=alloc();iv=alloc();fv=alloc();q(base+0x38,obj);q(obj,vt);q(vt+0x80,iv);q(vt+0x78,fv);hooks[iv]=lambda v=value:ret(int(v));hooks[fv]=lambda v=value:retf(v)
# Vprofiler disabled; TLS and counter are explicit harness state.
prof=alloc(0x2000);counter=alloc();u.mem_write(b.rip_target(0x561b3a),b'\x01');q(b.rip_target(0x561b52),prof);q(b.rip_target(0x561b5d),counter)
settings=alloc();q(b.lea_target(0x561bb5),settings)
vis=alloc(0xc00);u.mem_write(vis,b'\xff'*0xc00);hooks[0x3faa20]=lambda:ret(0);hooks[0x3fd0a0]=lambda:ret(vis)
# World HDR light records are original immutable 100-byte entries.
world=alloc(0x300);q(0x4108a28,world);bsp=(ROOT/'.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp').read_bytes();a,n,*_=struct.unpack_from('<4I',bsp,8+54*16);raw=bytearray(bsp[a:a+n]);definitions=json.loads((ROOT/'game/source-particle-worldlights.json').read_text())['worldlights']
for light in definitions:
 for field,off in [('radius',72),('exponent',68),('quadraticAttenuation',84)]:struct.pack_into('<f',raw,light['id']*100+off,light[field])
lights=alloc(n);u.mem_write(lights,bytes(raw));i(world+0x144,n//100);q(world+0x148,lights)
for j in range(64):i(0xf33aa0+j*4,264)
for a,v in[(0x412fc28,.299),(0x412fc2c,.587),(0x412fc30,.114)]:ff(a,v)
# Original ambient query's result is a controlled input here, not an assertion
# about actual map lighting. Its separate original-BSP execution already exists.
def ambient():u.mem_write(u.reg_read(UC_X86_REG_RDI),struct.pack('<18f',*([.1,.2,.3]*6)));ret()
hooks[0x350e40]=ambient
axes=alloc();u.mem_write(axes,struct.pack('<18f',1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1))
mat=alloc();mvt=alloc();q(b.lea_target(0x55c12a),mat);q(mat,mvt)
for offset,value in [(0x90,6),(0x98,axes)]:stub=alloc();q(mvt+offset,stub);hooks[stub]=lambda v=value:ret(v)
hardware=alloc();hvt=alloc();q(b.lea_target(0x55dfcf),hardware);q(hardware,hvt);stub=alloc();q(hvt+0x68,stub);hooks[stub]=lambda:ret(4)
skyInterface=alloc();svt=alloc();skyWorld=alloc();q(b.lea_target(0x55d8a7),skyInterface);q(skyInterface,svt);stub=alloc();q(svt+0xb0,stub);hooks[stub]=lambda:ret(skyWorld)
# TraceResult is explicit: no obstruction, sky flag present on the sun ray.
trace=alloc();tvt=alloc();q(b.lea_target(0x55c6f4),trace);q(trace,tvt);stub=alloc();q(tvt+0x28,stub)
traces=[]
def ray():
 p=u.reg_read(UC_X86_REG_RSI);result=u.reg_read(UC_X86_REG_R8);mask=u.reg_read(UC_X86_REG_RDX);origin=struct.unpack('<3f',u.mem_read(p,12));delta=struct.unpack('<3f',u.mem_read(p+16,12));isSun=math.dist(delta,[0,0,0])>50000;distance=math.dist(delta,[0,0,0]);fraction=.5 if mode=='blocked' else max(0,1-7/distance) if mode=='near-end' and not isSun and distance else 1;flags=4 if isSun and mode not in ('sky-blocked','blocked') else 0;traces.append({'from':origin,'delta':delta,'mask':mask,'fraction':fraction,'surfaceFlags':flags,'includeProps':struct.unpack('<Q',u.mem_read(u.reg_read(UC_X86_REG_RCX),8))[0]==0xd6a800});u.mem_write(result,bytes(0x60));ff(result+0x2c,fraction);u.mem_write(result+0x4a,struct.pack('<H',flags));ret()
hooks[stub]=ray
# Standard libm call boundaries, verified by the PLT relocation names below.
from elftools.elf.elffile import ELFFile
with e.path.open('rb')as handle:
 elf=ELFFile(handle);symbols=elf.get_section_by_name('.dynsym');names={rel['r_offset']:symbols.get_symbol(rel['r_info_sym']).name for section in elf.iter_sections()if section['sh_type']=='SHT_RELA'for rel in section.iter_relocations()}
for address in [0x1b14a0,0x1b2790,0x1b0ad0]:
 target=b.rip_target(address);name=names.get(target);name=name.removeprefix('__').removesuffix('_finite')
 if name in('pow','powf'):
  def fn(name=name):
   fmt='d'if name=='pow'else'f';value=math.pow(scalar(UC_X86_REG_XMM0,fmt),scalar(UC_X86_REG_XMM1,fmt));u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<'+fmt,value),'little'));ret()
 elif name in('acosf','sinf'):
  def fn(name=name):retf((math.acos if name=='acosf'else math.sin)(scalar(UC_X86_REG_XMM0)))
 else:raise ValueError(name)
 hooks[address]=fn
# Execute the original cache builder with explicit platform inputs. Primitive
# kernels, selection, weak-light folding and final query are not replaced.
cache=alloc(0x300);pos=alloc();queryPos=alloc();queryOut=alloc();mode='clear';cases=[]
def run(at,args):
 q(stack,stop)
 for reg,value in zip([UC_X86_REG_RDI,UC_X86_REG_RSI,UC_X86_REG_RDX,UC_X86_REG_RCX,UC_X86_REG_R8,UC_X86_REG_R9],args):u.reg_write(reg,value)
 u.reg_write(UC_X86_REG_RSP,stack);u.emu_start(at,stop,count=1000000)
 assert u.reg_read(UC_X86_REG_RIP)==stop,(hex(at),hex(u.reg_read(UC_X86_REG_RIP)))
def finished_cache():
 u.mem_write(u.reg_read(UC_X86_REG_RSI),bytes(u.mem_read(cache+0x10,0x70)));ret()
hooks[0x564080]=finished_cache
for point in [[-816,-784,160],[-16,-16,32],[-820,-800,180],[1440,2168,40],[325,2373,8],[0,0,0],[200,800,100],[500,800,0],[-1000,2400,0],[100,1400,-100],[900,1700,128],[1200,2160,-64]]:
 for mode in ['clear','blocked','sky-blocked','near-end']:
  traces.clear();u.mem_write(cache,bytes(0x300));u.mem_write(pos,struct.pack('<3f',*point))
  run(0x561b20,[cache,pos,1,0]);n=struct.unpack('<I',u.mem_read(cache+0x58,4))[0]
  pending=[(struct.unpack('<Q',u.mem_read(cache+0x60+j*8,8))[0]-lights)//100 for j in range(n)]
  cube=list(struct.unpack('<18f',u.mem_read(cache+0x10,72)))
  p=[point[0]+3.25,point[1]-7.125,point[2]+5];u.mem_write(queryPos,struct.pack('<3f',*p));run(0x565a20,[queryPos,0,1,0,queryOut,0])
  rgb=list(struct.unpack('<3f',u.mem_read(queryOut,12)));color=[int(struct.unpack('<f',struct.pack('<f',x*255))[0])&255 for x in rgb]
  cases.append({'cachePoint':point,'queryPoint':p,'traceMode':mode,'ambient':[[.1,.2,.3]]*6,'nativeCacheCube':[cube[i:i+3]for i in range(0,18,3)],'nativePending':pending,'nativeRGB':rgb,'nativeColor':color,'traces':list(traces)})
# Original leaf-clamp 0x3fae10, with unmodified BSP plane/node memory layouts.
traceData=json.loads((ROOT/'public/source/csgo-12426148/fidelity-world-20260913/lighting-trace/trace.json').read_text());tree=traceData['tree']
planeMem=alloc(len(tree['planes'])*20);nodeMem=alloc(len(tree['nodes'])*16);cm=alloc();q(cm,nodeMem)
for j,plane in enumerate(tree['planes']):
 type=next((axis for axis in range(3)if plane[axis]==1 and all(plane[k]==0 for k in range(3)if k!=axis)),3)
 u.mem_write(planeMem+j*20,struct.pack('<4fBBH',*plane,type,0,0))
for j,node in enumerate(tree['nodes']):u.mem_write(nodeMem+j*16,struct.pack('<Qii',planeMem+node['plane']*20,*node['children']))
clamps=[]
for point in [c['cachePoint']for c in cases[::4]]+[[x,y,z]for x in [-2048,-1000,0,1200]for y in [-800,0,1500]for z in [-128,128]]:
 for delta in [[18,12,40],[-40,100,-20],[1000,-800,200]]:
  target=[point[j]+delta[j]for j in range(3)];u.mem_write(pos,struct.pack('<3f',*point));u.mem_write(queryPos,struct.pack('<3f',*target));u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<f',.5),'little'))
  run(0x3fae10,[cm,pos,tree['head'],queryPos]);clamps.append({'from':point,'candidate':target,'native':list(struct.unpack('<3f',u.mem_read(queryPos,12)))})
# Original cache position placement uses original clipping and explicit trace
# outcomes. Neither the placement nor CM clip instructions are replaced.
def leaf_at(point):
 node=tree['head']
 def f(v):return struct.unpack('<f',struct.pack('<f',v))[0]
 while node>=0:
  n=tree['nodes'][node];p=tree['planes'][n['plane']];d=f(f(f(f(p[0]*point[0])+f(p[1]*point[1]))+f(p[2]*point[2]))-p[3]);node=n['children'][0 if d>=0 else 1]
 return -node-1
def lookup_leaf():ret(leaf_at(struct.unpack('<3f',u.mem_read(u.reg_read(UC_X86_REG_RDI),12))))
hooks[0x3fade0]=lookup_leaf;hooks[0x3fa9e0]=lambda:ret(tree['leafContents'][u.reg_read(UC_X86_REG_RDI)])
def clip_wrapper():
 p=u.reg_read(UC_X86_REG_RDI);to=u.reg_read(UC_X86_REG_RSI)
 for reg,value in [(UC_X86_REG_RDI,cm),(UC_X86_REG_RSI,p),(UC_X86_REG_RDX,tree['head']),(UC_X86_REG_RCX,to),(UC_X86_REG_RIP,0x3fae10)]:u.reg_write(reg,value)
hooks[0x3faf80]=clip_wrapper
ordinary_ray=hooks[stub];centers=[]
def center_ray():
 ordinary_ray();j=len(traces);r=traces[-1];fraction=.5 if mode=='all-blocked' or mode=='first-blocked' and j==1 else 1
 result=u.reg_read(UC_X86_REG_R8);ff(result+0x2c,fraction);u.mem_write(result+0x37,bytes([mode=='start-solid']));r['fraction']=fraction;r['startSolid']=mode=='start-solid'
hooks[stub]=center_ray
for point in [c['cachePoint']for c in cases[::4]]+[[x,y,z]for x in [-2048,-1000,0,1200]for y in [-800,0,1500]for z in [-128,128]]:
 for mode in ['clear','first-blocked','all-blocked','start-solid']:
  traces.clear();u.mem_write(pos,struct.pack('<3f',*point));run(0x55fbc0,[cache,pos,leaf_at(point)])
  centers.append({'point':point,'traceMode':mode,'native':list(struct.unpack('<3f',u.mem_read(cache+0x1f0,12))),'traces':list(traces)})
report={'format':'source-particle-cache-native-v1','engine':e.identity(),'boundary':'Original 561b20 cache construction, 55ded0 selection/folding and 565a20 final query executed. Ambient/PVS/trace/hardware inputs explicit; no actual-map or native-physics claim. All original 26 HDR worldlights have original runtime loader radii. Material config field 0x6c is explicit zero.','hardwareMaxLights':4,'worldlightsLimit':2,'cases':cases,'clamps':clamps,'centers':centers,'treeSHA256':__import__('hashlib').sha256(json.dumps(tree,separators=(',',':')).encode()).hexdigest()}
out=ROOT/'tests/fixtures/source-particle-cache-native.json';out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'output':str(out),'cacheCases':len(cases),'clamps':len(clamps),'centers':len(centers)}))
