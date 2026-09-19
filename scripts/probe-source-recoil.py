"""Execute actual original 64-entry rifle recoil-table generation and lookup.
No weapon/player simulation is mutated. Item and ConVar values are fixed to
hash-checked original build defaults. The RNG calls execute original vstdlib.
"""
from pathlib import Path
import importlib.util,json,hashlib,struct
from unicorn.x86_const import *
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
d=load('damage','scripts/probe-source-damage.py');s=load('spread','scripts/probe-source-spread.py')
class NativeRecoil(d.OriginalDamage):
    def __init__(self):
        super().__init__();self.rng=s.NativeRandom();self.adapter=d.STOP+512
        self.u.mem_write(self.adapter,b'\xd9\x05'+struct.pack('<I',self.adapter+32)+b'\xc3')
        for p,name in [(0xca21e4,'_ZN20CUniformRandomStream7SetSeedEi'),(0xca22db,'_ZN20CUniformRandomStream11RandomFloatEff'),
                       (0xca230e,'_ZN20CUniformRandomStream11RandomFloatEff')]:assert self.external[p]==name
    def hook(self,u,at,size,data):
        super().hook(u,at,size,data)
        if at==0xca21e3:
            sp=u.reg_read(UC_X86_REG_ESP);seed=struct.unpack('<i',u.mem_read(sp+4,4))[0];self.rng.seed(seed)
            u.reg_write(UC_X86_REG_EIP,at+5)
        elif at in [0xca22da,0xca230d]:
            sp=u.reg_read(UC_X86_REG_ESP);lo,hi=struct.unpack('<2f',u.mem_read(sp+4,8));value=self.rng.random(lo,hi)
            self.floats(self.adapter+32,[value]);self.ints(sp-4,[at+5]);u.reg_write(UC_X86_REG_ESP,sp-4)
            u.reg_write(UC_X86_REG_EIP,self.adapter)
    def table(self,attrs,shots=4,factor=.75,variance=.55):
        self.reset();self.ints(d.F+0xc,[d.P]);self.ints(d.F-0xf8,[shots]);self.ints(d.F-0x118,[int(attrs['recoil seed'])])
        self.floats(d.F-0x10c,[factor]);self.floats(d.F-0x110,[variance]);self.floats(d.F-0x124,[0])
        self.u.mem_write(d.F-0xe1,b'\x01')
        for off,key in [(0xfc,'recoil angle'),(0xf4,'recoil angle variance'),(0x100,'recoil magnitude'),(0xf0,'recoil magnitude variance'),
                        (0xc8,'recoil angle alt'),(0xc0,'recoil angle variance alt'),(0xb8,'recoil magnitude alt'),(0xb0,'recoil magnitude variance alt')]:
            self.floats(d.F-off,[float(attrs[key])])
        self.run(0xca2199,[0xca23d0])
        values=struct.unpack('<256f',self.u.mem_read(d.P+4,1024))
        return [[dict(angle=values[mode*128+i*2],magnitude=values[mode*128+i*2+1])for i in range(64)]for mode in range(2)]

def main():
    engine=NativeRecoil();catalog=json.loads((ROOT/'research/source-items-catalog.json').read_text())
    source=next(r for r in catalog['sourceFilesRead']if r['path']=='scripts/items/items_game.txt')
    assert hashlib.sha256((ROOT/'.reference-assets/csgo-legacy/csgo'/source['path']).read_bytes()).hexdigest()==source['sha256']
    defaults={}
    for name,at in [('weapon_recoil_suppression_shots',0x452c9c),('weapon_recoil_suppression_factor',0x452cd3),('weapon_recoil_variance',0x452d15)]:
        assert engine.raw[at]==engine.raw[at-5]==0x68
        name_at=struct.unpack_from('<I',engine.raw,at+1)[0];value_at=struct.unpack_from('<I',engine.raw,at-4)[0]
        assert engine.raw[name_at:engine.raw.index(0,name_at)].decode()==name
        defaults[name]=float(engine.raw[value_at:engine.raw.index(0,value_at)].decode())
    rows=[]
    for weapon,prefab in [('ak47','weapon_ak47_prefab'),('m4a4','weapon_m4a1_prefab')]:
        attributes={};chain=[]
        def merge(name):
            p=catalog['prefabs'][name]
            for parent in p.get('prefab','').split():merge(parent)
            attributes.update(p.get('attributes',{}));chain.append(name)
        merge(prefab);assert attributes['is full auto']=='1'
        table=engine.table(attributes,int(defaults['weapon_recoil_suppression_shots']),defaults['weapon_recoil_suppression_factor'],defaults['weapon_recoil_variance'])
        rows.append(dict(weapon=weapon,prefabChain=chain,attributes={k:float(v)for k,v in attributes.items()if any(t in k for t in ['recoil','inaccuracy','spread','recovery','speed'])},table=table))
    report=dict(status='original_recoil_table_executed',sourceServerSha256=d.SHA,sourceVstdlibSha256=s.VSHA,sourceItemsSha256=source['sha256'],
                generator='0xca1a90',executedBlock=['0xca2199','0xca23d0'],lookup='0xca30e0',lookupIndex='mode*64 + (shotIndex & 63)',
                defaults=defaults,rows=rows,limits=['Original table only; player aim-punch velocity/decay and per-tick recovery remain separate state contracts.'])
    (ROOT/'output/tests/source-recoil-native.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'weapons':len(rows),'modes':4,'entries':256,'defaults':defaults}))
if __name__=='__main__':main()
