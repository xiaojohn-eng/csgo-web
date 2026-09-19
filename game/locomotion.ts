/** Pure shared clock. Phase is UNWRAPPED cycles; only the sampler takes its fraction. */
export type LocomotionState = { stridePhase: number; strideWeight: number; strideSpeed: number };
/** Optional only for old saved poses/fixtures. Live authority always writes all five. */
export type LocomotionPose = Partial<LocomotionState> & {strideX?:number;strideZ?:number;grounded?:boolean};
export type CompleteLocomotion = LocomotionState & {strideX:number;strideZ:number};
export function readLocomotion(p:LocomotionPose):CompleteLocomotion {
  if(p.stridePhase===undefined||p.strideWeight===undefined||p.strideSpeed===undefined)
    return {stridePhase:0,strideWeight:0,strideSpeed:0,strideX:0,strideZ:-1};
  const state={stridePhase:p.stridePhase,strideWeight:p.strideWeight,strideSpeed:p.strideSpeed};
  checkState(state);
  const x=p.strideX??0,z=p.strideZ??-1,length=Math.hypot(x,z);
  if(!Number.isFinite(length))throw new RangeError('Invalid locomotion direction');
  return {...state,strideX:Math.abs(length-1)<1e-12?x:length>1e-8?x/length:0,
    strideZ:Math.abs(length-1)<1e-12?z:length>1e-8?z/length:-1};
}
/** Phase stays unwrapped; angular interpolation avoids zero-length opposite directions. */
export function interpolateLocomotion(a:LocomotionPose,b:LocomotionPose,t:number):CompleteLocomotion {
  const from=readLocomotion(a),to=readLocomotion(b),alpha=clamp(t,0,1);
  const start=Math.atan2(from.strideZ,from.strideX),end=Math.atan2(to.strideZ,to.strideX);
  let delta=Math.atan2(Math.sin(end-start),Math.cos(end-start));
  if(Math.abs(Math.abs(delta)-Math.PI)<1e-12)delta=Math.PI;
  const angle=start+delta*alpha;
  return {stridePhase:mix(from.stridePhase,to.stridePhase,alpha),
    strideWeight:mix(from.strideWeight,to.strideWeight,alpha),strideSpeed:mix(from.strideSpeed,to.strideSpeed,alpha),
    strideX:Math.cos(angle),strideZ:Math.sin(angle)};
}
export type LocomotionPoint = { x: number; y: number; z: number };
export type FootTarget = {
  phase: number;
  position: LocomotionPoint;
  offset: LocomotionPoint;
  hip: LocomotionPoint;
  knee: LocomotionPoint;
  upperLength: number;
  lowerLength: number;
  contact: boolean;
};
export type FootTargetOptions = {
  direction: { x: number; z: number };
  crouch: number | boolean;
  grounded: boolean;
  pelvisShift?: LocomotionPoint;
};
export type FootTargets = {
  left: FootTarget;
  right: FootTarget;
  pelvisDrop: number;
  cadenceHz: number;
  dutyFactor: number;
};

