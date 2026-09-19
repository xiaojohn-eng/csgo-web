import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { shareEquivalentSkeletons } from './share-skeleton';

export const FALCON_C02_SHA256 = 'a541aeb26e0e6154830e23f2f6c3c978e54b0209f0e930564bb5f43545adfa2a';
export const FALCON_C02_URL = '/models/web-w01/falcon-combat-actions.glb';
export type FalconPose = 'Rifle_Idle' | 'Rifle_Fire' | 'Rifle_Reload';
export const FALCON_STATIC_WEAPONS = {
  sidearm: { url: '/models/web-w02/weapon/falcon-p12.glb', bytes: 16962276,
    sha256: '2b00f4b4632c4b1965fe3bacd3aab66cc8d4461f3375144b7151668812d1c2b5' },
  marshal: { url: '/models/web-w02/weapon/falcon-dmr.glb', bytes: 17447156,
    sha256: '826b7c8a4339e9d153dbf664acc499e2c61b67cfb9d8056de10ac4a3a5010164' },
} as const;
type State = {
  body: T.Object3D; facing: T.Group; mixer: T.AnimationMixer;
  actions: Map<FalconPose, T.AnimationAction>; current: FalconPose;
  muzzle: T.Object3D; magazine: T.Object3D; rightHand: T.Object3D; leftHand: T.Object3D;
  elapsed: number; fireTime: number; lastKick: number;
  shoulderAnchors?: { L: T.Vector3; R: T.Vector3 };
  ownedGeometry: T.BufferGeometry[]; ownedSkeletons: Set<T.Skeleton>; report: Record<string, unknown>;
};
const STATE = 'falconFirstPerson';
const scratch = new T.Vector3();

function required(root: T.Object3D, name: string) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`FALCON C02 missing ${name}`);
  return object;
}

