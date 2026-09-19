"""Derive runtime audio metadata from frozen, already staged original pistols.

No network calls or asset rewrites. Every manifest and WAV is re-read and
checked; both teams must carry the same weapon events and wave content.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'public/source/csgo-12426148'
contract_text = (ROOT / 'game/source-pistol-contracts.ts').read_text()
frozen = json.loads(contract_text.split('= ', 1)[1].split(' as const;', 1)[0])

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def bounds(value, default):
    if value is None or value == 'PITCH_NORM':
        return [default, default]
    values = [float(v.strip()) for v in str(value).split(',')]
    assert len(values) in (1, 2) and values[0] <= values[-1]
    return [values[0], values[-1]]

result = {'format': 'source-pistol-audio-v1', 'sourceApp': 740, 'build': 12426148, 'weapons': {}}
proof = {'manifests': {}, 'files': [], 'limitations': [
    'WAV content, event choices and script pitch/volume ranges are verified.',
    'Original sound operators, distance crossfade, random stream history and acoustic spatialization are not reproduced by this metadata.',
    'An animation event is not evidence of a server reload or deploy unlock time.'
]}
for weapon in ('glock', 'usp'):
    manifests = {}
    for team in ('t', 'ct'):
        profile = weapon + '-' + team
        raw = (BASE / profile / 'manifest.json').read_bytes()
        assert digest(raw) == frozen[profile]['manifestSha256'], profile
        manifest = json.loads(raw)
        assert manifest['weaponId'] == weapon and manifest['team'] == team
        proof['manifests'][profile] = digest(raw)
        files = {r['path']: r for r in manifest['files']}
        for sound in manifest['sounds']:
            data = (BASE / profile / sound['file']).read_bytes()
            assert len(data) == sound['bytes'] == files[sound['file']]['bytes']
            assert digest(data) == sound['sha256'] == files[sound['file']]['sha256']
            proof['files'].append({'profile': profile, 'file': sound['file'], 'bytes': len(data), 'sha256': digest(data)})
        manifests[team] = manifest
    t, ct = manifests['t'], manifests['ct']
    assert t['clips'] == ct['clips'] and t['soundEvents'] == ct['soundEvents']
    assert sorted((s['event'], s['file'], s['sha256']) for s in t['sounds']) == sorted((s['event'], s['file'], s['sha256']) for s in ct['sounds'])
    rows = []
    for index, sound in enumerate(sorted(t['sounds'], key=lambda s: (s['event'], s['file']))):
        definition = t['soundEvents'][sound['event']]['definition']
        rows.append({'key': 'source_' + weapon + '_' + str(index), 'event': sound['event'],
                     'url': '/source/csgo-12426148/' + weapon + '-t/' + sound['file'],
                     'sha256': sound['sha256'], 'bytes': sound['bytes'],
                     'pitch': bounds(definition.get('pitch'), 100),
                     'volume': bounds(definition.get('volume'), 1)})
    timeline = {}
    for clip in t['clips'].values():
        timeline[clip['sourceSequence']] = sorted([
            {'time': event['cycle'] * clip['duration'], 'event': event['options'].lower()}
            for event in clip['events'] if event['event'] == 5004
        ], key=lambda event: event['time'])
    event_keys = {r['event'] for r in rows}
    assert all(e['event'] in event_keys for events in timeline.values() for e in events)
    result['weapons'][weapon] = {'records': rows, 'timeline': timeline}

# The original modern USP viewmodel deliberately uses HKP2000 foley for draw
# and magazine/slide handling. Do not substitute similarly named legacy USP WAVs.
usp = result['weapons']['usp']['timeline']
assert any(e['event'] == 'weapon_hkp2000.draw' for e in usp['draw'])
assert any(e['event'] == 'weapon_hkp2000.clipout' for e in usp['reload'])
out = ROOT / 'game/source-pistol-audio.json'
out.write_text(json.dumps(result, indent=2) + '\n')
proof['runtimeMetadataSha256'] = digest(out.read_bytes())
(ROOT / 'output/source-pistol-audio-stage.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps({'counts': {w: len(v['records']) for w, v in result['weapons'].items()},
                  'checkedTeamWaveRecords': len(proof['files']),
                  'metadataSha256': proof['runtimeMetadataSha256']}))
