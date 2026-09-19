import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { prepareSourceSky } from '../game/source-sky';
import { createSourceSkyRender } from '../game/source-sky-render';

const path = '.reference-assets/source-exports/dust2/', available = existsSync(path + 'sky/sky.json');
const read = (file: string) => JSON.parse(readFileSync(path + file, 'utf8'));
describe.runIf(available)('Source sky owner borrows complete original attribute/material state', () => {
  const sky = available ? prepareSourceSky(read('sky/sky.json'), read('visibility/visibility.json')) : null!;
  function fixture() {
    const world = new T.Group(), props = new T.Group(); props.scale.setScalar(.0254); props.rotation.x = .2;
    const geometry = new T.BufferGeometry(), positions: number[] = [], faces: number[] = [];
    for (const id of [9711, 9712, 9713, 9714, 0]) {
      positions.push(0, id, 0, 1, id, 0, 0, id, 1); faces.push(id, 0, id, 0, id, 0);
    }
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv2', new T.Float32BufferAttribute(faces, 2));
    geometry.setAttribute('uv1', new T.Float32BufferAttribute(faces.map(x => x / 1e4), 2));
    geometry.setIndex([0, 1, 2, 2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const material = new T.MeshBasicMaterial(); material.onBeforeCompile = () => {};
    world.add(new T.Mesh(geometry, material));
    const propGeometry = new T.BoxGeometry(), originals = new Map<number, T.Group>();
    for (const id of sky.data.staticPropIds) {
      const anchor = new T.Group(); anchor.name = 'static_prop_' + id; anchor.userData.sourceModel = 'original/test.mdl';
      anchor.position.set(id, id / 2, -id / 3); anchor.rotation.set(.2, .3, .4); anchor.scale.set(2, 3, 4);
      const rule = id === 146 ? sky.data.unlitMaterials[0] : id === 164 ? sky.data.unlitMaterials[1] : null;
      const mat = rule ? new T.MeshStandardMaterial({ map: new T.Texture() }) : material;
      if (rule) { mat.name = rule.source; mat.userData.full_path = rule.source; }
      const mesh = new T.Mesh(propGeometry, mat); mesh.position.set(.3, -.2, .1);
      mesh.onBeforeRender = vi.fn(); anchor.add(mesh); props.add(anchor); originals.set(id, anchor);
    }
    // The two-texture layer's own second texture: the caller stages and verifies it, so the
    // fixture hands the owner the same binding shape the map loader builds.
    const cloudRule = sky.data.unlitMaterials.find(rule => rule.second !== null)!.second!;
    const secondTexture = new T.Texture(); secondTexture.name = cloudRule.texture;
    const secondTextures = [{ file: cloudRule.file, texture: secondTexture }];
    // The map's own `light_environment._lightscaleHDR`, which the program's trailing `c30` reads.
    const lightScale = 1;
    return { world, props, geometry, material, propGeometry, originals, secondTextures, secondTexture, lightScale };
  }
  it('keeps original indices, opposite duplicate triangles, UVs, callbacks, and full parent transforms', () => {
    const f = fixture(), owner = createSourceSkyRender({ ...f, sky }), camera = new T.PerspectiveCamera(71, 1.7, .1, 100);
    const cameraParent = new T.Group(); cameraParent.position.set(1, 2, 3); cameraParent.rotation.y = .4; cameraParent.add(camera);
    camera.position.set(3, 4, 5); camera.rotation.set(.3, .2, -.1);
    owner.update(camera); owner.scene.updateMatrixWorld(true);
    expect(owner.stats.worldTriangles).toBe(5); expect(owner.stats.staticProps).toBe(75);
    const worldCopy = owner.scene.children[0] as T.Mesh;
    expect([...worldCopy.geometry.index!.array]).toEqual([0, 1, 2, 2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(worldCopy.material).toBe(f.material); expect(worldCopy.geometry.attributes.uv1).toBe(f.geometry.attributes.uv1);
    expect(worldCopy.geometry.attributes.position).toBe(f.geometry.attributes.position);
    for (const [id, original] of f.originals) {
      original.updateWorldMatrix(true, true);
      const copy = owner.scene.getObjectByName('static_prop_' + id)!;
      expect(copy.matrixWorld.elements).toEqual(original.matrixWorld.elements);
      expect(copy.children[0].matrixWorld.elements).toEqual(original.children[0].matrixWorld.elements);
      expect(copy.children[0].onBeforeRender).toBe(original.children[0].onBeforeRender);
      expect(original.parent).toBe(f.props);
    }
    expect(owner.camera.getWorldQuaternion(new T.Quaternion()).angleTo(camera.getWorldQuaternion(new T.Quaternion()))).toBeLessThan(1e-7);
    expect(owner.camera.fov).toBe(71); expect(owner.camera.aspect).toBe(1.7); expect(owner.camera.near).toBe(.0508);
    owner.dispose();
  });
  it('draws the two-texture layer\'s own product and refuses to draw it without its second texture', () => {
    const f = fixture();
    try {
      createSourceSkyRender({ ...f, sky, secondTextures: [] });
      throw Error('a two-texture material was drawn without its second texture');
    } catch (error) {
      expect((error as Error).message).toMatch(/no staged second texture/);
    }
    const cloudPath = sky.data.unlitMaterials.find(rule => rule.second !== null)!.source;
    const owner = createSourceSkyRender({ ...f, sky });
    // The owner reports the layer it draws the product for, and the material it built carries
    // the shader callback that multiplies the second sample in.
    expect(owner.twoTexture).toHaveLength(1);
    expect(owner.twoTexture[0]).toMatchObject({ source: cloudPath, file: f.secondTextures[0].file, alpha: .35,
      program: { static: '0x1', dynamic: 1 }, lightScale: f.lightScale });
    const cloud = [...new Set(owner.scene.children.flatMap(child => {
      const meshes: T.Material[] = []; child.traverse(object => {
        const mesh = object as T.Mesh; if (mesh.isMesh && !Array.isArray(mesh.material)) meshes.push(mesh.material as T.Material);
      }); return meshes;
    }))].find(material => material.name.startsWith(cloudPath)) as T.MeshBasicMaterial;
    expect(cloud.userData.sourceSecondTexture).toBe(f.secondTexture.name);
    expect(typeof cloud.onBeforeCompile).toBe('function');
    expect(cloud.customProgramCacheKey()).toBe('source-sky-two-texture-r2');
    // The shipped program ends with `rgb * cLightScale`, so the callback has to multiply the
    // product's rgb by the map's own scale - and only the rgb, as the program leaves the alpha.
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader:
      'void main() {\n#include <common>\n#include <uv_vertex>\n}', fragmentShader:
      'void main() {\n#include <common>\n#include <map_fragment>\n}' };
    cloud.onBeforeCompile(shader as unknown as Parameters<T.Material['onBeforeCompile']>[0], {} as T.WebGLRenderer);
    expect(shader.uniforms.sourceSkyLightScale.value).toBe(f.lightScale);
    // The declaration matters as much as the use: an undeclared uniform compiles to a broken
    // program, which is what the in-game run caught before this assertion existed.
    expect(shader.fragmentShader).toMatch(/uniform float sourceSkyLightScale;/);
    expect(shader.fragmentShader).toMatch(/uniform sampler2D sourceSkySecondTexture;/);
    expect(shader.vertexShader).toMatch(/varying vec2 vSourceSkySecondUv;/);
    expect(shader.fragmentShader).toMatch(/varying vec2 vSourceSkySecondUv;/);
    expect(shader.fragmentShader).toMatch(/diffuseColor \*= texture2D\( sourceSkySecondTexture/);
    expect(shader.fragmentShader).toMatch(/diffuseColor\.rgb \*= sourceSkyLightScale;/);
    expect(shader.fragmentShader).not.toMatch(/diffuseColor \*= sourceSkyLightScale/);
    expect(cloud.userData.sourceLightScale).toBe(f.lightScale);
    expect(owner.stats.limitations.join(' ')).toMatch(/cLightScale/);
    owner.dispose();
  });
  it('refuses a two-texture material whose light scale is not a positive number', () => {
    const f = fixture();
    for (const lightScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createSourceSkyRender({ ...f, sky, lightScale })).toThrow(/light scale/);
    }
  });
  it('owns only new index buffers and two unlit materials; double dispose never touches borrowed resources', () => {
    const f = fixture(), sourceDispose = vi.fn(), textureDispose = vi.fn();
    for (const o of [f.geometry, f.propGeometry, f.material]) o.addEventListener('dispose', sourceDispose);
    f.props.traverse(o => { if ((o as T.Mesh).isMesh) ((o as T.Mesh).material as T.MeshStandardMaterial).map?.addEventListener('dispose', textureDispose); });
    const owner = createSourceSkyRender({ ...f, sky }), indexDispose = vi.fn();
    (owner.scene.children[0] as T.Mesh).geometry.addEventListener('dispose', event => {
      expect(Object.keys((event.target as T.BufferGeometry).attributes)).toHaveLength(0); indexDispose();
    });
    const mats = new Set<T.Material>(); owner.scene.traverse(o => { if ((o as T.Mesh).isMesh) mats.add((o as T.Mesh).material as T.Material); });
    const owned = [...mats].filter(m => m !== f.material), materialDispose = vi.fn();
    expect(owned).toHaveLength(2); for (const m of owned) { expect((m as T.MeshBasicMaterial).isMeshBasicMaterial).toBe(true); expect((m as T.MeshBasicMaterial).fog).toBe(false); m.addEventListener('dispose', materialDispose); }
    owner.dispose(); owner.dispose(); expect(indexDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(2);
    expect(sourceDispose).not.toHaveBeenCalled(); expect(textureDispose).not.toHaveBeenCalled();
    expect(f.geometry.attributes.position.count).toBe(15); expect(f.geometry.index!.count).toBe(18);
    expect(() => owner.update(new T.PerspectiveCamera())).toThrow(/disposed/);
  });
  it('rolls back a missing original prop after world allocation without writing the main scene', () => {
    const f = fixture(); f.props.remove(f.originals.get(146)!);
    const spy = vi.spyOn(T.BufferGeometry.prototype, 'dispose'), original = f.world.children[0] as T.Mesh;
    try {
      expect(() => createSourceSkyRender({ ...f, sky })).toThrow(/coverage/);
      expect(spy).toHaveBeenCalledTimes(1); expect(original.geometry).toBe(f.geometry); expect(original.material).toBe(f.material);
      expect(f.world.children).toHaveLength(1); expect(f.props.children).toHaveLength(74);
    } finally { spy.mockRestore(); }
  });
});
