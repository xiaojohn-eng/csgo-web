import fs from 'node:fs';
import {expect,it} from 'vitest';
import {computeSourceAWPBulletDamage} from '../game/source-awp-damage';

const nativePath='output/tests/source-awp-damage-native.json';
const original=fs.existsSync(nativePath)?it:it.skip;
original('matches the original AWP normal damage blocks across armor and range boundaries',()=>{
 const oracle=JSON.parse(fs.readFileSync(nativePath,'utf8'));
 expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
 expect(oracle.rows).toHaveLength(720);let maxFloatError=0;
 for(const row of oracle.rows){
  const got=computeSourceAWPBulletDamage({weapon:'awp',hitgroup:row.hitgroup,distanceMetres:row.distanceSource*.0254,armor:row.armor,helmet:row.helmet}),expected=row.original;
  expect(got.withinRange).toBe(true);expect(got.armored).toBe(expected.armored);
  expect(got.healthDamage).toBe(expected.healthDamageInteger);expect(got.armorAfter).toBe(expected.armorAfter);
  expect(got.reportedArmorDamage).toBe(expected.reportedArmorDamage);expect(got.armorDamage).toBe(row.armor-expected.armorAfter);
  maxFloatError=Math.max(maxFloatError,Math.abs(got.distanceDamage-row.attenuated),Math.abs(got.hitgroupDamage-row.grouped),Math.abs(got.healthDamageFloat-expected.damage));
 }
 expect(maxFloatError).toBe(0);
 fs.writeFileSync('output/tests/source-awp-damage-validation.json',JSON.stringify({status:'passed',cases:oracle.rows.length,maxFloatError,integerMismatches:0,sourceServerSha256:oracle.sourceServerSha256},null,2)+'\n');
});
it('does not extend AWP bullet damage beyond the original 8192 unit trace',()=>{
 for(const weapon of ['awp']as const){
  const args={weapon,hitgroup:1,distanceMetres:8192*.0254,armor:100,helmet:true};
  expect(computeSourceAWPBulletDamage(args).withinRange).toBe(true);
  expect(computeSourceAWPBulletDamage({...args,distanceMetres:8193*.0254})).toMatchObject({withinRange:false,healthDamage:0,armorAfter:100});
 }
});
