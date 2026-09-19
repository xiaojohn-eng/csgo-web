export type SourceSoundCursor={pose:string;time:number;generation:number};
/** Emit events crossed by actual animation sampling. A small authority clock
 * correction must not replay an already heard event; a new action may restart. */
export function advanceSourceSoundEvents(previous:SourceSoundCursor|undefined,current:SourceSoundCursor,events:readonly{time:number;event:string}[],options:{sourceCycleWindow?:boolean}={}){
  const same=previous?.pose===current.pose&&previous.generation===current.generation;
  const from=same?previous.time:-Infinity;
  return {events:events.filter(e=>options.sourceCycleWindow?e.time>=from&&e.time<current.time:e.time>from&&e.time<=current.time).map(e=>e.event),
    cursor:{...current,time:same?Math.max(previous.time,current.time):current.time}};
}
