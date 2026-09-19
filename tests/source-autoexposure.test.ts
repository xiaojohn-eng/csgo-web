import {expect,it} from 'vitest';
import {SourceAutoExposure,sourceExposureTarget} from '../game/source-autoexposure';
import {SOURCE_DUST2_ENVIRONMENT} from '../game/source-environment';
const p=SOURCE_DUST2_ENVIRONMENT.tonemap;
const histogram=(bucket:number)=>Array.from({length:16},(_,i)=>i===bucket?100:0);
it('dark and overbright frames drive in opposite directions within the original map limits',()=>{
 expect(sourceExposureTarget(histogram(0),.98,p)).toBe(1.25);
 expect(sourceExposureTarget(histogram(15),.98,p)).toBeLessThan(.9);
 expect(sourceExposureTarget(histogram(15),.5,p)).toBe(.5);
 expect(sourceExposureTarget(Array(16).fill(0),.98,p)).toBe(.98);
});
it('holds exposure when the bright tail is already in the original target bin',()=>{
 expect(sourceExposureTarget(histogram(13),.98,p)).toBe(.98);
});
it('adapts continuously with frame rate independent timing and does not jump to the target',()=>{
 const a=new SourceAutoExposure(p,.8),b=new SourceAutoExposure(p,.8);
 a.target=b.target=1.25;
 a.advance(1/60);expect(a.exposure).toBeGreaterThan(.8);expect(a.exposure).toBeLessThan(.81);
 for(let i=1;i<60;i++)a.advance(1/60);
 for(let i=0;i<30;i++)b.advance(1/30);
 expect(a.exposure).toBeCloseTo(b.exposure,12);expect(a.exposure).toBeLessThan(1.25);
 a.dispose();b.dispose();
});
