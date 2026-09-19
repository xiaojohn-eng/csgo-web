import {expect,it} from 'vitest';
import {awpCharacterFixture} from './source-awp-character-fixture';
import {createSourceAWPPoseDriver,interpolateSourceAWPPose,type SourceAWPPosePlayer} from '../game/source-awp-runtime-pose';
import {createSourceAWPRuntimeState} from '../game/source-awp-runtime';
import {sampleSourceAWPCharacterPose} from '../game/source-awp-character-pose';
const states=['Idle','Walk','Run','Crouch_Idle','Crouch_Walk']as const;
function fixture(team:'t'|'ct'){
  const source=awpCharacterFixture(team),driver=createSourceAWPPoseDriver(source.index,source.version);
  const player={id:'awp-owner',x:0,y:0,z:0,yaw:0,pitch:0,crouch:false,grounded:true,team:team==='t'?'amber':'blue',weapon:'awp',sourcePoseVersion:source.version,shotIdle:100,sourceAWP:createSourceAWPRuntimeState()}as SourceAWPPosePlayer;
  function at(time:number,activity:183|192|194=194,state:typeof states[number]='Idle',generation=1,startedAt=10){
    const p=structuredClone(player);p.sourceAWP!.action={activity,time:startedAt,generation};p.shotIdle=activity===192?Math.max(0,time-startedAt):100;
    p.crouch=state.startsWith('Crouch');p.sourcePose=driver.advance(p,p,1/60);p.sourcePose.state=state;
    return{player:p,pose:driver.awpPose(p,time)};
  }
  return{...source,driver,player,at};
}
it.each(['t','ct']as const)('%s AWP uses its original reload graph without inventing world fire or draw clips',team=>{
  const {index,at}=fixture(team);
  for(const state of states)for(const activity of [183,192,194]as const){
    const {pose}=at(10.2,activity,state),sample=sampleSourceAWPCharacterPose(index,pose);
    if(activity===194){
      expect(pose.bodyLayers?.[0].sequence).toBe('Reload_AWP');
      expect(pose.world.layers?.[0].sequence).toBe('sniper_reload'+(state.startsWith('Crouch')?'_crouch':'')+(['Walk','Run','Crouch_Walk'].includes(state)?'_moving':''));
      expect(pose.clock!.bodyRate).toBeCloseTo(30/110,12);expect(pose.clock!.worldRate).toBeCloseTo(30/110,12);
      expect(at(13.6,activity,state).pose.world.layers![0].weight).toBe(1);expect(at(13.7,activity,state).pose.world.layers![0].weight).toBe(0);
    }else{expect(pose.bodyLayers).toEqual([]);expect(pose.world.layers).toEqual([]);}
    expect(sample.body.sourceWorldMatrices).toHaveLength((team==='t'?71:74)*16);expect(sample.sourceWeaponWorldMatrices).toHaveLength(94*16);
    expect([...sample.body.sourceWorldMatrices,...sample.sourceWeaponWorldMatrices].every(Number.isFinite)).toBe(true);
  }
});
it.each(['t','ct']as const)('%s AWP ground selection uses its own 200-unit profile and preserves authority',team=>{
  const {driver,player}=fixture(team),dt=1/60;
  for(const [speed,walking,state]of [[103.99,false,'Walk'],[104.01,false,'Run'],[200,false,'Run'],[200,true,'Walk']]as const){
    const p={...player,z:-speed*.0254*dt,sourceWalking:walking},saved=structuredClone(p);
    expect(driver.advance(p,player,dt).state).toBe(state);expect(p).toEqual(saved);
  }
  expect(driver.advance({...player,crouch:true,z:-.01},player,dt).state).toBe('Crouch_Walk');
  expect(driver.advance({...player,crouch:true},player,dt).state).toBe('Crouch_Idle');
  const running={...player,sourcePose:driver.advance({...player,z:-.1},player,dt)};
  expect(driver.advance({...running,grounded:false,z:-1},running,dt).state).toBe('Run');
});
it('retains original AWP world magazine event boundaries through JSON and cancels them on a new action',()=>{
  const {at}=fixture('ct');
  expect(at(10.69).pose.magazineVisible).toBe(true);expect(at(10.71).pose.magazineVisible).toBe(false);expect(at(11.12).pose.magazineVisible).toBe(false);expect(at(11.14).pose.magazineVisible).toBe(true);
  for(const cycle of [Math.fround(21/110),Math.fround(34/110)]){
    const time=10+cycle*110/30,a=JSON.parse(JSON.stringify(at(time-.05).pose)),b=JSON.parse(JSON.stringify(at(time+.05).pose));
    for(const t of [.1,.9]){const p=interpolateSourceAWPPose(a,b,t,.1),expected=at(p.clock!.time).pose;expect(p.magazineVisible).toBe(expected.magazineVisible);expect(p.world).toEqual(expected.world);}
  }
  const a=at(10.8).pose,b=at(11,183,'Idle',2,10.95).pose;
  expect(interpolateSourceAWPPose(a,b,.5,.2).magazineVisible).toBe(false);
  const drawn=interpolateSourceAWPPose(a,b,.9,.2);expect(drawn.magazineVisible).toBe(true);expect(drawn.world.layers).toEqual([]);expect(drawn.clock!.generation).toBe(2);
  drawn.body.parameters.body_yaw=22;expect(b.body.parameters.body_yaw).toBe(0);
});
it('rejects a mismatched AWP team, weapon, version, or absent command owner',()=>{
  const {driver,at}=fixture('t'),p=at(10).player;
  expect(()=>driver.awpPose({...p,weapon:'glock'},10)).toThrow(/identity/);
  expect(()=>driver.awpPose({...p,team:'blue'},10)).toThrow(/identity/);
  expect(()=>driver.awpPose({...p,sourcePoseVersion:'old'},10)).toThrow(/shared body/);
  expect(()=>driver.awpPose({...p,sourceAWP:undefined},10)).toThrow(/command/);
  expect(()=>driver.awpPose(p,NaN)).toThrow(/shared body/);
});
