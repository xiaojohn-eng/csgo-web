/** The original shell casings the weapons eject on every shot.
 *
 * `items_game.txt` gives every weapon an `eject_brass_effect`, and each of the three systems
 * it names ships in `particles/weapons/cs_weapon_fx.pcf` with its own model, gravity, drag,
 * lifetime, spin rates, spawn velocity and collision response. This draws that, instead of
 * the invented brass case the port used before.
 *
 * The motion is the original's own measured update, not an integration that resembles it:
 * the `Movement Basic` apply method was executed in the shipped client and reads
 * `newPosition = position + dragFactor * (position - previous) + gravity * dt * dt` with
 * `dragFactor = (1 - max(drag, 0)) ** (30 * dt) * (dt / tickInterval)`. Applying it at the
 * original's own 1/30 s tick reproduces it exactly, so this steps at 1/30 s.
 *
 * The three casing models are authored in millimetres while Source's unit is the inch; the
 * table states that conversion and the evidence for it, and this applies it rather than
 * hiding it.
 *
 * What is NOT reproduced: the emitter attachment is the weapon's own shell-eject bone (the
 * PCF names the velocity as local to the emitter but not the attachment), the fallback
 * definitions are not drawn at distance, and `Alpha Fade Out Random` ships with every field
 * at this build's default of zero, so no fade is applied.
 */
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sourceSha256 } from './source-sha256';
import table from './source-shell-casings.json';
import resources from './source-shell-resources.json';
import type { WeaponId } from './types';

type ShellSystem = {
  model: string; modelUrl: string; textureUrl: string; material: string; maxParticles: number;
  systemRadiusUnits: number; maxDrawDistanceUnits: number; gravityUnitsPerSecondSquared: number[];
  drag: number; lifetimeSeconds: number[]; spinRollDegreesPerSecond: number; spinRollStopSeconds: number;
  spinYawDegreesPerSecond: number; spinYawStopSeconds: number;
  spawnVelocityLocalUnitsPerSecondMin: number[]; spawnVelocityLocalUnitsPerSecondMax: number[];
  spawnRadiusUnits: number; emitCount: number;
  collision: { group: string; brushOnly: boolean; bounce: number; slide: number };
  fallbackSpriteRadiusUnits: number;
};
export type SourceShellTable = {
  format: string; build: number; modelUnitsToSourceUnits: number; modelUnitsToMetres: number;
  sourceUnitsToMetres: number;
  modelUnitBasis: { authoredIn: string; evidence: string[]; boundary: string };
  systems: Record<string, ShellSystem>;
  weapons: Record<string, string>;
  limitations: string[];
};
export type ShellSpawnOutcome = {
  spawned: boolean; reason: 'spawned' | 'no-system' | 'unusable-attachment' | 'pool-full';
  system: string | null; model: string | null;
  position: [number, number, number] | null;
  velocityMetresPerSecond: [number, number, number] | null;
  speedMetresPerSecond: number | null;
  age: number; travelledMetres: number; bounces: number; modelScale: number;
};
/** Where a casing's own step met the level, and the surface it met. */
export type ShellTraceHit = { x: number; y: number; z: number; nx: number; ny: number; nz: number };
/** The level's own answer for a segment, which is what `Collision via traces` asks for. */
export type ShellTrace = (from: [number, number, number], to: [number, number, number]) => ShellTraceHit | null;
export type SourceShellCasings = {
  group: T.Group;
  table: SourceShellTable;
  /** One casing, at the weapon's own shell-eject attachment. The three draws come from the
   * shot's identity so every client that receives one shot ejects the same casing. */
  spawn(weapon: WeaponId, attachment: T.Matrix4, draws: [number, number, number]): ShellSpawnOutcome;
  /** Steps the flight, answering any surface a casing meets with the system's own bounce and
   * slide. The trace is the level's own, so walls count as much as the ground. */
  update(deltaSeconds: number, trace: ShellTrace | null): void;
  audit(): {
    source: string; tableBuild: number;
    unitScale: { modelUnitsToSourceUnits: number; modelUnitsToMetres: number; sourceUnitsToMetres: number;
      authoredIn: string };
    models: Record<string, { url: string; bytes: number; sha256: string; verified: boolean;
      spanModelUnits: number[]; longestSpanModelUnits: number; sizeMetres: number[]; longestSizeMetres: number }>;
    drawn: Record<string, { spanModelUnits: number[]; spanMetres: number[]; triangles: number }>;
    texture: { url: string; bytes: number; sha256: string; verified: boolean };
    systems: Record<string, { maxParticles: number; lifetimeSeconds: number[]; gravityUnitsPerSecondSquared: number[];
      drag: number; spawnVelocityLocalUnitsPerSecond: number[][]; spinRollDegreesPerSecond: number;
      spinRollStopSeconds: number; spawnRadiusUnits: number; fallbackSpriteRadiusUnits: number;
      collision: ShellSystem['collision'] }>;
    spawned: number; refused: Record<string, number>; live: number; landed: number; surfaceHits: number;
    liveCasings: { system: string; model: string; age: number; travelledMetres: number; bounces: number;
      resting: boolean; position: [number, number, number] }[];
    lastSpawn: ShellSpawnOutcome | null;
    limitations: string[];
  };
  dispose(): void;
};
type ShellAudit = ReturnType<SourceShellCasings['audit']>;

