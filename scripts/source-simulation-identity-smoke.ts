import {SOURCE_DEAGLE_CHARACTERS} from '../game/source-deagle-character-contracts.js';
import {SOURCE_AWP_CHARACTERS} from '../game/source-awp-character-contracts.js';
// Real SDK/room admission check with an isolated server and original local data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {get} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {Room} from '@colyseus/sdk';
import {Client} from '@colyseus/sdk';
import {SOURCE_DUST2_ID,sourceSimulationVersion} from '../game/source-identity.js';
import {sourceRifleSimulationVersion,sourceGlockSimulationVersion,sourceUSPSimulationVersion,sourceDeagleSimulationVersion,sourceAWPSimulationVersion} from '../game/source-rifle-profiles.js';
import {SOURCE_PISTOL_CHARACTERS} from '../game/source-pistol-character-contracts.js';
import {WEB_VERSION} from '../game/protocol.js';
import type {Snapshot} from '../game/types.js';
const cwd=fileURLToPath(new URL('..',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../public/source/csgo-12426148/dust2/manifest.json',import.meta.url),'utf8'));
const poseReceipt=async(folder:string)=>JSON.parse(await readFile(new URL('../public/source/csgo-12426148/'+folder+'/manifest.json',import.meta.url),'utf8'));
const variants={amber:{vandal:await poseReceipt('character-ak'),m4a4:await poseReceipt('character-t-m4')},blue:{vandal:await poseReceipt('character-ct-ak'),m4a4:await poseReceipt('character-ct-m4')}};
const glocks={amber:SOURCE_PISTOL_CHARACTERS['t-glock'],blue:SOURCE_PISTOL_CHARACTERS['ct-glock']};
const usps={amber:SOURCE_PISTOL_CHARACTERS['t-usp'],blue:SOURCE_PISTOL_CHARACTERS['ct-usp']};
const uspVersion=sourceUSPSimulationVersion(sourceGlockSimulationVersion(sourceRifleSimulationVersion(sourceSimulationVersion(manifest.files),variants),glocks),usps);
const deagles={amber:SOURCE_DEAGLE_CHARACTERS['t-deagle'],blue:SOURCE_DEAGLE_CHARACTERS['ct-deagle']};
const previousVersion=sourceDeagleSimulationVersion(uspVersion,deagles);
const version=sourceAWPSimulationVersion(previousVersion,{amber:SOURCE_AWP_CHARACTERS['t-awp'],blue:SOURCE_AWP_CHARACTERS['ct-awp']});
const stale=sourceUSPSimulationVersion(sourceGlockSimulationVersion(sourceRifleSimulationVersion(sourceSimulationVersion({...manifest.files,collision:{sha256:'0'.repeat(64)}}),variants),glocks),usps);
const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
const endpoint=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd,
  env:{...process.env,HOST:'127.0.0.1',PORT:String(port),WEB_ROOT:cwd+'/public',ALLOWED_ORIGINS:endpoint,MAX_ROOMS:'2'},stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);
const joined:Room[]=[];const snapshots=new Map<string,Snapshot>();
const timeout=setTimeout(()=>child.kill('SIGTERM'),60000);
async function until(check:()=>boolean|Promise<boolean>){
  const end=Date.now()+15000;
  while(Date.now()<end){if(child.exitCode!==null||child.signalCode!==null)throw Error('Server exited: '+log);if(await check())return;await delay(30);}
  throw Error('Source identity smoke timed out: '+log);
}
const rooms=async()=>((await(await fetch(endpoint+'/api/rooms')).json())as {rooms:any[]}).rooms;
function watch(room:Room){joined.push(room);room.reconnection.enabled=false;room.onMessage('snapshot',(s:Snapshot)=>snapshots.set(room.sessionId,s));room.onMessage('roomInfo',()=>{});room.onMessage('notice',()=>{});return room;}
let failure:unknown;
try{
  await until(async()=>{try{return(await fetch(endpoint+'/health')).ok;}catch{return false;}});
  const sourceUrl=endpoint+'/source/csgo-12426148/dust2/manifest.json';
  const head=await fetch(sourceUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),'no-cache');
  const etag=head.headers.get('etag');assert.ok(etag);
  // Node fetch injects request Cache-Control:no-cache for conditional requests,
  // which explicitly disables Express freshness. Use a normal conditional GET.
  const unchangedStatus=await new Promise<number|undefined>((resolve,reject)=>get(sourceUrl,{headers:{'If-None-Match':etag}},res=>{
    res.resume();res.once('end',()=>resolve(res.statusCode));}).once('error',reject));
  assert.equal(unchangedStatus,304);
  const a=new Client(endpoint),b=new Client(endpoint);
  const options={version:WEB_VERSION,mapId:SOURCE_DUST2_ID,code:'PHYV01',simulationVersion:version,name:'Version host'};
  await assert.rejects(a.create('operation',{...options,simulationVersion:previousVersion}),/SIMULATION_MISMATCH/);
  await assert.rejects(a.create('operation',{...options,simulationVersion:stale}),/SIMULATION_MISMATCH/);
  await assert.rejects(a.create('operation',{...options,simulationVersion:undefined}),/SIMULATION_MISMATCH/);
  assert.equal((await rooms()).length,0,'failed creation must release room code/count');
  const host=watch(await a.create('operation',options));
  await until(()=>snapshots.has(host.sessionId));
  await assert.rejects(b.joinById(host.roomId,{...options,simulationVersion:stale}),/SIMULATION_MISMATCH/);
  await assert.rejects(b.joinById(host.roomId,{...options,simulationVersion:undefined}),/SIMULATION_MISMATCH/);
  await until(async()=>(await rooms())[0]?.players===1);
  assert.equal((await rooms())[0].bots,9,'stale peer must not consume a player seat');
  const peer=watch(await b.joinById(host.roomId,{...options,name:'Version peer'}));
  await until(()=>!!snapshots.get(peer.sessionId)?.players.some(p=>p.id===peer.sessionId));
  for(const s of snapshots.values())assert.equal(s.simulationVersion,version);
  const info=(await rooms())[0];assert.equal(info.simulationVersion,version);assert.equal(info.players,2);assert.equal(info.bots,8);
  // Real wire validation: cosmetics are bound to the sending seat, and invalid
  // updates cannot clear a valid selection or inject arbitrary player fields.
  const finish={weapon:'vandal',paintKitId:282,seed:422,wear:Math.fround(.4)};
  const player=(s:Snapshot,id:string)=>s.players.find(p=>p.id===id)!;
  const allHave=(id:string,value:unknown)=>[...snapshots.values()].every(s=>JSON.stringify(player(s,id)?.sourceWeaponFinish)===JSON.stringify(value));
  host.send('sourceFinish',{...finish,playerId:peer.sessionId,hp:999,primary:'deagle',parameters:{}});
  await until(()=>allHave(host.sessionId,finish));
  for(const s of snapshots.values()){assert.equal(player(s,peer.sessionId).sourceWeaponFinish,undefined);assert.notEqual(player(s,host.sessionId).hp,999);assert.deepEqual(Object.keys(player(s,host.sessionId).sourceWeaponFinish!).sort(),['paintKitId','seed','weapon','wear']);}
  const peerFinish={...finish,seed:1000,wear:Math.fround(.7)};
  peer.send('sourceFinish',peerFinish);await until(()=>allHave(peer.sessionId,peerFinish));assert.ok(allHave(host.sessionId,finish));
  const invalidFinishes=[false,282,'default',[],{}, {...finish,seed:'422'}, {...finish,seed:-1}, {...finish,seed:1001}, {...finish,seed:1.5}, {...finish,seed:NaN}, {...finish,wear:'0.4'}, {...finish,wear:NaN}, {...finish,wear:Infinity}, {...finish,wear:.099999999}, {...finish,wear:.700000001}, {...finish,paintKitId:283}, {...finish,weapon:'m4a4'}];
  let pong=0;host.onMessage('pong',(value:number)=>pong=value);
  const tick=snapshots.get(host.sessionId)!.tick,nonce=Date.now();
  for(const invalid of invalidFinishes)host.send('sourceFinish',invalid);
  host.send('ping',nonce);await until(()=>pong===nonce&&[...snapshots.values()].every(s=>s.tick>tick+3));
  assert.ok(allHave(host.sessionId,finish));assert.ok(allHave(peer.sessionId,peerFinish));
  const boundaryFinish={...finish,seed:0,wear:Math.fround(.1)};
  host.send('sourceFinish',boundaryFinish);await until(()=>allHave(host.sessionId,boundaryFinish));
  host.send('sourceFinish',null);await until(()=>allHave(host.sessionId,undefined));assert.ok(allHave(peer.sessionId,peerFinish));
  peer.send('sourceFinish',null);await until(()=>allHave(peer.sessionId,undefined));
  await peer.leave();joined.splice(joined.indexOf(peer),1);await host.leave();joined.splice(joined.indexOf(host),1);
  await until(async()=>(await rooms()).length===0);
  await mkdir(cwd+'/output/tests',{recursive:true});
  await writeFile(cwd+'/output/tests/source-simulation-identity.json',JSON.stringify({status:'passed',simulationVersion:version,
    sourceBspSha256:manifest.sourceBspSha256,rejectedPreviousUSPCreate:true,rejectedStaleCreate:true,rejectedMissingCreate:true,rejectedStaleJoin:true,
    rejectedMissingJoin:true,failedCreateCodeReleased:true,stalePeerConsumesNoSeat:true,matchingPeers:2,snapshotIdentity:true,roomCleanup:true,
    sourceCacheRevalidation:true,unchangedManifestStatus:304,
    sourceFinish:{realSDKClients:2,senderBound:true,minimalPayload:true,independentSelections:true,invalidPacketsPreserveSelection:invalidFinishes.length,seedAndWearEndpoints:true,explicitNullRestoresDefault:true}},null,2)+'\n');
}catch(error){failure=error;}finally{
  clearTimeout(timeout);for(const room of joined)try{await room.leave();}catch{}
  child.kill('SIGTERM');await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',()=>resolve());});
  await writeFile(cwd+'/output/source-simulation-identity-server.log',log);
}
if(failure)throw failure;
