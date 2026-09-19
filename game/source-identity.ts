export const SOURCE_DUST2_ID='de_dust2-source-12426148' as const;
export const DUST2_BSP_SHA256='b91be410539fbbfc16300423f1e19c024f12addf1429c8cb2f72b53fe0fd6bcc';
export const LEGACY_MAP_ID='port-selene-m01' as const;

/** The original BSP identity cannot detect a corrected export of its physics.
 * Use the exact verified simulation bytes, in a fixed order, on both peers. */
export function sourceSimulationVersion(files:Record<string,{sha256:string}>):string{
  const hashes=['level','collision','navigation'].map(key=>{
    const hash=files[key]?.sha256;
    if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('Source simulation receipt missing or invalid: '+key);
    return hash;
  });
  return 'source-sim-v1:'+hashes.join(':');
}
