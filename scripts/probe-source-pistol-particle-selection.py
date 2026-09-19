"""Execute original first/third-person muzzle system getters against local items.
All output is new r2 evidence; the r1 delivery remains byte-for-byte untouched.
"""
import importlib.util,re,json,hashlib,struct
from pathlib import Path
spec=importlib.util.spec_from_file_location('particle_native',Path(__file__).with_name('source-pistol-particles-native.py'));native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
c=native.NativeClient();root=native.ROOT;path=root/'.reference-assets/csgo-legacy/csgo/scripts/items/items_game.txt';raw=path.read_bytes()
tokens=[m.group()for m in re.finditer(r'"(?:\\.|[^"\\])*"|\{|\}|//[^\n]*',raw.decode('utf-8-sig'))if not m.group().startswith('//')]
def block(name):
 start=tokens.index('"'+name+'"')+1;assert tokens[start]=='{';depth=0
 for end in range(start,len(tokens)):
  if tokens[end]=='{':depth+=1
  elif tokens[end]=='}':
   depth-=1
   if depth==0:break
 return tokens[start:end+1]
def fields(name,seen=()):
 assert name not in seen;b=block(name);result={}
 for i in range(len(b)-1):
  if b[i]=='"prefab"':
   for parent in b[i+1].strip('"').split():result.update(fields(parent,seen+(name,)))
 for i in range(len(b)-1):
  key=b[i].strip('"')
  if key.startswith('muzzle_flash_effect_')or key=='has silencer':result[key]=b[i+1].strip('"')
 return result
weapon=c.arena;vt=weapon+0x4000;info=weapon+0x5000;item=weapon+0x6000;definition=weapon+0x7000;visual=weapon+0x8000;strings=weapon+0x9000
c.integer(weapon,vt);c.integer(vt+0x83c,0x5db720)
for slot,addr in [(0x840,c.arena+0xf0000),(0x830,c.arena+0xf0100),(0x524,c.arena+0xf0200)]:c.integer(vt+slot,addr)
c.adapters[c.arena+0xf0100]=lambda c:c.return_value(info)
c.adapters[c.arena+0xf0200]=lambda c:c.return_value(item-0x40)
c.adapters[0x6709f0]=lambda c:c.return_value(definition)
c.u.mem_write(item+0x208,b'\1');c.integer(definition+0x128,visual)
records=[]
for name in ['glock','usp_silencer','deagle']:
 source=fields('weapon_'+name+'_prefab');hasSilencer=source.get('has silencer','0')=='1'
 c.adapters[c.arena+0xf0000]=lambda c:c.return_value(int(hasSilencer))
 for offset,key in [(0x178,'1st_person'),(0x17c,'1st_person_alt'),(0x180,'3rd_person'),(0x184,'3rd_person_alt')]:
  value=source.get('muzzle_flash_effect_'+key);at=strings+offset*4
  c.integer(visual+offset,at if value is not None else 0)
  if value is not None:c.u.mem_write(at,value.encode()+b'\0')
 for attached in [False,True]:
  if attached and not hasSilencer:continue
  c.u.mem_write(weapon+0x329d,bytes([int(attached)]))
  for perspective,fn in [('first',0x5e11f0),('third',0x5e1170)]:
   address=c.call(fn,[weapon]);records.append(dict(weapon=name,hasSilencer=hasSilencer,silencerAttached=attached,perspective=perspective,method=hex(fn),system=c.string(address),
    returnedLegacyFallback=address in [info+0x83c,info+0x88c],resolvedItemFields=source))
assert c.string(0x1049fa6)==''
report=dict(format='source-pistol-particle-selection-native-r2',clientSHA256=c.sha,itemsSHA256=hashlib.sha256(raw).hexdigest(),status='original-getters-executed',cases=records,
 sourceMapping={'first':'visuals +0x178 / alt +0x17c','third':'visuals +0x180 / alt +0x184','legacyDefaults':'0x5c92b6..0x5c930a reads MuzzleFlashEffect_1stPerson/3rdPerson with empty-string default 0x1049fa6; buffers +0x83c/+0x88c'},
 adapters=['has-silencer from resolved local items','weapon-info allocation with parsed empty legacy defaults','item view and definition lookup'],
 boundary='Original system/alt getters and attached getter execute unchanged. Full final renderer trigger and legacy weapon-info loading are not emulated here.')
out=root/'.reference-assets/source-exports/pistol-particles-r2';out.mkdir(exist_ok=True);payload=(json.dumps(report,indent=2)+'\n').encode();(out/'native-selection.json').write_bytes(payload)
print(json.dumps(dict(cases=[{k:x[k]for k in ['weapon','silencerAttached','perspective','system','returnedLegacyFallback']}for x in records],sha256=hashlib.sha256(payload).hexdigest()),indent=2))
