"""Execute the original scalar initializer path and preserve original RNG data.
Main(4)/core(8) take the <=15 scalar branch in 0xd444d0.
"""
import importlib.util,json,struct,hashlib,math
from pathlib import Path
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_XMM0
spec=importlib.util.spec_from_file_location('particle_native',Path(__file__).with_name('source-pistol-particles-native.py'));native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
c=native.NativeClient();root=native.ROOT;data=root/'.reference-assets/source-exports/pistol-particles';out=root/'.reference-assets/source-exports/pistol-particles-r2';out.mkdir(exist_ok=True)
graph=json.loads((data/'graph.json').read_text());schemas=json.loads((data/'native-defaults.json').read_text())['operators'];elements={e['id']:e for e in graph['elements']};emitters={e['system']:e for e in json.loads((data/'native-operators.json').read_text())['emitters']}
table=bytes(c.u.mem_read(0x14c7da0,4096*4));(out/'original-random-floats.bin').write_bytes(table)
COL=c.arena;DEF=COL+0x1000;CP=COL+0x2000;CTX=COL+0x3000;BUFFERS=COL+0x10000;OPS=COL+0x40000
def getfloats(at,n):return list(struct.unpack('<'+'f'*n,c.u.mem_read(at,n*4)))
def identity_pow(c):
 sp=c.u.reg_read(UC_X86_REG_ESP);base,exponent=getfloats(sp+4,2);assert exponent==1,(base,exponent);c.return_float(base)
for at in [0xd000b9,0xcfffc3,0xcf5151]:c.adapters[at]=identity_pow
c.adapters[0xd466be]=lambda c:c.return_float(math.acos(getfloats(c.u.reg_read(UC_X86_REG_ESP)+4,1)[0]))
c.adapters[0xd466e0]=lambda c:c.return_float(getfloats(c.u.reg_read(UC_X86_REG_ESP)+4,1)[0]**(1/3))
def setup(element,number):
 name=element['attributes']['functionName'];schema=next(s for s in schemas if s['functionName']==name);at=OPS+number*0x400
 c.u.mem_write(at,b'\0'*0x400)
 assembly=c.disasm(int(schema['factory'],16),80)
 vt=next(int(i.op_str.split(', ')[1],16)for i in assembly if i.mnemonic=='mov'and i.op_str.startswith('dword ptr [eax], 0x'))
 c.integer(at,vt)
 for field in schema['fields']:
  value=element['attributes'].get(field['name'],field['default']);address=at+field['offset']
  if value is None:continue
  if field['nativeType']==2:c.integer(address,int(value))
  elif field['nativeType']==3:c.floating(address,float(value))
  elif field['nativeType']==4:c.u.mem_write(address,bytes([int(value)]))
  elif field['nativeType']in [8,10,11]:
   vector=[float(x)for x in value.split()]if isinstance(value,str)else value
   c.u.mem_write(address,bytes(int(x)for x in vector)if field['nativeType']==8 else struct.pack('<'+'f'*len(vector),*vector))
 # Original constant strength mode: no fade/time modulation in this PCF.
 c.u.mem_write(at+0x3c,b'\1');c.call(c.read(vt),[at,DEF])
 return at,vt