const TICK_SECONDS = 1 / 30;
const DEGREES = Math.PI / 180;
const raw = table as unknown as SourceShellTable;
const receipts = resources as unknown as { kind: string; name: string; path: string; bytes: number; sha256: string }[];

/** Validates the staged table; a system no weapon names, an inverted range or a negative
 * response is refused rather than clamped. */
function loadTable(expected: { build: number }): SourceShellTable {
  if (raw.format !== 'source-shell-casings-v1') throw Error('Unsupported original shell casing table');
  if (raw.build !== expected.build) throw Error('Original shell casing table build differs');
  if (!(raw.modelUnitsToMetres > 0) || !(raw.modelUnitsToSourceUnits > 0) || !(raw.sourceUnitsToMetres > 0))
    throw Error('Original shell casing table has no unit scale');
  const named = new Set(Object.values(raw.weapons ?? {}));
  for (const [name, row] of Object.entries(raw.systems ?? {})) {
    if (!named.has(name)) throw Error('Original shell casing system is named by no weapon: ' + name);
    if (!Number.isInteger(row.maxParticles) || !(row.maxParticles > 0))
      throw Error('Original shell casing system has no particle budget: ' + name);
    if (row.emitCount < 1) throw Error('Original shell casing system emits nothing: ' + name);
    for (const axis of [0, 1, 2]) {
      if (row.spawnVelocityLocalUnitsPerSecondMin.length !== 3 || row.spawnVelocityLocalUnitsPerSecondMax.length !== 3 ||
        row.spawnVelocityLocalUnitsPerSecondMin[axis] > row.spawnVelocityLocalUnitsPerSecondMax[axis])
        throw Error('Original shell casing spawn velocity range is invalid: ' + name);
    }
    if (!(row.lifetimeSeconds[1] > 0) || row.lifetimeSeconds[0] > row.lifetimeSeconds[1])
      throw Error('Original shell casing lifetime is not a range: ' + name);
    if (!(row.collision.bounce >= 0) || !(row.collision.slide >= 0))
      throw Error('Original shell casing collision response is negative: ' + name);
  }
  return raw;
}

type Live = {
  holder: T.Object3D; system: ShellSystem; name: string;
  position: T.Vector3; previous: T.Vector3; origin: T.Vector3; base: T.Quaternion;
  roll: number; yaw: number; rollRate: number; yawRate: number;
  age: number; life: number; bounces: number; resting: boolean;
};

const rollAxis = new T.Vector3(0, 0, 1);
const yawAxis = new T.Vector3(1, 0, 0);

/** The scale a casing model is drawn at. The GLB carries the original geometry in the model's
 * own units and no node in it scales, so the conversion has to be applied here. */
const nodeScaleFor = (table: SourceShellTable) => table.modelUnitsToMetres;

/** The attachment's rotation alone.
 *
 * The viewmodel carries the model's own inch-to-metre scale, so the attachment's basis is not
 * orthonormal; a rotation matrix read straight from it would fold that scale into the
 * quaternion and into whatever it is applied to. Normalising the three axes first leaves the
 * rotation the operator's own local frame actually has. */
function attachmentRotation(attachment: T.Matrix4): T.Quaternion {
  const m = new T.Matrix4().copy(attachment);
  const e = m.elements;
  for (const column of [0, 1, 2]) {
    const x = e[column * 4], y = e[column * 4 + 1], z = e[column * 4 + 2];
    const length = Math.hypot(x, y, z);
    if (!(length > 0)) throw Error('Original shell casing attachment has a degenerate basis');
    e[column * 4] = x / length;
    e[column * 4 + 1] = y / length;
    e[column * 4 + 2] = z / length;
  }
  return new T.Quaternion().setFromRotationMatrix(m);
}

