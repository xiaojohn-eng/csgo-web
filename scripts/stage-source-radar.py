"""Decode the installed original radar; preserve original overview calibration."""
from pathlib import Path
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'.reference-assets/csgo-legacy/csgo/resource/overviews'
target=ROOT/'public/source/csgo-12426148/dust2';target.mkdir(parents=True,exist_ok=True)
raw=(source/'de_dust2.txt').read_bytes()
values=dict(re.findall(r'"([^"\n]+)"\s*"([^"\n]+)"',raw.decode('utf-8')))
dds=source/'de_dust2_radar.dds';png=target/'radar.png';ffmpeg='/opt/homebrew/bin/ffmpeg'
subprocess.run([ffmpeg,'-v','error','-y','-i',str(dds),'-frames:v','1',str(png)],check=True)
def pixels(path):return subprocess.check_output([ffmpeg,'-v','error','-i',str(path),'-f','rawvideo','-pix_fmt','rgba','-'])
a,b=pixels(dds),pixels(png)
assert a==b and len(a)==1024*1024*4
sha=lambda data:hashlib.sha256(data).hexdigest()
scale=float(values['scale'])*.0254
data={'image':'/source/csgo-12426148/dust2/radar.png','width':1024,'height':1024,
 'x':float(values['pos_x'])*.0254,'z':-float(values['pos_y'])*.0254,'size':1024*scale,
 'metersPerPixel':scale,'original':values,'sourceOverviewSha256':sha(raw),'sourceDDSsha256':sha(dds.read_bytes()),
 'pngSha256':sha(png.read_bytes()),'decodedRGBASha256':sha(a),'decodedPixelsVerified':1024*1024}
(target/'radar.json').write_text(json.dumps(data,indent=2)+'\n')
(ROOT/'game/source-radar.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({k:data[k]for k in ('x','z','size','pngSha256','decodedPixelsVerified')},indent=2))
