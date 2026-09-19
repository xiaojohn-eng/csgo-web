import {it,expect} from 'vitest';
import {advanceSourceSoundEvents} from '../game/source-sound-timeline';
import timeline from '../game/source-m4a4-sound-timeline.json';
it('emits every crossed original M4 reload event once after a long render frame',()=>{
  const first=advanceSourceSoundEvents(undefined,{pose:'reload',time:1.3,generation:0},timeline.reload);
  expect(first.events).toEqual(['Weapon_M4A1.Clipout','Weapon_M4A1.Clipin']);
  const second=advanceSourceSoundEvents(first.cursor,{pose:'reload',time:2.1,generation:0},timeline.reload);
  expect(second.events).toEqual(['Weapon_M4A1.ClipHit']);
  expect(advanceSourceSoundEvents(second.cursor,{pose:'reload',time:2.1,generation:0},timeline.reload).events).toEqual([]);
});
it('does not replay sounds after reconciliation but permits a newly started draw',()=>{
  const a=advanceSourceSoundEvents(undefined,{pose:'draw',time:.7,generation:1},timeline.draw);
  expect(a.events).toHaveLength(3);
  const back=advanceSourceSoundEvents(a.cursor,{pose:'draw',time:.3,generation:1},timeline.draw);
  expect(back.events).toEqual([]);expect(back.cursor.time).toBe(.7);
  expect(advanceSourceSoundEvents(back.cursor,{pose:'draw',time:.65,generation:1},timeline.draw).events).toEqual([]);
  expect(advanceSourceSoundEvents(back.cursor,{pose:'draw',time:0,generation:2},timeline.draw).events).toEqual(['Weapon_M4A1.Draw']);
});
