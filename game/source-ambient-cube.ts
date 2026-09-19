import * as T from 'three';

type AmbientState={enabled:T.IUniform<number>;cube:T.IUniform<T.Vector3[]>;rotation:T.IUniform<T.Matrix3>};
const states=new WeakMap<T.Material,AmbientState>();
/** Decorates the material's existing shader hook; original normal maps and direct
 * lighting remain owned by that hook. Ambient cube replaces the hemisphere fill,
 * rather than adding a second fill on top of it. */
export function attachSourceAmbientCube(material:T.Material) {
  if(states.has(material))return;
  const state:AmbientState={enabled:{value:0},cube:{value:Array.from({length:6},()=>new T.Vector3())},rotation:{value:new T.Matrix3()}};
  states.set(material,state);
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);
    Object.assign(shader.uniforms,{sourceAmbientEnabled:state.enabled,sourceAmbientCube:state.cube,sourceViewToAmbient:state.rotation});
    // A borrowed draw view can inherit an already decorated source material.
    if(shader.fragmentShader.includes('uniform vec3 sourceAmbientCube[6]'))return;
    const token='#include <lights_fragment_end>';
    if(!shader.fragmentShader.includes(token))throw Error('Source ambient cube requires the original Phong lighting hook');
    shader.fragmentShader=`#define SOURCE_AMBIENT_CUBE
uniform float sourceAmbientEnabled;
+uniform vec3 sourceAmbientCube[6];
+uniform mat3 sourceViewToAmbient;
+vec3 sourceAmbientRadiance(vec3 direction){
+  vec3 square=direction*direction;
+  return square.x*(direction.x>=0.0?sourceAmbientCube[0]:sourceAmbientCube[1])
+    +square.y*(direction.y>=0.0?sourceAmbientCube[2]:sourceAmbientCube[3])
+    +square.z*(direction.z>=0.0?sourceAmbientCube[4]:sourceAmbientCube[5]);
+}
+${shader.fragmentShader}`.replaceAll('\n+','\n');
    shader.fragmentShader=shader.fragmentShader.replace(token,`
+if(sourceAmbientEnabled>0.5){
+  // Source adds ambient radiance to albedo directly. Three's Lambert BRDF
+  // divides irradiance by PI, hence the corresponding conversion here.
+  irradiance=PI*sourceAmbientRadiance(normalize(sourceViewToAmbient*normal));
+  iblIrradiance=vec3(0.0);
+}
+${token}`.replaceAll('\n+','\n'));
  };
  material.customProgramCacheKey=()=>key()+'-original-ambient-cube-v2';
  material.userData.sourceAmbientCube={status:'waiting_for_original_leaf_sample',ambientRimImplemented:!!material.userData.sourceAmbientRim};
}

/** Pinned Source skin_ps20b.fxc:186,348-365. Called after the separate direct
 * rim/max fold. The decorator supplies the original cube and camera rotation;
 * an unbound material contributes no invented ambient rim. */
export function sourceAmbientRimFragment(mask:string,tint:string,boost:string){
  return `
#ifdef SOURCE_AMBIENT_CUBE
if(sourceAmbientEnabled>0.5){
  vec3 sourceRimNormal=normalize(sourceViewToAmbient*normal);
  vec3 sourceRimEye=normalize(sourceViewToAmbient*normalize(vViewPosition));
  reflectedLight.indirectSpecular+=sourceAmbientRadiance(sourceRimEye)*(${boost})
    *clamp((${mask})*sourceRimNormal.z,0.0,1.0)*(${tint});
}
#endif`;
}
export function setSourceAmbientCube(material:T.Material,faces:readonly (readonly number[])[]|null,viewToSource:T.Matrix3){
  const state=states.get(material);if(!state)return false;
  if(faces&&(faces.length!==6||faces.some(face=>face.length!==3||face.some(c=>!Number.isFinite(c)||c<0))))throw Error('Invalid original ambient cube');
  state.enabled.value=faces?1:0;state.rotation.value.copy(viewToSource);
  if(faces)faces.forEach((face,i)=>state.cube.value[i].set(face[0],face[1],face[2]));
  material.userData.sourceAmbientCube={...material.userData.sourceAmbientCube,status:faces?'original_leaf_samples_bound':'waiting_for_original_leaf_sample'};
  return true;
}
