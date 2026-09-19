// Offline bot-ammunition probe: run the real Dust2 demolition scenario with its
// bots for a couple of minutes of simulated time and report whether any bot
// spends ammunition and reaches the reload layer, so the reload validation's
// remote-reload observation can be judged against the simulation itself instead
// of a 40s browser window.
import { readFileSync } from 'node:fs';
import { loadServerSourceMap } from '../server/source-map-data.js';
import { loadServerSourceCharacter } from '../server/source-character-data.js';
import { loadServerSourcePistol } from '../server/source-pistol-data.js';
import { loadServerSourceDeagle } from '../server/source-deagle-data.js';
import { loadServerSourceAWP } from '../server/source-awp-data.js';
import { createSourceRifleProfiles } from '../game/source-rifle-profiles.js';
import { parseSourceRagdollData } from '../game/source-ragdoll.js';
import { Simulation, initPhysics } from '../game/simulation.js';

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
const profiles = createSourceRifleProfiles(
  { amber: { vandal: tAk, m4a4: tM4 }, blue: { vandal: ctAk, m4a4: ctM4 } },
  map.simulationVersion,
  { amber: tGlock, blue: ctGlock }, { amber: tUsp, blue: ctUsp },
  { amber: tDeagle, blue: ctDeagle }, { amber: tAwp, blue: ctAwp },
  parseSourceRagdollData(JSON.parse(ragdollRaw)),
);
await initPhysics();
const sim = new Simulation('demolition', true, { ...map, ...profiles });
// One real player so the room runs exactly like the browser match.
sim.addPlayer('human', 'Probe', 'amber');
sim.fillBots();
const seen = new Map<string, { minAmmo: number; reloadTicks: number; lowTicks: number }>();
let reloadSamples = 0;
const DT = 1 / 60;
const watch = sim.players.find((p) => p.bot)!;
for (let tick = 0; tick < 60 * 120; tick++) {
  sim.step(DT);
  for (const p of sim.players) {
    if (!p.bot) continue;
    const row = seen.get(p.name) ?? { minAmmo: p.ammo, reloadTicks: 0, lowTicks: 0 };
    row.minAmmo = Math.min(row.minAmmo, p.ammo);
    if (p.reload > 0) row.reloadTicks++;
    if (p.ammo < 30 && p.weapon === 'vandal') row.lowTicks++;
    seen.set(p.name, row);
    if (p.sourcePose?.reload) reloadSamples++;
  }
  if (tick % 600 === 0)
    console.log(`t=${(tick * DT).toFixed(0)}s phase=${sim.phase} ${watch.name}: weapon=${watch.weapon} ammo=${watch.ammo} reserve=${watch.reserve} reload=${watch.reload.toFixed(2)} shotHeat=${watch.shotHeat}`);
}
for (const [name, row] of seen)
  console.log(`${name.padEnd(10)} minAmmo=${String(row.minAmmo).padStart(3)} reloadTicks=${String(row.reloadTicks).padStart(5)} partiallySpentTicks=${String(row.lowTicks).padStart(5)}`);
console.log(`total armed reload layer samples: ${reloadSamples}`);
console.log(`phase=${sim.phase}`);
