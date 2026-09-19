"""Resolve original finish texture paths through the installed client's style table."""
from pathlib import Path
import copy,hashlib,importlib.util,json,struct,sys
from unicorn.x86_const import UC_X86_REG_RAX,UC_X86_REG_RBX,UC_X86_REG_RCX,UC_X86_REG_RDX,UC_X86_REG_R8
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.reference-assets/source-exports/fidelity-paint-20260913'
def mod(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    m=mod('pathelf','inspect-source-vhv-encoding.py');x=mod('pathuc','inspect-source-prop-tint.py');v=mod('pathvpk','inventory-source-map.py')
    c=m.ELF(ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so');u=x.emulator(c)
    c.check(0xf53295,'48 63 93 bc 09 00 00');c.check(0xf532b2,'48 8b 0c d0')
    table=c.rip(0xf532ab,'48 8d 05');assert table==c.rip(0xf5326e,'48 8d 05')
    pattern_format=c.cstring(c.rip(0xf532b6,'48 8d 15'));assert pattern_format==c.cstring(c.rip(0xf53279,'48 8d 15'))
    assert pattern_format=='models/weapons/customization/paints/%s/%s.vtf'
    surface_format=c.cstring(c.rip(0xf5309f,'48 8d 15'));assert surface_format=='models/weapons/customization/%s/%s_surface.vtf'
    folders=[c.cstring(struct.unpack('<Q',c.code(table+i*8,8))[0])for i in range(10)]
    p=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk')
    path=ROOT/'public/source/csgo-12426148/skins/paint-kits.json';original=path.read_bytes();catalog=json.loads(original);result=copy.deepcopy(catalog)
    obj=x.BASE+0x1000;value=x.BASE+0x5000;u.reg_write(UC_X86_REG_RBX,obj);cases=[];resolved={}
    def string(at):return bytes(u.mem_read(at,1024)).split(b'\0',1)[0].decode()
    for weapon in result['weapons']:
        for kit in weapon['finishes']:
            for ref in kit['textureReferences']:
                name=ref['sourceValue'];assert not name.startswith(('/', '\\'))and ':'not in name and name.lower()!='black'
                u.mem_write(value,name.encode()+b'\0');u.reg_write(UC_X86_REG_RAX,value);u.mem_write(obj+0x9bc,struct.pack('<I',kit['style']))
                u.emu_start(0xf53295,0xf532bf,count=40)
                args=[string(u.reg_read(reg))for reg in(UC_X86_REG_RDX,UC_X86_REG_RCX,UC_X86_REG_R8)]
                selected='materials/'+(args[0]%tuple(args[1:])).replace('\\','/').lower()
                assert selected in p.entries and selected in ref['candidates'],(kit['id'],selected,ref)
                cases.append({'weapon':weapon['weapon'],'paintKitId':int(kit['id']),'style':kit['style'],'field':ref['field'],
                    'sourceValue':name,'priorCandidates':list(ref['candidates']),'nativeFormatArguments':args,'selectedVpkPath':selected})
                ref['resolution']='unique';ref['candidates']=[selected];resolved[kit['id']+':'+ref['field']]=selected
    record={'format':'source-paint-paths-native-v1','client':c.identity(),'inputCatalogueSHA256':hashlib.sha256(original).hexdigest(),
        'styleDirectoryTable':{'address':hex(table),'directories':folders},'surfaceFormat':{'instruction':'0xf5309f','format':surface_format},
        'cases':cases,'resolved':resolved,'boundary':'Original indexed directory load and formatter arguments execute; host supplies snprintf ABI. All resulting paths are checked against original VPK directory and prior enumerated candidates. No original-client GPU comparison.'}
    OUT.mkdir(parents=True,exist_ok=True)
    (ROOT/'research/source-paint-paths.json').write_text(json.dumps(record,indent=2)+'\n')
    (OUT/'paint-kits.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':len(cases),'ambiguousReferencesResolved':sum(len(row['priorCandidates'])>1 for row in cases),'output':str(OUT/'paint-kits.json')}))
if __name__=='__main__':main()
