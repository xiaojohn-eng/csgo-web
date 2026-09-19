import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import { applyWeaponSkin, disposeWeaponSkin, isPaintableMaterial, validSkinId } from '../game/skins';
import { WeaponInspect } from '../game/weapon-inspect';
describe('weapon finishes', () => {
  it('clones only coating materials and restores the shared original', () => {
    const source = new T.MeshStandardMaterial({name:'01_Cerakote_Graphite'});
    const cloth = new T.MeshStandardMaterial({name:'FALCON | source body'});
    const gun = new T.Mesh(new T.BoxGeometry(), source), hands = new T.Mesh(new T.BoxGeometry(), cloth);
    const other = new T.Mesh(new T.BoxGeometry(), source), root = new T.Group(); root.add(gun, hands);
    applyWeaponSkin(root, 'aurora');
    expect(gun.material).not.toBe(source); expect(other.material).toBe(source); expect(hands.material).toBe(cloth);
    const coated = gun.material as T.Material, disposed = vi.fn(); coated.addEventListener('dispose', disposed);
    applyWeaponSkin(root, 'aurora'); expect(gun.material).toBe(coated);
    applyWeaponSkin(root, 'default'); expect(gun.material).toBe(source); expect(disposed).toHaveBeenCalledOnce();
    disposeWeaponSkin(root); expect(source.name).toBe('01_Cerakote_Graphite');
  });
  it('preserves material arrays and never paints optics, skin or markings', () => {
    const coating = new T.MeshStandardMaterial({name:'P12 | charcoal slide coating'}), glass = new T.MeshStandardMaterial({name:'11_Optic_Coated_Glass'});
    const root = new T.Mesh(new T.BoxGeometry(), [coating, glass]); applyWeaponSkin(root, 'redline');
    expect(root.material[0]).not.toBe(coating); expect(root.material[1]).toBe(glass);
    disposeWeaponSkin(root); expect(root.material).toEqual([coating, glass]);
    expect(isPaintableMaterial('FALCON | source body')).toBe(false); expect(validSkinId('__proto__')).toBe('default');
  });
  it('emits a shader finish for all non-default IDs without changing the source', () => {
    const source = new T.MeshStandardMaterial({name:'01_Cerakote_Graphite'}), root = new T.Mesh(new T.BoxGeometry(), source);
    applyWeaponSkin(root, 'porcelain');
    const shader = { uniforms:{}, vertexShader:'#include <begin_vertex>', fragmentShader:'#include <color_fragment>' };
    root.material.onBeforeCompile(shader as never, {} as T.WebGLRenderer);
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = pigment'); expect(shader.vertexShader).toContain('vFinishPosition = position');
    expect(Object.keys(shader.uniforms)).toContain('finishBase');
    expect(source.customProgramCacheKey()).not.toContain('weapon-finish');
  });
  it('reports the actual original finish when a new source asset cannot accept a legacy coating', () => {
    const original = new T.MeshPhongMaterial({name:'Source_AK47_VertexLitGeneric'});
    const root = new T.Mesh(new T.BoxGeometry(), original);
    applyWeaponSkin(root, 'aurora');
    expect(root.material).toBe(original);
    expect(root.userData.weaponSkin).toBe('default');
    expect(root.userData.paintedMeshes).toBe(0);
  });
});
describe('weapon inspection', () => {
  it('blends in, finishes and can be interrupted immediately by combat', () => {
    const state = new WeaponInspect(); state.start(); for(let i=0;i<20;i++) state.update(0.05,false);
    expect(state.weight).toBeGreaterThan(.99); state.update(.1,true); expect(state.elapsed).toBe(Infinity); expect(state.weight).toBeLessThan(.1);
    state.start(); for(let i=0;i<100;i++) state.update(.05,false); expect(state.weight).toBeLessThan(.001);
  });
});
