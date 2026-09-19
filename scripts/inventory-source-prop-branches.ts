/** Scope accounting from original VMT receipts and actual instance multiplicity.
 * No shader enabling, material mutation, texture processing, or approximate IDs. */
import {readFileSync,writeFileSync} from 'node:fs';
import {sourcePropBranch} from '../game/source-prop-lighting';
import type {PropVhvDescriptor} from '../game/source-prop-lighting-loader';
import assert from 'node:assert/strict';
const source='.reference-assets/source-exports/dust2-vhv/remap/';
const descriptor:PropVhvDescriptor=JSON.parse(readFileSync(source+'runtime.json','utf8'));
const actual=JSON.parse(readFileSync(source+'three-verification.json','utf8'));
const variants=new Map<string,number>();for(const i of descriptor.instances){const key=i.model+'|'+i.skin;variants.set(key,(variants.get(key)??0)+1);}
const materials=descriptor.materials.map(material=>{
  const records=descriptor.records.filter(r=>r.materialSource===material.source),reasons=sourcePropBranch(material);
  const sum=(predicate:(r:PropVhvDescriptor['records'][number])=>boolean,triangles:boolean)=>records.reduce((n,r)=>n+(predicate(r)?(variants.get(r.model+'|'+r.skin)??0)*(triangles?r.indexCount/3:1):0),0);
  let group='supported_plain_bump';
  if(reasons.length){
    group=material.shader!=='vertexlitgeneric'?'unlit_shader':!material.parameters.$bumpmap?'non_bump':
      '$treesway' in material.parameters?'treesway':'$envmap' in material.parameters?'envmap':'$phong' in material.parameters?'phong':
      '$decaltexture' in material.parameters?'decal':'$detail' in material.parameters?'detail':'$tintmasktexture' in material.parameters?'tintmask':'other';
  }
  return {...material,group,reasons,meshInstances:sum(()=>true,false),triangles:sum(()=>true,true),
    eligibleMeshes:sum(r=>!reasons.length&&r.verified,false),eligibleTriangles:sum(r=>!reasons.length&&r.verified,true),
    ambiguousMeshes:sum(r=>!r.verified,false),ambiguousTriangles:sum(r=>!r.verified,true),modelVariants:[...new Set(records.map(r=>r.model+'|skin '+r.skin))]};
});
const groups:Record<string,{materials:number;meshes:number;triangles:number;eligibleMeshes:number;eligibleTriangles:number}>={};
for(const m of materials){const g=groups[m.group]??={materials:0,meshes:0,triangles:0,eligibleMeshes:0,eligibleTriangles:0};
  g.materials++;g.meshes+=m.meshInstances;g.triangles+=m.triangles;g.eligibleMeshes+=m.eligibleMeshes;g.eligibleTriangles+=m.eligibleTriangles;}
assert.equal(materials.reduce((n,m)=>n+m.meshInstances,0),actual.meshInstances);
assert.equal(materials.reduce((n,m)=>n+m.eligibleTriangles,0),actual.appliedTriangles);
const result={status:'original_material_branch_and_instance_counts_verified',sourceBspSha256:descriptor.sourceBspSha256,groups,
  coveredMeshes:actual.appliedMeshes,coveredTriangles:actual.appliedTriangles,remainingMeshes:actual.skippedMeshes,remainingTriangles:actual.skippedTriangles,
  grouping:'Disjoint first matching feature groups; full overlapping reasons remain on each original material.',
  boundary:'Counting only. No unsupported feature is automatically enabled; raw VMT parameters are preserved.',materials};
writeFileSync('research/source-prop-material-branches.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,materials:undefined},null,2));
