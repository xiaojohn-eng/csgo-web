"""Bounded read-only evidence from installed official ELF and compiled shaders.

No engine execution, third-party decompiler, nearest-point mapping, or GPU change.
Only the explicitly asserted Source bump shader path is interpreted.
"""
from pathlib import Path
from collections import Counter
import bz2
import hashlib
import importlib.util
import json
import lzma
import math
import struct
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/dust2-vhv/encoding'
INSTALL=ROOT/'.reference-assets/csgo-legacy'
def sha(data):return hashlib.sha256(data).hexdigest()
def write(name,data):(OUT/name).write_bytes(data)
def jsave(name,value):(OUT/name).write_text(json.dumps(value,indent=2)+'\n')

class ELF:
    def __init__(self,path):
        self.path=path;self.data=path.read_bytes();d=self.data
        assert d[:6]==b'\x7fELF\x02\x01'
        off=struct.unpack_from('<Q',d,32)[0];size,count=struct.unpack_from('<HH',d,54)
        self.segments=[struct.unpack_from('<IIQQQQQQ',d,off+i*size) for i in range(count)]
    def offset(self,address):
        return next(s[2]+address-s[3] for s in self.segments if s[0]==1 and s[3]<=address<s[3]+s[5])
    def code(self,address,size):
        off=self.offset(address);return self.data[off:off+size]
    def check(self,address,hex_bytes):
        expected=bytes.fromhex(hex_bytes);assert self.code(address,len(expected))==expected,hex(address)
    def cstring(self,address):
        off=self.offset(address);return self.data[off:self.data.index(b'\0',off)].decode('ascii')
    def rip(self,address,prefix):
        self.check(address,prefix);return address+7+struct.unpack('<i',self.code(address+3,4))[0]
    def jump(self,address,opcode):
        self.check(address,opcode);return address+5+struct.unpack('<i',self.code(address+1,4))[0]
    def disassemble(self,name,windows):
        value='\n'.join(subprocess.check_output(['/usr/bin/objdump','--disassemble',f'--start-address={a}',f'--stop-address={b}',str(self.path)],text=True) for a,b in windows)
        write(name,value.encode())
    def identity(self):return {'file':str(self.path.relative_to(ROOT)),'bytes':len(self.data),'sha256':sha(self.data)}

def vcs_combo(data,static,dynamic):
    version,total,dynamic_count,flags,centroid,count,crc=struct.unpack_from('<7I',data)
    assert version==6 and dynamic<dynamic_count and 28+8*count<=len(data)
    table=list(struct.iter_unpack('<2I',data[28:28+8*count]))
    assert table[-1]==(0xffffffff,len(data))
    i=next(i for i,(key,_) in enumerate(table[:-1]) if key==static)
    start=table[i][1];end=table[i+1][1];offset=start;decoded=bytearray();blocks=[]
    while offset<end:
        token=struct.unpack_from('<I',data,offset)[0];offset+=4
        if token==0xffffffff:break
        size=token&0x3fffffff;kind=token>>30;packed=data[offset:offset+size];offset+=size
        assert offset<=end
        if kind==1:
            assert packed[:4]==b'LZMA'
            actual,compressed=struct.unpack_from('<2I',packed,4);assert len(packed)==17+compressed and actual<=131072
            prop=packed[12];lc=prop%9;prop//=9;lp=prop%5;pb=prop//5
            dictionary=struct.unpack_from('<I',packed,13)[0]
            decoder=lzma.LZMADecompressor(format=lzma.FORMAT_RAW,filters=[{'id':lzma.FILTER_LZMA1,'dict_size':dictionary,'lc':lc,'lp':lp,'pb':pb}])
            # Valve's container declares the exact output length, without an EOS
            # marker. Bound by that field, never accept a truncated payload.
            block=decoder.decompress(packed[17:],max_length=actual);assert len(block)==actual
        elif kind==0:block=bz2.decompress(packed)
        elif kind==2:block=packed
        else:raise ValueError('Unknown VCS packed block')
        blocks.append({'kind':kind,'packedBytes':size,'unpackedBytes':len(block),'sha256':sha(block)});decoded.extend(block)
    assert offset==end,'VCS static block has unparsed trailing data'
    offset=0;selected=None;seen=[]
    while offset<len(decoded):
        key,size=struct.unpack_from('<2I',decoded,offset);offset+=8
        code=bytes(decoded[offset:offset+size]);offset+=size
        assert len(code)==size and size%4==0 and struct.unpack_from('<I',code,size-4)[0]==0xffff
        assert key<dynamic_count and key not in seen;seen.append(key)
        if key==dynamic:selected=code
    assert offset==len(decoded) and selected is not None
    return selected,{'version':version,'totalCombos':total,'dynamicCombos':dynamic_count,'staticRecordsIncludingSentinel':count,
        'sourceCRC32':f'{crc:08x}','static':static,'dynamic':dynamic,'staticFileSpan':[start,end],
        'parsedProgramsInSelectedStatic':len(seen),'blocks':blocks,'programBytes':len(selected),'programSha256':sha(selected)}