/** Clone the approved combined asset. Never rebind the gun or merge unrelated clips. */
export function createFalconViewmodel(gltf: GLTF): T.Group {
  const root = new T.Group(); root.name = 'Falcon_C02_FirstPerson';
  const facing = new T.Group(); facing.name = 'CharacterPlusZToGameplayMinusZ';
  facing.rotation.y = Math.PI; root.add(facing);
  const body = clone(gltf.scene); facing.add(body);
  const ownedSkeletons = shareEquivalentSkeletons(body);
  const mixer = new T.AnimationMixer(body);
  const actions = new Map<FalconPose, T.AnimationAction>();
  for (const name of ['Rifle_Idle', 'Rifle_Fire', 'Rifle_Reload'] as const) {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error(`FALCON C02 missing original ${name}`);
    const action = mixer.clipAction(clip); action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true; actions.set(name, action);
  }
  const state: State = { body, facing, mixer, actions, current: 'Rifle_Idle',
    muzzle: required(body, 'Socket_Muzzle'), magazine: required(body, 'Magazine_Root'),
    rightHand: required(body, 'Bip01_R_Hand'), leftHand: required(body, 'Bip01_L_Hand'),
    elapsed: 0, fireTime: Infinity, lastKick: 0, ownedGeometry: [], ownedSkeletons, report: {} };
  root.userData[STATE] = state;
  setFalconPose(root, 'Rifle_Idle', 0);

  // Keep every original vertex attribute/PBR texture. Only non-arm triangles are omitted.
  const crop: { name: string; sourceTriangles: number; armTriangles: number }[] = [];
  body.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    object.frustumCulled = false;
    if (!(object instanceof T.SkinnedMesh)) return; // Full original 16-mesh M4.
    const source = object.geometry, index = source.index;
    const joints = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight');
    if (!joints || !weights) throw new Error(`Missing original skin attributes: ${object.name}`);
    const armBones = new Set(object.skeleton.bones.map((b, i) =>
      /^Bip01_[LR]_(UpperArm|Forearm|Hand|Finger)/.test(b.name) ? i : -1));
    const count = source.getAttribute('position').count;
    const armWeight = new Float32Array(count);
    for (let v = 0; v < count; v++) for (let j = 0; j < 4; j++) {
      if (armBones.has(joints.getComponent(v, j))) armWeight[v] += weights.getComponent(v, j);
    }
    const kept: number[] = [], total = index ? index.count : count;
    for (let i = 0; i < total; i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      if (Math.min(armWeight[a], armWeight[b], armWeight[c]) >= 0.45) kept.push(a, b, c);
    }
    crop.push({ name: object.name, sourceTriangles: total / 3, armTriangles: kept.length / 3 });
    if (!kept.length) { object.visible = false; return; }
    const geometry = source.clone(); geometry.setIndex(kept);
    // GLTFLoader has already split primitives/materials into separate meshes.
    geometry.clearGroups(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    object.geometry = geometry; state.ownedGeometry.push(geometry);
  });

  // Derive the camera frame from the real eye midpoint and the rifle bore direction.
  // Only the camera mount changes; skeleton, gun/hand calibration and scale stay intact.
  root.updateMatrixWorld(true);
  const eye = required(body, 'Bip01_LEye').getWorldPosition(new T.Vector3())
    .add(required(body, 'Bip01_REye').getWorldPosition(new T.Vector3())).multiplyScalar(0.5);
  const weapon = required(body, 'Weapon_Root');
  const forward = new T.Vector3(0, 0, -1).transformDirection(weapon.matrixWorld);
  const eyeFrame = new T.Matrix4().lookAt(eye, eye.clone().add(forward), new T.Vector3(0, 1, 0));
  const inverse = new T.Quaternion().setFromRotationMatrix(eyeFrame).invert();
  root.quaternion.copy(inverse); root.position.copy(eye).negate().applyQuaternion(inverse);
  root.updateMatrixWorld(true);
  // Solve the FPS camera frame from muzzle and right-hand screen anchors. The buttstock
  // may leave the lower-right view naturally; it is never removed or scaled down.
  const muzzle = state.muzzle.getWorldPosition(new T.Vector3());
  const grip = state.rightHand.getWorldPosition(new T.Vector3());
  const tan = Math.tan(T.MathUtils.degToRad(62 / 2)), horizontalTan = tan * 16 / 9;
  const muzzleX = .14, muzzleY = -.08, gripX = .58, gripY = -.96;
  // A small off-axis camera view exposes the receiver side instead of the stock rear face.
  const offAxis = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), .22);
  function framing(pitch: number) {
    const rotation = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), pitch).multiply(offAxis);
    const m = muzzle.clone().applyQuaternion(rotation), g = grip.clone().applyQuaternion(rotation);
    const z = (-(g.x - m.x) / horizontalTan - gripX * g.z + muzzleX * m.z) / (gripX - muzzleX);
    const depthM = -m.z - z, depthG = -g.z - z;
    return { rotation, error: g.y - m.y - tan * (gripY * depthG - muzzleY * depthM),
      offset: new T.Vector3(muzzleX * horizontalTan * depthM - m.x, muzzleY * tan * depthM - m.y, z) };
  }
  let low = -.5, high = .5;
  const lowSign = Math.sign(framing(low).error);
  if (lowSign === Math.sign(framing(high).error)) throw new Error('C02 eye/grip FPS framing has no bounded solution');
  for (let i = 0; i < 45; i++) {
    const middle = (low + high) / 2;
    if (Math.sign(framing(middle).error) === lowSign) low = middle; else high = middle;
  }
  const presentationPitch = (low + high) / 2, solved = framing(presentationPitch);
  root.quaternion.premultiply(solved.rotation); root.position.applyQuaternion(solved.rotation).add(solved.offset);
  const cameraStandoff = solved.offset;
  root.updateMatrixWorld(true);
  const anchors = {} as { L: T.Vector3; R: T.Vector3 };
  for (const side of ['L', 'R'] as const) {
    const upper = required(body, `Bip01_${side}_UpperArm`).getWorldPosition(new T.Vector3());
    const elbow = required(body, `Bip01_${side}_Forearm`).getWorldPosition(new T.Vector3());
    const wrist = required(body, `Bip01_${side}_Hand`).getWorldPosition(new T.Vector3());
    const reach = upper.distanceTo(elbow) + elbow.distanceTo(wrist);
    anchors[side] = wrist.clone().addScaledVector(new T.Vector3(side === 'L' ? -.22 : .22, -.92, .32).normalize(), reach * .9);
  }
  state.shoulderAnchors = anchors;
  fitArm(root, state, 'L'); fitArm(root, state, 'R');
  state.report = { sourceSha256: FALCON_C02_SHA256, cameraEyeAfterFacing: eye.toArray(),
    sourceBoreAfterFacing: forward.toArray(), cameraFrameQuaternion: inverse.toArray(),
    wholeRigCameraStandoff: cameraStandoff.toArray(), framingReference: { fov: 62, aspect: 16 / 9, muzzleNDC: [muzzleX, muzzleY], rightHandNDC: [gripX, gripY], offAxisCameraYaw: .22, solvedPresentationPitch: presentationPitch },
    cameraFramePosition: root.position.toArray(), scale: 1, crop, originalWeaponMeshes: 16,
    armAdaptation: 'Two-bone arms; original segment lengths and complete wrist world matrices preserved; shoulders outside FP frame',
    shoulderCameraAnchors: { left: anchors.L.toArray(), right: anchors.R.toArray() },
    clipNames: [...actions.keys()], bodyHeadGeometryHidden: true };
  return root;
}

