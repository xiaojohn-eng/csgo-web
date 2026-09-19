import {it,expect} from 'vitest';
import {awpCharacterFixture} from './source-awp-character-fixture';
import {prepareSourceAWPCharacterPose,sampleSourceAWPCharacterPose,sourceAWPBodyCycleRate,sourceAWPCharacterWorldEvents,sourceAWPCharacterMagazineVisible,type SourceAWPCharacterPoseInput} from '../game/source-awp-character-pose';
it.each(['t','ct']as const)('%s retains actual AWP shot/reload rates and original world event clocks',team=>{
 const f=awpCharacterFixture(team),p={body_pitch:0,body_yaw:0,move_x:0,move_y:0};
 for(const state of ['Idle','Walk','Run'])expect(sourceAWPBodyCycleRate(f.index,state+'_Shoot_AWP',p)).toBe(30/44);
 for(const state of ['Crouch_Idle','Crouch_Walk'])expect(sourceAWPBodyCycleRate(f.index,state+'_Shoot_AWP',p)).toBe(30/36);
 expect(sourceAWPBodyCycleRate(f.index,'Reload_AWP',p)).toBe(30/110);
 const reload=f.index.body.namedSequences.get('Reload_AWP')!;expect(reload.autoLayers.map(l=>[l.peak,l.tail])).toEqual([[Math.fround(5/110),Math.fround(102/110)],[Math.fround(5/110),Math.fround(102/110)]]);
 const events=sourceAWPCharacterWorldEvents(f.index,'sniper_reload');expect(events.map(e=>e.name)).toEqual(['AE_CL_EJECT_MAG','AE_CL_EJECT_MAG_UNHIDE']);
 expect(sourceAWPCharacterMagazineVisible(f.index,'sniper_reload',events[0].cycle-1e-6)).toBe(true);expect(sourceAWPCharacterMagazineVisible(f.index,'sniper_reload',events[0].cycle)).toBe(false);expect(sourceAWPCharacterMagazineVisible(f.index,'sniper_reload',events[1].cycle)).toBe(true);
 const input=structuredClone(f.reference.cases[60].input)as SourceAWPCharacterPoseInput;expect(sampleSourceAWPCharacterPose(f.index,JSON.parse(JSON.stringify(input)))).toEqual(sampleSourceAWPCharacterPose(f.index,input));
});
it('rejects rifle/pistol graphs, unsupported actions and ambiguous layered event visibility',()=>{
 const f=awpCharacterFixture('t'),wrong={...f.index.body,data:{...f.index.body.data,weaponId:'deagle'}};
 expect(()=>prepareSourceAWPCharacterPose(wrong,f.index.world)).toThrow(/identity/);
 const p=structuredClone(f.reference.cases[60].input)as SourceAWPCharacterPoseInput;
 expect(()=>sampleSourceAWPCharacterPose(f.index,{...p,bodyLayers:[{sequence:'Reload_PISTOL',cycle:.5,weight:1}]}as unknown as SourceAWPCharacterPoseInput)).toThrow(/AWP body action/);
 p.world.layers=[{sequence:'sniper_reload',cycle:.25,weight:1}];expect(()=>sampleSourceAWPCharacterPose(f.index,p)).toThrow(/explicit magazine/);
 expect(sampleSourceAWPCharacterPose(f.index,{...p,magazineVisible:false}).magazineVisible).toBe(false);
});
