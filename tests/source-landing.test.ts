import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {sourceLandingSharedRandom,sourceRifleOnLand,sourceFallVelocityBeforeMove,sourceFallVelocityAfterMove} from '../game/source-landing.js';
import {createSourceRifleHandlingState,sourceRifleHandlingMovementTick,sourceRifleHandlingWeaponTick} from '../game/source-rifle-handling.js';
const available=existsSync('output/tests/source-landing-native.json'),original=available?it:it.skip;
const report=available?JSON.parse(readFileSync('output/tests/source-landing-native.json','utf8')):null;
describe('App740 rifle landing contract',()=>{
  original('matches original CRC32, RNG and complete weapon callback for both rifles',()=>{
    expect(report.status).toBe('original_onland_shared_crc_rng_executed');expect(report.rows).toHaveLength(300);
    let maxError=0,errors=0;
    for(const r of report.rows){
      const s=createSourceRifleHandlingState(r.weapon);s.weapons[r.weapon as 'ak47'|'m4a4']={penalty:r.before.penalty,recoilIndex:r.before.recoilIndex,lastShotTime:r.before.lastShotTime,lastUpdateTime:r.before.lastUpdateTime};
      s.punch={angle:r.before.angle,velocity:r.before.velocity,viewPunch:r.before.viewPunch};
      const frozen=structuredClone(s),land=sourceRifleOnLand(s,r.fallVelocitySource,r.commandSeed);
      expect(sourceLandingSharedRandom(r.commandSeed)).toEqual(r.original.shared);
      const merged={...land.weapons[r.weapon as 'ak47'|'m4a4'],...land.punch};
      for(const [k,v]of Object.entries(r.original.state)){
        const actual=merged[k as keyof typeof merged];
        if(typeof v==='number'&&typeof actual==='number'){const e=Math.abs(v-actual);if(e)errors++;maxError=Math.max(maxError,e);}
        else expect(actual).toEqual(v);
      }
      expect(s).toEqual(frozen);expect(land.weapons[r.weapon==='ak47'?'m4a4':'ak47']).toBe(s.weapons[r.weapon==='ak47'?'m4a4':'ak47']);
    }
    writeFileSync('output/tests/source-landing-verification.json',JSON.stringify({cases:report.rows.length,errors,maxError},null,2)+'\n');expect({errors,maxError}).toEqual({errors:0,maxError:0});
  });
  it('samples pre-movement Z velocity, keeps ascending sign, and emits one landing event',()=>{
    expect(sourceFallVelocityBeforeMove(0,false,301.993377)).toBe(Math.fround(-301.993377));
    const fall=sourceFallVelocityBeforeMove(-10,false,-300);
    expect(fall).toBe(300);expect(sourceFallVelocityAfterMove(fall,false)).toEqual({fallVelocitySource:300,landedFallVelocitySource:null});
    const first=sourceFallVelocityAfterMove(fall,true);expect(first).toEqual({fallVelocitySource:0,landedFallVelocitySource:300});
    const next=sourceFallVelocityBeforeMove(first.fallVelocitySource,true,0);
    expect(sourceFallVelocityAfterMove(next,true)).toEqual({fallVelocitySource:0,landedFallVelocitySource:null});
    // Ground categorization before displacement may establish contact, but
    // the pending fall sampled while airborne must survive and land once.
    expect(sourceFallVelocityAfterMove(sourceFallVelocityBeforeMove(300,true,0),true)).toEqual(first);
    expect(sourceFallVelocityAfterMove(-20,true)).toEqual({fallVelocitySource:-20,landedFallVelocitySource:null});
  });
  original('matches original pre-move fall sampling and one-shot CheckFalling dispatch/clear',()=>{
    expect(report.samples).toHaveLength(36);expect(report.transitions).toHaveLength(20);
    for(const r of report.samples)expect(sourceFallVelocityBeforeMove(r.previous,r.grounded,r.velocityZSource)).toBe(r.original);
    for(const r of report.transitions){
      const first=sourceFallVelocityAfterMove(r.fallVelocitySource,r.grounded),second=sourceFallVelocityAfterMove(first.fallVelocitySource,r.grounded);
      const toNative=(s:typeof first)=>({fallVelocitySource:s.fallVelocitySource,events:s.landedFallVelocitySource===null?[]:[s.landedFallVelocitySource]});
      expect({first:toNative(first),second:toNative(second)}).toEqual(r.original);
    }
  });
  original('matches original punch-decay then landing then weapon-update sequence',()=>{
    expect(report.sequences).toHaveLength(30);
    for(const r of report.sequences){
      const weapon=r.weapon as 'ak47'|'m4a4';let s=createSourceRifleHandlingState(weapon);
      s.weapons[weapon]={penalty:r.before.penalty,recoilIndex:r.before.recoilIndex,lastShotTime:r.before.lastShotTime,lastUpdateTime:r.before.lastUpdateTime};s.punch={angle:r.before.angle,velocity:r.before.velocity,viewPunch:r.before.viewPunch};
      s=sourceRifleHandlingMovementTick(s,r.dt);s=sourceRifleOnLand(s,r.fallVelocitySource,r.commandSeed);s=sourceRifleHandlingWeaponTick(s,{grounded:true},r.time,r.dt);
      expect({...s.weapons[weapon],...s.punch}).toEqual(r.original);
    }
  });
  it('rejects nonfinite or ambiguous seed domains without modifying state',()=>{
    const s=createSourceRifleHandlingState('ak47'),copy=structuredClone(s);
    for(const v of [NaN,Infinity,-1])expect(()=>sourceRifleOnLand(s,v,42)).toThrow();
    for(const seed of [-1,2147483648,2.5,NaN])expect(()=>sourceLandingSharedRandom(seed)).toThrow();
    expect(()=>sourceFallVelocityBeforeMove(0,false,NaN)).toThrow();expect(s).toEqual(copy);
  });
});
