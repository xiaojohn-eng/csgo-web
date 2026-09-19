"""Execute the original collection Simulate method with empty operator lists.
Timing and minimum-rendered-frames branches are original machine instructions;
this does not claim the game trigger or allocator/renderer have been emulated.
"""
import importlib.util,json,struct,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('particle_native',Path(__file__).with_name('source-pistol-particles-native.py'));native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
c=native.NativeClient();COL=c.arena;DEF=COL+0x1000;KILL=COL+0x2000
f=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
f32=lambda at:struct.unpack('<f',c.u.mem_read(at,4))[0]
# Relocated profiling globals are not part of particle simulation.
c.integer(0x100c,0);c.integer(0x1010,0)
rows=[]
for name,tick in [('main',.0075),('core',.015)]:
 for deltas in [[0,.016,.016,.016],[.050,.050,.050],[.005]*5,[.001]*4,[.12]*4]:
  c.u.mem_write(COL,b'\0'*0x3000);c.integer(COL+0x48,DEF);c.integer(COL+0x334,2);c.integer(COL+0x374,KILL)
  c.floating(COL+0x28,1e23);c.floating(COL+0x38,.05)
  c.floating(DEF+0xdc,.1);c.floating(DEF+0xe0,tick);c.floating(DEF+0xe4,tick);c.integer(DEF+0xec,1);c.floating(DEF+0x130,1e9)
  steps=[]
  for dt in deltas:
   before=f32(COL+0x24);counter=c.read(COL+0x33c)
   c.call(0xd481a0,[COL,f(dt)],count=200000)
   steps.append(dict(inputDelta=dt,before=before,after=f32(COL+0x24),previousTime=f32(COL+0x28),simulatedDelta=f32(COL+0x34),previousDelta=f32(COL+0x38),gateBefore=counter,gateAfter=c.read(COL+0x33c)))
  rows.append(dict(system=name,tick=tick,minimumRenderedFrames=1,steps=steps))
report=dict(format='source-pistol-particle-scheduler-native-r2',status='original-empty-collection-simulate-executed',clientSHA256=c.sha,method='0xd481a0',minimumFramesGate='0xd4828f..0xd482d8',collectionGateCounter='0x33c',definitionFields={'maximumTimeStep':'0xdc','maximumSimTick':'0xe0','minimumSimTick':'0xe4','minimumRenderedFrames':'0xec'},cases=rows,
 boundary='Original complete Simulate method executed with empty operator/emitter/child lists, profiling disabled and preallocated kill list. Collection begins at time 0, initialized flag set. First trigger, collection initialization, actual render scheduling and live child emission are not executed. The gate counter advances inside Simulate and is not a count of observed browser presentations.')
out=native.ROOT/'.reference-assets/source-exports/pistol-particles-r2/native-scheduler.json';payload=(json.dumps(report,indent=2)+'\n').encode();out.write_bytes(payload);print(json.dumps(dict(sha256=hashlib.sha256(payload).hexdigest(),cases=rows),indent=2))
