"""Independent bounded original USP-S command and event corpus, not a game build."""
from pathlib import Path
import hashlib
import importlib.util
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('usp_command', ROOT / 'scripts/probe-source-usp-command.py')
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)
F = u.d.f32
near = lambda x, k: struct.unpack('<f', struct.pack('<I', struct.unpack('<I', struct.pack('<f', x))[0]+k))[0]


def main():
    engine = u.NativeUSP()
    rows, event_rows, sequences, visited = [], [], [], set()

    def case(label, state, context):
        ctx = {**dict(now=10, dt=1/64, buttons=0, commandSeed=123456, serverSeed=987654), **context}
        try:
            result = engine.frame(state, ctx)
        except Exception:
            print(label, state, ctx, [hex(x) for x in engine.trace[-45:]], flush=True)
            raise
        visited.update(engine.trace)
        rows.append(dict(label=label, input=state, context=ctx, result=result))
        return result['state']

    for attached in (False, True):
        for clip in (0, 1, 11, 12):
            for buttons in (0, 1, 2048, 8192, 2049, 8193, 10240):
                for offset in (-1, 0, 1):
                    case('button-clock-boundary', dict(clip=clip, silencerAttached=attached, mode=int(attached),
                         nextPrimary=near(10, offset), nextSecondary=near(10, offset)), dict(buttons=buttons))
        for switch_time in (near(10, -1), 10, near(10, 1), 15):
            for activity, sequence in ((185, 'idle'), (220, 'attach'), (221, 'detach')):
                for buttons in (0, 1, 2048, 8192):
                    case('silencer-switch-gate', dict(silencerAttached=attached, mode=int(attached),
                         silencerSwitchTime=switch_time, activity=activity, sequence=sequence), dict(buttons=buttons))
        for reserve in (0, 1, 5, 24):
            for clip in (0, 1, 11, 12):
                for buttons in (0, 1, 2048, 8192):
                    for offset in (-1, 0, 1):
                        at = near(10, offset)
                        case('reload-completion', dict(clip=clip, reserve=reserve, silencerAttached=attached,
                             mode=int(attached), reloading=True, ownerNextAttack=at,
                             nextPrimary=at, nextSecondary=at, activity=194, sequence='reload'), dict(buttons=buttons))
    for shots in (0, 1, 3):
        for wait in (False, True):
            for buttons in (0, 1, 2048, 8192):
                for at in (near(10, -1), 10, near(10, 1)):
                    case('owner-busy-latch', dict(clip=3, shotsFired=shots, waitForNoAttack=wait, ownerNextAttack=at), dict(buttons=buttons))
    for block in ('rulePredicateBlock', 'playerBlocked', 'playerBlockingField15a0'):
        for buttons in (0, 1, 2048, 8192, 8193):
            case('external-primary-gate', {}, {block: True, 'buttons': buttons})
    for age in (0, 1/128, 1/64, near(1/64, 1), 1):
        case('primary-drift-base', dict(nextPrimary=10-age), dict(buttons=1))
    for no_auto in (False, True):
        for clip in (0, 3):
            for reserve in (0, 24):
                case('no-auto-reload', dict(clip=clip, reserve=reserve), dict(noAutoReload=no_auto))
    for active in (False, True):
        for owner in (False, True):
            case('ownership', {}, dict(active=active, owner=owner, buttons=1))
    # Event dispatch consumes a real caller-provided native event, not a timer.
    for event in (44, 46, 54):
        for attached in (False, True):
            for owner in (False, True):
                for reloading in (False, True):
                    for clip, reserve in ((0, 0), (0, 7), (3, 24), (12, 24)):
                        state = dict(clip=clip, reserve=reserve, reloading=reloading, silencerAttached=attached,
                                     mode=int(attached), silencerSwitchTime=15, nextPrimary=15,
                                     nextSecondary=15, ownerNextAttack=15)
                        ctx = dict(now=11, owner=owner)
                        result = engine.animationEvent(state, event, ctx)
                        visited.update(engine.trace)
                        event_rows.append(dict(input=state, event=event, context=ctx, result=result))
    for attached in (False, True):
        start = len(rows)
        state = dict(silencerAttached=attached, mode=int(attached))
        for tick in range(120):
            buttons = 1 if tick < 40 else (8192 if tick == 65 else 0)
            state = case('continuous-held-release-reload', state, dict(now=F(10+tick/64), buttons=buttons))
        sequences.append(dict(start=start, count=len(rows)-start, silencerAttached=attached))
    report = dict(schema='source-usp-command-native-v1', serverSha256=u.g.discover.SHA,
                  itemsSha256=engine.itemsSha, cases=rows, eventCases=event_rows, sequences=sequences,
                  modelActivityAdapter=engine.modelActivities, sequenceDurations=engine.sequenceDurations,
                  executedAddresses=sorted(map(hex, visited)),
                  boundaries=['Default USP-S prefab; original ordinary CSBaseGun command stores/branches.',
                              'Animation selection uses original MDL first equal-duration variant; selection is recorded separately.',
                              'Event 44/46/54 dispatcher executed; clock-generated event collection is a separate unfinished slice.',
                              'No full idle/inspect/holster/deploy, model cache, bullet/accuracy math or game-event transport in this corpus.'])
    path = ROOT / 'output/tests/source-usp-command-native.json'
    raw = (json.dumps(report, separators=(',', ':'))+'\n').encode()
    path.write_bytes(raw)
    print(json.dumps(dict(path=str(path), cases=len(rows), eventCases=len(event_rows), sha256=hashlib.sha256(raw).hexdigest())), flush=True)


if __name__ == '__main__':
    main()
