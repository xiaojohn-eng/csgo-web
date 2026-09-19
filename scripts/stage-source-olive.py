"""Stage the exact private-GPU-reviewed olive data in its own immutable directory."""
from pathlib import Path
import hashlib
import json
import os
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.reference-assets/source-exports/dust2-vhv/olive-foliage'
DEST = ROOT / 'public/source/csgo-12426148/dust2/vhv/olive-foliage'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def main():
    proof = ROOT / 'output/playwright/source-olive-register-private-gpu.json'
    gpu = json.loads(proof.read_bytes())
    assert gpu['status'] == 'passed_private_no_csm' and gpu['errors'] == []
    assert gpu['numericAccepted'] and gpu['probe']['cases'] == 1280
    assert gpu['probe']['maxPositionErrorMetres'] <= .0004
    assert gpu['probe']['maxZeroWindError'] == gpu['probe']['glError'] == 0
    owner = gpu['candidate']['olive']
    assert owner['meshes'] == 64 and owner['triangles'] == 10016
    assert owner['csm'] is False and owner['vertexColorPowerApplied'] is False
    assert owner['verification']['hashVerified'] and gpu['candidate']['skyOliveCopies'] == 48
    assert gpu['unload']['memory'] == {'geometries': 0, 'textures': 2, 'programs': 0}
    manifest = json.loads((BASE / 'manifest.json').read_bytes())
    assert manifest['format'] == 'source-prop-olive-receipt-v1'
    record = manifest['file']
    assert record['url'] == 'bindings.json'
    assert record['sha256'] == 'bc59f6b9b1705bbd539fd402ec7f8e6826af86081f8db379b63f926b967460ab'
    descriptor = json.loads((BASE / 'bindings.json').read_bytes())
    assert descriptor['programSha256'] == gpu['probe']['programSha256']
    files = {'manifest.json': (BASE / 'manifest.json').read_bytes()}
    for receipt in [record, *descriptor['files'].values()]:
        name = receipt['url']
        assert name in ('bindings.json', 'remap.u32', 'lighting.bin')
        raw = (BASE / name).read_bytes()
        assert len(raw) == receipt['bytes'] and sha(raw) == receipt['sha256']
        files[name] = raw
    stage = {'format': 'source-olive-stage-v1', 'gpuReceiptSha256': sha(proof.read_bytes()),
             'meshes': 64, 'skyMeshes': 48, 'csm': False,
             'files': {name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in files.items()},
             'limitations': ['Explicit no-CSM lighting branch only',
                             'Scalar float32 token oracle is not original D3D GPU bit parity',
                             'Other foliage materials, original CSM and fog remain outside this slice']}
    files['stage-receipt.json'] = (json.dumps(stage, indent=2) + '\n').encode()
    DEST.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        target = DEST / name
        if target.exists():
            assert target.read_bytes() == raw, 'Different staged original resource: ' + name
        else:
            with tempfile.NamedTemporaryFile(dir=DEST, prefix=name + '.', suffix='.tmp', delete=False) as stream:
                stream.write(raw)
                temporary = Path(stream.name)
            os.replace(temporary, target)
        assert target.read_bytes() == raw
    print(json.dumps({'path': str(DEST), 'filesVerified': len(files), 'stage': stage}, indent=2))


if __name__ == '__main__':
    main()