// Frozen C02 Idle0 calibration after the original PI import rotation. Metres,
// actor +X right, +Y up, -Z forward. These are ankle BONES, not sole contacts.
// Verified against the shipped GLB, also used by falcon-body-reference.ts.
const LEGS = [
  {
    side: -1,
    hip: { x: -0.088368515, y: 0.895185168, z: 0.000000125 },
    knee: { x: -0.109481654, y: 0.4970426, z: -0.016297637 },
    ankle: { x: -0.116968017, y: 0.101624393, z: 0.014533871 },
  },
  {
    side: 1,
    hip: { x: 0.088368434, y: 0.895185196, z: -0.000000146 },
    knee: { x: 0.109481664, y: 0.497042668, z: -0.016298106 },
    ankle: { x: 0.116968147, y: 0.101624563, z: 0.014533522 },
  },
] as const;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (n: number) => {
  const t = clamp(n, 0, 1);
  return t * t * (3 - 2 * t);
};
const distance = (a: LocomotionPoint, b: LocomotionPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function checkState(state: LocomotionState) {
  if (
    !Number.isFinite(state.stridePhase) ||
    state.stridePhase < 0 ||
    state.stridePhase > 1e9 ||
    !Number.isFinite(state.strideWeight) ||
    state.strideWeight < 0 ||
    state.strideWeight > 1 ||
    !Number.isFinite(state.strideSpeed) ||
    state.strideSpeed < 0 ||
    state.strideSpeed > 4.8
  )
    throw new RangeError("Invalid locomotion state");
}
function crouchValue(value: number | boolean) {
  const c = typeof value === "boolean" ? Number(value) : value;
  if (!Number.isFinite(c) || c < 0 || c > 1) throw new RangeError("Crouch blend must be in [0, 1]");
  return c;
}
function gait(speed: number, c: number) {
  const s = clamp(speed, 0, mix(4.8, 2.1, c));
  const run = smooth((s - 1.5) / 2);
  const cadenceHz = mix(1.25 + 0.22 * s, 1.1 + 0.35 * s, c);
  const dutyFactor = mix(mix(0.62, 0.32, run), 0.68, c);
  // During support, d(offset)/dt = -2*A*cadence/duty = -speed.
  // This yields a planted WORLD ankle at constant velocity and settled weight.
  const halfStride = (s * dutyFactor) / (2 * cadenceHz);
  const lift = mix(0.065 + 0.012 * s, 0.04, c);
  return { speed: s, cadenceHz, dutyFactor, halfStride, lift };
}

/** Run once per accepted fixed simulation tick, with accepted planar speed.
 * Never pass a render dt or input wish-speed. Throws on dt > 250 ms instead of
 * dropping simulated time; callers retain their fixed-step accumulator.
 */
export function advanceLocomotion(
  state: LocomotionState,
  speed: number,
  dt: number,
  grounded: boolean,
  crouch: number | boolean,
): LocomotionState {
  checkState(state);
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(dt) || dt < 0 || dt > 0.25)
    throw new RangeError("Invalid locomotion speed or fixed dt");
  const c = crouchValue(crouch);
  if (dt === 0) return { ...state };
  const motion = gait(speed, c),
    moving = grounded && motion.speed > 0.03;
  const targetWeight = moving ? smooth((motion.speed - 0.03) / 0.67) : 0;
  const targetSpeed = moving ? motion.speed : 0;
  const stridePhase = state.stridePhase + (moving ? motion.cadenceHz * dt : 0);
  if (stridePhase > 1e9) throw new RangeError("Reset locomotion phase at the next explicit spawn");
  return {
    stridePhase,
    strideWeight: mix(
      targetWeight,
      state.strideWeight,
      Math.exp(-dt * (moving ? 12 : grounded ? 10 : 8)),
    ),
    strideSpeed: mix(targetSpeed, state.strideSpeed, Math.exp(-dt * 12)),
  };
}

function footCycle(
  phase: number,
  motion: ReturnType<typeof gait>,
  weight: number,
  grounded: boolean,
) {
  const wrapped = phase - Math.floor(phase);
  const support = wrapped <= motion.dutyFactor;
  let along: number,
    lift = 0;
  if (support) along = motion.halfStride * (1 - (2 * wrapped) / motion.dutyFactor);
  else {
    const t = (wrapped - motion.dutyFactor) / (1 - motion.dutyFactor);
    // Cubic Hermite return: endpoint velocity matches the support sweep. A small
    // toe-off overshoot is intentional; both position and velocity are continuous.
    const slope = (-2 * motion.halfStride * (1 - motion.dutyFactor)) / motion.dutyFactor;
    along =
      motion.halfStride * (-1 + 6 * t * t - 4 * t * t * t) +
      slope * (t - 3 * t * t + 2 * t * t * t);
    lift = motion.lift * Math.sin(Math.PI * t) ** 2;
  }
  const stationary = weight < 1e-8 || motion.speed < 1e-8;
  return {
    phase: wrapped,
    along: along * weight,
    lift: lift * weight,
    contact: grounded && (stationary || support),
  };
}

