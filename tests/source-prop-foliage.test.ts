import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {sourcePropBranch} from '../game/source-prop-lighting';
const runtime=JSON.parse(readFileSync('.reference-assets/source-exports/dust2-vhv/remap/runtime.json','utf8'));
const palm=runtime.materials.find((m:{source:string})=>m.source.endsWith('/palm_frond_01'));
const sumac=runtime.materials.find((m:{source:string})=>m.source.endsWith('/sumac_01'));
const foliageBranch=sourcePropBranch as (...args:unknown[])=>string[];
it('requires a separate opt-in and accepts only the exact original palm/sumac treesway contract',()=>{
  expect(foliageBranch(palm,true,true,true,true)).not.toHaveLength(0);
  expect(foliageBranch(palm,true,true,true,true,true)).toEqual([]);
  expect(foliageBranch(sumac,true,true,true,true,true)).toEqual([]);
  for(const change of [{$treesway:'2'},{$treeswayheight:'99'},{$vertexcolorpower:'.7'},{$treeswaystatic:'1'}]){
    expect(foliageBranch({...palm,parameters:{...palm.parameters,...change}},true,true,true,true,true)).not.toHaveLength(0);
  }
  expect(foliageBranch({...palm,source:palm.source.replace('palm_frond_01','olive_branch_01')},true,true,true,true,true)).not.toHaveLength(0);
});
