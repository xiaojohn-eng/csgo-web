"""Reuse the original native clock harness with exact Deagle MDL/event data."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('native_clock','%s/scripts/probe-source-glock-animation-clock.py'%ROOT)
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)


class NativeDeagleClock(c.NativeClock):
    def __init__(self):
        super().__init__()
        path=ROOT/'.reference-assets/source-exports/deagle-candidates/deagle-ct/audit.json'
        if not path.exists():path=ROOT/'.worktrees/weapon/.reference-assets/source-exports/deagle-candidates/deagle-ct/audit.json'
        audit=json.loads(path.read_text())
        entries,_=c.a.vpk.directory_index(c.a.vpk.GAME/'pak01_dir.vpk')
        entry=entries['models/weapons/v_pist_deagle.mdl']
        with(c.a.vpk.GAME/f"pak01_{entry['archiveIndex']:03}.vpk").open('rb')as stream:
            stream.seek(entry['archiveOffset']);self.mdl=stream.read(entry['archiveBytes'])
        self.mdlSha=hashlib.sha256(self.mdl).hexdigest()
        assert self.mdlSha==audit['dependencies']['models/weapons/v_pist_deagle.mdl']['sha256']
        start,size=c.g.discover.function(0x6ba9d0)
        instructions=list(c.g.discover.md.disasm(self.raw[c.g.discover.offset(start):c.g.discover.offset(start)+size],start))
        self.registrations={}
        for name in {e['name']for s in audit['sequences']for e in s['events']if e['name']}:
            pointer=c.g.discover.va(self.raw.index(name.encode()+b'\0'))
            i=next(i for i,x in enumerate(instructions)if x.mnemonic=='push'and x.op_str==hex(pointer))
            flags,event_id=instructions[i-2:i]
            assert flags.mnemonic==event_id.mnemonic=='push'
            self.registrations[name]=dict(id=int(event_id.op_str,0),type=int(flags.op_str,0)|1024,registrationVA=hex(flags.address))
        durations={v['sequence']:c.d.f32(v['duration_seconds'])for v in audit['clip_checks'].values()}
        _,base=struct.unpack_from('<II',self.mdl,0xbc);self.profiles=[]
        for sequence in audit['sequences']:
            index=sequence['sequence_index'];at=base+index*212
            count,off=struct.unpack_from('<II',self.mdl,at+24)
            self.profiles.append(dict(sequence=index,name=sequence['name'],flags=struct.unpack_from('<I',self.mdl,at+12)[0],
                 duration=durations[sequence['name']],fadeOut=struct.unpack_from('<f',self.mdl,at+108)[0],
                 events=sequence['events'],eventTable=c.a.MDL+at+off,eventCount=count))
        assert not any(p['flags']&1 for p in self.profiles)


def main():
    engine=NativeDeagleClock();rows=[]
    for profile in engine.profiles:
        sequence=profile['sequence']
        # A continuous original clock/event stream for every animation. Reuse
        # already-verified shared arithmetic; focus extra coverage on model data.
        state=dict(sequence=sequence,animTime=10,previousAnimTime=10)
        frames=int(profile['duration']*32)+4
        for tick in range(frames):
            context=dict(now=c.d.f32(10+tick/32),**({'reset':sequence}if tick==0 else{}))
            result=engine.clock(state,context)
            rows.append(dict(input=state,context=context,result=result));state=result['state']
    guards=[]
    for old in range(9):
        for new in (0,1,4,5,6,7,8):
            for cycle in (0,.98,1):
                state=dict(sequence=old,cycle=c.d.f32(cycle))
                guards.append(dict(input=state,sequence=new,accepted=engine.requestGuard(state,new)))
    report=dict(serverSha256=c.g.discover.SHA,sourceMdlSha256=engine.mdlSha,profiles=engine.profiles,
                registrations=engine.registrations,cases=rows,requestGuards=guards)
    out=ROOT/'output/tests/source-deagle-animation-clock-native.json'
    out.write_text(json.dumps(report,separators=(',',':'))+'\n')
    data=[]
    for p in engine.profiles:
        events=[]
        for i,event in enumerate(p['events']):
            registration=engine.registrations.get(event['name'],dict(id=event['event'],type=event['type']))
            events.append(dict(record=i,recordEvent=registration['id'],type=registration['type'],cycle=event['cycle'],options=event['options'],name=event['name']))
        data.append({**{key:p[key]for key in ('sequence','name','duration','fadeOut','flags')},'events':events})
    (ROOT/'game/source-deagle-animation-data.ts').write_text('/** Generated from original Deagle MDL and original ELF event registration. */\nexport const SOURCE_DEAGLE_ANIMATION_DATA='+json.dumps(data,indent=2)+' as const;\n')
    print(json.dumps(dict(cases=len(rows),guards=len(guards),file=str(out),sourceMdlSha256=engine.mdlSha,registrations=engine.registrations)),flush=True)


if __name__=='__main__':
    main()
