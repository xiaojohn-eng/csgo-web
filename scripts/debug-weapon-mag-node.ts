// List the world weapon meshes/nodes of the original character GLB so the
// magazine the original AE_CL_EJECT_MAG events drive can be identified without
// regenerating the staged rig data.
import * as T from 'three';
import { loadCharacterCpuFixture } from './validate-source-character-actor.js';

for (const folder of ['character-ak', 'character-t-m4']) {
  const { gltf } = await loadCharacterCpuFixture(`public/source/csgo-12426148/${folder}`);
  const rows: string[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as T.SkinnedMesh;
    if (!(o as T.Mesh).isMesh) return;
    rows.push(`${o.type.padEnd(12)} ${o.name.padEnd(34)} skinned=${mesh.isSkinnedMesh ? 'y' : 'n'} visible=${o.visible} children=${o.children.length}`);
  });
  console.log(`=== ${folder}: ${rows.length} meshes ===`);
  console.log(rows.join('\n'));
}
