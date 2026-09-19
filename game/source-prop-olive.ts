import * as T from 'three';
import type {SourcePropMaterialSource} from './source-prop-lighting';
import {SOURCE_OLIVE_TREESWAY_GLSL} from './source-olive-treesway-glsl';
export type SourceTreeState={timeSeconds:number;windSourceXY:readonly number[]};
export type SourceTreeBinding={sourceModelRows:readonly (readonly number[])[]};
const prefix='models/props/de_dust/hr_dust/foliage/';
const parameters:Record<string,number>={$alphatest:1,$alphatestreference:.3,$nocull:1,$model:1,
  $treesway:1,$treeswayheight:10,$treeswaystartheight:.5,$treeswayradius:100,$treeswaystartradius:0,
  $treeswayspeed:.2,$treeswaystrength:.15,$treeswayscrumblespeed:1.2,$treeswayscrumblestrength:.15,
  $treeswayscrumblefrequency:2,$treeswayfalloffexp:2,$treeswayscrumblefalloffexp:3,
  $treeswayspeedhighwindmultiplier:0,$treeswayspeedlerpstart:200,$treeswayspeedlerpend:800,$vertexcolorpower:.7};
/** Exact original olive parameters. Only the explicit no-CSM candidate may
 * use this: selected PS0 does not consume vertexcolorpower; CSM is separate. */
export function sourcePropOliveCandidate(source:SourcePropMaterialSource){
  if(!['olive_branch_01'].some(name=>source.source===prefix+name)||source.shader.toLowerCase()!=='vertexlitgeneric')return false;
  const p=source.parameters,base=String(p.$basetexture??'').replaceAll('\\','/').toLowerCase();
  return base===source.source&&p.$surfaceprop==='wood'&&Object.keys(p).length===Object.keys(parameters).length+2&&
    Object.entries(parameters).every(([key,value])=>p[key]!==undefined&&Number(p[key])===value);
}
export function validateSourceTreeState(state:SourceTreeState){
  if(!Number.isFinite(state.timeSeconds)||Math.abs(state.timeSeconds)>1e7||state.windSourceXY.length!==2||
    !state.windSourceXY.every(v=>Number.isFinite(v)&&Math.abs(v)<=10000))throw Error('Invalid explicit Source tree time/wind state');
}
export function validateSourceTreeBinding(binding:SourceTreeBinding|undefined,material:T.Material){
  if(!binding||binding.sourceModelRows.length!==3||binding.sourceModelRows.some(row=>row.length!==4||!row.every(Number.isFinite)))throw Error('Original foliage model rows missing');
  if(material.side!==T.DoubleSide||material.alphaTest!==.3||material.transparent||material.opacity!==1)throw Error('Original foliage alpha/culling contract differs');
}
/** Only shader displacement changes. Borrowed geometry, source base/alpha,
 * original normal, UVs and node TRS are retained. c12 is from the installed
 * original command writer, not the different public SDK register assignment. */
export function attachSourcePropOlive(material:T.Material,binding:SourceTreeBinding,timeWind:T.Vector4){
  const before=material.onBeforeCompile,key=material.customProgramCacheKey();
  const rows=binding.sourceModelRows.map(row=>new T.Vector4(...row as [number,number,number,number]));
  material.onBeforeCompile=(shader,renderer)=>{
    before.call(material,shader,renderer);
    const common='#include <common>',begin='#include <begin_vertex>';
    if(!shader.vertexShader.includes(common)||!shader.vertexShader.includes(begin))throw Error('Three foliage vertex contract changed');
    Object.assign(shader.uniforms,{sourceOliveRoundMask:{value:0},sourceTreeTimeWind:{value:timeWind},sourceTreeRow0:{value:rows[0]},sourceTreeRow1:{value:rows[1]},sourceTreeRow2:{value:rows[2]}});
    shader.vertexShader=shader.vertexShader.replace(common,common+'\nuniform vec4 sourceTreeTimeWind,sourceTreeRow0,sourceTreeRow1,sourceTreeRow2;\n'+SOURCE_OLIVE_TREESWAY_GLSL)
      .replace(begin,begin+`\nvec3 sourceTreeRest=vec3(position.x,-position.z,position.y);
        vec3 sourceTreeDelta=sourceOlivePosition(sourceTreeRest,sourceTreeTimeWind,sourceTreeRow0,sourceTreeRow1,sourceTreeRow2)-sourceTreeRest;
        transformed+=vec3(sourceTreeDelta.x,sourceTreeDelta.z,-sourceTreeDelta.y);\n`);
  };
  material.customProgramCacheKey=()=>key+'|source-olive-vs128-register-round-r2';
}
