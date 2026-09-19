import fs from 'node:fs';
import {expect,it} from 'vitest';
import {computeSourceBulletDamage,SOURCE_BULLET_PROFILES,type SourceBulletWeapon} from '../game/source-damage';

const available=fs.existsSync('output/tests/source-damage-native.json');
const original=available?it:it.skip;
original('matches all 1260 independently executed original App740 damage cases, including armor depletion and integer boundaries',()=>{
  const oracle=JSON.parse(fs.readFileSync('output/tests/source-damage-native.json','utf8'));
  expect(oracle.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');
  expect(oracle.status).toBe('original_normal_damage_blocks_executed');
  expect(oracle.rows).toHaveLength(1260);
  let maxFloatError=0;
  for(const row of oracle.rows){
    const result=computeSourceBulletDamage({weapon:row.weapon,hitgroup:row.hitgroup,distanceMetres:row.distanceSource*.0254,armor:row.armor,helmet:row.helmet});
    const expected=row.original;
    expect(result.withinRange).toBe(true);
    expect(result.armored).toBe(expected.armored);
    expect(result.healthDamage).toBe(expected.healthDamageInteger);
    expect(result.armorAfter).toBe(expected.armorAfter);
    expect(result.reportedArmorDamage).toBe(expected.reportedArmorDamage);
    expect(result.armorDamage).toBe(row.armor-expected.armorAfter);
    maxFloatError=Math.max(maxFloatError,Math.abs(result.distanceDamage-row.attenuated),Math.abs(result.hitgroupDamage-row.grouped),
      Math.abs(result.healthDamageFloat-expected.damage));
  }
  expect(maxFloatError).toBe(0);
  fs.writeFileSync('output/tests/source-damage-verification.json',JSON.stringify({cases:oracle.rows.length,maxFloatError,
    integerHealthAndArmorMismatches:0,sourceServerSha256:oracle.sourceServerSha256},null,2)+'\n');
});
it('retains head-without-helmet and unarmored legs, consumes low armor before applying health damage',()=>{
  const base={weapon:'ak47' as const,hitgroup:1,distanceMetres:0,armor:100,helmet:false};
  expect(computeSourceBulletDamage(base)).toMatchObject({healthDamage:144,armorAfter:100,armored:false});
  expect(computeSourceBulletDamage({...base,helmet:true})).toMatchObject({healthDamage:111,armorAfter:83,armorDamage:17,reportedArmorDamage:16});
  expect(computeSourceBulletDamage({...base,helmet:true,armor:5})).toMatchObject({healthDamage:134,armorAfter:0,armorDamage:5});
  expect(computeSourceBulletDamage({...base,hitgroup:6,helmet:true})).toMatchObject({healthDamage:27,armorAfter:100,armored:false});
});
it('uses the original rifle range as an upper bound and rejects unsupported heavy armor or invalid inputs',()=>{
  const base={weapon:'m4a4' as const,hitgroup:2,distanceMetres:0,armor:100,helmet:true};
  expect(computeSourceBulletDamage(base).healthDamage).toBe(23);
  const range=SOURCE_BULLET_PROFILES.m4a4.rangeSourceUnits*.0254;
  expect(computeSourceBulletDamage({...base,distanceMetres:range}).withinRange).toBe(true);
  expect(computeSourceBulletDamage({...base,distanceMetres:range+.0254})).toMatchObject({withinRange:false,healthDamage:0,armorAfter:100});
  for(const change of [{distanceMetres:NaN},{distanceMetres:-1},{hitgroup:9},{hitgroup:1.5},{armor:101},{armor:-1},
    {armor:1.5},{heavyArmor:true},{weapon:'scar' as SourceBulletWeapon},{weapon:'constructor' as SourceBulletWeapon}])expect(()=>computeSourceBulletDamage({...base,...change})).toThrow();
});
