import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {decodeSourceColorCorrection,sourceSunDirection} from '../game/source-sun';
import {SOURCE_DUST2_ENVIRONMENT as env} from '../game/source-environment';
it('retains every installed colour-correction entry in the independently established axis order',()=>{
  const bytes=new Uint8Array(readFileSync('public/source/csgo-12426148/sun/cc_dust2.raw'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(env.colorCorrection.lutSha256);
  const lut=decodeSourceColorCorrection(bytes),data=lut.image.data!;
  for(let r=0;r<32;r++)for(let g=0;g<32;g++)for(let b=0;b<32;b++){
    const from=((r*32+g)*32+b)*3,to=((b*32+g)*32+r)*4;
    expect(Array.from(data.slice(to,to+4))).toEqual([bytes[from+2],bytes[from+1],bytes[from],255]);
  }
  lut.dispose();
});
it('uses env_sun own yaw/pitch and a normalized upward direction',()=>{
  const direction=sourceSunDirection(env);expect(direction.length()).toBeCloseTo(1,12);
  expect(direction.y).toBeCloseTo(Math.sin(43*Math.PI/180),12);
  expect(Math.atan2(-direction.z,direction.x)*180/Math.PI).toBeCloseTo(47,9);
});
