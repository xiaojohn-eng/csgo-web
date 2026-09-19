/** Ordinary original App740 bullet damage; see docs/source-damage.md.
 * These values are resolved from items_game.txt's actual prefab inheritance.
 * weapon_m4a1 is the original M4A4 item, not the silenced M4A1-S. */
export const SOURCE_DAMAGE_VERSION='csgo-normal-bullet-damage-12426148-r1' as const;
export const SOURCE_PISTOL_DAMAGE_VERSION='csgo-normal-pistol-damage-12426148-r1' as const;
export const SOURCE_BULLET_PROFILES=Object.freeze({
  ak47:Object.freeze({damage:36,headMultiplier:4,armorRatio:1.55,rangeSourceUnits:8192,rangeModifier:.98}),
  m4a4:Object.freeze({damage:33,headMultiplier:4,armorRatio:1.4,rangeSourceUnits:8192,rangeModifier:.97}),
  glock18:Object.freeze({damage:30,headMultiplier:4,armorRatio:.94,rangeSourceUnits:4096,rangeModifier:.85}),
  deagle:Object.freeze({damage:53,headMultiplier:3.9,armorRatio:1.864,rangeSourceUnits:4096,rangeModifier:.85}),
  'usp-s':Object.freeze({damage:35,headMultiplier:4,armorRatio:1.01,rangeSourceUnits:4096,rangeModifier:.91}),
});
export type SourceBulletWeapon=keyof typeof SOURCE_BULLET_PROFILES;
export type SourceBulletDamageInput={
  weapon:SourceBulletWeapon;
  /** Original raw hitgroup, not a reconstructed head/body boolean. */
  hitgroup:number;
  distanceMetres:number;
  armor:number;
  helmet:boolean;
  heavyArmor?:boolean;
};
export type SourceBulletDamageResult={
  withinRange:boolean;
  /** Integer delivered to the normal entity damage path, before health clamp. */
  healthDamage:number;
  healthDamageFloat:number;
  distanceDamage:number;
  hitgroupDamage:number;
  armored:boolean;
  armorAfter:number;
  /** Actual integer armor removed; may differ from the original stat counter. */
  armorDamage:number;
  reportedArmorDamage:number;
};
const f=Math.fround,units=.0254,distanceFactor=f(.002);

/** One already-authoritative original hit, no wall penetration or friendly fire.
 * Float32 operation order is preserved from original SSE, including independent
 * integer truncation of armor remaining and the reported armor-damage counter.
 * Heavy armor is rejected because its separate mode branches are not covered.
 * The caller still owns ray range, map occlusion, health/death and events. */
export function computeSourceBulletDamage(input:SourceBulletDamageInput):SourceBulletDamageResult{
  const {weapon,hitgroup,distanceMetres,armor,helmet,heavyArmor}=input;
  const profile=SOURCE_BULLET_PROFILES[weapon];
  if(!Object.hasOwn(SOURCE_BULLET_PROFILES,weapon)||!Number.isFinite(distanceMetres)||distanceMetres<0||!Number.isInteger(hitgroup)||hitgroup<0||hitgroup>8||
      !Number.isInteger(armor)||armor<0||armor>100||typeof helmet!=='boolean')throw Error('Invalid original Source bullet damage input');
  if(heavyArmor)throw Error('Original heavy-armor damage is not implemented');
  const empty:SourceBulletDamageResult={withinRange:false,healthDamage:0,healthDamageFloat:0,distanceDamage:0,hitgroupDamage:0,
    armored:false,armorAfter:armor,armorDamage:0,reportedArmorDamage:0};
  // The original weapon range limits the trace itself. Keep this additional
  // boundary so a caller cannot accidentally damage an out-of-range actor.
  if(distanceMetres>profile.rangeSourceUnits*units)return empty;
  const exponent=f(f(distanceMetres/units)*distanceFactor);
  const distanceDamage=f(profile.damage*Math.pow(f(profile.rangeModifier),exponent));
  const multiplier=hitgroup===1?f(profile.headMultiplier):hitgroup===3?1.25:hitgroup===6||hitgroup===7?.75:1;
  const hitgroupDamage=f(distanceDamage*multiplier);
  const armored=armor>0&&(hitgroup===1?helmet:((1<<hitgroup)&0x13d)!==0);
  let healthDamageFloat=hitgroupDamage,armorAfter=armor,reportedArmorDamage=0;
  if(armored){
    const ratio=f(f(profile.armorRatio)*.5);
    healthDamageFloat=f(hitgroupDamage*ratio);
    const cost=f(.5*f(hitgroupDamage-healthDamageFloat));
    if(cost>armor){
      healthDamageFloat=f(hitgroupDamage-f(armor/.5));
      armorAfter=0;reportedArmorDamage=armor;
    }else{
      armorAfter=Math.trunc(f(armor-cost));
      reportedArmorDamage=Math.trunc(cost);
    }
  }
  return {withinRange:true,healthDamage:Math.trunc(healthDamageFloat),healthDamageFloat,distanceDamage,hitgroupDamage,
    armored,armorAfter,armorDamage:armor-armorAfter,reportedArmorDamage};
}
