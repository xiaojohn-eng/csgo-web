"""Read-only original child initializer probe. Outputs go only to output/fidelity-character.
Run with native dependencies on PYTHONPATH and [system] [count] [duration] [instant].
The synthetic control point is identity; failed native calls stay errors in the report.
"""
import importlib.util,json,struct,hashlib,math,sys,os
from pathlib import Path
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_XMM0,UC_X86_REG_EIP
spec=importlib.util.spec_from_file_location('particle_native',Path(__file__).with_name('source-pistol-particles-native.py'));native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
c=native.NativeClient();root=native.ROOT
system=sys.argv[1] if len(sys.argv)>1 else 'weapon_muzzle_flash_assualtrifle_flame'
count=int(sys.argv[2]) if len(sys.argv)>2 else 9
duration=float(sys.argv[3]) if len(sys.argv)>3 else .0075
instant=len(sys.argv)>4 and sys.argv[4]=='instant'
data=Path(os.environ.get('PARTICLE_GRAPH_DIR',str(root/'.reference-assets/source-exports/muzzle-flash-particles')))
out=root/'output/fidelity-character/native-child-initializers'
out.mkdir(parents=True,exist_ok=True)
graph=json.loads((data/'graph.json').read_text());schemas=json.loads((data/'native-defaults.json').read_text())['operators'];elements={e['id']:e for e in graph['elements']}
table=bytes(c.u.mem_read(0x14c7da0,4096*4));(out/'original-random-floats.bin').write_bytes(table)
COL=c.arena;DEF=COL+0x1000;CP=COL+0x2000;CTX=COL+0x3000;BUFFERS=COL+0x10000;OPS=COL+0x40000
def getfloats(at,n):return list(struct.unpack('<'+'f'*n,c.u.mem_read(at,n*4)))
def identity_pow(c):
 sp=c.u.reg_read(UC_X86_REG_ESP);base,exponent=getfloats(sp+4,2);c.return_float(base**exponent)
for at in [0xd000b9,0xcfffc3,0xcf5151]:c.adapters[at]=identity_pow
c.adapters[0xd466be]=lambda c:c.return_float(math.acos(getfloats(c.u.reg_read(UC_X86_REG_ESP)+4,1)[0]))
c.adapters[0xd466e0]=lambda c:c.return_float(getfloats(c.u.reg_read(UC_X86_REG_ESP)+4,1)[0]**(1/3))
# A block may name an operator by the lowercase class-style spelling its authoring tool
# wrote while this build registers the display name; the same normalised, unique match the
# runtime uses resolves it here too, and an ambiguous name still fails closed.
def schemaFor(name):
 exact=next((s for s in schemas if s['functionName']==name),None)
 if exact:return exact
 normalise=lambda value:''.join(ch for ch in value.lower() if ch not in ' _')
 matches=[s for s in schemas if normalise(s['functionName'])==normalise(name)]
 assert len(matches)==1,('ambiguous original operator name',name,[m['functionName'] for m in matches])
 return matches[0]
def setup(element,number):
 name=element['attributes']['functionName'];schema=schemaFor(name);at=OPS+number*0x400
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
 c.u.mem_write(at+0x3c,b'\1');c.call(c.read(vt),[at,DEF])
 return at,vt,name,schema['functionName']
