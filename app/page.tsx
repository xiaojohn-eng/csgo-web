'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SkinSelector } from '@/components/skin-selector';
import {validSourceWeaponFinish,sourceWeaponFinishKey,type SourceWeaponFinish} from '@/game/source-weapon-finish';
import { LANAddresses } from '@/components/lan-addresses';
import '@/components/source-ui.css';
import { validSkinId, type SkinId } from '@/game/skin-catalog';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  ArrowUpRight,
  ArrowRight,
  Settings2,
  Target,
  Shield,
  ChevronRight,
  Crosshair,
  RotateCcw,
  Users,
  Monitor,
  MoveUpRight,
  X,
  MapPin,
} from 'lucide-react';
import { readRoomRecovery, type Game, type View, type Settings } from '@/game/runtime';
import { DEFAULT_KEYBINDS, keybindLabel, normalizeKeybind, readKeybinds, type Keybinds } from '@/game/keybinds';
import { WEB_VERSION } from '@/game/protocol';
import {SOURCE_DUST2_ID} from '@/game/source-identity';
import sourceRadar from '@/game/source-radar.json';
import { RADAR_BOXES as BOXES, SITES, MAP_BOUNDS } from '@/game/map';
import { WEAPONS, type Mode, type WeaponId } from '@/game/types';
import {SOURCE_DEFAULT_RULE_SET,sourceBuyWindowOpen,sourceMatchFormat,sourceRuleSet,sourceRuleSets,type SourceRuleSetId} from '@/game/source-gamemode';
import {sourceWeaponTeamAllows,SOURCE_UTILITY_SHOP,sourceUtilityPurchaseAllowed,SOURCE_DEFUSE_KIT_COST,SOURCE_OBJECTIVE_TIMERS} from '@/game/source-economy';
/** The two original modes a room can be created on, described from the staged
 * data, so this screen never keeps its own copy of the numbers. */
const ROOM_FORMATS = sourceRuleSets();
const LOCAL_WIN_TARGET = sourceMatchFormat(sourceRuleSet(SOURCE_DEFAULT_RULE_SET)).winTarget;
const UTILITY_LABELS = {he:'高爆手雷',smoke:'烟雾弹',flash:'闪光弹'} as const;
const KEYBIND_ROWS: readonly [keyof Keybinds, string][] = [
  ['forward', '向前'], ['back', '后退'], ['left', '左移'], ['right', '右移'],
  ['jump', '跳跃'], ['interact', '交互 / 安放 / 拆除'], ['buy', '购买'], ['spectatorNext', '死亡观战切换'],
];
/** The rules a match is played on. A snapshot names its own rule set, so the HUD
 * and the shop follow the authority rather than a local default. */
const ruleSetOf = (id: SourceRuleSetId | null | undefined) => sourceRuleSet(id ?? SOURCE_DEFAULT_RULE_SET);
/** The original `mp_freezetime`/`mp_buytime` window, so the shop stays open
 * exactly as long as the authority is still accepting purchases. */
const buyWindowOpen = (s: { phase: 'buy' | 'live' | 'ended' | 'match'; remaining: number; mode: Mode;
  rules?: SourceRuleSetId | null; canBuy?: boolean } | null | undefined) =>
  !!s && (s.canBuy ?? sourceBuyWindowOpen(ruleSetOf(s.rules), s.phase, s.remaining, s.mode === 'training'));
const INITIAL: View = {
  snapshot: null,
  player: null,
  ready: false,
  paused: true,
  active: false,
  fps: 0,
  ping: 0,
  status: '正在加载港区',
  error: '',
  hit: false,
  damage: 0,
  board: false,
  buy: false,
  online: false,
  roomCode: '',
  reload: 0,
  scoped: false,
  spread: 0,
  spectatorTarget: null,
};
const DEFAULT: Settings = {
  sensitivity: 1,
  volume: 0.45,
  fov: 78,
  quality: 'high',
  crosshair: '#b9efcb',
  keybinds: { ...DEFAULT_KEYBINDS },
};
const time = (n: number) =>
  `${Math.floor(Math.max(0, n) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60)
    .toString()
    .padStart(2, '0')}`;
const SOURCE_UI = '/source/csgo-12426148/ui/images';
function Radar({ v,isVisible }: { v: View;isVisible:(a:NonNullable<View['player']>,b:NonNullable<View['player']>)=>boolean }) {
  const p = v.player,
    s = v.snapshot;
  if (!p || !s) return null;
  const source=v.mapId===SOURCE_DUST2_ID;
  const bounds=source?{minX:sourceRadar.x,minZ:sourceRadar.z,maxX:sourceRadar.x+sourceRadar.size,maxZ:sourceRadar.z+sourceRadar.size}:MAP_BOUNDS;
  return (
    <div className="radar">
      <svg viewBox={`${bounds.minX-1} ${bounds.minZ-1} ${bounds.maxX-bounds.minX+2} ${bounds.maxZ-bounds.minZ+2}`} aria-label="战术地图">
        <rect x={bounds.minX-1} y={bounds.minZ-1} width={bounds.maxX-bounds.minX+2} height={bounds.maxZ-bounds.minZ+2} fill="#142029" />
        {source&&<image href={sourceRadar.image} x={sourceRadar.x} y={sourceRadar.z} width={sourceRadar.size} height={sourceRadar.size}/>}
        {source&&(['A','B']as const).map(name=><text key={name}
          x={sourceRadar.x+Number(sourceRadar.original[`bomb${name}_x`])*sourceRadar.size}
          y={sourceRadar.z+Number(sourceRadar.original[`bomb${name}_y`])*sourceRadar.size}
          fill="#e9b971" fontSize="4" textAnchor="middle">{name}</text>)}
        {!source&&BOXES.map((b, i) => (
          <rect
            key={i}
            x={b.x - b.w / 2}
            y={b.z - b.d / 2}
            width={b.w}
            height={b.d}
            fill="#607078"
          />
        ))}
        {!source&&SITES.map((site) => (
          <g key={site.name}>
            <rect
              x={site.min[0]} y={site.min[2]}
              width={site.max[0]-site.min[0]} height={site.max[2]-site.min[2]}
              fill="none" stroke="#d4a264" strokeWidth=".4"
            />
            <text
              x={site.x}
              y={site.z + 1.5}
              fill="#e9b971"
              fontSize="4"
              textAnchor="middle"
            >
              {site.name}
            </text>
          </g>
        ))}
        {s.players
          .filter(
            (a) =>
              a.alive && (a.team === p.team || (a.reveal > 0 && isVisible(p,a))),
          )
          .map((a) => (
            <circle
              key={a.id}
              cx={a.x}
              cy={a.z}
              r={a.id === p.id ? 1.25 : 0.85}
              fill={
                a.id === p.id
                  ? '#fff'
                  : a.team === p.team
                    ? '#91c7dc'
                    : '#e6a259'
              }
            />
          ))}
        <path
          d="M0 -3 L-1.5 0 L1.5 0Z"
          transform={`translate(${p.x} ${p.z}) rotate(${(-p.yaw * 180) / Math.PI})`}
          fill="white"
        />
        {s.bomb.planted && (
          <circle cx={s.bomb.x} cy={s.bomb.z} r="2" fill="#ffab58" />
        )}
      </svg>
      <span>
        <MapPin size={12} />
        {source?'Dust II':'塞勒涅港'}
      </span>
    </div>
  );
}
function readStored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
/** The finishes this browser has chosen, one per weapon, keyed by the weapon each one is
 * for. Each value is checked the way the wire checks it, so a stored value the transport
 * rule would refuse is dropped rather than offered as equipped. The single-finish key this
 * replaced is still read, so a selection made before per-weapon memory existed survives. */
