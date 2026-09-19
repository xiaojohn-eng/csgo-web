import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  createSourceProjectedShadows,
  SOURCE_PROJECTED_SHADOW_EXPRESSION,
  SOURCE_PROJECTED_SHADOW_PROGRAM,
  type SourceProjectedShadowCaster,
} from '../game/source-projected-shadows';
import { SOURCE_DUST2_ENVIRONMENT, type SourceEnvironment } from '../game/source-environment';

const report = JSON.parse(readFileSync(resolve(__dirname, '..', 'research/source-environment.json'), 'utf8')) as {
  metersPerSourceUnit: number;
  shadowControl: { color: number[]; distance: number; disableAllShadows: boolean;
    sourceAngles: number[]; hammerId: string };
};
/** What the shipped build states about the same shadow, read by
 * `scripts/probe-source-projected-shadows.py`. */
const shipped = JSON.parse(readFileSync(resolve(__dirname, '..', 'research/source-projected-shadows.json'), 'utf8')) as {
  format: string;
  entity: { classes: string[]; members: string[]; key: string; inputs: string[];
    noDirectionMember: boolean; meaning: string };
  sources: Record<string, string>;
  map: { color: number[]; sourceDistance: number; disableAllShadows: boolean;
    sourceAngles: number[]; metresPerSourceUnit: number; reachMetres: number };
  programs: Record<string, { path: string; statics: string[]; dynamicCombos: number;
    programs: Record<string, { bytes: number; sha256: string; instructions: string[] }> }>;
  expression: string;
  silhouette: string;
  reading: string;
  boundary: string;
};

const model = shipped.programs['model'].programs['0x0/0'];
const build = shipped.programs['build'].programs['0x0/0'];

/** The one place the map's own numbers enter the renderer, so a run cannot be tuned around them. */
const METRES_PER_UNIT = report.metersPerSourceUnit;

type Call = { kind: string; value?: unknown };

/** A renderer that records the pass instead of drawing it: the silhouette render is the claim
 * under test, and it can be read back in full without a GPU. */
function stubRenderer() {
  const calls: Call[] = [];
  const restoredColour = new T.Color(0.25, 0.5, 0.75);
  const restoredAlpha = 0.375;
  let current: unknown = null;
  let overrideAtRender: T.Material | null = null;
  let backgroundAtRender: T.Scene['background'] | undefined;
  let clearAtRender: unknown = null;
  let cameraAtRender: T.Camera | null = null;
  let bodyMaterialAtRender:T.Material|null=null;
  let pendingClear: unknown = null;
  const renderer = {
    getRenderTarget: () => { calls.push({ kind: 'getRenderTarget' }); return current; },
    setRenderTarget: (value: unknown) => { calls.push({ kind: 'setRenderTarget', value }); current = value; },
    getClearColor: (colour: T.Color) => { calls.push({ kind: 'getClearColor' }); colour.copy(restoredColour); return colour; },
    getClearAlpha: () => { calls.push({ kind: 'getClearAlpha' }); return restoredAlpha; },
    setClearColor: (colour: unknown, alpha: unknown) => {
      calls.push({ kind: 'setClearColor', value: [colour, alpha] });
      // The module clears with a hex number; the map's own colour it restores is a `Color`.
      pendingClear = colour instanceof T.Color
        ? [colour.r, colour.g, colour.b, alpha]
        : [((colour as number) >> 16 & 255) / 255, ((colour as number) >> 8 & 255) / 255,
          ((colour as number) & 255) / 255, alpha];
    },
    clear: () => { calls.push({ kind: 'clear' }); },
    render: (scene: T.Scene, camera: T.Camera) => {
      calls.push({ kind: 'render',value:scene });
      overrideAtRender = scene.overrideMaterial;
      backgroundAtRender = scene.background;
      clearAtRender = pendingClear;
      cameraAtRender = camera;
      scene.traverseVisible(o=>{const mesh=o as T.Mesh;if(mesh.isMesh&&camera.layers.test(mesh.layers))bodyMaterialAtRender=mesh.material as T.Material;});
    },
  };
  return {
    renderer: renderer as unknown as T.WebGLRenderer,
    calls,
    restoredColour,
    restoredAlpha,
    clearAtRender: () => clearAtRender,
    overrideAtRender: () => overrideAtRender,
    backgroundAtRender: () => backgroundAtRender,
    cameraAtRender: () => cameraAtRender,
    bodyMaterialAtRender:()=>bodyMaterialAtRender,
  };
}

