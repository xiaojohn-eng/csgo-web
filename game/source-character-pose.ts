/** Continuous sampling of the audited original T/AK frame data. No Three,
 * activity state machine, IK, root-motion extraction, camera or collision edits.
 */
export type SourceCharacterState = 'Idle' | 'Walk' | 'Run' | 'Crouch_Idle' | 'Crouch_Walk' | 'Jump' | 'Death';
export type SourcePoseParameters = { move_x?: number; move_y?: number; body_yaw?: number; body_pitch?: number; move_yaw?: number };
export type SourcePoseMode = 'sdk-3way' | 'sdk-bilinear';
export type SourcePoseBone = { name: string; parent: number; position: number[]; quaternion: number[]; flags: number;
  alignment: number[]; inverseBindSource: number[]; inverseBindGltf: number[] };
export type SourcePoseSequence = { index: number; name: string; flags: number; groupSize: number[]; animationIndices: number[];
  parameterIndices: number[]; poseKeys: number[]; boneWeights: number[]; fadeIn?: number; fadeOut?: number;
  /** Original animation events carried by the sequence (e.g. the magazine
   * display events the world weapon honours). */
  events?: { cycle: number; name: string }[];
  autoLayers: { sequence_id: number; pose_id?: number; flags: number; start: number; peak: number; tail: number; end: number }[] };
export type SourcePoseDescriptor = { index: number; name: string; fps: number; frames: number; flags: number; delta: boolean;
  positionsOffset: number; positionsCount: number; quaternionsOffset: number; quaternionsCount: number; ikRules: number; movements: number };
export type SourcePoseHitbox = { index: number; bone: number; boneName: string; group: number; min: number[]; max: number[]; name: string;
  sourceByteOffset: number; sourceBytesHex: string; extensionBytesHex: string; extensionUint32: number[]; extensionFloat32: number[]; extensionMeaning: string };
export type SourceCharacterPoseData = {
  format: 'source-character-pose-v1'; mainModel: string; animationModel: string; mainBones: SourcePoseBone[]; animationBones: SourcePoseBone[];
  mainToAnimation: number[]; renderJoints: { mainBone: number; sourceName: string; gltfNode: number; gltfName: string; skinJoint: number }[];
  poseParameters: { name: string; start: number; end: number; loop: number }[]; sequences: SourcePoseSequence[]; descriptors: SourcePoseDescriptor[];
  states: Record<Exclude<SourceCharacterState, 'Jump' | 'Death'>, { lower: number; upper: number; shoot: number }> &
    { Jump?: { lower: number; upper: number; shoot: number }; Death?: { lower: number; upper: number; shoot: number } };
  frames: { file: string; encoding: 'float64-little-endian'; byteLength: number; sha256: string };
  renderGlb: { file: string; sha256: string }; rootMotionPolicy: string; viewAndHullPolicy: string; inverseBindPolicy: string;
  hitboxSets: { index: number; name: string; hitboxes: SourcePoseHitbox[] }[];
};
export type SourceLocalPose = { positions: Float64Array; quaternions: Float64Array };
type Frame = { descriptor: SourcePoseDescriptor; positions: Float64Array; quaternions: Float64Array };
/** The resolved original reload graph of one weapon dataset: the merged
 * Reload_<weapon> wrapper sequence, its original length in seconds (the
 * weapon's own reload duration), the fade the original uses to blend the action
 * out when it is interrupted, the envelope tail past which the action has
 * already returned to the aim on its own, and the original magazine display
 * window the world weapon honours (AE_CL_EJECT_MAG .. AE_CL_EJECT_MAG_UNHIDE)
 * when the dataset carries those events. */
export type SourceCharacterReloadGraph = { sequence: number; seconds: number; fadeOut: number; exitCycle: number;
  magazine: { hide: number; show: number } | null };
export type SourceCharacterPoseIndex = {
  readonly data: SourceCharacterPoseData; readonly boneCount: number; readonly mainBoneCount: number;
  readonly frames: ReadonlyMap<number, Frame>; readonly sequences: ReadonlyMap<number, SourcePoseSequence>;
  readonly namedSequences: ReadonlyMap<string, SourcePoseSequence>; readonly rest: SourceLocalPose;
  readonly reload: SourceCharacterReloadGraph | null;
};
export type SourceCharacterJumpLayer = { cycle: number; weight: number; elapsed: number; airborne: boolean };
/** Original release strengths: GREN1 is the 14-frame @30fps overhand throw,
 * GREN2 the 19-frame medium and GREN3 the 19-frame underhand release. */
export type SourceGrenadeThrowStyle = 'overhand' | 'medium' | 'underhand';
/** Merged original Shoot_GREN delta overlay: a single non-looping throw run
 * whose variant tracks the live locomotion state and whose style selects the
 * original overhand/medium/underhand release set. */
export type SourceCharacterGrenadeLayer = { cycle: number; weight: number; variant: number; style: SourceGrenadeThrowStyle };
/** Merged original pin-pull preparation graph: the non-looping Upper_GREN
 * wrapper animates only the two weapon hand bones while its original
 * auto-layers blend the 9-way Aim_GREN body_yaw/body_pitch aim pose and the
 * HandPos_GREN hold on top; the non-looping clamp freezes the pulled-pin
 * final frame for as long as the throw key stays held. */
export type SourceCharacterGrenadePrepLayer = { cycle: number; weight: number; variant: number };
/** Merged original world-model reload: the Reload_<weapon> wrapper plays once
 * over the armed aim layer while the magazine is out, its two original
 * auto-layers splitting the action between the upper body (arm/hand reload
 * work, legs masked out) and the legs plus lower spine (the weight shift) under
 * the original 0.1096/0.8904 envelope. The clock is the server-authoritative
 * reload timer, so the pose lands back on the aim exactly when the magazine
 * commits. */
export type SourceCharacterReloadLayer = { cycle: number; weight: number };
export type SourceCharacterPoseInput = { state: SourceCharacterState; cycle: number; parameters: SourcePoseParameters;
  upperCycle?: number; fireCycle?: number; fireWeight?: number; fireTimeSeconds?: number; fireCycleRate?: number; blendMode?: SourcePoseMode;
  jump?: SourceCharacterJumpLayer; grenade?: SourceCharacterGrenadeLayer; prep?: SourceCharacterGrenadePrepLayer;
  reload?: SourceCharacterReloadLayer };
export type SourceCharacterPose = SourceLocalPose & { sourceWorldMatrices: Float64Array; renderLocalPositions: Float64Array;
  renderLocalQuaternions: Float64Array; animationPose: SourceLocalPose; state: SourceCharacterState; blendMode: SourcePoseMode;
  /** Whether the world weapon's original magazine mesh is seated, driven by the
   * original reload display events. */
  magazineVisible: boolean };
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const positiveModulo = (x: number) => ((x % 1) + 1) % 1;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const integer = (x: unknown, min = 0): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= min;
const finiteArray = (v: unknown, count: number): v is number[] => Array.isArray(v) && v.length === count && v.every(Number.isFinite);
const pose = (bones: number): SourceLocalPose => ({ positions: new Float64Array(bones * 3), quaternions: new Float64Array(bones * 4) });
const copy = (p: SourceLocalPose): SourceLocalPose => ({ positions: p.positions.slice(), quaternions: p.quaternions.slice() });

