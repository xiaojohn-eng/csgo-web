"""Analyze decoded death frames: is each deathpose_* a progressive animation or a pose set?"""
import json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.reference-assets/source-exports/character-death'
meta = json.loads((BASE / 't' / 'death-metadata.json').read_text())
data = np.load(BASE / 't' / 'death-frames.npz')
bone_names = meta['boneNames']
root = next(i for i, b in enumerate(bone_names) if b.endswith('Bip01_Pelvis'))
print('bones:', len(bone_names), 'root index:', root, bone_names[:6])

for seq in meta['sequences']:
    key = seq['animationIndices'][0]
    pos = data[f'anim_{key}_positions']
    rot = data[f'anim_{key}_quaternions']
    print(f"\n== {seq['name']} frames={pos.shape[0]} fps={next(d['fps'] for d in meta['descriptors'] if d['index']==key)}")
    for f in range(pos.shape[0]):
        rp = pos[f, root]
        angle = 2 * np.degrees(np.arccos(np.clip(abs(rot[f, root, 3]), -1, 1)))
        # hip/pelvis height as proxy for standing vs lying
        hips = [i for i, b in enumerate(bone_names) if 'pelvis' in b.lower() or 'hip' in b.lower()][:2]
        hh = [round(float(pos[f, i, 2]), 1) for i in hips]
        print(f"  frame {f:2d} root=({rp[0]:7.2f},{rp[1]:7.2f},{rp[2]:7.2f}) rootRotZdeg={angle:6.1f} hipsZ={hh}")
    # adjacent-frame deltas
    d = np.abs(np.diff(pos, axis=0)).max(axis=(1, 2))
    print('  adjacent frame max bone deltas:', [round(float(x), 2) for x in d])
