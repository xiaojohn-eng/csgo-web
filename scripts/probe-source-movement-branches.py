"""Read bounded movement evidence in one reviewed App740 ELF; never execute it.

This is an instruction/constant receipt, not a decompiler or proof of all CS
movement branches. Ordinary unscoped, non-walking, no-stamina paths are described
in docs/source-player-movement.md. Unknown binaries fail closed.
"""
from pathlib import Path
import hashlib,json,struct
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'.reference-assets/csgo-legacy/csgo/bin/server.so';raw=p.read_bytes()
sha=hashlib.sha256(raw).hexdigest()
assert sha=='7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386'
table=struct.unpack_from('<I',raw,32)[0];width,count,ni=struct.unpack_from('<HHH',raw,46)
sections=[struct.unpack_from('<10I',raw,table+i*width) for i in range(count)]
def offset(a):return next(s[4]+a-s[3] for s in sections if s[1]!=8 and s[3]<=a<s[3]+s[5])
def uint(a):return struct.unpack_from('<I',raw,offset(a))[0]
def cstring(a):o=offset(a);return raw[o:raw.index(0,o)].decode()
def span(a,n):return raw[offset(a):offset(a)+n]
base=0x12a2184;assert uint(base-8)==0
rtti=uint(base-4);assert cstring(uint(rtti+4))=='15CCSGameMovement'
assert uint(base+0x6c)==0xba1330
floats={name:{'va':hex(a),'value':struct.unpack_from('<f',raw,offset(a))[0]} for name,a in
 [('accelerationBase',0x12c4e50),('duckMultiplier',0x12c4e3c),('walkMultiplier',0x12c4e38),('one',0x118ec50)]}
assert floats['accelerationBase']['value']==250
assert abs(floats['duckMultiplier']['value']-.34)<1e-7
# Exact encodings verify instruction operands at each reviewed path boundary.
checks=[(0xba13d0,'f30f5f6510','maxss wishspeed into 250 base'),
 (0xba1702,'f30f5e55b0','divide weapon maxspeed by 250'),
 (0xba1707,'f30f5d55c0','clamp weapon ratio to one'),
 (0xba18dc,'f30f5dc8','min acceleration ratio with duck .34'),
 (0xba18f3,'f30f59d1','multiply 250 base by selected acceleration ratio'),
 (0xba1a3e,'f30f594d14','multiply dt by accel'),
 (0xba1a46,'f30f59ca','multiply acceleration by selected speed base'),
 (0xba1a4a,'f30f59c1','multiply by surface friction'),
 (0xba75cc,'f30f5cc1','duck crop (.34 - 1)'),
 (0xba75d0,'f30f59450c','multiply by duck fraction'),
 (0xba75d5,'f30f58c1','add 1 before cropping movement')]
verified=[]
for a,expected,meaning in checks:
 actual=span(a,len(bytes.fromhex(expected))).hex()
 assert actual==expected,(hex(a),expected,actual)
 verified.append({'va':hex(a),'bytes':actual,'meaning':meaning})
result={'sourceServerSha256':sha,'method':'Static ELF32 instruction operands and CCSGameMovement RTTI vtable; native code never loaded',
 'vtableVA':hex(base),'rttiVA':hex(rtti),'class':'CCSGameMovement','accelerateSlot':'0x6c','accelerateVA':'0xba1330',
 'duckCropVA':'0xba7580','floats':floats,'checks':verified,
 'ordinaryBranch':{'base':'max(250, wishspeed)','weaponRatio':'min(weaponMaxSpeed / 250, 1)',
  'standingAccelerationSpeed':'base * weaponRatio','fullDuckAccelerationSpeed':'base * .34',
  'fullDuckWishCrop':'.34','conditions':'ordinary unscoped weapon, not IN_SPEED, no heavy armor, no stamina modifier'},
 'limits':['Static branch interpretation is not live engine input/output trace comparison.',
 'Weapon zoom mode, heavy armor, walking near-goal taper, stamina, surface friction variations and gradual duck fraction are excluded.'],
 'sdk':{'commit':'b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474','files':{
  name:hashlib.sha256((ROOT/'output/source-sdk-player'/name).read_bytes()).hexdigest() for name in
  ['gamemovement.cpp','gamemovement.h','coordsize.h']}}}
(ROOT/'output/tests/source-movement-branches.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
