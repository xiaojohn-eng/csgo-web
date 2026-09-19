/** Original downward silhouette shadows, with map colour and reach.
 * The silhouette and receiver now share the same footprint; each receiver
 * follows original collision samples and fades below the caster bounds.
 * Source SDK supplies the bounding-sphere falloff convention. Native BSP
 * receiver clipping and installed per-entity fade constants remain distinct.
 */
import * as T from 'three';
import type {SourceEnvironment} from './source-environment.js';

/** One actor that casts, with the point its shadow hangs from and how wide it is. */
export type SourceProjectedShadowCaster = {
  id: string;
  /** The model itself: it is rendered into the silhouette the shadow is made of. */
  object: T.Object3D;
  /** Where the shadow hangs from: the actor's own origin, which is at its feet. */
  origin: T.Vector3;
  /** Half the actor's footprint, in metres, which is how wide its silhouette is sampled. */
  radius: number;
  /** Current animated bounds, when available. Must be world space. */
  bounds?:T.Box3;
};

export type SourceProjectedShadowAudit = {
  source: string;
  enabled: boolean;
  color: [number, number, number];
  maxDistanceMetres: number;
  poolSize: number;
  casters: number;
  drawn: { id: string; origin: [number, number, number]; at: [number, number, number];
    sizeMetres: number; distanceMetres: number }[];
  refused: Record<string, number>;
  limitations: readonly string[];
};

export type SourceProjectedShadows = {
  group: T.Group;
  /** Draws this frame's shadows: one silhouette per caster, on the surface below it. */
  update(casters: readonly SourceProjectedShadowCaster[], camera: T.Camera): void;
  audit(): SourceProjectedShadowAudit;
  dispose(): void;
};

const TEXTURE_SIZE = 128;
/** Three's layer 0 stays on every caster, so the main camera still draws them; each pool slot
 * takes one of the upper layers for its own silhouette render. */
const FIRST_LAYER = 31;
const DEFAULT_POOL = 64;
const LIFT_METRES = 0.012;
/** The shipped `shadowmodel_ps20`'s own arithmetic, restated once so a test can hold the port's
 * shader against the program it was read from (`research/source-projected-shadows.json`):
 *
 *     def c0.xyzw (-1.0, 1.0, 0.0, 0.0)
 *     add r0.xyz, v0.xyzw, c0.xxxx            // modulation - 1
 *     mad r0.xyz, a0.wwww, r0.xyzw, c0.yyyy   // coverage * (modulation - 1) + 1
 *     mov r0.w, c0.yyyy                       // alpha 1
 *     mov oc0.xyzw, r0.xyzw
 *
 * That is `1 + coverage * (modulation - 1)`, drawn here as a mix toward the shadow colour and
 * blended destination x source, so the surface is multiplied where the silhouette covers it and
 * left alone where it does not. */
export const SOURCE_PROJECTED_SHADOW_PROGRAM = {
  vertex: 'varying vec2 vSilhouetteUv; attribute float shadowCoverage;varying float heightCoverage; void main(){ vSilhouetteUv = uv;heightCoverage=shadowCoverage;'
    + ' gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragment: 'uniform sampler2D silhouette; uniform vec3 shadowColor;'
    + ' varying vec2 vSilhouetteUv;varying float heightCoverage;'
    + ' void main(){ float coverage = texture2D(silhouette, vSilhouetteUv).a;'
    + ' coverage*=heightCoverage;'
    + ' gl_FragColor = vec4(mix(vec3(1.0), shadowColor, coverage), 1.0); }',
} as const;
/** The same expression in the shipped program's own terms, so the test can read both at once. */
export const SOURCE_PROJECTED_SHADOW_EXPRESSION = '1 + coverage * (modulation - 1)';
const LIMITATIONS = [
  'SDK bounding-sphere falloff start and 240/255 falloff amount fade with height; exact installed engine per-entity fade constants remain unmeasured.',
  'An 8x8 surface grid follows original downward collision traces; native BSP receiver polygon clipping is not duplicated.',
  'The viewmodel borrows its live skeleton and maps camera space into the same world projection; native viewmodel shadow LOD selection remains unmeasured.',
] as const;