function normalize(out: Float64Array, at: number, x: number, y: number, z: number, w: number) {
  const length = Math.hypot(x, y, z, w); check(length > 1e-10 && Number.isFinite(length), 'Invalid source quaternion');
  out[at] = x / length; out[at + 1] = y / length; out[at + 2] = z / length; out[at + 3] = w / length;
}
function mixQuaternion(a: Float64Array, ai: number, b: Float64Array, bi: number, t: number, align: boolean, spherical: boolean, out: Float64Array, at: number) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  let bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  if (align && ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const dot = clamp(ax * bx + ay * by + az * bz + aw * bw, -1, 1);
  let u = 1 - t, v = t;
  if (spherical) {
    check(dot > -1 + 1e-6, 'Unsupported opposite fixed-alignment quaternion branch');
    if (1 - dot > 1e-6) { const angle = Math.acos(dot), sine = Math.sin(angle); u = Math.sin((1 - t) * angle) / sine; v = Math.sin(t * angle) / sine; }
  }
  normalize(out, at, u * ax + v * bx, u * ay + v * by, u * az + v * bz, u * aw + v * bw);
}
function multiplyQuaternion(a: Float64Array, ai: number, b: Float64Array, bi: number, out: Float64Array, at: number) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3], bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  normalize(out, at, aw * bx + bw * ax + ay * bz - az * by, aw * by + bw * ay + az * bx - ax * bz,
    aw * bz + bw * az + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz);
}

/** Validate and copy original data once. Byte SHA verification belongs to the
 * asset loader; this function validates layout, finite values and every link.
 */
