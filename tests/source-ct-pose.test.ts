import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareSourceCharacterPose, sampleSourceCharacterPose, sourceCharacterHitboxTransforms } from '../game/source-character-pose';
const base = resolve('.reference-assets/source-exports/character-ct'), dir = resolve(base, 'continuous');
const available = existsSync(resolve(dir, 'pose-data.json'));
describe.runIf(available)('original Dust2 CT IDF baseline', () => {
  const data = available ? JSON.parse(readFileSync(resolve(dir, 'pose-data.json'), 'utf8')) : null;
  const index = available ? prepareSourceCharacterPose(data, readFileSync(resolve(dir, 'frames.f64.bin'))) : null!;
  it('retains the independent 74/70-bone layout, 1397 original frames plus the merged 234 jump_lower, 101 Death1, 70 Shoot_GREN1, 95 Shoot_GREN2, 95 Shoot_GREN3, 45 Aim_GREN, 5 HandPos_GREN and 201 Upper_GREN frames and all five unmatched main bones', () => {
    expect(index.mainBoneCount).toBe(74); expect(index.boneCount).toBe(70);
    expect(index.data.descriptors.reduce((n, d) => n + d.frames, 0)).toBe(2243);
    expect(index.data.mainToAnimation.filter(i => i >= 0)).toHaveLength(69);
    expect(new Set(index.data.mainBones.filter((_, i) => index.data.mainToAnimation[i] < 0).map(b => b.name))).toEqual(new Set(['weapon_hand_L', 'weapon_hand_R', 'jigglebone_beret', 'jigglebone_beret1', 'jigglebone_beret2']));
    const p = sampleSourceCharacterPose(index, { state: 'Run', cycle: .31415, parameters: { move_x: -.37, move_y: .79, body_yaw: -29, body_pitch: 32 } });
    index.data.mainToAnimation.forEach((a, i) => { if (a < 0) expect(Array.from(p.positions.subarray(i * 3, i * 3 + 3))).toEqual(index.data.mainBones[i].position); });
    const procedural = data.mainBones.filter((b: { proceduralRuleType: number }) => b.proceduralRuleType === 5);
    expect(procedural).toHaveLength(3); for (const b of procedural) expect(b.proceduralRuleBytesHex).toHaveLength(240);
    expect(procedural.slice(1).map((b: { proceduralRuleSourceOffset: number }, i: number) => b.proceduralRuleSourceOffset - procedural[i].proceduralRuleSourceOffset)).toEqual([120, 120]);
    expect(sourceCharacterHitboxTransforms(index, p)).toHaveLength(22);
  });
  it('matches all independent CT Python source-world matrices rather than substituting the T skeleton or animation table', () => {
    const samples = JSON.parse(readFileSync(resolve(base, 'combat/sampled-poses.json'), 'utf8')).samples;
    expect(samples).toHaveLength(40);
    for (const s of samples) {
      const p = sampleSourceCharacterPose(index, { state: s.state, cycle: s.cycle, parameters: s.params, fireWeight: s.fireWeight, blendMode: s.blendMode });
      index.data.mainBones.forEach((b, i) => { const m = s.boneWorldMatrices[b.name];
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) expect(Math.abs(p.sourceWorldMatrices[i * 16 + c * 4 + r] - m[r][c])).toBeLessThan(.0001);
      });
    }
  });
  it('matches CT interior 3way/bilinear samples and independent fire clocks', () => {
    const samples = JSON.parse(readFileSync(resolve(dir, 'interior-pose-fixtures.json'), 'utf8')).samples; expect(samples).toHaveLength(40);
    for (const s of samples) {
      const p = sampleSourceCharacterPose(index, s.input).animationPose;
      expect(Math.max(...p.positions.map((v, i) => Math.abs(v - s.positions[i])))).toBeLessThan(1e-12);
      expect(Math.max(...p.quaternions.map((v, i) => Math.abs(v - s.quaternions[i])))).toBeLessThan(1e-12);
    }
  });
});