results=[]
for seed in [0,17,4090]:
 c.u.mem_write(COL,b'\0'*0x1000);c.u.mem_write(CP,b'\0'*0x100);c.integer(COL+0x48,DEF);c.integer(COL+0x64,1);c.integer(COL+0x68,CP)
 if os.environ.get('PARTICLE_CACHED_COLOR'):
  c.u.mem_write(COL+0x60,bytes([int(x)for x in os.environ['PARTICLE_CACHED_COLOR'].split(',')]+[255]))
 c.floating(CP+0x18,1);c.floating(CP+0x34,-1);c.floating(CP+0x2c,1)
 c.integer(COL+0x30,count);c.integer(COL+0x20,(count+3)//4);c.integer(COL+0x348,seed)
 c.floating(COL+0x24,1/30);c.floating(COL+0x34,duration);c.floating(COL+0x38,1/30)
 for field in range(24):
  ptr=BUFFERS+field*0x400;c.u.mem_write(ptr,b'\0'*0x400);c.integer(COL+0xe0+field*4,ptr);c.integer(COL+0x140+field*4,12 if field in [0,2,6]else 4)
 # The original seeds field 8 with each particle's own creation time, which is what the
 # block's scalar remaps read; without it they would all read zero.
 increment=duration/count
 for i in range(count):
  c.floating(BUFFERS+8*0x400+i*4,min(duration,increment*(i+1)))
 systemElement=next(e for e in graph['elements']if e['name']==system and e['type']=='DmeParticleSystemDefinition');rows=[]
 for i,reference in enumerate(systemElement['attributes']['initializers']):
  element=elements[reference['ref']]
  if os.environ.get('PARTICLE_ONLY_INITIALIZER') and element['attributes']['functionName']!=os.environ['PARTICLE_ONLY_INITIALIZER']:continue
  before=c.read(COL+0x344)
  at,vt,requested,canonical=setup(element,i)
  if canonical=='Color Random' and os.environ.get('PARTICLE_COLOR_TINT') is not None:
   field=next(f for f in schemaFor(canonical)['fields'] if f['name']=='tint_perc');c.floating(at+field['offset'],float(os.environ['PARTICLE_COLOR_TINT']))
  if os.environ.get('PARTICLE_RING_THICKNESS') is not None and canonical=='Position Along Ring':
   field=next(f for f in schemaFor(canonical)['fields'] if f['name']=='thickness');c.floating(at+field['offset'],float(os.environ['PARTICLE_RING_THICKNESS']))
  try:c.call(0xd444d0,[at,COL,0,count,0xffffffff,CTX])
  except Exception as error:rows.append(dict(requested=requested,canonical=canonical,error=repr(error)+' at '+hex(c.u.reg_read(UC_X86_REG_EIP))));continue
  fields={str(field):getfloats(c.read(COL+0xe0+field*4),count)for field in [1,2,3,4,7,8,9]}
  for field in [0,2,6]:
   ptr=c.read(COL+0xe0+field*4);fields[str(field)]=[[getfloats(ptr+((i//4)*12+channel*4+i%4)*4,1)[0]for channel in range(3)]for i in range(count)]
  rows.append(dict(name=canonical,requested=requested,initializer=hex(c.read(vt+0x70)),randomBefore=before,
   randomAfter=c.read(COL+0x344),fields=fields))
 results.append(dict(system=system,seed=seed,count=count,operators=rows))
report=dict(format='source-muzzle-particle-initializers-native-v1',clientSHA256=c.sha,
 status='original-initializers-executed-with-errors' if any('error' in op for case in results for op in case['operators']) else 'original-initializers-executed',dispatchMethod='0xd444d0',system=system,count=count,
 duration=duration,emitter='instant' if instant else 'continuous',originalRandomTable=dict(address='0x14c7da0',count=4096,
  sha256=hashlib.sha256(table).hexdigest()),cases=results)
(out/(system+('-cached-'+os.environ['PARTICLE_CACHED_COLOR'] if 'PARTICLE_CACHED_COLOR'in os.environ else '')+('-tint-'+os.environ['PARTICLE_COLOR_TINT'] if 'PARTICLE_COLOR_TINT'in os.environ else '')+('-ring-'+os.environ['PARTICLE_RING_THICKNESS'] if 'PARTICLE_RING_THICKNESS'in os.environ else '')+'.json')).write_text(json.dumps(report,indent=1))
print('wrote',out/(system+'.json'),'systems',len(results),'operators',[len(case['operators'])for case in results])
