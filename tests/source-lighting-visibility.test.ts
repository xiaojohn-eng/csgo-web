import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareSourceLightingVisibility,type SourceLightingVisibilityData} from '../game/source-lighting-trace-visibility';
const base:SourceLightingVisibilityData={format:'source-lighting-visibility-v1',sourceBspSha256:'test',clusterCount:3,leafClusters:[0,1,-1,2],leafFlags:[1,0,4,2],pvsRows:['Aw==','Ag==',null]};
describe('original lighting leaf/PVS selection',()=>{
 it('uses sky flags separately from ordinary light PVS and rejects negative light clusters',()=>{
  const owner=prepareSourceLightingVisibility(base);
  expect(owner.visibleWorldlight(0,{type:3,cluster:-1})).toBe(true);expect(owner.visibleWorldlight(1,{type:3,cluster:1})).toBe(false);
  expect(owner.visibleWorldlight(2,{type:3,cluster:-1})).toBe(true);expect(owner.visibleWorldlight(3,{type:3,cluster:2})).toBe(false);
  expect(owner.visibleWorldlight(0,{type:1,cluster:1})).toBe(true);expect(owner.visibleWorldlight(0,{type:1,cluster:2})).toBe(false);
  expect(owner.visibleWorldlight(1,{type:1,cluster:0})).toBe(false);expect(owner.visibleWorldlight(0,{type:1,cluster:-1})).toBe(false);
 });
 it('retains the original no-vis all-visible row for absent source clusters/PVS',()=>{
  const owner=prepareSourceLightingVisibility(base);
  for(const leaf of [2,3])for(const cluster of [0,1,2])expect(owner.visibleWorldlight(leaf,{type:1,cluster})).toBe(true);
  expect(()=>owner.visibleWorldlight(-1,{type:1,cluster:0})).toThrow('unavailable');
 });
 it('matches every original decoded PVS row, leaf cluster and sky flag',()=>{
  const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
  const data=read('public/source/csgo-12426148/fidelity-world-20260913/lighting-trace/visibility.json') as SourceLightingVisibilityData;
  const original=read('.reference-assets/source-exports/dust2/visibility/visibility.json'),sky=read('.reference-assets/source-exports/dust2/sky/sky.json');
  expect(data.clusterCount).toBe(1795);expect(data.pvsRows).toEqual(original.pvsRows);
  expect(data.leafClusters).toEqual(original.leaves.map((l:{cluster:number})=>l.cluster));expect(data.leafFlags).toEqual(sky.leafFlags);
  const owner=prepareSourceLightingVisibility(data);
  for(let leaf=0;leaf<data.leafClusters.length;leaf++)expect(owner.visibleWorldlight(leaf,{type:3,cluster:-1})).toBe(!!(sky.leafFlags[leaf]&5));
 });
});