def instructions(code):
    words=struct.unpack('<'+'I'*(len(code)//4),code);result={};offset=1
    assert words[0] in (0xfffe0300,0xffff0300)
    while offset<len(words):
        op=words[offset]&65535
        if op==0xffff:assert offset==len(words)-1;break
        if op==0xfffe:offset+=1+((words[offset]>>16)&0x7fff);continue
        count=(words[offset]>>24)&15;assert offset+count<len(words)
        result[offset]=words[offset:offset+count+1];offset+=count+1
    return result

def register(value,dest=False):
    kind=((value>>28)&7)|((value>>8)&24)
    name={0:'r',1:'v',2:'c',3:'a',6:'o',8:'oc',10:'s',14:'b'}.get(kind,'register'+str(kind)+'_')+str(value&2047)
    if dest:return name+'.'+''.join(c for i,c in enumerate('xyzw') if value&(1<<(16+i)))
    name+='.'+''.join('xyzw'[(value>>(16+2*i))&3] for i in range(4))
    return ('-' if (value>>24)&15==1 else '')+name

def shader_text(code):
    ops={1:'mov',2:'add',4:'mad',5:'mul',6:'rcp',7:'rsq',8:'dp3',9:'dp4',10:'min',11:'max',14:'exp2',15:'log2',18:'lrp',31:'dcl',32:'pow',35:'abs',40:'if',42:'else',43:'endif',66:'texld',81:'def',88:'cmp',90:'dp2add'}
    rows=[]
    for at,words in instructions(code).items():
        op=words[0]&65535;args=words[1:]
        if op==81:operands=register(args[0],True)+' '+str(struct.unpack('<4f',struct.pack('<4I',*args[1:])))
        elif op==31:operands='usage='+str(args[0]&15)+' index='+str((args[0]>>16)&15)+' '+register(args[1],True)
        else:operands=(register(args[0],True)+' '+', '.join(register(a) for a in args[1:])) if args else ''
        # Mnemonics are explanatory; exact token arrays below are the evidence.
        rows.append(f'{at:04d} {ops.get(op,"opcode_"+str(op))} {operands} | '+' '.join(f'{x:08x}' for x in words))
    return '\n'.join(rows)+'\n'

def main():
    OUT.mkdir(exist_ok=True)
    spec=importlib.util.spec_from_file_location('vhv_encoding_index',ROOT/'scripts/inventory-source-map.py');mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
    vpk=mod.VPKIndex(INSTALL/'platform/platform_pak01_dir.vpk')
    shader_paths=[k for k in vpk.entries if k.endswith('.vcs')]
    reports=[];programs=[]
    for filename,static,dynamic in [('vertexlit_and_unlit_generic_bump_vs30.vcs',0,4),('vertexlit_and_unlit_generic_bump_ps30.vcs',4,80)]:
        path='shaders/fxc/'+filename;raw=vpk.read(path);write(filename,raw);code,report=vcs_combo(raw,static,dynamic)
        report.update(file=path,container='platform/platform_pak01',bytes=len(raw),sha256=sha(raw),crc32=f'{vpk.entries[path]["crc32"]:08x}')
        basename=filename.removesuffix('.vcs')+f'-static{static}-dynamic{dynamic}'
        write(basename+'.dx9',code);write(basename+'.tokens.txt',shader_text(code).encode());reports.append(report);programs.append(instructions(code))
    vs,ps=programs
    assert vs[171]==(0x05000051,0xa00f0001,0x400ccccd,0x38d1b717,0,0)
    for j,start in enumerate((319,345,371)):
        input_register=2+j;output_register=7+j
        assert vs[start]==(0x03000002,0x80070000,0x90e40000+input_register,0x90e40000+input_register)
        assert [vs[start+x][0]&65535 for x in (4,7,10,13,17,20,23)]==[15,15,15,5,14,14,14]
        assert vs[start+13]==(0x03000005,0x80070000,0x80e40001,0xa0000001)
        for delta,mask,swizzle in ((17,1,0),(20,2,0x55),(23,4,0xaa)):
            assert vs[start+delta]==(0x0200000e,0xe0000000+(mask<<16)+output_register,0x80000000+(swizzle<<16))
        assert vs[797+3*j]==(0x02000001,0xe0080000+output_register,0x90ff0000+input_register)
    # Actual PS declarations read xyz of the three VS outputs; no alpha input.
    for usage,reg in ((6,4),(7,5),(8,6)):
        assert (0x0200001f,0x80000005+(usage<<16),0x90070000+reg) in ps.values()
    expected_ps={227:(0x0400005a,0x80110003,0x80e80000,0xa0e40000,0xa0aa0000),
        232:(0x03000008,0x80120003,0x80e40000,0xa0e40002),236:(0x03000008,0x80140003,0x80e40000,0xa0e40004),
        240:(0x03000005,0x80070000,0x80e40003,0x80e40003),
        244:(0x03000005,0x800d0002,0x80550000,0x90940005),
        248:(0x04000004,0x800d0002,0x80000000,0x90940004,0x80e40002),
        253:(0x04000004,0x800d0002,0x80aa0000,0x90940006,0x80e40002),
        258:(0x03000008,0x80010000,0x80e40000,0xa0aa0005),
        262:(0x02000006,0x80010000,0x80000000),265:(0x03000005,0x80070000,0x80000000,0x80f80002)}
    for at,expected in expected_ps.items():assert ps[at]==expected,(at,ps[at])
    constants={}
    for at in (132,138,144,150):
        word=ps[at];assert word[0]==0x05000051 and ((word[1]>>28)&7)==2
        constants[word[1]&2047]=struct.unpack('<4f',struct.pack('<4I',*word[2:]))
    basis=[[constants[0][0],constants[0][2],constants[0][1]],list(constants[2][:3]),list(constants[4][:3])]
    assert constants[5]==(2,-1,1,0)
    shaderapi=ELF(INSTALL/'bin/linux64/shaderapidx9_client.so')
    assert shaderapi.cstring(shaderapi.rip(0x68276,'48 8d 35'))=='r_staticlight_streams'
    shaderapi.check(0x683d0,'b9 01 00 00 00 45 31 c9')
    shaderapi.check(0x683dc,'8d 34 85 00 00 00 00')
    shaderapi.check(0x683e8,'66 44 89 4a 02 41 b8 01 00 00 00 41 83 c1 04 48 83 c2 08 88 4a ff 83 c1 01 66 44 89 42 f8 c6 42 fd 00 c6 42 fe 0a c6 42 fc 04 41 39 f1 75 d1')
    shaderapi.disassemble('shaderapi-color-declaration.asm',[(0x6825d,0x68422),(0x688d6,0x688ee)])
    engine=ELF(INSTALL/'bin/linux64/engine_client.so')
    assert engine.cstring(engine.rip(0x335682,'48 8d 15'))=='sp_hdr_%d%s.vhv'
    engine.check(0x33bf7c,'8b 85 6c fe ff ff c1 e0 02 41 39 46 0c')
    engine.check(0x33c13b,'48 8d 42 08')
    engine.check(0x33c193,'42 8d 14 b5 00 00 00 00')
    engine.check(0x33c1a2,'41 0f af d5')
    engine.check(0x33c1b1,'8b 33 48 03 b5 e8 fc ff ff')
    assert engine.jump(0x33c1c2,'e8')==engine.jump(0x33c594,'e8')==0x65f500
    engine.check(0x65f500,'55 48 63 d2 48 89 e5 5d');assert engine.jump(0x65f508,'e9')==0x1b0bb0
    engine.disassemble('engine-vhv-copy.asm',[(0x335650,0x33568e),(0x33bd51,0x33bda8),(0x33bf3d,0x33bfdf),(0x33c020,0x33c21c),(0x33c32d,0x33c674),(0x65f500,0x65f50d)])
    # The same source 4-byte words are also interpreted as float32 solely to
    # reject an unqualified 'three linear floats' claim. No pixels are changed.
    inventory=json.loads((OUT.parent/'inventory.json').read_text());raw=(OUT.parent/'instance-lighting.bin').read_bytes()
    assert sha(raw)==inventory['binary']['lighting']['sha256'];counts=[Counter() for _ in range(3)];mins=[math.inf]*3;maxs=[-math.inf]*3
    for i,(word,) in enumerate(struct.iter_unpack('<I',raw)):
        group=i%3;exp=(word>>23)&255;mantissa=word&0x7fffff;value=struct.unpack('<f',struct.pack('<I',word))[0]
        counts[group]['words']+=1
        if exp==255:counts[group]['nonfinite']+=1
        else:
            mins[group]=min(mins[group],value);maxs[group]=max(maxs[group],value)
            if word>>31:counts[group]['negativeSign']+=1
            if exp==0 and mantissa:counts[group]['subnormal']+=1
            if value>1:counts[group]['greaterThanOne']+=1
    # Shader token operations evaluated independently of the closed-form LUT.
    gamma=struct.unpack('<f',struct.pack('<I',vs[171][2]))[0]
    lut=[(2*i/255)**gamma for i in range(256)];error=max(abs((2**(math.log2(2*i/255)*gamma) if i else 0)-lut[i]) for i in range(256))
    assert error<1e-14
    result={'status':'installed_bump_three_color_path_verified','scope':'Installed Linux64 D3D9 compatibility API and exact two compiled shader programs; not every material or shader combo',
        'platformShaderResourceCount':len(shader_paths),'shaderPrograms':reports,'binaries':[shaderapi.identity(),engine.identity()],
        'cpu':{'originalVHVPayloadCopiedUnchanged':True,'recordBytes':'4 * r_staticlight_streams','stream':1,'offsetsAtThreeStreams':[0,4,8],'declarationType':4,'declarationTypeName':'D3DCOLOR','usage':10,'usageIndices':[1,2,3]},
        'vertexShader':{'rgb':'pow(2 * normalizedD3DColor.rgb, 2.200000047683716)','rawLittleEndianByteOrder':['B','G','R','A'],'fourthByte':'forwarded unchanged as normalized alpha; not shared RGB exponent'},
        'pixelShader':{'inputMasks':['xyz','xyz','xyz'],'basis':basis,
            'weights':'saturate(dot(textureNormal, basis_i)) squared','diffuse':'sum(weights_i * interpolatedLinearRGB_i) / sum(weights_i)','alphaUsedInThisBranch':False},
        'float32InterpretationOnly':[dict(counts[i],finiteMinimum=mins[i],finiteMaximum=maxs[i]) for i in range(3)],
        'lut256':lut,'lutMaxTokenVsClosedFormError':error,'gpuVerified':False,'originalAssetsModified':False,
        'limitations':['Fourth-byte semantics in other CPU/shader branches remain unassigned','No complete shader variant selector, lightmap scale, ambient cube, shadow or final color-management reconstruction','GPU-facing props source IDs remain a separate export task']}
    jsave('evidence.json',result);print(json.dumps({k:v for k,v in result.items() if k not in ('lut256','float32InterpretationOnly')},indent=2))
if __name__=='__main__':main()
