/** Shared fixed-step ACTION03 stance, no rendering clock or Three dependency. */
export type StanceState = { stancePhase: number; stanceRate: number; stanceTarget: boolean };
export const STANCE_OMEGA = 18;
export function stanceBlend(state: Pick<StanceState, 'stancePhase'> | number): number {
  const phase = Math.max(0, Math.min(1, typeof state === 'number' ? state : state.stancePhase));
  return phase * phase * (3 - 2 * phase);
}
export function advanceStance(state: StanceState, crouched: boolean, dt: number): StanceState {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(state.stancePhase) ||
    !Number.isFinite(state.stanceRate) || state.stancePhase < 0 || state.stancePhase > 1)
    throw new Error('Invalid stance state or dt');
  const target = crouched ? 1 : 0, error = state.stancePhase - target;
  const temp = (state.stanceRate + STANCE_OMEGA * error) * dt, decay = Math.exp(-STANCE_OMEGA * dt);
  const stancePhase = Math.max(0, Math.min(1, target + (error + temp) * decay));
  const stanceRate = (state.stanceRate - STANCE_OMEGA * temp) * decay;
  return { stancePhase, stanceRate, stanceTarget: crouched };
}
