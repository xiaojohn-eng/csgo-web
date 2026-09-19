// Multi-weapon ragdoll sanity: every pose driver (rifle + pistol + AWP) must
// expose the shared corpse table, and a player dying while holding any weapon
// must spawn an authoritative sourceRagdoll that settles and reaches the
// snapshot. The kill goes through the real damage() path (the death handler is
// what selects the victim's weapon driver), so no shot accuracy is involved.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadServerSourceMap } from '../server/source-map-data.js';
import { loadServerSourceCharacter } from '../server/source-character-data.js';
import { loadServerSourcePistol } from '../server/source-pistol-data.js';
import { loadServerSourceDeagle } from '../server/source-deagle-data.js';
import { loadServerSourceAWP } from '../server/source-awp-data.js';
import { createSourceRifleProfiles } from '../game/source-rifle-profiles.js';
import { parseSourceRagdollData } from '../game/source-ragdoll.js';
import { Simulation, initPhysics } from '../game/simulation.js';
import { EMPTY_INPUT } from '../game/types.js';

const root = 'public/source/csgo-12426148';
const manifest = (name: string) => `${root}/${name}/manifest.json`;
const [map, tAk, ctAk, tM4, ctM4, tGlock, ctGlock, tUsp, ctUsp, tDeagle, ctDeagle, tAwp, ctAwp, ragdollRaw] = await Promise.all([
  loadServerSourceMap(manifest('dust2')),
  loadServerSourceCharacter(manifest('character-ak')),
  loadServerSourceCharacter(manifest('character-ct-ak')),
  loadServerSourceCharacter(manifest('character-t-m4')),
  loadServerSourceCharacter(manifest('character-ct-m4')),
  loadServerSourcePistol(manifest('character-t-glock'), 't', 'glock'),
  loadServerSourcePistol(manifest('character-ct-glock'), 'ct', 'glock'),
  loadServerSourcePistol(manifest('character-t-usp'), 't', 'usp'),
  loadServerSourcePistol(manifest('character-ct-usp'), 'ct', 'usp'),
  loadServerSourceDeagle(manifest('character-t-deagle'), 't'),
  loadServerSourceDeagle(manifest('character-ct-deagle'), 'ct'),
  loadServerSourceAWP(manifest('character-t-awp'), 't'),
  loadServerSourceAWP(manifest('character-ct-awp'), 'ct'),
  Promise.resolve(readFileSync(`${root}/ragdoll/ragdoll-data.json`, 'utf8')),
]);
const ragdoll = parseSourceRagdollData(JSON.parse(ragdollRaw));
const profiles = createSourceRifleProfiles(
  { amber: { vandal: tAk, m4a4: tM4 }, blue: { vandal: ctAk, m4a4: ctM4 } },
  map.simulationVersion,
  { amber: tGlock, blue: ctGlock },
  { amber: tUsp, blue: ctUsp },
  { amber: tDeagle, blue: ctDeagle },
  { amber: tAwp, blue: ctAwp },
  ragdoll,
);
for (const team of ['amber', 'blue'] as const)
  for (const [weapon, driver] of Object.entries(profiles.poseDriversByWeapon![team]!))
    assert(driver.ragdoll, `poseDriverFor(${team}/${weapon}) must expose the ragdoll driver`);

await initPhysics();
const scenario = { ...map, ...profiles };
// The victim must hold the weapon at death; amber's default secondary is the
// glock, blue's the USP, and the deagle/AWP are bought before slot-drawing.
const cases: { weapon: 'glock' | 'usp' | 'deagle' | 'vandal' | 'm4a4' | 'awp'; team: 'amber' | 'blue'; slot: 0 | 1; setup: (s: Simulation, target: ReturnType<Simulation['addPlayer']>) => void }[] = [
  { weapon: 'glock', team: 'amber', slot: 1, setup: () => {} },
  { weapon: 'usp', team: 'blue', slot: 1, setup: () => {} },
  { weapon: 'deagle', team: 'amber', slot: 1, setup: (s, t) => { (t as any).money = 16000; assert(s.buy(t.id, 'deagle'), 'buy deagle'); } },
  { weapon: 'awp', team: 'amber', slot: 0, setup: (s, t) => { (t as any).money = 16000; assert(s.buy(t.id, 'awp'), 'buy awp'); } },
  { weapon: 'vandal', team: 'amber', slot: 0, setup: () => {} },
  { weapon: 'm4a4', team: 'blue', slot: 0, setup: () => {} },
];
for (const { weapon, team, slot, setup } of cases) {
  const s = new Simulation('training', false, scenario);
  try {
    const shooter = s.addPlayer('sh', 'Shooter', team === 'amber' ? 'blue' : 'amber');
    const target = s.addPlayer('tg', 'Target', team);
    setup(s, target);
    Object.assign(shooter, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    Object.assign(target, { x: 0, y: 0, z: -3, vx: 0, vy: 0, vz: 0, armor: 0 });
    // Secondaries sit in slot 1 (glock/usp/deagle); rifles/AWP stay slot 0.
    for (let seq = 1; seq <= 90; seq++) {
      s.setInput(shooter.id, { ...EMPTY_INPUT, seq, slot: 0 });
      s.setInput(target.id, { ...EMPTY_INPUT, seq, slot });
      s.step();
    }
    assert.equal(target.weapon, weapon, `target must hold ${weapon} at death (holds ${target.weapon})`);
    (s as any).damage(target, shooter, 999, true);
    assert.equal(target.alive, false, `target must die to ${weapon}`);
    assert(target.sourceRagdoll, `dying while holding ${weapon} must spawn sourceRagdoll`);
    const snap = s.snapshot('sh');
    const dead = snap.players.find((p) => p.id === target.id)!;
    assert(dead.sourceRagdoll, `snapshot must carry sourceRagdoll for a ${weapon} corpse`);
    assert.equal(dead.sourceRagdoll!.positions.length, 48);
    assert(dead.sourceRagdoll!.positions.every(Number.isFinite), `${weapon} ragdoll positions must be finite`);
    let settled = false;
    for (let seq = 91; seq <= 420; seq++) {
      s.setInput(shooter.id, { ...EMPTY_INPUT, seq, slot: 0 });
      s.step();
      const p = (s as any).players.find((p: any) => p.id === target.id);
      if (p.sourceRagdoll?.settled) { settled = true; break; }
    }
    assert(settled, `${weapon} ragdoll must settle`);
    console.log(`  ${team}/${weapon}: ragdoll spawned, snapshot carried, settled`);
  } finally { s.dispose(); }
}
console.log('MULTI-WEAPON RAGDOLL SMOKE PASSED');
