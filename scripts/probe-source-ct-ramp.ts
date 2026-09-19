import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT } from '../game/types';
import { createSourcePlayerMovement } from '../game/source-player-movement';
import type { SourceScenario } from '../game/source-scenario';
const dir = '.reference-assets/source-exports/dust2', read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const corrected = process.argv.includes('--corrected');
const collisionBytes=fs.readFileSync(dir + (corrected ? '/collision-ivp-corrected/collision.json' : '/collision/collision.json'));
const scenario: SourceScenario = { mapId: 'de_dust2-source-12426148', level: read(dir + '/level.json'), collision: JSON.parse(collisionBytes.toString()), navigation: read(dir + '/navigation/navigation.json') };
const before = read('output/playwright/source-r4-ct-arms-after-ack.json').before.own[0];
await initPhysics();
const runs = [];
for (const variant of [{ name: 'standing-W' }, { name: 'crouching-W', crouch: true }, { name: 'standing-W-lift5mm', lift: .005 },
  { name: 'standing-W-jump', jump: true }, { name: 'standing-A', right: -1 }, { name: 'standing-D', right: 1 }]) {
  const sim = new Simulation('training', false, scenario), frames: unknown[] = [], contacted = new Map();
  try {
    const p = sim.addPlayer('probe', 'CT', 'blue'), id = p.id;
    Object.assign(p, before, { id, y: before.y + (variant.lift ?? 0), sourcePose: undefined, sourcePoseVersion: undefined });
    sim.world.step();
    const controller = (sim as unknown as { sourceMovement: ReturnType<typeof createSourcePlayerMovement> }).sourceMovement;
    const step = controller.step;
    controller.step = (...args) => {
      const result = step(...args);
      for (const hit of result.collisions) if (hit.handle !== null) contacted.set(hit.handle, sim.sourceLevel!.collision.metadata.get(hit.handle));
      if (result.groundHandle !== null) contacted.set(result.groundHandle, sim.sourceLevel!.collision.metadata.get(result.groundHandle));
      frames.push(result); return result;
    };
    for (let i = 0; i < 48; i++) { sim.move(p, { ...EMPTY_INPUT, yaw: before.yaw, mz: variant.right ? 0 : -1, mx: variant.right ?? 0,
      crouch: !!variant.crouch, jump: !!variant.jump, seq: i + 1 }); sim.world.step(); }
    runs.push({ variant, start: { x: before.x, y: before.y, z: before.z }, end: { x: p.x, y: p.y, z: p.z },
      distanceXZ: Math.hypot(p.x - before.x, p.z - before.z), contacted: [...contacted].map(([handle, data]) => ({ handle, data })), frames });
  } finally { sim.dispose(); }
}
const outputAt=process.argv.indexOf('--output'),outputPath=outputAt>=0?process.argv[outputAt+1]:'output/tests/source-ct-ramp-probe' + (corrected ? '-corrected' : '-original') + '.json';
if(!outputPath)throw Error('--output needs a path');
fs.writeFileSync(outputPath, JSON.stringify({ corrected,
  collisionSha256:createHash('sha256').update(collisionBytes).digest('hex'),runs }, null, 2));
console.log(JSON.stringify(runs.map(({ variant, end, distanceXZ, contacted, frames }) => ({ variant, end, distanceXZ, contacted, firstFrames: frames.slice(0, 3) })), null, 2));
if(corrected){
  assert(runs[0].distanceXZ>2,'The exact live CT actor must advance up the original empty ramp');
  assert(runs[1].distanceXZ>.3,'The exact crouched CT actor must also advance');
  assert(runs.slice(0,2).every(run=>run.contacted.every(hit=>hit.data?.source?.prop!==2647)),
    'The actual ladder cannot contact an actor on the empty ramp');
}
