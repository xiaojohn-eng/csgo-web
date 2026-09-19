import * as T from 'three';
import { SKINS, validSkinId, type SkinId } from './skin-catalog';
export { SKINS, validSkinId, type SkinId } from './skin-catalog';

type Binding = { mesh: T.Mesh; original: T.Material | T.Material[]; owned: T.Material[] };
type Finish = { id: SkinId; bindings: Binding[] };
const states = new WeakMap<T.Object3D, Finish>();

// Only weapon coating surfaces. Skin, gloves, sights, markings, optics and
// interior parts retain their original materials, even in the combined C02 rig.
export function isPaintableMaterial(name: string) {
  return /^(01_Cerakote_Graphite|03_Reinforced_Polymer|05_Magazine_Gunmetal)$/.test(name)
    || /^(P12|DMR) \| .*(coating|polymer|gunmetal)/i.test(name);
}

function coat(original: T.Material, id: SkinId): T.Material {
  if (!(original instanceof T.MeshStandardMaterial) || !isPaintableMaterial(original.name)) return original;
  const material = original.clone();
  const finish = SKINS.find(s => s.id === id)!;
  material.name = `${original.name} / ${id}`;
  material.roughness = id === 'aurora' ? 0.28 : id === 'porcelain' ? 0.32 : 0.49;
  material.metalness = id === 'aurora' ? 0.82 : original.metalness;
  const base = new T.Color(finish.color), accent = new T.Color(finish.accent);
  material.customProgramCacheKey = () => `weapon-finish-${finish.pattern}-v1`;
  material.onBeforeCompile = shader => {
    shader.uniforms.finishBase = { value: base };
    shader.uniforms.finishAccent = { value: accent };
    shader.vertexShader = 'varying vec3 vFinishPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinishPosition = position;');
    shader.fragmentShader = `uniform vec3 finishBase; uniform vec3 finishAccent; varying vec3 vFinishPosition;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 fp = vFinishPosition * 28.0;
      float mask = 0.0;
      ${finish.pattern === 1 ? 'float stripe = abs(fract(fp.x * 0.32 + fp.z * 0.21) - 0.5); mask = 1.0 - smoothstep(0.035, 0.06, stripe);' : ''}
      ${finish.pattern === 2 ? 'vec3 cell = floor(fp * 1.9); mask = step(0.43, fract(sin(dot(cell, vec3(12.9898, 78.233, 39.425))) * 43758.5453));' : ''}
      ${finish.pattern === 3 ? 'mask = 0.5 + 0.5 * sin(fp.z * 0.7 + fp.x * 0.6 + sin(fp.y * 0.8));' : ''}
      ${finish.pattern === 4 ? 'float stripe = fract((fp.x + fp.z) * 0.7); mask = smoothstep(0.44, 0.48, stripe) - smoothstep(0.94, 0.98, stripe);' : ''}
      ${finish.pattern === 5 ? 'float weave = sin(fp.x * 2.6 + sin(fp.z * 3.0)) * cos(fp.z * 2.7 + sin(fp.y * 2.3)); mask = smoothstep(0.57, 0.66, weave);' : ''}
      vec3 pigment = mix(finishBase, finishAccent, mask);
      // Preserve surface microdetail from the source albedo without multiplying
      // a bright finish by the original dark graphite color.
      float finishDetail = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.18 + 0.91, 0.9, 1.08);
      diffuseColor.rgb = pigment * finishDetail;
    `);
  };
  return material;
}

export function applyWeaponSkin(root: T.Object3D, value: unknown) {
  const id = validSkinId(value);
  if (states.get(root)?.id === id) return;
  disposeWeaponSkin(root);
  const bindings: Binding[] = [];
  if (id !== 'default') root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const original = object.material;
    const inputs = Array.isArray(original) ? original : [original];
    const result = inputs.map(m => coat(m, id));
    const owned = result.filter((m, i) => m !== inputs[i]);
    if (!owned.length) return;
    object.material = Array.isArray(original) ? result : result[0];
    bindings.push({ mesh: object, original, owned });
  });
  states.set(root, { id, bindings });
  // A requested finish is not equipped when none of this asset's materials
  // support it. In particular, Source AK uses its original Phong material.
  root.userData.weaponSkin = bindings.length ? id : 'default';
  root.userData.paintedMeshes = bindings.length;
}

export function disposeWeaponSkin(root: T.Object3D) {
  for (const binding of states.get(root)?.bindings ?? []) {
    binding.mesh.material = binding.original;
    binding.owned.forEach(material => material.dispose());
  }
  states.delete(root);
  delete root.userData.weaponSkin;
  delete root.userData.paintedMeshes;
}