function actor(id: string, position: T.Vector3) {
  const root = new T.Group();
  root.name = id;
  const body = new T.Mesh(new T.BoxGeometry(0.6, 1.8, 0.6), new T.MeshBasicMaterial());
  body.position.y = 0.9;
  root.add(body);
  root.position.copy(position);
  const casters: SourceProjectedShadowCaster[] = [{ id, object: root, origin: root.position, radius: 0.35 }];
  return { root, body, casters };
}

/** The map's own shadow settings, with one field overridable so a refusal can be provoked. */
const withShadow = (shadow: Partial<SourceEnvironment['shadow']>): SourceEnvironment =>
  ({ ...SOURCE_DUST2_ENVIRONMENT, shadow: { ...SOURCE_DUST2_ENVIRONMENT.shadow, ...shadow } });

function factory(options: {
  pool?: number; shadow?: Partial<SourceEnvironment['shadow']>;
  ground?: (x: number, z: number, fromY: number) => number | null;
  scene?: T.Scene;
} = {}) {
  const stub = stubRenderer();
  const scene = options.scene ?? new T.Scene();
  const shadows = createSourceProjectedShadows({
    renderer: stub.renderer, scene,
    environment: withShadow(options.shadow ?? {}),
    metresPerSourceUnit: METRES_PER_UNIT,
    pool: options.pool,
    ground: options.ground ?? (() => 3),
  });
  scene.add(shadows.group);
  return { ...stub, scene, shadows };
}

const camera = new T.PerspectiveCamera(70, 16 / 9, 0.1, 500);