export function createSourceProjectedShadows(options: {
  renderer: T.WebGLRenderer; scene: T.Scene; environment: SourceEnvironment;
  metresPerSourceUnit: number; pool?: number;
  /** The map's own ground under a point, searched downwards from `fromY`, or null for none. */
  ground(x: number, z: number, fromY: number): number | null;
}): SourceProjectedShadows {
  const control = options.environment.shadow;
  const enabled = !control.disableAllShadows;
  const color: [number, number, number] = [control.color[0] / 255, control.color[1] / 255,
    control.color[2] / 255];
  const maxDistance = control.distance * options.metresPerSourceUnit;
  const poolSize = Math.max(1, Math.min(128, options.pool ?? DEFAULT_POOL));
  if (!(maxDistance > 0)) throw Error('Original projected shadows reach nothing: ' + String(control.distance));

  const group = new T.Group();
  group.name = 'SourceProjectedShadows12426148';
  group.renderOrder = 1;
  const scene = options.scene, renderer = options.renderer;
  /** The silhouette's own material: opaque, so the render writes alpha 1 wherever the model is. */
  const silhouette = new T.MeshBasicMaterial({color: 0x000000, fog: false, side: T.FrontSide});
  const silhouettes=new Map<T.Material,T.MeshBasicMaterial>();
  const silhouetteRelease=new Map<T.Material,()=>void>();
  const quad = (() => {
    const geometry = new T.PlaneGeometry(1, 1,8,8);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute('shadowCoverage',new T.BufferAttribute(new Float32Array(81).fill(1),1));
    geometry.computeBoundingSphere();
    return geometry;
  })();
  const material = new T.ShaderMaterial({
    // `1 + coverage * (modulation - 1)`, the shipped program's own expression, blended as
    // destination * source: the surface is multiplied where the silhouette covers it.
    uniforms: {silhouette: {value: null}, shadowColor: {value: new T.Vector3(...color)}},
    vertexShader: SOURCE_PROJECTED_SHADOW_PROGRAM.vertex,
    fragmentShader: SOURCE_PROJECTED_SHADOW_PROGRAM.fragment,
    blending: T.CustomBlending, blendSrc: T.DstColorFactor, blendDst: T.ZeroFactor,
    blendEquation: T.AddEquation,
    depthWrite: false, depthTest: true, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  type Slot = {layer: number; target: T.WebGLRenderTarget; camera: T.OrthographicCamera;
    mesh: T.Mesh; assigned: T.Object3D | null};
  const slots: Slot[] = [];
  for (let index = 0; index < poolSize; index++) {
    // Each silhouette renders only its caster subtree, so slots can reuse
    // these ten reserved layers without dragging the whole map through 64 passes.
    const layer = FIRST_LAYER - (index % 10);
    const target = new T.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      minFilter: T.LinearFilter, magFilter: T.LinearFilter,
    });
    target.texture.name = 'source-projected-shadow-' + index;
    // The silhouette is sampled from above, so the quad's own uv must not flip it.
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    camera.layers.set(layer);
    const mesh = new T.Mesh(quad.clone(), material.clone());
    (mesh.material as T.ShaderMaterial).uniforms.silhouette.value = target.texture;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    const slot: Slot = {layer, target, camera, mesh, assigned: null};
    slots.push(slot);
    group.add(mesh);
  }

  let casters = 0;
  const drawn: SourceProjectedShadowAudit['drawn'] = [];
  const refused: Record<string, number> = {};
  const refuse = (reason: string) => { refused[reason] = (refused[reason] ?? 0) + 1; };
  const previousClear = new T.Color();

  function update(list: readonly SourceProjectedShadowCaster[], camera: T.Camera) {
    drawn.length = 0;
    casters = 0;
    for (const reason of Object.keys(refused)) delete refused[reason];
    if (!enabled) {
      for (const slot of slots) { slot.mesh.visible = false; release(slot); }
      return;
    }
    let used = 0;
    for (const caster of list) {
      casters++;
      if (used >= slots.length) { refuse('pool-exhausted'); continue; }
      // The shadow hangs from the actor's own origin, straight down, and only lands if the map has
      // a surface below it within the map's own reach.
      const surface = options.ground(caster.origin.x, caster.origin.z, caster.origin.y);
      if (surface === null || !(surface <= caster.origin.y) ||
        caster.origin.y - surface > maxDistance) {
        refuse('nothing-below');
        continue;
      }
      const slot = slots[used++];
      assign(slot, caster.object);
      const size = caster.radius * 2;
      slot.mesh.position.set(caster.origin.x, surface + LIFT_METRES, caster.origin.z);
      slot.mesh.scale.set(size, 1, size);
      const geometry=slot.mesh.geometry,positions=geometry.getAttribute('position'),coverage=geometry.getAttribute('shadowCoverage');
      const boundSize=caster.bounds?.getSize(new T.Vector3());
      const fadeStart=caster.bounds?caster.bounds.getCenter(new T.Vector3()).y-boundSize!.length()/2:caster.origin.y;
      const fromY=caster.bounds?.max.y??caster.origin.y;
      for(let i=0;i<positions.count;i++){
        const x=caster.origin.x+positions.getX(i)*size,z=caster.origin.z+positions.getZ(i)*size;
        const y=options.ground(x,z,fromY);
        const valid=y!==null&&y<=fromY&&fadeStart-y<=maxDistance;
        positions.setY(i,valid?y!-surface:0);
        coverage.setX(i,valid?1-Math.max(0,Math.min(1,(fadeStart-y!)/maxDistance))*240/255:0);
      }
      positions.needsUpdate=true;coverage.needsUpdate=true;
      drawSilhouette(slot, caster);
      slot.mesh.visible = true;
      drawn.push({id: caster.id, origin: caster.origin.toArray() as [number, number, number],
        at: [caster.origin.x, surface, caster.origin.z], sizeMetres: size,
        distanceMetres: caster.origin.y - surface});
    }
    for (let index = used; index < slots.length; index++) {
      slots[index].mesh.visible = false;
      release(slots[index]);
    }
    void camera;
  }

  function assign(slot: Slot, object: T.Object3D) {
    if (slot.assigned === object) {object.traverse(child=>child.layers.enable(slot.layer));return;}
    release(slot);
    object.traverse((child) => child.layers.enable(slot.layer));
    slot.assigned = object;
  }

  function release(slot: Slot) {
    if (!slot.assigned) return;
    slot.assigned.traverse((child) => child.layers.disable(slot.layer));
    slot.assigned = null;
  }

  /** Renders the caster alone, from straight above, into the slot's own silhouette. */
  function drawSilhouette(slot: Slot, caster: SourceProjectedShadowCaster) {
    const camera = slot.camera;
    const reach = caster.radius;
    camera.left = -reach; camera.right = reach;
    camera.top = reach; camera.bottom = -reach;
    camera.position.set(caster.origin.x, (caster.bounds?.max.y??caster.origin.y+2)+.1, caster.origin.z);
    camera.up.set(0, 0, -1);
    camera.lookAt(caster.origin.x, caster.origin.y - 2, caster.origin.z);
    camera.near = 0.01;
    camera.far = camera.position.y-(caster.bounds?.min.y??caster.origin.y)+maxDistance+.2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const previousTarget = renderer.getRenderTarget();
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    renderer.getClearColor(previousClear);
    const previousAlpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = null;
    const changed:{mesh:T.Mesh;material:T.Material|T.Material[]}[]=[];
    caster.object.traverse(object=>{
      const mesh=object as T.Mesh;if(!mesh.isMesh)return;
      changed.push({mesh,material:mesh.material});
      const get=(source:T.Material)=>{
        const input=source as T.MeshBasicMaterial;
        if(!source.visible)return source;
        if(!input.alphaTest&&!input.transparent&&input.side===T.FrontSide)return silhouette;
        let view=silhouettes.get(source);
        if(!view){view=new T.MeshBasicMaterial({color:0x000000,fog:false});silhouettes.set(source,view);
          const release=()=>{view!.dispose();silhouettes.delete(source);silhouetteRelease.delete(source);source.removeEventListener('dispose',release);};
          source.addEventListener('dispose',release);silhouetteRelease.set(source,release);
        }
        if(view.map!==input.map||view.alphaMap!==input.alphaMap||view.alphaTest!==input.alphaTest||view.side!==input.side||view.transparent!==input.transparent)view.needsUpdate=true;
        view.map=input.map;view.alphaMap=input.alphaMap;view.alphaTest=input.alphaTest;view.side=input.side;
        view.transparent=input.transparent;view.opacity=input.opacity;view.depthWrite=true;
        return view;
      };
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(get):get(mesh.material);
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(slot.target);
    try{renderer.clear();renderer.render(caster.object, camera);}
    finally{
      for(const row of changed)row.mesh.material=row.material;
      renderer.setRenderTarget(previousTarget);scene.overrideMaterial = previousOverride;
      scene.background = previousBackground;renderer.setClearColor(previousClear, previousAlpha);
    }
  }

  return {
    group,
    update,
    audit: () => ({source: 'source-projected-shadows-v1', enabled, color,
      maxDistanceMetres: maxDistance, poolSize, casters, drawn: [...drawn],
      refused: {...refused}, limitations: LIMITATIONS}),
    dispose() {
      for (const slot of slots) {
        release(slot);
        // Take the quad out of the group as well: a disposed renderer must not leave a mesh
        // pointing at a freed silhouette for the next frame to draw.
        group.remove(slot.mesh);
        slot.mesh.geometry.dispose();(slot.mesh.material as T.Material).dispose();
        slot.target.dispose();
      }
      slots.length = 0;
      material.dispose();
      silhouette.dispose();
      [...silhouetteRelease.values()].forEach(release=>release());silhouettes.clear();
      quad.dispose();
      group.removeFromParent();
    },
  };
}
