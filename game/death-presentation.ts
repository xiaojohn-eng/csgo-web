import * as T from 'three';

export type DeathPresentationSnapshot = {
  phase: 'alive' | 'falling' | 'held' | 'retiring' | 'hidden';
  elapsed: number;
  visible: boolean;
};

export const DEATH_PRESENTATION = {
  fallSeconds: .72,
  holdSeconds: 2.4,
  sinkSeconds: .4,
  maxFrameSeconds: .1,
} as const;

type DeathState = {
  body: T.Object3D;
  wrapper: T.Group;
  dead: boolean;
  elapsed: number;
  groundLift: number;
  deathFrameInverse: T.Matrix4;
  sampledFrameInverse: T.Matrix4;
  proxies: { bone: T.Bone; world: T.Matrix4 }[];
  skeletons: Set<T.Skeleton>;
};
const states = new WeakMap<T.Group, DeathState>();
const fallenRotation = new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, .1));
const identity = new T.Quaternion();
const smooth = (value: number) => { const t = T.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/** Bind AFTER SkeletonUtils.clone, while body is a direct child of its authority root.
 * The identity wrapper preserves the original body import rotation, all bone transforms,
 * geometry and materials. State is private per root and is never copied through userData.
 */
export function bindDeathPresentation(root: T.Group, body: T.Object3D): T.Group {
  const bound = states.get(root);
  if (bound) {
    if (bound.body !== body) throw new Error('Death presentation root already owns a different body');
    return bound.wrapper;
  }
  if (body.parent !== root) throw new Error('Death presentation body must be a direct child of root');
  const wrapper = new T.Group(); wrapper.name = 'DeathPresentation';
  root.add(wrapper); wrapper.add(body);
  states.set(root, { body, wrapper, dead: false, elapsed: 0, groundLift: 0,
    deathFrameInverse: new T.Matrix4(), sampledFrameInverse: new T.Matrix4(), proxies: [], skeletons: new Set() });
  root.updateWorldMatrix(true, true);
  states.get(root)!.sampledFrameInverse.copy(wrapper.matrixWorld).invert();
  return wrapper;
}

/** Record the world frame immediately AFTER a full living (or initial) C02 pose sample.
 * Detached palette matrices use that frame until the next sample, even when authority
 * position/yaw advances immediately before a death update.
 */
export function markLivingPose(root: T.Group): void {
  const state = states.get(root); if (!state || state.dead) return;
  root.updateWorldMatrix(true, true);
  state.sampledFrameInverse.copy(state.wrapper.matrixWorld).invert();
}

function capturePrivatePalettes(root: T.Group, state: DeathState): void {
  root.updateWorldMatrix(true, true); root.updateMatrixWorld(true);
  state.deathFrameInverse.copy(state.wrapper.matrixWorld).invert();
  const authorityDelta = state.wrapper.matrixWorld.clone().multiply(state.sampledFrameInverse);
  const seen = new Set<T.Bone>();
  state.body.traverse(object => {
    if (!(object instanceof T.SkinnedMesh)) return;
    for (const bone of object.skeleton.bones) {
      // ACTION03's patella proxies deliberately live outside the body hierarchy.
      if (!bone.name.startsWith('ACTION03_') || bone.parent || bone.matrixWorldAutoUpdate) continue;
      state.skeletons.add(object.skeleton);
      if (!seen.has(bone)) {
        seen.add(bone);
        bone.matrixWorld.premultiply(authorityDelta);
        state.proxies.push({ bone, world: bone.matrixWorld.clone() });
      }
    }
  });
}

function updatePrivatePalettes(state: DeathState): void {
  const delta = state.wrapper.matrixWorld.clone().multiply(state.deathFrameInverse);
  for (const proxy of state.proxies) proxy.bone.matrixWorld.copy(delta).multiply(proxy.world);
  for (const skeleton of state.skeletons) skeleton.update();
}

function restorePrivatePalettes(state: DeathState): void {
  for (const proxy of state.proxies) proxy.bone.matrixWorld.copy(proxy.world);
  for (const skeleton of state.skeletons) skeleton.update();
  state.proxies = []; state.skeletons.clear();
}

/** Once per death, measure the frozen actual posed geometry at the final fallen rotation.
 * Actor roots use the game's metres/yaw-only transform. A floor-relative vertical lift
 * keeps the settled body above its death position, including its original weapon pose.
 */
function measureGroundLift(root: T.Group, state: DeathState): number {
  const { wrapper } = state;
  wrapper.quaternion.copy(fallenRotation);
  root.updateMatrixWorld(true); updatePrivatePalettes(state);
  const bounds = new T.Box3().setFromObject(wrapper, true);
  const floor = root.getWorldPosition(new T.Vector3()).y;
  const scale = root.getWorldScale(new T.Vector3()).y;
  const lift = bounds.isEmpty() ? .04 : (floor + .035 - bounds.min.y) / Math.max(1e-6, scale);
  wrapper.quaternion.identity();
  root.updateMatrixWorld(true); updatePrivatePalettes(state);
  return lift;
}

/** A locally authored rigid fall/hold/retire transition; this is neither mocap nor ragdoll.
 * Call for alive AND dead actors even when their wrapper has become hidden. The caller
 * owns body.visible and should keep it true; only this wrapper's visibility is changed.
 * Freeze the last sampled pose while dead. Continue sampling the living pose on revival.
 * Authority root position/yaw, original bone local transforms and hit volumes are never
 * modified. Only ACTION03's detached private palette proxies follow the wrapper's world
 * delta. On revival this runs BEFORE the living pose sampler, restoring those proxies.
 */
export function updateDeathPresentation(
  body: T.Object3D, root: T.Group, alive: boolean, dt: number,
): DeathPresentationSnapshot {
  bindDeathPresentation(root, body);
  const state = states.get(root)!, { wrapper } = state;
  if (alive) {
    if (state.dead) restorePrivatePalettes(state);
    state.dead = false; state.elapsed = 0; state.groundLift = 0;
    wrapper.position.set(0, 0, 0); wrapper.quaternion.identity(); wrapper.scale.set(1, 1, 1);
    wrapper.visible = true; wrapper.updateWorldMatrix(false, true);
    return { phase: 'alive', elapsed: 0, visible: true };
  }
  if (!state.dead) {
    state.dead = true; state.elapsed = 0;
    capturePrivatePalettes(root, state); state.groundLift = measureGroundLift(root, state);
  }
  const delta = Number.isFinite(dt) ? T.MathUtils.clamp(dt, 0, DEATH_PRESENTATION.maxFrameSeconds) : 0;
  const retireAt = DEATH_PRESENTATION.fallSeconds + DEATH_PRESENTATION.holdSeconds;
  const finishAt = retireAt + DEATH_PRESENTATION.sinkSeconds;
  state.elapsed = Math.min(finishAt, state.elapsed + delta);
  const progress = T.MathUtils.clamp(state.elapsed / DEATH_PRESENTATION.fallSeconds, 0, 1);
  // A small initial impact velocity avoids a stationary first beat, then settles smoothly.
  const fall = .2 * progress + .8 * smooth(progress);
  const sink = smooth((state.elapsed - retireAt) / DEATH_PRESENTATION.sinkSeconds);
  wrapper.quaternion.slerpQuaternions(identity, fallenRotation, fall);
  wrapper.position.set(0, state.groundLift * fall - .28 * sink, -.12 * fall);
  wrapper.visible = state.elapsed < finishAt;
  root.updateWorldMatrix(true, true); root.updateMatrixWorld(true); updatePrivatePalettes(state);
  const phase = !wrapper.visible ? 'hidden' : state.elapsed >= retireAt ? 'retiring'
    : state.elapsed >= DEATH_PRESENTATION.fallSeconds ? 'held' : 'falling';
  return { phase, elapsed: state.elapsed, visible: wrapper.visible };
}

/** Detach the private wrapper before disposing or replacing a living actor.
 * The unchanged body local transform becomes relative to the original root again.
 */
export function unbindDeathPresentation(root: T.Group): void {
  const state = states.get(root); if (!state) return;
  restorePrivatePalettes(state);
  root.add(state.body); state.wrapper.removeFromParent(); states.delete(root);
  state.body.updateWorldMatrix(true, true);
}
