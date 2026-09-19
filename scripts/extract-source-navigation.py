"""Parse the installed CSGO NAV v16/sub1, preserve every field, repack byte-exact.

SDK2013 defines the base area/ladder fields. The observed sub1 per-area suffix
uses the legacy approach-record layout; kept explicitly, unused by routing.
Unknown versions or residual bytes fail instead of inferring navigable ground.
"""
from pathlib import Path
import hashlib
import heapq
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.reference-assets/source-exports/dust2/source-metadata/de_dust2.nav'
OUT = ROOT / '.reference-assets/source-exports/dust2/navigation'

class Reader:
    def __init__(self, raw): self.raw, self.at = raw, 0
    def take(self, fmt):
        size = struct.calcsize('<' + fmt)
        if self.at + size > len(self.raw): raise ValueError(f'Truncated NAV at {self.at}')
        values = struct.unpack_from('<' + fmt, self.raw, self.at); self.at += size
        return list(values) if len(values) > 1 else values[0]
    def bytes(self, count):
        if count < 0 or self.at + count > len(self.raw): raise ValueError('Invalid byte range')
        result = self.raw[self.at:self.at + count]; self.at += count; return result
    def count(self, fmt='I', maximum=100000):
        n = self.take(fmt)
        if n > maximum: raise ValueError(f'Unreasonable NAV count {n} at {self.at}')
        return n
    def ids(self): return [self.take('I') for _ in range(self.count())]

def parse(raw):
    r = Reader(raw)
    magic, version, sub, bsp_size = r.take('4I')
    if (magic, version, sub) != (0xFEEDFACE, 16, 1): raise ValueError('Only verified CSGO NAV16/sub1 is supported')
    analyzed = r.take('B'); places = []
    for _ in range(r.count('H', 65535)):
        value = r.bytes(r.count('H', 256))
        if not value.endswith(b'\0') or b'\0' in value[:-1]: raise ValueError('Invalid NAV place name')
        places.append(value[:-1].decode('utf8'))
    unnamed = r.take('B'); area_count = r.count(); areas = []
    for _ in range(area_count):
        begin = r.at; area = dict(id=r.take('I'), flags=r.take('I'), nw=r.take('3f'), se=r.take('3f'), neZ=r.take('f'), swZ=r.take('f'))
        area['connections'] = [r.ids() for _ in range(4)]
        area['hidingSpots'] = [dict(id=r.take('I'), position=r.take('3f'), flags=r.take('B')) for _ in range(r.count('B'))]
        encounters = []
        for _ in range(r.count()):
            f, fd, t, td = r.take('IBIB')
            encounters.append(dict(fromArea=f, fromDirection=fd, toArea=t, toDirection=td,
                spots=[dict(id=r.take('I'), tByte=r.take('B')) for _ in range(r.count('B'))]))
        area['encounters'] = encounters; area['place'] = r.take('H'); area['ladders'] = [r.ids(), r.ids()]
        area['earliestOccupyTimes'] = r.take('2f'); area['lightIntensity'] = r.take('4f')
        area['visibleAreas'] = [dict(id=r.take('I'), attributes=r.take('B')) for _ in range(r.count())]
        area['inheritVisibilityFrom'] = r.take('I')
        suffix_start = r.at
        area['sub1ApproachRecords'] = [r.take('IIBIB') for _ in range(r.count('B'))]
        area['sourceBytes'] = dict(start=begin, end=r.at, sub1SuffixStart=suffix_start, sha256=hashlib.sha256(raw[begin:r.at]).hexdigest())
        areas.append(area)
    ladders = []
    for _ in range(r.count()):
        begin = r.at
        ladder = dict(id=r.take('I'), width=r.take('f'), top=r.take('3f'), bottom=r.take('3f'), length=r.take('f'), direction=r.take('I'),
            topForwardArea=r.take('I'), topLeftArea=r.take('I'), topRightArea=r.take('I'), topBehindArea=r.take('I'), bottomArea=r.take('I'))
        ladder['sourceBytes'] = dict(start=begin, end=r.at); ladders.append(ladder)
    if r.at != len(raw): raise ValueError(f'Unparsed NAV suffix {len(raw) - r.at} bytes at {r.at}')
    return dict(format='source-navigation-v1', sourceNavSha256=hashlib.sha256(raw).hexdigest(), sourceBytes=len(raw),
        version=version, subVersion=sub, sourceBspBytes=bsp_size, analyzed=analyzed, places=places, hasUnnamedAreas=unnamed,
        metersPerSourceUnit=.0254, directions=['north', 'east', 'south', 'west'], areas=areas, ladders=ladders)

