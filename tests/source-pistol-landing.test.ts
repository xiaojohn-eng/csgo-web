import {existsSync,readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {createSourcePistolHandlingState,sourcePistolHandlingOnLand,sourcePistolHandlingMovementTick,sourcePistolHandlingWeaponTick,type SourcePistolWeapon} from '../game/source-pistol-handling';
const path='output/tests/source-pistol-landing-native.json',native=existsSync(path)?it:it.skip;
function state(r:any){const s=createSourcePistolHandlingState(r.weapon,{glock18:r.weapon==='glock18'?r.mode:0,'usp-s':r.weapon==='usp-s'?r.mode:1});s.weapons[r.weapon as SourcePistolWeapon]={penalty:r.before.penalty,recoilIndex:r.before.recoilIndex,lastShotTime:r.before.lastShotTime,lastUpdateTime:r.before.lastUpdateTime};s.punch={angle:r.before.angle,velocity:r.before.velocity,viewPunch:r.before.viewPunch};return s;}
native('matches original current-pistol mode OnLand, shared command seed and punch/land/accuracy order',()=>{
 const d=JSON.parse(readFileSync(path,'utf8'));expect(d.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.rows).toHaveLength(72);expect(d.chains).toHaveLength(12);
 for(const r of d.rows){const s=sourcePistolHandlingOnLand(state(r),r.fallVelocitySource,r.commandSeed);expect({...s.weapons[s.activeWeapon],...s.punch}).toEqual(r.original.state);}
 for(const r of d.chains){let s=sourcePistolHandlingMovementTick(state(r),r.dt);s=sourcePistolHandlingOnLand(s,r.fallVelocitySource,r.commandSeed);s=sourcePistolHandlingWeaponTick(s,{grounded:true},r.time,r.dt);expect({...s.weapons[s.activeWeapon],...s.punch}).toEqual(r.original);}
});
