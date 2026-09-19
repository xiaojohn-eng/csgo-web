import { beforeAll, afterEach, it, expect } from 'vitest';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT } from '../game/types';
import {
  accelerate,
  recoilOffset,
  shotDirection,
  shotSpread,
} from '../game/handling';
import { BOXES } from '../game/map';
import { capsuleHeight, CHARACTER } from '../game/character-contract';
beforeAll(initPhysics);
const games: Simulation[] = [];
afterEach(() => {
  games.forEach((s) => s.dispose());
  games.length = 0;
});
function setup() {
  const s = new Simulation('training', false);
  games.push(s);
  const p = s.addPlayer('test', 'Test', 'amber');
  p.x = -20;
  p.z = 27;
  p.yaw = 0; // Explicit world-axis fixture; M01 spawn poses face west.
  return { s, p };
}
it('accelerates gradually and counter-strafes faster than releasing movement', () => {
  const { p } = setup();
  accelerate(p, { ...EMPTY_INPUT, mx: 1 }, 1 / 60);
  expect(p.vx).toBeGreaterThan(0);
  expect(p.vx).toBeLessThan(1);
  const coast = { ...p, vx: 4.8, vz: 0 },
    counter = { ...coast };
  for (let i = 0; i < 5; i++) {
    accelerate(coast, EMPTY_INPUT, 1 / 60);
    accelerate(counter, { ...EMPTY_INPUT, mx: -1 }, 1 / 60);
  }
  expect(coast.vx).toBeGreaterThan(3);
  expect(Math.abs(counter.vx)).toBeLessThan(0.3);
});
it('spread follows actual velocity and airborne state even when input is released', () => {
  const { p } = setup();
  const standing = shotSpread(p, EMPTY_INPUT);
  p.vx = 4.8;
  expect(shotSpread(p, EMPTY_INPUT)).toBeGreaterThan(standing * 4);
  p.vx = 0;
  p.grounded = false;
  expect(shotSpread(p, EMPTY_INPUT)).toBeGreaterThan(standing * 10);
  p.grounded = true;
  p.crouch = true;
  expect(shotSpread(p, EMPTY_INPUT)).toBeLessThan(standing);
});
it('recoil changes authoritative shot direction, is deterministic, and recovers', () => {
  const { s, p } = setup();
  p.cooldown = 0;
  const first = shotDirection(p, { ...EMPTY_INPUT, seq: 42 });
  expect(shotDirection(p, { ...EMPTY_INPUT, seq: 42 })).toEqual(first);
  for (let i = 0; i < 10; i++) s.shoot(p, { ...EMPTY_INPUT, seq: i });
  expect(recoilOffset(p).pitch).toBeGreaterThan(0.08);
  expect(shotDirection(p, { ...EMPTY_INPUT, seq: 42 }).dy).toBeGreaterThan(
    first.dy + 0.06,
  );
  for (let i = 0; i < 150; i++) s.step();
  expect(p.shotHeat).toBe(0);
  expect(shotDirection(p, { ...EMPTY_INPUT, seq: 42 })).toEqual(first);
});
it('crouching reduces the collision capsule and a low ceiling prevents standing', () => {
  const roof = {
    x: -20,
    y: 1.6,
    z: 27,
    w: 3,
    h: 0.2,
    d: 3,
    kind: 'wall' as const,
  };
  BOXES.push(roof);
  try {
    const { s, p } = setup();
    // Enter crouched from outside, then test continuous upward growth under the unchanged roof.
    p.x = -25;
    for (let i=0;i<90;i++) { s.move(p, { ...EMPTY_INPUT, crouch: true }); s.world.step(); }
    expect(p.crouch).toBe(true);
    expect(capsuleHeight(p)).toBeCloseTo(CHARACTER.crouchingHeight,5);
    p.x = -20;
    for (let i=0;i<90;i++) { s.move(p, EMPTY_INPUT); s.world.step(); }
    expect(p.crouch).toBe(true);
    expect(p.y+capsuleHeight(p)).toBeLessThanOrEqual(1.501);
    expect(capsuleHeight(p)).toBeLessThan(CHARACTER.standingHeight);
    p.x = -25;
    for (let i=0;i<90;i++) { s.move(p, EMPTY_INPUT); s.world.step(); }
    expect(p.crouch).toBe(false);
    expect(s.bodies.get(p.id)!.collider.halfHeight()).toBeCloseTo(CHARACTER.standingHalfSegment, 5);
  } finally {
    BOXES.splice(BOXES.indexOf(roof), 1);
  }
});
it('flat-floor acceleration is independent of compass direction', () => {
  const distances = [];
  for (const yaw of [0, 0.4, 0.8, 1.2, 1.6, 2.1, 2.8]) {
    const { s, p } = setup();
    p.x = 0;
    p.z = 27;
    s.setInput(p.id, { ...EMPTY_INPUT, mz: -1, yaw });
    for (let i = 0; i < 30; i++) s.step();
    distances.push(Math.hypot(p.x, p.z - 27));
  }
  expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.03);
});