export function prepareSourceCharacterPose(input: unknown, bytes: ArrayBuffer | Uint8Array): SourceCharacterPoseIndex {
  const d = structuredClone(input) as SourceCharacterPoseData;
  check(d?.format === 'source-character-pose-v1' && d.frames.encoding === 'float64-little-endian', 'Unsupported source pose format');
  check(new Uint8Array(new Uint16Array([1]).buffer)[0] === 1, 'Source pose binary needs little-endian host');
  // Buffer.slice() aliases its slab and may have a non-zero/unaligned offset.
  // Copy only the supplied byte window into an owned, aligned ArrayBuffer.
  const raw = bytes instanceof Uint8Array ? Uint8Array.from(bytes) : new Uint8Array(bytes.slice(0));
  check(raw.byteLength === d.frames.byteLength && raw.byteLength % 8 === 0, 'Source frame binary length mismatch');
  const all = new Float64Array(raw.buffer); check(all.every(Number.isFinite), 'Nonfinite source animation data');
  check(Array.isArray(d.animationBones) && d.animationBones.length > 0 && d.animationBones.length <= 256 && Array.isArray(d.mainBones) && d.mainBones.length > 0 && d.mainBones.length <= 256, 'Invalid source bone count');
  const bones = d.animationBones.length, mainBones = d.mainBones.length;
  for (const definitions of [d.animationBones, d.mainBones]) {
    const names = new Set<string>();
    for (const [i, b] of definitions.entries()) {
      check(typeof b.name === 'string' && !names.has(b.name) && integer(b.parent, -1) && b.parent < i, 'Invalid/unsorted source bone tree'); names.add(b.name);
      check(finiteArray(b.position, 3) && finiteArray(b.quaternion, 4) && finiteArray(b.alignment, 4) && integer(b.flags) && finiteArray(b.inverseBindSource, 16) && finiteArray(b.inverseBindGltf, 16), 'Invalid source bone fields');
      check(Math.hypot(...b.quaternion) > .99 && Math.hypot(...b.quaternion) < 1.01, 'Invalid rest quaternion');
      if (b.flags & 0x100000) check(Math.hypot(...b.alignment) > 1e-10, 'Missing fixed bone alignment');
    }
  }
  check(d.mainToAnimation.length === mainBones && d.renderJoints.length === mainBones, 'Invalid source/render mapping count');
  for (const [i, mapped] of d.mainToAnimation.entries()) {
    check(integer(mapped, -1) && mapped < bones, 'Invalid source bone mapping');
    if (mapped >= 0) {
      const a = d.animationBones[mapped], b = d.mainBones[i];
      check(a.name === b.name && (a.parent < 0 ? null : d.animationBones[a.parent].name) === (b.parent < 0 ? null : d.mainBones[b.parent].name), 'Source mapping name/parent mismatch');
    }
  }
  const slots = new Set<number>();
  for (const r of d.renderJoints) { check(integer(r.mainBone) && r.mainBone < mainBones && !slots.has(r.mainBone) && r.sourceName === d.mainBones[r.mainBone].name, 'Invalid render bone mapping'); slots.add(r.mainBone); }
  const frames = new Map<number, Frame>(), ranges: number[][] = [];
  for (const a of d.descriptors) {
    check(integer(a.index) && !frames.has(a.index) && integer(a.frames, 1) && Number.isFinite(a.fps) && a.fps > 0 && a.delta === !!(a.flags & 4), 'Invalid animation descriptor');
    check(a.positionsCount === a.frames * bones * 3 && a.quaternionsCount === a.frames * bones * 4, 'Invalid frame component count');
    for (const [offset, count] of [[a.positionsOffset, a.positionsCount], [a.quaternionsOffset, a.quaternionsCount]]) {
      check(integer(offset) && integer(count, 1) && offset + count <= all.length, 'Invalid frame range'); ranges.push([offset, offset + count]);
    }
    const positions = all.subarray(a.positionsOffset, a.positionsOffset + a.positionsCount), quaternions = all.subarray(a.quaternionsOffset, a.quaternionsOffset + a.quaternionsCount);
    for (let i = 0; i < quaternions.length; i += 4) check(Math.abs(Math.hypot(quaternions[i], quaternions[i + 1], quaternions[i + 2], quaternions[i + 3]) - 1) < 1e-6, 'Nonunit decoded source quaternion');
    frames.set(a.index, { descriptor: a, positions, quaternions });
  }
  ranges.sort((a, b) => a[0] - b[0]); let consumed = 0;
  for (const range of ranges) { check(range[0] === consumed, 'Overlapping/missing frame bytes'); consumed = range[1]; } check(consumed === all.length, 'Unmapped frame suffix');
  const sequences = new Map<number, SourcePoseSequence>(), namedSequences = new Map<string, SourcePoseSequence>();
  for (const s of d.sequences) {
    check(integer(s.index) && !sequences.has(s.index) && !namedSequences.has(s.name) && s.groupSize.length === 2 && s.groupSize.every(n => integer(n, 1) && n <= 3), 'Invalid source sequence');
    check(s.animationIndices.length === s.groupSize[0] * s.groupSize[1] && s.animationIndices.every(id => frames.has(id)), 'Missing sequence animation');
    check(s.boneWeights.length === bones && s.boneWeights.every(w => Number.isFinite(w) && w >= 0 && w <= 1), 'Invalid source bone mask');
    check(!(s.flags & (128 | 256 | 512 | 16384)), 'Unimplemented cycle-pose/realtime/local/world sequence');
    check(s.fadeIn === undefined || Number.isFinite(s.fadeIn) && s.fadeIn >= 0, 'Invalid source sequence fade-in');
    check(s.fadeOut === undefined || Number.isFinite(s.fadeOut) && s.fadeOut >= 0, 'Invalid source sequence fade-out');
    check(s.events === undefined || Array.isArray(s.events) &&
      s.events.every(e => e && typeof e.name === 'string' && Number.isFinite(e.cycle) && e.cycle >= 0 && e.cycle <= 1),
      'Invalid source sequence event record');
    check(s.parameterIndices.length === 2, 'Invalid pose axes');
    for (let axis = 0; axis < 2; axis++) if (s.groupSize[axis] > 1) {
      check(integer(s.parameterIndices[axis]) && s.parameterIndices[axis] < d.poseParameters.length, 'Invalid pose parameter');
      const at = axis === 0 ? 0 : s.groupSize[0], keys = s.poseKeys.slice(at, at + s.groupSize[axis]);
      check(finiteArray(keys, s.groupSize[axis]), 'Missing original pose keys');
      const sign = Math.sign(keys[1] - keys[0]); check(sign !== 0 && keys.slice(1).every((k, i) => Math.sign(k - keys[i]) === sign), 'Nonmonotonic pose keys');
    }
    sequences.set(s.index, s); namedSequences.set(s.name, s);
  }
  for (const s of d.sequences) for (const l of s.autoLayers) check(l.flags === 0 && sequences.has(l.sequence_id) && [l.start, l.peak, l.tail, l.end].every(Number.isFinite), 'Unsupported source auto-layer');
  for (const state of ['Idle', 'Walk', 'Run', 'Crouch_Idle', 'Crouch_Walk'] as const) {
    const s = d.states[state]; check(s && [s.lower, s.upper, s.shoot].every(id => sequences.has(id)), 'Missing original state sequence');
  }
  // Jump is optional at this layer: weapon world graphs borrow this sampler
  // without a player state machine. Player data merges the original looping
  // jump_lower 9-way over the shared animation MDLs — its weapon aim layers
  // reuse Idle because no Jump_Upper sequence exists — and the pose driver
  // enforces that merge before any jump layer can run.
  const jumpState = d.states.Jump;
  if (jumpState) {
    check(sequences.get(jumpState.lower) === namedSequences.get('jump_lower') && (sequences.get(jumpState.lower)!.flags & 1) === 1,
      'Jump state must reference the looping original jump_lower');
    check(jumpState.upper === d.states.Idle.upper && jumpState.shoot === d.states.Idle.shoot,
      'Jump upper/shoot must reuse the Idle weapon aim layers');
  }
  // Death is likewise optional here: the merged original Death1 full-body fall
  // animates every bone with unity weights and never loops, so the non-looping
  // clamp freezes the corpse at the final frame once the cycle reaches 1.
  const deathState = d.states.Death;
  if (deathState) {
    const death = sequences.get(deathState.lower);
    check(death === namedSequences.get('Death1') && deathState.upper === deathState.lower && deathState.shoot === deathState.lower,
      'Death state must reference the original full-body Death1 on every layer');
    check((death!.flags & 1) === 0 && death!.groupSize[0] === 1 && death!.groupSize[1] === 1 && death!.autoLayers.length === 0,
      'Death1 must stay a non-looping parameterless original fall');
  }
  // The merged original grenade-throw delta layers are optional here (weapon
  // world graphs borrow this sampler without a player state machine); the pose
  // driver overlays the locomotion-matching release variant. Each variant is a
  // parameterless non-looping delta layer with a 0/1 bone mask (moving
  // variants zero the leg chain so locomotion keeps driving it). GREN1 is the
  // overhand release, GREN2 the medium and GREN3 the underhand one; all three
  // sets follow the same contract.
  for (const suffix of ['Shoot_GREN1', 'Shoot_GREN2', 'Shoot_GREN3'] as const) {
    const grenadeVariantCount = ['Run', 'Walk', 'Idle', 'Crouch_Idle', 'Crouch_Walk'].map(state => `${state}_${suffix}`)
      .filter(name => namedSequences.has(name)).length;
    if (grenadeVariantCount > 0) {
      check(grenadeVariantCount === 5, `Incomplete merged ${suffix} variant set`);
      for (const state of ['Run', 'Walk', 'Idle', 'Crouch_Idle', 'Crouch_Walk'] as const) {
        const variant = namedSequences.get(`${state}_${suffix}`)!;
        check((variant.flags & 4) !== 0 && (variant.flags & 1) === 0 && variant.groupSize[0] === 1 && variant.groupSize[1] === 1,
          `${suffix} variants must stay parameterless non-looping delta layers`);
      }
    }
  }
  // The merged original pin-pull preparation graph is optional the same way:
  // per ground state one Upper_GREN wrapper (non-looping, not a delta layer,
  // masked to exactly the two weapon hand bones) whose original auto-layers
  // point at the matching 9-way Aim_GREN body_yaw/body_pitch delta grid and
  // the parameterless HandPos_GREN hold.
  const prepVariantCount = ['Run', 'Walk', 'Idle', 'Crouch_Idle', 'Crouch_Walk'].map(state => `${state}_Upper_GREN`)
    .filter(name => namedSequences.has(name)).length;
  if (prepVariantCount > 0) {
    check(prepVariantCount === 5, 'Incomplete merged Upper_GREN variant set');
    for (const state of ['Run', 'Walk', 'Idle', 'Crouch_Idle', 'Crouch_Walk'] as const) {
      const upper = namedSequences.get(`${state}_Upper_GREN`)!, aim = namedSequences.get(`${state}_Aim_GREN`),
        hand = namedSequences.get(`${state}_HandPos_GREN`);
      check((upper.flags & 5) === 0 && upper.groupSize[0] === 1 && upper.groupSize[1] === 1,
        'Upper_GREN variants must stay parameterless non-looping full poses');
      check(aim !== undefined && hand !== undefined && upper.autoLayers.length === 2 &&
        upper.autoLayers.every(l => l.sequence_id === aim.index || l.sequence_id === hand.index),
        'Upper_GREN must keep its original Aim/HandPos auto-layers');
      check((aim!.flags & 4) !== 0 && (aim!.flags & 1) === 0 && aim!.groupSize[0] === 3 && aim!.groupSize[1] === 3 &&
        d.poseParameters[aim!.parameterIndices[0]]?.name === 'body_yaw' && d.poseParameters[aim!.parameterIndices[1]]?.name === 'body_pitch',
        'Aim_GREN variants must stay the original 9-way body_yaw/body_pitch delta grid');
      check((hand!.flags & 1) === 0 && hand!.groupSize[0] === 1 && hand!.groupSize[1] === 1,
        'HandPos_GREN variants must stay parameterless non-looping holds');
      const ones = upper.boneWeights.map((w, i) => w === 1 ? i : -1).filter(i => i >= 0);
      check(ones.length === 2 && ones.map(i => d.animationBones[i].name).join() === 'ValveBiped.weapon_bone_RHand,ValveBiped.weapon_bone_LHand',
        'Upper_GREN must mask only the two weapon hand bones');
    }
  }
  // The merged original world-model reload graph is optional the same way: one
  // Reload_<weapon> wrapper (non-looping, parameterless, and carrying no bone
  // weights of its own) whose two original auto-layers split the action between
  // the upper body (legs masked out) and the legs plus lower spine under one
  // shared interior envelope. Everything here is structural, so the CT variants
  // (which carry no descriptor category) stay valid.
  const reloadWrappers = [...namedSequences.values()].filter(s => s.name.startsWith('Reload_') && s.flags === 0);
  check(reloadWrappers.length <= 1, 'Source pose data has more than one original reload wrapper');
  let reload: SourceCharacterReloadGraph | null = null;
  if (reloadWrappers.length === 1) {
    const wrapper = reloadWrappers[0];
    check(wrapper.groupSize[0] === 1 && wrapper.groupSize[1] === 1 && wrapper.boneWeights.every(w => w === 0),
      'Reload wrapper must stay a parameterless pose without bone weights of its own');
    check(wrapper.autoLayers.length === 2, 'Reload wrapper must keep its two original auto-layers');
    const upper = namedSequences.get(`${wrapper.name}_seq`), lower = namedSequences.get(`${wrapper.name}_Inv`);
    check(upper !== undefined && lower !== undefined &&
      wrapper.autoLayers.every(l => l.sequence_id === upper.index || l.sequence_id === lower.index),
      `Reload wrapper must keep its original ${wrapper.name}_seq/${wrapper.name}_Inv auto-layers`);
    check((upper!.flags & 5) === 0 && (lower!.flags & 5) === 4,
      'Reload auto-layers must stay the original non-looping upper pose and the non-looping delta lower layer');
    const envelope = wrapper.autoLayers[0];
    check(wrapper.autoLayers.every(l => l.start === envelope.start && l.peak === envelope.peak && l.tail === envelope.tail && l.end === envelope.end) &&
      envelope.start === 0 && envelope.end === 1 && envelope.peak > 0 && envelope.peak < envelope.tail && envelope.tail < 1,
      'Reload auto-layers must share one original interior envelope');
    const legs = d.animationBones.map((b, i) => /Thigh|Calf|Foot|Toe/.test(b.name) ? i : -1).filter(i => i >= 0);
    check(legs.length > 0 && legs.every(i => lower!.boneWeights[i] > 0 && upper!.boneWeights[i] === 0),
      'Reload upper layer must mask the legs and the lower layer must carry them');
    const descriptor = frames.get(wrapper.animationIndices[0])!.descriptor;
    check(descriptor.frames > 1 && descriptor.fps > 0, 'Reload wrapper must reference a timed original pose');
    // The original magazine display events: AE_CL_EJECT_MAG takes the spent
    // magazine out of the weapon and AE_CL_EJECT_MAG_UNHIDE seats the fresh one.
    // Datasets without them (the AWP graph) simply keep the magazine in place.
    const eject = wrapper.events?.find(e => e.name === 'AE_CL_EJECT_MAG');
    const unhide = wrapper.events?.find(e => e.name === 'AE_CL_EJECT_MAG_UNHIDE');
    check((eject === undefined) === (unhide === undefined), 'Reload wrapper must carry both original magazine events or neither');
    if (eject !== undefined && unhide !== undefined)
      check(eject.cycle < unhide.cycle, 'Reload wrapper must eject the magazine before seating the fresh one');
    reload = { sequence: wrapper.index, seconds: (descriptor.frames - 1) / descriptor.fps,
      fadeOut: Math.max(wrapper.fadeOut ?? 0.2, 1 / 128), exitCycle: envelope.tail,
      magazine: eject === undefined ? null : { hide: eject.cycle, show: unhide!.cycle } };
  }
  for (const set of d.hitboxSets) for (const h of set.hitboxes) check(integer(h.bone) && h.bone < mainBones && h.boneName === d.mainBones[h.bone].name && finiteArray(h.min, 3) && finiteArray(h.max, 3), 'Invalid original hitbox bone/bounds');
  const rest = pose(bones);
  for (const [i, b] of d.animationBones.entries()) { rest.positions.set(b.position, i * 3); normalize(rest.quaternions, i * 4, b.quaternion[0], b.quaternion[1], b.quaternion[2], b.quaternion[3]); }
  return { data: d, boneCount: bones, mainBoneCount: mainBones, frames, sequences, namedSequences, rest, reload };
}

