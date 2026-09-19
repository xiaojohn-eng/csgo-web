/** Original App740 ordinary item50/item51 purchase terms; docs/source-damage.md.
 * Caller owns alive/buy-zone/buy-time/funds checks and atomic application.
 * This function does not spend money or mutate player state. */
export type SourceArmorPurchase={cost:number;armor:100;helmet:boolean};
export function sourceArmorPurchase(item:'armor'|'helmet',armor:number,helmet:boolean):SourceArmorPurchase|null{
  if((item!=='armor'&&item!=='helmet')||!Number.isInteger(armor)||armor<0||armor>100||typeof helmet!=='boolean')
    throw Error('Invalid ordinary Source armor purchase input');
  if(item==='armor')return armor===100?null:{cost:650,armor:100,helmet};
  if(helmet)return null;
  return {cost:armor===100?350:1000,armor:100,helmet:true};
}
