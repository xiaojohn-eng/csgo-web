// Multi-weapon ragdoll sanity: every pose driver (rifle + pistol + AWP) must
// expose the shared corpse table, and a player dying while holding any weapon
// must spawn an authoritative sourceRagdoll that settles and reaches the
// snapshot. The kill goes through the real damage() path (the death handler is
// what selects the victim's weapon driver), so no shot accuracy is involved.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import {RemoteTimeline} from '../game/pose-timeline.js';
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
const results=[];
for(const team of ['amber','blue'] as const)for(const weapon of ['vandal','m4a4','awp','glock','usp','deagle'] as const){
 const s=new Simulation('training',false,scenario);
 try{
  const target=s.addPlayer('target','Target',team),shooter=s.addPlayer('shooter','Shooter',team==='amber'?'blue':'amber');
  target.money=16000;
  if(weapon!==target.primary&&weapon!==target.secondary)assert(s.buy(target.id,weapon),`buy ${weapon}`);
  const slot=(weapon==='glock'||weapon==='usp'||weapon==='deagle')?1:0;
  for(let seq=1;seq<=90;seq++){s.setInput(target.id,{...EMPTY_INPUT,seq,slot});s.step();}
  assert.equal(target.weapon,weapon);target.armor=0;
  s.damage(target,shooter,999,true);target.respawn=999;
  const first=s.snapshot('shooter'),drop=first.droppedWeapons?.[0];
  assert(drop,`${team}/${weapon}: missing authoritative drop`);assert.equal(drop.weapon,weapon);
  assert.equal(drop.ownerId,target.id);assert(first.players.find(p=>p.id===target.id)?.sourceRagdoll?.quaternions?.length===64);
  const originalPosition=[...drop.position];drop.position[0]+=100;
  assert.deepEqual(s.snapshot().droppedWeapons![0].position,originalPosition,'snapshot must not alias authority');
  const before=s.snapshot(),timeline=new RemoteTimeline();timeline.push(before,1000);s.step();timeline.push(s.snapshot(),1016.67);
  const remote=timeline.sample(1110);assert(remote?.droppedWeapons.length===1,'remote timeline must preserve drop');
  let dropSlept=false,corpseSlept=false;const durations=[];
  for(let tick=0;tick<1800;tick++){const start=performance.now();s.step();durations.push(performance.now()-start);const state=s.droppedWeapons.read()[0];dropSlept ||= state.sleeping;corpseSlept ||= !!target.sourceRagdoll?.settled;if(dropSlept&&corpseSlept)break;}
  const settled=s.snapshot(),end=settled.droppedWeapons![0];if(!dropSlept||!corpseSlept){mkdirSync('output/fidelity-fixes-2026-09-13',{recursive:true});writeFileSync('output/fidelity-fixes-2026-09-13/death-drop-failure.json',JSON.stringify({team,weapon,initial:before,settled,dropSlept,corpseSlept},null,2));}assert(dropSlept,`${team}/${weapon}: drop did not settle`);assert(corpseSlept,`${team}/${weapon}: corpse did not settle`);
  assert(end.position[1]>originalPosition[1]-4,`${weapon} fell through floor`);
  results.push({team,weapon,initial:before,settled,dropSlept,corpseSlept,simulationMsP95:durations.sort((a,b)=>a-b)[Math.floor(durations.length*.95)]});
  s.nextRound();assert.equal(s.snapshot().droppedWeapons?.length,0,'round must clear original drop rigid bodies');
  console.log(`${team}/${weapon}: death, independent drop, full rigid snapshot, remote playback, floor, sleep and round cleanup passed`);
 }finally{s.dispose();}
}
mkdirSync('output/fidelity-fixes-2026-09-13',{recursive:true});writeFileSync('output/fidelity-fixes-2026-09-13/death-drop-integration.json',JSON.stringify({kind:'actual-simulation-original-map',cases:results.length,results},null,2)+'\n');
