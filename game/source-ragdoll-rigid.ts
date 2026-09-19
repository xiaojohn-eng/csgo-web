import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { SourceRagdollGround, SourceRagdollIndex, SourceRagdollRest, SourceRagdollState } from './source-ragdoll.js';

/** Rigid body adapter, not a VPhysics implementation. Original PHY masses,
 * damping and joint limits are retained. Contact volumes are the shipped
 * character hitbox bounds; they are not claimed to be the PHY convex hulls. */
export type SourceRigidRagdoll = {
  read(dt: number): Pick<SourceRagdollState, 'positions' | 'quaternions' | 'settled'>;
  dispose(): void;
};
const vector = (a: ArrayLike<number>, at = 0) => new Vector3(a[at], a[at + 1], a[at + 2]);
const quaternion = (a: ArrayLike<number>, at = 0) => new Quaternion(a[at], a[at + 1], a[at + 2], a[at + 3]).normalize();
export function sourceRagdollWorldBasis(ground?: Pick<SourceRagdollGround, 'yaw'>) {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (ground?.yaw ?? -Math.PI / 2) + Math.PI / 2)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
}
export function sourceRagdollVelocityFromWorld(ground: SourceRagdollGround, velocity: { x: number; y: number; z: number }) {
  return new Vector3(velocity.x, velocity.y, velocity.z).applyQuaternion(sourceRagdollWorldBasis(ground).invert())
    .multiplyScalar(1 / ground.metersPerSourceUnit);
}

