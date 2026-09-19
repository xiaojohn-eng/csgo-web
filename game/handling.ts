import { WEAPONS, type Input, type Player } from './types.js';
import {sourcePlayerSpread} from './source-player-handling.js';
import {sourceShotPunch} from './source-punch.js';

// Shared by prediction and authority. Values are original game tuning, in SI units.
export const HANDLING = {
  maxSpeed: 4.8,
  acceleration: 42,
  braking: 17,
  counterStrafe: 58,
  airAcceleration: 6,
};

export function accelerate(p: Player, input: Input, dt: number) {
  const length = Math.max(1, Math.hypot(input.mx, input.mz));
  const speed = p.crouch ? 2.1 : input.aim ? 3.15 : HANDLING.maxSpeed;
  const x = (Math.cos(p.yaw) * input.mx + Math.sin(p.yaw) * input.mz) / length;
  const z = (-Math.sin(p.yaw) * input.mx + Math.cos(p.yaw) * input.mz) / length;
  const active = Math.hypot(x, z) > 0.01;
  const opposing = p.vx * x + p.vz * z < -0.2;
  const acceleration = p.grounded
    ? active
      ? opposing
        ? HANDLING.counterStrafe
        : HANDLING.acceleration
      : HANDLING.braking
    : active
      ? HANDLING.airAcceleration
      : 0;
  const dx = x * speed - p.vx,
    dz = z * speed - p.vz;
  const distance = Math.hypot(dx, dz);
  const fraction =
    distance > 0 ? Math.min(1, (acceleration * dt) / distance) : 0;
  p.vx += dx * fraction;
  p.vz += dz * fraction;
}

export function recoverAccuracy(p: Player, dt: number) {
  p.shotIdle += dt;
  if (p.shotIdle > Math.max(0.18, WEAPONS[p.weapon].rate * 1.5))
    p.shotHeat = Math.max(0, p.shotHeat - dt * 9);
}

export function recoilOffset(p: Player) {
  if(p.sourceRifleHandling){const q=sourceShotPunch(p.sourceRifleHandling.punch);return {pitch:-q[0]*Math.PI/180,yaw:q[1]*Math.PI/180};}
  const heat = Math.min(26, p.shotHeat);
  const strength = WEAPONS[p.weapon].recoil;
  return {
    pitch:
      Math.min(heat, 9) * strength * 0.54 +
      Math.max(0, heat - 9) * strength * 0.08,
    yaw:
      heat < 4
        ? 0
        : Math.sin((heat - 4) * 0.49) *
          strength *
          Math.min(3, (heat - 4) * 0.35),
  };
}

export function shotSpread(p: Player, input: Input) {
  if(p.sourceRifleHandling)return sourcePlayerSpread(p);
  const movement = Math.min(1, Math.hypot(p.vx, p.vz) / HANDLING.maxSpeed);
  const scoped = input.aim && p.weapon === 'marshal';
  const base = WEAPONS[p.weapon].spread * (p.crouch ? 0.65 : 1);
  return (
    base * (scoped ? 0.28 : 1) +
    movement * movement * 0.055 +
    (p.grounded ? 0 : 0.105) +
    Math.min(p.shotHeat, 15) * 0.0008
  );
}

export function shotDirection(p: Player, input: Input) {
  // A shot's random cone is independent of other players and render timing.
  let seed = input.seq ^ Math.imul(Math.floor(p.shotHeat * 100) + 1, 0x45d9f3b);
  for (let i = 0; i < p.id.length; i++)
    seed = Math.imul(seed ^ p.id.charCodeAt(i), 16777619);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const radius = Math.sqrt(random()) * shotSpread(p, input),
    angle = random() * Math.PI * 2;
  const recoil = recoilOffset(p);
  const yaw = p.yaw + recoil.yaw + Math.cos(angle) * radius;
  const pitch = Math.max(
    -1.5,
    Math.min(1.5, p.pitch + recoil.pitch + Math.sin(angle) * radius),
  );
  return {
    dx: -Math.sin(yaw) * Math.cos(pitch),
    dy: Math.sin(pitch),
    dz: -Math.cos(yaw) * Math.cos(pitch),
  };
}

export function registerShot(p: Player) {
  p.shotHeat = Math.min(30, p.shotHeat + 1);
  p.shotIdle = 0;
}

// Feedback prediction only: authority still owns weapon transitions and ammunition.
// pending contains unacknowledged inputs; a queued action can block the next tick too.
export function canPredictShot(
  p: Player,
  input: Input,
  pending: readonly Input[] = [],
): boolean {
  const w = WEAPONS[p.weapon];
  const changesWeaponState = (i: Input) =>
    i.slot !== p.slot ||
    (i.reload && p.ammo < w.mag && p.reserve > 0);
  return (
    input.fire &&
    p.cooldown === 0 &&
    p.ammo > 0 &&
    p.reload === 0 &&
    !changesWeaponState(input) &&
    !pending.some(changesWeaponState)
  );
}
