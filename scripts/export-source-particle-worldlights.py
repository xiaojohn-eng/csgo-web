"""Export unmodified HDR worldlights and execute their installed attenuation/cone kernels."""
from pathlib import Path
import hashlib,importlib.util,json,math,struct,sys
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('worldlight_elf',ROOT/'scripts/inspect-source-vhv-encoding.py');m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
e=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/engine_client.so');assert e.identity()['sha256']=='34a96aefd9357a20e7e81f1525f13363e2561c88001d73d24c2b06b0655671f1'
bsp=(ROOT/'.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp').read_bytes();assert hashlib.sha256(bsp).hexdigest()=='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc'
a,n,version,fourcc=struct.unpack_from('<4I',bsp,8+54*16);assert version==1 and n==2600 and fourcc==0
raw=bsp[a:a+n];lights=[]
for i in range(n//100):
 p=i*100
 lights.append({'id':i,'origin':list(struct.unpack_from('<3f',raw,p)),'intensity':list(struct.unpack_from('<3f',raw,p+12)),'normal':list(struct.unpack_from('<3f',raw,p+24)),'shadowCastOffset':list(struct.unpack_from('<3f',raw,p+36)),
  'cluster':struct.unpack_from('<i',raw,p+48)[0],'type':struct.unpack_from('<i',raw,p+52)[0],'style':struct.unpack_from('<i',raw,p+56)[0],
  **dict(zip(['stopDot','stopDot2','exponent','radius','constantAttenuation','linearAttenuation','quadraticAttenuation'],struct.unpack_from('<7f',raw,p+60))),
  'flags':struct.unpack_from('<I',raw,p+88)[0],'texinfo':struct.unpack_from('<i',raw,p+92)[0],'owner':struct.unpack_from('<i',raw,p+96)[0]})
assert all(x['style']==0 and x['type']in[0,1,2,3,5]for x in lights)
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000)
for s in e.segments:
 if s[0]==1:u.mem_write(s[3],e.data[s[2]:s[2]+s[5]])
B=0x6000000;u.mem_map(B,0x100000);address=B;delta=B+0x100;direction=B+0x200;stack=B+0xf0000;stop=B+0xff000
f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
def scalar(reg,kind='f'):return struct.unpack('<'+kind,u.reg_read(reg).to_bytes(16,'little')[:4 if kind=='f' else 8])[0]
def hook(u,at,size,data):
 if at!=0x1b14a0:return
 # Original cone calls libc pow(double,double), an explicit standard-library boundary.
 result=math.pow(scalar(UC_X86_REG_XMM0,'d'),scalar(UC_X86_REG_XMM1,'d'));u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<d',result),'little'))
 sp=u.reg_read(UC_X86_REG_RSP);u.reg_write(UC_X86_REG_RIP,struct.unpack('<Q',u.mem_read(sp,8))[0]);u.reg_write(UC_X86_REG_RSP,sp+8)
u.hook_add(UC_HOOK_CODE,hook)
def call(entry,regs):
 u.mem_write(stack,struct.pack('<Q',stop));u.reg_write(UC_X86_REG_RSP,stack)
 for reg,value in regs:u.reg_write(reg,value)
 u.emu_start(entry,stop,count=100000);assert u.reg_read(UC_X86_REG_RIP)==stop;return scalar(UC_X86_REG_XMM0)
