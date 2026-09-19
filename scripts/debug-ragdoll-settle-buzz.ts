// Measure the tail-tick position delta of landed corpses at the authority dt,
// across impulse directions, to size the settle threshold correctly. Reported in
// the pose frame (+Z up): a resting part necessarily re-penetrates the floor by
// g*dt^2 (0.222 units at 1/60) each tick, which the solver pushes back, so that
// ballistic ripple must not count as motion.
import { readFileSync } from 'node:fs';
import { loadServerSourceCharacter } from '../server/source-character-data.js';
import { bindSourceRagdoll, computeSourceRagdollRestFromDeath1, parseSourceRagdollData,
  spawnSourceRagdoll, stepSourceRagdoll, SOURCE_RAGDOLL_GRAVITY } from '../game/source-ragdoll.js';

const data = parseSourceRagdollData(JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json', 'utf8')));
const { poseIndex } = await loadServerSourceCharacter('public/source/csgo-12426148/character-ak/manifest.json');
const index = bindSourceRagdoll(data, poseIndex);
const { rest } = computeSourceRagdollRestFromDeath1(index, poseIndex);
const bone = (i: number) => data.parts[i]?.bone?.replace('ValveBiped.Bip01_', '') ?? `part${i}`;
const DT = 1 / 60;
const ballistic = SOURCE_RAGDOLL_GRAVITY * DT * DT;
console.log(`ballistic ripple g*dt^2=${ballistic.toFixed(3)} units/tick, current threshold=${(12 * DT).toFixed(3)}`);

for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
  const a = deg * Math.PI / 180;
  let state = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 },
    { x: Math.cos(a) * 170, y: Math.sin(a) * 170, z: 42.5 });
  let settleTick = -1;
  const tail = [];
  for (let t = 0; t < 2400; t++) {
    const before = state;
    state = stepSourceRagdoll(index, state, rest, DT);
    if (state.settled && settleTick < 0) settleTick = t;
    if (t >= 2000) {
      let worst = 0, worstI = 0;
      for (let i = 0; i < 16; i++) {
        const d = Math.hypot(state.positions[i * 3] - before.positions[i * 3],
          state.positions[i * 3 + 1] - before.positions[i * 3 + 1],
          state.positions[i * 3 + 2] - before.positions[i * 3 + 2]);
        if (d > worst) { worst = d; worstI = i; }
      }
      tail.push({ worst, worstI });
    }
  }
  const maxTail = Math.max(...tail.map((x) => x.worst));
  const p95 = [...tail].sort((x, y) => x.worst - y.worst)[Math.floor(tail.length * 0.95)];
  const worstPart = tail.find((x) => x.worst === maxTail) ?? tail[0];
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < 16; i++) {
    minZ = Math.min(minZ, state.positions[i * 3 + 2]);
    maxZ = Math.max(maxZ, state.positions[i * 3 + 2]);
  }
  console.log(`dir${String(deg).padStart(3)}: settleTick=${String(settleTick).padStart(5)}`
    + ` tail max=${maxTail.toFixed(3)} p95=${p95.worst.toFixed(3)} worstPart=${bone(worstPart.worstI)}`
    + ` settledZspan=${(maxZ - minZ).toFixed(1)}`);
}
