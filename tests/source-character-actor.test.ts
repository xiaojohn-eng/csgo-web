import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import * as T from 'three';
import { loadCharacterCpuFixture } from '../scripts/validate-source-character-actor';
import { createSourceCharacterActors, type SourceCharacterPlayer } from '../game/source-character';
import { sourceMagazineDropBounds, sourceMagazineDropMatrix, spawnSourceMagazineDropBody,
  stepSourceMagazineDropBody } from '../game/source-magazine-drop';

const available = existsSync('public/source/csgo-12426148/character-ak/manifest.json');
describe.runIf(available)('original continuous Source actor: actual combined GLB', () => {
  let fixture: Awaited<ReturnType<typeof loadCharacterCpuFixture>>;
  beforeAll(async () => { fixture = await loadCharacterCpuFixture(); });
  const player = (): SourceCharacterPlayer => ({ x: 10, y: 2, z: -15, yaw: .2, sourceContract: 'csgo-player-12426148', sourcePoseVersion: fixture.manifest.poseVersion,
    sourcePose: { state: 'Run', cycle: .27123, parameters: { move_x: .78, move_y: -.27, body_yaw: 21, body_pitch: -13 }, fireWeight: 0, fireTimeSeconds: 9, fireCycle: 1 } });
  const owner = () => createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest);
  const meshes = (root: T.Object3D) => { const out: T.SkinnedMesh[] = []; root.traverse(o => { if ((o as T.SkinnedMesh).isSkinnedMesh) out.push(o as T.SkinnedMesh); }); return out; };
  it('clones all 165 bones and inverse bind matrices independently while sharing original geometry and material resources', () => {
    const manager = owner(), a = manager.createActor(), b = manager.createActor();
    for (let i = 0; i < 71; i++) expect(a.characterBones[i]).not.toBe(b.characterBones[i]);
    for (let i = 0; i < 94; i++) expect(a.weaponBones[i]).not.toBe(b.weaponBones[i]);
    const am = meshes(a.model), bm = meshes(b.model);
    for (let i = 0; i < am.length; i++) {
      expect(am[i].geometry).toBe(bm[i].geometry); expect(am[i].material).toBe(bm[i].material); expect(am[i].skeleton).not.toBe(bm[i].skeleton);
      expect(am[i].skeleton.boneInverses).not.toBe(bm[i].skeleton.boneInverses);
      for (let j = 0; j < am[i].skeleton.boneInverses.length; j++) {
        expect(am[i].skeleton.boneInverses[j]).not.toBe(bm[i].skeleton.boneInverses[j]); expect(am[i].skeleton.boneInverses[j].elements).toEqual(bm[i].skeleton.boneInverses[j].elements);
      }
    }
    manager.updateActor(a, player()); expect(b.status).toBe('awaiting-authority'); expect(b.root.visible).toBe(false); manager.dispose();
  });
  it('updates only authority pose and actor transform, caches identical input, and preserves exact three-name world bone merge', () => {
    const manager = owner(), actor = manager.createActor(), input = player(), p = manager.updateActor(actor, input)!;
    expect(actor.status).toBe('ready'); expect(actor.root.rotation.y).toBe(input.yaw + Math.PI / 2);
    expect(manager.updateActor(actor, { ...input, x: 30 })).toBe(p); expect(actor.root.position.x).toBe(30);
    for (const pair of fixture.weapon.boneMerge) {
      expect(actor.sourceWeaponWorldMatrices.slice(pair.weaponBone * 16, pair.weaponBone * 16 + 16)).toEqual(p.sourceWorldMatrices.slice(pair.characterBone * 16, pair.characterBone * 16 + 16));
    }
    for (const bone of [...actor.characterBones, ...actor.weaponBones]) expect(bone.scale.toArray()).toEqual([1, 1, 1]);
    manager.dispose();
  });
  it('exposes the original world weapon attachment in scene space and reports none before a pose', () => {
    const manager = owner(), actor = manager.createActor(), input = player();
    const named = fixture.weapon.attachments.find(a => a.name === 'muzzle_flash')!;
    // No authoritative pose yet: the rig reports no attachment, never an invented point.
    expect(manager.attachment(actor, 'muzzle_flash')).toBeNull();
    manager.updateActor(actor, input);
    const attachment = manager.attachment(actor, 'muzzle_flash');
    expect(attachment).not.toBeNull();
    expect(attachment!.elements.every(Number.isFinite)).toBe(true);
    // The original attachment carries no translation of its own, so its world point
    // is the rendered muzzle bone the original block parents it to.
    const bone = new T.Vector3().setFromMatrixPosition(actor.weaponBones[named.parent_bone].matrixWorld);
    const actual = new T.Vector3().setFromMatrixPosition(attachment!);
    expect(actual.distanceTo(bone)).toBeLessThan(1e-3);
    // A held weapon's muzzle stays within arm's reach of the actor's own origin,
    // which is at its feet in metres (the real LAN run measures 1.63–1.70 m).
    expect(actual.distanceTo(actor.root.position)).toBeLessThan(2);
    // A name this original rig does not carry reports none rather than a guess.
    expect(manager.attachment(actor, 'left_hand_attach_typo')).toBeNull();
    expect(() => manager.attachment({} as never, 'muzzle_flash')).toThrow(/Unknown Source actor/);
    manager.dispose();
  });
  it('rejects missing/stale/nonfinite authority without displaying a substituted character, then can recover', () => {
    const manager = owner(), actor = manager.createActor(), input = player();
    expect(manager.updateActor(actor, { ...input, sourcePoseVersion: 'other' })).toBeNull(); expect(actor.root.visible).toBe(false);
    expect(manager.updateActor(actor, { ...input, sourcePose: undefined })).toBeNull();
    expect(manager.updateActor(actor, { ...input, x: NaN })).toBeNull();
    expect(() => manager.updateActor(actor, { ...input, sourcePose: { ...input.sourcePose!, cycle: NaN } })).toThrow(); expect(actor.root.visible).toBe(false);
    expect(manager.updateActor(actor, input)).not.toBeNull(); expect(actor.status).toBe('ready'); manager.dispose();
  });
  it('preserves the original world AK fire tail after the shorter character shot layer has completed', () => {
    const manager = owner(), actor = manager.createActor(), input = player();
    manager.updateActor(actor, { ...input, sourcePose: { ...input.sourcePose!, state: 'Idle', cycle: .2, fireTimeSeconds: 25 / 30, fireCycle: 1, fireWeight: 0 } });
    const tail = actor.sourceWeaponWorldMatrices.slice();
    manager.updateActor(actor, { ...input, sourcePose: { ...input.sourcePose!, state: 'Idle', cycle: .2, fireTimeSeconds: .95, fireCycle: 1, fireWeight: 0 } });
    expect(Math.max(...tail.map((v, i) => Math.abs(v - actor.sourceWeaponWorldMatrices[i])))).toBeGreaterThan(1e-6); manager.dispose();
  });
  it('moves the world weapon magazine with the original reload display events', () => {
    const manager = owner(), actor = manager.createActor();
    expect(actor.magazine).not.toBeNull();
    expect(actor.magazine!.name).toBe('w_rif_ak47_mag');
    const armed = (cycle: number) => ({ ...player(), sourcePose: { ...player().sourcePose!, reload: { cycle, weight: 1 } } });
    // The magazine is seated on the aim pose and through the reload's run-up.
    manager.updateActor(actor, player());
    expect(actor.magazine!.visible).toBe(true);
    manager.updateActor(actor, armed(0));
    expect(actor.magazine!.visible).toBe(true);
    // It leaves the weapon between the AK's own AE_CL_EJECT_MAG (0.2192) and
    // AE_CL_EJECT_MAG_UNHIDE (0.3288), then the fresh one is seated again.
    manager.updateActor(actor, armed(0.27));
    expect(actor.magazine!.visible).toBe(false);
    manager.updateActor(actor, armed(0.33));
    expect(actor.magazine!.visible).toBe(true);
    manager.dispose();
  });
  it('drops the original magazine as its own prop exactly when AE_CL_EJECT_MAG fires', () => {
    const manager = owner(), actor = manager.createActor();
    const armed = (cycle: number) => ({ ...player(), grounded: true, sourcePose: { ...player().sourcePose!, reload: { cycle, weight: 1 } } });
    manager.updateActor(actor, player());
    expect(manager.takeMagazineDrop(actor)).toBeNull();
    manager.updateActor(actor, armed(0.1));
    expect(manager.takeMagazineDrop(actor)).toBeNull();
    // Crossing the AK's own AE_CL_EJECT_MAG cycle (0.2192) releases the prop.
    manager.updateActor(actor, armed(0.27));
    const drop = manager.takeMagazineDrop(actor)!;
    expect(drop).not.toBeNull();
    expect(drop.key).toBe('ak47');
    expect(drop.geometry).toBe(actor.magazine!.geometry);
    expect(drop.forward.y).toBe(0); expect(drop.forward.length()).toBeCloseTo(1, 9);
    expect(manager.takeMagazineDrop(actor)).toBeNull();
    // Seating the fresh magazine and the rest of the reload never drop again.
    manager.updateActor(actor, armed(0.33));
    manager.updateActor(actor, armed(0.9));
    manager.updateActor(actor, player());
    expect(manager.takeMagazineDrop(actor)).toBeNull();
    // The owner itself has no map to query: the renderer attaches the original
    // collision's surface, and without it the prop keeps the spawn level.
    manager.updateActor(actor, armed(0.27));
    expect(manager.takeMagazineDrop(actor)!.surfaceY).toBeUndefined();
    manager.dispose();
  });
  it('places the dropped prop at the magazine\'s own rigid skinned world transform', () => {
    const manager = owner(), actor = manager.createActor(), magazine = actor.magazine as T.SkinnedMesh;
    const armed = (cycle: number) => ({ ...player(), sourcePose: { ...player().sourcePose!, reload: { cycle, weight: 1 } } });
    manager.updateActor(actor, armed(0.1));
    manager.updateActor(actor, armed(0.27));
    const drop = manager.takeMagazineDrop(actor)!;
    // Independent cross-check against three.js's own skinning path: the prop
    // matrix must put every bind-pose magazine vertex where the weapon draws it.
    const positions = magazine.geometry.getAttribute('position');
    for (const vertex of [0, 40, positions.count - 1]) {
      const expected = new T.Vector3().fromBufferAttribute(positions, vertex);
      magazine.applyBoneTransform(vertex, expected).applyMatrix4(magazine.matrixWorld);
      const actual = new T.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(drop.matrix);
      expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    }
    manager.dispose();
  });
  it('rests the prop on the surface the authority traced instead of a plane through the feet', () => {
    const manager = owner(), actor = manager.createActor();
    const armed = (cycle: number, sourceGroundY?: number) => ({ ...player(), grounded: true, sourceGroundY,
      sourcePose: { ...player().sourcePose!, reload: { cycle, weight: 1 } } });
    // A reload beside a ledge: the authority traced a surface well below the feet.
    manager.updateActor(actor, armed(0.1, -3.2));
    expect(actor.magazineGroundY).toBeCloseTo(-3.2, 9);
    manager.updateActor(actor, armed(0.27, -3.2));
    const drop = manager.takeMagazineDrop(actor)!;
    expect(drop.floorY).toBeCloseTo(-3.2, 9);
    const body = spawnSourceMagazineDropBody(drop, sourceMagazineDropBounds(drop.geometry));
    for (let i = 0; i < 400; i++) stepSourceMagazineDropBody(body, 1 / 60);
    expect(body.resting).toBe(true);
    expect(body.center.y).toBeGreaterThan(-3.2); expect(body.center.y + 3.2).toBeLessThan(.2);
    // Without the authority surface the original fallback (the shooter origin) stays.
    const manager2 = owner(), actor2 = manager2.createActor();
    manager2.updateActor(actor2, armed(0.1));
    expect(actor2.magazineGroundY).toBeCloseTo(player().y, 9);
    manager.dispose(); manager2.dispose();
  });
  it('spawns the prop on the weapon in original units and rests it on the shooter level', () => {
    const manager = owner(), actor = manager.createActor(), magazine = actor.magazine as T.SkinnedMesh;
    const armed = (cycle: number) => ({ ...player(), grounded: true, sourcePose: { ...player().sourcePose!, reload: { cycle, weight: 1 } } });
    manager.updateActor(actor, armed(0.1));
    manager.updateActor(actor, armed(0.27));
    const drop = manager.takeMagazineDrop(actor)!;
    const body = spawnSourceMagazineDropBody(drop, sourceMagazineDropBounds(drop.geometry));
    // The original magazine mesh is in Source units, so the prop keeps the
    // weapon's own unit scale instead of drawing a 25x oversized magazine.
    expect(body.scale).toBeCloseTo(.0254, 6);
    expect(body.half.x).toBeLessThan(.12); expect(body.half.y).toBeLessThan(.2); expect(body.half.z).toBeLessThan(.12);
    const positions = magazine.geometry.getAttribute('position'), spawn = sourceMagazineDropMatrix(body);
    for (const vertex of [0, 40, positions.count - 1]) {
      const expected = new T.Vector3().fromBufferAttribute(positions, vertex);
      magazine.applyBoneTransform(vertex, expected).applyMatrix4(magazine.matrixWorld);
      const actual = new T.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(spawn);
      // Rebuilt from the decomposed transform, so it carries the decompose/
      // recompose round-trip error (sub-micrometre) instead of being exact.
      expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    }
    // It falls to the shooter's own level and lies no higher than the magazine.
    for (let i = 0; i < 400; i++) stepSourceMagazineDropBody(body, 1 / 60);
    expect(body.resting).toBe(true);
    expect(body.center.y).toBeGreaterThan(drop.floorY);
    expect(body.center.y - drop.floorY).toBeLessThan(.2);
    manager.dispose();
  });
  it('never drops a prop when the weapon skin or pose is invalid', () => {
    const manager = owner(), actor = manager.createActor();
    const armed = (cycle: number) => ({ ...player(), sourcePose: { ...player().sourcePose!, reload: { cycle, weight: 1 } } });
    manager.updateActor(actor, armed(0.1));
    // A stale authority version must not produce a prop from the last good pose.
    expect(manager.updateActor(actor, { ...armed(0.27), sourcePoseVersion: 'other' })).toBeNull();
    expect(manager.takeMagazineDrop(actor)).toBeNull();
    manager.dispose();
  });
  it('disposes each actor skeleton without disposing shared resources or another actor', () => {
    const manager = owner(), a = manager.createActor(), b = manager.createActor(), geometry = meshes(a.model)[0].geometry;
    let geometriesDisposed = 0; const listener = () => geometriesDisposed++; geometry.addEventListener('dispose', listener);
    manager.disposeActor(a); manager.disposeActor(a); expect(a.status).toBe('disposed'); expect(geometriesDisposed).toBe(0);
    expect(() => manager.updateActor(a, player())).toThrow(); expect(manager.updateActor(b, player())).not.toBeNull();
    manager.dispose(); expect(b.status).toBe('disposed'); expect(() => manager.createActor()).toThrow(); geometry.removeEventListener('dispose', listener);
  });
});
