import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {sourceAccuracyTick,sourceInaccuracy,sourceRecoveryTime,sourceAccuracyDeploy} from '../game/source-accuracy.js';
import {sourcePunchTick,sourcePunchImpulse} from '../game/source-punch.js';
import {createSourceRifleHandlingState,sourceRifleHandlingTick,sourceRifleHandlingShot,sourceRifleHandlingSwitch,sourceRifleHandlingAfterAcceptedShot} from '../game/source-rifle-handling.js';
const available=existsSync('output/tests/source-accuracy-native.json'),original=available?it:it.skip;
const report=available?JSON.parse(readFileSync('output/tests/source-accuracy-native.json','utf8')):null;
describe('App740 original accuracy and punch instructions',()=>{
  original('matches complete original tick/getter/recovery functions across movement and clocks',()=>{
    expect(report.status).toBe('original_accuracy_punch_functions_executed');expect(report.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(report.rows).toHaveLength(1320);
    let errors=0,maxError=0;
    for(const r of report.rows){
      const state=sourceAccuracyTick(r.weapon,r.before,r.context,r.time,r.dt);
      const punch=sourcePunchTick(r.before,r.dt);
      const result={state:{...r.before,...state,...punch},inaccuracy:sourceInaccuracy(r.weapon,state,r.context),recoveryTime:sourceRecoveryTime(r.weapon,r.before,r.context)};
      function check(a:unknown,b:unknown){if(typeof a==='number'&&typeof b==='number'){const d=Math.abs(a-b);if(d!==0)errors++;maxError=Math.max(maxError,d);}else if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const k of Object.keys(b))check((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]);}else expect(a).toEqual(b);}
      check(result,r.original);
    }
    writeFileSync('output/tests/source-accuracy-verification.json',JSON.stringify({ticks:report.rows.length,errors,maxError},null,2)+'\n');
    expect({errors,maxError}).toEqual({errors:0,maxError:0});
  });
  original('preserves holstered penalty recovery and player punch on deployment',()=>{
    expect(report.deploy).toHaveLength(20);
    for(const r of report.deploy)expect({...r.before,...sourceAccuracyDeploy(r.weapon,r.before,r.context,r.time)}).toEqual(r.original);
  });
  original('matches original angle-to-velocity and separate view-punch impulse',()=>{
    expect(report.impulses).toHaveLength(30);
    for(const r of report.impulses)expect({...r.before,...sourcePunchImpulse(r.before,{angle:r.angle,magnitude:r.magnitude})}).toEqual(r.original);
  });
  original('matches 1280 original continuous movement/shoot/recovery/switch ticks and replays a serialized snapshot',()=>{
    expect(report.sequences).toHaveLength(2);
    const cases=[];
    for(const sequence of report.sequences){
      let state=createSourceRifleHandlingState(sequence.initialWeapon);
      for(const weapon of ['ak47','m4a4']as const)state.weapons[weapon]={penalty:0,recoilIndex:0,lastShotTime:-1,lastUpdateTime:0};
      let replay=structuredClone(state),shots=0;
      const labels=new Set<string>();
      for(const r of sequence.frames){
        const advance=(input:typeof state)=>{
          if(r.switch)input=sourceRifleHandlingSwitch(input,r.switch,r.context,r.time);
          input=sourceRifleHandlingTick(input,r.context,r.time,r.dt);
          if(r.shot){
            const result=sourceRifleHandlingShot(input,r.context,r.time,(r.tick*1937311)|0);
            expect(result.shot.inaccuracy).toEqual(r.shot.inaccuracy);expect(result.shot.recoilIndex).toEqual(r.shot.recoilIndex);
            expect(result.shot.punchAngles).toEqual(r.shot.angle.map((v:number)=>Math.fround(v*2)));
            input=result.state;
          }
          return input;
        };
        state=advance(state);replay=advance(replay);
        expect({weapons:state.weapons,punch:state.punch},`tick ${r.tick} ${r.label}`).toEqual(r.original);
        expect(replay).toEqual(state);
        if(r.tick===350)replay=JSON.parse(JSON.stringify(state));
        labels.add(r.label);if(r.shot)shots++;
      }
      expect(sequence.frames).toHaveLength(640);expect(shots).toBe(30);
      expect([...labels]).toEqual(['idle','walking','running','crouch','crouch-move','jump','stop-recovery','ladder','reload','switch']);
      cases.push({initialWeapon:sequence.initialWeapon,ticks:sequence.frames.length,shots,labels:[...labels],final:state});
    }
    writeFileSync('output/tests/source-handling-sequences.json',JSON.stringify({status:'native_sequence_and_snapshot_replay_match',cases},null,2)+'\n');
  });
  it('rejects stale versions, unsupported weapons, nonfinite inputs and forged seed domains without mutation',()=>{
    const s=createSourceRifleHandlingState('ak47'),frozen=structuredClone(s),c={grounded:true};
    expect(()=>sourceRifleHandlingTick({...s,version:'old'}as never,c,1,1/60)).toThrow();
    expect(()=>sourceRifleHandlingSwitch(s,'pistol'as never,c,1)).toThrow();
    expect(()=>sourceRifleHandlingShot(s,c,1,NaN)).toThrow();
    expect(()=>sourceRifleHandlingShot(s,c,1,4294967295)).toThrow();
    expect(()=>sourceRifleHandlingTick(s,c,1,-.1)).toThrow();
    expect(()=>sourceInaccuracy('ak47',s.weapons.ak47,{grounded:false,exoJump:true}as never)).toThrow();
    expect(s).toEqual(frozen);
  });
  it('predicts accepted-shot state without a seed or fabricated ballistic result',()=>{
    for(const weapon of ['ak47','m4a4']as const){
      let s=createSourceRifleHandlingState(weapon);
      for(let i=0;i<20;i++){
        const before=structuredClone(s),predicted=sourceRifleHandlingAfterAcceptedShot(s,i*.1);
        for(const seed of [-2147483648,0,1,2147483647])expect(sourceRifleHandlingShot(s,{grounded:true},i*.1,seed).state).toEqual(predicted);
        expect(s).toEqual(before);expect(predicted).not.toHaveProperty('shot');expect(predicted).not.toHaveProperty('offset');s=predicted;
      }
    }
  });
});