describe('What the shipped build states about it', () => {
  it('nets no direction at all, so straight down is the whole of it', () => {
    expect(shipped.format).toBe('source-projected-shadows-v1');
    expect(shipped.entity.classes).toEqual(['DT_ShadowControl', 'CShadowControl']);
    expect(shipped.entity.members).toEqual(['m_shadowColor', 'm_flShadowMaxDist',
      'm_bDisableShadows', 'm_bEnableLocalLightShadows']);
    expect(shipped.entity.noDirectionMember).toBe(true);
    // The map's own key is paired with the member it drives, in the server's own table.
    expect(shipped.entity.key).toBe('disableallshadows');
    expect(shipped.entity.inputs).toEqual(['SetDistance', 'SetShadowsDisabled',
      'SetShadowsFromLocalLightsEnabled']);
    expect(shipped.entity.meaning).toMatch(/straight down/);
    expect(shipped.sources['sourceBspSha256']).toBe(SOURCE_DUST2_ENVIRONMENT.sourceBspSha256);
  });

  it('states the expression the port draws, instruction by instruction', () => {
    expect(shipped.expression).toBe('oc0.rgb = 1 + a0.w * (v0.rgb - 1); oc0.a = 1');
    expect(model.instructions[0]).toBe('def c0.xyzw (-1.0, 1.0, 0.0, 0.0)');
    expect(model.instructions.slice(-4)).toEqual([
      'add r0.xyz, v0.xyzw, c0.xxxx',
      'mad r0.xyz, a0.wwww, r0.xyzw, c0.yyyy',
      'mov r0.w, c0.yyyy',
      'mov oc0.xyzw, r0.xyzw',
    ]);
    // The two operands it scales: the coverage, and the colour it is pulled from.
    expect(model.instructions.join(' ')).toContain('a0.wwww');
    expect(model.instructions.join(' ')).toContain('v0.xyzw');
    // And the port's own shader is that arithmetic, not a look-alike.
    expect(SOURCE_PROJECTED_SHADOW_EXPRESSION).toBe('1 + coverage * (modulation - 1)');
    expect(SOURCE_PROJECTED_SHADOW_PROGRAM.fragment)
      .toContain('mix(vec3(1.0), shadowColor, coverage)');
    const { shadows } = factory();
    expect((shadows.group.children[0] as T.Mesh).material).toMatchObject({
      fragmentShader: SOURCE_PROJECTED_SHADOW_PROGRAM.fragment,
    });
    shadows.dispose();
  });

  it('states the silhouette that expression reads, white with the model own alpha', () => {
    expect(shipped.silhouette).toBe('white, alpha = the model texture alpha times the vertex alpha');
    expect(build.instructions).toEqual([
      'def c0.xyzw (1.0, 0.0, 0.0, 0.0)',
      'dcl usage=0 index=0 a0.xy',
      'dcl usage=0 index=0 v0.xyzw',
      'dcl usage=0 index=0 s0.xyzw',
      'texld r0.xyzw, a0.xyzw, s0.xyzw',
      'mul r0.w, r0.wwww, v0.wwww',
      'mov r0.xyz, c0.xxxx',
      'mov oc0.xyzw, r0.xyzw',
    ]);
    // Both programs are single-static: the map chooses nothing about them.
    for (const key of ['model', 'build']) {
      expect(shipped.programs[key].statics).toEqual(['0x0', '0xffffffff']);
      expect(shipped.programs[key].dynamicCombos).toBe(1);
      expect(shipped.programs[key].path).toMatch(/^shaders\/fxc\/shadow/);
    }
  });

  it('takes the reach and the colour from the map, at the map own scale', () => {
    expect(shipped.map.color).toEqual(SOURCE_DUST2_ENVIRONMENT.shadow.color);
    expect(shipped.map.sourceDistance).toBe(SOURCE_DUST2_ENVIRONMENT.shadow.distance);
    expect(shipped.map.disableAllShadows).toBe(SOURCE_DUST2_ENVIRONMENT.shadow.disableAllShadows);
    expect(shipped.map.sourceAngles).toEqual(SOURCE_DUST2_ENVIRONMENT.shadow.sourceAngles);
    expect(shipped.map.metresPerSourceUnit).toBe(SOURCE_DUST2_ENVIRONMENT.metersPerSourceUnit);
    expect(shipped.map.reachMetres).toBeCloseTo(1.8288, 9);
    expect(shipped.map.reachMetres)
      .toBeCloseTo(shipped.map.sourceDistance * shipped.map.metresPerSourceUnit, 12);
  });

  it('says what it did not read rather than implying it did', () => {
    expect(shipped.reading).toMatch(/72 units of reach/);
    expect(shipped.boundary).toMatch(/height fade/);
    expect(shipped.boundary).toMatch(/projection plane/);
    const { shadows } = factory();
    // The renderer's own limitations and the probe's boundary agree about the height fade.
    expect(shadows.audit().limitations.join(' ')).toMatch(/fade with height/);
    shadows.dispose();
  });
});

