// Repro the "flying corpse" symptom with the exact authority inputs: the
// damage() kill impulse (170 units/s horizontal, 42.5 units/s up) plus the
// dying velocity, swept over every horizontal direction at the authority's
// 1/60 tick. Reported in the pose frame, where +Z is up.
//
// A corpse must end up FLAT: the settled part spread along +Z is a body's
// thickness, while the spread across X/Y is its length. Simulating gravity
// along +Y (the frame's forward axis) left the body upright in Z and dragged it
// sideways, which the renderer drew as an upright corpse floating off the
// floor.
import { readFileSync } from 'node:fs';
import { loadServerSourceCharacter } from '../server/source-character-data.js';
import { bindSourceRagdoll, computeSourceRagdollRestFromDeath1, parseSourceRagdollData,
  spawnSourceRagdoll, stepSourceRagdoll } from '../game/source-ragdoll.js';

const data = parseSourceRagdollData(JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json', 'utf8')));
const { poseIndex } = await loadServerSourceCharacter('public/source/csgo-12426148/character-ak/manifest.json');
const index = bindSourceRagdoll(data, poseIndex);
const { rest } = computeSourceRagdollRestFromDeath1(index, poseIndex);
console.log(`groundZ=${rest.groundZ.toFixed(2)}, parts=${data.parts.length}`);
const span = (p: ArrayLike<number>, axis: number) => {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 16; i++) { min = Math.min(min, p[i * 3 + axis]); max = Math.max(max, p[i * 3 + axis]); }
  return max - min;
};
console.log(`rest spans: X=${span(rest.positions, 0).toFixed(1)} Y=${span(rest.positions, 1).toFixed(1)} Z=${span(rest.positions, 2).toFixed(1)} (standing frame)`);

type Vec = { x: number; y: number; z: number };
const run = (label: string, velocity: Vec, impulse: Vec, dt = 1 / 60, maxTicks = 900) => {
  let state = spawnSourceRagdoll(rest, velocity, impulse);
  let tick = -1, peak = rest.positions[2];
  for (let s = 0; s < maxTicks; s++) {
    state = stepSourceRagdoll(index, state, rest, dt);
    peak = Math.max(peak, state.positions[2]);
    if (state.settled) { tick = s; break; }
  }
  console.log(`${label.padEnd(28)} settled=${String(state.settled).padEnd(5)} tick=${String(tick).padStart(4)}`
    + ` rise=${(peak - rest.positions[2]).toFixed(1)} settled spans: X=${span(state.positions, 0).toFixed(1)}`
    + ` Y=${span(state.positions, 1).toFixed(1)} Z=${span(state.positions, 2).toFixed(1)}`);
  return state;
};

run('vertical impulse {0,0,40}', { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 40 });
for (let k = 0; k < 8; k++) {
  const a = k * Math.PI / 4;
  run(`kill impulse ${(k * 45).toString().padStart(3)}deg`, { x: 0, y: 0, z: 0 },
    { x: Math.cos(a) * 170, y: Math.sin(a) * 170, z: 42.5 });
}
run('kill impulse + dying velocity', { x: -0.29 / 0.01905, y: -(-1.44) / 0.01905, z: 0 },
  { x: 170, y: 0, z: 42.5 });
