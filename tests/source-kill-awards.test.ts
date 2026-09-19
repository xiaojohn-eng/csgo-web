import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { SOURCE_KILL_AWARD_TABLE, SOURCE_KILL_AWARD_DEFAULT, SOURCE_KILL_AWARD_DEFAULT_OWNER,
  SOURCE_KILL_AWARD_LIMITATIONS, SOURCE_KILL_AWARD_SOURCE_SHA256 } from '../game/source-kill-award-table';
import { sourceKillAward, sourceKillAwardOriginal, validateSourceKillAwardTable,
  type SourceKillAwardTable } from '../game/source-kill-award';
import { sourceKillCash, SOURCE_COMPETITIVE_GAMEMODE, SOURCE_COMPETITIVE_SHORT_GAMEMODE } from '../game/source-gamemode';

const EXPORT = 'research/source-kill-awards.json';
const exportAvailable = existsSync(EXPORT);
const exported = () => JSON.parse(readFileSync(EXPORT, 'utf8'));
const clone = (): SourceKillAwardTable => JSON.parse(JSON.stringify(SOURCE_KILL_AWARD_TABLE));

describe('the staged original kill awards', () => {
  it('is the shipped file\'s own table, and says which file it came from', () => {
    expect(SOURCE_KILL_AWARD_TABLE.format).toBe('source-kill-award-table-v1');
    expect(SOURCE_KILL_AWARD_SOURCE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(SOURCE_KILL_AWARD_DEFAULT_OWNER).toBe('statted_item_base');
    expect(SOURCE_KILL_AWARD_DEFAULT).toBe(300);
    expect(SOURCE_KILL_AWARD_TABLE.prefabAwards).toMatchObject({
      statted_item_base: 300, melee: 1500, weapon_awp_prefab: 100, weapon_cz75a_prefab: 100,
      weapon_mp9_prefab: 600, weapon_bizon_prefab: 600, weapon_mac10_prefab: 600,
      weapon_mp7_prefab: 600, weapon_mp5sd_prefab: 600, weapon_ump45_prefab: 600,
      weapon_nova_prefab: 900, weapon_mag7_prefab: 900, weapon_sawedoff_prefab: 900,
      weapon_xm1014_prefab: 900, weapon_taser_prefab: 0,
    });
    expect(validateSourceKillAwardTable(SOURCE_KILL_AWARD_TABLE)).toBeUndefined();
  });

  it('pays the weapon its own row, and the base award to everything else', () => {
    // The one weapon this build ships whose class the file distinguishes: the AWP pays 100.
    expect(sourceKillAward('awp')).toBe(100);
    expect(sourceKillAwardOriginal('awp')).toBe('weapon_awp');
    for (const weapon of ['vandal', 'm4a4', 'glock', 'usp', 'deagle'] as const) {
      expect(sourceKillAward(weapon)).toBe(300);
      expect(sourceKillAwardOriginal(weapon)).not.toBeNull();
    }
    // A grenade's thrower may be holding a rifle; the grenade still pays its own award.
    expect(sourceKillAward('he')).toBe(300);
    // The weapons this build carries that the file does not define keep the base award:
    // not zero, and not another class's (a shotgun's 900 would be an invented mapping).
    for (const placeholder of ['spectre', 'marshal', 'sidearm'] as const) {
      expect(sourceKillAward(placeholder)).toBe(SOURCE_KILL_AWARD_DEFAULT);
      expect(sourceKillAwardOriginal(placeholder)).toBeNull();
    }
    expect(sourceKillAward('not-a-weapon')).toBe(SOURCE_KILL_AWARD_DEFAULT);
  });

  it('scales the award by the factor the shipped mode configs state', () => {
    // Both shipped competitive formats state 300 and 1, so the numbers are the file's.
    expect(SOURCE_COMPETITIVE_GAMEMODE.money).toMatchObject({ killDefault: 300, killFactor: 1 });
    expect(SOURCE_COMPETITIVE_SHORT_GAMEMODE.money).toMatchObject({ killDefault: 300, killFactor: 1 });
    expect(sourceKillCash(SOURCE_COMPETITIVE_GAMEMODE, sourceKillAward('awp'))).toBe(100);
    expect(sourceKillCash(SOURCE_COMPETITIVE_GAMEMODE, sourceKillAward('vandal'))).toBe(300);
    // The default argument keeps the pre-existing call working, and both agree here.
    expect(sourceKillCash(SOURCE_COMPETITIVE_GAMEMODE)).toBe(300);
    const doubled = { ...SOURCE_COMPETITIVE_GAMEMODE, money: { ...SOURCE_COMPETITIVE_GAMEMODE.money, killFactor: 2 } };
    expect(sourceKillCash(doubled, sourceKillAward('vandal'))).toBe(600);
    expect(sourceKillCash(doubled, sourceKillAward('awp'))).toBe(200);
  });

  it('refuses a table that contradicts itself instead of paying the wrong cash', () => {
    const wrongDefault = clone();
    wrongDefault.default.award = 500;
    expect(() => validateSourceKillAwardTable(wrongDefault)).toThrow(/not the default/);

    const wrongOwner = clone();
    wrongOwner.weapons.weapon_awp.award = 600;
    expect(() => validateSourceKillAwardTable(wrongOwner)).toThrow(/its owner weapon_awp_prefab states 100/);

    const brokenChain = clone();
    brokenChain.weapons.weapon_ak47.chain = ['weapon_ak47', 'rifle'];
    expect(() => validateSourceKillAwardTable(brokenChain)).toThrow(/does not end at its owner/);

    const missingOriginal = clone();
    missingOriginal.portWeapons.awp = { originalWeapon: 'weapon_awp2', award: 100, owner: 'weapon_awp_prefab' };
    expect(() => validateSourceKillAwardTable(missingOriginal)).toThrow(/which the file does not define/);

    const foreignKey = clone();
    foreignKey.portWeapons.bazooka = { originalWeapon: 'weapon_ak47', award: 300, owner: 'statted_item_base' };
    expect(() => validateSourceKillAwardTable(foreignKey)).toThrow(/not a weapon of this build/);

    const noMapping = clone();
    noMapping.portWeapons = {};
    noMapping.portUtilities = {};
    expect(() => validateSourceKillAwardTable(noMapping)).toThrow(/no weapon of this build is mapped/);
  });

  it('maps each weapon of this build onto the original weapon the staged effect map says it is', () => {
    // The mapping is not this table's to invent: the staged weapon-effect map already
    // states which original prefab each port weapon is, and the export carries the weapon
    // item that inherits exactly that prefab.
    const effectMap = JSON.parse(readFileSync('public/source/csgo-12426148/weapon-effects/effect-map.json', 'utf8'));
    const prefabs = effectMap.prefabs as Record<string, string>;
    const raw = exported();
    for (const [weapon, prefab] of Object.entries(prefabs)) {
      const mapped = SOURCE_KILL_AWARD_TABLE.portWeapons[weapon];
      expect(mapped, `${weapon} is missing from the kill-award table`).toBeTruthy();
      const original = (raw.weapons as Record<string, { prefab: string }>)[mapped.originalWeapon];
      expect(original.prefab, `${weapon} maps to ${mapped.originalWeapon}, whose prefab is not ${prefab}`).toBe(prefab);
    }
  });

  it('keeps its limitation about the factor and the port\'s own weapons', () => {
    expect(SOURCE_KILL_AWARD_LIMITATIONS.join(' ')).toMatch(/cash_player_killed_enemy_factor/);
    expect(SOURCE_KILL_AWARD_LIMITATIONS.join(' ')).toMatch(/base award/);
    expect(SOURCE_KILL_AWARD_LIMITATIONS).toHaveLength(3);
  });
});

describe.skipIf(!exportAvailable)('the export the table was generated from', () => {
  it('is the same file and the same awards the staged table carries', () => {
    const raw = exported();
    expect(raw.receipt.sha256).toBe(SOURCE_KILL_AWARD_SOURCE_SHA256);
    expect(raw.source).toBe('scripts/items/items_game.txt');
    expect(raw.defaultAward).toEqual({ owner: SOURCE_KILL_AWARD_DEFAULT_OWNER, award: SOURCE_KILL_AWARD_DEFAULT });
    expect(raw.prefabAwards).toEqual(SOURCE_KILL_AWARD_TABLE.prefabAwards);
    for (const [key, row] of Object.entries(SOURCE_KILL_AWARD_TABLE.portWeapons)) {
      const original = raw.weapons[row.originalWeapon];
      expect(original.award).toBe(row.award);
      expect(original.owner).toBe(row.owner);
      expect(original.chain[original.chain.length - 1]).toBe(row.owner);
      expect(key).toBeTruthy();
    }
    // The base default is cross-checked against the mode configs in the export itself.
    const base = raw.modeConfigCrossCheck.find((row: { file: string }) => row.file.endsWith('gamemode_competitive.cfg'));
    expect(base.killDefault).toBe(SOURCE_KILL_AWARD_DEFAULT);
    expect(base.killFactor).toBe(1);
    expect(raw.modeConfigCrossCheck).toHaveLength(2);
  });

  it('resolves the classes the file distinguishes beyond the default', () => {
    const raw = exported();
    const weapons = raw.weapons as Record<string, { award: number; owner: string }>;
    expect(weapons.weapon_knife).toMatchObject({ award: 1500, owner: 'melee' });
    expect(weapons.weapon_mp9).toMatchObject({ award: 600, owner: 'weapon_mp9_prefab' });
    expect(weapons.weapon_nova).toMatchObject({ award: 900, owner: 'weapon_nova_prefab' });
    expect(weapons.weapon_taser).toMatchObject({ award: 0, owner: 'weapon_taser_prefab' });
    expect(weapons.weapon_cz75a).toMatchObject({ award: 100, owner: 'weapon_cz75a_prefab' });
    // Every weapon whose chain reaches a prefab other than the base is one the file
    // distinguishes, and every such prefab has to be reached by at least one weapon.
    const classRows = Object.keys(raw.prefabAwards as Record<string, number>)
      .filter((name) => name !== raw.defaultAward.owner);
    const differing = Object.entries(raw.weapons as Record<string, { owner: string }>)
      .filter(([, row]) => row.owner !== raw.defaultAward.owner);
    expect(new Set(differing.map(([, row]) => row.owner))).toEqual(new Set(classRows));
    expect(differing.length).toBeGreaterThan(20);
  });
});
