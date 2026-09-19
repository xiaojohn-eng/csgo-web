/** Shared original nonloop viewmodel clock. Model profiles/activities are data;
 * arithmetic and event ordering retain the independently verified Glock oracle.
 */
import {advanceSourceViewmodelAnimTimes} from './source-viewmodel-animation-time.js';
import {drawSourceActivityVariant,sourceActivityDrawValue} from './source-weapon-fire-draw.js';
const F=Math.fround;
export interface SourceViewmodelAnimationClock<Sequence extends number=number>{
 sequence:Sequence;cycle:number;animTime:number;previousAnimTime:number;eventCursor:number;
 playbackRate:number;finished:boolean;sequenceParity:number;resetEventsParity:number;animationParity:number;
}
export interface SourceViewmodelAnimationEvent{record:number;recordEvent:number;type:number;cycle:number;eventTime:number;options:string}
export interface SourceViewmodelAnimationProfile<Sequence extends number=number>{
 sequence:Sequence;name:string;duration:number;fadeOut:number;flags:number;
 events:readonly Omit<SourceViewmodelAnimationEvent,'eventTime'>[];
}
/** One of the sequences a model gives an activity, with the model's own `actweight`. */
export interface SourceActivityVariant<Sequence extends number=number>{sequence:Sequence;weight:number}
/** Resolve a model's own variant names against a weapon's sequence table.
 *
 * The first variant must be the sequence that activity already maps to: a table that
 * disagreed with the mapping about the activity's own default would mean one of the two
 * reads the model wrongly, so that is refused rather than drawn from. */
export function sourceActivityVariants<Sequence extends number>(
 data:readonly{sequence:Sequence;name:string}[],
 activity:number,
 variants:readonly{name:string;weight:number}[],
 activities:Readonly<Record<number,Sequence|undefined>>){
 if(!variants.length)throw Error('Original activity variant table is empty');
 const resolved=variants.map(row=>{
  const profile=data.find(entry=>entry.name===row.name);
  if(!profile)throw Error(`Original model has no sequence named ${row.name}`);
  if(!Number.isInteger(row.weight)||row.weight<0)throw Error(`Invalid original activity weight for ${row.name}`);
  return{sequence:profile.sequence,weight:row.weight};
 });
 const known=activities[activity];
 if(known===undefined)throw Error(`Original activity ${activity} is not one this weapon maps`);
 if(resolved[0].sequence!==known)throw Error(`Original activity ${activity} default differs from its variant table`);
 return{[activity]:resolved} as Record<number,readonly SourceActivityVariant<Sequence>[]>;
}
export function createSourceViewmodelAnimationDriver<Sequence extends number>(
 data:readonly SourceViewmodelAnimationProfile<Sequence>[],activities:Readonly<Record<number,Sequence|undefined>>,
 {inspect,idle,additionalInspect=[],variants,random=Math.random}:{
   inspect:Sequence;idle:Sequence;additionalInspect?:readonly Sequence[];
   /** The activities whose sequence a model gives more than one of, with the model's own
    * weights. Absent, every activity keeps its single sequence exactly as before. */
   variants?:Readonly<Record<number,readonly SourceActivityVariant<Sequence>[]>>;
   /** The draw for those activities. Local presentation only, so it is the caller's. */
   random?:()=>number;
 }){
 type Clock=SourceViewmodelAnimationClock<Sequence>;
 if(!data.length||data.some((p,i)=>p.sequence!==i||p.flags&1||!(p.duration>0)||!Number.isFinite(p.duration)))throw Error('Unsupported original nonloop animation data');
 for(const[key,variantsOf]of Object.entries(variants??{})){
  const activity=Number(key);
  if(variantsOf.length<2)throw Error(`Original activity ${activity} needs a variant table only when it has several`);
  if(variantsOf[0].sequence!==activities[activity])throw Error(`Original activity ${activity} default differs from its variant table`);
  const total=variantsOf.reduce((sum,row)=>sum+row.weight,0);
  if(!(total>0))throw Error(`Original activity ${activity} variant weights sum to nothing`);
 }
function finite(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isFinite(F(value))) throw new RangeError(`Invalid original weapon animation ${label}`);
  return F(value);
}
function getProfile(sequence: Sequence) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence >= data.length) throw new RangeError('Unsupported original weapon animation sequence');
  return data[sequence];
}
/** Constructor clock fields 5b22b0..5b22de initialize both anim times to curtime.
 * The selected action must still be started with reset.
 */
function create(now: number): Clock {
  const time = finite(now, 'birth time');
  return { sequence: idle, cycle: 0, animTime: time, previousAnimTime: time, eventCursor: 0,
    playbackRate: 0, finished: false, sequenceParity: 0, resetEventsParity: 0, animationParity: 0 };
}
/** Complete JSON restore, without an implicit reset or new local dt. */
function restore(input: Readonly<Clock>): Clock {
  getProfile(input.sequence);
  const state = { ...input };
  for (const key of ['cycle', 'animTime', 'previousAnimTime', 'eventCursor', 'playbackRate'] as const) state[key] = finite(state[key], key);
  if (state.cycle < 0 || state.cycle > 1 || state.eventCursor < 0 || state.eventCursor > F(1.01) || state.playbackRate < 0 || state.playbackRate > 2) throw new RangeError('Unsupported original weapon animation clock range');
  for (const key of ['sequenceParity', 'resetEventsParity', 'animationParity'] as const) if (!Number.isInteger(state[key]) || state[key] < 0 || state[key] > 7) throw new RangeError('Invalid original weapon animation parity');
  if (typeof state.finished !== 'boolean') throw new TypeError('Invalid original weapon animation finished flag');
  return state;
}
/** Original SendViewModelMatchingSequence resets even the same nonloop sequence.
 * Failed activity selection (e.g. ACT_VM_HOLSTER) must NOT call this function.
 * This preserves both anim times; it does not postpone this frame's advancement.
 */
