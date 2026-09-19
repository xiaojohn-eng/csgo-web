"""Bounded installed client material-builder arithmetic; no engine calls.

Captures the original floating arguments and format strings before KeyValues
serialization. Python formatting/parsing is explicitly the portable boundary.
Seed RNG and material text-to-matrix parsing are not established by this probe.
"""
from pathlib import Path
import importlib.util,json,struct,sys
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
 m=module('redline_parameter_elf','inspect-source-vhv-encoding.py');x=module('redline_parameter_x64','inspect-source-prop-tint.py')
 e=m.ELF(ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so');u=x.emulator(e);obj=x.BASE+0x1000;frame=x.BASE+0xe000
 factor=struct.unpack('<f',e.code(0x1936e9c,4))[0];assert factor==x.f32(1/255)
 assert e.cstring(0x193c89c)=='%f'
 fmt=e.cstring(0x19d4440);assert fmt=='scale %.2f %.2f translate %.2f %.2f rotate %.2f'
 for a,name in [(0xf52495,'$phongintensity'),(0xf524dd,'$phongexponent'),(0xf5235d,'$patterntexturetransform'),(0xf523b9,'$weartexturetransform'),(0xf52415,'$grungetexturetransform')]:assert e.cstring(e.rip(a,'48 8d 35'))==name
 e.check(0xf520cf,'f3 0f 10 2d c5 4d 9e 00');e.check(0xf520f4,'f3 0f 11 6d 8c')
 u.reg_write(UC_X86_REG_RBX,obj);u.mem_write(frame-0x7c,struct.pack('<f',factor))
 def double(reg):return struct.unpack('<d',struct.pack('<Q',u.reg_read(reg)&0xffffffffffffffff))[0]
 values=[]
 for n in range(256):
  u.mem_write(obj+0xc48,struct.pack('<i',n));u.mem_write(obj+0x9f8,struct.pack('<i',n))
  for name,start,end in [('phongIntensity',0xf52458,0xf5248a),('phongExponent',0xf524a1,0xf524d2)]:
   u.emu_start(start,end,count=100);assert u.reg_read(UC_X86_REG_RIP)==end
   v=double(UC_X86_REG_XMM0);assert v==x.f32(n*factor)
   text=format(v,'.6f');values.append({'parameter':name,'schemaInteger':n,'nativeDoubleArgument':v,'originalFormat':'%f','portableText':text,'portableParsedFloat32':x.f32(float(text))})
 wear_cases=[]
 for wear in [0,.00000049,.00000051,.1,.2,.4,.7,1]:
  u.mem_write(obj+0xa04,struct.pack('<f',wear));u.emu_start(0xf52260,0xf5226c,count=10);assert u.reg_read(UC_X86_REG_RIP)==0xf5226c
  value=double(UC_X86_REG_XMM0);assert value==x.f32(wear);text=format(value,'.6f');wear_cases.append({'input':wear,'nativeDoubleArgument':value,'portableText':text,'portableParsedFloat32':x.f32(float(text))})
 transforms=[]
 for ignore in [False,True]:
  for weapon_scale in [.549,1.,2.]:
   for scale,tx,ty,rotation in [(1.,0.,0.,0.),(2.1,17.235,-.129,.999),(1.337,-91.234,.555,-.75)]:
    u.mem_write(obj+0x9bc,struct.pack('<i',7));u.mem_write(obj+0xc4c,bytes([ignore]));u.mem_write(obj+0x84,struct.pack('<f',weapon_scale));u.mem_write(frame-0x74,struct.pack('<f',factor))
    for at in [0xa08,0xa18,0xa28]:u.mem_write(obj+at,struct.pack('<4f',scale,tx,ty,rotation))
    for name,start,end in [('pattern',0xf522b1,0xf52352),('wear',0xf52369,0xf523ae),('grunge',0xf523c5,0xf5240a)]:
     u.emu_start(start,end,count=100);assert u.reg_read(UC_X86_REG_RIP)==end
     args=[double(r) for r in [UC_X86_REG_XMM0,UC_X86_REG_XMM1,UC_X86_REG_XMM2,UC_X86_REG_XMM3,UC_X86_REG_XMM4]]
     expected=[x.f32(x.f32(scale)*(1 if ignore else x.f32(weapon_scale)))]*2+list(map(x.f32,[tx,ty,rotation]));assert args==expected
     # System V vector-register args are scaleX,scaleY,tx,ty,rotation.
     # Original format consumes that order; names do not reorder arguments.
     transforms.append({'kind':name,'ignoreWeaponSizeScale':ignore,'weaponScale':weapon_scale,'fields':{'scale':scale,'rotation':rotation,'offsetX':tx,'offsetY':ty},'nativeDoubleArguments':args,'originalFormat':fmt,'portableText':fmt%tuple(args)})
 out={'status':'native_client_material_arguments_verified','binary':e.identity(),'normalizationFactor':factor,'constantSource':'0x1936e9c','scalarSpans':{'phongIntensity':['0xf52458','0xf5248a'],'phongExponent':['0xf524a1','0xf524d2']},'scalarCases':values,'wearCases':wear_cases,'transformCases':transforms,'boundary':'Original arithmetic and original format literals measured; Python text formatting and float parsing are portable. Seed initialization, material text-to-matrix parsing and final original-client GPU output remain independent.'}
 path=ROOT/'.reference-assets/source-exports/ak47-redline-programs/client-parameters.json';path.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'status':out['status'],'scalarCases':len(values),'transformCases':len(transforms),'redline':[r for r in values if (r['parameter'],r['schemaInteger']) in [('phongExponent',150),('phongIntensity',10)]]},indent=2))
if __name__=='__main__':main()
