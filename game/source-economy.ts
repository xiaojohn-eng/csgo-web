import type {Player,Team,Utility,WeaponId} from './types.js';

export const SOURCE_ECONOMY_VERSION='csgo-competitive-inventory-12426148-v1';

/** Original items_game.txt prices and competitive.cfg carrying limits.
 * HE: explosive_grenade.attributes, line22455; smoke: line27482;
 * flash: line27299; defuser: lines29275-29281. Competitive config lines97-98
 * allow two flashes and four total; ordinary grenade ammunition carries one.
 */
export const SOURCE_UTILITY_SHOP=Object.freeze([
  {id:'he',cost:300,field:'grenades',limit:1},
  {id:'smoke',cost:300,field:'smokes',limit:1},
  {id:'flash',cost:200,field:'flashes',limit:2},
] as const);
export const SOURCE_UTILITY_TOTAL_LIMIT=4;
export const SOURCE_DEFUSE_KIT_COST=400;
export type SourceShopId='vandal'|'m4a4'|'glock'|'usp'|'deagle'|'awp'|'armor'|'helmet'|Utility|'defuseKit';

/** C4 timings from the Linux x64 build 12426148: CC4 plants at curtime+3.0;
 * CPlantedC4 defuses in 5 seconds with a kit or 10 without; the mp_c4timer
 * registration defaults to 40 and competitive cfg does not override it. */
export const SOURCE_OBJECTIVE_TIMERS=Object.freeze({plant:3,defuse:10,defuseKit:5,fuse:40});

/** Competitive purchase teams from each weapon prefab's used_by_classes.
 * This does not restrict carrying an enemy weapon. Training callers explicitly
 * bypass the team predicate so either player can practice all supported guns. */
export function sourceWeaponTeamAllows(team:Team,weapon:WeaponId):boolean{
  if(weapon==='vandal'||weapon==='glock')return team==='amber';
  if(weapon==='m4a4'||weapon==='usp')return team==='blue';
  return weapon==='deagle'||weapon==='awp';
}
export function sourceUtilityPurchaseAllowed(p:Pick<Player,'alive'|'money'|'grenades'|'smokes'|'flashes'>,kind:Utility):boolean{
  const item=SOURCE_UTILITY_SHOP.find(row=>row.id===kind);
  return !!item&&p.alive&&p.money>=item.cost&&p[item.field]<item.limit
    &&p.grenades+p.smokes+p.flashes<SOURCE_UTILITY_TOTAL_LIMIT;
}
