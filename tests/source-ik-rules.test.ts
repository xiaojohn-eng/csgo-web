import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSourceIKRules, sourceGroundIKRules, sourceIKRulesForDescriptor, sourceIKWindowWeight } from '../game/source-ik-rules';

const RULES = 'public/source/csgo-12426148/ik/ik-rules.json';
const available = existsSync(RULES);
const raw = () => JSON.parse(readFileSync(RULES, 'utf8'));
const poseData = (dir: string) => JSON.parse(readFileSync(`public/source/csgo-12426148/${dir}/pose-data.json`, 'utf8'));

describe.skipIf(!available)('original player IK chains and rules', () => {
  it('parses the staged original rule set', () => {
    const data = parseSourceIKRules(raw());
    expect(data.format).toBe('source-ik-rules-v1');
    expect(data.build).toBe(12426148);
    expect(data.recordBytes).toBe(152);
    expect(data.teams.t.animationModel).toBe('models/player/t_animations.mdl');
    expect(data.teams.ct.animationModel).toBe('models/player/ct_animations.mdl');
  });

  it('declares exactly the four original chains with their original bones', () => {
    const data = parseSourceIKRules(raw());
    for (const team of ['t', 'ct'] as const) {
      const names = data.teams[team].chains.map(chain => chain.name);
      expect(names).toEqual(['rhand', 'lhand', 'rfoot', 'lfoot']);
      const bones = Object.fromEntries(data.teams[team].chains.map(chain => [chain.name, chain.links.map(l => l.name)]));
      expect(bones.rhand).toEqual(['ValveBiped.Bip01_R_UpperArm', 'ValveBiped.Bip01_R_Forearm', 'ValveBiped.Bip01_R_Hand']);
      expect(bones.lhand).toEqual(['ValveBiped.Bip01_L_UpperArm', 'ValveBiped.Bip01_L_Forearm', 'ValveBiped.Bip01_L_Hand']);
      expect(bones.rfoot).toEqual(['ValveBiped.Bip01_R_Thigh', 'ValveBiped.Bip01_R_Calf', 'ValveBiped.Bip01_R_Foot']);
      expect(bones.lfoot).toEqual(['ValveBiped.Bip01_L_Thigh', 'ValveBiped.Bip01_L_Calf', 'ValveBiped.Bip01_L_Foot']);
      for (const chain of data.teams[team].chains) expect(chain.links.map(l => l.kneeDir)).toHaveLength(3);
    }
  });

  it('is ground and release work only: no rule locks a chain onto an attachment', () => {
    const data = parseSourceIKRules(raw());
    for (const team of ['t', 'ct'] as const) {
      const all = [...data.teams[team].rules.values()].flat();
      expect(all.length).toBeGreaterThan(150);
      expect(all.some(rule => rule.type === 'ATTACHMENT')).toBe(false);
      expect(all.some(rule => rule.type === 'WORLD')).toBe(false);
      expect(all.some(rule => rule.attachment !== undefined)).toBe(false);
      // Feet are planted by GROUND rules, hands are only ever released or moved
      // by their own baked error pose.
      for (const rule of all.filter(r => r.type === 'GROUND')) expect(rule.chain).toBeGreaterThan(1);
      for (const rule of all.filter(r => r.type === 'SELF')) expect(rule.chain).toBeLessThan(2);
    }
  });

  it('keeps the original ground numbers and contact frames inside their windows', () => {
    const data = parseSourceIKRules(raw());
    let ground = 0;
    for (const team of ['t', 'ct'] as const) {
      for (const [name, rules] of data.teams[team].rules) {
        for (const rule of rules.filter(r => r.type === 'GROUND')) {
          ground++;
          expect(`${name} ${rule.height} ${rule.radius}`).toMatch(/ 18 2\.5$/);
          expect(rule.contact).toBeGreaterThanOrEqual(rule.window.start);
          expect(rule.contact).toBeLessThanOrEqual(rule.window.end);
          expect(rule.window.end).toBeLessThan(1.5);
        }
      }
    }
    expect(ground).toBeGreaterThan(16);
  });

  it('agrees rule for rule with the shipped pose data for every weapon dataset', () => {
    const data = parseSourceIKRules(raw());
    for (const dir of ['character-ak', 'character-ct-ak', 'character-t-m4', 'character-ct-m4']) {
      const pose = poseData(dir);
      const team = pose.animationModel.includes('ct_animations') ? 'ct' as const : 't' as const;
      let checked = 0;
      for (const descriptor of pose.descriptors as { name: string; ikRules: number }[]) {
        const rules = sourceIKRulesForDescriptor(data, team, descriptor.name);
        expect(rules.length, `${dir}/${descriptor.name}`).toBe(descriptor.ikRules);
        checked += descriptor.ikRules;
      }
      expect(checked).toBe(178);
    }
  });

  it('gates a rule by its original window and wraps past one cycle', () => {
    // a_RunS right foot: influence 0.35 -> 0.4, hold to 0.5, gone by 0.55.
    const window = { start: .35, peak: .4, tail: .5, end: .55 };
    expect(sourceIKWindowWeight(window, .2)).toBe(0);
    expect(sourceIKWindowWeight(window, .35)).toBe(0);
    expect(sourceIKWindowWeight(window, .375)).toBeCloseTo(.5, 6);
    expect(sourceIKWindowWeight(window, .42)).toBe(1);
    expect(sourceIKWindowWeight(window, .525)).toBeCloseTo(.5, 6);
    expect(sourceIKWindowWeight(window, .6)).toBe(0);
    // The original left foot window runs past one cycle, so it must wrap.
    const wrapping = { start: .85, peak: .9, tail: 1, end: 1.05 };
    expect(sourceIKWindowWeight(wrapping, .875)).toBeCloseTo(.5, 6);
    expect(sourceIKWindowWeight(wrapping, .95)).toBe(1);
    expect(sourceIKWindowWeight(wrapping, .02)).toBeCloseTo(.6, 6);
    expect(sourceIKWindowWeight(wrapping, .1)).toBe(0);
    // An unset window covers the whole animation.
    expect(sourceIKWindowWeight({ start: 0, peak: 0, tail: 1, end: 1 }, .5)).toBe(1);
  });

  it('rejects malformed rule data', () => {
    const good = raw() as Record<string, unknown>;
    expect(() => parseSourceIKRules({ ...good, format: 'other' })).toThrow();
    expect(() => parseSourceIKRules({ ...good, build: 1 })).toThrow();
    expect(() => parseSourceIKRules({ ...good, recordBytes: 136 })).toThrow();
    const clone = () => JSON.parse(JSON.stringify(good));
    const badWindow = clone();
    badWindow.teams.t.rules.a_Idle = [{ ...clone().teams.t.rules.a_Idle[0], window: { start: .5, peak: .4, tail: .6, end: .7 } }];
    expect(() => parseSourceIKRules(badWindow)).toThrow();
    const badType = clone();
    badType.teams.t.rules.a_Idle = [{ ...clone().teams.t.rules.a_Idle[0], type: 'LOCK' }];
    expect(() => parseSourceIKRules(badType)).toThrow();
    const badChain = clone();
    badChain.teams.t.rules.a_Idle = [{ ...clone().teams.t.rules.a_Idle[0], chain: 9 }];
    expect(() => parseSourceIKRules(badChain)).toThrow();
    const badBone = clone();
    badBone.teams.t.rules.a_Idle = [{ ...clone().teams.t.rules.a_Idle[0], bone: 999 }];
    expect(() => parseSourceIKRules(badBone)).toThrow();
    const badChainName = clone();
    badChainName.teams.t.ikChains = clone().teams.t.ikChains.slice(0, 3);
    expect(() => parseSourceIKRules(badChainName)).toThrow();
  });

  it('exposes the ground rules of an original run animation', () => {
    const data = parseSourceIKRules(raw());
    const rules = sourceGroundIKRules(data, 't', 'a_RunS');
    expect(rules).toHaveLength(2);
    expect(rules.map(r => r.chain)).toEqual([2, 3]);
    expect(sourceGroundIKRules(data, 't', 'Idle_Upper_AK')).toHaveLength(0);
  });
});
