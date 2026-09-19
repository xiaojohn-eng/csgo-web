"""Extract selected original CS:GO Panorama SVGs, preserving bytes and CRC evidence."""
from pathlib import Path
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('source_items', ROOT / 'scripts/inventory-source-items.py')
items = importlib.util.module_from_spec(spec)
spec.loader.exec_module(items)
context = items.initialize()
sources = items.Sources()
prefixes = ('materials/panorama/images/icons/equipment/', 'materials/panorama/images/icons/ui/',
            'materials/panorama/images/hud/', 'materials/panorama/images/map_icons/')
selected = sorted(name for name in sources.entries if name.startswith(prefixes) and name.endswith(('.svg', '.png')))
target = ROOT / '.reference-assets/source-ui'
results = []
for name in selected:
    data = sources.read(name)
    output = target / name.removeprefix('materials/panorama/')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    if output.read_bytes() != data:
        raise IOError('UI asset readback differs: ' + name)
    results.append({**sources.reads[name], 'output': str(output.relative_to(ROOT))})
report = {'context': context, 'index': sources.index_info, 'count': len(results), 'bytes': sum(r['bytes'] for r in results), 'files': results}
(ROOT / 'research/source-ui-assets.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('SOURCE_UI_EXTRACTED', report['count'], report['bytes'])