export function createSourceRigidRagdoll(index: SourceRagdollIndex, rest: SourceRagdollRest,
  velocity: { x: number; y: number; z: number }, impulse: { x: number; y: number; z: number }, ground?: SourceRagdollGround): SourceRigidRagdoll {
  const scale = ground?.metersPerSourceUnit ?? .0254, basis = sourceRagdollWorldBasis(ground), inverse = basis.clone().invert();
  const origin = new Vector3(ground?.x ?? 0, ground?.y ?? 0, ground?.z ?? 0);
  const externalWorld = ground?.physicsWorld;
  const world = externalWorld ?? new RAPIER.World({ x: 0, y: -800 * scale, z: 0 });
  if (!externalWorld) {
    world.integrationParameters.numSolverIterations = 12;
    world.createCollider(RAPIER.ColliderDesc.cuboid(100, .5, 100).setTranslation(0, rest.groundZ * scale - .5, 0));
  }
  const linear = new Vector3(velocity.x + impulse.x, velocity.y + impulse.y, velocity.z + impulse.z).multiplyScalar(scale).applyQuaternion(basis);
  const bodies: RAPIER.RigidBody[] = [];
  let disposed = false, time = 0, quietFor = 0;
  let quietPose: { p: Vector3; q: Quaternion }[] | undefined;
  // Bound the displacement of every point on each original contact box,
  // including its offset from the animated bone origin.
  const radii = index.partShapes.map(shape => Math.hypot(...shape.center.map((v, i) => Math.abs(v) + shape.halfExtents[i])) * scale);
  let frozen: ReturnType<SourceRigidRagdoll['read']> | undefined;
  try {
    for (const [i, part] of index.data.parts.entries()) {
      const p = vector(rest.positions, i * 3).multiplyScalar(scale).applyQuaternion(basis).add(origin);
      const q = basis.clone().multiply(quaternion(rest.quaternions, i * 4));
      // Hard per-body CCD truncates one link while its neighbors advance and
      // tears an articulated skeleton apart. Predictive soft CCD preserves
      // joint solving for the whole chain at the authority's fixed timestep.
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(q)
        .setLinvel(linear.x, linear.y, linear.z).setLinearDamping(part.damping).setAngularDamping(part.rotdamping)
        .setAdditionalSolverIterations(8).setSoftCcdPrediction(.1));
      bodies.push(body);
      const shape = index.partShapes[i];
      const half = vector(shape.halfExtents).multiplyScalar(scale), center = vector(shape.center).multiplyScalar(scale);
      world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z)
        .setMass(part.mass).setFriction(.7).setRestitution(0).setCollisionGroups((4 << 16) | 4), body);
    }
    for (const def of index.data.joints) {
      const parentQ = quaternion(rest.quaternions, def.parent * 4);
      const childOrigin = vector(rest.positions, def.child * 3), parentOrigin = vector(rest.positions, def.parent * 3);
      const anchor = childOrigin.sub(parentOrigin).applyQuaternion(parentQ.clone().invert()).multiplyScalar(scale);
      const joint = world.createImpulseJoint(RAPIER.JointData.generic(anchor, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
        RAPIER.JointAxesMask.LinX | RAPIER.JointAxesMask.LinY | RAPIER.JointAxesMask.LinZ), bodies[def.parent], bodies[def.child], true);
      joint.setContactsEnabled(false);
      // PHY angles refer to the original model's joint frames, not the arbitrary
      // animation playing at death. Calibrate from the immutable inverse binds.
      const parentBind = new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(index.partInverseBinds[def.parent]).invert());
      const childBind = new Quaternion().setFromRotationMatrix(new Matrix4().fromArray(index.partInverseBinds[def.child]).invert());
      const frame = parentBind.invert().multiply(childBind).normalize();
      const rawAnchor = RAPIER.VectorOps.intoRaw(anchor);
      const rawRotation = RAPIER.RotationOps.intoRaw(frame);
      try { world.impulseJoints.raw.jointSetLocalFrame1(joint.handle, rawAnchor, rawRotation); }
      finally { rawAnchor.free(); rawRotation.free(); }
      for (const [axis, limits] of [[RAPIER.JointAxis.AngX, def.x], [RAPIER.JointAxis.AngY, def.y], [RAPIER.JointAxis.AngZ, def.z]] as const)
        world.impulseJoints.raw.jointSetLimits(joint.handle, axis as unknown as Parameters<typeof world.impulseJoints.raw.jointSetLimits>[1], limits[0] * Math.PI / 180, limits[1] * Math.PI / 180);
    }
    // Original hitbox bounds overlap within the torso. A loose rope only
    // disables those contacts; it does not constrain an additional orientation.
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++)
      if (/(Pelvis|Spine)/.test(index.data.parts[i].bone) && /(Pelvis|Spine)/.test(index.data.parts[j].bone)) {
        const ignored = world.createImpulseJoint(RAPIER.JointData.rope(1000, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), bodies[i], bodies[j], true);
        ignored.setContactsEnabled(false);
      }
  } catch (error) {
    for (const body of bodies) if (body.isValid()) world.removeRigidBody(body);
    if (!externalWorld) world.free();
    throw error;
  }
  return {
    read(dt) {
      if (disposed) throw new Error('Disposed rigid ragdoll');
      if (frozen && bodies.every(body=>body.isSleeping())) return frozen;
      // A sleeping corpse can be pushed awake by another body in the shared
      // authority world. Resume the stream instead of freezing a stale drawing
      // while its real contact volumes move elsewhere.
      if (frozen) { frozen=undefined;quietFor=0;quietPose=undefined; }
      if (!Number.isFinite(dt) || dt < 0 || dt > .1) throw new Error('Invalid rigid ragdoll dt');
      if (!externalWorld && dt > 0) { world.timestep = dt; world.step(); }
      time += dt;
      const positions: number[] = [], quaternions: number[] = [];
      const poses: { p: Vector3; q: Quaternion }[] = [];
      for (const body of bodies) {
        const p = body.translation(), q = body.rotation();
        poses.push({p:new Vector3(p.x,p.y,p.z),q:new Quaternion(q.x,q.y,q.z,q.w).normalize()});
        positions.push(...new Vector3(p.x, p.y, p.z).sub(origin).applyQuaternion(inverse).multiplyScalar(1 / scale).toArray());
        quaternions.push(...inverse.clone().multiply(new Quaternion(q.x, q.y, q.z, q.w)).normalize().toArray());
      }
      // Contact constraints can report oscillating velocities while all actual
      // surfaces remain within millimetres (notably a dropped gun under a hand).
      // Require a supported connected skeleton and a continuous, bounded pose
      // window instead. Self contact cannot make an airborne corpse settle.
      let supported = false;
      if (dt > 0 && time > .5) for (const body of bodies) {
        const collider = body.collider(0);
        world.contactPairsWith(collider, other => {
          const parent = other.parent();
          if (supported || parent && (bodies.some(b => b.handle === parent.handle) || parent.isDynamic() && !parent.isSleeping())) return;
          world.contactPair(collider, other, manifold => {
            for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) < .003) supported = true;
          });
        });
        if (supported) break;
      }
      const bounded = quietPose && poses.every(({p,q},i) => {
        const distance = p.distanceTo(quietPose![i].p), angle = q.angleTo(quietPose![i].q);
        return distance <= .003 && distance + 2 * radii[i] * Math.sin(angle / 2) <= .01;
      });
      if (!supported) { quietFor = 0; quietPose = undefined; }
      else if (!bounded) { quietFor = 0; quietPose = poses; }
      else quietFor += dt;
      const result = { positions: positions.map(v => Math.round(v * 1e5) / 1e5),
        quaternions: quaternions.map(v => Math.round(v * 1e7) / 1e7), settled: quietFor >= .6 || bodies.every(b => b.isSleeping()) };
      if (result.settled) { for (const body of bodies) body.sleep(); frozen = result; }
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const body of bodies) if (body.isValid()) world.removeRigidBody(body);
      if (!externalWorld) world.free();
    },
  };
}