cases=[]
runtime=bytearray(raw)
for light in lights:
 p=light['id']*100
 light['sourceRadius']=light['radius']
 if light['type']in(1,2) and not any(light[k]for k in('constantAttenuation','linearAttenuation','quadraticAttenuation')):
  light['quadraticAttenuation']=1;struct.pack_into('<f',runtime,p+84,1)
 if light['type']==2 and light['exponent']==0:light['exponent']=1;struct.pack_into('<f',runtime,p+68,1)
 u.mem_write(address,bytes(runtime[p:p+100]))
 if light['radius']<1:
  light['radius']=call(0x320a60,[(UC_X86_REG_RDI,address),(UC_X86_REG_RSI,1)])
  struct.pack_into('<f',runtime,p+72,light['radius'])
 u.mem_write(address,bytes(runtime[p:p+100]))
 vectors=[[.1,0,0],[1,0,0],[32,13,-9],[1000,500,250],[10000,0,0]]
 if light['type']in[0,2]:
  normal=light['normal'];axis=[1,0,0] if abs(normal[0])<.9 else [0,1,0];cross=[normal[1]*axis[2]-normal[2]*axis[1],normal[2]*axis[0]-normal[0]*axis[2],normal[0]*axis[1]-normal[1]*axis[0]];length=math.sqrt(sum(v*v for v in cross));cross=[v/length for v in cross]
  angles=[.005,.01,.015]if light['type']==0 else [light['stopDot2']+(light['stopDot']-light['stopDot2'])*t for t in[.2,.5,.8]]
  for cosine in angles:vectors.append([f(100*(-normal[j]*cosine+cross[j]*math.sqrt(max(0,1-cosine*cosine))))for j in range(3)])
 if light['type']in[0,2,3]:vectors += [[f(-v*100)for v in light['normal']],[f(v*100)for v in light['normal']]]
 for vector in vectors:
  u.mem_write(delta,struct.pack('<3f',*vector));attenuation=call(0x337230,[(UC_X86_REG_RDI,address),(UC_X86_REG_RSI,delta),(UC_X86_REG_RDX,0)])
  length=f(math.sqrt(f(f(f(vector[0]*vector[0])+f(vector[1]*vector[1]))+f(vector[2]*vector[2]))));inv=f(1/f(length+2**-23));unit=[f(v*inv)for v in vector]
  u.mem_write(direction,struct.pack('<3f',*unit));cone=call(0x3373b0,[(UC_X86_REG_RDI,address),(UC_X86_REG_RSI,address+24),(UC_X86_REG_RDX,direction),(UC_X86_REG_RCX,direction)])
  cases.append({'light':light['id'],'delta':vector,'direction':unit,'nativeAttenuation':attenuation,'nativeCone':cone})
report={'format':'source-particle-worldlights-v1','build':12426148,'bspSHA256':hashlib.sha256(bsp).hexdigest(),'lump':54,'lumpVersion':version,'stride':100,'lumpSHA256':hashlib.sha256(raw).hexdigest(),'engineSHA256':e.identity()['sha256'],'units':'original Source coordinates; linear HDR light intensity','worldlights':lights,'runtimePreparation':{'loader':'0x354260','hdrLumpCall':'0x35b658 lump54 / 0x35b665 HDR=true','radius':'0x35441d -> 0x320a60 -> 0x31fc60 executed','radiusEpsilonHDR':.015,'runtimeBytesSHA256':hashlib.sha256(runtime).hexdigest()},
 'defaults':{'r_radiosity':4,'r_worldlightmin':.0002,'r_worldlights':2,'r_lightcachecenter':1,'r_lightcache_radiusfactor':1000,'r_ambientlightingonly':0,'r_oldlightselection':0,'r_lightcache_zbuffercache':0},
 'boundary':'Original immutable static worldlights and compiler defaults. Not original transient Lightcache state or live engine cvars.'}
(ROOT/'game/source-particle-worldlights.json').write_text(json.dumps(report,indent=2)+'\n')
proof={'format':'source-worldlight-kernels-v1','engineSHA256':e.identity()['sha256'],'entryAttenuation':'0x337230','entryCone':'0x3373b0','cases':cases,'boundary':'Unmodified installed native kernels executed with original 100-byte worldlights. libc pow is the explicit numeric adapter; no full Lightcache or map raycast execution is claimed.'}
(ROOT/'tests/fixtures/source-worldlight-kernels.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'lights':len(lights),'kernelCases':len(cases),'lumpSHA256':report['lumpSHA256']}))
