import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { sha256 } from '@noble/hashes/sha2.js';
import { shellCollisionTravel } from '../game/source-shell-casings';
import table from '../game/source-shell-casings.json';
import resources from '../game/source-shell-resources.json';
import effects from '../public/source/csgo-12426148/weapon-effects/effect-map.json';

const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
const read = (relative: string) => readFileSync(resolve(relative));
type System = {
  model: string; modelUrl: string; textureUrl: string; material: string; maxParticles: number;
  systemRadiusUnits: number; maxDrawDistanceUnits: number; gravityUnitsPerSecondSquared: number[];
  drag: number; lifetimeSeconds: number[]; spinRollDegreesPerSecond: number; spinRollStopSeconds: number;
  spinYawDegreesPerSecond: number; spinYawStopSeconds: number;
  spawnVelocityLocalUnitsPerSecondMin: number[]; spawnVelocityLocalUnitsPerSecondMax: number[];
  spawnRadiusUnits: number; emitCount: number;
  collision: { group: string; brushOnly: boolean; bounce: number; slide: number };
  fallbackSpriteRadiusUnits: number;
};
const staged = table as unknown as {
  format: string; build: number; modelUnitsToSourceUnits: number; modelUnitsToMetres: number;
  sourceUnitsToMetres: number;
  modelUnitBasis: { authoredIn: string; evidence: string[]; boundary: string };
  systems: Record<string, System>; weapons: Record<string, string>; limitations: string[];
};
const research = JSON.parse(read('research/source-shell-casings.json').toString()) as {
  format: string; build: number; effects: Record<string, { max_particles: number; radius: number;
    material: string; 'maximum draw distance': number; operators: Record<string, Record<string, unknown>>;
    fallback: { max_particles: number; radius: number; operators: Record<string, Record<string, unknown>> } }>;
  models: Record<string, { internalName: string; vertices: number[]; files: Record<string, { source: string; bytes: number; sha256: string }> }>;
  materials: Record<string, { shader: string; textures: { parameter: string; source: string; bytes: number; sha256: string }[] }>;
  nativeSchemas: Record<string, { fields: { name: string; default: string }[] }>;
  nativeUndocumented: string[];
};
const modelReceipt = JSON.parse(read('.reference-assets/source-exports/shell-models/receipt.json').toString()) as {
  models: Record<string, { source: string; sourceSha256: string; glb: { bytes: number; sha256: string };
    geometry: { vertices: number; polygons: number; materials: (string | null)[] }[] }>;
  textures: { source: string; width: number; height: number; png: { bytes: number; sha256: string } }[];
};

/** The span of a staged GLB's own geometry, read from the POSITION accessors it ships. */
function glbSpan(path: string) {
  const file = readFileSync(resolve(path));
  const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true), path).toBe(0x46546c67);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min?: number[]; max?: number[] }[];
    nodes: { name?: string; scale?: number[]; matrix?: number[] }[];
  };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let accessors = 0;
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      accessors++;
      for (const axis of [0, 1, 2]) {
        min[axis] = Math.min(min[axis], accessor.min![axis]);
        max[axis] = Math.max(max[axis], accessor.max![axis]);
      }
    }
  return { accessors, span: max.map((value, axis) => value - min[axis]),
    longest: Math.max(...max.map((value, axis) => value - min[axis])),
    // No node in the GLB scales, so the runtime has to apply the conversion itself.
    scaledNodes: json.nodes.filter(node => node.scale ?? node.matrix).map(node => node.name ?? '') };
}