function readStoredFinishes(): Partial<Record<string, SourceWeaponFinish>> {
  const collected: unknown[] = [];
  const read = (key: string) => {
    try {
      const parsed: unknown = JSON.parse(readStored(key, 'null'));
      if (Array.isArray(parsed)) collected.push(...parsed);
      else if (parsed) collected.push(parsed);
    } catch {}
  };
  read('csgo-web.source-finishes');
  if (!collected.length) read('csgo-web.source-finish');
  const finishes: Partial<Record<string, SourceWeaponFinish>> = {};
  for (const value of collected) {
    const finish = validSourceWeaponFinish(value);
    if (finish) finishes[finish.weapon] = finish;
  }
  return finishes;
}
function readSettings(): Settings {
  try {
    const value = JSON.parse(readStored('breachline.settings', 'null'));
    if (!value || typeof value !== 'object') return DEFAULT;
    return {
      sensitivity: Math.max(0.2, Math.min(3, Number(value.sensitivity) || 1)),
      volume: Math.max(0, Math.min(1, Number(value.volume) || 0)),
      fov: Math.max(65, Math.min(105, Number(value.fov) || 78)),
      quality: ['low', 'high', 'ultra'].includes(value.quality)
        ? value.quality
        : 'high',
      crosshair: DEFAULT.crosshair,
      keybinds: readKeybinds(value.keybinds),
    };
  } catch {
    return DEFAULT;
  }
}
type LANRoom = {roomId:string; name:string; code:string; players:number; maxPlayers:number; mode:string; mapId:string; status:string; version:string; rules?:SourceRuleSetId};
function initialServer() {
  if (typeof location === 'undefined') return '';
  // Same-origin by default; never reconnect an old remembered public endpoint.
  if (location.port === '5192') return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}