results=[]
for seed in [0,17,4090]:
 for system,count in [('main',4),('core',8)]:
  c.u.mem_write(COL,b'\0'*0x1000);c.u.mem_write(CP,b'\0'*0x100);c.integer(COL+0x48,DEF);c.integer(COL+0x64,1);c.integer(COL+0x68,CP);c.integer(COL+0x30,count);c.integer(COL+0x20,(count+3)//4);c.integer(COL+0x348,seed)
  c.floating(COL+0x34,.0075 if system=='main'else .015);c.floating(COL+0x38,.0075 if system=='main'else .015)
  # Original CP matrix 0xd46a50 uses columns forward, -right, up.
  # Native identity basis gives +X forward in Source units.
  for offset,value in [(0x18,1),(0x34,-1),(0x2c,1)]:c.floating(CP+offset,value)
  for field in range(24):
   ptr=BUFFERS+field*0x400;c.u.mem_write(ptr,b'\0'*0x400);c.integer(COL+0xe0+field*4,ptr);c.integer(COL+0x140+field*4,12 if field in [0,2,6]else 4)
  for i,birth in enumerate(emitters[system]['births']):
   c.floating(BUFFERS+8*0x400+i*4,birth);c.floating(BUFFERS+3*0x400+i*4,5)
   for channel in range(3):c.floating(BUFFERS+6*0x400+((i//4)*12+channel*4+i%4)*4,1)
  systemElement=next(e for e in graph['elements']if e['name']=='weapon_muzzle_flash_pistol_'+system and e['type']=='DmeParticleSystemDefinition');rows=[]
  for i,reference in enumerate(systemElement['attributes']['initializers']):
   element=elements[reference['ref']];name=element['attributes']['functionName']
   if name not in ['Sequence Random','Rotation Random','Lifetime Random','Alpha Random','Position Within Sphere Random','Color Random','Remap Scalar to Vector','Remap Initial Scalar']:continue
   at,vt=setup(element,i);before=c.read(COL+0x344)
   try:c.call(0xd444d0,[at,COL,0,count,0xffffffff,CTX])
   except Exception:
    from unicorn.x86_const import UC_X86_REG_EIP
    print('FAILED_INITIALIZER',system,name,hex(c.u.reg_read(UC_X86_REG_EIP)));raise
   fields={str(field):getfloats(c.read(COL+0xe0+field*4),count)for field in [1,3,4,7,8,9]}
   for field in [0,2,6]:
    ptr=c.read(COL+0xe0+field*4);fields[str(field)]=[[getfloats(ptr+((i//4)*12+channel*4+i%4)*4,1)[0]for channel in range(3)]for i in range(count)]
   rows.append(dict(name=name,initializer=hex(c.read(vt+0x70)),randomBefore=before,randomAfter=c.read(COL+0x344),fields=fields))
  fadeDurations=[]
  if system=='core':
   fadeElement=next(elements[r['ref']]for r in systemElement['attributes']['operators']if elements[r['ref']]['attributes']['functionName']=='Alpha Fade Out Random')
   fade,vt=setup(fadeElement,10);c.integer(COL+0x34c,2*17)
   c.u.mem_write(COL+0x10,struct.pack('<4f',*[.015]*4))
   initialAlpha=BUFFERS+0x20000;c.u.mem_write(initialAlpha,bytes(c.u.mem_read(BUFFERS+7*0x400,count*4)));c.integer(COL+0x1a0+7*4,initialAlpha);c.integer(COL+0x200+7*4,4)
   for i in range(count):c.integer(BUFFERS+11*0x400+i*4,(seed+i)&4095)
   def captureFade(c):fadeDurations.extend(struct.unpack('<4f',c.u.reg_read(UC_X86_REG_XMM0).to_bytes(16,'little')))
   c.adapters[0xd2d0e6]=captureFade
   c.call(c.read(vt+0x24),[fade,COL,0x3f800000,CTX]);del c.adapters[0xd2d0e6]
   assert len(fadeDurations)==count
  results.append(dict(system=system,seed=seed,count=count,operators=rows,fadeDurations=fadeDurations))
report=dict(format='source-pistol-particle-initializers-native-r2',clientSHA256=c.sha,status='original-scalar-initializers-executed',dispatchMethod='0xd444d0',scalarThreshold=15,fadeMethod='0xd2cee0',fadeDurationCapture='0xd2d0e6',nativeParticleIDBlock='0xd45bc4..0xd45bd8',
 originalRandomTable=dict(address='0x14c7da0',count=4096,bytes=len(table),sha256=hashlib.sha256(table).hexdigest()),cases=results,
 boundary='All main/core scalar initializers executed. Collection seed and counter supplied explicitly; original collection seed assignment and simulation/render scheduling remain separate. CP position/orientation are identity in Source units; births come from the independent native emitter receipt.',adapters=['powf exponent 1 identity via x87 return trampoline','acosf and cbrtf host libm, only sphere position with radius zero uses these results','constant-strength flag for this PCF','original default radius 5 and color white','identity CP basis and supplied original emitter births'])
payload=(json.dumps(report,indent=2)+'\n').encode();(out/'native-initializers.json').write_bytes(payload)
print(json.dumps(dict(sha256=hashlib.sha256(payload).hexdigest(),randomTable=report['originalRandomTable'],cases=[dict(system=x['system'],seed=x['seed'],randomEnd=x['operators'][-1]['randomAfter'])for x in results]),indent=2))