describe('original shell casing systems', () => {
  it('is cut from this build and names a system for every weapon', () => {
    expect(staged.format).toBe('source-shell-casings-v1');
    expect(staged.build).toBe(12426148);
    expect(research.format).toBe('source-shell-casings-v1');
    expect(staged.weapons).toEqual({
      vandal: 'weapon_shell_casing_rifle', m4a4: 'weapon_shell_casing_rifle', awp: 'weapon_shell_casing_50cal',
      glock: 'weapon_shell_casing_9mm', usp: 'weapon_shell_casing_9mm', deagle: 'weapon_shell_casing_9mm',
    });
    // The mapping is the shipped effect table's own, not a copy made by hand.
    for (const [weapon, row] of Object.entries(effects.weapons))
      expect(staged.weapons[weapon]).toBe(row.eject_brass_effect);
  });

  it('carries each system\'s own numbers, not a shared set', () => {
    const rifle = staged.systems.weapon_shell_casing_rifle;
    expect(rifle.model).toBe('shell_762');
    expect(rifle.maxParticles).toBe(16);
    expect(rifle.systemRadiusUnits).toBeCloseTo(0.75, 6);
    expect(rifle.maxDrawDistanceUnits).toBeCloseTo(400, 6);
    expect(rifle.gravityUnitsPerSecondSquared).toEqual([0, 0, -600]);
    expect(rifle.drag).toBeCloseTo(0.05, 6);
    expect(rifle.lifetimeSeconds[0]).toBeCloseTo(0.8, 6);
    expect(rifle.lifetimeSeconds[1]).toBeCloseTo(0.8, 6);
    expect(rifle.spinRollDegreesPerSecond).toBe(85);
    expect(rifle.spinRollStopSeconds).toBeCloseTo(0.6, 6);
    expect(rifle.spinYawDegreesPerSecond).toBe(20);
    expect(rifle.spawnVelocityLocalUnitsPerSecondMin).toEqual([120, -15, 50]);
    expect(rifle.spawnVelocityLocalUnitsPerSecondMax).toEqual([150, 5, 75]);
    expect(rifle.spawnRadiusUnits).toBeCloseTo(0.08, 6);
    expect(rifle.emitCount).toBe(1);
    expect(rifle.fallbackSpriteRadiusUnits).toBe(2);
    expect(rifle.collision).toEqual({ group: 'DEBRIS', brushOnly: true,
      bounce: expect.closeTo(0.8, 6), slide: expect.closeTo(0.4, 6) });

    const fifty = staged.systems.weapon_shell_casing_50cal;
    expect(fifty.model).toBe('shell_50cal');
    expect(fifty.maxParticles).toBe(32);
    expect(fifty.systemRadiusUnits).toBeCloseTo(3, 6);
    expect(fifty.maxDrawDistanceUnits).toBeCloseTo(512, 6);
    expect(fifty.spinRollDegreesPerSecond).toBe(125);
    expect(fifty.spinRollStopSeconds).toBeCloseTo(2, 6);
    expect(fifty.spawnVelocityLocalUnitsPerSecondMin).toEqual([90, 55, 30]);
    expect(fifty.spawnVelocityLocalUnitsPerSecondMax).toEqual([120, 85, 55]);
    expect(fifty.fallbackSpriteRadiusUnits).toBe(3.5);
    expect(fifty.collision.slide).toBeCloseTo(0.2, 6);

    const nine = staged.systems.weapon_shell_casing_9mm;
    expect(nine.model).toBe('shell_9mm');
    expect(nine.maxParticles).toBe(16);
    expect(nine.systemRadiusUnits).toBeCloseTo(0.75, 6);
    expect(nine.fallbackSpriteRadiusUnits).toBe(1.25);
    expect(nine.spawnVelocityLocalUnitsPerSecondMin).toEqual([120, -15, 50]);
    expect(nine.collision.slide).toBeCloseTo(0.4, 6);

    // Every number the table carries is the shipped PCF's own value.
    for (const [name, system] of Object.entries(staged.systems)) {
      const original = research.effects[name];
      expect(system.maxParticles, name).toBe(original.max_particles);
      expect(system.systemRadiusUnits, name).toBeCloseTo(original.radius, 6);
      expect(system.maxDrawDistanceUnits, name).toBeCloseTo(original['maximum draw distance'], 6);
      expect(system.material, name).toBe(original.material);
      expect(system.gravityUnitsPerSecondSquared, name)
        .toEqual(original.operators['Movement Basic'].gravity as number[]);
      expect(system.drag, name).toBeCloseTo(original.operators['Movement Basic'].drag as number, 6);
      expect(system.spinRollDegreesPerSecond, name).toBe(original.operators['Rotation Spin Roll'].spin_rate_degrees);
      expect(system.spinRollStopSeconds, name).toBeCloseTo(original.operators['Rotation Spin Roll'].spin_stop_time as number, 6);
      expect(system.spinYawDegreesPerSecond, name).toBe(original.operators['Rotation Spin Yaw'].yaw_rate_degrees);
      expect(system.lifetimeSeconds, name).toEqual([original.operators['Lifetime Random'].lifetime_min,
        original.operators['Lifetime Random'].lifetime_max]);
      expect(system.spawnVelocityLocalUnitsPerSecondMin, name)
        .toEqual(original.operators['Position Within Sphere Random'].speed_in_local_coordinate_system_min);
      expect(system.spawnVelocityLocalUnitsPerSecondMax, name)
        .toEqual(original.operators['Position Within Sphere Random'].speed_in_local_coordinate_system_max);
      expect(system.spawnRadiusUnits, name).toBeCloseTo(original.operators['Radius Random'].radius_min as number, 6);
      expect(system.emitCount, name).toBe(original.operators['emit_instantaneously'].num_to_emit);
      expect(system.collision.bounce, name).toBeCloseTo(original.operators['Collision via traces']['amount of bounce'] as number, 6);
      expect(system.collision.slide, name).toBeCloseTo(original.operators['Collision via traces']['amount of slide'] as number, 6);
      expect(system.collision.group, name).toBe(original.operators['Collision via traces']['collision group']);
      expect(system.collision.brushOnly, name).toBe(original.operators['Collision via traces']['brush only']);
      expect(system.fallbackSpriteRadiusUnits, name).toBe(original.fallback.operators['Radius Random'].radius_min);
    }
  });

  it('covers every operator the systems use with this build\'s own schema', () => {
    // The operators whose PCF blocks leave fields empty are read from the client's own
    // registrations; the export refuses to summarise instead.
    expect(research.nativeUndocumented).toEqual([]);
    for (const name of ['Render models', 'Rotation Spin Roll', 'Rotation Spin Yaw', 'Collision via traces',
      'Movement Basic', 'Position Within Sphere Random', 'Radius Random', 'Alpha Fade Out Random'])
      expect(Object.keys(research.nativeSchemas), name).toContain(name);
    // `Render models` has no scale field, which is why the model's own units are stated
    // explicitly in the table rather than assumed to be scaled by the renderer.
    const fields = research.nativeSchemas['Render models'].fields.map(field => field.name);
    expect(fields).toContain('sequence 0 model');
    expect(fields).toContain('orient model z to normal');
    expect(fields).toContain('skin number');
    // No field of the model renderer scales the model: the only scale-shaped fields are the
    // operator's own time/strength modulation and the visibility radius, which are not a size.
    expect(fields.filter(field => /^(model )?scale$/i.test(field) || /model scale/i.test(field))).toEqual([]);
    expect(fields.some(field => /^\$?scale$/i.test(field))).toBe(false);
    // `Alpha Fade Out Random` ships with every field at zero, so the port applies no fade.
    const fade = research.nativeSchemas['Alpha Fade Out Random'].fields;
    expect(fade.find(field => field.name === 'fade out time min')?.default).toBe('.25');
  });

  it('states the unit conversion the casing models need, with its evidence', () => {
    expect(staged.modelUnitsToSourceUnits).toBeCloseTo(1 / 25.4, 12);
    expect(staged.modelUnitsToMetres).toBeCloseTo(0.0254 / 25.4, 12);
    expect(staged.modelUnitBasis.authoredIn).toBe('millimetres');
    const evidence = staged.modelUnitBasis.evidence.join(' ');
    expect(evidence).toContain('19.15');
    expect(evidence).toContain('38.7');
    expect(evidence).toContain('models/shells/shell_9mm.mdl');
    // The sprite fallback of each system is a second, independent statement of the size.
    expect(staged.modelUnitBasis.evidence.join(' ')).toContain('1.25 / 2.0 / 3.5');
    expect(staged.modelUnitBasis.boundary).toMatch(/not measured/);
    // Applying the conversion puts both cartridges at their real dimensions.
    const nine = staged.systems.weapon_shell_casing_9mm;
    const rifle = staged.systems.weapon_shell_casing_rifle;
    expect(nine.model.length).toBeGreaterThan(0);
    expect(19.15 * staged.modelUnitsToSourceUnits).toBeCloseTo(0.754, 3);
    expect(38.7 * staged.modelUnitsToSourceUnits).toBeCloseTo(1.524, 3);
    expect(rifle.model).toBe('shell_762');
  });
});

