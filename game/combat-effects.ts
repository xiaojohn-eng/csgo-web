import * as T from 'three';

/** Fixed GPU/CPU budget. Four instanced draws at most; no shadow-map draws. */
export const COMBAT_EFFECT_BUDGET = Object.freeze({ casings: 48, smoke: 96, debris: 192, flashes: 12 });
type Kind = 'casing' | 'smoke' | 'debris' | 'flash';
type Particle = {
  active: boolean; position: T.Vector3; velocity: T.Vector3; rotation: T.Quaternion;
  spin: T.Vector3; age: number; life: number; size: number; seed: number;
};
type Pool = {
  kind: Kind; mesh: T.InstancedMesh; particles: Particle[]; cursor: number;
  data?: T.InstancedBufferAttribute;
};
const finiteGpuFloat = (value: number) => Number.isFinite(value) && Number.isFinite(Math.fround(value));

const CARD_VERTEX = `
attribute vec2 effectData;
varying vec2 vUv;
varying vec2 vEffect;
void main() {
  vUv = uv; vEffect = effectData;
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = length(instanceMatrix[0].xyz);
  float angle = effectData.y * 6.2831853;
  mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 offset = turn * position.xy * size;
  gl_Position = projectionMatrix * (center + vec4(offset, 0.0, 0.0));
}`;

const SMOKE_FRAGMENT = `
varying vec2 vUv;
varying vec2 vEffect;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float t = vEffect.x, seed = vEffect.y;
  vec2 flow = p * 3.4 + vec2(seed * 19.0, t * 1.7);
  float density = noise(flow) * 0.58 + noise(flow * 2.07) * 0.29 + noise(flow * 4.1) * 0.13;
  float edge = 1.0 - smoothstep(0.38, 0.98, length(p) + (density - 0.5) * 0.34);
  float life = smoothstep(0.0, 0.075, t) * (1.0 - smoothstep(0.38, 1.0, t));
  float alpha = edge * life * (0.34 + density * 0.42);
  if (alpha < 0.008) discard;
  float light = clamp(0.48 + p.y * 0.14 - p.x * 0.08 + density * 0.3, 0.2, 0.9);
  vec3 ash = mix(vec3(0.15, 0.17, 0.18), vec3(0.48, 0.49, 0.46), light);
  vec3 ember = vec3(0.44, 0.18, 0.045) * (1.0 - smoothstep(0.0, 0.16, t));
  gl_FragColor = vec4(ash + ember, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FLASH_FRAGMENT = `
varying vec2 vUv;
varying vec2 vEffect;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float t = vEffect.x, r = length(p);
  float theta = dot(p, p) < 0.00000001 ? 0.0 : atan(p.y, p.x);
  float lobes = 0.05 * sin(theta * 7.0 + vEffect.y * 13.0) + 0.04 * sin(theta * 11.0);
  float fire = (1.0 - smoothstep(0.06, 0.7 + lobes, r)) * pow(1.0 - t, 2.7);
  float radius = 0.15 + 0.78 * sqrt(t);
  float ring = (1.0 - smoothstep(0.018, 0.07, abs(r - radius))) * (1.0 - t) * 0.38;
  float rays = pow(max(0.0, 1.0 - abs(p.x * p.y) * 32.0), 3.0)
    * (1.0 - smoothstep(0.2, 0.95, r)) * pow(1.0 - t, 5.0) * 0.28;
  float alpha = fire + ring + rays;
  if (alpha < 0.008 || r > 1.0) discard;
  vec3 color = mix(vec3(1.0, 0.27, 0.035), vec3(1.0, 0.91, 0.66), exp(-r * 7.0));
  gl_FragColor = vec4(color * 2.0, min(1.0, alpha));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makePool(kind: Kind, capacity: number, geometry: T.BufferGeometry, material: T.Material, card = false): Pool {
  const mesh = new T.InstancedMesh(geometry, material, capacity);
  mesh.name = `CombatEffects_${kind}`; mesh.count = 0; mesh.visible = false;
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  const data = card ? new T.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(T.DynamicDrawUsage) : undefined;
  if (data) geometry.setAttribute('effectData', data);
  const particles = Array.from({ length: capacity }, (): Particle => ({ active: false,
    position: new T.Vector3(), velocity: new T.Vector3(), rotation: new T.Quaternion(),
    spin: new T.Vector3(), age: 0, life: 1, size: 1, seed: 0 }));
  return { kind, mesh, particles, cursor: 0, data };
}