def repack(data):
    chunks = []
    def put(fmt, *values): chunks.append(struct.pack('<' + fmt, *values))
    def ids(values):
        put('I', len(values))
        for value in values: put('I', value)
    put('4IBH', 0xFEEDFACE, data['version'], data['subVersion'], data['sourceBspBytes'], data['analyzed'], len(data['places']))
    for name in data['places']:
        raw = name.encode('utf8') + b'\0'; put('H', len(raw)); chunks.append(raw)
    put('BI', data['hasUnnamedAreas'], len(data['areas']))
    for a in data['areas']:
        put('II8f', a['id'], a['flags'], *a['nw'], *a['se'], a['neZ'], a['swZ'])
        for values in a['connections']: ids(values)
        put('B', len(a['hidingSpots']))
        for spot in a['hidingSpots']: put('I3fB', spot['id'], *spot['position'], spot['flags'])
        put('I', len(a['encounters']))
        for e in a['encounters']:
            put('IBIBB', e['fromArea'], e['fromDirection'], e['toArea'], e['toDirection'], len(e['spots']))
            for spot in e['spots']: put('IB', spot['id'], spot['tByte'])
        put('H', a['place'])
        for values in a['ladders']: ids(values)
        put('6fI', *a['earliestOccupyTimes'], *a['lightIntensity'], len(a['visibleAreas']))
        for v in a['visibleAreas']: put('IB', v['id'], v['attributes'])
        put('IB', a['inheritVisibilityFrom'], len(a['sub1ApproachRecords']))
        for record in a['sub1ApproachRecords']: put('IIBIB', *record)
    put('I', len(data['ladders']))
    for l in data['ladders']:
        put('I8f6I', l['id'], l['width'], *l['top'], *l['bottom'], l['length'], l['direction'],
            l['topForwardArea'], l['topLeftArea'], l['topRightArea'], l['topBehindArea'], l['bottomArea'])
    return b''.join(chunks)

def validate(data):
    areas = {a['id']: a for a in data['areas']}; ladders = {l['id']: l for l in data['ladders']}
    if len(areas) != len(data['areas']) or len(ladders) != len(data['ladders']) or 0 in areas or 0 in ladders: raise ValueError('Duplicate/zero ID')
    invalid = []
    def area_id(value, context, zero=False):
        if value not in areas and not (zero and value == 0): invalid.append([context, value])
    for a in data['areas']:
        if not all(math.isfinite(v) for v in [*a['nw'], *a['se'], a['neZ'], a['swZ']]): raise ValueError('Nonfinite NAV coordinate')
        if a['nw'][0] > a['se'][0] or a['nw'][1] > a['se'][1]: raise ValueError('Reversed NAV bounds')
        if not 0 <= a['place'] <= len(data['places']): raise ValueError('Invalid NAV place')
        for values in a['connections']:
            for value in values: area_id(value, 'connection')
        for values in a['ladders']:
            for value in values:
                if value not in ladders: invalid.append(['ladder', value])
        for e in a['encounters']:
            area_id(e['fromArea'], 'encounter-from', True); area_id(e['toArea'], 'encounter-to', True)
        for v in a['visibleAreas']: area_id(v['id'], 'visible-area')
        area_id(a['inheritVisibilityFrom'], 'inherit-visible', True)
        for rec in a['sub1ApproachRecords']:
            for i in (0, 1, 3): area_id(rec[i], 'sub1-legacy-layout-id', True)
    for l in data['ladders']:
        for key in ('topForwardArea', 'topLeftArea', 'topRightArea', 'topBehindArea', 'bottomArea'): area_id(l[key], key, True)
    if invalid: raise ValueError(f'Invalid NAV ID references: {invalid[:20]}')
    return dict(areas=len(areas), connections=sum(sum(map(len, a['connections'])) for a in areas.values()), ladders=len(ladders),
        ladderConnections=sum(sum(map(len, a['ladders'])) for a in areas.values()),
        degenerateAreas=[a['id'] for a in areas.values() if a['nw'][0] == a['se'][0] or a['nw'][1] == a['se'][1]],
        flagHistogram={str(f): sum(a['flags'] == f for a in areas.values()) for f in sorted({a['flags'] for a in areas.values()})},
        placeHistogram={name: sum(a['place'] == i for a in areas.values()) for i, name in enumerate(['<unnamed>', *data['places']])})

