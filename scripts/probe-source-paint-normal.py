"""Execute the installed client's original finish $bumpmap assignment guard."""
from pathlib import Path
import hashlib,importlib.util,json,re,struct,sys
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_RBX,UC_X86_REG_R13,UC_X86_REG_RDI,UC_X86_REG_RSI,UC_X86_REG_RDX
ROOT=Path(__file__).resolve().parents[1]
def mod(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    m=mod('normalelf','inspect-source-vhv-encoding.py');x=mod('normaluc','inspect-source-prop-tint.py');v=mod('normalvpk','inventory-source-map.py')
    c=m.ELF(ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so')
    c.check(0xf52721,'41 89 f5');c.check(0xf528e9,'45 84 ed');c.check(0xf528ee,'8b 83 bc 09 00 00')
    c.check(0xf528fc,'80 bb b8 08 00 00 00');assert c.cstring(c.rip(0xf52910,'48 8d 35'))=='$bumpmap'
    u=x.emulator(c);obj=x.BASE+0x1000;material=x.BASE+0x5000;u.reg_write(UC_X86_REG_RBX,obj)
    u.mem_write(x.BASE+0xe000-0x38,struct.pack('<Q',material));captured=[]
    def string(at):return bytes(u.mem_read(at,1024)).split(b'\0',1)[0].decode()
    def hook(uc,at,size,data):
        if at==0xf52917:
            captured.append({'materialMatches':uc.reg_read(UC_X86_REG_RDI)==material,
                'key':string(uc.reg_read(UC_X86_REG_RSI)),'value':string(uc.reg_read(UC_X86_REG_RDX))});uc.emu_stop()
    u.hook_add(UC_HOOK_CODE,hook)
    catalog=json.loads((ROOT/'public/source/csgo-12426148/skins/paint-kits.json').read_text());cases=[]
    for weapon in catalog['weapons']:
        for kit in weapon['finishes']:
            refs=[r for r in kit['textureReferences']if r['field']=='normal']
            if not refs:continue
            assert kit['style']in(7,8,9)
            # The guard receives the resolved path stored by the material generator;
            # path resolution is recorded by the catalogue, not emulated by this slice.
            path=refs[0]['sourceValue']
            for flag in (0,1):
                captured.clear();u.reg_write(UC_X86_REG_R13,flag);u.mem_write(obj+0x9bc,struct.pack('<I',kit['style']))
                u.mem_write(obj+0x8b8,path.encode()+b'\0');u.emu_start(0xf528e9,0xf5291c,count=40)
                assert bool(captured)==bool(flag)
                cases.append({'weapon':weapon['weapon'],'paintKitId':int(kit['id']),'style':kit['style'],'cloneFlag':flag,'normal':path,'nativeSetString':list(captured)})
    for style,path in ((6,'normal_control'),(7,''),(10,'normal_control')):
        captured.clear();u.reg_write(UC_X86_REG_R13,1);u.mem_write(obj+0x9bc,struct.pack('<I',style));u.mem_write(obj+0x8b8,path.encode()+b'\0')
        u.emu_start(0xf528e9,0xf5291c,count=40);assert not captured
    p=v.VPKIndex(ROOT/'.reference-assets/csgo-legacy/csgo/pak01_dir.vpk');materials={}
    for weapon,folder in [('weapon_ak47','rif_ak47'),('weapon_m4a1','rif_m4a1'),('weapon_awp','snip_awp'),('weapon_glock','pist_glock18'),('weapon_usp_silencer','pist_223'),('weapon_deagle','pist_deagle')]:
        paths=[name for name in p.entries if name.startswith('materials/models/weapons/v_models/'+folder+'/')and name.endswith('.vmt')]
        assert len(paths)==1;path=paths[0];raw=p.read(path);text=raw.decode('utf8');values=dict(re.findall(r'"(\$[^"\n]+)"\s*"([^"\n]*)"',text))
        assert values['$basemapalphaphongmask']=='1'
        materials[weapon]={'path':path,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'basemapAlphaPhongMask':1,
            'envmap':values['$envmap'],'envmapFresnel':int(values['$envmapfresnel']),'envmapTint':[float(n)for n in values['$envmaptint'].strip('[]').split()]}
    receipt={'format':'source-paint-normal-native-v1','client':c.identity(),'entry':'0xf52710 virtual material clone; second argument esi -> r13d at 0xf52721',
        'guard':'0xf528e9..0xf5291c; nonzero clone flag AND style 7/8/9 AND nonempty object+0x8b8 -> KeyValues::SetString($bumpmap,path)',
        'cases':cases,'negativeControls':3,'weaponMaterials':materials,
        'boundary':'Original conditional and SetString arguments executed. Hook intercepts external KeyValues call. Native path formatting, actual client invocation and original rendered output are not emulated by this receipt.'}
    (ROOT/'research/source-paint-normal.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'normalFinishes':len(cases)//2,'cases':len(cases),'weaponMaterials':materials}))
if __name__=='__main__':main()
