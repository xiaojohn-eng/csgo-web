/** Original Dust II economy through real room/SDK messages, with no server-state mutation.
 * Run only against an explicitly selected candidate. Two connections on one host
 * are transport evidence, not two physical devices or browser gameplay acceptance.
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseArgs} from 'node:util';
import type {Room} from '@colyseus/sdk';
import WebSocket from 'ws';
import {WEB_VERSION} from '../game/protocol.js';
import {SOURCE_DUST2_ID} from '../game/source-identity.js';
import {EMPTY_INPUT,type Player,type Snapshot} from '../game/types.js';

const {values}=parseArgs({options:{'server-url':{type:'string'},'peer-url':{type:'string'},'simulation-version':{type:'string'},baseline:{type:'string'},output:{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('node --import tsx scripts/verify-source-economy-lan.ts --server-url http://CANDIDATE:PORT [--peer-url http://LAN:PORT] (--simulation-version ID | --baseline JSON) [--output JSON]');process.exit(0);}
function origin(raw:string|undefined){assert.ok(raw,'Pass --server-url or BASE_URL explicitly');const u=new URL(raw);assert.ok(['http:','https:'].includes(u.protocol)&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash,'Expected a plain HTTP origin');return u.origin;}
const base=origin(values['server-url']??process.env.BASE_URL),peer=origin(values['peer-url']??base);
const version=values['simulation-version']??(values.baseline?JSON.parse(await readFile(resolve(values.baseline),'utf8')).simulationVersion:undefined);
assert.equal(typeof version,'string','Pass the current candidate Source simulation identity');
const output=resolve(values.output??'output/goal-economy-2026-09-13/sdk-economy.json');
globalThis.WebSocket=WebSocket as unknown as typeof globalThis.WebSocket;
const {Client}=await import('@colyseus/sdk');
type Observed={room:Room;origin:string;snapshot?:Snapshot;notices:string[];errors:string[];sequence:number};
const clients:Observed[]=[],cases:unknown[]=[],ids:string[]=[];
const evidence:Record<string,unknown>={at:new Date().toISOString(),scope:'Two real SDK clients on one physical host; production room/simulation and ordinary messages. No injected authority state, no browser/device/performance claim.',base,peer,simulationVersion:version,cases};
const roomCode=()=>Array.from(randomBytes(3),byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
type Health={status:string;version:string;instanceId:string|null};
type Directory={rooms:{roomId:string}[]};
const failText=(e:unknown)=>e instanceof Error?e.stack??e.message:String(e);
let failure:unknown;
async function json<T>(url:string):Promise<T>{const r=await fetch(url,{signal:AbortSignal.timeout(5000)});assert.equal(r.status,200,url);return await r.json() as T;}
async function until(check:()=>boolean|Promise<boolean>,label:string,timeout=6000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(25);}throw Error(`Timeout: ${label}`);}
function watch(room:Room,endpoint:string){const c:Observed={room,origin:endpoint,notices:[],errors:[],sequence:0};clients.push(c);room.reconnection.enabled=false;room.onMessage('snapshot',(s:Snapshot)=>c.snapshot=s);room.onMessage('notice',(m:unknown)=>c.notices.push(String(m)));room.onMessage('roomInfo',()=>{});room.onError((code,message)=>c.errors.push(`${code}: ${message}`));return c;}
function own(c:Observed){const p=c.snapshot?.players.find(p=>p.id===c.room.sessionId);assert.ok(p,'Authoritative own seat snapshot required');return p;}
function resources(p:Player){return {primary:p.primary,weapon:p.weapon,secondary:p.secondary,slot:p.slot,money:p.money,armor:p.armor,helmet:!!p.helmet,defuseKit:!!p.defuseKit,grenades:p.grenades,smokes:p.smokes,flashes:p.flashes};}
async function buy(c:Observed,item:string,cost:number,verify:(p:Player)=>void){const before=resources(own(c)),tick=c.snapshot!.tick;c.room.send('buy',item);await until(()=>c.snapshot!.tick>tick&&own(c).money===before.money-cost,`buy ${item}`);verify(own(c));cases.push({rules:c.snapshot!.rules,item,accepted:true,before,after:resources(own(c)),tick:c.snapshot!.tick});}
async function reject(c:Observed,item:string){const before=resources(own(c)),n=c.notices.length,tick=c.snapshot!.tick;c.room.send('buy',item);await until(()=>c.notices.length>n&&c.snapshot!.tick>tick,`refuse ${item}`);assert.deepEqual(resources(own(c)),before,`Refused ${item} must be atomic`);cases.push({rules:c.snapshot!.rules,item,accepted:false,notice:c.notices.at(-1),before,after:resources(own(c))});}
async function close(group:Observed[]){for(const c of [...group].reverse())await c.room.leave(true);for(const c of group){const i=clients.indexOf(c);if(i>=0)clients.splice(i,1);}}
try{
 const health=await Promise.all([base,peer].map(o=>json<Health>(`${o}/health`)));for(const h of health){assert.equal(h.status,'ok');assert.equal(h.version,WEB_VERSION);}assert.ok(health[0].instanceId,'Candidate must have CSGO_INSTANCE_ID set for transport identity verification');assert.equal(health[0].instanceId,health[1].instanceId);evidence.health=health;
 const oldVersion=version.slice(0,version.lastIndexOf(':'));
 await assert.rejects(async()=>{const room=await new Client(base,{headers:{Origin:base}}).create('operation',{version:WEB_VERSION,mapId:SOURCE_DUST2_ID,simulationVersion:oldVersion,code:roomCode(),name:'旧库存协议验收'});ids.push(room.roomId);watch(room,base);throw Error('Old inventory client was accepted');},(error:unknown)=>{
   // Colyseus exposes the symbolic rejection as code 523 while the message
   // only contains the localized server text. Accept either representation.
   return typeof error==='object'&&error!==null&&('code' in error)&&((error as {code?:unknown}).code===523)
     || /SIMULATION_MISMATCH/.test(String(error));
 });
 cases.push({oldInventoryClientRejected:true});
 for(const rules of ['competitiveShort','competitive']as const){
  const code=roomCode();const options={version:WEB_VERSION,mapId:SOURCE_DUST2_ID,simulationVersion:version,rules,code,roomName:`经济验收 ${code}`};
  const t=watch(await new Client(base,{headers:{Origin:base}}).create('operation',{...options,name:'经济验收 T'}),base);ids.push(t.room.roomId);
  const ct=watch(await new Client(peer,{headers:{Origin:peer}}).joinById(t.room.roomId,{...options,name:'经济验收 CT'}),peer);
  await until(()=>!!t.snapshot?.players.find(p=>p.id===t.room.sessionId)&&!!ct.snapshot?.players.find(p=>p.id===ct.room.sessionId),'both initial seats');
  for(const c of [t,ct]){assert.equal(c.snapshot!.rules,rules);assert.equal(c.snapshot!.simulationVersion,version);assert.equal(c.snapshot!.mapId,SOURCE_DUST2_ID);assert.equal(c.snapshot!.phase,'buy');const p=own(c);assert.equal(p.primary,null);assert.equal(p.slot,1);assert.equal(p.weapon,p.team==='amber'?'glock':'usp');assert.equal(p.money,800);assert.equal(p.grenades+p.smokes+p.flashes,0);assert.equal(p.armor,0);assert.equal(!!p.defuseKit,false);cases.push({rules,initial:true,team:p.team,resources:resources(p)});}
  assert.equal(own(t).team,'amber');assert.equal(own(ct).team,'blue');

  await reject(t,'vandal');await reject(ct,'m4a4');await reject(t,'usp');await reject(ct,'glock');await reject(t,'defuseKit');
  await buy(t,'flash',200,p=>assert.equal(p.flashes,1));await buy(t,'flash',200,p=>assert.equal(p.flashes,2));await reject(t,'flash');
  await buy(t,'he',300,p=>assert.equal(p.grenades,1));await reject(t,'smoke');
  await buy(ct,'defuseKit',400,p=>assert.equal(p.defuseKit,true));await reject(ct,'defuseKit');
  await buy(ct,'smoke',300,p=>assert.equal(p.smokes,1));await reject(ct,'flash');
  // Exercise the real Source room's freeze-time item path with its original
  // character/physics data. No authority state or resources are injected.
  for(const c of [t,ct]){
    const pistol=own(c).weapon,ammo=own(c).ammo,reserve=own(c).reserve;
    c.room.send('input',{...EMPTY_INPUT,seq:++c.sequence,slot:1,drop:true,time:c.snapshot!.time});
    await until(()=>own(c).weapon==='knife'&&own(c).secondary===undefined,'freeze-time pistol drop');
    const drop=c.snapshot!.droppedWeapons?.find(d=>d.ownerId===c.room.sessionId&&d.weapon===pistol);
    assert.ok(drop,'Dropped sidearm must exist in the world snapshot');
    assert.deepEqual([drop.ammo,drop.reserve],[ammo,reserve]);
    const tick=c.snapshot!.tick;
    await until(()=>c.snapshot!.tick>=tick+5,'retained one-shot input ticks');
    assert.equal(c.snapshot!.droppedWeapons?.filter(d=>d.ownerId===c.room.sessionId).length,1);
    c.room.send('input',{...EMPTY_INPUT,seq:++c.sequence,slot:2,use:true,time:c.snapshot!.time});
    await until(()=>own(c).secondary===pistol,'reclaim dropped sidearm');
    for(let i=0;i<4;i++){
      c.room.send('input',{...EMPTY_INPUT,seq:++c.sequence,slot:1,use:true,time:c.snapshot!.time});
      await delay(20);
    }
    await until(()=>own(c).ack>=c.sequence,'held-use input acknowledgement');
    assert.deepEqual([own(c).weapon,own(c).ammo,own(c).reserve],[pistol,ammo,reserve]);
    assert.equal(c.snapshot!.droppedWeapons?.some(d=>d.id===drop.id),false);
    cases.push({rules,freezePistolTransfer:true,team:own(c).team,dropId:drop.id,
      retainedAmmo:[ammo,reserve],heldUseDoesNotSwap:true,resources:resources(own(c))});
  }
  await until(()=>t.snapshot!.phase==='live','natural freeze exit before testing slot selection',20000);
  assert.equal(own(t).alive,true,'Live slot test requires a living player');
  const tick=t.snapshot!.tick;t.room.send('input',{...EMPTY_INPUT,seq:++t.sequence,yaw:own(t).yaw,pitch:own(t).pitch,slot:0,time:t.snapshot!.time});await until(()=>t.snapshot!.tick>tick&&own(t).ack>=t.sequence,'empty primary slot acknowledgement');assert.equal(own(t).weapon,'glock');assert.equal(own(t).primary,null);cases.push({rules,emptyPrimarySelection:true,resources:resources(own(t))});
  for(const c of [t,ct])assert.deepEqual(c.errors,[]);
  await close([t,ct]);await until(async()=>!(await json<Directory>(`${base}/api/rooms`)).rooms.some((r:{roomId:string})=>r.roomId===t.room.roomId),'dedicated economy room cleanup');
 }
}catch(e){failure=e;evidence.failure=failText(e);}finally{
 const cleanupErrors:string[]=[];for(const c of [...clients].reverse()){try{await c.room.leave(true);}catch(e){cleanupErrors.push(failText(e));}}
 try{await until(async()=>!(await json<Directory>(`${base}/api/rooms`)).rooms.some((r:{roomId:string})=>ids.includes(r.roomId)),'all dedicated rooms removed');}catch(e){cleanupErrors.push(failText(e));}
 if(cleanupErrors.length&&!failure)failure=Error(cleanupErrors.join('\n'));evidence.cleanup={roomIds:ids,removed:cleanupErrors.length===0,errors:cleanupErrors};evidence.status=failure?'failed':'passed';evidence.completedAt=new Date().toISOString();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
}
console.log(JSON.stringify({status:evidence.status,cases:cases.length,output}));if(failure)throw failure;
