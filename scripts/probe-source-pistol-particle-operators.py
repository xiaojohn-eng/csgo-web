"""Execute original build 12426148 Radius Scale and equal-duration Alpha Fade Out.
The synthetic collection is four SIMD lanes; it does not replace instructions.
"""
import contextlib,io,runpy,struct,json
from pathlib import Path
from unicorn.x86_const import UC_X86_REG_ESP,UC_X86_REG_EBP,UC_X86_REG_EAX
with contextlib.redirect_stdout(io.StringIO()):
 s=runpy.run_path(str(Path(__file__).with_name('probe-source-pistol-particle-defaults.py')))
u=s['u'];BASE=0x21000000;u.mem_map(BASE,0x20000);OP=BASE;COL=BASE+0x1000
def wi(at,n):u.mem_write(at,struct.pack('<I',n))
def wf(at,n):u.mem_write(at,struct.pack('<f',n))
def lanes(at,values):u.mem_write(at,struct.pack('<4f',*values))
def call(at):
 stack=s['STACK']+0x800;u.mem_write(stack,struct.pack('<IIIfI',s['RET'],OP,COL,1.,0));u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(at,s['RET'],count=100000)
def buffer(field,initial=False):
 at=BASE+0x3000+field*0x100+(0x8000 if initial else 0)
 wi(COL+(0x1a0 if initial else 0xe0)+4*field,at);wi(COL+(0x200 if initial else 0x140)+4*field,4)
 return at
wi(COL+0x20,1);wi(COL+0x30,4)
life=buffer(1);creation=buffer(8);radius=buffer(3);initialRadius=buffer(3,True);alpha=buffer(7);initialAlpha=buffer(7,True)
rows=[]
for age in [0,.005,.01,.0125,.015,.0175,.02,.0225,.0249]:
 lanes(COL+0x10,[age]*4);lanes(life,[.025]*4);lanes(creation,[0]*4)
 lanes(initialRadius,[5,2,8,11]);lanes(radius,[5,2,8,11]);
 for off,value in [(0x58,0),(0x5c,1),(0x60,1),(0x64,.25),(0x6c,.5)]:wf(OP+off,value)
 u.mem_write(OP+0x68,b'\0');call(0xd2c0c0);call(0xd0e3d0)
 actualRadius=list(struct.unpack('<4f',u.mem_read(radius,16)))
 lanes(initialAlpha,[70/255,75/255,80/255,.2]);lanes(alpha,[70/255,75/255,80/255,.2])
 for off,value in [(0x58,.015),(0x5c,.015),(0x60,1),(0x64,.5)]:wf(OP+off,value)
 u.mem_write(OP+0x80,b'\0\1');call(0xd0b830);call(0xd07450)
 rows.append(dict(age=age,lifetime=.025,fadeDuration=.015,initialRadius=[5,2,8,11],radius=actualRadius,initialAlpha=[70/255,75/255,80/255,.2],alpha=list(struct.unpack('<4f',u.mem_read(alpha,16)))))
sheetObject=BASE+0x14000;sheetRecords=BASE+0x15000;frame=BASE+0x18000
wi(sheetObject+4,sheetRecords);wi(sheetObject+0x10,64)
for index in range(5):
 wi(sheetRecords+12*index,0x30000000+index*0x1000)
 u.mem_write(sheetRecords+12*index+4,struct.pack('<BBH',1,0,16))
