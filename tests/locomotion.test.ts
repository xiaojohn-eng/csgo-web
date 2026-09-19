import { describe, expect, it } from "vitest";
import {
  advanceLocomotion,
  sampleFootTargets,
  type LocomotionState,
  type LocomotionPoint,
} from "../game/locomotion";
import { falconPoseReferences } from "../game/falcon-head-reference";

const neutral = (): LocomotionState => ({ stridePhase: 0, strideWeight: 0, strideSpeed: 0 });
const moving = (speed = 3, phase = 0.1): LocomotionState => ({
  stridePhase: phase,
  strideWeight: 1,
  strideSpeed: speed,
});
const options = { direction: { x: 0, z: -1 }, crouch: 0, grounded: true };
const distance = (a: LocomotionPoint, b: LocomotionPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("deterministic shared locomotion clock", () => {
  it("replays the same fixed ticks independently of render grouping and never mutates input", () => {
    const initial = Object.freeze(neutral());
    const first = advanceLocomotion(initial, 4.8, 1 / 60, true, 0);
    expect(initial).toEqual(neutral());
    expect(first.stridePhase).toBeGreaterThan(0);
    const results = [30, 60, 120].map((hz) => {
      let state = neutral(),
        accumulator = 0,
        tick = 0;
      for (let frame = 0; frame < hz * 4; frame++) {
        accumulator += 60 / hz;
        while (accumulator >= 1) {
          state = advanceLocomotion(
            state,
            tick < 100 ? 4.8 : tick < 170 ? 1.2 : 0,
            1 / 60,
            tick < 130 || tick >= 145,
            tick >= 150,
          );
          tick++;
          accumulator--;
        }
      }
      return state;
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("keeps a continuous unwrapped phase when crossing a cycle boundary", () => {
    const a = moving(3, 0.99),
      b = advanceLocomotion(a, 3, 0.02, true, 0);
    expect(b.stridePhase).toBeGreaterThan(1);
    const midpoint = { ...a, stridePhase: (a.stridePhase + b.stridePhase) / 2 };
    const before = sampleFootTargets({ ...a, stridePhase: 0.999999 }, options);
    const after = sampleFootTargets({ ...a, stridePhase: 1.000001 }, options);
    expect(distance(before.left.position, after.left.position)).toBeLessThan(0.0001);
    expect(midpoint.stridePhase).toBeGreaterThan(0.99);
    expect(sampleFootTargets({ ...a, stridePhase: 12.25 }, options).left.position).toEqual(
      sampleFootTargets({ ...a, stridePhase: 0.25 }, options).left.position,
    );
  });

  it("settles smoothly to the calibrated neutral stance after movement ends", () => {
    const before = moving(4.8, 0.27),
      first = advanceLocomotion(before, 0, 1 / 60, true, 0);
    expect(first.stridePhase).toBe(before.stridePhase);
    expect(first.strideWeight).toBeGreaterThan(0.7);
    expect(first.strideWeight).toBeLessThan(1);
    const old = sampleFootTargets(before, options),
      next = sampleFootTargets(first, options);
    expect(distance(old.left.position, next.left.position)).toBeLessThan(0.12);
    let settled = first;
    for (let i = 0; i < 180; i++) settled = advanceLocomotion(settled, 0, 1 / 60, true, 0);
    const feet = sampleFootTargets(settled, options),
      rest = sampleFootTargets(neutral(), options);
    expect(distance(feet.left.position, rest.left.position)).toBeLessThan(1e-7);
    expect(distance(feet.right.position, rest.right.position)).toBeLessThan(1e-7);
    expect(feet.pelvisDrop).toBeLessThan(1e-7);
  });

  it("freezes the phase in air, fades the gait and does not report ground contacts", () => {
    let state = moving(4.8, 0.12);
    for (let i = 0; i < 90; i++) state = advanceLocomotion(state, 4.8, 1 / 60, false, 0);
    expect(state.stridePhase).toBe(0.12);
    expect(state.strideWeight).toBeLessThan(0.001);
    const feet = sampleFootTargets(state, { ...options, grounded: false });
    expect(feet.left.contact).toBe(false);
    expect(feet.right.contact).toBe(false);
  });

  it("caps excessive speed without allowing a render stall to silently skip simulation steps", () => {
    const state = advanceLocomotion(neutral(), 1e6, 0.1, true, 0);
    expect(state.stridePhase).toBeGreaterThan(0);
    expect(state.stridePhase).toBeLessThan(0.3);
    expect(state.strideSpeed).toBeLessThanOrEqual(4.8);
    expect(state.strideWeight).toBeGreaterThanOrEqual(0);
    expect(state.strideWeight).toBeLessThanOrEqual(1);
    expect(() => advanceLocomotion(neutral(), 3, 3, true, 0)).toThrow(RangeError);
  });

  it.each([NaN, Infinity, -1])(
    "rejects invalid speed %s rather than contaminating snapshots",
    (speed) => {
      expect(() => advanceLocomotion(neutral(), speed, 1 / 60, true, 0)).toThrow(RangeError);
    },
  );
  it.each([NaN, Infinity, -1])("rejects invalid dt %s", (dt) => {
    expect(() => advanceLocomotion(neutral(), 3, dt, true, 0)).toThrow(RangeError);
  });
  it("does not advance or decay anything on a zero-length tick", () => {
    const state = moving(2, 12.4);
    expect(advanceLocomotion(state, 0, 0, false, 1)).toEqual(state);
  });
});

describe("canonical C02 ankle and two-bone targets", () => {
  it("returns measured Idle0 ankle anchors without adding a hidden visual offset", () => {
    const feet = sampleFootTargets(neutral(), options);
    expect(feet.left.position).toEqual({ x: -0.116968017, y: 0.101624393, z: 0.014533871 });
    expect(feet.right.position).toEqual({ x: 0.116968147, y: 0.101624563, z: 0.014533522 });
    expect(feet.pelvisDrop).toBe(0);
    expect(feet.left.contact).toBe(true);
    expect(feet.right.contact).toBe(true);
  });

  it.each([
    { x: 0, z: -1 },
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
  ])(
    "plants the support ankle against constant-speed root translation in direction $x,$z",
    (direction) => {
      for (const speed of [1, 2.1, 3.15, 4.8]) {
        const state = moving(speed, 0.05),
          dt = 0.001;
        const next = advanceLocomotion(state, speed, dt, true, 0);
        const a = sampleFootTargets(state, { ...options, direction });
        const b = sampleFootTargets(next, { ...options, direction });
        expect(a.left.contact && b.left.contact).toBe(true);
        expect(b.left.position.x + direction.x * speed * dt).toBeCloseTo(a.left.position.x, 10);
        expect(b.left.position.z + direction.z * speed * dt).toBeCloseTo(a.left.position.z, 10);
        expect(b.left.position.y).toBe(a.left.position.y);
      }
    },
  );

  it("offsets the legs by exactly half a cycle and lifts only swing feet", () => {
    for (const crouch of [0, 0.5, 1])
      for (let i = 0; i < 80; i++) {
        const state = moving(2.1, i / 80),
          feet = sampleFootTargets(state, { ...options, crouch });
        const shifted = sampleFootTargets(
          { ...state, stridePhase: state.stridePhase + 0.5 },
          { ...options, crouch },
        );
        expect(feet.right.offset.x).toBeCloseTo(shifted.left.offset.x, 12);
        expect(feet.right.offset.y).toBeCloseTo(shifted.left.offset.y, 12);
        expect(feet.right.offset.z).toBeCloseTo(shifted.left.offset.z, 12);
        for (const foot of [feet.left, feet.right]) {
          expect(foot.offset.y).toBeGreaterThanOrEqual(0);
          if (foot.contact) expect(foot.offset.y).toBe(0);
          else expect(foot.offset.y).toBeGreaterThan(0);
        }
        if (crouch === 1) expect(feet.left.contact || feet.right.contact).toBe(true);
      }
  });

  it("uses lower swing clearance and a longer support fraction for crouch walking", () => {
    let runLift = 0,
      crouchLift = 0;
    for (let i = 0; i < 100; i++) {
      const state = moving(2.1, i / 100);
      const run = sampleFootTargets(state, options),
        crouched = sampleFootTargets(state, { ...options, crouch: 1 });
      runLift = Math.max(runLift, run.left.offset.y);
      crouchLift = Math.max(crouchLift, crouched.left.offset.y);
      expect(crouched.dutyFactor).toBeGreaterThan(run.dutyFactor);
    }
    expect(runLift).toBeGreaterThan(0.065);
    expect(crouchLift).toBeLessThan(0.055);
    expect(crouchLift).toBeGreaterThan(0.02);
  });

  it("keeps every sampled target reachable and every leg segment unchanged over the legal pose envelope", () => {
    let largestDrop = 0,
      largestOffset = 0;
    for (const crouch of [0, 0.25, 0.5, 0.75, 1])
      for (const pitch of [-1.5, 0, 1.5]) {
        const shift = falconPoseReferences({ yaw: 0, pitch, blend: crouch }).pelvisShift;
        for (const speed of [0.5, 2.1, 4.8])
          for (const direction of [
            { x: 0, z: -1 },
            { x: 0, z: 1 },
            { x: 1, z: 0 },
          ]) {
            for (let i = 0; i < 64; i++) {
              const feet = sampleFootTargets(moving(speed, i / 64), {
                ...options,
                crouch,
                direction,
                pelvisShift: { x: shift[0], y: shift[1], z: shift[2] },
              });
              largestDrop = Math.max(largestDrop, feet.pelvisDrop);
              for (const foot of [feet.left, feet.right]) {
                largestOffset = Math.max(largestOffset, Math.hypot(foot.offset.x, foot.offset.z));
                expect(distance(foot.hip, foot.position)).toBeLessThan(
                  foot.upperLength + foot.lowerLength,
                );
                expect(distance(foot.hip, foot.knee)).toBeCloseTo(foot.upperLength, 9);
                expect(distance(foot.knee, foot.position)).toBeCloseTo(foot.lowerLength, 9);
                expect(foot.offset.y).toBeLessThanOrEqual(0.13);
              }
            }
          }
      }
    expect(largestDrop).toBeGreaterThan(0.025);
    expect(largestDrop).toBeLessThan(0.19);
    expect(largestOffset).toBeLessThan(0.5);
  });

  it("normalizes direction without lengthening diagonal strides and preserves caller objects", () => {
    const state = Object.freeze(moving(3, 0.16));
    const direction = Object.freeze({ x: 3, z: -4 });
    const a = sampleFootTargets(state, { ...options, direction });
    const b = sampleFootTargets(state, { ...options, direction: { x: 0.6, z: -0.8 } });
    expect(a).toEqual(b);
    expect(direction).toEqual({ x: 3, z: -4 });
  });

  it("rejects corrupt phase, weight and direction instead of producing non-finite bone targets", () => {
    for (const patch of [
      { stridePhase: NaN },
      { stridePhase: -1 },
      { strideWeight: 2 },
      { strideSpeed: Infinity },
    ])
      expect(() => sampleFootTargets({ ...moving(), ...patch }, options)).toThrow(RangeError);
    expect(() => sampleFootTargets(moving(), { ...options, direction: { x: NaN, z: 0 } })).toThrow(
      RangeError,
    );
  });
});