/** Original encoded frame interpolation. Quaternions xyzw; time interpolation
 * is normalized lerp, and absolute fixed-alignment frames keep original sign.
 */
export function sampleSourceAnimationFrame(index: SourceCharacterPoseIndex, animation: number, cycle: number): SourceLocalPose {
  const frame = index.frames.get(animation); check(frame && Number.isFinite(cycle), 'Invalid animation/frame time');
  const f = clamp(cycle) * (frame.descriptor.frames - 1), i = Math.floor(f), j = Math.min(i + 1, frame.descriptor.frames - 1), t = f - i, result = pose(index.boneCount);
  for (let b = 0; b < index.boneCount; b++) {
    const p = b * 3, q = b * 4;
    for (let axis = 0; axis < 3; axis++) result.positions[p + axis] = frame.positions[i * index.boneCount * 3 + p + axis] * (1 - t) + frame.positions[j * index.boneCount * 3 + p + axis] * t;
    mixQuaternion(frame.quaternions, i * index.boneCount * 4 + q, frame.quaternions, j * index.boneCount * 4 + q, t, true, false, result.quaternions, q);
    const bone = index.data.animationBones[b];
    if (!frame.descriptor.delta && bone.flags & 0x100000 && bone.alignment.reduce((sum, v, a) => sum + v * result.quaternions[q + a], 0) < 0)
      for (let a = 0; a < 4; a++) result.quaternions[q + a] *= -1;
  }
  return result;
}
function blend(index: SourceCharacterPoseIndex, a: SourceLocalPose, b: SourceLocalPose, t: number, sequence: SourcePoseSequence): SourceLocalPose {
  const out = copy(a);
  for (let i = 0; i < index.boneCount; i++) if (sequence.boneWeights[i] > 0) {
    for (let axis = 0; axis < 3; axis++) out.positions[i * 3 + axis] = a.positions[i * 3 + axis] * (1 - t) + b.positions[i * 3 + axis] * t;
    mixQuaternion(a.quaternions, i * 4, b.quaternions, i * 4, t, !(index.data.animationBones[i].flags & 0x100000), false, out.quaternions, i * 4);
  }
  return out;
}
function sequenceFor(index: SourceCharacterPoseIndex, sequence: number | string): SourcePoseSequence {
  const found = typeof sequence === 'number' ? index.sequences.get(sequence) : index.namedSequences.get(sequence); check(found, `Missing original sequence ${sequence}`); return found;
}
function axis(index: SourceCharacterPoseIndex, s: SourcePoseSequence, a: number, parameters: SourcePoseParameters): [number, number] {
  const size = s.groupSize[a], parameter = s.parameterIndices[a]; if (size === 1 || parameter < 0) return [0, 0];
  const value = parameters[index.data.poseParameters[parameter].name as keyof SourcePoseParameters] ?? 0; check(Number.isFinite(value), 'Nonfinite source pose parameter');
  const at = a === 0 ? 0 : s.groupSize[0], keys = s.poseKeys.slice(at, at + size); let cell = 0;
  while (true) { const fraction = (value - keys[cell]) / (keys[cell + 1] - keys[cell]); if (cell < size - 2 && fraction > 1) { cell++; continue; } return [cell, clamp(fraction)]; }
}

