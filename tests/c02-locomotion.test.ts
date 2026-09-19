import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { createC02RenderHarness, loadC02ForValidation, locomotionRenderCases, validateLocomotion } from '../scripts/validate-locomotion';

describe('actual C02 locomotion consumption', () => {
  it('aligns original Idle/Fire/Reload leg bones with authority across phase, aim, direction and stance', async () => {
    const result = await validateLocomotion(locomotionRenderCases(false));
    expect(result.failureCount, JSON.stringify(result.failures)).toBe(0);
    expect(result.invariants).toEqual({ sourceGeometryUnchanged: true, renderedGeometryUnchanged: true, inverseMatricesUnchanged: true });
    expect(result.kneeContactMisses).toBe(0); expect(result.kneeContactClamps).toBe(0);
    expect(result.valid).toBe(true);
  });

  it('returns to the same actual pose after unrelated gait phases and original animation clips', async () => {
    const { gltf } = await loadC02ForValidation(), harness = createC02RenderHarness(gltf), cases = locomotionRenderCases(false);
    const target = cases[cases.length - 3], initial = harness.sample(target);
    for (const input of [cases[4], cases[70], cases[580], cases[1050], cases[1300]]) harness.sample(input);
    const repeated = harness.sample(target);
    for (let i = 0; i < initial.poseVector.length; i++) expect(repeated.poseVector[i]).toBeCloseTo(initial.poseVector[i], 8);
    expect(repeated.authorityUnchanged).toBe(true); expect(repeated.inputUnchanged).toBe(true);
    harness.dispose();
  });

  it('keeps actual knee gear contact invariant under actor movement and yaw in the same rendered frame', async () => {
    const { gltf } = await loadC02ForValidation(), harness = createC02RenderHarness(gltf);
    const input = { clip: 'Rifle_Idle', time: 0, crouch: .7, pitch: .6, yaw: 0, origin: [0, 0, 0] as [number, number, number],
      stridePhase: .4375, strideWeight: 1, strideSpeed: 2.1, strideX: 0, strideZ: -1, grounded: true };
    const gear = ['L', 'R'].map(side => harness.body.getObjectByName(`Knee_padded_backing_${side}`) as T.SkinnedMesh);
    const sourceBind = gear.map(mesh => mesh.bindMatrix.clone());
    const vertices = () => gear.flatMap(mesh => [0, Math.floor(mesh.geometry.attributes.position.count / 2)].map(index =>
      mesh.getVertexPosition(index, new T.Vector3()).applyMatrix4(mesh.matrixWorld)));
    // A fixed-root frame establishes the contact baseline independently of the optimized cloth cache.
    harness.sample(input); const baselineReport = harness.sample(input), baseline = vertices();
    const initialRootInverse = harness.root.matrixWorld.clone().invert();
    const errors: number[] = [], contactReports: { misses: number; clamps: number }[] = [];
    for (const [x, yaw] of [[0, 0], [.035, 0], [.3, 0], [.3, .4], [.3, .4], [0, 0], [0, 0]]) {
      const report = harness.sample({ ...input, origin: [x, 0, 0], yaw });
      const delta = harness.root.matrixWorld.clone().multiply(initialRootInverse);
      const actual = vertices();
      for (let i = 0; i < actual.length; i++) errors.push(actual[i].distanceTo(baseline[i].clone().applyMatrix4(delta)));
      expect(report.authorityUnchanged).toBe(true);
      contactReports.push({ misses: report.kneeContactMisses, clamps: report.kneeContactClamps });
    }
    expect(Math.max(...errors)).toBeLessThan(.000001);
    for (const report of contactReports) {
      expect(report.misses).toBe(baselineReport.kneeContactMisses);
      expect(report.clamps).toBe(baselineReport.kneeContactClamps);
    }
    gear.forEach((mesh, i) => expect(mesh.bindMatrix.equals(sourceBind[i])).toBe(true));
    expect(harness.invariants().inverseMatricesUnchanged).toBe(true);
    harness.dispose();
  });
});
