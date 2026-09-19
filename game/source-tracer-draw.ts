/** The choices one shot's tracer makes, derived from the shot's own identity.
 *
 * The original draws a tracer's speed, radius, alpha, colour and trail length from its own
 * random tables. Deriving them from the shooter and the shot's sequence number means every
 * client that received the same shot draws the same tracer, which is what lets an acceptance
 * run name the streak it expected rather than merely observe one.
 *
 * Every draw is a unit value in [0, 1); the caller maps it into whichever range the system's
 * own operator states, so the ranges stay in the table and out of this file.
 */
export type SourceTracerDraws = {
  speed: number; radius: number; alpha: number; color: number; trail: number;
};

export function sourceTracerDraws(by: string, seq: number): SourceTracerDraws {
  let seed = 0x811c9dc5 ^ (seq | 0);
  for (let index = 0; index < by.length; index++) {
    seed ^= by.charCodeAt(index);
    seed = Math.imul(seed, 0x01000193);
  }
  const unit = (value: number) => ((value >>> 0) % 1_000_003) / 1_000_003;
  const step = (value: number) => Math.imul(value ^ (value >>> 15), 0x2545f491) + 0x9e3779b9;
  const first = step(seed);
  const second = step(first);
  const third = step(second);
  const fourth = step(third);
  const fifth = step(fourth);
  return { speed: unit(first), radius: unit(second), alpha: unit(third),
    color: unit(fourth), trail: unit(fifth) };
}