/** The original SDK three-way descriptor triangle for a cell inside the 2D grid:
 * which three cells the pose is made of and how much each weighs. Studio_CPS
 * blends them pairwise in exactly this order, and the same weights also say
 * which original animations a pose is made of, which the IK rule layers need.
 */
function threeWayCells(i: number, j: number, x: number, y: number): { offsets: number[][]; weights: number[] } {
  let offsets: number[][], weights: number[];
  if ((i + j) % 2 === 0) { if (x > y) { offsets = [[0, 0], [1, 0], [1, 1]]; weights = [1 - x, x - y]; } else { offsets = [[1, 1], [0, 1], [0, 0]]; weights = [x, y - x]; } }
  else if (x + y > 1) { offsets = [[1, 0], [1, 1], [0, 1]]; weights = [1 - y, x - 1 + y]; }
  else { offsets = [[0, 1], [0, 0], [1, 0]]; weights = [y, 1 - x - y]; }
  if (weights[1] < .001) weights[1] = 0;
  weights.push(1 - weights[0] - weights[1]);
  return { offsets, weights };
}

/** SDK CalcPoseSingle's explicit 3way branch; bilinear remains a diagnostic
 * alternative so the two independently stored Python sample sets can be read.
 */
export function sampleSourceSequence(index: SourceCharacterPoseIndex, name: number | string, inputCycle: number, parameters: SourcePoseParameters, mode: SourcePoseMode = 'sdk-3way'): SourceLocalPose {
  check(Number.isFinite(inputCycle) && (mode === 'sdk-3way' || mode === 'sdk-bilinear'), 'Invalid source sequence sample');
  const s = sequenceFor(index, name), cycle = s.flags & 1 ? positiveModulo(inputCycle) : clamp(inputCycle);
  const [i, x] = axis(index, s, 0, parameters), [j, y] = axis(index, s, 1, parameters), [sx, sy] = s.groupSize;
  const fetch = (a: number, b: number) => sampleSourceAnimationFrame(index, s.animationIndices[Math.min(a, sx - 1) + Math.min(b, sy - 1) * sx], cycle);
  const mix = (a: SourceLocalPose, b: SourceLocalPose, t: number) => blend(index, a, b, t, s);
  if (x < .001) return y < .001 ? fetch(i, j) : y > .999 ? fetch(i, j + 1) : mix(fetch(i, j), fetch(i, j + 1), y);
  if (x > .999) return y < .001 ? fetch(i + 1, j) : y > .999 ? fetch(i + 1, j + 1) : mix(fetch(i + 1, j), fetch(i + 1, j + 1), y);
  if (y < .001) return mix(fetch(i, j), fetch(i + 1, j), x);
  if (y > .999) return mix(fetch(i, j + 1), fetch(i + 1, j + 1), x);
  if (mode === 'sdk-bilinear') return mix(mix(fetch(i, j), fetch(i + 1, j), x), mix(fetch(i, j + 1), fetch(i + 1, j + 1), x), y);
  const { offsets, weights } = threeWayCells(i, j, x, y);
  const [a, b, c] = offsets.map(([dx, dy]) => fetch(i + dx, j + dy));
  return weights[1] < .001 ? mix(a, c, weights[2] / (weights[0] + weights[2])) : mix(mix(a, b, weights[1] / (weights[0] + weights[1])), c, weights[2]);
}

/** The original animations one sequence samples at this cycle/pose parameters,
 * with the weight each contributes. These are exactly the weights
 * `sampleSourceSequence` blends with, so an IK rule layer can blend the original
 * per-animation rules the same way the pose was built. */
