"""Execute the installed x64 leaf-ambient sampler against original Dust II lumps.

The engine's transient world/leaf structs are explicit harness inputs reconstructed
from the BSP. The sampler and RGBExp32 decoder execute unmodified original code.
No original client frame, shader upload or GPU output is claimed.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct
import sys
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
from unicorn.x86_const import UC_X86_REG_RDI, UC_X86_REG_RSI, UC_X86_REG_RDX, UC_X86_REG_RSP

ROOT=Path(__file__).resolve().parents[1]
def main():
    spec=importlib.util.spec_from_file_location('ambient_elf',ROOT/'scripts/inspect-source-vhv-encoding.py')
    m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
    e=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/engine_client.so')
    # Original leaf sampler -> RGBExp32ToVector; assert the call and scale sources.
    e.check(0x351024,'e8 b7 bb 42 00')
    e.check(0x77cbe8,'48 8d 15 91 8d 68 00')
    e.check(0x77cbf2,'f3 0f 10 05 5e 84 1c 00')
    assert struct.unpack('<f',e.code(0x945058,4))[0]==255
    u=Uc(UC_ARCH_X86,UC_MODE_64)
    u.mem_map(0,0x5000000)
    for s in e.segments:
        if s[0]==1:u.mem_write(s[3],e.data[s[2]:s[2]+s[5]])
    B=0x6000000;u.mem_map(B,0x400000)
    world=B;leaves=B+0x10000;index=B+0x90000;lighting=B+0xa0000;pos=B+0x200000;out=pos+0x100;stack=pos+0x10000;stop=stack+0x100
    base=ROOT/'public/source/csgo-12426148/environment-probes'
    raw=(base/'leaves.bin').read_bytes();ids=(base/'ambient-index-hdr.bin').read_bytes();samples=(base/'ambient-lighting-hdr.bin').read_bytes()
    runtime=bytearray(len(raw)//32*80)
    for leaf in range(len(raw)//32):
        mins=struct.unpack_from('<3h',raw,leaf*32+8);maxs=struct.unpack_from('<3h',raw,leaf*32+14)
        struct.pack_into('<3f',runtime,leaf*80+32,*[(a+b)/2 for a,b in zip(mins,maxs)])
        struct.pack_into('<3f',runtime,leaf*80+48,*[(b-a)/2 for a,b in zip(mins,maxs)])
    for address,data in [(leaves,runtime),(index,ids),(lighting,samples)]:u.mem_write(address,bytes(data))
    for address,value in [(0x4108a28,world),(world+32,leaves),(world+0x1d0,index),(world+0x1d8,lighting)]:u.mem_write(address,struct.pack('<Q',value))
    planes=(base/'planes.bin').read_bytes();nodes=(base/'nodes.bin').read_bytes()
    def find_leaf(p):
        node=0
        while node>=0:
            plane=struct.unpack_from('<i',nodes,node*32)[0]*20;n=struct.unpack_from('<4f',planes,plane)
            node=struct.unpack_from('<i',nodes,node*32+(4 if sum(a*b for a,b in zip(p,n))>=n[3] else 8))[0]
        return -node-1
    points=[r['sourcePosition'] for r in json.loads((base/'manifest.json').read_text())['probes']]
    level=json.loads((ROOT/'public/source/csgo-12426148/dust2/level.json').read_text())
    points += [[*s['sourceOrigin'][:2],s['sourceOrigin'][2]+64] for s in level['spawns']]
    cases=[]
    for p in points:
        leaf=find_leaf(p)
        u.mem_write(pos,struct.pack('<3f',*p));u.mem_write(out,bytes(72));u.mem_write(stack,struct.pack('<Q',stop))
        for reg,value in [(UC_X86_REG_RDI,out),(UC_X86_REG_RSI,pos),(UC_X86_REG_RDX,leaf),(UC_X86_REG_RSP,stack)]:u.reg_write(reg,value)
        u.emu_start(0x350e40,stop,count=1000000)
        faces=list(struct.unpack('<18f',u.mem_read(out,72)))
        cases.append({'sourcePosition':p,'leaf':leaf,'nativeFaces':[faces[i:i+3] for i in range(0,18,3)]})
    receipt={'format':'source-ambient-runtime-v1','engine':e.identity(),
      'entry':'0x350e40','rgbExp32Call':'0x351024 -> 0x77cbe0',
      'rawConstant255':{'address':'0x945058','value':255},
      'power2Table':{'address':'0xe05980','sha256':hashlib.sha256(e.code(0xe05980,1024)).hexdigest(),
        'exponent0':struct.unpack('<f',e.code(0xe05b80,4))[0]},
      'decode':'float32(float32(byte*255)*power2_n[exponent+128]); power2_n=2^exponent/255',
      'rendererScale':'Already linear ambient radiance. Do not divide by 255 again.',
      'cases':cases,'boundary':'Unmodified installed x64 sampler/decoder in Unicorn using original BSP inputs and reconstructed engine leaf structs. Not final client shader upload or GPU output.'}
    path=ROOT/'research/source-ambient-runtime.json';path.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'path':str(path),'cases':len(cases),'engineSha256':receipt['engine']['sha256']}))
if __name__=='__main__':main()
