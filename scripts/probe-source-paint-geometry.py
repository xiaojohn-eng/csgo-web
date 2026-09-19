"""Trace original paint_data UVScale/WeaponLength into the native transform scales."""
from pathlib import Path
import hashlib,importlib.util,json,struct,sys
from unicorn.x86_const import UC_X86_REG_RBX,UC_X86_REG_R12,UC_X86_REG_XMM0
ROOT=Path(__file__).resolve().parents[1]
def mod(name,file):
    s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/file);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def main():
    m=mod('geomelf','inspect-source-vhv-encoding.py');x=mod('geomuc','inspect-source-prop-tint.py');idx=mod('geomidx','source-binary-index.py')
    c=m.ELF(ROOT/'.reference-assets/csgo-legacy/csgo/bin/linux64/client_client.so');b=idx.open_binary(c.path)
    assert c.cstring(c.rip(0xe1bcaa,'48 8d 35'))=='UVScale'
    assert c.cstring(c.rip(0xe1bc8c,'48 8d 35'))=='WeaponLength'
    for at,data in [(0xe1bccf,'f3 41 0f 11 85 8c 01 00 00'),(0xcd662e,'f3 0f 10 83 8c 01 00 00'),(0xcd6636,'f3 0f 11 85 b4 fe ff ff'),
                    (0xf533b0,'f3 41 0f 10 44 24 74'),(0xf533b7,'f3 0f 11 83 84 00 00 00')]:c.check(at,data)
    # The frame's customization struct starts at -0x1c0; its +0x74 is -0x14c.
    start,size=b.function_of(0xcd665a)
    stores=b.frame_stores(start,size,-0x240)
    assert stores==[(0xcd654c,'mov','qword ptr [rbp - 0x240], rax')],stores
    c.check(0xcd653a,'48 8d 85 40 fe ff ff')
    items_path=ROOT/'research/source-items-catalog.json';items=json.loads(items_path.read_text())
    raw_path=ROOT/'.reference-assets/csgo-legacy/csgo/scripts/items/items_game.txt';raw=raw_path.read_bytes()
    identity=next(r for r in items['sourceFilesRead'] if r['path']=='scripts/items/items_game.txt')
    assert hashlib.sha256(raw).hexdigest()==identity['sha256']
    catalog=json.loads((ROOT/'public/source/csgo-12426148/skins/paint-kits.json').read_text())
    u=x.emulator(c);obj=x.BASE+0x1000;u.reg_write(UC_X86_REG_RBX,obj);u.reg_write(UC_X86_REG_R12,x.BASE+0x5000)
    geometry={};cases=[]
    for weapon in catalog['weapons']:
        item=next(w for w in items['weapons']if w['name']==weapon['weapon'])
        paint=item['resolvedDefinition']['paint_data'];assert len(paint)==1
        p=next(iter(paint.values()));row={'uvScale':float(p['uvscale']),'weaponLength':float(p['weaponlength']),
            'viewmodelDimension':int(p['viewmodeldim']),'worldDimension':int(p['worlddim']),'material':p['name']}
        geometry[weapon['weapon']]=row
        for kit in weapon['finishes']:
            u.mem_write(obj+0x80,struct.pack('<2f',row['weaponLength'],row['uvScale']))
            u.mem_write(obj+0xc4c,bytes([kit['ignoreWeaponSizeScale']]))
            u.mem_write(obj+0xa08,struct.pack('<4f',kit['patternScale'],.13,.37,19))
            u.mem_write(obj+0xa18,struct.pack('<4f',1.7,.29,.61,87))
            u.mem_write(obj+0xa28,struct.pack('<4f',1.6,.11,.83,273))
            u.emu_start(0xf52510 if kit['style']in(3,6)else 0xf522ce,0xf52352,count=100)
            pattern=struct.unpack('<d',struct.pack('<Q',u.reg_read(UC_X86_REG_XMM0)&0xffffffffffffffff))[0]
            wear,grunge=struct.unpack('<2f',u.mem_read(x.BASE+0xe000-0x78,8))
            cases.append({'weapon':weapon['weapon'],'paintKitId':int(kit['id']),'style':kit['style'],'ignoreWeaponSizeScale':kit['ignoreWeaponSizeScale'],
                'inputScales':[kit['patternScale'],1.7,1.6],'nativeScaled':[pattern,grunge,wear]})
    output={'format':'source-paint-geometry-native-v1','client':c.identity(),'itemsGame':identity,
        'chain':['schema UVScale e1bcaa -> paintmaterial+18c e1bccf','caller cd662e -> frame-14c, customization struct+74','constructor f533b0/f533b7 -> object+84',
                 'generator f522ce/f52510 -> factor, mulss f52310/f52325/f52331'],
        'nonProjectedFactor':'ignore?1:UVScale','projectedStyle36Factor':'ignore?1:float32(WeaponLength*float32(1/36))',
        'weaponLengthFactor':struct.unpack('<f',c.code(0x193f470,4))[0],
        'weapons':geometry,'cases':cases,'boundary':'Original native multiplication and branches; original schema values supplied from verified items_game resolution. Formatting/matrices have their separate original parser receipt.'}
    (ROOT/'research/source-paint-geometry.json').write_text(json.dumps(output,indent=2)+'\n')
    (ROOT/'game/source-paint-geometry-data.ts').write_text('// Generated from original items_game and verified native field chain by scripts/probe-source-paint-geometry.py.\nexport const SOURCE_PAINT_GEOMETRY = '+json.dumps(geometry,separators=(',',':'))+' as const;\n')
    print(json.dumps({'cases':len(cases),'weapons':geometry}))
if __name__=='__main__':main()