wi(frame+8,sheetObject);u.reg_write(UC_X86_REG_EBP,frame)
u.emu_start(0xf63d22,0xf64296,count=10000)
sheetAliases=[]
for index in range(64):
 data=bytes(u.mem_read(sheetRecords+index*12,12));pointer,loop,alias,frameCount,duration=struct.unpack('<IBBHf',data)
 sheetAliases.append(dict(index=index,resolvedSequence=(pointer-0x30000000)//0x1000,clamp=bool(loop),aliased=bool(alias),frameCount=frameCount))
assert all(row['resolvedSequence']==0 and row['aliased']for row in sheetAliases[5:])
knots=BASE+0x1c000;values=knots+0x100;out0=knots+0x200;out1=out0+4;blend=out1+4
for i in range(16):wf(knots+i*4,i*32);wf(values+i*4,i)
sheetSamples=[]
for age in [0,.001,.003125,.005,.01,.015,.02,.024,.05,.075]:
 stack=s['STACK']+0x800;u.mem_write(stack,struct.pack('<IIffI',s['RET'],sheetObject,age,20*512,12));u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(0xd31ec0,s['RET'],count=10000)
 sample=(u.reg_read(UC_X86_REG_EAX)-0x30000000)//68
 u.mem_write(stack,struct.pack('<IIIIIfIIII',s['RET'],knots,values,16,512,float(sample),0,out0,out1,blend));u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(0xca2d00,s['RET'],count=10000)
 a,b,t=struct.unpack('<3f',u.mem_read(out0,12));sheetSamples.append(dict(age=age,sequence=12,resolvedSequence=0,lookupSample=sample,frame0=int(a),frame1=int(b),blend=t))
radiusRow=0x14cbe40+11*44
assert s['string'](s['word'](radiusRow))=='radius' and s['string'](s['word'](radiusRow+4))=='5'
emitterRows=[]
for system,fn,init,emit,tick in [('main','emit_instantaneously',0xd04af0,0xd037a0,.0075),('core','emit_continuously',0xd04190,0xd03490,.015)]:
 u.mem_write(OP,b'\0'*0x300);u.mem_write(COL,b'\0'*0x400);CTX=BASE+0x2000;u.mem_write(CTX,b'\0'*0x100)
 definition=next(e for e in s['graph']['elements']if e['name']=='weapon_muzzle_flash_pistol_'+system and e['type']=='DmeParticleSystemDefinition')
 element=next(e for e in s['graph']['elements']if e['id']==definition['attributes']['emitters'][0]['ref'])
 schema=next(o for o in s['result']if o['functionName']==fn)
 for field in schema['fields']:
  value=element['attributes'].get(field['name'],field['default'])
  if value is None:continue
  if field['nativeType']==3:wf(OP+field['offset'],float(value))
  elif field['nativeType']==2:u.mem_write(OP+field['offset'],struct.pack('<i',int(value)))
  elif field['nativeType']==4:u.mem_write(OP+field['offset'],bytes([int(value)]))
 # Post-unpack's second argument is a definition. Its max-particle field is
 # 0x11c; this synthetic allocation is reused as the collection afterwards.
 wi(COL+0x11c,120);call(0xd03f80 if system=='main'else 0xd04120)
 wi(COL+0x50,120);wf(COL+0x24,tick);wf(COL+0x34,tick);wf(COL+0x38,tick);births=buffer(8)
 stack=s['STACK']+0x800;u.mem_write(stack,struct.pack('<IIII',s['RET'],OP,COL,CTX));u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(init,s['RET'],count=10000)
 u.mem_write(stack,struct.pack('<IIIfI',s['RET'],OP,COL,1.,CTX));u.reg_write(UC_X86_REG_ESP,stack);u.emu_start(emit,s['RET'],count=10000)
 count=struct.unpack('<I',u.mem_read(COL+0x30,4))[0]
 assert 0<count<=120,(system,count)
 emitterRows.append(dict(system=system,init=hex(init),emit=hex(emit),firstTick=tick,count=count,births=list(struct.unpack('<'+'f'*count,u.mem_read(births,4*count)))))
report=dict(format='source-pistol-particle-native-operators-v1',clientSHA256=s['report']['clientSHA256'],
 methods={'radiusPostUnpack':'0xd2c0c0','radiusOperate':'0xd0e3d0','fadePostUnpack':'0xd0b830','fadeOperate':'0xd07450'},
 status='original-operators-executed',rows=rows,sheetAliases=sheetAliases,sheetSamples=sheetSamples,emitters=emitterRows,
 sheetSamplingMethods={'lookup':'0xd31ec0','interpolation':'0xca2d00','knots':'16 original fire-sheet equal-duration frames, 512 samples'},
 sheetAliasMethod={'start':'0xf63d22','stop':'0xf64296','input':'64 native records, defined sequences 0-4; original missing-sequence fixup block executed'},
 particleDefinitionRadius={'value':5,'rawRecordVA':hex(radiusRow),'nativeFieldName':s['string'](s['word'](radiusRow))},
 boundary='Native main radius/fade, both emitters, sheet alias fixup, sample lookup and interpolation are executed. Full collection scheduler, RNG, initializers and GPU shader are not executed.')
(s['OUT']/'native-operators.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