export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null),
    game = useRef<Game | null>(null);
  const [v, setV] = useState(INITIAL),
    [settings, setSettings] = useState(readSettings),
    [settingsOpen, setSettingsOpen] = useState(false),
    [roomOpen, setRoomOpen] = useState(false),
    [mode, setMode] = useState<Mode>('training'),
    [tab, setTab] = useState('play'),
    [name, setName] = useState(() => readStored('breachline.name', '行动员')),
    [endpoint, setEndpoint] = useState(initialServer),
    [code, setCode] = useState(''),
    [roomName, setRoomName] = useState(() => typeof location !== 'undefined' && new URLSearchParams(location.search).get('map') === 'de_dust2' ? 'Dust II 行动' : '港区行动'),
    [roomTab, setRoomTab] = useState<'browse'|'create'>('browse'),
    [rooms, setRooms] = useState<LANRoom[]>([]),
    [ruleSet, setRuleSet] = useState<SourceRuleSetId>(SOURCE_DEFAULT_RULE_SET),
    [selectedRoom, setSelectedRoom] = useState(''),
    [roomsError, setRoomsError] = useState(''),
    [refreshing, setRefreshing] = useState(false),
    [connecting, setConnecting] = useState(false),
    [copied, setCopied] = useState(false),
    [weapon, setWeapon] = useState<WeaponId>('vandal'),
    [skin, setSkin] = useState<SkinId>(() => validSkinId(readStored('csgo-web.skin', 'default'))),
    // One finish per weapon, the way the original keeps a skin per weapon, while the wire
    // still carries one: what travels is the finish on the weapon its owner is holding.
    [sourceFinishes,setSourceFinishes]=useState<Partial<Record<string,SourceWeaponFinish>>>(()=>readStoredFinishes());
  const originalDust2=v.mapId===SOURCE_DUST2_ID;
  const interactKey=keybindLabel(settings.keybinds.interact), buyKey=keybindLabel(settings.keybinds.buy);
  const sourceFinish:SourceWeaponFinish|null=sourceFinishes[weapon]??null;
  const setSourceFinish=(value:SourceWeaponFinish|null)=>{
    const key=value?.weapon??weapon;
    setSourceFinishes(previous=>{const next={...previous};
      if(value)next[key]=value;else delete next[key];
      return next;});
  };
  const mapName=originalDust2?'Dust II':'塞勒涅港';
  // Tokens are room/map scoped. Hide a Dust II recovery action on the legacy
  // map (and vice versa) instead of offering a button guaranteed to fail.
  const storedRecovery = readRoomRecovery();
  const recoverableStoredRoom = storedRecovery?.mapId === v.mapId ? storedRecovery : null;
  useEffect(() => {
    let disposed = false;
    import('@/game/runtime')
      .then(({ Game }) => {
        if (disposed || !canvas.current) return;
        try {
          game.current = new Game(canvas.current, setV);
          (window as unknown as Record<string, unknown>).__BREACHLINE__ = {
            snapshot: () => game.current?.snapshot,
            assetAudit: () => game.current?.art.assetAudit(),
            audioAudit: () => ({verifiedSourceSounds:Object.fromEntries(game.current?.audio.sourceHashes??[]),verifiedSourceAKSounds:Object.fromEntries(game.current?.audio.sourceAKHashes??[]),verifiedSourcePistolSounds:Object.fromEntries(game.current?.audio.sourcePistolHashes??[]),verifiedSourceDeagleSounds:Object.fromEntries(game.current?.audio.sourceDeagleHashes??[]),verifiedSourceAWPSounds:Object.fromEntries(game.current?.audio.sourceAWPHashes??[]),verifiedSourcePistolCommandSounds:Object.fromEntries(game.current?.audio.sourcePistolCommandHashes??[]),verifiedSourceImpactSounds:Object.fromEntries(game.current?.audio.sourceImpactHashes??[]),impactSounds:game.current?.audio.sourceImpactAudit()??null,decodedSourceSounds:[...(game.current?.audio.buffers.keys()??[])].filter(s=>s.startsWith('source_')),recentSourceEvents:game.current?.audio.sourceEvents}),
            handlingAudit: () => {
              const g=game.current;if(!g)return null;
              const own=g.snapshot?.players.find(p=>p.id===g.you),camera=g.art.camera.matrixWorld.elements;
              return structuredClone({you:g.you,online:g.online,yaw:g.yaw,pitch:g.pitch,
                spectatorTarget:g.spectatorTargetId,
                authority:{time:g.snapshot?.time,player:own},prediction:{time:g.prediction?.time,player:g.predicted,pending:g.pending.map(i=>i.seq)},
                cameraForward:[-camera[8],-camera[9],-camera[10]],view:g.art.sourceViewAudit,
                rifleView:g.art.sourceRifleViewAudit,
                shots:g.snapshot?.events.filter(e=>e.by===g.you&&(e.sourceRifleShot||e.sourcePistolShot||e.sourceAWPShot))});
            },
            settings: () => game.current?.settings,
            magazineDrops: () => game.current?.art.magazineDrops.audit() ?? null,
            cpuRelease: () => game.current?.art.sourceMap?.cpuReleaseProbe() ?? null,
            frameProfile: () => game.current?.art.frameProfile ?? null,
            frameTiming: () => game.current?.frameTiming ?? null,
            drawCallSplit: () => game.current?.art.worldComposite.lastCalls ?? null,
            runtime: () => game.current ?? null,
            metrics: () => ({
              fps: game.current?.fps,
              drawCalls: game.current?.art.renderer.info.render.calls,
              triangles: game.current?.art.renderer.info.render.triangles,
              geometries: game.current?.art.renderer.info.memory.geometries,
              textures: game.current?.art.renderer.info.memory.textures,
              programs: game.current?.art.renderer.info.programs?.length ?? null,
            }),
          };
        } catch {
          setV((x) => ({
            ...x,
            error:
              '无法启动 3D 画面。请开启浏览器硬件加速，或使用支持 WebGL 2 的桌面浏览器。',
          }));
        }
      })
      .catch(() =>
        setV((x) => ({ ...x, error: '游戏资源加载失败，请检查网络后刷新。' })),
      );
    return () => {
      disposed = true;
      // A page refresh must drop the socket without sending Colyseus'
      // deliberate LEAVE frame; that preserves the 30-second seat reservation
      // and lets the next Game instance call reconnect(token).
      game.current?.dispose({ preserveRoomRecovery: true });
      game.current = null;
      delete (window as unknown as Record<string, unknown>).__BREACHLINE__;
    };
  }, []);
  useEffect(() => {
    game.current?.configure(settings);
    try {
      localStorage.setItem('breachline.settings', JSON.stringify(settings));
    } catch {}
  }, [settings, v.ready]);
  useEffect(() => {
    game.current?.setSkin(skin);
    try { localStorage.setItem('csgo-web.skin', skin); } catch {}
  }, [skin, v.ready]);
  useEffect(()=>{
    const timer=setTimeout(()=>{
      // Persist the selected default per weapon. The authority keeps this
      // separate from the finish on a picked-up entity in the current slot.
      game.current?.setSourceLoadout(weapon, sourceFinish);
      try{localStorage.setItem('csgo-web.source-finishes',JSON.stringify(Object.values(sourceFinishes)));}catch{}
    },120);
    return()=>clearTimeout(timer);
  },[sourceFinish,sourceFinishes,weapon,v.ready]);
  const discovery = useRef<AbortController | null>(null);
  const refreshRooms = async () => {
    discovery.current?.abort();
    const request = new AbortController(); discovery.current = request;
    const timeout = setTimeout(() => request.abort(), 5000);
    setRefreshing(true); setRoomsError('');
    try {
      const url = new URL('/api/rooms', endpoint.replace(/^ws/, 'http'));
      const response = await fetch(url, {signal:request.signal, cache:'no-store'});
      if (!response.ok) throw new Error(`大厅连接失败（${response.status}）`);
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== 'object' || !('version' in raw) || !('rooms' in raw)) throw new Error('大厅响应格式不正确');
      const data = raw as {version:unknown;rooms:unknown};
      if (data.version !== WEB_VERSION) throw new Error('网页与服务端版本不同，请刷新网页并使用同一版本');
      if (!Array.isArray(data.rooms) || data.rooms.length > 100) throw new Error('房间列表格式不正确');
      const valid = data.rooms.filter((r:LANRoom) => typeof r.roomId==='string' && typeof r.name==='string' && typeof r.version==='string' && typeof r.code==='string' && Number.isInteger(r.players) && r.players>=0 && Number.isInteger(r.maxPlayers) && r.maxPlayers>0);
      if (request.signal.aborted) return;
      const matching=valid.filter((r:LANRoom)=>r.mapId===(game.current?.mapId??'port-selene-m01'));
      setRooms(matching); setSelectedRoom((id) => matching.some((r:LANRoom)=>r.roomId===id) ? id : '');
    } catch (error) {
      if (discovery.current !== request) return;
      setRooms([]); setSelectedRoom('');
      setRoomsError(error instanceof Error && error.name !== 'AbortError' ? error.message : '房间列表响应超时，请确认房主服务已启动');
    } finally {
      clearTimeout(timeout);
      if (discovery.current === request) setRefreshing(false);
    }
  };
  useEffect(() => {
    if (roomOpen && roomTab === 'browse') void refreshRooms();
    return () => { discovery.current?.abort(); discovery.current = null; };
  }, [roomOpen, roomTab, endpoint]);
  const updateSetting = (key: keyof Settings, value: unknown) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const start = () => {
    try {
      localStorage.setItem('breachline.name', name);
    } catch {}
    game.current?.start(mode, name);
  };
  const connectionRequest = useRef(0);
  const connect = async (create: boolean, room?: LANRoom) => {
    const request = ++connectionRequest.current;
    setConnecting(true);
    const roomCode = create
      ? Array.from(
          crypto.getRandomValues(new Uint8Array(6)),
          (v) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v % 32],
        ).join('')
      : room?.code ?? code.toUpperCase();
    setCode(roomCode);
    try {
      localStorage.setItem('breachline.server', endpoint);
    } catch {}
    await game.current?.connect(endpoint, roomCode, name, create, roomName.trim(), room?.roomId, create ? ruleSet : room?.rules);
    if (request !== connectionRequest.current) return;
    setConnecting(false);
    if (game.current?.online) setRoomOpen(false);
  };
  const recoverStoredRoom = async () => {
    const record = readRoomRecovery();
    if (!record || connecting) return;
    setConnecting(true);
    setEndpoint(record.endpoint);
    setCode(record.code);
    setRoomName(record.roomName);
    try {
      await game.current?.reconnectStoredRoom(name);
      if (game.current?.online) setRoomOpen(false);
    } finally {
      setConnecting(false);
    }
  };
  const s = v.snapshot,
    p = v.player,
    playing = v.active && s && p,
    match = s?.phase === 'match',
    // The match's own rule set, so the HUD reads the authority's format.
    matchFormat = s?.rules ? sourceMatchFormat(ruleSetOf(s.rules)) : null,
    // What the authority just paid for the round that ended, off the same event.
    roundCash = [...(s?.events ?? [])].reverse().find((e) => e.type === 'round' && e.cash)?.cash ?? null,
    pause = playing && v.paused && !v.buy && !match && !settingsOpen;
  const openSettings = () => {
    if (v.active) game.current?.pause();
    setSettingsOpen(true);
  };
  const returnMenu = () => {
    game.current?.leave();
    setV(INITIAL);
    if (game.current) {
      game.current.status = '系统就绪';
      game.current.notify();
    }
  };
  const feed = s?.events.filter((e) => e.type === 'kill').slice(-4) ?? [];
  return (
    <main
      className="game-shell"
      style={{ '--crosshair': settings.crosshair } as React.CSSProperties}
    >
      <canvas
        ref={canvas}
        className="world"
        aria-label="CSGO WEB 三维游戏画面"
      />
      {!playing && <div className={`menu-shade ${tab === 'play' ? 'image2-backdrop' : ''}`} />}
      {!playing && (
        <>
          <header className="main-header">
            <div className="wordmark">
              <span className="brand-mark">
                C<span>╱</span>
              </span>
              <div>
                CSGO WEB<small>局 域 网 战 术 竞 技</small>
              </div>
            </div>
            <nav>
              <Button
                variant="ghost"
                className={tab === 'play' ? 'nav-active' : ''}
                onClick={() => setTab('play')}
              >
                行动
              </Button>
              <Button
                variant="ghost"
                className={tab === 'armory' ? 'nav-active' : ''}
                onClick={() => setTab('armory')}
              >
                武器库
              </Button>
              <Button
                variant="ghost"
                className={tab === 'intel' ? 'nav-active' : ''}
                onClick={() => setTab('intel')}
              >
                行动手册
              </Button>
            </nav>
            <Button
              variant="ghost"
              size="icon"
              aria-label="游戏设置"
              onClick={openSettings}
            >
              <Settings2 size={21} />
            </Button>
          </header>
          {tab === 'play' && (
            <section className="menu-content">
              <div className="operation-id">
                <span /> OPERATION 01 <i /> LOCAL / LAN
              </div>
              <p className="menu-kicker">战术攻防 / TACTICAL FPS</p>
              <h1>
                准备行动。
                <br />
                <em>下一局，开战。</em>
              </h1>
              <p className="menu-description">
                一个人练习，或与局域网好友并肩作战。
                <br />
                选择训练，或加入正在进行的{mapName}行动。
              </p>
              <Tabs
                value={mode}
                onValueChange={(x) => setMode(x as Mode)}
                className="mode-tabs"
              >
                <TabsList>
                  <TabsTrigger value="demolition">
                    <Shield size={15} />
                    战术攻防
                  </TabsTrigger>
                  <TabsTrigger value="training">
                    <Target size={15} />
                    自由训练
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="demolition">
                  <p>5 对 5 · 双目标区 · 率先赢下 {LOCAL_WIN_TARGET} 回合</p>
                </TabsContent>
                <TabsContent value="training">
                  <p>即时复活 · AI 对手 · 25 次击败或 3 分钟</p>
                </TabsContent>
              </Tabs>
              <Button
                className="launch-button"
                disabled={!v.ready}
                onClick={start}
              >
                <span>
                  {v.ready ? (mode === 'training' ? '开始人机训练' : '开始战术演练') : `正在准备 ${mapName}…`}
                  <small>
                    {mode === 'demolition'
                      ? '战术演练 · AI 补位'
                      : '本地训练 · 即刻开玩'}
                  </small>
                </span>
                <ArrowUpRight size={30} />
              </Button>
              <Button
                className="room-button"
                variant="outline"
                disabled={!v.ready}
                onClick={() => { setRoomTab('browse'); setRoomOpen(true); }}
              >
                <Users size={17} />
                局域网房间
                <ArrowRight size={17} />
              </Button>
              <Button className="room-button create-room-button" variant="ghost" disabled={!v.ready}
                onClick={() => { setRoomTab('create'); setRoomOpen(true); }}>
                创建房间 <ArrowRight size={17} />
              </Button>
              <div className="operator-name">
                <label htmlFor="callsign">呼号</label>
                <Input
                  id="callsign"
                  maxLength={16}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </section>
          )}
          {tab === 'armory' && (
            <section className={`menu-content armory${originalDust2 ? ' armory--source' : ''}`}>
              <div className="operation-id">LOADOUT / WEAPON FINISHES</div>
              <h1>任务装备</h1>
              <p className="menu-description">
                选择枪械与涂装。按 F 检视，对局中按 B 购买。
              </p>
              <div className="weapon-list">
                {Object.entries(WEAPONS).filter(([id]) => originalDust2?id==='vandal'||id==='m4a4'||id==='glock'||id==='usp'||id==='deagle'||id==='awp':id !== 'spectre'&&id!=='m4a4'&&id!=='glock'&&id!=='usp'&&id!=='deagle'&&id!=='awp').map(([id, w]) => (
                  <Button
                    key={id}
                    variant="outline"
                    className={weapon === id ? 'selected' : ''}
                    aria-pressed={weapon === id}
                    onClick={() => {
                      setWeapon(id as WeaponId);
                      game.current?.art.setWeapon(id as WeaponId);
                    }}
                  >
                    <span>
                      {w.name}
                      <small>{w.label}</small>
                    </span>
                    <ChevronRight />
                  </Button>
                ))}
              </div>
              <div className="weapon-stats">
                <div>
                  <small>基础伤害</small>
                  <strong>{WEAPONS[weapon].damage}</strong>
                </div>
                <div>
                  <small>弹匣容量</small>
                  <strong>{WEAPONS[weapon].mag}</strong>
                </div>
                <div>
                  <small>换弹时间</small>
                  <strong>{Number(WEAPONS[weapon].reload.toFixed(2))}s</strong>
                </div>
              </div>
              <SkinSelector weapon={WEAPONS[weapon].name} weaponId={weapon} selected={skin} onSelect={setSkin} onInspect={() => game.current?.art.inspectWeapon()}
                {...(originalDust2?{sourceFinish,onSourceFinish:setSourceFinish,sourceFinishStatus:sourceFinish&&sourceFinish.weapon===weapon&&sourceWeaponFinishKey(sourceFinish)!==v.sourceFinishStatus?.key?'loading':v.sourceFinishStatus?.status}: {})}/>
            </section>
          )}
          {tab === 'intel' && (
            <section className="menu-content intel">
              <div className="operation-id">FIELD MANUAL / {mapName}</div>
              <h1>行动须知</h1>
              <p className="menu-description">
                琥珀小队进攻，苍蓝小队防守。进攻方持有装置的队员可在 A 或 B
                区安放；防守方需要阻止或解除装置。
              </p>
              <div className="rules">
                <p>
                  <b>{originalDust2 ? SOURCE_OBJECTIVE_TIMERS.plant : '03'} 秒</b>持续按 {interactKey} 安放
                </p>
                <p>
                  <b>{originalDust2 ? SOURCE_OBJECTIVE_TIMERS.fuse : 35} 秒</b>装置引爆倒计时
                </p>
                <p>
                  <b>{originalDust2?`${SOURCE_OBJECTIVE_TIMERS.defuse} / ${SOURCE_OBJECTIVE_TIMERS.defuseKit} 秒`:'05 秒'}</b>{originalDust2?`持续按 ${interactKey} 拆弹 / 使用拆弹器`:`持续按 ${interactKey} 解除`}
                </p>
                <p>
                  <b>{String(LOCAL_WIN_TARGET).padStart(2,'0')} 回合</b>率先获胜即完成任务
                </p>
              </div>
              <div className="key-guide">
                {[
                  [`${keybindLabel(settings.keybinds.forward)} ${keybindLabel(settings.keybinds.left)} ${keybindLabel(settings.keybinds.back)} ${keybindLabel(settings.keybinds.right)}`, '移动'],
                  ['鼠标', '瞄准 / 左键射击'],
                  ['右键', '精确瞄准'],
                  ['R', '换弹'],
                  ['F', '检视武器'],
                  ['1 / 2', '主武器 / 手枪'],
                  [keybindLabel(settings.keybinds.jump), '跳跃'],
                  ['Ctrl / C', '蹲伏'],
                  [keybindLabel(settings.keybinds.interact), '安放 / 解除'],
                  ['G', '投掷爆破弹'],
                  ['V', '投掷烟雾弹'],
                  ['Q', '投掷闪光弹'],
                  [keybindLabel(settings.keybinds.buy), '购买装备'],
                  [keybindLabel(settings.keybinds.spectatorNext), '死亡观战切换'],
                  ['Tab', '计分板'],
                  ['Esc', '释放鼠标 / 暂停'],
                ].map(([k, l]) => (
                  <div key={k}>
                    <kbd>{k}</kbd>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="location-stamp">
            <span>07</span>
            <div>
              {mapName}<small>{originalDust2?'DUST II · 经典地图':'PORT SELENE · 16:20'}</small>
            </div>
            <MoveUpRight />
          </div>
          <footer className="menu-footer">
            <span>
              <i className={v.ready ? 'status-dot' : ''} />
              {v.status}
            </span>
            <span>
              CS:GO 网页复刻 · 开发中<span className="footer-divider">/</span>PC · 键鼠
              <span className="footer-divider">/</span>{WEB_VERSION.toUpperCase().replace('-', ' ')} 候选
            </span>
          </footer>
        </>
      )}
      {playing && (
        <>
          <div className="hud-top">
            <div className="team-score amber">
              <span className="source-team"><img src={`${SOURCE_UI}/icons/ui/t_logo_1c.svg`} alt="" />T</span>
              <b>{s.score.amber}</b>
              <small>
                {s.players.filter((a) => a.team === 'amber' && a.alive).length}{' '}
                名存活
              </small>
            </div>
            <div className="round-time">
              <small>
                {s.mode === 'training'
                  ? '自由训练'
                  : s.phase === 'buy'
                    ? '购买阶段'
                    : `回合 ${s.round}`}
              </small>
              <b className={s.bomb.planted ? 'warning' : ''}>
                {time(s.bomb.planted ? s.bomb.timer : s.remaining)}
              </b>
              {s.mode !== 'training' && matchFormat && (
                <small>{`先到 ${matchFormat.winTarget} 局 · 第 ${matchFormat.swapAfterRound} 回合后换边`}</small>
              )}
            </div>
            <div className="team-score blue">
              <b>{s.score.blue}</b>
              <span className="source-team">CT<img src={`${SOURCE_UI}/icons/ui/ct_logo_1c.svg`} alt="" /></span>
              <small>
                {s.players.filter((a) => a.team === 'blue' && a.alive).length}{' '}
                名存活
              </small>
            </div>
          </div>
          <Radar v={v} isVisible={(a,b)=>game.current?.sight(game.current.eyeOrigin(a),game.current.eyeOrigin(b))??false} />
          <div className="killfeed">
            {feed.map((e) => (
              <div key={e.id}>
                <span className={s.players.find((a) => a.id === e.by)?.team}>
                  {s.players.find((a) => a.id === e.by)?.name ?? '行动员'}
                </span>
                {originalDust2 && e.weapon === 'he'
                  ? <img className="source-headshot" src={`${SOURCE_UI}/icons/equipment/hegrenade.svg`} alt="爆破手雷击杀" />
                  : <Crosshair size={13} />}
                {e.head && <img className="source-headshot" src={`${SOURCE_UI}/hud/deathnotice/icon_headshot.svg`} alt="爆头" />}
                <span
                  className={s.players.find((a) => a.id === e.target)?.team}
                >
                  {s.players.find((a) => a.id === e.target)?.name ?? '行动员'}
                </span>
              </div>
            ))}
          </div>
          <div className="objective-strip">
            {s.bomb.planted ? (
              <>
                <span className="pulse-dot" /> {s.bomb.site} 区装置已启动 ·{' '}
                {p.team === 'blue' ? '前往解除' : '保护目标'}
              </>
            ) : s.mode === 'training' ? (
              '自由训练 · 击败对手积累分数'
            ) : p.team === 'amber' ? (
              s.bomb.dropped ? (
                `装置已掉落 · 按 ${interactKey} 拾取`
              ) : s.bomb.carrier === p.id ? (
                '携带装置 · 前往 A 或 B 区'
              ) : (
                '掩护装置携带者'
              )
            ) : (
              '防守 A / B 目标区'
            )}
          </div>
          {p.alive && !v.paused && !v.scoped && (
            <div
              style={
                {
                  '--gap': `${6 + Math.min(22, v.spread * 200)}px`,
                } as React.CSSProperties
              }
              className={`crosshair ${v.hit ? 'confirmed' : ''}`}
            >
              <i />
              <i />
              <i />
              <i />
              {v.hit && <span>×</span>}
            </div>
          )}
          {p.alive && !v.paused && v.scoped && p.weapon!=='awp' && (
            <div className="scope-view">
              <div className="scope-ring">
                <i />
                <b />
              </div>
            </div>
          )}
          {p.alive && p.flash > 0 && (
            <div
              className="flash-blind"
              style={{ opacity: Math.min(1, p.flash * 1.5) }}
            />
          )}
          <div className="damage-vignette" style={{ opacity: v.damage }} />
          {p.use > 0 && (
            <div className="interact-progress">
              <span>{s.bomb.planted ? '正在解除装置' : '正在安放装置'}</span>
              <progress value={p.use} max={originalDust2
                ? s.bomb.planted ? p.defuseKit ? SOURCE_OBJECTIVE_TIMERS.defuseKit : SOURCE_OBJECTIVE_TIMERS.defuse : SOURCE_OBJECTIVE_TIMERS.plant
                : s.bomb.planted ? 5 : 3} />
              <small>持续按住 {interactKey}</small>
            </div>
          )}
          {s.phase === 'buy' && !v.buy && (
            <div className="buy-prompt">
                <kbd>{buyKey}</kbd> 购买装备 <span>准备下一次突破</span>
            </div>
          )}
          {!p.alive && s.phase !== 'match' && (
            <div className="death-message">
              <small>行动员已倒下</small>
              <h2>
                {s.mode === 'training'
                  ? `${Math.ceil(p.respawn)} 秒后重新部署`
                  : v.spectatorTarget
                    ? `观战：${v.spectatorTarget.name}`
                    : '等待下一回合'}
              </h2>
              <p>{v.spectatorTarget ? '按空格切换队友视角 · 按 Tab 查看队伍战况' : '按 Tab 查看队伍战况'}</p>
            </div>
          )}
          {s.phase === 'ended' && (
            <div className="round-result">
              <Shield size={28} />
              <h2>{s.winner === p.team ? '回合胜利' : '回合失利'}</h2>
              <p>{s.reason}{roundCash ? ` · 我方 +$${roundCash[p.team]}` : ''}</p>
            </div>
          )}
          <div className="hud-bottom">
            <div className="vitals">
              <div>
                <small>生命</small>
                <div className="source-health"><img src={`${SOURCE_UI}/hud/healtharmor/icon-cross1.png`} alt="" /><strong className={p.hp < 30 ? 'warning' : ''}>{p.hp}</strong></div>
                <div className="health-bar">
                  <i style={{ width: `${p.hp}%` }} />
                </div>
              </div>
              <div className="armor">
                <img className="source-armor" src={`${SOURCE_UI}/hud/healtharmor/icon-shield.png`} alt="护甲" />
                <b>{p.armor}</b>
              </div>
              <span className="credits">$ {p.money.toLocaleString()}</span>
            </div>
            <div className="bottom-controls">
              <span>
                <kbd>R</kbd> 换弹
              </span>
              <span>
                <kbd>{interactKey}</kbd> 交互
              </span>
              <span>
                <kbd>Tab</kbd> 战况
              </span>
            </div>
            <div className="ammo">
              <small>
                {WEAPONS[p.weapon].name} <span>{p.weapon==='glock'?(p.sourceGlock?.command.burstMode?'三连发 · 右键切换':'单发 · 右键切换'):p.weapon==='usp'?(p.sourceUSP?.command.silencerAttached?'已安装消音器 · 右键拆卸':'未安装消音器 · 右键安装'):WEAPONS[p.weapon].label}</span>
              </small>
              <div>
                <strong>{p.ammo.toString().padStart(2, '0')}</strong>
                <span>/ {p.reserve}</span>
              </div>
              <p className="source-utilities">
                {p.reload > 0
                  ? `换弹中 ${p.reload.toFixed(1)}s`
                  : <><span><kbd>G</kbd><img src={`${SOURCE_UI}/icons/equipment/hegrenade.svg`} alt="爆破手雷" />{p.grenades}</span><span><kbd>V</kbd><img src={`${SOURCE_UI}/icons/equipment/smokegrenade.svg`} alt="烟雾弹" />{p.smokes}</span><span><kbd>Q</kbd><img src={`${SOURCE_UI}/icons/equipment/flashbang.svg`} alt="闪光弹" />{p.flashes}</span>{originalDust2 && p.team === 'blue' && <span>{p.defuseKit?`拆弹器 · ${SOURCE_OBJECTIVE_TIMERS.defuseKit} 秒`:`无拆弹器 · ${SOURCE_OBJECTIVE_TIMERS.defuse} 秒`}</span>}<span><kbd>F</kbd>检视</span></>}
              </p>
            </div>
          </div>
          <div className="performance">
            {v.fps} FPS <span>·</span>{' '}
            {v.online ? `${v.ping} ms · 房间 ${v.roomCode}` : '本地演练'}{' '}
            <span>·</span> Esc 释放鼠标
          </div>
        </>
      )}
      {v.error && (
        <div role="alert" className="error-toast">
          {v.error}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭提示"
            onClick={() => {
              if (game.current) {
                game.current.error = '';
                game.current.notify();
              }
            }}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="tactical-dialog settings-dialog">
          <DialogTitle>游戏设置</DialogTitle>
          <DialogDescription>
            调整操作手感和画面表现。设置保存在此浏览器。
          </DialogDescription>
          {[
            ['sensitivity', '鼠标灵敏度', 0.2, 3, 0.1],
            ['fov', '视野范围', 65, 105, 1],
            ['volume', '主音量', 0, 1, 0.05],
          ].map(([key, label, min, max, step]) => (
            <FieldPrimitive.Root className="setting-row" key={key}>
              <div className="setting-label">
                <FieldPrimitive.Label>{label}</FieldPrimitive.Label>
                <b>
                  {key === 'volume'
                    ? Math.round(settings.volume * 100) + '%'
                    : Number(settings[key as 'sensitivity' | 'fov' | 'volume'])}
                </b>
              </div>
              <Slider
                aria-label={String(label)}
                value={[Number(settings[key as keyof Settings])]}
                min={Number(min)}
                max={Number(max)}
                step={Number(step)}
                onValueChange={(value) =>
                  updateSetting(
                    key as keyof Settings,
                    Array.isArray(value) ? value[0] : value,
                  )
                }
              />
            </FieldPrimitive.Root>
          ))}
          <div className="setting-row">
            <p className="setting-label">画质预设</p>
            <Tabs
              value={settings.quality}
              onValueChange={(value) => updateSetting('quality', value)}
            >
              <TabsList>
                <TabsTrigger value="low">流畅</TabsTrigger>
                <TabsTrigger value="high">高画质</TabsTrigger>
                <TabsTrigger value="ultra">极高</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="setting-row keybind-settings">
            <p className="setting-label">按键映射 <small>点击输入框后按下目标按键，保存后立即生效</small></p>
            {KEYBIND_ROWS.map(([key, label]) => (
              <label className="keybind-row" key={key}>
                <span>{label}</span>
                <Input
                  aria-label={label}
                  value={keybindLabel(settings.keybinds[key])}
                  maxLength={12}
                  readOnly
                  onKeyDown={(event) => {
                    event.preventDefault();
                    updateSetting('keybinds', {
                    ...settings.keybinds,
                    [key]: normalizeKeybind(event.code, settings.keybinds[key]),
                    });
                  }}
                />
              </label>
            ))}
          </div>
          <Button
            className="solid-button"
            onClick={() => setSettingsOpen(false)}
          >
            保存设置
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={roomOpen} onOpenChange={(open) => {
        if (!open) { connectionRequest.current++; game.current?.cancelConnect(); setConnecting(false); }
        setRoomOpen(open);
      }}>
        <DialogContent className="tactical-dialog lan-dialog">
          <div className="operation-id">LOCAL NETWORK / {mapName}</div>
          <DialogTitle>{roomTab === 'create' ? '创建房间' : '局域网房间'}</DialogTitle>
          <DialogDescription>同一局域网，打开相同网页即可一起玩。无需安装客户端。</DialogDescription>
          {recoverableStoredRoom && !v.online && (
            <div className="lan-recovery-card">
              <div><strong>发现上次未结束的席位</strong><p>页面刷新后可在 30 秒保留窗口内恢复原席位。</p></div>
              <Button variant="outline" disabled={connecting || !v.ready} onClick={() => void recoverStoredRoom()}>{connecting ? '正在恢复…' : '恢复上次席位'}</Button>
            </div>
          )}
          <div className="lan-tabs">
            <Button variant={roomTab==='browse' ? 'default':'outline'} onClick={()=>setRoomTab('browse')} disabled={connecting}>发现房间</Button>
            <Button variant={roomTab==='create' ? 'default':'outline'} onClick={()=>setRoomTab('create')} disabled={connecting}>创建房间</Button>
          </div>
          {roomTab === 'create' ? <>
            <label htmlFor="room-name">房间名称</label>
            <Input id="room-name" maxLength={32} value={roomName} onChange={e=>setRoomName(e.target.value)} placeholder="为这场行动起个名字" />
            <label htmlFor="room-rules">赛制</label>
            <div className="lan-tabs" id="room-rules" role="group" aria-label="赛制">
              {ROOM_FORMATS.map((format)=><Button key={format.id} variant={ruleSet===format.id?'default':'outline'} disabled={connecting} aria-pressed={ruleSet===format.id} onClick={()=>setRuleSet(format.id)}>
                {format.label} · {format.detail}
              </Button>)}
            </div>
            <div className="lan-rule-card"><Shield size={21}/><div><strong>{mapName} · 战术攻防</strong><p>最多 10 名玩家 · AI 补位 · 局域网权威对局</p></div></div>
            <Button className="solid-button" disabled={connecting || !roomName.trim() || !endpoint || !v.ready} onClick={()=>connect(true)}>
              {connecting ? '正在创建…' : '创建并进入房间'} <ArrowRight size={18}/>
            </Button>
          </> : <>
            <div className="lan-list-toolbar"><span>{refreshing ? '正在查看房间…' : `找到 ${rooms.length} 个房间`}</span><Button variant="outline" onClick={()=>void refreshRooms()} disabled={refreshing || connecting}>刷新列表</Button></div>
            <div className="lan-room-list" role="list" aria-label="可加入的局域网房间">
              {!refreshing && rooms.length===0 && <div className="lan-empty"><Users size={28}/><strong>暂时没有房间</strong><p>创建一间房，邀请同一局域网的朋友加入。</p></div>}
              {rooms.map(room=><button key={room.roomId} type="button" role="listitem" className={`lan-room-row ${selectedRoom===room.roomId?'selected':''}`} disabled={connecting || room.players>=room.maxPlayers || room.version!==WEB_VERSION} onClick={()=>setSelectedRoom(room.roomId)} aria-pressed={selectedRoom===room.roomId}>
                <span><strong>{room.name}</strong><small>{room.version!==WEB_VERSION ? '版本不兼容' : room.players>=room.maxPlayers ? '房间已满' : `${room.mapId===SOURCE_DUST2_ID?'Dust II':'塞勒涅港'} · ${ROOM_FORMATS.find((f)=>f.id===room.rules)?.label ?? '战术攻防'}`}</small></span><span>{room.players} / {room.maxPlayers}</span><ChevronRight size={18}/>
              </button>)}
            </div>
            <Button className="solid-button" disabled={connecting || !v.ready || !rooms.some(r=>r.roomId===selectedRoom && r.version===WEB_VERSION && r.players<r.maxPlayers)} onClick={()=>{const room=rooms.find(r=>r.roomId===selectedRoom);if(room) void connect(false,room);}}>
              {connecting ? '正在加入…' : '加入所选房间'} <ArrowRight size={18}/>
            </Button>
          </>}
          {(roomsError || v.error) && <p className="lan-error" role="alert">{roomsError || v.error}</p>}
          <details className="lan-advanced"><summary>手动连接与服务地址</summary>
            <label htmlFor="server-url">服务器地址</label><Input id="server-url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} />
            <label htmlFor="room-code">房间代码</label><Input id="room-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}/>
            <Button variant="outline" disabled={connecting || code.length!==6 || !endpoint} onClick={()=>connect(false)}>使用代码加入</Button>
          </details>
          <LANAddresses originalDust2={originalDust2} />
          <p className="small-note">房主离开后由下一名玩家接任；最后一名玩家离开后房间关闭。</p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!pause}
        onOpenChange={(open) => {
          if (!open) game.current?.resume();
        }}
      >
        <DialogContent
          className="tactical-dialog pause-dialog"
          showCloseButton={false}
        >
          <div className="operation-id">OPERATION PAUSED</div>
          <DialogTitle>{v.online ? '行动进行中' : '暂停行动'}</DialogTitle>
          <DialogDescription>
            {v.online
              ? '联机对局继续进行，点击下方返回战场。'
              : '点击继续捕获鼠标，Esc 随时释放。'}
          </DialogDescription>
          <Button
            className="solid-button"
            onClick={() => game.current?.resume()}
          >
            继续行动 <ArrowRight />
          </Button>
          {v.online && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(v.roomCode);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? '房间代码已复制' : `复制房间代码 ${v.roomCode}`}
            </Button>
          )}
          <Button variant="outline" onClick={openSettings}>
            游戏设置
          </Button>
          <Button variant="ghost" onClick={returnMenu}>
            返回主菜单
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={v.buy}
        onOpenChange={(open) => {
          if (!open) {
            if (game.current) game.current.buying = false;
            game.current?.resume();
          }
        }}
      >
        <DialogContent className="tactical-dialog buy-dialog">
          <DialogTitle>
            购买装备 <span>$ {p?.money}</span>
          </DialogTitle>
          <DialogDescription>
            {s?.mode === 'training' ? '训练配装 · 可随时试用双方武器和装备'
              : !p?.alive ? '阵亡后请等待下一回合购买装备'
              : !buyWindowOpen(s) ? '请在购买时限内回到己方购买区'
              : `${p.team === 'amber' ? '进攻方 T' : '防守方 CT'} · 武器、护甲和投掷物按余额购买，存活装备保留至下一回合`}
          </DialogDescription>
          <div className="shop-list">
            {Object.entries(WEAPONS)
              .filter(([id]) => originalDust2?id==='vandal'||id==='m4a4'||id==='glock'||id==='usp'||id==='deagle'||id==='awp':id !== 'sidearm' && id !== 'spectre'&&id!=='m4a4'&&id!=='glock'&&id!=='usp'&&id!=='deagle'&&id!=='awp')
              .filter(([id]) => !originalDust2 || s?.mode === 'training' || !!p && sourceWeaponTeamAllows(p.team,id as WeaponId))
              .map(([id, w]) => {
                const owned=originalDust2&&((id==='glock'||id==='usp'||id==='deagle')&&p?.secondary===id||p?.primary===id);
                return (
                <Button
                  key={id}
                  variant="outline"
                  disabled={
                    !p || !p.alive ||
                    p.money < w.cost ||
                    (originalDust2&&(id==='glock'||id==='usp'||id==='deagle')&&p.secondary===id) ||
                    (originalDust2&&(id==='vandal'||id==='m4a4'||id==='awp')&&p.primary===id) ||
                    !buyWindowOpen(s)
                  }
                  onClick={() => game.current?.buy(id)}
                >
                  <span>
                    {w.name}
                    <small>
                      {w.label} · {w.mag} 发
                    </small>
                  </span>
                  <b>{owned?'已拥有':`$ ${w.cost}`}</b>
                </Button>
              );})}
            <Button
              variant="outline"
              disabled={
                !p || !p.alive ||
                p.money < 650 ||
                p.armor >= 100 ||
                !buyWindowOpen(s)
              }
              onClick={() => game.current?.buy('armor')}
            >
              <span>
                {originalDust2?'防弹衣':'战术护甲'}<small>补满 100 护甲</small>
              </span>
              <b>$ 650</b>
            </Button>
            {originalDust2&&<Button variant="outline"
              disabled={!p||!p.alive||!!p.helmet||p.money<(p.armor>=100?350:1000)||!buyWindowOpen(s)}
              onClick={()=>game.current?.buy('helmet')}>
              <span>{p&&p.armor>=100?'头盔升级':'防弹衣 + 头盔'}<small>头部与身体防护</small></span>
              <b>$ {p&&p.armor>=100?350:1000}</b>
            </Button>}
            {originalDust2 && SOURCE_UTILITY_SHOP.map(item => <Button key={item.id} variant="outline"
              disabled={!p || !buyWindowOpen(s) || !sourceUtilityPurchaseAllowed(p,item.id)}
              onClick={() => game.current?.buy(item.id)}>
              <span>{UTILITY_LABELS[item.id]}<small>持有 {p?.[item.field] ?? 0} / {item.limit} · 投掷物合计最多 4 枚</small></span>
              <b>$ {item.cost}</b>
            </Button>)}
            {originalDust2 && p?.team === 'blue' && <Button variant="outline"
              disabled={!p.alive || !!p.defuseKit || p.money < SOURCE_DEFUSE_KIT_COST || !buyWindowOpen(s)}
              onClick={() => game.current?.buy('defuseKit')}>
              <span>拆弹器<small>拆弹时间由 {SOURCE_OBJECTIVE_TIMERS.defuse} 秒缩短至 {SOURCE_OBJECTIVE_TIMERS.defuseKit} 秒</small></span>
              <b>{p.defuseKit ? '已拥有' : `$ ${SOURCE_DEFUSE_KIT_COST}`}</b>
            </Button>}
          </div>
        </DialogContent>
      </Dialog>
      {(v.board || match) && s && (
        <div className="score-overlay">
          <section className="score-panel">
            <div className="operation-id">
              {match ? 'MISSION COMPLETE' : 'LIVE OPERATION'}
            </div>
            <h2>
              {match
                ? s.winner === null
                  ? '比赛平局'
                  : s.winner === p?.team
                  ? '任务胜利'
                  : '任务结束'
                : '队伍战况'}
            </h2>
            <p>
              {mapName} · {s.score.amber} : {s.score.blue}
            </p>
            {(['amber', 'blue'] as const).map((team) => (
              <div key={team} className={`score-team ${team}`}>
                <h3>{team === 'amber' ? '琥珀 / 进攻方' : '苍蓝 / 防守方'}</h3>
                <div className="score-table">
                  <div>
                    <span>行动员</span>
                    <span>击败</span>
                    <span>阵亡</span>
                    <span>资金</span>
                  </div>
                  {s.players
                    .filter((p) => p.team === team)
                    .sort((a, b) => b.kills - a.kills)
                    .map((a) => (
                      <div key={a.id} className={a.id === p?.id ? 'you' : ''}>
                        <span>
                          {a.alive ? '●' : '○'} {a.name}{' '}
                          <small>
                            {a.bot ? 'AI' : a.id === p?.id ? '你' : ''}
                          </small>
                        </span>
                        <b>{a.kills}</b>
                        <span>{a.deaths}</span>
                        <span>$ {a.money}</span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
            {match && (
              <div className="result-actions">
                <Button
                  className="solid-button"
                  onClick={() => game.current?.restart()}
                >
                  <RotateCcw size={17} />
                  再次行动
                </Button>
                <Button variant="outline" onClick={returnMenu}>
                  返回菜单
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
      <div className="small-screen">
        <Monitor size={38} />
        <h2>请使用电脑进入{mapName}</h2>
        <p>
          请在电脑浏览器中使用键盘和鼠标，获得完整的瞄准和移动体验。
        </p>
      </div>
    </main>
  );
}
