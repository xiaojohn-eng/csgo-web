"""Pack original HDR face samples without gamma conversion or lossy quantization.

Run in isolated Blender for numpy. Each atlas pixel remains raw ColorRGBExp32;
the browser must decode its signed exponent before interpolation.
"""
from pathlib import Path
import hashlib
import json
import struct
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
LUMPS = ROOT / 'output/source1/de_dust2/lumps'
OUT = ROOT / '.reference-assets/source-exports/dust2-lightmapped'
OUT.mkdir(parents=True, exist_ok=True)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def inventory():
    paths = ['58-faces_hdr.bin','07-faces.bin','06-texinfo.bin','53-lighting_hdr.bin']
    blobs = {name:(LUMPS/name).read_bytes() for name in paths}
    hdr,ldr,tex,light = (blobs[name] for name in paths)
    if len(hdr)%56 or len(ldr)!=len(hdr) or len(tex)%72 or len(light)%4:
        raise ValueError('Unexpected Source lump layout')
    faces=[]
    for index in range(len(hdr)//56):
        raw=hdr[index*56:(index+1)*56]
        old=ldr[index*56:(index+1)*56]
        if raw[:16]!=old[:16] or raw[24:]!=old[24:]:
            raise ValueError('HDR face geometry differs from the rendered LDR face: '+str(index))
        texture=struct.unpack_from('<h',raw,10)[0]
        if not 0<=texture<len(tex)//72:
            raise ValueError('Bad face texture index')
        vectors=struct.unpack_from('<8f',tex,texture*72+32)
        flags=struct.unpack_from('<I',tex,texture*72+64)[0]
        offset=struct.unpack_from('<i',raw,20)[0]
        mins=struct.unpack_from('<2i',raw,28)
        width,height=(x+1 for x in struct.unpack_from('<2i',raw,36))
        styles=[s for s in raw[16:20] if s!=255]
        bumps=4 if flags&0x800 else 1
        length=width*height*4*len(styles)*bumps if offset>=0 else 0
        if offset>=0 and (width<1 or height<1 or offset+length>len(light) or styles!=[0]):
            raise ValueError('Unsupported/invalid lightmap face: '+str(index))
        faces.append({'id':index,'texInfo':texture,'flags':flags,'offset':offset,'width':width,'height':height,
            'mins':mins,'lightmapVectors':[vectors[:4],vectors[4:]],'styles':styles,'layers':bumps,'bytes':length})

    # Deterministic shelves, with a duplicated two-pixel border on every face.
    width=2048; x=y=row_height=0
    for face in sorted((f for f in faces if f['offset']>=0),key=lambda f:(-f['height'],-f['width'],f['id'])):
        w,h=face['width']+4,face['height']+4
        if x+w>width:
            y+=row_height;x=row_height=0
        face['atlas']=[x+2,y+2];x+=w;row_height=max(row_height,h)
    height=1
    while height<y+row_height+1:height*=2
    atlases=np.zeros((4,height,width,4),dtype=np.uint8)
    # Pixel at (0,last row) is neutral illumination for faces without lightmaps.
    atlases[:,height-1,0]=[255,255,255,0]
    light_bytes=np.frombuffer(light,dtype=np.uint8).reshape((-1,4))
    sample_count=0
    for face in faces:
        if face['offset']<0:
            face['atlas']=[0,height-1]
            continue
        w,h=face['width'],face['height'];ax,ay=face['atlas']
        for layer in range(face['layers']):
            begin=face['offset']//4+layer*w*h
            samples=light_bytes[begin:begin+w*h].reshape((h,w,4))
            atlases[layer,ay-2:ay+h+2,ax-2:ax+w+2]=np.pad(samples,((2,2),(2,2),(0,0)),mode='edge')
            if not np.array_equal(atlases[layer,ay:ay+h,ax:ax+w],samples):
                raise ValueError('Raw HDR atlas changed original sample bytes')
            sample_count+=w*h
    files=[]
    for layer,pixels in enumerate(atlases):
        data=pixels.tobytes();path=OUT/f'lightmap-{layer}.rgbexp32'
        path.write_bytes(data)
        if path.read_bytes()!=data:raise IOError('Atlas readback differs')
        files.append({'layer':layer,'file':path.name,'bytes':len(data),'sha256':sha(data)})
    decoded=light_bytes[:,:3].astype(np.float64)/255*np.exp2(light_bytes[:,3].view(np.int8).astype(np.float64))[:,None]
    report={'format':'source-hdr-lightmaps-v1','sourceBspSha256':'b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc',
        'sources':{k:{'sha256':sha(v),'bytes':len(v)} for k,v in blobs.items()},
        'width':width,'height':height,'atlasFiles':files,'faces':faces,
        'verifiedOriginalSamples':sample_count,'hdrAndLdrGeometryIdentical':True,
        'decode':'linearRGB = RGB8 / 255 * 2 ** signedInt8(exponentByte); decode before filtering',
        'linearRange':[float(decoded.min()),float(decoded.max())],
        'reference':'research/source-lightmap-reference.json; TexLightToLinear and ConvertRGBExp32ToLinear',
        'limits':['No original engine exposure calibration','Atlas packing is new; original face samples are byte-identical','Lightmapped geometry and browser shader not verified by this inventory']}
    (OUT/'lightmaps.json').write_text(json.dumps(report,indent=2)+'\n')
    print('SOURCE_HDR_ATLAS',json.dumps({k:v for k,v in report.items() if k not in ('faces','sources')},indent=2))
    return report

if __name__=='__main__':inventory()