function cardMaterial(fragmentShader: string, additive = false): T.ShaderMaterial {
  return new T.ShaderMaterial({ vertexShader: CARD_VERTEX, fragmentShader,
    transparent: true, depthTest: true, depthWrite: false,
    blending: additive ? T.AdditiveBlending : T.NormalBlending,
    // Camera-facing cards always present their front face; transparent DoubleSide would
    // otherwise render a second pass and exceed the four-draw budget.
    side: T.FrontSide, toneMapped: true });
}

/** Original procedural VFX, with no image textures, external services or gameplay authority.
 * World receives blast effects. View receives casings in the supplied gun-camera/view-scene
 * coordinate system; eject's matrix is NOT a map-space matrix despite the parameter name.
 */
export class CombatEffects {
  private readonly casing: Pool;
  private readonly smoke: Pool;
  private readonly debris: Pool;
  private readonly flash: Pool;
  private readonly pools: Pool[];
  private readonly matrix = new T.Matrix4();
  private readonly scale = new T.Vector3();
  private readonly rotation = new T.Quaternion();
  private readonly angles = new T.Euler();
  private randomState = 0x76b48c1;
  disposed = false;

  constructor(world: T.Scene, view: T.Scene) {
    // A tapered hollow case with a rim, rather than a solid featureless cylinder.
    const brassProfile = [[.0038, -.016], [.0045, -.016], [.0045, -.0145], [.0038, -.014],
      [.0038, .010], [.0029, .015], [.00235, .015], [.00235, .008]].map(([x, y]) => new T.Vector2(x, y));
    this.casing = makePool('casing', COMBAT_EFFECT_BUDGET.casings, new T.LatheGeometry(brassProfile, 10),
      new T.MeshStandardMaterial({ color: '#b99245', metalness: .82, roughness: .28, side: T.DoubleSide }));
    this.smoke = makePool('smoke', COMBAT_EFFECT_BUDGET.smoke, new T.PlaneGeometry(2, 2), cardMaterial(SMOKE_FRAGMENT), true);
    this.debris = makePool('debris', COMBAT_EFFECT_BUDGET.debris, new T.IcosahedronGeometry(.04, 0),
      new T.MeshStandardMaterial({ color: '#5c5750', metalness: .12, roughness: .91 }));
    this.flash = makePool('flash', COMBAT_EFFECT_BUDGET.flashes, new T.PlaneGeometry(2, 2), cardMaterial(FLASH_FRAGMENT, true), true);
    this.smoke.mesh.renderOrder = 1; this.flash.mesh.renderOrder = 2;
    this.pools = [this.casing, this.smoke, this.debris, this.flash];
    world.add(this.debris.mesh, this.smoke.mesh, this.flash.mesh); view.add(this.casing.mesh);
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }

  private take(pool: Pool): Particle {
    const particle = pool.particles[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.particles.length;
    particle.active = true; particle.age = 0; particle.rotation.identity();
    particle.spin.set(0, 0, 0); particle.velocity.set(0, 0, 0); particle.seed = this.random();
    return particle;
  }

  eject(casingWorldMatrix: T.Matrix4): void {
    if (this.disposed || !casingWorldMatrix.elements.every(finiteGpuFloat)) return;
    const determinant = casingWorldMatrix.determinant();
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return;
    const p = this.take(this.casing);
    casingWorldMatrix.decompose(p.position, p.rotation, this.scale);
    p.rotation.normalize(); p.size = 1; p.life = .62 + this.random() * .16;
    p.velocity.set(1.0 + this.random() * .45, .45 + this.random() * .4, .2 + this.random() * .3).applyQuaternion(p.rotation);
    p.spin.set(13 + this.random() * 8, 5 + this.random() * 7, -8 - this.random() * 10);
    this.sync(this.casing);
  }

  explode(position: T.Vector3): void {
    if (this.disposed || ![position.x, position.y, position.z].every(finiteGpuFloat)) return;
    const flash = this.take(this.flash); flash.position.copy(position); flash.position.y += .12;
    flash.size = 1.35; flash.life = .44;
    for (let i = 0; i < 10; i++) {
      const p = this.take(this.smoke), angle = this.random() * Math.PI * 2;
      p.position.copy(position).add(this.scale.set(Math.cos(angle) * .14, .12 + this.random() * .28, Math.sin(angle) * .14));
      p.velocity.set(Math.cos(angle) * (.45 + this.random() * .8), .6 + this.random() * .7, Math.sin(angle) * (.45 + this.random() * .8));
      p.life = 1.7 + this.random() * 1.1; p.size = .19 + this.random() * .12;
    }
    for (let i = 0; i < 14; i++) {
      const p = this.take(this.debris), angle = this.random() * Math.PI * 2, speed = 1.6 + this.random() * 2.1;
      p.position.copy(position); p.position.y += .14;
      p.velocity.set(Math.cos(angle) * speed, 1.5 + this.random() * 3.1, Math.sin(angle) * speed);
      p.spin.set(this.random() * 12 - 6, this.random() * 14 - 7, this.random() * 16 - 8);
      p.size = .5 + this.random() * .85; p.life = .8 + this.random() * .9;
    }
    this.sync(this.flash); this.sync(this.smoke); this.sync(this.debris);
  }

  private sync(pool: Pool): void {
    let count = 0;
    for (const p of pool.particles) {
      if (!p.active) continue;
      const t = Math.min(1, p.age / p.life);
      const size = p.size * (pool.kind === 'smoke' ? 1 + 4.4 * t
        : pool.kind === 'flash' ? 1 + .65 * Math.sqrt(t) : 1 - T.MathUtils.smoothstep(t, .76, 1));
      this.matrix.compose(p.position, p.rotation, this.scale.setScalar(size));
      pool.mesh.setMatrixAt(count, this.matrix); pool.data?.setXY(count, t, p.seed); count++;
    }
    pool.mesh.count = count; pool.mesh.visible = count > 0;
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.data) pool.data.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const delta = Math.min(dt, .05);
    for (const pool of this.pools) {
      if (pool.mesh.count === 0) continue;
      for (const p of pool.particles) {
        if (!p.active) continue;
        p.age += delta;
        if (p.age >= p.life) { p.active = false; continue; }
        const gravity = pool.kind === 'casing' || pool.kind === 'debris' ? 9.81 : 0;
        p.position.addScaledVector(p.velocity, delta); p.position.y -= .5 * gravity * delta * delta;
        p.velocity.y -= gravity * delta;
        if (pool.kind === 'smoke') p.velocity.multiplyScalar(Math.exp(-1.15 * delta));
        if (pool.kind === 'casing' || pool.kind === 'debris') {
          this.angles.set(p.spin.x * delta, p.spin.y * delta, p.spin.z * delta);
          p.rotation.multiply(this.rotation.setFromEuler(this.angles)).normalize();
        }
      }
      this.sync(pool);
    }
  }

  /** Clear a departing match while retaining the fixed geometry/material/instance caches.
   * Safe to repeat. The next match may emit normally using the same scene resources.
   */
  clear(): void {
    if (this.disposed) return;
    for (const pool of this.pools) {
      for (const p of pool.particles) { p.active = false; p.age = 0; }
      pool.cursor = 0; pool.mesh.count = 0; pool.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pool of this.pools) {
      pool.mesh.removeFromParent(); pool.mesh.dispose(); pool.mesh.geometry.dispose();
      (pool.mesh.material as T.Material).dispose();
      pool.mesh.count = 0; pool.mesh.visible = false;
      for (const p of pool.particles) p.active = false;
    }
  }
}
