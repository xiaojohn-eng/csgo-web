/** Original 55e370 worldlight selection: ordinary light clusters use the
 * querying leaf's PVS, while sky light type 3 uses dleaf_t flags & 5. */
export type SourceLightingVisibilityData={format:'source-lighting-visibility-v1';sourceBspSha256:string;clusterCount:number;
 leafClusters:number[];leafFlags:number[];pvsRows:(string|null)[]};
export function prepareSourceLightingVisibility(data:SourceLightingVisibilityData){
 const count=data.clusterCount,rowBytes=Math.ceil(count/8);
 if(data.format!=='source-lighting-visibility-v1'||!Number.isInteger(count)||count<1||data.pvsRows.length!==count||data.leafFlags.length!==data.leafClusters.length)throw Error('Original lighting PVS identity differs');
 if(data.leafClusters.some(c=>!Number.isInteger(c)||c< -1||c>=count)||data.leafFlags.some(f=>!Number.isInteger(f)||f<0||f>127))throw Error('Original lighting leaf flags/clusters differ');
 const rows=data.pvsRows.map(row=>{if(row===null)return null;const bytes=atob(row);if(bytes.length!==rowBytes)throw Error('Original lighting PVS row differs');return Uint8Array.from(bytes,c=>c.charCodeAt(0));});
 return {data,visibleWorldlight(leaf:number,light:{cluster:number;type:number}):boolean{
  if(!Number.isInteger(leaf)||leaf<0||leaf>=data.leafClusters.length)throw Error('Original lighting leaf is unavailable');
  if(light.type===3)return !!(data.leafFlags[leaf]&5);
  if(!Number.isInteger(light.cluster)||light.cluster<0||light.cluster>=count)return false;
  const cluster=data.leafClusters[leaf],row=cluster<0?null:rows[cluster];
  return row===null||!!(row[light.cluster>>3]&(1<<(light.cluster&7)));
 }};
}
