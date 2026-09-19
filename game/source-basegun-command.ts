/** Original ordinary CSBaseGun command order, shared by verified weapon profiles. */
const F=Math.fround,ATTACK_MASK=0x80801;
export interface SourceBaseGunCommandState{
 clip:number;reserve:number;nextPrimary:number;nextSecondary:number;ownerNextAttack:number;
 mode:0|1;shotsFired:number;lastShot:number;dryFireCount:number;reloading:boolean;
 fireOnEmpty:boolean;waitForNoAttack:boolean;reloadVisComplete:boolean;
}
export interface SourceBaseGunCommandContext{
 now:number;dt:number;buttons:number;commandSeed:number;serverSeed?:number;active?:boolean;owner?:boolean;
 rulePredicateBlock?:boolean;playerBlocked?:boolean;playerBlockingField15a0?:number;noAutoReload?:boolean;reloadDuration:number;
}
export type SourceBaseGunCommandEvent=
 |{kind:'weapon-tick';mode:0|1;reloading:boolean}|{kind:'activity';activity:number}
 |{kind:'bullet';source:'primary'|'queued';mode:0|1;accuracyMode:0|1;recoilMode:0|1;scheduledTime:number;queue:number;commandSeed:number;serverSeed?:number}
 |{kind:'empty'}|{kind:'mode-message';message:string}|{kind:'sound';name:string}|{kind:'player-animation-event';id:number};
export interface SourceBaseGunCommandResult<State>{state:State;events:SourceBaseGunCommandEvent[];dispatch:'inactive'|'busy'|'post';buttonsAfter:number}
type Bullet=(source:'primary'|'queued',mode:0|1,time:number)=>void;
export interface SourceBaseGunCommandSpec<State>{
 create:(input:Readonly<State>)=>State;maxClip:number;cycleTime:(state:State)=>number;
 queue?:(state:State)=>number;beforeTick?:(state:State,events:SourceBaseGunCommandEvent[],bullet:Bullet,now:number)=>void;
 beforePrimary?:(state:State,now:number)=>void;afterBullet?:(state:State,events:SourceBaseGunCommandEvent[])=>void;
 primaryActivity?:(state:State)=>number;
 secondary:(state:State,events:SourceBaseGunCommandEvent[],now:number)=>void;
}
function finite(value: number, name: string) {
  if (!Number.isFinite(value) || !Number.isFinite(F(value))) throw new RangeError(`Invalid weapon ${name}`);
  return F(value);
}
function integer(value: number, name: string, maximum = 0x7fffffff) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid weapon ${name}`);
  return value;
}
function seed(value: number, name: string) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new RangeError(`Invalid weapon ${name}`);
}

export function createSourceBaseGunCommandDriver<State extends SourceBaseGunCommandState>(spec:SourceBaseGunCommandSpec<State>){
return function frame(input:Readonly<State>,context:Readonly<SourceBaseGunCommandContext>){
  const state = spec.create(input), events: SourceBaseGunCommandEvent[] = [];
  const now = finite(context.now, 'now'), dt = finite(context.dt, 'dt');
  if (dt < 0) throw new RangeError('Invalid weapon dt');
  let buttons = integer(context.buttons, 'buttons', 0xffffffff);
  // These invoke separate third-attack/special reload branches, outside this ordinary weapon contract.
  if (buttons & 0x4080000) throw new RangeError('Unsupported weapon special command buttons');
  seed(context.commandSeed, 'commandSeed');
  if (context.serverSeed !== undefined) seed(context.serverSeed, 'serverSeed');
  const result = (dispatch: 'inactive'|'busy'|'post'):SourceBaseGunCommandResult<State> => ({ state, events, dispatch, buttonsAfter: buttons });
  if (context.active === false || context.owner === false) return result('inactive');
  // 61bf19: owner clock chooses BusyFrame BEFORE the gun's queue dispatch.
  if (state.ownerNextAttack > now) {
    events.push({ kind: 'weapon-tick', mode: state.mode, reloading: state.reloading });
    if (!(buttons & ATTACK_MASK)) state.waitForNoAttack = false;
    return result('busy');
  }
  const bullet = (source: 'primary' | 'queued', mode: 0 | 1, scheduledTime: number) => {
    events.push({ kind: 'bullet', source, mode, accuracyMode: state.mode, recoilMode: mode, scheduledTime, queue: spec.queue?.(state)??0, commandSeed: context.commandSeed,
      ...(context.serverSeed === undefined ? {} : { serverSeed: context.serverSeed }) });
  };
  spec.beforeTick?.(state,events,bullet,now);
  events.push({ kind: 'weapon-tick', mode: state.mode, reloading: state.reloading });
  // d4440b: ammo transfer happens after the gun queue, then input dispatch.
  if (state.reloading && now >= state.ownerNextAttack) {
    const count = Math.min(spec.maxClip - state.clip, state.reserve);
    state.clip += count; state.reserve -= count; state.reloading = false;
  }
  if ((buttons & 1) && now >= state.nextPrimary) {
    if (state.clip === 0) state.fireOnEmpty = true;
    if (context.rulePredicateBlock || context.playerBlocked || context.playerBlockingField15a0 || state.shotsFired > 0 || state.waitForNoAttack) return result('post');
    spec.beforePrimary?.(state,now);
    if (state.clip === 0) {
      if (state.fireOnEmpty) {
        events.push({ kind: 'empty' }); state.dryFireCount++;
        state.nextPrimary = F(now + F(0.2));
      }
    } else {
      const delta = F(now - state.nextPrimary);
      const base = delta < 0 || delta > dt ? now : state.nextPrimary;
      state.nextPrimary = state.nextSecondary = F(base + F(spec.cycleTime(state)));
      events.push({ kind: 'activity', activity: spec.primaryActivity?.(state)??192 });
      bullet('primary', state.mode, base);
      state.shotsFired++; state.clip--;
      spec.afterBullet?.(state,events);
    }
    // d43a43: the attempt writes lastShot even if CSBaseGunFire was dry.
    state.lastShot = now;
    return result('post');
  }
  if ((buttons & 0x800) && now >= state.nextSecondary) {
    spec.secondary(state,events,now);
    state.nextSecondary = F(now + F(0.3));
    buttons &= ~0x800;
    return result('post');
  }
  const startReload = () => {
    if (state.reserve <= 0 || state.clip >= spec.maxClip) return;
    const duration = finite(context.reloadDuration, 'reloadDuration');
    if (duration < 0) throw new RangeError('Invalid weapon reloadDuration');
    events.push({ kind: 'activity', activity: 194 });
    state.ownerNextAttack = state.nextPrimary = state.nextSecondary = F(now + duration);
    state.reloading = true; state.shotsFired = 0; state.reloadVisComplete = false;
  };
  // Strict greater-than here, distinct from >= for fire and mode switch.
  if ((buttons & 0x2000) && !state.reloading && now > state.nextPrimary) {
    startReload(); return result('post');
  }
  if (!(buttons & ATTACK_MASK)) {
    state.fireOnEmpty = false; state.waitForNoAttack = false; state.shotsFired = 0;
    if (now > state.nextPrimary && state.clip === 0 && state.reserve > 0 && !context.noAutoReload && !state.reloading) startReload();
  }
  return result('post');
}

}