export function sourceSequenceBlend(index: SourceCharacterPoseIndex, name: number | string, inputCycle: number,
  parameters: SourcePoseParameters, mode: SourcePoseMode = 'sdk-3way'): { animationIndex: number; weight: number }[] {
  check(Number.isFinite(inputCycle) && (mode === 'sdk-3way' || mode === 'sdk-bilinear'), 'Invalid source sequence blend sample');
  const s = sequenceFor(index, name), [i, x] = axis(index, s, 0, parameters), [j, y] = axis(index, s, 1, parameters), [sx, sy] = s.groupSize;
  const at = (a: number, b: number) => s.animationIndices[Math.min(a, sx - 1) + Math.min(b, sy - 1) * sx];
  const horizontal = x < .001 ? i : i + 1, vertical = y < .001 ? j : j + 1;
  const cells: [number, number][] = [], weights: number[] = [];
  if (x < .001 || x > .999) {
    // A single column: one descriptor, or the two rows of the axis-1 blend.
    if (y < .001 || y > .999) { cells.push([horizontal, vertical]); weights.push(1); }
    else { cells.push([horizontal, j], [horizontal, vertical]); weights.push(1 - y, y); }
  } else if (y < .001 || y > .999) {
    cells.push([i, vertical], [horizontal, vertical]); weights.push(1 - x, x);
  } else if (mode === 'sdk-bilinear') {
    cells.push([i, j], [horizontal, j], [i, vertical], [horizontal, vertical]);
    weights.push((1 - y) * (1 - x), (1 - y) * x, y * (1 - x), y * x);
  } else {
    const triangle = threeWayCells(i, j, x, y);
    for (const [dx, dy] of triangle.offsets) cells.push([i + dx, j + dy]);
    weights.push(...triangle.weights);
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  check(total > 0, 'Original sequence blend has no weight');
  const merged = new Map<number, number>();
  for (let k = 0; k < cells.length; k++) {
    const animationIndex = at(cells[k][0], cells[k][1]), weight = weights[k] / total;
    if (weight > 1e-9) merged.set(animationIndex, (merged.get(animationIndex) ?? 0) + weight);
  }
  return [...merged].map(([animationIndex, weight]) => ({ animationIndex, weight }));
}

export function accumulateSourceSequence(index: SourceCharacterPoseIndex, base: SourceLocalPose, name: number | string, cycle: number,
  weight: number, parameters: SourcePoseParameters, mode: SourcePoseMode = 'sdk-3way', depth = 0): SourceLocalPose {
  check(depth < 8 && Number.isFinite(weight) && weight >= 0 && weight <= 1, 'Invalid/recursive source layer');
  if (weight === 0) return copy(base);
  const s = sequenceFor(index, name), value = sampleSourceSequence(index, s.index, cycle, parameters, mode), out = copy(base), scaled = new Float64Array(4);
  for (let i = 0; i < index.boneCount; i++) {
    const w = s.boneWeights[i] * weight; if (!(w > 0)) continue; const p = i * 3, q = i * 4;
    if (s.flags & 4) {
      const x = value.quaternions[q], y = value.quaternions[q + 1], z = value.quaternions[q + 2], originalW = value.quaternions[q + 3];
      const sine = Math.min(Math.hypot(x, y, z), 1), scaledSine = Math.sin(Math.asin(sine) * w), factor = scaledSine / (sine + 1.1920928955078125e-7);
      scaled.set([x * factor, y * factor, z * factor, Math.sqrt(Math.max(0, 1 - scaledSine * scaledSine)) * (originalW < 0 ? -1 : 1)]);
      if (s.flags & 16) multiplyQuaternion(base.quaternions, q, scaled, 0, out.quaternions, q);
      else multiplyQuaternion(scaled, 0, base.quaternions, q, out.quaternions, q);
      for (let a = 0; a < 3; a++) out.positions[p + a] += value.positions[p + a] * w;
    } else {
      mixQuaternion(base.quaternions, q, value.quaternions, q, w, !(index.data.animationBones[i].flags & 0x100000), true, out.quaternions, q);
      for (let a = 0; a < 3; a++) out.positions[p + a] = base.positions[p + a] * (1 - w) + value.positions[p + a] * w;
    }
  }
  let layered = out;
  for (const layer of s.autoLayers) {
    let layerCycle = cycle, layerWeight = weight;
    if (layer.start !== layer.end) {
      if (cycle < layer.start || cycle >= layer.end) continue;
      const ramp = cycle < layer.peak && layer.start !== layer.peak ? (cycle - layer.start) / (layer.peak - layer.start) :
        cycle > layer.tail && layer.end !== layer.tail ? (layer.end - cycle) / (layer.end - layer.tail) : 1;
      layerWeight *= ramp; layerCycle = (cycle - layer.start) / (layer.end - layer.start);
    }
    layered = accumulateSourceSequence(index, layered, layer.sequence_id, layerCycle, layerWeight, parameters, mode, depth + 1);
  }
  return layered;
}

/** Studio_CPS uses four bilinear descriptor weights EVEN WHEN posture blending
 * uses three-way triangles. Run_lower includes both 20- and 21-frame originals.
 */
export function sourceSequenceCycleRate(index: SourceCharacterPoseIndex, name: number | string, parameters: SourcePoseParameters): number {
  const s = sequenceFor(index, name), [i, x] = axis(index, s, 0, parameters), [j, y] = axis(index, s, 1, parameters), [sx, sy] = s.groupSize;
  let rate = 0;
  for (const [dx, dy, weight] of [[0, 0, (1 - x) * (1 - y)], [1, 0, x * (1 - y)], [0, 1, (1 - x) * y], [1, 1, x * y]]) {
    const d = index.frames.get(s.animationIndices[Math.min(i + dx, sx - 1) + Math.min(j + dy, sy - 1) * sx])!.descriptor;
    if (weight > 0 && d.frames > 1) rate += d.fps / (d.frames - 1) * weight;
  }
  return rate;
}
export function advanceSourceSequenceCycle(index: SourceCharacterPoseIndex, name: number | string, cycle: number, dt: number, parameters: SourcePoseParameters) {
  check(Number.isFinite(cycle) && Number.isFinite(dt) && dt >= 0, 'Invalid source sequence clock');
  const s = sequenceFor(index, name), rate = sourceSequenceCycleRate(index, name, parameters), unwrapped = cycle + dt * rate;
  return { cycle: s.flags & 1 ? positiveModulo(unwrapped) : clamp(unwrapped), unwrapped, cyclesPerSecond: rate };
}

function localMatrix(p: Float64Array, pi: number, q: Float64Array, qi: number): Float64Array {
  const inverse = 1 / Math.hypot(q[qi], q[qi + 1], q[qi + 2], q[qi + 3]), x = q[qi] * inverse, y = q[qi + 1] * inverse, z = q[qi + 2] * inverse, w = q[qi + 3] * inverse;
  const xx = 2 * x * x, yy = 2 * y * y, zz = 2 * z * z, xy = 2 * x * y, xz = 2 * x * z, yz = 2 * y * z, wx = 2 * w * x, wy = 2 * w * y, wz = 2 * w * z;
  return new Float64Array([1 - yy - zz, xy + wz, xz - wy, 0, xy - wz, 1 - xx - zz, yz + wx, 0, xz + wy, yz - wx, 1 - xx - yy, 0, p[pi], p[pi + 1], p[pi + 2], 1]);
}

/** Produces shared Source-world matrices for future render/hitbox/history use.
 * Original pelvis/root motion remains intact; callers own actor translation.
 */
export function sampleSourceCharacterPose(index: SourceCharacterPoseIndex, input: SourceCharacterPoseInput): SourceCharacterPose {
  const state = index.data.states[input.state]; check(state, 'Unknown original character state');
  const mode = input.blendMode ?? 'sdk-3way', parameters = input.parameters, weight = input.fireWeight ?? 0;
  check(input.fireTimeSeconds === undefined || Number.isFinite(input.fireTimeSeconds) && input.fireTimeSeconds >= 0, 'Invalid authoritative fire elapsed time');
  check(input.fireCycleRate === undefined || Number.isFinite(input.fireCycleRate) && input.fireCycleRate >= 0, 'Invalid authoritative fire cycle rate');
  check(parameters && Object.values(parameters).every(v => v === undefined || Number.isFinite(v)), 'Invalid source character parameters');
  const jump = input.jump;
  if (jump !== undefined) {
    check(Number.isFinite(jump.cycle) && Number.isFinite(jump.weight) && jump.weight >= 0 && jump.weight <= 1 &&
      Number.isFinite(jump.elapsed) && jump.elapsed >= 0 && typeof jump.airborne === 'boolean', 'Invalid source jump layer');
    check(input.state !== 'Jump' && input.state !== 'Death', 'Jump layer cannot be combined with the Jump or Death state');
  }
  const grenade = input.grenade;
  if (grenade !== undefined) {
    check(Number.isFinite(grenade.cycle) && grenade.cycle >= 0 && Number.isFinite(grenade.weight) && grenade.weight >= 0 && grenade.weight <= 1 &&
      integer(grenade.variant) && (grenade.style === 'overhand' || grenade.style === 'medium' || grenade.style === 'underhand'),
      'Invalid source grenade layer');
    check(input.state !== 'Death', 'The corpse cannot keep a grenade layer');
  }
  const prep = input.prep;
  if (prep !== undefined) {
    check(Number.isFinite(prep.cycle) && prep.cycle >= 0 && Number.isFinite(prep.weight) && prep.weight >= 0 && prep.weight <= 1 &&
      integer(prep.variant), 'Invalid source grenade prep layer');
    check(input.state !== 'Death', 'The corpse cannot keep a grenade prep layer');
  }
  const reloadLayer = input.reload;
  if (reloadLayer !== undefined) {
    check(Number.isFinite(reloadLayer.cycle) && reloadLayer.cycle >= 0 && Number.isFinite(reloadLayer.weight) &&
      reloadLayer.weight >= 0 && reloadLayer.weight <= 1, 'Invalid source reload layer');
    check(input.state !== 'Death', 'The corpse cannot keep a reload layer');
    check(index.reload !== null, 'Reload layer requires the merged original Reload graph');
  }
  if (input.state === 'Death') {
    check(index.data.states.Death, 'Death state requires the merged original Death1');
    check((input.fireWeight ?? 0) === 0 && (input.fireCycle ?? 0) === 0, 'The corpse cannot keep a fire layer');
  }
  let value = accumulateSourceSequence(index, index.rest, state.lower, input.cycle, 1, parameters, mode);
  const jumpState = index.data.states.Jump;
  if (jump !== undefined && jump.weight > 0) {
    check(jumpState, 'Jump layer requires the merged original jump_lower');
    value = accumulateSourceSequence(index, value, jumpState.lower, jump.cycle, jump.weight, parameters, mode);
  }
  value = accumulateSourceSequence(index, value, state.upper, input.upperCycle ?? input.cycle, 1, parameters, mode);
  // The original world-model reload plays over the armed aim layer. The merged
  // Reload_<weapon> wrapper carries no bone weights of its own; its two original
  // auto-layers replace the upper body (the arm/hand reload work) and the legs
  // (the weight shift) under the original envelope, so the pose leaves and
  // returns to the aim by itself while the magazine is out.
  if (reloadLayer !== undefined && reloadLayer.weight > 0) {
    check(index.reload !== null, 'Reload layer requires the merged original Reload graph');
    value = accumulateSourceSequence(index, value, index.reload!.sequence, reloadLayer.cycle, reloadLayer.weight, parameters, mode);
  }
  // The original magazine display window: the reload takes the spent magazine
  // out of the weapon at AE_CL_EJECT_MAG and seats the fresh one at
  // AE_CL_EJECT_MAG_UNHIDE. Without an armed reload layer, and on the corpse,
  // the magazine stays in the weapon.
  const magazineWindow = index.reload?.magazine;
  const magazineVisible = !(magazineWindow !== undefined && magazineWindow !== null &&
    reloadLayer !== undefined && reloadLayer.weight > 0 &&
    reloadLayer.cycle >= magazineWindow.hide && reloadLayer.cycle < magazineWindow.show);
  // The original pin-pull preparation graph runs over the armed aim layer:
  // the Upper_GREN wrapper animates the two weapon hand bones while its
  // original auto-layers blend the 9-way Aim_GREN aim pose and the
  // HandPos_GREN hold; the driver locks the pulled-pin final frame while the
  // throw key stays held.
  if (prep !== undefined && prep.weight > 0) {
    const variant = sequenceFor(index, prep.variant);
    check((variant.flags & 5) === 0 && variant.autoLayers.length === 2, 'Prep layer must reference an original Upper_GREN preparation variant');
    value = accumulateSourceSequence(index, value, variant.index, prep.cycle, prep.weight, parameters, mode);
  }
  // The original Shoot_GREN delta runs over the armed aim layer: the throw
  // variant's 0/1 bone mask keeps locomotion driving the legs while the arm
  // swing is applied on top of the weapon pose.
  if (grenade !== undefined && grenade.weight > 0) {
    const variant = sequenceFor(index, grenade.variant);
    check((variant.flags & 4) !== 0 && (variant.flags & 1) === 0, 'Grenade layer must reference an original Shoot_GREN delta variant');
    value = accumulateSourceSequence(index, value, variant.index, grenade.cycle, grenade.weight, parameters, mode);
  }
  value = accumulateSourceSequence(index, value, state.shoot, input.fireCycle ?? input.cycle, weight, parameters, mode);
  const out = pose(index.mainBoneCount), world = new Float64Array(index.mainBoneCount * 16);
  for (let i = 0; i < index.mainBoneCount; i++) {
    const a = index.data.mainToAnimation[i], bone = index.data.mainBones[i];
    if (a >= 0) { out.positions.set(value.positions.subarray(a * 3, a * 3 + 3), i * 3); out.quaternions.set(value.quaternions.subarray(a * 4, a * 4 + 4), i * 4); }
    else { out.positions.set(bone.position, i * 3); normalize(out.quaternions, i * 4, bone.quaternion[0], bone.quaternion[1], bone.quaternion[2], bone.quaternion[3]); }
    const local = localMatrix(out.positions, i * 3, out.quaternions, i * 4);
    if (bone.parent < 0) world.set(local, i * 16);
    else for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let sum = 0; for (let k = 0; k < 4; k++) sum += world[bone.parent * 16 + k * 4 + r] * local[c * 4 + k]; world[i * 16 + c * 4 + r] = sum;
    }
  }
  const render = copy(out), conversion = new Float64Array([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  for (let i = 0; i < index.mainBoneCount; i++) if (index.data.mainBones[i].parent < 0) {
    render.positions.set([out.positions[i * 3], out.positions[i * 3 + 2], -out.positions[i * 3 + 1]], i * 3);
    multiplyQuaternion(conversion, 0, out.quaternions, i * 4, render.quaternions, i * 4);
  }
  return { ...out, sourceWorldMatrices: world, renderLocalPositions: render.positions, renderLocalQuaternions: render.quaternions,
    animationPose: value, state: input.state, blendMode: mode, magazineVisible };
}

/** Interpolate authority's UNWRAPPED lower/upper cycles, never shortest-wrap
 * them backwards. Caller must require matching pose versions. Only the latest
 * shot reset is recoverable from two elapsed clocks; intervening unreported
 * events require an event history, not invented interpolation.
 */
export function interpolateSourcePoseInput(a: SourceCharacterPoseInput, b: SourceCharacterPoseInput, fraction: number,
  options: { spanSeconds: number }): SourceCharacterPoseInput {
  check(Number.isFinite(fraction) && Number.isFinite(options.spanSeconds) && options.spanSeconds >= 0, 'Invalid source pose interpolation interval');
  const t = clamp(fraction), clone = (p: SourceCharacterPoseInput) => ({ ...p, parameters: { ...p.parameters } });
  if (t === 1) return clone(b);
  if (t === 0 || a.state !== b.state || (a.blendMode ?? 'sdk-3way') !== (b.blendMode ?? 'sdk-3way')) return clone(a);
  const lerp = (x: number, y: number) => x + (y - x) * t, result = clone(a);
  result.cycle = lerp(a.cycle, b.cycle); result.upperCycle = lerp(a.upperCycle ?? a.cycle, b.upperCycle ?? b.cycle);
  for (const key of ['move_x', 'move_y', 'body_yaw', 'body_pitch', 'move_yaw'] as const)
    if (a.parameters[key] !== undefined || b.parameters[key] !== undefined) result.parameters[key] = lerp(a.parameters[key] ?? 0, b.parameters[key] ?? 0);
  const jumpA = a.jump, jumpB = b.jump;
  if (jumpA && jumpB) result.jump = { cycle: lerp(jumpA.cycle, jumpB.cycle), weight: lerp(jumpA.weight, jumpB.weight),
    elapsed: lerp(jumpA.elapsed, jumpB.elapsed), airborne: jumpB.airborne };
  else if (jumpA) result.jump = { ...jumpA, weight: jumpA.weight * (1 - t) };
  else if (jumpB) result.jump = { ...jumpB, weight: jumpB.weight * t };
  // The throw variant follows the live locomotion state; when the state (and
  // therefore the variant) changes mid-throw the two snapshots are not part of
  // one continuous throw pose, so the weights cross-fade instead of blending
  // two different arm swings. The pin-pull preparation layer follows the same
  // rule, and the release style never changes inside one continuous throw.
  const grenadeA = a.grenade, grenadeB = b.grenade;
  if (grenadeA && grenadeB && grenadeA.variant === grenadeB.variant && grenadeA.style === grenadeB.style)
    result.grenade = { cycle: lerp(grenadeA.cycle, grenadeB.cycle), weight: lerp(grenadeA.weight, grenadeB.weight), variant: grenadeB.variant, style: grenadeB.style };
  else if (grenadeA) result.grenade = { ...grenadeA, weight: grenadeA.weight * (1 - t) };
  else if (grenadeB) result.grenade = { ...grenadeB, weight: grenadeB.weight * t };
  const prepA = a.prep, prepB = b.prep;
  if (prepA && prepB && prepA.variant === prepB.variant)
    result.prep = { cycle: lerp(prepA.cycle, prepB.cycle), weight: lerp(prepA.weight, prepB.weight), variant: prepB.variant };
  else if (prepA) result.prep = { ...prepA, weight: prepA.weight * (1 - t) };
  else if (prepB) result.prep = { ...prepB, weight: prepB.weight * t };
  // The reload clock is the weapon's own timer, so two snapshots of one reload
  // are the same continuous action and blend directly; an interrupted reload
  // cross-fades out against the next action instead.
  const reloadA = a.reload, reloadB = b.reload;
  if (reloadA && reloadB) result.reload = { cycle: lerp(reloadA.cycle, reloadB.cycle), weight: lerp(reloadA.weight, reloadB.weight) };
  else if (reloadA) result.reload = { ...reloadA, weight: reloadA.weight * (1 - t) };
  else if (reloadB) result.reload = { ...reloadB, weight: reloadB.weight * t };
  const elapsedA = a.fireTimeSeconds, elapsedB = b.fireTimeSeconds, span = options.spanSeconds;
  if (elapsedA !== undefined && elapsedB !== undefined && a.fireCycleRate !== undefined && b.fireCycleRate !== undefined) {
    check([elapsedA, elapsedB, a.fireCycleRate, b.fireCycleRate].every(n => Number.isFinite(n) && n >= 0), 'Invalid source shot interpolation clock');
    const reset = elapsedB < elapsedA + span - 1e-6, eventAt = span - elapsedB, after = reset && t * span >= eventAt;
    const elapsed = Math.max(0, after ? t * span - eventAt : elapsedA + t * span), rate = after ? b.fireCycleRate : a.fireCycleRate;
    result.fireTimeSeconds = elapsed; result.fireCycleRate = rate; result.fireCycle = clamp(elapsed * rate);
    result.fireWeight = result.fireCycle < 1 ? 1 : 0;
  } else {
    // Legacy caller has no event clock; hold an observed backward shot reset
    // until the later snapshot instead of inventing a backward-playing shot.
    const reset = (b.fireCycle ?? b.cycle) < (a.fireCycle ?? a.cycle);
    result.fireCycle = reset ? a.fireCycle ?? a.cycle : lerp(a.fireCycle ?? a.cycle, b.fireCycle ?? b.cycle);
    result.fireWeight = reset ? a.fireWeight ?? 0 : lerp(a.fireWeight ?? 0, b.fireWeight ?? 0);
    if (elapsedA !== undefined && elapsedB !== undefined) result.fireTimeSeconds = reset ? elapsedA : lerp(elapsedA, elapsedB);
  }
  return result;
}

/** Shared actor-space conversion for renderer, hitboxes and rewind. The caller
 * supplies the SAME column-major actor browser transform used by the GLB parent.
 * Computes actor * scale(metres) * C * SourceBone; C maps (x,y,z) to (x,z,-y).
 * The GLB already owns C in render root locals, so never apply C a second time.
 */
export function sourceCharacterBrowserBoneMatrices(sampled: SourceCharacterPose, actorMatrix: ArrayLike<number>, metersPerSourceUnit = .0254): Float64Array {
  check(actorMatrix.length === 16 && Array.from(actorMatrix).every(Number.isFinite) && actorMatrix[3] === 0 && actorMatrix[7] === 0 && actorMatrix[11] === 0 && actorMatrix[15] === 1,
    'Invalid actor browser affine matrix');
  check(Number.isFinite(metersPerSourceUnit) && metersPerSourceUnit > 0 && sampled.sourceWorldMatrices.length % 16 === 0, 'Invalid Source bone conversion');
  const source = sampled.sourceWorldMatrices, result = new Float64Array(source.length), scale = metersPerSourceUnit;
  for (let at = 0; at < source.length; at += 16) for (let c = 0; c < 4; c++) {
    const x = source[at + c * 4] * scale, y = source[at + c * 4 + 2] * scale, z = -source[at + c * 4 + 1] * scale, w = source[at + c * 4 + 3];
    for (let r = 0; r < 4; r++) result[at + c * 4 + r] = actorMatrix[r] * x + actorMatrix[4 + r] * y + actorMatrix[8 + r] * z + actorMatrix[12 + r] * w;
  }
  return result;
}

/** Original hitbox metadata + this very pose's Source bone matrix. Extension
 * bytes are unresolved; this deliberately does not pretend every shape is a box.
 */
export function sourceCharacterHitboxTransforms(index: SourceCharacterPoseIndex, sampled: SourceCharacterPose, setIndex = 0) {
  const set = index.data.hitboxSets[setIndex]; check(set && sampled.sourceWorldMatrices.length === index.mainBoneCount * 16, 'Invalid source hitbox pose/set');
  return set.hitboxes.map(hitbox => ({ hitbox, sourceBoneMatrix: sampled.sourceWorldMatrices.slice(hitbox.bone * 16, hitbox.bone * 16 + 16) }));
}
