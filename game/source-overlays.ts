import * as T from 'three';
import {DUST2_BSP_SHA256} from './source-identity';

export type OverlayFile={file:string;bytes:number;sha256:string};
export type OverlayTexture=OverlayFile&{source:string;width:number;height:number;clampS:boolean;clampT:boolean};
export type OverlayMaterial={source:string;shader:'lightmappedgeneric';texture:string;vmtSha256:string;
  parameters:Record<string,string>;opacity:number;translucent:boolean;alphaTest:number};
export type OverlayManifest={format:'source-bsp-overlays-v1';sourceBspSha256:string;sourceWorldSha256:string;
  overlays:number;triangles:number;geometry:OverlayFile;materials:OverlayMaterial[];textures:OverlayTexture[]};
export type OverlayRow={id:number;material:string;renderOrder:number;faces:number[];faceIds:number[];triangles:number;
  positions:number[];normals:number[];uv:number[];lightmapUV:number[];fadeSquared:[number,number];origin:[number,number,number]};
export type OverlayGeometry={format:'source-bsp-overlays-geometry-v1';sourceBspSha256:string;sourceWorldSha256:string;
  metresPerSourceUnit:number;overlays:OverlayRow[]};
export const SOURCE_OVERLAY_WORLD_SHA='91b52e52b988e1b41b07b9cd365c159d615934fa49f07c3fa1e438d43269ffa8';

export function validateSourceOverlays(manifest:OverlayManifest,data:OverlayGeometry){
  if(manifest.format!=='source-bsp-overlays-v1'||data.format!=='source-bsp-overlays-geometry-v1'||
    [manifest,data].some(x=>x.sourceBspSha256!==DUST2_BSP_SHA256||x.sourceWorldSha256!==SOURCE_OVERLAY_WORLD_SHA)||
    data.metresPerSourceUnit!==.0254||manifest.overlays!==90||data.overlays.length!==90)
    throw Error('Original overlay BSP/world identity differs');
  const materials=new Map(manifest.materials.map(m=>[m.source,m])),ids=new Set<number>();let triangles=0;
  for(const row of data.overlays){
    const n=row.triangles*3;
    if(!Number.isSafeInteger(row.id)||row.id<0||row.id>=90||ids.has(row.id)||!Number.isSafeInteger(n)||n<3||
      !Number.isInteger(row.renderOrder)||row.renderOrder<0||row.renderOrder>3||!materials.has(row.material)||
      row.positions.length!==n*3||row.normals.length!==n*3||row.uv.length!==n*2||row.lightmapUV.length!==n*2||row.faceIds.length!==n||
      [row.positions,row.normals,row.uv,row.lightmapUV,row.fadeSquared,row.origin].some(a=>!a.every(Number.isFinite))||
      row.fadeSquared.length!==2||row.origin.length!==3)throw Error('Original overlay geometry is incomplete: '+row.id);
    const faces=new Set(row.faces);
    for(let i=0;i<n;i+=3){const f=row.faceIds[i];if(!Number.isSafeInteger(f)||!faces.has(f)||row.faceIds[i+1]!==f||row.faceIds[i+2]!==f)
      throw Error('Original overlay receiver attribution differs: '+row.id);}
    ids.add(row.id);triangles+=row.triangles;
  }
  if(triangles!==manifest.triangles)throw Error('Original overlay triangle coverage differs');
  for(const m of materials.values())if(m.shader!=='lightmappedgeneric'||!Number.isFinite(m.opacity)||m.opacity<0||m.opacity>1||
    !manifest.textures.some(t=>t.source===m.texture))throw Error('Original overlay material is unsupported or incomplete');
}

/** Geometry already lies on its named original receivers. Private index buffers
 * apply exactly their PVS mask; the sky subset remains in the separate sky pass.
 * Borrow textures/HDR materials; their owners must outlive this geometry owner. */
