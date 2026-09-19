"""Generate browser program data from original token receipts; no formula edits."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1];j=json.loads((ROOT/'.reference-assets/source-exports/ak47-redline-programs/evidence.json').read_text())
programs={name:{'sha256':p['programSha256'],'tokens':p['tokens']} for name,p in zip(['color','exponent','vertex'],j['programs'])}
(ROOT/'game/source-redline-program-data.ts').write_text('// Generated from installed App740 platform CustomWeapon DX9 tokens.\n// Regenerate: python3 scripts/export-source-redline-program-data.py\nexport const SOURCE_REDLINE_PROGRAM_DATA = '+json.dumps(programs,separators=(',',':'))+' as const;\n')
