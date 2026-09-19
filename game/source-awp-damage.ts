export const SOURCE_AWP_DAMAGE_VERSION='app740-12426148-awp-normal-damage-v1';
export const SOURCE_AWP_BULLET_PROFILE=Object.freeze({damage:115,headMultiplier:4,armorRatio:1.95,rangeSourceUnits:8192,rangeModifier:.99});

export type SourceAWPDamageInput={
  weapon:'awp';
  /** Original raw hitgroup, not a reconstructed head/body boolean. */
  hitgroup:number;
  distanceMetres:number;
  armor:number;
  helmet:boolean;
  heavyArmor?:boolean;
};
export type SourceAWPDamageResult={
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
export function computeSourceAWPBulletDamage(input:SourceAWPDamageInput):SourceAWPDamageResult{
  const {weapon,hitgroup,distanceMetres,armor,helmet,heavyArmor}=input;
  const profile=SOURCE_AWP_BULLET_PROFILE;
  if(weapon!=='awp'||!Number.isFinite(distanceMetres)||distanceMetres<0||!Number.isInteger(hitgroup)||hitgroup<0||hitgroup>8||
      !Number.isInteger(armor)||armor<0||armor>100||typeof helmet!=='boolean')throw Error('Invalid original Source bullet damage input');
  if(heavyArmor)throw Error('Original heavy-armor damage is not implemented');
  const empty:SourceAWPDamageResult={withinRange:false,healthDamage:0,healthDamageFloat:0,distanceDamage:0,hitgroupDamage:0,
    armored:false,armorAfter:armor,armorDamage:0,reportedArmorDamage:0};
  // The original weapon range limits the trace itself. Keep this additional
  // boundary so a caller cannot accidentally damage an out-of-range actor.
  if(distanceMetres>profile.rangeSourceUnits*units)return empty;
  const exponent=f(f(distanceMetres/units)*distanceFactor);
  const distanceDamage=f(profile.damage*Math.pow(f(profile.rangeModifier),exponent));
  const multiplier=hitgroup===1?profile.headMultiplier:hitgroup===3?1.25:hitgroup===6||hitgroup===7?.75:1;
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