export function createSourceOverlays(manifest:OverlayManifest,data:OverlayGeometry,textures:ReadonlyMap<string,T.Texture>,
  createHDRMaterial:(original:T.MeshBasicMaterial)=>T.MeshBasicMaterial,skyFaceIds:readonly number[]=[]){
  validateSourceOverlays(manifest,data);
  const world=new T.Group(),sky=new T.Group();world.name='Source_BSP_Overlays';sky.name='Source_Sky_BSP_Overlays';
  const skyFaces=new Set(skyFaceIds),geometries:T.BufferGeometry[]=[],originals:T.MeshBasicMaterial[]=[];
  const bindings:{mesh:T.Mesh;row:OverlayRow;indices:Uint32Array;faces:Uint32Array;sky:boolean}[]=[];
  const materials=new Map<number,T.MeshBasicMaterial>(),rules=new Map(manifest.materials.map(r=>[r.source,r]));let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;world.removeFromParent();sky.removeFromParent();
    for(const g of geometries)g.dispose();for(const m of originals)m.dispose();world.clear();sky.clear();};
  try{
    for(const row of data.overlays){
      const rule=rules.get(row.material)!;
      const texture=textures.get(rule.texture);if(!texture)throw Error('Original overlay texture is missing: '+rule.texture);
      const original=new T.MeshBasicMaterial({map:texture,opacity:rule.opacity,transparent:rule.translucent,
        alphaTest:rule.alphaTest,depthWrite:false,side:T.FrontSide});original.name=rule.source;originals.push(original);
      const material=createHDRMaterial(original);material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;
      material.userData={...material.userData,sourceOverlay:rule.source,sourceVmtSha256:rule.vmtSha256};
      materials.set(row.id,material);
    }
    for(const row of data.overlays){
      for(const isSky of [false,true]){
        const selected:number[]=[],faces:number[]=[];
        for(let i=0;i<row.faceIds.length;i+=3)if(skyFaces.has(row.faceIds[i])===isSky){selected.push(i,i+1,i+2);faces.push(row.faceIds[i]);}
        if(!selected.length)continue;
        const g=new T.BufferGeometry();geometries.push(g);
        g.setAttribute('position',new T.Float32BufferAttribute(row.positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(row.normals,3));
        g.setAttribute('uv',new T.Float32BufferAttribute(row.uv,2));g.setAttribute('uv1',new T.Float32BufferAttribute(row.lightmapUV,2));
        const indices=new Uint32Array(selected);g.setIndex(new T.BufferAttribute(indices.slice(),1).setUsage(T.DynamicDrawUsage));
        g.computeBoundingBox();g.computeBoundingSphere();
        const mesh=new T.Mesh(g,materials.get(row.id)!);mesh.name='Source_BSP_Overlay_'+row.id;
        mesh.renderOrder=row.renderOrder;mesh.userData={sourceOverlayId:row.id,sourceReceiverFaces:row.faces,sourceSkyOverlay:isSky};
        (isSky?sky:world).add(mesh);bindings.push({mesh,row,indices,faces:new Uint32Array(faces),sky:isSky});
      }
    }
    return {world,sky,dispose,audit:{overlays:data.overlays.length,triangles:manifest.triangles,
      worldMeshes:world.children.length,skyMeshes:sky.children.length,materials:materials.size,textures:textures.size,
      sourceBspSha256:manifest.sourceBspSha256,sourceWorldSha256:manifest.sourceWorldSha256,
      limitations:['Receiver light uses original base HDR channel; normal-mapped overlay directional lighting remains separate.',
        'WebGL polygon offset uses (-1,-1); not a native Source depth-bias measurement.']},
      setVisibleFaces(mask:Uint8Array|null,firstFace:number){
        if(disposed)throw Error('Original overlay owner disposed');
        for(const b of bindings){if(b.sky)continue;const index=b.mesh.geometry.index!;let count=0;
          for(let i=0;i<b.faces.length;i++)if(mask===null||mask[b.faces[i]-firstFace]){
            for(let k=0;k<3;k++)index.setX(count++,b.indices[i*3+k]);}
          index.needsUpdate=true;b.mesh.geometry.setDrawRange(0,count);b.mesh.visible=count>0;
        }
      },
      update(camera:T.Vector3,skyCamera?:T.Vector3){
        if(disposed)throw Error('Original overlay owner disposed');
        // BSP stores squared fade distances. Each overlay has its own material
        // so one receiver cannot change another receiver's alpha.
        for(const b of bindings){const [start,end]=b.row.fadeSquared;if(start<0||end<0)continue;
          const [x,y,z]=b.row.origin,c=b.sky?(skyCamera??camera):camera;
          const distance=(c.x/.0254-x)**2+(-c.z/.0254-y)**2+(c.y/.0254-z)**2;
          const fade=T.MathUtils.clamp((end-distance)/(end-start),0,1);
          (b.mesh.material as T.MeshBasicMaterial).opacity=rules.get(b.row.material)!.opacity*fade;
          b.mesh.visible=b.mesh.geometry.drawRange.count>0&&fade>0;
        }
      },
    };
  }catch(error){dispose();throw error;}
}
