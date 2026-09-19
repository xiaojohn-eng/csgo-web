import {expect,it,vi} from 'vitest';
import {createSourceMapWind} from '../game/source-map-wind';
import {createSourceWind,DUST2_WIND_PARAMETERS,updateSourceWind} from '../game/source-wind';

it('uses one nextThink schedule but writes current shader time on every frame',()=>{
 const sink=vi.fn(),owner=createSourceMapWind(sink),native=createSourceWind(DUST2_WIND_PARAMETERS,{seed:0,startTime:0,initialDirection:0,initialSpeed:0});
 let thinks=0;
 for(let frame=0;frame<=2400;frame++){
  const now=Math.fround(frame/240);
  if(now>=native.nextThinkTime){updateSourceWind(native,now);thinks++;}
  const result=owner.update(now,'room-a');
  expect(result.windSourceXY).toEqual(native.renderParameter3.slice(0,2));
  expect(result.currentWind).toEqual(native.currentWind);
  expect(result.nextThinkTime).toBe(native.nextThinkTime);
  expect(sink.mock.lastCall?.[0]).toEqual({timeSeconds:now,windSourceXY:native.renderParameter3.slice(0,2)});
 }
 expect(owner.audit.thinkCalls).toBe(thinks);expect(owner.audit.shaderUpdates).toBe(2401);
 expect(owner.audit.epochResets).toBe(1);
});
it('paused fractional time is stable and does not consume another RNG sample',()=>{
 const sink=vi.fn(),owner=createSourceMapWind(sink);
 owner.update(.1,'room-a');const before=owner.snapshot();
 for(let i=0;i<20;i++)expect(owner.update(.1,'room-a').thinkUpdated).toBe(false);
 expect(owner.snapshot().state).toEqual(before.state);expect(owner.audit.thinkCalls).toBe(1);
 expect(sink).toHaveBeenCalledTimes(21);
});
it('epoch changes explicitly reset the zero clock, seeds and both old wind caches',()=>{
 const sink=vi.fn(),owner=createSourceMapWind(sink);
 for(let i=0;i<3000;i++)owner.update(i/60,'room-a');
 expect(owner.snapshot().state?.renderParameter3[0]).not.toBe(0);
 const reset=owner.update(0,'menu-b'),fresh=createSourceMapWind(vi.fn()).update(0,'menu-b');
 expect(reset).toEqual(fresh);expect(owner.audit.epochResets).toBe(2);
 expect(owner.snapshot().state?.seed).toBe(0);expect(owner.snapshot().state?.startTime).toBe(0);
 expect(sink.mock.lastCall?.[0]).toEqual({timeSeconds:0,windSourceXY:[0,0]});
 owner.update(.1,'menu-b');expect(owner.update(0,'room-c').epochReset).toBe(true);
});
it('rejects clock/epoch misuse before state or uniforms change, and blocks use after disposal',()=>{
 const sink=vi.fn(),owner=createSourceMapWind(sink);owner.update(4,'a');const before=owner.snapshot(),calls=sink.mock.calls.length;
 for(const [time,epoch]of [[3,'a'],[NaN,'a'],[Infinity,'a'],[-1,'new'],[305,'a'],[301,'new'],[0,'']]as const)
  expect(()=>owner.update(time,epoch)).toThrow();
 expect(owner.snapshot()).toEqual(before);expect(sink).toHaveBeenCalledTimes(calls);
 owner.dispose();owner.dispose();expect(()=>owner.update(5,'a')).toThrow(/disposed/);expect(sink).toHaveBeenCalledTimes(calls);
});
