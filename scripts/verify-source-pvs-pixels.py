"""Read-only pixel comparison of stationary actual browser PVS screenshots."""
from pathlib import Path
import hashlib,json
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
records=[]
for team in ('ct','t'):
    files=[ROOT/'output/playwright'/f'dust2-{team}-pvs-{mode}.png'for mode in ('off','on')]
    values=[]
    for path in files:
        image=bpy.data.images.load(str(path),check_existing=False)
        width,height=image.size
        pixels=np.empty(width*height*4,dtype=np.float32);image.pixels.foreach_get(pixels)
        values.append(pixels.reshape((height,width,4)))
        bpy.data.images.remove(image)
    delta=np.abs(values[0]-values[1]);mask=np.any(delta>0,axis=2);y,x=np.where(mask)
    records.append({'team':team,'width':width,'height':height,'differentPixels':int(mask.sum()),
        'maxChannelDifference':float(delta.max()),'meanChannelDifference':float(delta.mean()),
        'differenceBoundsBottomLeft':None if not len(x) else [int(x.min()),int(y.min()),int(x.max()),int(y.max())],
        'pngSha256':[hashlib.sha256(path.read_bytes()).hexdigest()for path in files]})
(ROOT/'output/playwright/dust2-pvs-pixels.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2))
