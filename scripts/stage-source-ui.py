#!/usr/bin/env python3
"""Stage only the selected original UI assets for the local/LAN game build."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / '.reference-assets/source-ui'
target = ROOT / 'public/source/csgo-12426148/ui'
files = ['fonts/stratum2regular.ttf', 'fonts/stratum2medium.ttf', 'fonts/stratum2bold.ttf',
         'fonts/stratum2bold_monodigit.ttf', 'fonts/notosanssc-regular.otf',
         'images/icons/ui/t_logo_1c.svg', 'images/icons/ui/ct_logo_1c.svg',
         'images/icons/equipment/hegrenade.svg', 'images/icons/equipment/smokegrenade.svg',
         'images/icons/equipment/flashbang.svg', 'images/hud/healtharmor/icon-cross1.png',
         'images/hud/healtharmor/icon-shield.png', 'images/hud/deathnotice/icon_headshot.svg']
font_sources = {r['output']: r for r in json.loads((ROOT / 'research/source-fonts.json').read_text())}
image_sources = {r['output']: r for r in json.loads((ROOT / 'research/source-ui-assets.json').read_text())['files']}
rows = []
for relative in files:
    path = source / relative
    key = str(path.relative_to(ROOT))
    receipt = font_sources.get(key) or image_sources.get(key)
    if receipt is None:
        raise ValueError('Asset has no verified source receipt: ' + key)
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if sha != receipt.get('outputSha256', receipt.get('sha256')):
        raise ValueError('Source asset changed: ' + key)
    output = target / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    if output.read_bytes() != data:
        raise IOError('Staged UI readback differs: ' + relative)
    rows.append({'path': relative, 'bytes': len(data), 'sha256': sha,
                 'source': receipt.get('source', receipt.get('path'))})
manifest = {'appId': 740, 'buildId': 12426148, 'depot731Manifest': '1224088799001669801',
            'scope': 'Original UI assets staged for this local/LAN development game',
            'copyright': 'Original artwork belongs to Valve and its respective rights holders; font copyright/license metadata is retained in research/source-fonts.json.',
            'publicInternetPublished': False, 'files': rows}
(target / 'provenance.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'files': len(rows), 'bytes': sum(r['bytes'] for r in rows), 'target': str(target)}, ensure_ascii=False))
