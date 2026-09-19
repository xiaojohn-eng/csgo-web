import { eyeOrigin } from './character-contract.js';
import {SOURCE_DEFAULT_RULE_SET,type SourceRuleSetId} from './source-gamemode';
import {SOURCE_DUST2_ID,LEGACY_MAP_ID,DUST2_BSP_SHA256} from './source-identity';
import type {SourceScenario} from './source-scenario';
import {SOURCE_BUY_ZONES} from './source-buy-zone-data';
import {createSourceRifleProfiles} from './source-rifle-profiles';
import {sourcePurchasedSlot} from './source-buy-confirmation';
import {SOURCE_OBJECTIVE_TIMERS} from './source-economy';
import {validSourceWeaponFinish,sourceFinishWeapon,type SourceWeaponFinish} from './source-weapon-finish';
import { RemoteTimeline } from './pose-timeline.js';
import { FramePerformance } from './frame-performance';
import { WEB_VERSION } from './protocol.js';
import { validSkinId, type SkinId } from './skin-catalog';
import { sourceImpactDraws } from './source-impact-table';
import { SOURCE_IMPACT_TABLE } from './source-impact-table-data';
import { cycleSpectatorTarget, selectSpectatorTarget } from './spectator';
import { DEFAULT_KEYBINDS, readKeybinds, type Keybinds } from './keybinds';
import { shotDirection, registerShot, shotSpread, canPredictShot } from './handling';
import { Client, type Room } from '@colyseus/sdk';
import { Simulation, initPhysics } from './simulation';
import { Art } from './scene';
import { wallDistance, sight } from './map';
import { AudioEngine } from './audio';
import {
  EMPTY_INPUT,
  WEAPONS,
  type Snapshot,
  type Input,
  type Mode,
  type Player,
  type WeaponId,
  type Utility,
  type Event as GameEvent,
} from './types';
export type Settings = {
  sensitivity: number;
  volume: number;
  fov: number;
  quality: string;
  crosshair: string;
  keybinds: Keybinds;
};
export type View = {
  sourceFinishStatus?:{status:'default'|'loading'|'ready'|'error';key?:string;error?:string};
  mapId?:string;
  snapshot: Snapshot | null;
  player: Player | null;
  ready: boolean;
  paused: boolean;
  active: boolean;
  fps: number;
  ping: number;
  status: string;
  error: string;
  hit: boolean;
  damage: number;
  board: boolean;
  buy: boolean;
  online: boolean;
  roomCode: string;
  reload: number;
  scoped: boolean;
  spread: number;
  /** Living teammate currently followed after the local combat life ends. */
  spectatorTarget: Player | null;
};
export type RoomRecoveryRecord = {
  endpoint: string;
  token: string;
  code: string;
  name: string;
  roomName: string;
  mapId: string;
  savedAt: number;
};
const ROOM_RECOVERY_KEY = 'breachline.room-recovery';
export function readRoomRecovery(): RoomRecoveryRecord | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ROOM_RECOVERY_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.endpoint !== 'string' || typeof row.token !== 'string' || !row.token ||
      typeof row.code !== 'string' || typeof row.name !== 'string' || typeof row.roomName !== 'string' ||
      typeof row.mapId !== 'string' || typeof row.savedAt !== 'number') return null;
    return row as RoomRecoveryRecord;
  } catch { return null; }
}
export function clearRoomRecovery() {
  try { localStorage.removeItem(ROOM_RECOVERY_KEY); } catch {}
}
function saveRoomRecovery(record: RoomRecoveryRecord) {
  try { localStorage.setItem(ROOM_RECOVERY_KEY, JSON.stringify(record)); } catch {}
}
export class Game {
  mapId:string=LEGACY_MAP_ID;
  sourceScenario?:SourceScenario;
  eyeOrigin(p:Player){
    const sim=this.sim??this.prediction;if(sim)return sim.eyeOrigin(p);
    const profile=this.sourceScenario?.level.player??this.art?.sourceMap?.level.player;
    return profile?{x:p.x,y:p.y+profile[p.crouch?'crouching':'standing'].eyeHeight,z:p.z}:eyeOrigin(p);
  }
  sight(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}){
    const sim=this.sim??this.prediction;return sim?sim.sight(a,b):this.mapId===LEGACY_MAP_ID?sight(a,b):false;
  }
  wallDistance(x:number,y:number,z:number,dx:number,dy:number,dz:number){
    const sim=this.sim??this.prediction;return sim?sim.wallDistance(x,y,z,dx,dy,dz):this.mapId===LEGACY_MAP_ID?wallDistance(x,y,z,dx,dy,dz):Infinity;
  }
  skin: SkinId = 'default';
  sourceWeaponFinish:SourceWeaponFinish|null=null;
  /** Browser loadout defaults, one per original weapon. Entity slot finishes
   * are authoritative and may differ after a pickup. */
  sourceFinishes:Partial<Record<string,SourceWeaponFinish>>={};
  art: Art;
  audio = new AudioEngine();
  sim: Simulation | null = null;
  room: Room | null = null;
  snapshot: Snapshot | null = null;
  you = 'local';
  keys = new Set<string>();
  pressed = new Set<string>();
  /** Latched utility of the armed grenade hold: the pressed throw key picks
   * the utility once and every input of the hold — including the release,
   * which no longer holds the key that started it — keeps reporting it. */
  grenadeUtility: Utility = 'he';
  firePressed = false;
  yaw = 0;
  pitch = 0;
  firing = false;
  aim = false;
  paused = true;
  active = false;
  ready = false;
  board = false;
  buying = false;
  online = false;
  recovering = false;
  roomCode = '';
  status = '正在加载港区';
  error = '';
  seq = 0;
  seen = 0;
  fps = 0;
  ping = 0;
  pending: Input[] = [];
  disposed = false;
  private connectEpoch = 0;
  private synchronizedRoom: Room | null = null;
  settings: Settings = {
    sensitivity: 1,
    volume: 0.45,
    fov: 78,
    quality: 'high',
    crosshair: '#b9efcb',
    keybinds: { ...DEFAULT_KEYBINDS },
  };
  frameId = 0;
  acc = 0;
  last = 0;
  uiClock = 0;
  footClock = 0;
  beepClock = 0;
  readonly framePerformance = new FramePerformance();
  get frameTiming() { return this.framePerformance.snapshot(); }
  remote: Snapshot | null = null;
  remoteTimeline = new RemoteTimeline();
  renderTime: number | null = null;
  remoteEvents: { event: GameEvent; time: number }[] = [];
  prediction: Simulation | null = null;
  predicted: Player | null = null;
  predictionEvents = 0;
  predictedShots = new Set<number>();
  private pendingBuyWeapon:WeaponId|null=null;
  /** Explicit number-key slot edges are sent once and held until authority ack. */
  private pendingSlotSelect: 0|1|2|null = null;
  private requestedSlot: 0|1|2|null = null;
  private requestedSlotSeq: number|null = null;
  /** Client camera choice only; authority still owns all player state. */
  spectatorTargetId: string | null = null;
  lastReload = 0;
  controller = new AbortController();
  constructor(
    public canvas: HTMLCanvasElement,
    public update: (v: View) => void,
  ) {
    const source=typeof location!=='undefined'&&new URLSearchParams(location.search).get('map')==='de_dust2';
    this.mapId=source?SOURCE_DUST2_ID:LEGACY_MAP_ID;
    this.status=source?'正在加载 Dust II':'正在加载港区';
    this.art = new Art(canvas,source);
    this.art.assets.onSourceSound=event=>{this.audio.sourceRifleEvent(event);};
    this.art.assets.onSourcePistolSound=(weapon,event)=>{this.audio.sourceWeaponEvent(weapon,event);};
    this.art.resolveEye=p=>this.eyeOrigin(p);
    // The client owns the original level for prediction, so a presentation prop
    // that falls and the original foot IK can sample the real surface.
    const ground=(x:number,z:number,fromY:number)=>this.sim?.sourceLevel?.groundHeight(x,z,fromY)??this.prediction?.sourceLevel?.groundHeight(x,z,fromY)??null;
    this.art.resolveGround=ground;
    this.art.assets.resolveGround=ground;
    this.art.assets.resolveGroundNormal=(x,z,fromY)=>{
      const level=this.sim?.sourceLevel??this.prediction?.sourceLevel;
      const hit=level?.traceBullet(x,fromY,z,0,-1,0,512,'projectile');
      return hit?{x:hit.nx,y:hit.ny,z:hit.nz}:null;
    };
    // The casings' own `Collision via traces` asks the same level the bullets ask, so a casing
    // that meets a wall is answered by that wall rather than passing through it.
    this.art.sourceShellTrace=(from,to)=>{
      const level=this.sim?.sourceLevel??this.prediction?.sourceLevel;if(!level)return null;
      const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],length=Math.hypot(dx,dy,dz);
      if(!(length>0))return null;
      const hit=level.traceBullet(from[0],from[1],from[2],dx,dy,dz,length);
      if(!hit||!(hit.distance>0)||hit.distance>=length-1e-6)return null;
      return {x:hit.x,y:hit.y,z:hit.z,nx:hit.nx,ny:hit.ny,nz:hit.nz};
    };
    this.install();
    this.frameId = requestAnimationFrame(this.frame);
    void Promise.all([initPhysics(), this.art.ready,this.audio.prepare(source).then(()=>source?Promise.all([this.audio.preparePistols(),this.audio.preparePistolCommands(),this.audio.prepareDeagle(),this.audio.prepareAWP(),this.audio.prepareImpacts(),this.audio.prepareExplosions()]):undefined)])
      .then(() => {
        if (this.disposed) return;
        if(source){
          const map=this.art.sourceMap;
          const character=this.art.assets.sourceCharacter;
          const ct=this.art.assets.sourceCT;
          const tM4=this.art.assets.sourceTM4,ctM4=this.art.assets.sourceCTM4;
          const tGlock=this.art.assets.sourceGlockCharacters.amber,ctGlock=this.art.assets.sourceGlockCharacters.blue;
          const tDeagle=this.art.assets.sourceDeagleCharacters.amber,ctDeagle=this.art.assets.sourceDeagleCharacters.blue;
          const tUSP=this.art.assets.sourceUSPCharacters.amber,ctUSP=this.art.assets.sourceUSPCharacters.blue;
          const tAWP=this.art.assets.sourceAWPCharacters.amber,ctAWP=this.art.assets.sourceAWPCharacters.blue;
          if(!map||!character||!ct||!tM4||!ctM4||!tGlock||!ctGlock||!tUSP||!ctUSP||!tDeagle||!ctDeagle||!tAWP||!ctAWP)throw Error('Original Source scene/team weapons did not load');
          const pose=(asset:typeof character)=>({poseIndex:asset.poseIndex,poseVersion:asset.manifest.poseVersion});
          // The same map's own buy volumes the server scenario carries, so the local training
          // simulation applies the original rule too.
          this.sourceScenario={level:map.level,collision:map.collision,navigation:map.navigation,mapId:this.mapId,simulationVersion:map.stats.simulationVersion,
            buyZones:SOURCE_BUY_ZONES,impacts:SOURCE_IMPACT_TABLE,
            ...createSourceRifleProfiles({amber:{vandal:pose(character),m4a4:pose(tM4)},blue:{vandal:pose(ct),m4a4:pose(ctM4)}},map.stats.simulationVersion,
              {amber:{poseIndex:tGlock.poseIndex,poseVersion:tGlock.manifest.poseVersion},blue:{poseIndex:ctGlock.poseIndex,poseVersion:ctGlock.manifest.poseVersion}},
              {amber:{poseIndex:tUSP.poseIndex,poseVersion:tUSP.manifest.poseVersion},blue:{poseIndex:ctUSP.poseIndex,poseVersion:ctUSP.manifest.poseVersion}},
              {amber:{poseIndex:tDeagle.poseIndex,poseVersion:tDeagle.manifest.poseVersion},blue:{poseIndex:ctDeagle.poseIndex,poseVersion:ctDeagle.manifest.poseVersion}},
              {amber:{poseIndex:tAWP.poseIndex,poseVersion:tAWP.manifest.poseVersion},blue:{poseIndex:ctAWP.poseIndex,poseVersion:ctAWP.manifest.poseVersion}},
              character.ragdollIndex?.data)};
          map.stats.simulationVersion=this.sourceScenario.simulationVersion!;
        }
        this.ready = true;
        this.status = '系统就绪';
        this.notify();
      })
      .catch((error) => {
        // A rejected ready promise used to leave no trace of which original asset it was.
        console.error('source assets failed to load', error);
        this.error = '游戏资源加载失败，请刷新重试';
        this.notify();
      });
    this.notify();
  }
  install() {
    const signal = this.controller.signal;
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape' && this.active) {
          this.pause();
          return;
        }
        if (
          (e.target as HTMLElement)?.closest('input,textarea,[role="slider"]')
        )
          return;
        if (
          [(this.settings?.keybinds ?? DEFAULT_KEYBINDS).jump, 'Tab', (this.settings?.keybinds ?? DEFAULT_KEYBINDS).forward,
            (this.settings?.keybinds ?? DEFAULT_KEYBINDS).left, (this.settings?.keybinds ?? DEFAULT_KEYBINDS).back, (this.settings?.keybinds ?? DEFAULT_KEYBINDS).right].includes(e.code) &&
          this.active
        )
          e.preventDefault();
        if (e.code === 'Tab') this.board = true;
        if (e.code === (this.settings?.keybinds ?? DEFAULT_KEYBINDS).spectatorNext && !e.repeat && this.active) {
          const own = this.snapshot?.players.find((player) => player.id === this.you);
          if (own && !own.alive) {
            const next = cycleSpectatorTarget(this.snapshot?.players ?? [], this.you, this.spectatorTargetId);
            this.spectatorTargetId = next?.id ?? null;
            this.notify();
          }
        }
        if (e.code === 'KeyF' && !e.repeat && this.active && !this.paused) this.art.inspectWeapon();
        if (['KeyR', 'KeyG', 'KeyV', 'KeyQ', 'KeyX', 'Digit1', 'Digit2', 'Digit3'].includes(e.code)) this.art.inspection.cancel();
        if (e.code === (this.settings?.keybinds ?? DEFAULT_KEYBINDS).buy && !e.repeat && this.active) {
          this.buying = !this.buying;
          if (this.buying) this.pause();
          this.notify();
        }
        if (!e.repeat && !this.paused && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3'))
          this.pendingSlotSelect = e.code === 'Digit3' ? 2 : e.code === 'Digit2' ? 1 : 0;
        if (e.code === 'Digit1') this.keys.delete('Digit2');
        if (e.code === 'Digit1') this.keys.delete('Digit3');
        if (!e.repeat && !this.paused) this.pressed.add(e.code);
        if (e.code === 'Digit2') { this.keys.delete('Digit3'); this.keys.add('Digit2'); }
        if (e.code === 'Digit3') { this.keys.delete('Digit2'); this.keys.add('Digit3'); }
        else this.keys.add(e.code);
      },
      { signal },
    );
    document.addEventListener(
      'keyup',
      (e) => {
        if (e.code !== 'Digit2' && e.code !== 'Digit3') this.keys.delete(e.code);
        if (e.code === 'Tab') this.board = false;
      },
      { signal },
    );
    document.addEventListener(
      'mousemove',
      (e) => {
        if (document.pointerLockElement !== this.canvas || this.paused) return;
        this.yaw -= e.movementX * 0.0018 * this.settings.sensitivity;
        this.pitch = Math.max(
          -1.48,
          Math.min(
            1.48,
            this.pitch - e.movementY * 0.0018 * this.settings.sensitivity,
          ),
        );
      },
      { signal },
    );
    this.canvas.addEventListener(
      'mousedown',
      (e) => {
        if (!this.active) return;
        if (document.pointerLockElement !== this.canvas) {
          this.resume();
          return;
        }
        if (e.button === 0) {
          this.art.inspection.cancel();
          this.firing = true;
          this.firePressed = true;
        }
        if (e.button === 2) this.aim = true;
      },
      { signal },
    );
    document.addEventListener(
      'mouseup',
      (e) => {
        if (e.button === 0) this.firing = false;
        if (e.button === 2) this.aim = false;
      },
      { signal },
    );
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault(), {
      signal,
    });
    document.addEventListener(
      'pointerlockchange',
      () => {
        this.paused = document.pointerLockElement !== this.canvas;
        if (this.paused) this.clearInput();
        this.notify();
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        if (this.active) this.pause();
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        this.framePerformance.markVisibility(document.hidden ? 'hidden' : 'visible');
        if (document.hidden && this.active) this.pause();
      },
      { signal },
    );
    window.addEventListener('resize', () => this.art.resize(), { signal });
    this.canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault();
        this.pause();
        this.error = '图形上下文中断，请刷新页面恢复';
        this.notify();
      },
      { signal },
    );
    // Source vertex arrays are dropped after GPU upload (memory: props GLB
    // retains >1GB otherwise), so a restored context cannot re-upload the
    // scene in place — reload rebuilds everything from the verified assets.
    // Without this the render loop crashes on every frame after restore.
    this.canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this.error = '图形设备已恢复，正在重新加载场景';
        this.notify();
        location.reload();
      },
      { signal },
    );
  }
  configure(s: Settings) {
    this.settings = { ...s, keybinds: readKeybinds(s.keybinds) };
    this.audio.setVolume(s.volume);
    if (this.art.quality !== s.quality) this.art.setQuality(s.quality);
  }
  setSkin(value: unknown) {
    this.skin = validSkinId(value);
    this.art.setSkin(this.skin);
    const local = this.sim?.players.find(p => p.id === this.you);
    if (local) local.skin = this.skin;
    if (this.canSendRoomState()) this.room!.send('skin', this.skin);
  }
  setSourceWeaponFinish(value:unknown){
    const finish=validSourceWeaponFinish(value);if(value!==null&&!finish)return;
    this.sourceWeaponFinish=finish;
    this.art.setSourceWeaponFinish(this.sourceWeaponFinish);
    const local=this.sim?.players.find(p=>p.id===this.you);
    if(local){if(this.sourceWeaponFinish)local.sourceWeaponFinish={...this.sourceWeaponFinish};else delete local.sourceWeaponFinish;}
    if(this.sourceScenario&&this.canSendRoomState())this.room!.send('sourceFinish',this.sourceWeaponFinish);
    this.notify();
  }
  setSourceLoadout(weapon:string,value:unknown){
    const finish=value===null?null:validSourceWeaponFinish(value),id=sourceFinishWeapon(weapon);
    if(!id||value!==null&&(!finish||finish.weapon!==id))return;
    if(finish)this.sourceFinishes[id]=finish;else delete this.sourceFinishes[id];
    const local=this.sim?.players.find(p=>p.id===this.you);
    if(local)this.sim?.setSourceFinishLoadout(local.id,id,finish);
    const predicted=this.predicted;
    if(predicted)this.prediction?.setSourceFinishLoadout(predicted.id,id,finish);
    if(local?.weapon===id){this.sourceWeaponFinish=local.sourceWeaponFinish?{...local.sourceWeaponFinish}:null;this.art.setSourceWeaponFinish(this.sourceWeaponFinish);}
    if(this.sourceScenario&&this.canSendRoomState())this.room!.send('sourceFinishLoadout',{weapon:id,finish});
    this.notify();
  }
  start(mode: Mode, name: string) {
    if(!this.ready)return;
    this.leave();
    this.sim = new Simulation(mode,true,this.sourceScenario);
    if(this.sim.sourceLevel)void this.art.setSourceParticleLightingWorld({world:this.sim.world,map:this.sim.sourceLevel.collision});
    const p = this.sim.addPlayer('local', name, 'amber');
    p.skin = this.skin;
    if(this.sourceScenario)for(const [weapon,finish] of Object.entries(this.sourceFinishes)){
      const id=sourceFinishWeapon(weapon);if(id&&finish)this.sim.setSourceFinishLoadout(p.id,id,finish);
    }
    this.sim.fillBots();
    this.you = p.id;
    this.spectatorTargetId = null;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.active = true;
    this.paused = false;
    this.status = mode === 'training' ? '本地训练' : '战术演练 · AI 补位';
    this.snapshot = this.sim.snapshot(this.you);
    this.selectLocalSlot(p.slot);
    this.seen = 0;
    this.seq = 0;
    this.acc = 0;
    this.audio.unlock();
    this.resume();
    this.notify();
  }
  cancelConnect() { this.connectEpoch++; }
  hasStoredRoomRecovery() { return readRoomRecovery() !== null; }
  async reconnectStoredRoom(fallbackName: string) {
    const record = readRoomRecovery();
    if (!record) return false;
    // A reconnection token is scoped to the room, but the browser may have been
    // opened on a different map URL since the last session. Refuse early rather
    // than joining the old room and only discovering the mismatch on its first
    // snapshot; this also prevents a stale token from replacing the current map.
    if (record.mapId !== this.mapId) {
      this.error = '上次席位属于另一张地图，请先打开对应地图后恢复';
      this.notify();
      return false;
    }
    await this.connect(record.endpoint, record.code, record.name || fallbackName, false,
      record.roomName, undefined, undefined, record.token);
    if (!this.online) clearRoomRecovery();
    return this.online;
  }
  async connect(endpoint: string, code: string, name: string, create: boolean,
    roomName = '港区行动', roomId?: string, ruleSet?: SourceRuleSetId, reconnectionToken?: string) {
    if(!this.ready){this.error='地图与人物仍在加载，请稍候';this.notify();return;}
    const epoch = ++this.connectEpoch;
    this.error = '';
    this.status = '正在加入局域网房间';
    this.notify();
    let url: URL;
    try {
      url = new URL(endpoint);
      if (
        !['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
      if (
        location.protocol === 'https:' &&
        !['wss:', 'https:'].includes(url.protocol)
      )
        throw Error();
    } catch {
      this.error = '请输入有效服务器地址；HTTPS 页面需要 WSS/HTTPS 服务';
      this.notify();
      return;
    }
    try {
      const client = new Client(endpoint);
      const options = { code: code.toUpperCase(), name, roomName, version: WEB_VERSION,mapId:this.mapId,simulationVersion:this.sourceScenario?.simulationVersion, rules: create ? ruleSet ?? SOURCE_DEFAULT_RULE_SET : ruleSet };
      let expired = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const request = (
        reconnectionToken
          ? client.reconnect(reconnectionToken)
          : create
          ? client.create('operation', options)
          : roomId ? client.joinById(roomId, options) : client.join('operation', options)
      ).then((room) => {
        if (expired || this.disposed || epoch !== this.connectEpoch) void room.leave();
        return room;
      });
      const room = await Promise.race([
        request,
        new Promise<never>(
          (_, reject) =>
            (timeout = setTimeout(() => {
              expired = true;
              reject(new Error('连接超时'));
            }, 10000)),
        ),
      ]).finally(() => clearTimeout(timeout));
      if (this.disposed || epoch !== this.connectEpoch) {
        void room.leave();
        return;
      }
      this.leave(false, !reconnectionToken);
      this.room = room;
      this.recovering = false;
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 10;
      room.reconnection.maxEnqueuedMessages = 0;
      this.you = room.sessionId;
      this.spectatorTargetId = null;
      this.online = true;
      this.roomCode = code.toUpperCase();
      saveRoomRecovery({ endpoint, token: room.reconnectionToken, code: this.roomCode,
        name, roomName, mapId: this.mapId, savedAt: Date.now() });
      this.active = true;
      this.paused = true;
      this.status = '已连接 · 正在同步席位';
      this.seq = 0;
      this.seen = 0;
      this.pending = [];
      room.onMessage('snapshot', (s: Snapshot) => {
        if (this.room !== room) return;
        if((s.mapId??LEGACY_MAP_ID)!==this.mapId||(this.sourceScenario&&(s.sourceBspSha256!==DUST2_BSP_SHA256||s.simulationVersion!==this.sourceScenario.simulationVersion))){
          this.leave();this.error='房间地图版本与本机资源不一致，请重新选择地图';this.notify();return;
        }
        const previousEvents = this.snapshot?.events ?? [];
        s.events = [...previousEvents, ...s.events].slice(-80);
        this.remote = s;
        this.snapshot = s;
        this.remoteTimeline.push(s, performance.now());
        const own = s.players.find((p) => p.id === this.you);
        if (own) {
          // Authority owns the active slot, except while an explicit number
          // key request is still awaiting its acknowledged input. This keeps a
          // fast local switch responsive while still accepting pickup/drop
          // corrections once the server has consumed the request.
          const requested = this.requestedSlot;
          if (requested === null && this.pendingSlotSelect === null) this.selectLocalSlot(own.slot);
          else if (requested !== null && (own.slot === requested ||
            (this.requestedSlotSeq !== null && own.ack >= this.requestedSlotSeq))) {
            this.requestedSlot = null;
            this.requestedSlotSeq = null;
            this.selectLocalSlot(own.slot);
          }
          const purchasedSlot=sourcePurchasedSlot(this.pendingBuyWeapon,own);
          if(purchasedSlot!==null){this.selectLocalSlot(purchasedSlot);this.pendingBuyWeapon=null;}
          this.pending = this.pending.filter((i) => i.seq > own.ack);
          if (!this.prediction) {
            this.prediction = new Simulation(s.mode, false,this.sourceScenario,s.rules ?? SOURCE_DEFAULT_RULE_SET);
            if(this.prediction.sourceLevel)void this.art.setSourceParticleLightingWorld({world:this.prediction.world,map:this.prediction.sourceLevel.collision});
            this.predicted = this.prediction.addPlayer(
              own.id,
              own.name,
              own.team,
            );
            for(const [weapon,finish] of Object.entries(this.sourceFinishes)){
              const id=sourceFinishWeapon(weapon);if(id&&finish)this.prediction.setSourceFinishLoadout(own.id,id,finish);
            }
          }
          Object.assign(this.predicted!, own);
          for(const key of ['secondary','sourceGlock','sourceUSP','sourceDeagle','sourceAWP','sourceAWPPose','sourcePistolPose','sourcePose','sourcePoseVersion','sourceRagdoll','sourceViewmodelTime','sourceWeaponFinish']as const)
            if(own[key]===undefined)delete this.predicted![key];
          if(own.sourceRifleHandling)this.predicted!.sourceRifleHandling=structuredClone(own.sourceRifleHandling);
          if(own.sourceWeaponFinish)this.predicted!.sourceWeaponFinish={...own.sourceWeaponFinish};
          if(own.sourceGlock)this.predicted!.sourceGlock=structuredClone(own.sourceGlock);
          if(own.sourceDeagle)this.predicted!.sourceDeagle=structuredClone(own.sourceDeagle);
          if(own.sourceAWP)this.predicted!.sourceAWP=structuredClone(own.sourceAWP);
          if(own.sourceAWPPose)this.predicted!.sourceAWPPose=structuredClone(own.sourceAWPPose);
          if(own.sourceUSP)this.predicted!.sourceUSP=structuredClone(own.sourceUSP);
          if(own.sourceViewmodelTime)this.predicted!.sourceViewmodelTime={...own.sourceViewmodelTime};
          if(own.sourcePistolPose)this.predicted!.sourcePistolPose=structuredClone(own.sourcePistolPose);
          this.prediction.time=s.time;this.prediction.tick=s.tick;
          for (const input of this.pending)
            if (own.alive && s.phase === 'live'){
              if(this.sourceScenario)this.prediction.predictSourceCommand(this.predicted!,input);
              else this.prediction.move(this.predicted!, input);
            }
          this.prediction.world.step();
          if (this.synchronizedRoom !== room) {
            const wasRecovering = this.recovering;
            this.recovering = false;
            this.seq = Math.max(this.seq, own.ack);
            this.yaw = own.yaw;
            this.pitch = own.pitch;
            // Discard actions made while waiting; inherit this seat's current weapon.
            this.clearInput();
            this.synchronizedRoom = room;
            room.send('skin', this.skin);
            if(this.sourceScenario){
              for(const finish of Object.values(this.sourceFinishes))if(finish)room.send('sourceFinishLoadout',{weapon:finish.weapon,finish});
              const active=this.sourceWeaponFinish;
              if(active!==undefined)room.send('sourceFinish',active);
            }
            this.status = wasRecovering
              ? '已恢复原席位 · 点击继续行动'
              : '席位已同步 · 点击继续行动';
            this.error = '';
            this.notify();
          }
        }
      });
      room.onMessage('notice', (message: string) => {
        if (this.room !== room) return;
        this.pendingBuyWeapon=null;
        this.error = message;
        this.notify();
      });
      room.onMessage('roomInfo', () => {
        // The authoritative directory owns room membership and host transfer.
      });
      room.onMessage('pong', (sent: number) => {
        this.ping = Math.round(performance.now() - sent);
      });
      room.onDrop(() => {
        if (this.room !== room) return;
        this.synchronizedRoom = null;
        this.recovering = true;
        this.remoteTimeline.reset();
        this.renderTime = null;
        this.remoteEvents = [];
        this.pending = [];
        this.predictedShots.clear();
        room.reconnection.enqueuedMessages.length = 0;
        this.pause();
        this.status = '连接中断 · 正在恢复原席位';
        this.error = '原席位最多保留 30 秒；恢复期间停止移动、射击和购买';
        this.notify();
      });
      room.onReconnect(() => {
        if (this.room !== room || this.disposed) {
          // The SDK may already have scheduled one retry before menu cancellation.
          queueMicrotask(() => { if (room.connection.isOpen) void room.leave(); });
          return;
        }
        this.synchronizedRoom = null;
        this.recovering = true;
        this.remoteTimeline.reset();
        this.renderTime = null;
        this.remoteEvents = [];
        this.pending = [];
        this.predictedShots.clear();
        room.reconnection.enqueuedMessages.length = 0;
        saveRoomRecovery({ endpoint, token: room.reconnectionToken, code: this.roomCode,
          name, roomName, mapId: this.mapId, savedAt: Date.now() });
        this.status = '连接已恢复 · 等待权威状态';
        this.error = '';
        this.notify();
      });
      room.onLeave(() => {
        if (this.room !== room) return;
        this.synchronizedRoom = null;
        this.remoteTimeline.reset();
        this.renderTime = null;
        this.remoteEvents = [];
        this.room = null;
        clearRoomRecovery();
        this.recovering = false;
        this.pause();
        this.error = '连接恢复已结束。返回菜单重新加入时，将接管已有机器人席位。';
        this.status = '连接中断';
        this.notify();
      });
      room.onError(() => {
        if (this.room !== room) return;
        this.error = this.recovering
          ? '正在重试连接；原席位最多保留 30 秒'
          : '联机发生错误，请返回菜单重试';
        this.notify();
      });
      this.audio.unlock();
      this.notify();
    } catch (e) {
      if (epoch !== this.connectEpoch || this.disposed) return;
      this.status = '连接未建立';
      this.error =
        e instanceof Error ? `无法加入：${e.message}` : '无法连接服务器';
      this.notify();
    }
  }
  leave(cancelPending = true, clearRecovery = true) {
    if (cancelPending) this.cancelConnect();
    if (clearRecovery) clearRoomRecovery();
    const room = this.room;
    this.synchronizedRoom = null;
    this.room = null;
    this.recovering = false;
    if (room) {
      room.reconnection.enabled = false;
      room.reconnection.maxRetries = 0;
      room.reconnection.enqueuedMessages.length = 0;
      if (room.connection.isOpen) void room.leave();
    }
    void this.art.setSourceParticleLightingWorld(null);
    this.sim?.dispose();
    this.sim = null;
    this.prediction?.dispose();
    this.prediction = null;
    this.predicted = null;
    this.remote = null;
    this.remoteTimeline.reset();
    this.renderTime = null;
    this.remoteEvents = [];
    this.snapshot = null;
    this.spectatorTargetId = null;
    this.pendingBuyWeapon=null;
    this.pending = [];
    this.online = false;
    this.active = false;
    this.buying = false;
    this.board = false;
    this.error = '';
    this.clearInput();
    this.art.clearEffects();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  private canSendRoomState() {
    return !!this.room && this.synchronizedRoom === this.room &&
      !this.recovering && this.room.connection.isOpen;
  }
  pause() {
    this.paused = true;
    this.clearInput();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.canSendRoomState())
      this.room!.send('input', {
        ...EMPTY_INPUT,
        seq: ++this.seq,
        yaw: this.yaw,
        pitch: this.pitch,
        slot: this.snapshot?.players.find(p => p.id === this.you)?.slot ?? 0,
        time: this.snapshot?.time ?? 0,
      });
    this.notify();
  }
  resume() {
    if (this.room && !this.canSendRoomState()) {
      this.error = this.recovering ? '正在恢复连接，请等待原席位同步' : '正在同步席位，请稍候';
      this.notify();
      return;
    }
    if (!this.active || this.snapshot?.phase === 'match') return;
    this.buying = false;
    this.audio.unlock();
    this.error = '';
    try {
      const promise = this.canvas.requestPointerLock();
      promise?.catch((error: unknown) => {
        console.warn('BREACHLINE pointer lock rejected', error);
        this.paused = true;
        this.error = '请点击「继续行动」捕获鼠标；Esc 可释放';
        this.notify();
      });
    } catch {
      this.error = '此浏览器未允许鼠标捕获，请使用桌面浏览器重试';
    }
    this.notify();
  }
  clearInput() {
    this.art.inspection.cancel();
    const slot = this.snapshot?.players.find(p => p.id === this.you)?.slot;
    this.keys.clear();
    if (slot === 1) this.keys.add('Digit2');
    if (slot === 2) this.keys.add('Digit3');
    this.pressed.clear();
    this.pendingSlotSelect = null;
    this.requestedSlot = null;
    this.requestedSlotSeq = null;
    this.firePressed = false;
    this.firing = false;
    this.aim = false;
  }
  /** Both local and remote authority events share the same original audio path. */
  presentExplosion(event: GameEvent, bomb: {x:number;y:number;z:number}) {
    if (event.type !== 'explode' && event.type !== 'grenade') return;
    const position = {x:event.x??bomb.x,y:event.y??bomb.y,z:event.z??bomb.z};
    this.art.explosion(position.x, position.z, position.y);
    if (this.sourceScenario) this.audio.sourceExplosionEvent(event.type === 'explode' ? 'c4' : 'he', position);
    else this.audio.explosion();
  }
  input(): Input {
    const binds = this.settings?.keybinds ?? DEFAULT_KEYBINDS;
    // The pressed throw key latches the utility for the whole grenade hold:
    // the release input no longer holds the key that started it.
    if (!this.paused && ['KeyG', 'KeyV', 'KeyQ'].some((k) => this.pressed.has(k)))
      this.grenadeUtility = this.pressed.has('KeyV')
        ? 'smoke'
        : this.pressed.has('KeyQ')
          ? 'flash'
          : 'he';
    const selectedSlot = this.keys.has('Digit3') ? 2 : this.keys.has('Digit2') ? 1 : 0;
    const slotSelect = this.pendingSlotSelect !== null;
    const inputSeq = ++this.seq;
    if (slotSelect) {
      this.requestedSlot = selectedSlot;
      this.requestedSlotSeq = inputSeq;
      this.pendingSlotSelect = null;
    }
    const input: Input = {
      ...EMPTY_INPUT,
      seq: inputSeq,
      mx: this.paused
        ? 0
        : (this.keys.has(binds.right) ? 1 : 0) - (this.keys.has(binds.left) ? 1 : 0),
      mz: this.paused
        ? 0
        : (this.keys.has(binds.back) ? 1 : 0) - (this.keys.has(binds.forward) ? 1 : 0),
      yaw: this.yaw,
      pitch: this.pitch,
      jump:
        !this.paused && (this.keys.has(binds.jump) || this.pressed.has(binds.jump)),
      crouch:
        !this.paused && (this.keys.has('ControlLeft') || this.keys.has('KeyC')),
      walk:!this.paused&&(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')),
      fire: !this.paused && (this.firing || this.firePressed),
      reload:
        !this.paused && (this.keys.has('KeyR') || this.pressed.has('KeyR')),
      use: !this.paused && this.keys.has(binds.interact),
      aim: this.aim,
      slot: selectedSlot,
      slotSelect,
      time: this.online ? this.renderTime ?? this.snapshot?.time ?? 0 : this.snapshot?.time ?? 0,
      grenade:
        !this.paused &&
        ['KeyG', 'KeyV', 'KeyQ'].some((k) => this.pressed.has(k)),
      drop: !this.paused && this.pressed.has('KeyX'),
      // The original hold semantics: while the throw key stays down the input
      // reports it held (the press edge arms the pin-pull preparation, the
      // release performs the throw). Paused inputs report no hold state so the
      // authority keeps the armed hold until the keys are actually released.
      // A key tapped between two samples must still report one held tick:
      // otherwise the authority never sees the press, the release has no armed
      // hold to fire, and the tap throws nothing at all. A tap therefore lands
      // as the original overhand release one tick later.
      grenadeHold: this.paused
        ? undefined
        : ['KeyG', 'KeyV', 'KeyQ'].some((k) => this.keys.has(k) || this.pressed.has(k)),
      utility: this.grenadeUtility,
    };
    this.pressed.clear();
    this.firePressed = false;
    return input;
  }
  buy(item: string) {
    if (this.room && !this.canSendRoomState()) {
      this.error = '请等待席位同步后再购买';
      this.notify();
      return;
    }
    if (this.room) {if(this.sourceScenario&&['vandal','m4a4','glock','usp','deagle','awp'].includes(item))this.pendingBuyWeapon=item as WeaponId;this.room.send('buy', item);}
    else if (this.sim) {
      if(!this.sim.buy(this.you, item))this.error = '购买失败：请检查余额、阵营、装备持有上限与购买区时限';
      else this.error='';
      // Local training is paused by the shop, so no simulation tick will
      // publish this purchase until it closes. Refresh its UI snapshot now.
      this.snapshot=this.sim.snapshot(this.you);
      const own=this.snapshot.players.find(p=>p.id===this.you);if(own)this.selectLocalSlot(own.slot);
    }
    this.notify();
  }
  private selectLocalSlot(slot:0|1|2){this.keys.delete('Digit2');this.keys.delete('Digit3');if(slot===1)this.keys.add('Digit2');if(slot===2)this.keys.add('Digit3');}
  restart() {
    if (this.room && !this.canSendRoomState()) {
      this.error = '请等待席位同步后再重新开始';
      this.notify();
      return;
    }
    if (this.room) {
      this.room.send('restart', {});
      this.error = '已请求房主重新开始';
    } else {
      this.sim?.restart();
      this.art.clearEffects();
      const p = this.sim?.players.find((p) => p.id === this.you);
      if (p) {
        this.yaw = p.yaw;
        this.pitch = p.pitch;
      }
      this.snapshot = this.sim?.snapshot(this.you) ?? null;
      const own = this.snapshot?.players.find(player => player.id === this.you);
      if (own) this.selectLocalSlot(own.slot);
      this.resume();
    }
    this.notify();
  }
  /** Present one accepted shot. The authority reports a full-range endpoint even when the
   * bullet hits a player or expires in open air; surface metadata only belongs to decals.
   * Source prediction already plays local brass/flash, and waits for this authoritative ray. */
  private drawShot(event:GameEvent,own:boolean,predictedOwn:boolean){
    if(event.type!=='shot')return;
    // Art keeps the old geometry for the legacy map and only spends ejection on Dust2.
    this.art.trace(event.x!,event.y!,event.z!,event.dx!,event.dy!,event.dz!,own,!predictedOwn);
    if(this.sourceScenario&&event.sourceTracer){
      const [x,y,z]=event.sourceTracer.end;
      this.art.sourceTracerShot(event.by??this.you,event.seq??0,event.weapon??'vandal',
        {x:event.x!,y:event.y!,z:event.z!},{x,y,z});
    }
  }
  frameErrors = 0;
  /** rAF entry: keeps the frame chain alive through single-frame errors so one
   * bad frame (e.g. a transient GL hiccup) cannot freeze the whole game, and
   * trips a circuit breaker after sustained errors so the page stays usable. */
  frame = (now: number) => {
    if (this.disposed) return;
    try {
      this.frameStep(now);
      this.frameErrors = 0;
    } catch (e) {
      this.frameErrors++;
      if (this.frameErrors >= 30) {
        this.error = `渲染持续异常，已停止刷新，请刷新页面（${String((e as Error)?.message ?? e).slice(0, 80)}）`;
        this.notify();
        return;
      }
    } finally {
      if (this.frameErrors < 30) this.frameId = requestAnimationFrame(this.frame);
    }
  };
  private frameStep = (now: number) => {
    if (this.disposed) return;
    const measuredFps = this.framePerformance.record(now, document.hidden ? 'hidden' : 'visible');
    if (!Number.isFinite(now) || now < 0) return;
    // Clamp both ways: a resurrected rAF tick can carry a stale compositor
    // timestamp older than the previous frame's performance.now(), which
    // would otherwise poison the level clock (e.g. tab refocus).
    const dt = Math.max(0, Math.min(0.08, (now - (this.last || now)) / 1000));
    this.last = Math.max(this.last || 0, now);
    this.acc += dt;
    if (measuredFps !== null) {
      this.fps = Math.round(measuredFps);
      if (this.room?.connection.isOpen && !this.recovering) this.room.send('ping', performance.now());
    }
    let ticks = 0;
    while (this.acc >= 1 / 60 && ticks++ < 5) {
      this.acc -= 1 / 60;
      if (this.active) {
        if (this.room && !this.canSendRoomState()) continue;
        const input = this.input();
        if (this.room) {
          this.room.send('input', input);
          if (
            this.predicted &&
            this.snapshot?.phase === 'live' &&
            this.predicted.alive
          ) {
            const sourceShot=this.sourceScenario?this.prediction!.predictSourceCommand(this.predicted,input):false;
            if(!this.sourceScenario)this.prediction!.move(this.predicted, input);
            // Shared wall constraints can reject a pose in an unsolvable narrow gap.
            this.yaw = this.predicted.yaw;
            this.pitch = this.predicted.pitch;
            if(!this.sourceScenario)this.prediction!.world.step();
            if(!this.sourceScenario)this.predicted.cooldown = Math.max(
              0,
              this.predicted.cooldown - 1 / 60,
            );
            if(sourceShot){
              // Knife attacks share the prediction boolean with firearm shots,
              // but have no cartridge, muzzle flash, or gunshot audio. Keep the
              // recoil kick for the authored melee swing and reserve predicted
              // shot de-duplication for events that actually emit a shot.
              if(this.predicted.weapon !== 'knife'){
                this.predictedShots.add(input.seq);
                if(this.predictedShots.size>150)this.predictedShots.delete(this.predictedShots.values().next().value!);
                this.audio.shot(this.predicted.weapon,.9,0,undefined,false,this.predicted.weapon==='usp'?this.predicted.sourceUSP?.command.mode:undefined);this.art.ejectCasing();
                // The shooter's own first-person system, with the same identity-derived seed
                // the world's own pass uses, so a weapon family that draws its own original
                // flash gets this shot's draw rather than a fresh one.
                this.art.sourceFirstPersonFlash(this.predicted.weapon,this.predicted.sourceUSP?.command.mode??0,input.seq,this.you);
              }
              this.art.kick=1;
            }
            if (!this.sourceScenario&&canPredictShot(this.predicted, input, this.pending)) {
              const p = this.predicted,
                w = WEAPONS[p.weapon],
                { dx, dy, dz } = shotDirection(p, input),
                eye = this.eyeOrigin(p),
                distance = Math.min(
                  100,
                  this.wallDistance(eye.x, eye.y, eye.z, dx, dy, dz),
                );
              p.cooldown = w.rate;
              p.ammo--;
              registerShot(p);
              this.predictedShots.add(input.seq);
              if (this.predictedShots.size > 150)
                this.predictedShots.delete(
                  this.predictedShots.values().next().value!,
                );
              this.audio.shot(p.weapon, 0.9);
              this.art.trace(
                eye.x,
                eye.y,
                eye.z,
                dx * distance,
                dy * distance,
                dz * distance,
                true,
              );
              this.art.kick = 1;
            }
            this.pending.push(input);
            if (this.pending.length > 120) this.pending.shift();
          }
        } else if (this.sim && !this.paused) {
          this.sim.setInput(this.you, input);
          this.sim.step();
          const p = this.sim.players.find((p) => p.id === this.you);
          if (p) {
            this.yaw = p.yaw;
            this.pitch = p.pitch;
          }
          this.snapshot = this.sim.snapshot(this.you);
        }
      }
    }
    const s = this.snapshot,
      p = s?.players.find((p) => p.id === this.you);
    if (s && p) {
      const remoteFrame = this.online && !this.recovering ? this.remoteTimeline.sample(now) : null;
      const renderPlayers = remoteFrame?.players ?? s.players;
      const spectator = !p.alive
        ? selectSpectatorTarget(renderPlayers, this.you, this.spectatorTargetId)
        : null;
      this.spectatorTargetId = spectator?.id ?? null;
      const listener = this.eyeOrigin(spectator ?? this.predicted ?? p);
      this.audio.listener(listener.x, listener.y, listener.z, spectator?.yaw ?? this.yaw);
      const events: GameEvent[] = [];
      for (const e of s.events) {
        if (e.id <= this.seen) continue;
        this.seen = e.id;
        if (this.online && e.by !== this.you && ['shot','report','step','weaponSound'].includes(e.type))
          this.remoteEvents.push({ event:e,time:e.time ?? s.time });
        else events.push(e);
      }
      if (remoteFrame) {
        events.push(...this.remoteEvents.filter(e => e.time <= remoteFrame.time).map(e => e.event));
        this.remoteEvents = this.remoteEvents.filter(e => e.time > remoteFrame.time).slice(-512);
      }
      for (const e of events) {
        if(e.type==='weaponSound'&&e.sourceWeaponSound){
          const own=e.by===this.you;
          this.audio.sourceWeaponEvent(e.sourceWeaponSound.weapon,e.sourceWeaponSound.event,.8,0,own?undefined:{x:e.x!,y:e.y!,z:e.z!},
            !own&&!this.sight(this.eyeOrigin(p),{x:e.x!,y:e.y!,z:e.z!}));
        }
        if (e.type === 'shot' || e.type === 'report') {
          const predictedOwn = Boolean(
            this.online &&
            e.by === this.you &&
            e.seq !== undefined &&
            this.predictedShots.delete(e.seq)
          );
          if(predictedOwn&&!e.sourceRifleShot&&!e.sourcePistolShot&&!e.sourceAWPShot)continue;
          const own = e.by === this.you,
            pan = Math.max(
              -1,
              Math.min(
                1,
                ((e.x ?? 0) - p.x) * Math.cos(p.yaw) -
                  ((e.z ?? 0) - p.z) * Math.sin(p.yaw),
              ) / 20,
            );
          if(!predictedOwn)this.audio.shot(
            e.weapon ?? 'vandal',
            0.8,
            own ? 0 : pan,
            own ? undefined : { x: e.x!, y: e.y!, z: e.z! },
            !own &&
              !this.sight(
                this.eyeOrigin(p),
                { x: e.x!, y: e.y!, z: e.z! },
              ),
            e.sourcePistolShot?.mode??e.sourcePistolSoundMode,
          );
          this.drawShot(e, own, predictedOwn);
          // Decals and impact sounds still require an actual world surface; a tracer does not.
          if (e.type === 'shot' && e.impact?.surface) {
            const outcome = this.art.sourceBulletImpact(e.by ?? this.you, e.seq ?? 0, e.impact);
            const sound = this.art.sourceImpactSoundName(e.impact.surface);
            if (outcome?.drawn && sound) {
              const at = { x: e.impact.x, y: e.impact.y, z: e.impact.z };
              const dx = at.x - p.x, dz = at.z - p.z;
              const impactPan = own ? 0 : Math.max(-1, Math.min(1,
                (dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / 20));
              this.audio.sourceImpactEvent(sound, own ? 0.7 : 0.8, impactPan,
                own ? undefined : at, !own && !this.sight(this.eyeOrigin(p), at),
                // One draw chooses both the hole and the wave, so a shot is one of each.
                sourceImpactDraws(e.by ?? this.you, e.seq ?? 0).decal);
            }
          }
          if (own&&!predictedOwn) {
            this.art.kick = 1;
            this.art.sourceFirstPersonFlash(e.weapon??p.weapon,e.sourcePistolShot?.mode??e.sourcePistolSoundMode??0,e.seq??0,e.by??this.you);
          }
        }
        if (e.type === 'step' && e.by !== this.you) {
          const dx = (e.x ?? 0) - p.x,
            dz = (e.z ?? 0) - p.z,
            distance = Math.hypot(dx, dz);
          if (distance < 18)
            this.audio.step(
              0.13 * (1 - distance / 18),
              Math.max(
                -1,
                Math.min(
                  1,
                  (dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) /
                    Math.max(1, distance),
                ),
              ),
            );
        }
        if (e.type === 'hit') {
          if (e.by === this.you) {
            this.art.hit = 0.12;
            this.audio.hit(e.head);
          }
          if (e.target === this.you) this.art.damage = 0.8;
        }
        if (e.type === 'smoke') this.audio.hiss(0.45, 0.1, 1900);
        if (e.type === 'flash') this.audio.tone(2900, 0.2, 0.04);
        if (['round', 'plant', 'defuse'].includes(e.type)) this.audio.round();
        if (e.type === 'explode' || e.type === 'grenade') this.presentExplosion(e, s.bomb);
      }
      if (s.phase === 'match' && !this.paused) this.pause();
      if (p.reload > this.lastReload + 0.1&&p.weapon!=='vandal'&&p.weapon!=='m4a4'&&p.weapon!=='glock'&&p.weapon!=='usp'&&p.weapon!=='deagle'&&p.weapon!=='awp') this.audio.reload();
      if (p.reload > 0 && this.lastReload > p.reload) {
        const duration = WEAPONS[p.weapon].reload;
        if(p.weapon!=='vandal'&&p.weapon!=='m4a4'&&p.weapon!=='glock'&&p.weapon!=='usp'&&p.weapon!=='deagle'&&p.weapon!=='awp')for (const point of [0.26, 0.74, 0.89]) {
          const threshold = duration * (1 - point);
          if (this.lastReload > threshold && p.reload <= threshold)
            this.audio.reloadStage(point);
        }
      }
      this.lastReload = p.reload;
      const binds = this.settings?.keybinds ?? DEFAULT_KEYBINDS;
      const moving =
        !this.paused &&
        (this.keys.has(binds.forward) ||
          this.keys.has(binds.left) ||
          this.keys.has(binds.back) ||
          this.keys.has(binds.right));
      this.footClock -= dt;
      if (moving && p.alive && p.grounded && !p.crouch && this.footClock <= 0) {
        this.audio.step();
        this.footClock = 0.36;
      }
      if (s.bomb.planted) {
        this.beepClock -= dt;
        if (this.beepClock <= 0) {
          this.audio.beep();
          this.beepClock = Math.max(0.15, s.bomb.timer / (this.sourceScenario ? SOURCE_OBJECTIVE_TIMERS.fuse : 35));
        }
      }
      const visual =
        this.online && this.predicted
          ? {
              ...p,
              ...(this.sourceScenario?{sourceRifleHandling:this.predicted.sourceRifleHandling,
                sourceGlock:this.predicted.sourceGlock,sourceUSP:this.predicted.sourceUSP,sourceDeagle:this.predicted.sourceDeagle,sourceAWP:this.predicted.sourceAWP,sourceAWPPose:this.predicted.sourceAWPPose,sourcePistolPose:this.predicted.sourcePistolPose,
                sourceViewmodelTime:this.predicted.sourceViewmodelTime,
                sourceWalking:this.predicted.sourceWalking,
                sourcePose:this.predicted.sourcePose,sourcePoseVersion:this.predicted.sourcePoseVersion,
                sourceRagdoll:this.predicted.sourceRagdoll?structuredClone(this.predicted.sourceRagdoll):undefined,
                shotIdle:this.predicted.shotIdle,reload:this.predicted.reload,weapon:this.predicted.weapon}:{}),
              x: this.predicted.x,
              y: this.predicted.y,
              z: this.predicted.z,
              yaw: this.yaw,
              pitch: this.pitch,
              shotHeat: this.predicted.shotHeat,
              vx: this.predicted.vx,
              vz: this.predicted.vz,
              crouch: this.predicted.crouch,
              stancePhase: this.predicted.stancePhase,
              stanceRate: this.predicted.stanceRate,
              stanceTarget: this.predicted.stanceTarget,
              grounded: this.predicted.grounded,
              stridePhase: this.predicted.stridePhase,
              strideWeight: this.predicted.strideWeight,
              strideSpeed: this.predicted.strideSpeed,
              strideX: this.predicted.strideX,
              strideZ: this.predicted.strideZ,
            }
          : p;
      this.art.updateSmoke(s.smokes ?? [], dt,s.round);
      this.art.updateGrenades(s.grenades ?? []);
      this.art.updateDroppedWeapons(remoteFrame?.droppedWeapons??s.droppedWeapons??[]);
      const actors = remoteFrame ? remoteFrame.players.map(actor => actor.id === this.you ? visual : actor) : s.players;
      // A dead local operator follows a living teammate's interpolated state. Passing
      // that teammate as the scene owner hides its world body at the camera while
      // retaining teammate-only target selection; the authority still ignores all
      // input from the dead seat.
      this.art.updateActors(actors, spectator?.id ?? this.you, dt);
      this.art.frame(dt, spectator ?? visual, false, spectator ? false : this.aim, spectator ? false : moving, this.settings.fov,s.round,this.online||!this.paused);
      this.renderTime = remoteFrame?.time ?? null;
    } else {
      this.art.updateSmoke([], dt);
      this.art.updateGrenades([]);
      this.art.updateDroppedWeapons([]);
      this.art.updateActors([], this.you, dt, true);
      this.art.frame(dt, undefined, true);
    }
    this.uiClock += dt;
    if (this.uiClock >= 0.1) {
      this.uiClock = 0;
      this.notify();
    }
  };
  notify() {
    if (this.disposed) return;
    this.update({
      sourceFinishStatus:this.art.sourceFinishStatus(),
      mapId:this.mapId,
      snapshot: this.snapshot,
      player: this.snapshot?.players.find((p) => p.id === this.you) ?? null,
      ready: this.ready,
      paused: this.paused,
      active: this.active,
      fps: this.fps,
      ping: this.ping,
      status: this.status,
      error: this.error,
      hit: this.art.hit > 0,
      damage: this.art.damage,
      board: this.board,
      buy: this.buying,
      online: this.online,
      roomCode: this.roomCode,
      scoped: (() => {
        const own=this.predicted??this.snapshot?.players.find((p) => p.id === this.you);
        if(own?.weapon==='awp')return own.sourceAWP?.command.scoped??false;
        return this.aim&&!!this.snapshot?.players.some((p) => p.id === this.you && p.weapon === 'marshal' && p.reload === 0);
      })(),
      spread: (() => {
        const p =
          this.predicted ??
          this.snapshot?.players.find((p) => p.id === this.you);
        return p ? shotSpread(p, { ...EMPTY_INPUT, aim: this.aim }) : 0;
      })(),
      reload:
        this.snapshot?.players.find((p) => p.id === this.you)?.reload ?? 0,
      spectatorTarget: this.spectatorTargetId
        ? this.snapshot?.players.find((player) => player.id === this.spectatorTargetId) ?? null
        : null,
    });
  }
  /**
   * Release client resources during a document teardown while leaving the
   * server-side seat in Colyseus' 30-second drop reservation. A normal
   * `leave()` is a deliberate departure and immediately transfers the seat to
   * a bot, so it must never be used by the page's React unmount cleanup when a
   * refresh is expected to restore the same operator.
   */
  dispose(options: { preserveRoomRecovery?: boolean } = {}) {
    if (this.disposed) return;
    this.disposed = true;
    if (options.preserveRoomRecovery && this.room) {
      const room = this.room;
      // Remove application callbacks before closing. Otherwise the SDK's
      // onLeave callback clears the persisted token before the new page can use
      // it. Close with MAY_TRY_RECONNECT so the authority retains the seat.
      room.removeAllListeners();
      room.reconnection.enabled = false;
      room.reconnection.maxRetries = 0;
      room.reconnection.enqueuedMessages.length = 0;
      if (room.connection.isOpen) room.connection.close(4010);
      this.room = null;
      this.synchronizedRoom = null;
      this.recovering = true;
      this.online = false;
    } else {
      this.leave();
    }
    cancelAnimationFrame(this.frameId);
    this.controller.abort();
    this.art.dispose();
    this.audio.dispose();
  }
}
