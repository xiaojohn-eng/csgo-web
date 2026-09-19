/** Original shared WeaponIdle and SendWeaponAnim timer stores; selected model durations are data. */
import type {SourceBaseGunCommandEvent} from './source-basegun-command.js';
const F=Math.fround;
export function sourceBaseGunIdleAfterCommand<Result extends {state:{clip:number};events:readonly SourceBaseGunCommandEvent[];dispatch:string}>(before:{nextPrimary:number},result:Readonly<Result>,context:{now:number;buttons:number},previousIdleTime:number,spec:{duration:(activity:number)=>number|undefined;timeToIdle:number;idleInterval:number;additionalDuration?:(event:SourceBaseGunCommandEvent)=>number|undefined}) {
  const now = F(context.now);
  let idleTime = F(previousIdleTime);
  if (!Number.isFinite(idleTime) || !Number.isFinite(now)) throw new RangeError('Invalid original weapon idle time');
  const events: SourceBaseGunCommandEvent[] = [...result.events], idleStores: number[] = [];
  const store = (value: number) => { idleTime = F(value); idleStores.push(idleTime); };
  const selectedActivity = (activity: number) => {
    const duration=spec.duration(activity);
    if(duration!==undefined)store(F(now+duration));
  };
  for (const event of result.events) {
    if (event.kind === 'activity') selectedActivity(event.activity);
    else if (event.kind === 'bullet' && event.source === 'primary') store(F(now + spec.timeToIdle));
    const additional=spec.additionalDuration?.(event);if(additional!==undefined)store(F(now+additional));
  }
  // Original ordinary no-attack branch d44160, before tailcall vt4dc=d47610.
  // A manual reload attempt returns even if its ammo/maxClip gate rejected it.
  const manualReloadAttempt = Boolean(context.buttons & 0x2000) && now > F(before.nextPrimary);
  const startedReload = result.events.some(event => event.kind === 'activity' && event.activity === 194);
  const idleInvoked = result.dispatch === 'post' && !(context.buttons & 0x80801) && !manualReloadAttempt && !startedReload;
  if (idleInvoked && now >= idleTime && result.state.clip !== 0) {
    store(F(now + spec.idleInterval));
    events.push({ kind: 'activity', activity: 185 });
    selectedActivity(185);
  }
  return { ...result, events, idleTime, idleInvoked, idleStores };
}
