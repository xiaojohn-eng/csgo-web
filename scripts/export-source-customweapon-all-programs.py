"""Export all original non-preview paint-style programs, following VCS aliases."""
from pathlib import Path
import hashlib,importlib.util,json,struct,sys
from unicorn.x86_const import UC_X86_REG_RDX,UC_X86_REG_RBX,UC_X86_REG_RAX
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/fidelity-paint-20260913/programs'
def mod(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    m=mod('allelf','inspect-source-vhv-encoding.py');x=mod('alluc','inspect-source-prop-tint.py');v=mod('allvpk','inventory-source-map.py');p=mod('allctab','probe-source-redline-programs.py')
    shader=m.ELF(ROOT/'.reference-assets/csgo-legacy/bin/linux64/stdshader_dx9_client.so');u=x.emulator(shader);frame=x.BASE+0xe000
    vcs=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/platform/platform_pak01_dir.vpk').read('shaders/fxc/customweapon_ps30.vcs')
    assert hashlib.sha256(vcs).hexdigest()=='7115c936b78fa3762e9a729b60b1b2123f761ac32a41bf044b3bb34bde5ac0ce'
    count=struct.unpack_from('<I',vcs,20)[0];at=28+8*count;alias_count=struct.unpack_from('<I',vcs,at)[0]
    aliases=dict(struct.iter_unpack('<2I',vcs[at+4:at+4+alias_count*8]));OUT.mkdir(parents=True,exist_ok=True)
    branches={};receipts=[]
    for low in (False,True):
        data={}
        for style in range(1,10):
            pair={}
            for mode,name in enumerate(('color','exponent')):
                u.mem_write(frame-0x201,b'\0');u.mem_write(frame-0x24c,b'\0');u.mem_write(frame-0x238,struct.pack('<f',.5 if low else 1))
                u.mem_write(frame-0x208,struct.pack('<I',style));u.mem_write(frame-0x250,struct.pack('<I',mode));u.mem_write(frame-0x244,b'\0'*4)
                u.emu_start(0x65c3e,0x65cb1,count=100);combined=u.reg_read(UC_X86_REG_RDX);static=combined//5
                assert static==style+10*mode+160*low
                canonical=aliases.get(static,static);code,proof=m.vcs_combo(vcs,canonical,0);tokens=[list(row)for row in m.instructions(code).values()];ctab=p.ctab(code)['constants']
                (OUT/f'customweapon-static{static}-dynamic0.dx9').write_bytes(code)
                row={'static':static,'aliasResolvedStatic':canonical,'sha256':hashlib.sha256(code).hexdigest(),'tokenCount':len(tokens),
                    'samplers':sorted(c['index']for c in ctab if c['registerSet']==3),
                    'constants':[{'register':c['index'],'name':c['name'],'count':c['count']}for c in ctab if c['registerSet']==2],
                    'tokens':tokens}
                pair[name]=row;receipts.append({'style':style,'lowAlbedo':low,'pass':name,'nativeCombined':combined,**{k:v for k,v in row.items()if k!='tokens'}})
            data[str(style)]=pair
        branches['low'if low else 'high']=data
    # Original projected styles upload the first two rows of the very same
    # $PATTERNTEXTURETRANSFORM matrix to PS c10/c11. No derived/invented transform.
    assert shader.cstring(shader.rip(0x2de22,'48 8d 05'))=='$PATTERNTEXTURETRANSFORM'
    shader.check(0x64eb9,'8b 05 c9 c7 2f 00');shader.check(0x64ebf,'89 45 c4')
    shader.check(0x64dea,'4c 8d 85 70 ff ff ff');shader.check(0x677b8,'49 63 44 24 54')
    shader.check(0x667d6,'83 fe 03');shader.check(0x667e6,'83 fe 06')
    ctx=x.BASE+0x3000;matrix=x.BASE+0x5000;stream=x.BASE+0x8000;matrix_cases=[]
    for values in [(1,0,0,0,0,1,0,0),(.33,-.71,0,.61,.71,.33,0,-.23),(-1.7,.42,0,4.1,-.42,-1.7,0,-.9)]:
        u.mem_write(matrix,struct.pack('<8f',*values));u.reg_write(UC_X86_REG_RAX,matrix);u.reg_write(UC_X86_REG_RBX,ctx)
        u.mem_write(ctx+0x330,struct.pack('<Q',stream));u.emu_start(0x67e81,0x678e6,count=100)
        words=struct.unpack('<3I8f',u.mem_read(stream,44));assert words[:3]==(3,10,2)
        assert words[3:]==struct.unpack('<8f',struct.pack('<8f',*values))
        matrix_cases.append({'matrixFirstTwoRows':list(values),'commandWords':list(words[:3]),'nativeC10C11':list(words[3:])})
    bindings=[]
    for sampler,start,end in [(4,0x67b08,0x67b4c),(6,0x67a38,0x67a7c),(7,0x679d0,0x67a14)]:
        u.reg_write(UC_X86_REG_RBX,ctx);u.reg_write(UC_X86_REG_RAX,0x12345678);u.mem_write(ctx+0x330,struct.pack('<Q',stream))
        u.emu_start(start,end,count=100);words=struct.unpack('<IIQ',u.mem_read(stream,16));assert words==(10,sampler,0x12345678)
        bindings.append({'sampler':sampler,'nativeCommand':list(words),'srgbRead':False})
    # Identity control: the original verified Redline pair and both shipped style5 branches.
    old=json.loads((ROOT/'.reference-assets/source-exports/customweapon-style-programs/tokens.json').read_text())
    oldlow=json.loads((ROOT/'.reference-assets/source-exports/style5-albedo-overrides/tokens.json').read_text())
    for name in ('color','exponent'):
        assert branches['high']['7'][name]['tokens']==old['7'][name]
        assert branches['high']['5'][name]['tokens']==old['5'][name]
        assert branches['low']['5'][name]['tokens']==oldlow[name]['tokens']
    receipt={'format':'source-customweapon-all-programs-native-v1','shader':shader.identity(),'vcsSha256':hashlib.sha256(vcs).hexdigest(),
        'programs':receipts,'patternMatrixCases':matrix_cases,'additionalSamplerBindings':bindings,'boundary':'Native non-preview selector executed; original VCS aliases and DX9 bytes extracted. Translation, GPU filtering and original-client output comparison remain distinct.'}
    (ROOT/'research/source-customweapon-all-programs.json').write_text(json.dumps(receipt,indent=2)+'\n')
    (OUT/'tokens.json').write_text(json.dumps(branches,separators=(',',':'))+'\n')
    (ROOT/'game/source-customweapon-program-data.ts').write_text('// Generated from installed VCS aliases by scripts/export-source-customweapon-all-programs.py.\n'
        "export const SOURCE_CUSTOMWEAPON_PROGRAM_FORMAT = 'source-customweapon-program-data-v1';\n"
        'export const SOURCE_CUSTOMWEAPON_PROGRAM_STYLES = '+json.dumps([str(i)for i in range(1,10)if i!=7])+' as const;\n'
        'export const SOURCE_CUSTOMWEAPON_PROGRAM_DATA = '+json.dumps({k:v for k,v in branches['high'].items()if k!='7'},separators=(',',':'))+' as const;\n')
    (ROOT/'game/source-customweapon-low-albedo-data.ts').write_text('// Generated from original non-preview VCS aliases by scripts/export-source-customweapon-all-programs.py.\n'
        'export const SOURCE_CUSTOMWEAPON_LOW_ALBEDO_DATA = '+json.dumps(branches['low'],separators=(',',':'))+' as const;\n')
    compatibility={style:{name:{'static':row['static'],'samplers':row['samplers'],
        'constants':[c['register']+i for c in row['constants']for i in range(c['count'])],
        'tokens':row['tokens']}for name,row in pair.items()}for style,pair in branches['high'].items()}
    (ROOT/'game/source-customweapon-programs.ts').write_text('// Generated from original VCS aliases by scripts/export-source-customweapon-all-programs.py.\n'
        "export const SOURCE_CUSTOMWEAPON_PROGRAM_VERSION = 'app740-12426148-customweapon-all-styles-token-candidate-r2';\n"
        'export const SOURCE_CUSTOMWEAPON_PROGRAMS = '+json.dumps(compatibility,separators=(',',':'))+' as const;\n')
    print(json.dumps({'programs':len(receipts),'aliases':[(p['static'],p['aliasResolvedStatic'])for p in receipts if p['static']!=p['aliasResolvedStatic']]}))
if __name__=='__main__':main()