function reset(input: Readonly<Clock>, sequence: Sequence): Clock {
  const state = restore(input); getProfile(sequence);
  state.sequence = sequence; state.cycle = 0; state.eventCursor = 0; state.finished = false; state.playbackRate = 1;
  state.animationParity = (state.animationParity + 1) & 7;
  state.sequenceParity = (state.sequenceParity + 1) & 7; state.resetEventsParity = (state.resetEventsParity + 1) & 7;
  return state;
}
/** Original d446fa..d44760 lookat/idle guard, for an ordinary owned viewmodel.
 * Owner/observer gates remain with the command caller. Other chosen sequences
 * interrupt lookat; the same nonloop sequence restarts when accepted.
 */
function requestSequence(input: Readonly<Clock>, sequence: Sequence) {
  const state = restore(input); getProfile(sequence);
  if ((state.sequence === inspect || additionalInspect.includes(state.sequence)) && state.cycle < F(.98) && sequence === idle) return { state, applied: false };
  return { state: reset(state, sequence), applied: true };
}
/** Exact five named activities in the default Glock MDL. Missing activity keeps
 * all viewmodel clock fields. In particular 184/HOLSTER does not start a clip.
 *
 * An activity this model gives several sequences draws one by the model's own weights.
 * The draw is a uniform integer over the summed weights, so equal weights give each
 * variant the same chance -- which is what these models weigh them at.
 *
 * A caller that has to reach the same variant on two sides passes the seed they share;
 * without one the draw is local, which is what the original first-person view does. */
function requestActivity(input: Readonly<Clock>, activity: number, seed?: number) {
  if (!Number.isInteger(activity)) throw new RangeError('Invalid weapon animation activity');
  const table = variants?.[activity];
  if (table && table.length > 1) {
    const draw = seed === undefined ? random : () => sourceActivityDrawValue(seed);
    return requestSequence(input, table[drawSourceActivityVariant(table.map((row) => row.weight), draw)].sequence);
  }
  const sequence = activities[activity];
  return sequence === undefined ? { state: restore(input), applied: false } : requestSequence(input, sequence);
}
/** Original default m_flFrozen=0, no playback-rate interpolation record; the supplied
 * verified source sequences are nonloop. Caller supplies current server time.
 */
function advance(input: Readonly<Clock>, nowValue: number): Clock {
  const state = restore(input), now = finite(nowValue, 'curtime');
  const timing = advanceSourceViewmodelAnimTimes(state, now);
  state.previousAnimTime = timing.state.previousAnimTime; state.animTime = timing.state.animTime;
  if (!timing.advanced) return state;
  const interval = timing.interval;
  const profile = getProfile(state.sequence), rate = F(1 / profile.duration);
  const candidate = F(state.cycle + F(F(interval * state.playbackRate) * rate));
  if (candidate < 0 || candidate >= 1) { state.cycle = Math.max(0, Math.min(1, candidate)); state.finished = true; }
  else {
    const finishedThreshold = F(1 - F(F(state.playbackRate * profile.fadeOut) * rate));
    if (candidate > finishedThreshold) state.finished = true;
    state.cycle = candidate;
  }
  return state;
}
/** Original DispatchAnimEvents on the already advanced viewmodel. eventTime is
 * original metadata, not an instruction to delay handler execution until then.
 */
function dispatch(input: Readonly<Clock>, nowValue: number): { state: Clock; events: SourceViewmodelAnimationEvent[] } {
  const state = restore(input), now = finite(nowValue, 'curtime'), events: SourceViewmodelAnimationEvent[] = [];
  const profile = getProfile(state.sequence);
  if (state.playbackRate === 0 || profile.events.length === 0) return { state, events };
  const cycleRate = F(state.playbackRate * F(1 / profile.duration));
  const start = state.eventCursor, end = state.finished ? F(1.01) : state.cycle;
  state.eventCursor = end;
  for (const event of profile.events) {
    const serverEvent = event.type & 1024 ? Boolean(event.type & 1) : event.recordEvent <= 4999 || event.recordEvent === 5004;
    if (!serverEvent || !(start <= event.cycle && event.cycle < end)) continue;
    let eventCycle: number = event.cycle;
    if (eventCycle > state.cycle) eventCycle = F(eventCycle - 1);
    const baseTime = F(F(F(eventCycle - state.cycle) * F(1 / cycleRate)) + state.animTime);
    const correction = Math.max(0, Math.min(F(.2), now > state.animTime ? F(now - state.animTime) : F(state.animTime - state.previousAnimTime)));
    events.push({ record: event.record, recordEvent: event.recordEvent, type: event.type, cycle: event.cycle, eventTime: F(baseTime + correction), options: event.options });
  }
  return { state, events };
}
function frame(input: Readonly<Clock>, now: number) {
  return dispatch(advance(input, now), now);
}

return {profile:getProfile,create,restore,reset,requestSequence,requestActivity,advance,dispatch,frame};
}