def make_fixtures(data):
    areas = data['areas']; by_id = {a['id']: a for a in areas}; scale = data['metersPerSourceUnit']
    def height(a, x, y):
        dx, dy = a['se'][0] - a['nw'][0], a['se'][1] - a['nw'][1]
        if not dx or not dy: return a['neZ']
        u = min(1, max(0, (x - a['nw'][0]) / dx)); v = min(1, max(0, (y - a['nw'][1]) / dy))
        return (1-v)*((1-u)*a['nw'][2]+u*a['neZ'])+v*((1-u)*a['swZ']+u*a['se'][2])
    def center(a):
        x, y = [(a['nw'][i] + a['se'][i]) / 2 for i in (0, 1)]
        return [x, y, height(a, x, y)]
    def browser(p): return [scale*p[0], scale*p[2], -scale*p[1]]
    def nearest(p):
        candidates = []
        for a in areas:
            x, y = [max(a['nw'][i], min(a['se'][i], p[i])) for i in (0, 1)]
            q = [x, y, height(a, x, y)]; candidates.append((math.dist(p, q)*scale, a['id'], q))
        distance, id, point = min(candidates)
        return dict(areaId=id, sourcePoint=point, distance=distance)
    def costs(start):
        found = {start: 0.}; queue = [(0., start)]
        while queue:
            cost, id = heapq.heappop(queue)
            if cost != found[id]: continue
            a = by_id[id]
            for targets in a['connections']:
                for target in targets:
                    proposed = cost + math.dist(center(a), center(by_id[target]))*scale
                    if proposed < found.get(target, math.inf):
                        found[target] = proposed; heapq.heappush(queue, (proposed, target))
        return found
    targets = []
    for name in ('BombsiteA', 'BombsiteB', 'UpperTunnel', 'LowerTunnel'):
        place = data['places'].index(name) + 1; chosen = [a for a in areas if a['place'] == place]
        mean = [sum(center(a)[i] for a in chosen)/len(chosen) for i in range(3)]
        a = min(chosen, key=lambda a: (math.dist(center(a), mean), a['id']))
        targets.append(dict(place=name, areaId=a['id'], sourcePoint=center(a), browserPoint=browser(center(a)),
            meaning='Center of original named NAV area nearest the mean of this place; diagnostic destination, not inferred bomb trigger/plant point'))
    spawns = json.loads((ROOT / '.reference-assets/source-exports/dust2/map-metadata.json').read_text())['spawns']
    routes = []
    for s in spawns:
        p = s['sourceOrigin']; start = nearest(p); reachable = costs(start['areaId'])
        for target in targets[:2]:
            routes.append(dict(hammerid=s['hammerid'], classname=s['classname'], sourceStart=p, browserStart=browser(p),
                start=start, target=target, expectedCost=reachable.get(target['areaId'])))
    overlaps = []
    for i, a in enumerate(areas):
        for b in areas[i+1:]:
            lo = [max(a['nw'][j], b['nw'][j]) for j in (0, 1)]; hi = [min(a['se'][j], b['se'][j]) for j in (0, 1)]
            if not all(hi[j] > lo[j] for j in (0, 1)): continue
            x, y = [(hi[j]+lo[j])/2 for j in (0, 1)]
            points = [[x, y, height(q, x, y)] for q in (a, b)]
            if abs(points[0][2]-points[1][2]) < 50: continue
            overlaps.append(dict(areaIds=[a['id'], b['id']], samples=[dict(sourcePoint=p, browserPoint=browser(p), expected=nearest(p)) for p in points]))
    return dict(routes=routes, namedTargets=targets, overlappingFloors=overlaps)

def main():
    raw = SOURCE.read_bytes(); data = parse(raw); stats = validate(data)
    # Repack parsed fields after JSON round-trip, never by copying original
    # record slices. This covers all counts, float32s, flags and custom suffixes.
    serialized = json.dumps(data, separators=(',', ':'), allow_nan=False)
    rebuilt = repack(json.loads(serialized))
    if rebuilt != raw: raise ValueError('Parsed JSON NAV round-trip is not byte-exact')
    bsp = ROOT / '.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp'
    if bsp.stat().st_size != data['sourceBspBytes']: raise ValueError('NAV recorded BSP size differs from current BSP')
    data['sourceBspSha256'] = hashlib.sha256(bsp.read_bytes()).hexdigest()
    OUT.mkdir(parents=True, exist_ok=True)
    output = json.dumps(data, separators=(',', ':'), allow_nan=False).encode() + b'\n'
    (OUT / 'navigation.json').write_bytes(output)
    (OUT / 'route-fixtures.json').write_text(json.dumps(make_fixtures(data), indent=2) + '\n')
    receipt = dict(status='parsed-and-byte-exact', sourceNavSha256=data['sourceNavSha256'], sourceNavBytes=len(raw),
        sourceBspBytes=data['sourceBspBytes'], sourceBspSha256=data['sourceBspSha256'], consumedBytes=len(raw), unparsedBytes=0,
        jsonBytes=len(output), jsonSha256=hashlib.sha256(output).hexdigest(), allIdReferencesValid=True, **stats,
        sub1SuffixMeaning='Observed exact legacy I,I,B,I,B record layout at each area end; preserved, unused by routing; CSGO-specific implementation not established by SDK2013.')
    (OUT / 'manifest.json').write_text(json.dumps(receipt, indent=2) + '\n'); print(json.dumps(receipt))

if __name__ == '__main__': main()
