import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { createSourceCTCharacterMaterial } from '../game/source-ct-character-materials';
import { createSourceCharacterMaterial } from '../game/source-character-materials';
import { applySourceCharacterSurfaces } from '../game/source-character-surfaces';
import { createSourceCharacterActors } from '../game/source-character';
import { loadCharacterCpuFixture } from '../scripts/validate-source-character-actor';
function textures() { const make = () => new T.DataTexture(new Uint8Array([53, 81, 103, 25]), 1, 1); return { base: make(), normal: make(), exponent: make() }; }
function compile(material: T.Material) {
  const s = { uniforms: T.UniformsUtils.clone(T.ShaderLib.phong.uniforms), vertexShader: T.ShaderLib.phong.vertexShader, fragmentShader: T.ShaderLib.phong.fragmentShader } as Parameters<T.Material['onBeforeCompile']>[0];
  material.onBeforeCompile(s, {} as T.WebGLRenderer); return s;
}
describe('original CT IDF VMT profile', () => {
  it.each(['upperbody', 'lowerbody', 'head'] as const)('retains original %s boost65/rim1/exponent2 without changing the T profile', part => {
    const source = textures(), ct = createSourceCTCharacterMaterial(part, source), t = createSourceCharacterMaterial(part, source), shader = compile(ct.material), original = compile(t.material);
    expect(shader.uniforms.sourceCharacterBoost.value).toBe(65); expect(shader.uniforms.sourceCharacterRimEnabled.value).toBe(1); expect(shader.uniforms.sourceCharacterRimExponent.value).toBe(2);
    expect(ct.material.userData.sourceParameters.rimlightboost).toBe(1); expect(ct.material.userData.sourceVMT).toContain('/ct_idf/');
    expect(original.uniforms.sourceCharacterBoost.value).toBe(25); expect(original.uniforms.sourceCharacterRimEnabled.value).toBe(part === 'head' ? 0 : 1); expect(original.uniforms.sourceCharacterRimExponent.value).toBe(1.2);
    expect(shader.fragmentShader).toContain('texture2D(normalMap,vNormalMapUv).a'); expect(shader.fragmentShader).toContain('1.0+149.0*sourceCharacterParameters.r');
    expect(ct.material.map?.source).toBe(source.base.source); expect(ct.material.map?.colorSpace).toBe(T.SRGBColorSpace); expect(ct.material.normalMap?.colorSpace).toBe(T.NoColorSpace);
    let disposed = 0; source.base.addEventListener('dispose', () => disposed++); ct.dispose(); t.dispose(); expect(disposed).toBe(0); Object.values(source).forEach(t => t.dispose());
  });
});
const dir = resolve('public/source/csgo-12426148/character-ct-ak');
describe.runIf(existsSync(resolve(dir, 'manifest.json')))('actual IDF GLB and per-team owner', () => {
  let fixture: Awaited<ReturnType<typeof loadCharacterCpuFixture>>;
  beforeAll(async () => { fixture = await loadCharacterCpuFixture(dir); });
  it('accepts only the explicit CT 74/70 profile and keeps all 168 original bone matrices', () => {
    const { gltf, poseIndex, weapon, weaponBytes, manifest } = fixture, owner = createSourceCharacterActors(gltf, poseIndex, weapon, weaponBytes, manifest), a = owner.createActor(), b = owner.createActor();
    expect(manifest.characterProfile).toBe('ctm_idf'); expect(a.characterBones).toHaveLength(74); expect(a.weaponBones).toHaveLength(94);
    const p = owner.updateActor(a, { x: 5, y: 1, z: 9, yaw: .37, sourceContract: 'csgo-player-12426148', sourcePoseVersion: manifest.poseVersion,
      sourcePose: { state: 'Crouch_Walk', cycle: .378, parameters: { move_x: .31, move_y: -.49, body_pitch: 24, body_yaw: -18 }, fireCycle: .29, fireWeight: .4 } });
    expect(p).not.toBeNull(); expect(b.root.visible).toBe(false);
    for (const r of weapon.boneMerge) expect(a.sourceWeaponWorldMatrices.slice(r.weaponBone * 16, r.weaponBone * 16 + 16)).toEqual(p!.sourceWorldMatrices.slice(r.characterBone * 16, r.characterBone * 16 + 16));
    expect(() => createSourceCharacterActors(gltf, poseIndex, weapon, weaponBytes, { ...manifest, bodyBoneCount: 71 })).toThrow();
    expect(() => createSourceCharacterActors(gltf, poseIndex, weapon, weaponBytes, { ...manifest, characterProfile: 'tm_leet_varianta' })).toThrow();
    owner.dispose();
  });
  it('binds actual CT material names to 11 exact original paths and refuses a mixed T material profile', async () => {
    const { gltf } = fixture, originals: (T.Material | T.Material[])[] = []; gltf.scene.traverse(o => { if ((o as T.Mesh).isMesh) originals.push((o as T.Mesh).material); });
    await expect(applySourceCharacterSurfaces(gltf, '/ct/', 'tm_leet_varianta')).rejects.toThrow(/unexpected/);
    const urls: string[] = [], textureObjects: T.Texture[] = [];
    const spy = vi.spyOn(T.TextureLoader.prototype, 'loadAsync').mockImplementation(async url => { urls.push(url); const texture = new T.Texture<HTMLImageElement>(); textureObjects.push(texture); return texture; });
    try {
      const surfaces = await applySourceCharacterSurfaces(gltf, '/ct/', 'ctm_idf'); expect(surfaces.textureCount).toBe(11); expect(surfaces.materialCount).toBe(4);
      expect(urls).toContain('/ct/textures/ctm_idf_upperbody.png'); expect(urls).toContain('/ct/textures/ctm_idf_head_varianta_exponent.png');
      expect(urls.some(url => url.includes('tm_leet'))).toBe(false); expect(surfaces.characterProfile).toBe('ctm_idf');
      for (const m of surfaces.materials.filter(m => m.originalName !== 'ak47')) expect((m.parameters as { phongboost: number }).phongboost).toBe(65);
      let disposed = 0; textureObjects.forEach(texture => texture.addEventListener('dispose', () => disposed++)); surfaces.dispose(); surfaces.dispose(); expect(disposed).toBe(11);
      const after: (T.Material | T.Material[])[] = []; gltf.scene.traverse(o => { if ((o as T.Mesh).isMesh) after.push((o as T.Mesh).material); }); expect(after).toEqual(originals);
    } finally { spy.mockRestore(); }
  });
});
