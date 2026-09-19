import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {sourcePistolParticleSystemForShot} from '../game/source-pistol-fx';
import {createSourceUSPCommandState,sourceUSPAnimationEvent} from '../game/source-usp-command';

it('matches all eight executed original particle getters and the real USP attached command mode',()=>{
 const raw=readFileSync('.reference-assets/source-exports/pistol-particles-r2/native-selection.json');
 expect(createHash('sha256').update(raw).digest('hex')).toBe('7cad90e44c30f7666172465bea854ea25b425d165ec0020ba933f12e9fd4efd7');
 const native=JSON.parse(raw.toString());expect(native.status).toBe('original-getters-executed');expect(native.cases).toHaveLength(8);
 for(const c of native.cases){
  const weapon=c.weapon==='usp_silencer'?'usp':c.weapon;
  const attached=createSourceUSPCommandState();
  const command=c.silencerAttached?attached:sourceUSPAnimationEvent(attached,46);
  expect(command.silencerAttached).toBe(c.silencerAttached);
  expect(sourcePistolParticleSystemForShot(weapon,command.mode)).toBe(c.system||null);
 }
 expect(sourcePistolParticleSystemForShot('m4a4',0)).toBeNull();
 expect(()=>sourcePistolParticleSystemForShot('usp',2)).toThrow('accepted mode');
});
