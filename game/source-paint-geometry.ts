import {SOURCE_PAINT_GEOMETRY} from './source-paint-geometry-data';
/** Original material-block generator f522ce/f52510. Projected finishes use
 * WeaponLength/36; atlas finishes use UVScale. Both have the original ignore flag. */
export function sourcePaintTextureScale(weapon:string|undefined,style:number,ignore:number){
  if(ignore!==0&&ignore!==1)throw Error('Original paint size flag must be zero or one');
  if(ignore===1)return 1;
  if(!weapon||!Object.prototype.hasOwnProperty.call(SOURCE_PAINT_GEOMETRY,weapon))
    throw Error('Original weapon paint geometry is unavailable: '+weapon);
  const geometry=SOURCE_PAINT_GEOMETRY[weapon as keyof typeof SOURCE_PAINT_GEOMETRY];
  return style===3||style===6?Math.fround(Math.fround(geometry.weaponLength)*Math.fround(1/36)):Math.fround(geometry.uvScale);
}