function kneeTarget(
  hip: LocomotionPoint,
  ankle: LocomotionPoint,
  upper: number,
  lower: number,
  side: number,
): LocomotionPoint {
  const dx = ankle.x - hip.x,
    dy = ankle.y - hip.y,
    dz = ankle.z - hip.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= Math.abs(upper - lower) + 1e-8 || d >= upper + lower)
    throw new RangeError("Unreachable C02 foot target");
  const x = dx / d,
    y = dy / d,
    z = dz / d;
  const along = (upper * upper - lower * lower + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const dot = side * 0.12 * x - z;
  let px = side * 0.12 - x * dot,
    py = -y * dot,
    pz = -1 - z * dot;
  let poleLength = Math.hypot(px, py, pz);
  if (poleLength < 1e-8) {
    const axisX = Math.abs(x) < 0.9 ? 1 : 0,
      axisY = axisX ? 0 : 1;
    const projection = axisX * x + axisY * y;
    px = axisX - x * projection;
    py = axisY - y * projection;
    pz = -z * projection;
    poleLength = Math.hypot(px, py, pz);
  }
  return {
    x: hip.x + along * x + (height * px) / poleLength,
    y: hip.y + along * y + (height * py) / poleLength,
    z: hip.z + along * z + (height * pz) / poleLength,
  };
}

/** Sample the SAME authority-owned state for rendered bones and hit volumes.
 * pelvisShift is the existing stance/pitch shift BEFORE locomotion. Apply the
 * returned pelvisDrop to head/eye/torso references too, exactly once.
 * Direction is actor-local accepted motion, retained through stopping. The
 * periodic support sweep is exact for constant heading/speed, not a terrain or
 * arbitrary-turn world-anchor solver. See docs/locomotion-contract.md.
 */
export function sampleFootTargets(state: LocomotionState, options: FootTargetOptions): FootTargets {
  checkState(state);
  const c = crouchValue(options.crouch),
    { x, z } = options.direction;
  const shift = options.pelvisShift ?? { x: 0, y: 0, z: 0 };
  if (![x, z, shift.x, shift.y, shift.z].every(Number.isFinite))
    throw new RangeError("Invalid foot-target direction or pelvis shift");
  const length = Math.hypot(x, z),
    direction = length > 1e-8 ? { x: x / length, z: z / length } : { x: 0, z: -1 };
  const motion = gait(state.strideSpeed, c);
  const targets = LEGS.map((rest, i) => {
    const cycle = footCycle(
      state.stridePhase + i * 0.5,
      motion,
      state.strideWeight,
      options.grounded,
    );
    const offset = { x: direction.x * cycle.along || 0, y: cycle.lift || 0, z: direction.z * cycle.along || 0 };
    return {
      rest,
      cycle,
      offset,
      position: {
        x: rest.ankle.x + offset.x,
        y: rest.ankle.y + offset.y,
        z: rest.ankle.z + offset.z,
      },
      hip: { x: rest.hip.x + shift.x, y: rest.hip.y + shift.y, z: rest.hip.z + shift.z },
      upperLength: distance(rest.hip, rest.knee),
      lowerLength: distance(rest.knee, rest.ankle),
    };
  });
  let pelvisDrop = 0;
  for (const target of targets) {
    const radius = target.upperLength + target.lowerLength - 0.002 * state.strideWeight;
    const horizontalSq =
      (target.position.x - target.hip.x) ** 2 + (target.position.z - target.hip.z) ** 2;
    if (horizontalSq >= radius * radius)
      throw new RangeError("Foot target exceeds horizontal C02 reach");
    const ceiling = target.position.y + Math.sqrt(radius * radius - horizontalSq);
    pelvisDrop = Math.max(pelvisDrop, target.hip.y - ceiling);
  }
  if (pelvisDrop > 0.18)
    throw new RangeError("Foot targets require more than 180 mm of pelvis lowering");
  const feet = targets.map((target): FootTarget => {
    const hip = { ...target.hip, y: target.hip.y - pelvisDrop };
    return {
      phase: target.cycle.phase,
      position: target.position,
      offset: target.offset,
      hip,
      knee: kneeTarget(
        hip,
        target.position,
        target.upperLength,
        target.lowerLength,
        target.rest.side,
      ),
      upperLength: target.upperLength,
      lowerLength: target.lowerLength,
      contact: target.cycle.contact,
    };
  });
  return {
    left: feet[0],
    right: feet[1],
    pelvisDrop,
    cadenceHz: motion.cadenceHz,
    dutyFactor: motion.dutyFactor,
  };
}