export function isFalconViewmodel(root: T.Object3D): boolean { return !!root.userData[STATE]; }

/** Complete static P12/DMR; authored metres/-Z. No rifle hands or invented reload clips. */
export function createFalconStaticWeapon(gltf: GLTF, id: keyof typeof FALCON_STATIC_WEAPONS): T.Group {
  const root = new T.Group(); root.name = `Falcon_${id}_StaticViewmodel`;
  const source = clone(gltf.scene); root.add(source);
  const grip = required(source, 'Socket_Grip_R'); required(source, 'Socket_Muzzle');
  root.updateMatrixWorld(true);
  if (grip.getWorldPosition(new T.Vector3()).length() > 1e-5) throw new Error('Static weapon grip origin changed');
  root.userData.falconStaticWeapon = id;
  root.userData.handPoseVerified = false;
  root.userData.reloadAnimationVerified = false;
  return root;
}

/** Sample the original synchronized bone/Weapon_Root/Magazine_Root tracks at one time. */
export function setFalconPose(root: T.Object3D, name: FalconPose, seconds: number) {
  const s = root.userData[STATE] as State;
  if (!s) throw new Error('Not a FALCON first-person viewmodel');
  s.mixer.stopAllAction();
  const action = s.actions.get(name)!;
  action.reset().play(); action.paused = true;
  action.time = T.MathUtils.clamp(seconds, 0, action.getClip().duration);
  s.mixer.update(0); root.updateMatrixWorld(true);
  if (s.shoulderAnchors) { fitArm(root, s, 'L'); fitArm(root, s, 'R'); }
  s.current = name;
}

function setWorldMatrix(object: T.Object3D, world: T.Matrix4) {
  const local = object.parent ? object.parent.matrixWorld.clone().invert().multiply(world) : world;
  local.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrix(); object.updateWorldMatrix(false, true);
}

/** First-person shoulder placement with exact authored wrist/grasp preservation. */
function fitArm(root: T.Object3D, s: State, side: 'L' | 'R') {
  const upper = required(s.body, `Bip01_${side}_UpperArm`), forearm = required(s.body, `Bip01_${side}_Forearm`);
  const clavicle = required(s.body, `Bip01_${side}_Clavicle`), hand = required(s.body, `Bip01_${side}_Hand`);
  const handWorld = hand.matrixWorld.clone(), upperWorld = upper.matrixWorld.clone();
  const oldShoulder = upper.getWorldPosition(new T.Vector3()), oldElbow = forearm.getWorldPosition(new T.Vector3());
  const wrist = hand.getWorldPosition(new T.Vector3());
  const a = oldShoulder.distanceTo(oldElbow), b = oldElbow.distanceTo(wrist);
  const shoulder = s.shoulderAnchors![side].clone();
  // The mount is normally under an identity gun parent. Account for cosmetic parent bob.
  if (root.parent) root.parent.localToWorld(shoulder);
  const direction = wrist.clone().sub(shoulder), rawDistance = direction.length(); direction.normalize();
  const distance = T.MathUtils.clamp(rawDistance, Math.abs(a - b) + .0001, a + b - .0001);
  shoulder.addScaledVector(direction, rawDistance - distance);
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const pole = new T.Vector3(side === 'L' ? -1 : 1, 0, .25);
  if (root.parent) pole.transformDirection(root.parent.matrixWorld);
  pole.addScaledVector(direction, -pole.dot(direction)).normalize();
  const elbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, height);
  const upperQ = new T.Quaternion().setFromUnitVectors(oldElbow.clone().sub(oldShoulder).normalize(), elbow.clone().sub(shoulder).normalize())
    .multiply(upper.getWorldQuaternion(new T.Quaternion()));
  const forearmQ = new T.Quaternion().setFromUnitVectors(wrist.clone().sub(oldElbow).normalize(), wrist.clone().sub(elbow).normalize())
    .multiply(forearm.getWorldQuaternion(new T.Quaternion()));
  const nextUpper = new T.Matrix4().compose(shoulder, upperQ, upper.getWorldScale(new T.Vector3()));
  const delta = nextUpper.clone().multiply(upperWorld.invert());
  setWorldMatrix(clavicle, delta.multiply(clavicle.matrixWorld.clone()));
  setWorldMatrix(forearm, new T.Matrix4().compose(elbow, forearmQ, forearm.getWorldScale(new T.Vector3())));
  setWorldMatrix(hand, handWorld);
  root.updateMatrixWorld(true);
}

