"""Execute original CVTFTexture constructor, Init fields and RGBA8888 mip loop.

Object allocation/ImageData addresses, absent optional resources and libc pow are
explicit ABI fixtures. No host code replaces the original filtering pixel loops.
"""
from pathlib import Path
import importlib.util
import hashlib
import json
import math
import struct
import sys
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/fidelity-paint-20260913/mips'
sha=lambda b:hashlib.sha256(b).hexdigest()
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file)
    result=importlib.util.module_from_spec(spec);sys.modules[name]=result;spec.loader.exec_module(result);return result

def main():
    m=module('mip_elf','inspect-source-vhv-encoding.py');x=module('mip_x64','inspect-source-prop-tint.py')
    elf=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/materialsystem_client.so')
    assert sha(elf.data)=='7dfca3caa8ea59bf7b9188a370683f3f1dec6a382dd5f572277be3a55286767d'
    assert struct.unpack('<Q',elf.code(0x37b760+0x170,8))[0]==0x115f70
    assert struct.unpack('<Q',elf.code(0x37b760+0x10,8))[0]==0x11a1f0
    elf.check(0x696a7,'ff 90 70 01 00 00')
    elf.check(0x6ac52,'41 b9 00 04 00 00')
    for at,value,n in[(0x120820,1/255,4),(0x1217f8,255,8),(0x120824,.5,4)]:
        actual=struct.unpack('<f' if n==4 else '<d',elf.code(at,n))[0]
        assert actual==struct.unpack('<f',struct.pack('<f',value))[0] if n==4 else actual==value
    OUT.mkdir(parents=True,exist_ok=True)
    cases=[];lut=None
    fixtures=[('gradient8',8),('checker4',4),('opaque-white2',2),('transparent-colour8',8),
              ('random32',32),('random64',64),('alpha-ramp16',16)]
    for name,size in fixtures:
        u=x.emulator(elf);u.mem_map(x.BASE+0x10000,0x100000)
        obj=x.BASE+0x1000;u.mem_write(obj,b'\xa5'*0x130);u.reg_write(UC_X86_REG_RDI,obj)
        u.emu_start(0x117640,0x117825,count=100)
        assert u.reg_read(UC_X86_REG_RIP)==0x117825
        assert struct.unpack('<I',u.mem_read(obj+0x10c,4))[0]==0
        stack=x.BASE+0xf000
        u.reg_write(UC_X86_REG_RSP,stack);u.mem_write(stack+8,struct.pack('<2q',1,-1))
        for reg,value in[(UC_X86_REG_RDI,obj),(UC_X86_REG_RSI,size),(UC_X86_REG_RDX,size),
                          (UC_X86_REG_RCX,1),(UC_X86_REG_R8,0),(UC_X86_REG_R9,0x400)]:u.reg_write(reg,value)
        u.emu_start(0x11a1f0,0x11a2b0,count=500)
        assert u.reg_read(UC_X86_REG_RIP)==0x11a2b0
        width,height,depth,format_,mips,faces,frames=struct.unpack('<7I',u.mem_read(obj+0x10,28))
        assert (width,height,depth,format_,mips,faces,frames)==(size,size,1,0,size.bit_length(),1,1)
        state=422;pixels=bytearray()
        for y in range(size):
            for px in range(size):
                if name=='gradient8':rgba=[(y*size+px)*4+c for c in range(4)]
                elif name=='checker4':rgba=[255*((px+y+c)%2) for c in range(4)]
                elif name=='opaque-white2':rgba=[255]*4
                elif name=='transparent-colour8':rgba=[px*31,y*31,(px+y)*15,0]
                elif name=='alpha-ramp16':rgba=[0,127,255,(y*size+px)%256]
                else:
                    rgba=[]
                    for _ in range(4):state=(1664525*state+1013904223)&0xffffffff;rgba.append(state>>24)
                pixels.extend(rgba)
        ptrs=[x.BASE+0x10000+i*0x10000 for i in range(mips)]
        u.mem_write(ptrs[0],bytes(pixels));calls=[]
        def hook(uc,at,count,data):
            if at in(0x1160ed,0x11630e,0x116328):
                value=0 if at==0x1160ed else ptrs[uc.reg_read(UC_X86_REG_RCX)]
                uc.reg_write(UC_X86_REG_RAX,value);uc.reg_write(UC_X86_REG_RIP,at+count)
            elif at==0x256b0:
                args=[struct.unpack('<d',struct.pack('<Q',uc.reg_read(reg)&0xffffffffffffffff))[0]
                      for reg in(UC_X86_REG_XMM0,UC_X86_REG_XMM1)]
                uc.reg_write(UC_X86_REG_XMM0,struct.unpack('<Q',struct.pack('<d',math.pow(*args)))[0])
                sp=uc.reg_read(UC_X86_REG_RSP);uc.reg_write(UC_X86_REG_RIP,struct.unpack('<Q',uc.mem_read(sp,8))[0]);uc.reg_write(UC_X86_REG_RSP,sp+8)
            elif at==0xef950:
                info=uc.reg_read(UC_X86_REG_RDI)
                fields=struct.unpack('<2Q6I12fI',uc.mem_read(info,0x5c))
                assert fields[8:10]==(2.200000047683716,)*2 and fields[-1]==0
                sourceMip=ptrs.index(fields[0]);targetMip=ptrs.index(fields[1])
                assert sourceMip==max(0,targetMip-4)
                calls.append(dict(sourceMip=sourceMip,targetMip=targetMip,sourceSize=fields[2],targetSize=fields[5],
                                  sourceGamma=fields[8],destinationGamma=fields[9],resampleFlags=fields[-1]))
        u.hook_add(UC_HOOK_CODE,hook)
        u.reg_write(UC_X86_REG_RSP,stack);u.reg_write(UC_X86_REG_RDI,obj)
        u.emu_start(0x115f70,0x11641a,count=10000000)
        assert u.reg_read(UC_X86_REG_RIP)==0x11641a
        assert len(calls)==mips-1
        current=bytes(u.mem_read(0x3a92c0,256*4))
        if lut is None:lut=current
        else:assert lut==current
        outputs=[]
        for mip,pointer in enumerate(ptrs):
            dim=max(1,size>>mip);data=bytes(u.mem_read(pointer,dim*dim*4));file=f'{name}-mip{mip}.rgba'
            (OUT/file).write_bytes(data);outputs.append(dict(level=mip,size=dim,bytes=len(data),sha256=sha(data),file=file))
        cases.append(dict(name=name,size=size,originalInit=dict(format=0,flags=1024,mips=mips,faces=faces,frames=frames),calls=calls,mips=outputs))
    lutValues=list(struct.unpack('<256f',lut))
    report=dict(format='source-paint-mips-native-v1',materialSystem=elf.identity(),
                sourcePoolInitWriter=['0x6ac40','0x6ac61'],constructor=['0x117640','0x117825'],
                initFields=['0x11a1f0','0x11a2b0'],postReadbackCall='0x696a7',
                generator=['0x115f70','0x11641a'],resampler='0xef950',pixelLoop='0xf0ea0',
                gammaLookup=dict(address='0x3a92c0',sha256=sha(lut),values=lutValues),cases=cases,
                boundary='Native RGBA8888 uncompressed mip bytes execute at original pool flags 0x400. '
                         'Object allocation, ImageData address mapping, absent resources and host libc pow are ABI fixtures. '
                         'Original DXT compression and original-client GPU base-level output are not reproduced.')
    encoded=json.dumps(report,indent=2)+'\n';(OUT/'evidence.json').write_text(encoded)
    (ROOT/'research/source-paint-mips.json').write_text(encoded)
    (ROOT/'game/source-paint-mip-data.ts').write_text('// Native gamma-2.2 lookup from probe-source-paint-mips.py.\n'
        +'export const SOURCE_PAINT_MIP_GAMMA_LOOKUP = new Float32Array('+json.dumps(lutValues,separators=(',',':'))+');\n')
    print(json.dumps(dict(cases=len(cases),mips=sum(len(c['mips']) for c in cases),lookupSha256=sha(lut))))

if __name__=='__main__':main()
