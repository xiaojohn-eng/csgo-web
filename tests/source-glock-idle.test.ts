import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSourceGlockCommandState, sourceGlockCommandFrame, sourceGlockDeploy, sourceGlockHolster, SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION, SOURCE_GLOCK_DRAW_SEQUENCE_DURATION, type SourceGlockCommandState, type SourceGlockCommandContext, type SourceGlockCommandResult } from '../game/source-glock-command';
import { sourceGlockIdleAfterCommand, type SourceGlockIdleEvent } from '../game/source-glock-idle';
import { createSourceGlockAnimationClock, requestSourceGlockAnimationActivity, requestSourceGlockAnimationSequence } from '../game/source-glock-animation-clock';
import { createSourceGlockRuntimeState, sourceGlockRuntimeFrame, sourceGlockRuntimeDeploy, sourceGlockRuntimeHolster, sourceGlockRuntimePostThink } from '../game/source-glock-runtime';
import { sourcePistolHandlingMode } from '../game/source-pistol-handling';
type NativeRow = { label: string; input: Partial<SourceGlockCommandState> & { idleTime?: number }; context: SourceGlockCommandContext & { operation?: string }; result: Omit<SourceGlockCommandResult, 'events'> & { events: SourceGlockIdleEvent[]; attributes: unknown[]; idleTime: number; idleInvoked: boolean; idleStores: number[] } };
const corpus = JSON.parse(readFileSync('output/tests/source-glock-idle-native.json', 'utf8')) as { caseCount: number; cases: NativeRow[] };
function evaluate(row: NativeRow) {
  const { idleTime, ...fields } = row.input;
  const state = createSourceGlockCommandState(fields), ctx = { ...row.context, reloadDuration: SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION };
  const result = ctx.operation === 'deploy' ? sourceGlockDeploy(state, { now: ctx.now, sequenceDuration: SOURCE_GLOCK_DRAW_SEQUENCE_DURATION }) : ctx.operation === 'holster' ? sourceGlockHolster(state, { now: ctx.now, sequenceDuration: 0 }) : sourceGlockCommandFrame(state, ctx);
  return sourceGlockIdleAfterCommand(state, result, ctx, idleTime ?? 0);
}
describe('original Glock WeaponIdle and idle timer', () => {
  it('runs all native idle command cases through the playable handling and animation bridge',()=>{
    for(const [i,row]of corpus.cases.entries()){
      const state=createSourceGlockRuntimeState(row.context.now);
      const {idleTime,...command}=row.input;state.command=createSourceGlockCommandState(command);state.idleTime=idleTime??0;
      state.handling=sourcePistolHandlingMode(state.handling,state.command.mode);
      const result=row.context.operation==='deploy'?sourceGlockRuntimeDeploy(state,row.context.now,{grounded:true}):row.context.operation==='holster'?sourceGlockRuntimeHolster(state,row.context.now):sourceGlockRuntimeFrame(state,{...row.context,accuracy:{grounded:true},execution:{type:'prediction'}});
      expect(result.state.command,`${i} command`).toEqual(row.result.state);
      expect(result.state.idleTime,`${i} idle timer`).toBe(row.result.idleTime);
      expect(result.events.map(e=>{const {shot:_,serverSeed:__,...rest}=e as any;return rest;}),`${i} ordered events`).toEqual(row.result.events.map(e=>{const {serverSeed:_,...rest}=e as any;return rest;}));
    }
  });
  it('holds the completed single-fire sequence until the native two-second idle gate, with JSON replay',()=>{
    const step=(state:ReturnType<typeof createSourceGlockRuntimeState>,now:number,buttons=0)=>{
      const command=sourceGlockRuntimeFrame(state,{now,dt:1/64,buttons,commandSeed:42,accuracy:{grounded:true},execution:{type:'prediction'}});
      const {animTime,previousAnimTime}=state.animation!;
      return sourceGlockRuntimePostThink(command.state,{now,viewmodelTime:{animTime,previousAnimTime}}).state;
    };
    let state=createSourceGlockRuntimeState(10),replay=structuredClone(state);
    for(let i=0;i<=160;i++){
      const now=10+i/64,buttons=i===0?1:0;state=step(state,now,buttons);replay=step(replay,now,buttons);
      expect(replay).toEqual(state);if(i%13===0)replay=JSON.parse(JSON.stringify(replay));
      if(i===64){expect(state.animation!.sequence).toBe(1);expect(state.animation!.cycle).toBe(1);expect(state.idleTime).toBe(12);}
      if(i===128){expect(state.animation!.sequence).toBe(0);expect(state.action!.activity).toBe(192);expect(state.command.clip).toBe(19);}
    }
  });
  it('matches all 658 original command/ammo clocks, ordered activities and idle stores', () => {
    expect(corpus.caseCount).toBe(658);
    for (const [i, row] of corpus.cases.entries()) {
      const { attributes: _, ...expected } = row.result;
      expect(evaluate(row), `${i} ${row.label}`).toEqual(expected);
    }
  });
  it('distinguishes original primary2s from queued0.4s and final idle0.033s stores', () => {
    const primary = corpus.cases.find(x => x.label === 'idle-gate' && x.input.clip === 3 && x.input.idleTime === 0 && x.input.nextPrimary === 0 && x.context.buttons === 1)!;
    expect(evaluate(primary).idleTime).toBe(12);
    const queued = corpus.cases.find(x => x.label === 'queued-idle' && x.context.buttons === 0)!;
    expect(evaluate(queued).idleTime).toBe(Math.fround(10 + Math.fround(.4)));
    const idle = corpus.cases.find(x => x.label === 'idle-gate' && x.input.clip === 3 && x.input.idleTime === 0 && x.input.nextPrimary === 0 && x.context.buttons === 0)!;
    expect(evaluate(idle).idleStores).toEqual([30, Math.fround(10 + Math.fround(1 / 30))]);
  });
  it('does not let the idle activity reset an original lookat VM before its guard opens', () => {
    const inspect = requestSourceGlockAnimationSequence(createSourceGlockAnimationClock(10), 5).state;
    expect(requestSourceGlockAnimationActivity(inspect, 185)).toEqual({ state: inspect, applied: false });
  });
});