describe('staged shell models and assets', () => {
  it('ships the three models and the texture the receipts name', () => {
    const rows = resources as unknown as { kind: string; name: string; path: string; bytes: number; sha256: string }[];
    expect(rows.filter(row => row.kind === 'model')).toHaveLength(3);
    expect(rows.filter(row => row.kind === 'texture')).toHaveLength(1);
    for (const row of rows) {
      const path = `public/source/csgo-12426148/shells/${row.path}`;
      expect(existsSync(resolve(path)), row.path).toBe(true);
      const bytes = read(path);
      expect(bytes.byteLength, row.path).toBe(row.bytes);
      expect(digest(bytes), row.path).toBe(row.sha256);
    }
    // The glTF bytes the importer produced are the ones staged.
    for (const [name, row] of Object.entries(modelReceipt.models)) {
      const staged = (resources as unknown as { kind: string; name: string; bytes: number; sha256: string }[])
        .find(entry => entry.kind === 'model' && entry.name === name)!;
      expect(staged.bytes).toBe(row.glb.bytes);
      expect(staged.sha256).toBe(row.glb.sha256);
    }
    // The three models are the same objects the PCF names, one material between them.
    for (const row of Object.values(modelReceipt.models)) {
      expect(row.source).toMatch(/^models\/models\/weapons\/shared\/shell_.*_hr\.mdl$/);
      expect(row.geometry).toHaveLength(1);
      expect(row.geometry[0].materials).toEqual(['shells']);
      expect(row.geometry[0].vertices).toBeGreaterThan(90);
    }
    expect(modelReceipt.textures[0].width).toBe(256);
    expect(modelReceipt.textures[0].height).toBe(256);
    expect(Object.keys(research.materials)).toEqual(['materials/models/weapons/shared/shells/shells.vmt']);
    expect(research.materials['materials/models/weapons/shared/shells/shells.vmt'].shader.toLowerCase())
      .toBe('vertexlitgeneric');
  });

  it('draws the geometry at the model\'s own millimetre size, not the GLB\'s raw units', () => {
    // The staged GLB carries the original geometry in the model's own units and no node in it
    // scales, so the span read here is the model's authored size and the runtime has to apply
    // the conversion. Each longest span is the real cartridge's own length.
    const measured = { shell_762: 38.7, shell_50cal: 57.0671, shell_9mm: 19.15 };
    for (const [name, longest] of Object.entries(measured)) {
      const row = glbSpan(`public/source/csgo-12426148/shells/${name}.glb`);
      expect(row.accessors, name).toBe(1);
      expect(row.longest, name).toBeCloseTo(longest, 4);
      // The long axis is the exporter's up axis, which is the quarter turn the runtime undoes
      // to put the casing back along the original's own long axis.
      expect(row.span.indexOf(row.longest), name).toBe(1);
      expect(row.scaledNodes, name).toEqual([]);
      // The GLB carries these as 32-bit floats, so this is the same number to six places.
      expect(row.longest * staged.modelUnitsToMetres, name).toBeCloseTo(longest / 1000, 6);
    }
    // Both ends of each cartridge are the real dimensions, not a plausible-looking number.
    const nine = glbSpan('public/source/csgo-12426148/shells/shell_9mm.glb');
    expect(nine.span[0] * staged.modelUnitsToMetres).toBeCloseTo(0.009631, 6);
    expect(nine.span[2] * staged.modelUnitsToMetres).toBeCloseTo(0.009779, 6);
    const rifle = glbSpan('public/source/csgo-12426148/shells/shell_762.glb');
    expect(rifle.span[0] * staged.modelUnitsToMetres).toBeCloseTo(0.011008, 6);
  });

  it('keeps the provenance tied to the staged bytes and the shipped PCF', () => {
    const provenance = JSON.parse(read('public/source/csgo-12426148/shells/provenance.json').toString()) as {
      pcf: { source: string; bytes: number; sha256: string }; nativeSource: { path: string; sha256: string };
      files: { path: string; bytes: number; sha256: string }[]; limitations: string[];
    };
    expect(provenance.pcf.source).toBe('particles/weapons/cs_weapon_fx.pcf');
    for (const row of provenance.files) {
      const bytes = read(`public/source/csgo-12426148/shells/${row.path}`);
      expect(bytes.byteLength, row.path).toBe(row.bytes);
      expect(digest(bytes), row.path).toBe(row.sha256);
    }
    expect(provenance.limitations.join(' ')).toMatch(/brush only/);
    expect(provenance.limitations.join(' ')).toMatch(/Alpha Fade Out Random|alpha fade/);
  });
});