export function updateFalconViewmodel(root: T.Object3D, input: {
  dt: number; reloadRemaining: number; reloadDuration: number; kick: number; acceptedShot?: boolean;
}) {
  const s = root.userData[STATE] as State;
  s.elapsed += Math.max(0, input.dt);
  // Explicit acceptedShot is available; kick follows the game's existing predicted/confirmed presentation.
  if (input.acceptedShot || input.kick > s.lastKick + 0.25) s.fireTime = 0;
  else s.fireTime += Math.max(0, input.dt);
  s.lastKick = input.kick;
  if (input.reloadRemaining > 0) {
    const progress = 1 - input.reloadRemaining / Math.max(0.001, input.reloadDuration);
    setFalconPose(root, 'Rifle_Reload', T.MathUtils.clamp(progress, 0, 1) * s.actions.get('Rifle_Reload')!.getClip().duration);
  } else if (s.fireTime < s.actions.get('Rifle_Fire')!.getClip().duration) {
    setFalconPose(root, 'Rifle_Fire', s.fireTime);
  } else setFalconPose(root, 'Rifle_Idle', s.elapsed % 4);
}

/** The effect group may be a sibling of this model: return socket transform in that parent. */
export function updateFalconMuzzle(root: T.Object3D, effect: T.Object3D) {
  const socket = (root.userData[STATE] as State | undefined)?.muzzle ?? required(root, 'Socket_Muzzle');
  root.updateWorldMatrix(true, true); effect.parent?.updateWorldMatrix(true, false);
  const matrix = new T.Matrix4().copy(socket.matrixWorld);
  if (effect.parent) matrix.premultiply(effect.parent.matrixWorld.clone().invert());
  matrix.decompose(effect.position, effect.quaternion, effect.scale);
}

export function inspectFalconViewmodel(root: T.Object3D) {
  const s = root.userData[STATE] as State; root.updateMatrixWorld(true);
  const local = (o: T.Object3D) => root.parent ? root.parent.worldToLocal(o.getWorldPosition(scratch)).toArray() : o.getWorldPosition(scratch).toArray();
  return { ...s.report, pose: s.current, muzzle: local(s.muzzle), magazine: local(s.magazine),
    rightHand: local(s.rightHand), leftHand: local(s.leftHand),
    weaponToRightHand: s.rightHand.matrixWorld.clone().invert().multiply(required(s.body, 'Weapon_Root').matrixWorld).toArray(),
    magazineLocal: s.magazine.position.toArray(), materialPolicy: 'unchanged embedded PBR; no tint/atlas replacement' };
}

export function disposeFalconViewmodel(root: T.Object3D) {
  const s = root.userData[STATE] as State | undefined; if (!s) return;
  s.mixer.stopAllAction(); s.mixer.uncacheRoot(s.body);
  s.ownedSkeletons.forEach(skeleton => skeleton.dispose());
  s.ownedGeometry.forEach(g => g.dispose()); delete root.userData[STATE];
  // Source geometry, textures and materials are shared with the GameAssets cache.
}