/** `Collision via traces`' own answer to meeting a surface: the part of the travel that met it
 * is turned back and damped by `amount of bounce`, and the part that ran along it keeps
 * `amount of slide`. With `bounce` at one the normal part is returned whole, which is why the
 * sign turns and not just the length. */
export function shellCollisionTravel(travel: T.Vector3, normal: T.Vector3, bounce: number, slide: number): T.Vector3 {
  const along = travel.dot(normal);
  return travel.clone().addScaledVector(normal, -along).multiplyScalar(slide)
    .addScaledVector(normal, -along * bounce);
}

export async function loadSourceShellCasings(options: { build: number; signal?: AbortSignal }): Promise<SourceShellCasings> {
  const mode = loadTable({ build: options.build });
  const { signal } = options;
  signal?.throwIfAborted();

  const loader = new GLTFLoader();
  const scenes = new Map<string, T.Group>();
  const owned: (() => void)[] = [];
  const models: ShellAudit['models'] = {};
  const textureReceipt = receipts.find(row => row.kind === 'texture');
  if (!textureReceipt) throw Error('Original shell texture is not staged');

  // Every staged byte is checked against the receipt it ships with before it is used.
  const fetchVerified = async (row: { path: string; bytes: number; sha256: string }) => {
    const response = await fetch('/source/csgo-12426148/shells/' + row.path, { cache: 'no-cache', signal });
    if (!response.ok) throw Error(`Original shell asset HTTP ${response.status}: ${row.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== row.bytes || await sourceSha256(bytes, signal) !== row.sha256)
      throw Error('Original shell asset differs from its receipt: ' + row.path);
    return bytes;
  };

  let texture: T.Texture;
  try {
    const png = await fetchVerified(textureReceipt);
    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    texture = await new T.TextureLoader().loadAsync(url);
    texture.colorSpace = T.SRGBColorSpace;
    owned.push(() => { URL.revokeObjectURL(url); texture.dispose(); });
    for (const [name, system] of Object.entries(mode.systems)) {
      // The system is named `weapon_shell_casing_*` while the model it draws is `shell_*`, so
      // the receipt is found by the model the system names, not by the system's own key.
      const receipt = receipts.find(row => row.kind === 'model' && row.name === system.model);
      if (!receipt) throw Error('Original shell model is not staged: ' + system.model + ' for ' + name);
      const bytes = await fetchVerified(receipt);
      const gltf = await loader.parseAsync(bytes.buffer as ArrayBuffer, '');
      const root = new T.Group();
      root.name = `${name}-${system.model}`;
      root.add(gltf.scene);
      // The model's own size is measured from the geometry the browser will draw, so the unit
      // conversion is checked against a real cartridge rather than assumed.
      const bounds = new T.Box3();
      gltf.scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        object.geometry.computeBoundingBox();
        if (object.geometry.boundingBox) bounds.union(object.geometry.boundingBox);
      });
      const span = bounds.getSize(new T.Vector3());
      const sizeMetres = span.clone().multiplyScalar(nodeScaleFor(mode));
      scenes.set(name, root);
      models[name] = { url: receipt.path, bytes: receipt.bytes, sha256: receipt.sha256, verified: true,
        spanModelUnits: [span.x, span.y, span.z],
        longestSpanModelUnits: Math.max(span.x, span.y, span.z),
        sizeMetres: [sizeMetres.x, sizeMetres.y, sizeMetres.z],
        longestSizeMetres: Math.max(sizeMetres.x, sizeMetres.y, sizeMetres.z) };
    }
  } catch (error) {
    for (const dispose of owned) dispose();
    throw error;
  }

  const group = new T.Group();
  group.name = 'SourceShellCasings12426148';
  const pools = new Map<string, { free: T.Object3D[]; materials: T.Material[]; geometries: T.BufferGeometry[] }>();
  const drawn: ShellAudit['drawn'] = {};
  for (const [name, system] of Object.entries(mode.systems)) {
    const source = scenes.get(name)!;
    // One material per system, shared by every casing of it: the shipped VMT's own brass
    // parameters (`$envmaptint` and the `$phong*` set) and the shipped texture.
    const material = new T.MeshStandardMaterial({ map: texture, color: new T.Color(0.25 * 3, 0.19 * 3, 0.07 * 3),
      metalness: 0.85, roughness: 0.35, envMapIntensity: 0.6 });
    material.name = system.material;
    const geometries: T.BufferGeometry[] = [];
    const found: T.Mesh[] = [];
    source.traverse(object => { if (object instanceof T.Mesh) found.push(object); });
    if (!found.length) throw Error('Original shell model has no mesh: ' + name);
    for (const mesh of found) geometries.push(mesh.geometry);
    const built: T.Object3D[] = [];
    const scale = nodeScaleFor(mode);
    for (let index = 0; index < system.maxParticles; index++) {
      // The holder is a transform only. Giving it the geometry as well would draw the model at
      // its raw model units (tens of metres) on top of the scaled copy.
      const holder = new T.Object3D();
      const clone = source.clone(true);
      clone.traverse(object => { if (object instanceof T.Mesh) object.material = material; });
      // The model is authored with its own long axis on Y and the original's on Z; the
      // measurement of both is what fixes this quarter turn.
      clone.rotation.x = Math.PI / 2;
      clone.scale.setScalar(scale);
      holder.add(clone);
      holder.visible = false;
      holder.frustumCulled = false;
      group.add(holder);
      built.push(holder);
    }
    // What one casing actually occupies in the world once built, measured rather than assumed,
    // and the triangle count of the model it draws, so a frame can be checked for it.
    const spanMetres = new T.Box3().setFromObject(built[0]).getSize(new T.Vector3());
    drawn[name] = { spanModelUnits: spanMetres.clone().divideScalar(scale).toArray(),
      spanMetres: spanMetres.toArray(),
      triangles: geometries.reduce((sum, geometry) => sum
        + (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3, 0) };
    pools.set(name, { free: [...built], materials: [material], geometries });
    owned.push(() => { for (const holder of built) holder.removeFromParent(); material.dispose(); });
  }
  signal?.throwIfAborted();

  const live: Live[] = [];
  const refused: Record<string, number> = {};
  let spawned = 0;
  let landed = 0;
  let surfaceHits = 0;
  let disposed = false;
  let accumulator = 0;
  let lastSpawn: ShellSpawnOutcome | null = null;

  const refuse = (reason: ShellSpawnOutcome['reason'], system: string | null): ShellSpawnOutcome => {
    refused[reason] = (refused[reason] ?? 0) + 1;
    return { spawned: false, reason, system, model: null, position: null, velocityMetresPerSecond: null,
      speedMetresPerSecond: null, age: 0, travelledMetres: 0, bounces: 0, modelScale: mode.modelUnitsToMetres };
  };

  function spawn(weapon: WeaponId, attachment: T.Matrix4, draws: [number, number, number]): ShellSpawnOutcome {
    if (disposed) throw Error('Original shell casing system is disposed');
    const name = mode.weapons?.[weapon];
    const system = name ? mode.systems[name] : undefined;
    if (!name || !system) return refuse('no-system', null);
    const pool = pools.get(name)!;
    const position = new T.Vector3().setFromMatrixPosition(attachment);
    if (!Number.isFinite(position.x + position.y + position.z) || attachment.determinant() === 0)
      return refuse('unusable-attachment', name);
    const holder = pool.free.shift();
    if (!holder) return refuse('pool-full', name);
    // The shot's own draws drive the three random choices the systems make: the spawn speed
    // inside the operator's own range, the spawn offset inside its own radius, and the
    // initial rotation.
    let state = (Math.imul(Math.floor(draws[0] * 1e6) ^ 0x9e3779b9, 0x01000193)
      ^ Math.imul(Math.floor(draws[1] * 1e6) + 0x85ebca6b, 0x2545f491)
      ^ Math.imul(Math.floor(draws[2] * 1e6) ^ 0xc2b2ae35, 0x27d4eb2f)) >>> 0;
    const unit = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const sourceUnitsToMetres = mode.sourceUnitsToMetres;
    const velocity = new T.Vector3();
    for (const axis of [0, 1, 2] as const) {
      const low = system.spawnVelocityLocalUnitsPerSecondMin[axis];
      const high = system.spawnVelocityLocalUnitsPerSecondMax[axis];
      const value = (low + (high - low) * unit()) * sourceUnitsToMetres;
      if (axis === 0) velocity.x = value;
      else if (axis === 1) velocity.y = value;
      else velocity.z = value;
    }
    // `Position Within Sphere Random` states its speed in the emitter's own local frame, and
    // the attachment's bone already carries the model's own Source-to-world conversion. Running
    // the components through that swap a second time would put them in the wrong axes: measured
    // at the AK's own shell-eject bone, the operator's +x is right-and-up (0.92 right, 0.39 up)
    // and its +z is forward, so the swap would aim every casing flat sideways with no rise at
    // all. The components are therefore applied to the emitter's own axes as they stand.
    const rotation = attachmentRotation(attachment);
    const worldVelocity = new T.Vector3(velocity.x, velocity.y, velocity.z).applyQuaternion(rotation);
    const localOffset = new T.Vector3(unit() * 2 - 1, unit() * 2 - 1, unit() * 2 - 1)
      .multiplyScalar(system.spawnRadiusUnits).multiplyScalar(sourceUnitsToMetres);
    position.add(localOffset.applyQuaternion(rotation));
    const initial = new T.Quaternion().setFromEuler(new T.Euler(unit() * Math.PI * 2, unit() * Math.PI * 2, unit() * Math.PI * 2));
    const base = rotation.clone().multiply(initial);
    const lifetime = system.lifetimeSeconds[0] + (system.lifetimeSeconds[1] - system.lifetimeSeconds[0]) * unit();
    const entry: Live = { holder, system, name, position: position.clone(),
      previous: position.clone().addScaledVector(worldVelocity, -TICK_SECONDS), origin: position.clone(),
      base, roll: unit() * Math.PI * 2, yaw: unit() * Math.PI * 2,
      rollRate: system.spinRollDegreesPerSecond * DEGREES, yawRate: system.spinYawDegreesPerSecond * DEGREES,
      age: 0, life: Math.max(TICK_SECONDS, lifetime), bounces: 0, resting: false };
    holder.visible = true;
    holder.position.copy(entry.position);
    layout(entry);
    live.push(entry);
    spawned++;
    lastSpawn = { spawned: true, reason: 'spawned', system: name, model: system.model,
      position: [entry.position.x, entry.position.y, entry.position.z],
      velocityMetresPerSecond: [worldVelocity.x, worldVelocity.y, worldVelocity.z],
      speedMetresPerSecond: worldVelocity.length(), age: 0, travelledMetres: 0, bounces: 0,
      modelScale: mode.modelUnitsToMetres };
    return lastSpawn;
  }

  function layout(entry: Live) {
    entry.holder.position.copy(entry.position);
    entry.holder.quaternion.copy(entry.base)
      .multiply(new T.Quaternion().setFromAxisAngle(rollAxis, entry.roll))
      .multiply(new T.Quaternion().setFromAxisAngle(yawAxis, entry.yaw));
  }

  /** One original tick of `Movement Basic`, `Rotation Spin Roll`/`Yaw` and the collision the
   * system's own `Collision via traces` asks for.
   *
   * The trace is the level's own: the operator collides with brushes, not just a floor, so a
   * casing that meets a wall answers with the wall's normal exactly as it does with the ground.
   * The response is the operator's own two numbers, the normal component coming back at
   * `amount of bounce` and the tangential part keeping `amount of slide`. */
  function tick(entry: Live, trace: ShellTrace | null) {
    const { system } = entry;
    entry.age += TICK_SECONDS;
    const dragFactor = Math.pow(1 - Math.max(system.drag, 0), 30 * TICK_SECONDS);
    // Gravity is the system's own world-space value in Source units along Source's up, so it
    // maps onto the port's world the same way any other Source vector does.
    const gravityStep = new T.Vector3(system.gravityUnitsPerSecondSquared[0],
      system.gravityUnitsPerSecondSquared[1], system.gravityUnitsPerSecondSquared[2])
      .multiplyScalar(mode.sourceUnitsToMetres * TICK_SECONDS * TICK_SECONDS);
    gravityStep.set(gravityStep.x, gravityStep.z, -gravityStep.y);
    let travel = new T.Vector3().subVectors(entry.position, entry.previous)
      .multiplyScalar(dragFactor).add(gravityStep);
    let next = entry.position.clone().add(travel);
    const hit = trace ? trace([entry.position.x, entry.position.y, entry.position.z],
      [next.x, next.y, next.z]) : null;
    const normal = hit ? new T.Vector3(hit.nx, hit.ny, hit.nz) : null;
    if (hit && normal && normal.lengthSq() > 0) {
      normal.normalize();
      // Reflect: the part that met the surface comes back at `amount of bounce`, the part
      // that ran along it keeps `amount of slide`.
      travel = shellCollisionTravel(travel, normal, system.collision.bounce, system.collision.slide);
      // The hit point is on the surface, so the next step starts just clear of it.
      next = new T.Vector3(hit.x, hit.y, hit.z).addScaledVector(normal, 1e-4);
      if (entry.bounces === 0) landed++;
      entry.bounces++;
      surfaceHits++;
      // `previous` is what the next tick's `Movement Basic` step measures from, so it is set
      // to what makes that step come out as the reflected travel.
      entry.previous.copy(next).addScaledVector(travel.clone().sub(gravityStep).divideScalar(dragFactor), -1);
    } else {
      entry.previous.copy(entry.position);
    }
    entry.position.copy(next);
    // The original has no resting state: a casing is simulated until its own 0.8 s lifetime
    // ends, so nothing here freezes one early. `resting` is only a read-out, derived from the
    // casing having all but stopped rather than from a state the original has.
    entry.resting = entry.bounces > 0 &&
      Math.hypot(next.x - entry.previous.x, next.z - entry.previous.z) < 1e-3;
    // `Rotation Spin Roll` stops at its own `spin_stop_time`; yaw keeps its rate.
    if (entry.age < system.spinRollStopSeconds) entry.roll += entry.rollRate * TICK_SECONDS;
    entry.yaw += entry.yawRate * TICK_SECONDS;
    layout(entry);
  }

  function update(deltaSeconds: number, trace: ShellTrace | null) {
    if (disposed || !live.length || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    accumulator = Math.min(accumulator + deltaSeconds, TICK_SECONDS * 8);
    while (accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      for (let index = live.length - 1; index >= 0; index--) {
        const entry = live[index];
        if (entry.age + TICK_SECONDS >= entry.life) {
          entry.holder.visible = false;
          entry.holder.removeFromParent();
          entry.holder.position.set(0, 0, 0);
          group.add(entry.holder);
          pools.get(entry.name)!.free.push(entry.holder);
          live.splice(index, 1);
          continue;
        }
        tick(entry, trace);
      }
    }
  }

  return {
    group, table: mode, spawn, update,
    audit: () => ({
      source: 'source-shell-casings-runtime-v1', tableBuild: mode.build,
      unitScale: { modelUnitsToSourceUnits: mode.modelUnitsToSourceUnits,
        modelUnitsToMetres: mode.modelUnitsToMetres, sourceUnitsToMetres: mode.sourceUnitsToMetres,
        authoredIn: mode.modelUnitBasis.authoredIn },
      models, drawn,
      texture: { url: textureReceipt.path, bytes: textureReceipt.bytes, sha256: textureReceipt.sha256, verified: true },
      systems: Object.fromEntries(Object.entries(mode.systems).map(([name, row]) => [name, {
        maxParticles: row.maxParticles, lifetimeSeconds: row.lifetimeSeconds,
        gravityUnitsPerSecondSquared: row.gravityUnitsPerSecondSquared, drag: row.drag,
        spawnVelocityLocalUnitsPerSecond: [row.spawnVelocityLocalUnitsPerSecondMin, row.spawnVelocityLocalUnitsPerSecondMax],
        spinRollDegreesPerSecond: row.spinRollDegreesPerSecond, spinRollStopSeconds: row.spinRollStopSeconds,
        spawnRadiusUnits: row.spawnRadiusUnits, fallbackSpriteRadiusUnits: row.fallbackSpriteRadiusUnits,
        collision: row.collision }])),
      spawned, refused: { ...refused }, live: live.length, landed, surfaceHits,
      liveCasings: live.map(entry => ({ system: entry.name, model: entry.system.model, age: +entry.age.toFixed(3),
        travelledMetres: +entry.position.distanceTo(entry.origin).toFixed(4), bounces: entry.bounces,
        resting: entry.resting, position: [entry.position.x, entry.position.y, entry.position.z] })),
      lastSpawn,
      limitations: mode.limitations,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      live.length = 0;
      for (const dispose of owned) dispose();
      owned.length = 0;
      group.removeFromParent();
      pools.clear();
    },
  };
}