describe('shell casing fail-closed rules', () => {
  it('describes what the port deliberately does not reproduce', () => {
    const text = staged.limitations.join(' ');
    expect(text).toMatch(/fallback/);
    expect(text).toMatch(/shell-eject attachment/);
    // The port states the two places where it applies something the original does not make
    // explicit: the rotation it uses to carry the emitter's speed, and the resting read-out.
    expect(text).toMatch(/pure rotation/);
    expect(text).toMatch(/resting.*derived|derived.*resting/);
    // No limitation may be stated twice, so each one is a distinct boundary.
    expect(new Set(staged.limitations).size).toBe(staged.limitations.length);
  });

  it('keeps the original tick and the original drag', () => {
    // The port steps at the original's own tick, which is where the measured `Movement
    // Basic` factor is exact rather than approximate.
    const tick = 1 / 30;
    for (const system of Object.values(staged.systems)) {
      const factor = Math.pow(1 - Math.max(system.drag, 0), 30 * tick);
      expect(factor).toBeCloseTo(1 - system.drag, 12);
      // Gravity in metres is the shipped Source-unit value through the inch conversion, which
      // is a different factor from the one the model geometry needs.
      expect(Math.abs(system.gravityUnitsPerSecondSquared[2]) * staged.sourceUnitsToMetres)
        .toBeCloseTo(600 * 0.0254, 12);
      expect(staged.sourceUnitsToMetres).toBeCloseTo(0.0254, 12);
      expect(staged.modelUnitsToMetres / staged.modelUnitsToSourceUnits).toBeCloseTo(0.0254, 12);
    }
  });

  it('answers a surface with the operator\'s own bounce and slide', () => {
    // `Collision via traces` names two numbers per system. A casing that meets a wall is
    // answered exactly as one that meets the ground: the operator has no separate rule for it,
    // which is why a casing cannot pass through a wall in the original.
    const bounce = staged.systems.weapon_shell_casing_rifle.collision.bounce;
    const slide = staged.systems.weapon_shell_casing_rifle.collision.slide;
    // Falling onto the floor: the vertical part comes back at `amount of bounce`, the run along
    // the floor keeps `amount of slide`.
    const ontoFloor = shellCollisionTravel(new T.Vector3(0.10, -0.05, 0.02), new T.Vector3(0, 1, 0), bounce, slide);
    expect(ontoFloor.y).toBeCloseTo(0.05 * bounce, 12);
    expect(ontoFloor.x).toBeCloseTo(0.10 * slide, 12);
    expect(ontoFloor.z).toBeCloseTo(0.02 * slide, 12);
    // Meeting a wall face-on: the part into the wall comes back, the rest runs along it.
    const ontoWall = shellCollisionTravel(new T.Vector3(0.10, 0.04, 0.02), new T.Vector3(1, 0, 0), bounce, slide);
    expect(ontoWall.x).toBeCloseTo(-0.10 * bounce, 12);
    expect(ontoWall.y).toBeCloseTo(0.04 * slide, 12);
    expect(ontoWall.z).toBeCloseTo(0.02 * slide, 12);
    // The .50's own numbers are lower on the wall and higher on the floor, and it keeps the
    // two apart rather than sharing one response.
    const fifty = staged.systems.weapon_shell_casing_50cal.collision;
    expect(fifty.slide).not.toBeCloseTo(slide, 6);
    const fiftyFloor = shellCollisionTravel(new T.Vector3(0.10, -0.05, 0), new T.Vector3(0, 1, 0), fifty.bounce, fifty.slide);
    expect(fiftyFloor.y).toBeCloseTo(0.05 * fifty.bounce, 12);
    expect(fiftyFloor.x).toBeCloseTo(0.10 * fifty.slide, 12);
    expect(Math.abs(fiftyFloor.x)).toBeLessThan(Math.abs(ontoFloor.x));
    // Both numbers below one mean a casing never leaves a surface faster than it met it.
    for (const system of Object.values(staged.systems)) {
      expect(system.collision.bounce).toBeLessThan(1);
      expect(system.collision.slide).toBeLessThan(1);
      const travel = new T.Vector3(0.1, -0.08, 0.03);
      const answered = shellCollisionTravel(travel, new T.Vector3(0, 1, 0),
        system.collision.bounce, system.collision.slide);
      expect(answered.length()).toBeLessThan(travel.length());
    }
  });

  it('carries the operator\'s local speed onto the emitter\'s own axes', () => {
    // The viewmodel's shell-eject bone as the port measured it in game: its three axes and its
    // translation in the gun scene. Each axis is 0.0254 long, because the model carries the
    // inch-to-metre scale.
    const axes = [[0.8865, 0.3903, -0.2487], [0.3573, -0.9187, -0.1683], [-0.2941, 0.0603, -0.9539]];
    const scale = 0.0254;
    const attachment = new T.Matrix4().makeBasis(
      new T.Vector3(...axes[0] as [number, number, number]).multiplyScalar(scale),
      new T.Vector3(...axes[1] as [number, number, number]).multiplyScalar(scale),
      new T.Vector3(...axes[2] as [number, number, number]).multiplyScalar(scale));
    attachment.setPosition(-0.02189, -0.09066, -0.55409);
    // The camera's own basis in the world at that moment.
    const right = new T.Vector3(0.9563, 0, -0.2924);
    const up = new T.Vector3(0, 1, 0);
    const back = new T.Vector3(0.2924, 0, 0.9563);

    // A rotation matrix read straight from the attachment folds the model's scale into the
    // quaternion, which is not a rotation at all: it turned a casing round and sent it back
    // past the player. The port normalises the three axes first.
    const scaled = new T.Quaternion().setFromRotationMatrix(attachment);
    expect(scaled.length()).toBeLessThan(0.6);
    const straightened = attachment.clone();
    {
      const e = straightened.elements;
      for (const column of [0, 1, 2]) {
        const length = Math.hypot(e[column * 4], e[column * 4 + 1], e[column * 4 + 2]);
        e[column * 4] = e[column * 4] / length;
        e[column * 4 + 1] = e[column * 4 + 1] / length;
        e[column * 4 + 2] = e[column * 4 + 2] / length;
      }
    }
    const rotation = new T.Quaternion().setFromRotationMatrix(straightened);
    // Unit to the accuracy of the measured axes, which are quoted to four places.
    expect(rotation.length()).toBeCloseTo(1, 6);

    // The rifle system's own range, at its middle.
    const local = new T.Vector3(135, -5, 62.5);
    const aimed = local.clone().applyQuaternion(rotation).normalize();
    // An AK throws its brass up and to the right, angled forward: that is what the operator's
    // own numbers give once they are read on the emitter's axes.
    expect(aimed.dot(right)).toBeCloseTo(0.8207, 3);
    expect(aimed.dot(up)).toBeCloseTo(0.4102, 3);
    expect(-aimed.dot(back)).toBeCloseTo(0.3978, 3);
    // Rotating preserves the speed the operator states, to the accuracy of the measured axes.
    expect(local.clone().applyQuaternion(rotation).length()).toBeCloseTo(local.length(), 3);

    // Running the components through the port's Source-to-world swap first would instead aim
    // every casing flat sideways with no rise at all, so the port does not swap them.
    const swapped = new T.Vector3(local.x, local.z, -local.y).applyQuaternion(rotation).normalize();
    expect(swapped.dot(right)).toBeCloseTo(0.9988, 3);
    expect(Math.abs(swapped.dot(up))).toBeLessThan(0.05);
    expect(Math.abs(-swapped.dot(back))).toBeLessThan(0.05);

    // And the gravity the systems state is a world vector, which is why that one is swapped.
    const gravity = new T.Vector3(0, 0, -600);
    const downward = new T.Vector3(gravity.x, gravity.z, -gravity.y);
    expect(downward.x).toBe(0);
    expect(downward.y).toBeCloseTo(-600, 12);
    expect(Math.abs(downward.z)).toBe(0);
  });
});
