"""Persist actual GPU RGBA readback as lossless candidate PNGs.

Canvas PNG export is deliberately excluded: premultiplied alpha can destroy
RGB precision because the original color alpha is a Phong mask, not opacity.
"""
from pathlib import Path
from PIL import Image
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1];SRC=ROOT/'output/redline';SEEDS='--seed' in sys.argv;OUT=ROOT/('.reference-assets/source-exports/ak47-redline-seed-candidate' if SEEDS else '.reference-assets/source-exports/ak47-redline-candidate');OUT.mkdir(exist_ok=True)
def sha(b):return hashlib.sha256(b).hexdigest()
j=json.loads((SRC/('seed-composite.json' if SEEDS else 'composite.json')).read_text());assert j['status']==('deterministic_original_style7_seed_candidate_rendered' if SEEDS else 'deterministic_original_style7_candidate_rendered')
files=[]
for row in j['rows']:
 for p in ['color','exponent']:
  stem=f'redline-{"seed-"+str(row["seed"]) if SEEDS else "identity"}-wear-{row["wear"]:.1f}-{p}';raw=(SRC/(stem+'.rgba8')).read_bytes();assert len(raw)==4*row['size']**2 and sha(raw)==row[p+'Sha256']
  target=OUT/(stem+'.png');Image.frombytes('RGBA',(row['size'],row['size']),raw).save(target)
  with Image.open(target) as png:assert png.tobytes()==raw
  files.append({'file':target.name,'bytes':target.stat().st_size,'pngSha256':sha(target.read_bytes()),'rgba8Sha256':sha(raw),'wear':row['wear'],'size':row['size'],'pass':p})
receipt={**j,'files':files,'losslessPNGReadbackVerified':True,'rawByteOrder':'original shader UV v=0 row first; color alpha is Phong data','boundary':('Original seed RNG/order and matrix arithmetic; host text/sincosf ABI. Exact original-client output and final weapon lighting remain unverified.' if SEEDS else 'Explicit identity UV candidate. Original seed initialization, exact original-client output and final weapon lighting remain unverified.')}
(OUT/'candidate.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'files':files,'manifestSha256':sha((OUT/'candidate.json').read_bytes())},indent=2))