describe('Original projected shadow', () => {
  it('takes the map\'s own shadow_control numbers rather than a look-alike', () => {
    // The entity the numbers come from is the map's own instance, not a shader default.
    expect(Number(report.shadowControl.hammerId)).toBeGreaterThan(0);
    expect(SOURCE_DUST2_ENVIRONMENT.shadow).toMatchObject({
      color: report.shadowControl.color,
      distance: report.shadowControl.distance,
      disableAllShadows: report.shadowControl.disableAllShadows,
      sourceAngles: report.shadowControl.sourceAngles,
    });
    const { shadows } = factory();
    const audit = shadows.audit();
    // 128/255, the map's own byte, not a guessed grey.
    expect(audit.color).toEqual([128 / 255, 128 / 255, 128 / 255]);
    // and its own reach, in the units this port renders in.
    expect(audit.maxDistanceMetres).toBeCloseTo(72 * METRES_PER_UNIT, 12);
    expect(audit.maxDistanceMetres).toBeCloseTo(1.8288, 9);
    expect(audit.enabled).toBe(true);
    expect(audit.source).toBe('source-projected-shadows-v1');
    shadows.dispose();
  });

  it('leaves the map alone when it declares all shadows off', () => {
    const { shadows, scene } = factory({ shadow: { disableAllShadows: true } });
    expect(shadows.audit().enabled).toBe(false);
    const { casters } = actor('bot', new T.Vector3(0, 4, 0));
    scene.add(casters[0].object);
    shadows.update(casters, camera);
    const audit = shadows.audit();
    expect(audit.drawn).toEqual([]);
    expect(audit.refused).toEqual({});
    expect(shadows.group.children.every((slot) => !slot.visible)).toBe(true);
    shadows.dispose();
  });

  it('draws the shipped expression, destination times source', () => {
    const { shadows } = factory();
    const mesh = shadows.group.children[0] as T.Mesh;
    const material = mesh.material as T.ShaderMaterial;
    // `1 + coverage * (modulation - 1)`, the shipped program's own expression.
    expect(material.fragmentShader).toContain('mix(vec3(1.0), shadowColor, coverage)');
    expect(material.fragmentShader).toContain('texture2D(silhouette, vSilhouetteUv).a');
    expect(material.blending).toBe(T.CustomBlending);
    expect(material.blendSrc).toBe(T.DstColorFactor);
    expect(material.blendDst).toBe(T.ZeroFactor);
    expect(material.blendEquation).toBe(T.AddEquation);
    expect(material.depthWrite).toBe(false);
    // Each slot owns its own silhouette, so two actors cannot read each other's.
    const second = shadows.group.children[1] as T.Mesh;
    expect(second.material).not.toBe(mesh.material);
    expect((second.material as T.ShaderMaterial).uniforms.silhouette.value)
      .not.toBe(material.uniforms.silhouette.value);
    const [r, g, b] = material.uniforms.shadowColor.value.toArray();
    expect(r).toBeCloseTo(128 / 255, 12);
    expect(g).toBeCloseTo(128 / 255, 12);
    expect(b).toBeCloseTo(128 / 255, 12);
    shadows.dispose();
  });

  it('builds the silhouette into its own target and puts the renderer back as it found it', () => {
    const probe = factory();
    const { casters, root } = actor('bot', new T.Vector3(2, 4, -3));
    probe.scene.add(root);
    const slot = probe.shadows.group.children[0] as T.Mesh;
    const silhouetteTexture = (slot.material as T.ShaderMaterial).uniforms.silhouette.value as T.Texture;
    probe.scene.background = new T.Color(0x123456);
    probe.shadows.update(casters, camera);

    expect(probe.calls.map((call) => call.kind)).toEqual(['getRenderTarget', 'getClearColor',
      'getClearAlpha', 'setClearColor', 'setRenderTarget', 'clear', 'render', 'setRenderTarget',
      'setClearColor']);
    // The silhouette is drawn into its own target, not into the frame.
    expect((probe.calls[4].value as T.WebGLRenderTarget).texture).toBe(silhouetteTexture);
    // The frame's target is the one it started on, and the scene's background is back.
    expect(probe.calls[7].value).toBeNull();
    expect(probe.backgroundAtRender()).toBeUndefined();
    expect(probe.scene.background).not.toBeNull();
    expect(probe.scene.overrideMaterial).toBeNull();
    // The map's own clear colour and alpha are restored, not left at the silhouette's.
    const last = probe.calls[8].value as [T.Color, number];
    expect([last[0].getHex(), last[1]]).toEqual([probe.restoredColour.getHex(), probe.restoredAlpha]);
    // One pass per drawn caster, and a refused caster draws nothing.
    const passes = () => probe.calls.filter((call) => call.kind === 'clear').length;
    probe.shadows.update([], camera);
    expect(passes()).toBe(1);
    probe.shadows.dispose();
  });

  it('renders the caster alone through its own silhouette material and restores the original', () => {
    const probe = factory();
    const { casters, root, body } = actor('bot', new T.Vector3(2, 4, -3));
    probe.scene.add(root);
    const decoy = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
    probe.scene.add(decoy);
    probe.shadows.update(casters, camera);

    expect(probe.overrideAtRender()).toBeUndefined();
    expect(probe.calls.find(call=>call.kind==='render')?.value).toBe(root);
    const override = probe.bodyMaterialAtRender() as T.MeshBasicMaterial;
    expect(override).toBeInstanceOf(T.MeshBasicMaterial);
    expect(override.color.getHex()).toBe(0x000000);
    // Opaque white-at-alpha: the model's own coverage becomes the shadow's alpha.
    expect(override.transparent).toBe(false);
    expect(override.opacity).toBe(1);
    // Cleared to nothing, so nothing but the model survives into alpha.
    const cleared = probe.clearAtRender() as number[];
    expect(cleared[0]).toBeCloseTo(0, 12);
    expect(cleared[1]).toBeCloseTo(0, 12);
    expect(cleared[2]).toBeCloseTo(0, 12);
    expect(cleared[3]).toBe(0);
    // The caster is on the slot's layer and nothing else is, so only it is drawn.
    expect(body.layers.isEnabled(31)).toBe(true);
    expect(decoy.layers.isEnabled(31)).toBe(false);
    probe.shadows.dispose();
  });

  it('points the silhouette camera straight down the map\'s own axis', () => {
    const probe = factory();
    const { casters, root } = actor('bot', new T.Vector3(2, 4, -3));
    probe.scene.add(root);
    probe.shadows.update(casters, camera);
    const shot = probe.cameraAtRender() as T.OrthographicCamera;
    expect(shot.isOrthographicCamera).toBe(true);
    const direction = shot.getWorldDirection(new T.Vector3());
    // `angles 90 43 0` is straight down, and this entity has no direction member at all.
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBeCloseTo(-1, 12);
    expect(direction.z).toBeCloseTo(0, 12);
    // Above the caster, so the model is inside the near/far bracket.
    expect(shot.position.x).toBeCloseTo(2, 12);
    expect(shot.position.z).toBeCloseTo(-3, 12);
    expect(shot.position.y).toBeGreaterThan(4);
    expect(shot.near).toBeGreaterThan(0);
    expect(shot.far).toBeGreaterThan(shot.near);
    probe.shadows.dispose();
  });

  it('puts the shadow on the surface below the caster, at the caster\'s own width', () => {
    const probe = factory({ ground: (x, z, fromY) => (x === 2 && z === -3 && fromY === 4 ? 3 : null) });
    const { casters, root } = actor('bot', new T.Vector3(2, 4, -3));
    probe.scene.add(root);
    probe.shadows.update(casters, camera);
    const mesh = probe.shadows.group.children[0] as T.Mesh;
    expect(mesh.visible).toBe(true);
    // Straight down: the shadow keeps the caster's own x/z and lands on the surface.
    expect(mesh.position.x).toBeCloseTo(2, 12);
    expect(mesh.position.z).toBeCloseTo(-3, 12);
    expect(mesh.position.y).toBeGreaterThan(3);
    expect(mesh.position.y - 3).toBeLessThan(0.05);
    expect(mesh.scale.x).toBeCloseTo(0.7, 12);
    expect(mesh.scale.y).toBeCloseTo(1, 12);
    expect(mesh.scale.z).toBeCloseTo(0.7, 12);
    // A horizontal quad: it lies on the ground it is projected onto.
    const normal = (mesh.geometry.getAttribute('normal') as T.BufferAttribute);
    expect(normal.getX(0)).toBeCloseTo(0, 6);
    expect(normal.getY(0)).toBeCloseTo(1, 6);
    expect(normal.getZ(0)).toBeCloseTo(0, 6);
    const audit = probe.shadows.audit();
    expect(audit.casters).toBe(1);
    expect(audit.refused).toEqual({});
    expect(audit.drawn).toHaveLength(1);
    expect(audit.drawn[0].id).toBe('bot');
    expect(audit.drawn[0].at).toEqual([2, 3, -3]);
    expect(audit.drawn[0].sizeMetres).toBeCloseTo(0.7, 12);
    expect(audit.drawn[0].distanceMetres).toBeCloseTo(1, 12);
    probe.shadows.dispose();
  });

  it('drops a caster with nothing under it, ground above it, or out of the map\'s reach', () => {
    const nothing = factory({ ground: () => null });
    const nowhere = factory({ ground: () => 9 });
    const tooFar = factory({ ground: () => 0 });
    for (const probe of [nothing, nowhere, tooFar]) {
      const { casters, root } = actor('bot', new T.Vector3(2, 4, -3));
      probe.scene.add(root);
      probe.shadows.update(casters, camera);
      const audit = probe.shadows.audit();
      expect(audit.drawn).toEqual([]);
      // 4 m up is past the 1.8288 m this map states, and 9 m up is above the caster.
      expect(audit.refused).toEqual({ 'nothing-below': 1 });
      expect((probe.shadows.group.children[0] as T.Mesh).visible).toBe(false);
      probe.shadows.dispose();
    }
  });

  it('keeps the shadows it can reach and drops only the ones it cannot', () => {
    const probe = factory({ ground: (x) => (x > 0 ? 3 : null) });
    const near = actor('reachable', new T.Vector3(2, 4, -3));
    const far = actor('unreachable', new T.Vector3(-2, 4, -3));
    probe.scene.add(near.root, far.root);
    probe.shadows.update([...near.casters, ...far.casters], camera);
    const audit = probe.shadows.audit();
    expect(audit.casters).toBe(2);
    expect(audit.drawn.map((entry) => entry.id)).toEqual(['reachable']);
    expect(audit.refused).toEqual({ 'nothing-below': 1 });
    expect(audit.drawn.length + Object.values(audit.refused).reduce((sum, n) => sum + n, 0)).toBe(2);
    probe.shadows.dispose();
  });

  it('refuses casters past the pool instead of reusing a slot two actors share', () => {
    const probe = factory({ pool: 1, ground: () => 3 });
    const one = actor('one', new T.Vector3(0, 4, 0));
    const two = actor('two', new T.Vector3(2, 4, 0));
    const three = actor('three', new T.Vector3(4, 4, 0));
    probe.scene.add(one.root, two.root, three.root);
    probe.shadows.update([...one.casters, ...two.casters, ...three.casters], camera);
    const audit = probe.shadows.audit();
    expect(audit.poolSize).toBe(1);
    expect(audit.drawn.map((entry) => entry.id)).toEqual(['one']);
    expect(audit.refused).toEqual({ 'pool-exhausted': 2 });
    probe.shadows.dispose();
  });

  it('takes the slot\'s layer back when the slot goes unused', () => {
    const probe = factory({ ground: () => 3 });
    const one = actor('one', new T.Vector3(0, 4, 0));
    probe.scene.add(one.root);
    probe.shadows.update(one.casters, camera);
    expect(one.body.layers.isEnabled(31)).toBe(true);
    // A frame with nobody in it must not leave the old caster on the silhouette layer.
    probe.shadows.update([], camera);
    expect(one.body.layers.isEnabled(31)).toBe(false);
    expect(probe.shadows.audit().drawn).toEqual([]);
    expect(probe.shadows.group.children.every((slot) => !slot.visible)).toBe(true);
    probe.shadows.dispose();
  });

  it('states what it does not reproduce rather than implying parity', () => {
    const { shadows } = factory();
    const limitations = shadows.audit().limitations;
    expect(limitations).toHaveLength(3);
    const text = limitations.join(' ');
    expect(text).toMatch(/height/);
    expect(text).toMatch(/viewmodel/);
    expect(text).toMatch(/surface/);
    shadows.dispose();
  });

  it('refuses a map whose shadow reach reaches nothing', () => {
    expect(() => factory({ shadow: { distance: 0 } })).toThrow(/reach nothing/);
  });

  it('matches receiver footprint to the silhouette camera and fades on a sloped original receiver',()=>{
    const probe=factory({ground:x=>3+x*.15});
    const {root,casters}=actor('slope',new T.Vector3(0,4,0));probe.scene.add(root);
    probe.shadows.update(casters,camera);
    const mesh=probe.shadows.group.children[0]as T.Mesh;
    const shot=probe.cameraAtRender()as T.OrthographicCamera;
    expect(shot.right-shot.left).toBeCloseTo(mesh.scale.x,12);
    expect(shot.top-shot.bottom).toBeCloseTo(mesh.scale.z,12);
    const positions=mesh.geometry.getAttribute('position'),alpha=mesh.geometry.getAttribute('shadowCoverage');
    for(let i=0;i<positions.count;i++){
      expect(positions.getY(i)).toBeCloseTo(positions.getX(i)*mesh.scale.x*.15,6);
      expect(alpha.getX(i)).toBeLessThan(1);expect(alpha.getX(i)).toBeGreaterThan(0);
    }
    probe.shadows.dispose();
  });

  it('preserves cutout coverage without turning opaque phong-mask alpha into holes',()=>{
    const probe=factory();const {root,body,casters}=actor('cutout',new T.Vector3(0,4,0));
    const original=body.material as T.MeshBasicMaterial;original.map=new T.Texture();original.alphaTest=.3;
    probe.scene.add(root);probe.shadows.update(casters,camera);
    const view=probe.bodyMaterialAtRender()as T.MeshBasicMaterial;
    expect(view.map).toBe(original.map);expect(view.alphaTest).toBe(.3);expect(body.material).toBe(original);
    probe.shadows.dispose();
  });

  it('disposes every silhouette it made and leaves the scene', () => {
    const probe = factory({ pool: 3, ground: () => 3 });
    const one = actor('one', new T.Vector3(0, 4, 0));
    const two = actor('two', new T.Vector3(2, 4, 0));
    const three = actor('three', new T.Vector3(4, 4, 0));
    probe.scene.add(one.root, two.root, three.root);
    probe.shadows.update([...one.casters, ...two.casters, ...three.casters], camera);
    const targets = probe.calls
      .filter((call) => call.kind === 'setRenderTarget' && call.value !== null)
      .map((call) => call.value as T.WebGLRenderTarget);
    expect(targets).toHaveLength(3);
    const disposed = targets.map(() => vi.fn());
    targets.forEach((target, index) => target.addEventListener('dispose', disposed[index]));
    expect(one.body.layers.isEnabled(31)).toBe(true);
    expect(two.body.layers.isEnabled(30)).toBe(true);
    probe.shadows.dispose();
    disposed.forEach((listener) => expect(listener).toHaveBeenCalledTimes(1));
    // Every layer it borrowed is handed back, or the next frame draws a ghost silhouette.
    expect(one.body.layers.isEnabled(31)).toBe(false);
    expect(two.body.layers.isEnabled(30)).toBe(false);
    expect(three.body.layers.isEnabled(29)).toBe(false);
    expect(probe.shadows.group.parent).toBeNull();
    expect(probe.shadows.group.children).toHaveLength(0);
  });

  it('keeps its quad and group out of the main pass\'s way', () => {
    const { shadows } = factory();
    expect(shadows.group.name).toBe('SourceProjectedShadows12426148');
    for (const child of shadows.group.children) {
      const mesh = child as T.Mesh;
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.renderOrder).toBe(1);
      expect(mesh.visible).toBe(false);
    }
    expect(shadows.group.visible).toBe(true);
    shadows.dispose();
  });
});
