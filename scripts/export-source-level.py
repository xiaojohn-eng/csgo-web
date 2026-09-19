"""Build a small injected level descriptor from original Dust2 metadata.
Collision JSON is read for identity only and never modified.
"""
from pathlib import Path
import hashlib
import json
import math

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / '.reference-assets/source-exports/dust2'
def main():
    metadata = json.loads((FOLDER / 'map-metadata.json').read_text())
    brushes = json.loads((FOLDER / 'source-metadata/collision-brushes.json').read_text())
    entities = json.loads((FOLDER / 'source-metadata/entities.json').read_text())
    collision = json.loads((FOLDER / 'collision/manifest.json').read_text())
    if metadata['sourceBspSha256'] != collision['sourceBspSha256']: raise ValueError('Mismatched source BSP')
    if metadata['sourceBspSha256'] != 'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc':
        raise ValueError('Dust2 site label binding is specific to the reviewed original BSP')
    scale = metadata['outerMetersPerUnit']
    def bounds(model):
        low, high = model['mins'], model['maxs']
        return dict(min=[low[0]*scale, low[2]*scale, -high[1]*scale],
                    max=[high[0]*scale, high[2]*scale, -low[1]*scale])
    model = {row['model']: row for row in brushes['models']}
    spawns = []
    for row in metadata['spawns']:
        forward = row['browserForward']; x,y,z = row['browserMetresPosition']
        spawns.append(dict(id=row['hammerid'], team='blue' if row['classname']=='info_player_counterterrorist' else 'amber',
            sourceClassname=row['classname'], sourceOrigin=row['sourceOrigin'], sourceAngles=row['sourceAngles'],
            x=x,y=y,z=z,yaw=math.atan2(-forward[0],-forward[2]),pitch=math.atan2(forward[1],math.hypot(forward[0],forward[2]))))
    bomb_entities = [row for row in entities if row['classname']=='func_bomb_target']
    bindings = [('A',26,'2664093'),('B',27,'2664796')]
    if [(e['model'],e['hammerid']) for e in bomb_entities] != [(f'*{n}',h) for _,n,h in bindings]:
        raise ValueError('Original bomb target order/identity changed; needs a reviewed A/B binding')
    source_parameters = json.loads((ROOT/'output/tests/source-player-parameters.json').read_text())
    vectors=source_parameters['vectorsSourceUnits']; cvars=source_parameters['convars']
    def hull(prefix):
        upper=vectors['hullMax' if prefix=='standing' else 'duckHullMax']
        return dict(halfExtents=[16*scale,upper[2]*scale/2,16*scale],
                    eyeHeight=vectors['view' if prefix=='standing' else 'duckView'][2]*scale)
    result=dict(format='source-level-v1',id='de_dust2',name='Dust II',sourceBspSha256=metadata['sourceBspSha256'],
        metersPerSourceUnit=scale,worldBounds=bounds(model[0]),
        boundsMeaning='Original BSP world model bounds, including distant warmup arenas. Not a player navigation or main radar limit.',
        spawns=spawns, sites=[dict(name=name,sourceModel=n,hammerid=h,bounds=bounds(model[n])) for name,n,h in bindings],
        siteBinding='Explicit reviewed Dust2 binding in original entity order; source entities contain model/hammerid but no literal A/B key.',
        player=dict(standing=hull('standing'),crouching=hull('crouching'),
            gravity=float(cvars['sv_gravity']['default'])*scale,stepHeight=float(cvars['sv_stepsize']['default'])*scale,
            standableNormal=float(cvars['sv_standable_normal']['default']),
            sourceServerSha256=source_parameters['sha256'],
            hullMeaning='Axis-aligned Source player hull; never rotate this hull with player yaw. Static constructor defaults, not live engine cvar readback.'),
        navigation=None, navigationStatus='Original NAV retained with hash; area topology/path solver not yet implemented.',
        sourceNavSha256=hashlib.sha256((FOLDER/'source-metadata/de_dust2.nav').read_bytes()).hexdigest())
    (FOLDER/'level.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(spawns=len(spawns),sites=result['sites'],worldBounds=result['worldBounds']),indent=2))

if __name__=='__main__': main()
