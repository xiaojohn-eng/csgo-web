/** Original App740 CBaseAnimating clock portion of StudioFrameAdvance.
 * A Player's default weapons share the same viewmodel at owner EHANDLE index0.
 * Invoke only when the original active, owned, model-valid VM update runs.
 */
export interface SourceViewmodelAnimTimes { animTime: number; previousAnimTime: number }
const F = Math.fround;
function finite(value: number) {
  if (!Number.isFinite(value) || !Number.isFinite(F(value))) throw new RangeError('Invalid original viewmodel anim time');
  return F(value);
}
/** Does not depend on current weapon, sequence duration or playback rate.
 * Do not call this and full Glock advance twice in the same frame. Full Glock
 * advance already uses this function; copy its resulting times back to Player.
 */
export function advanceSourceViewmodelAnimTimes(input: Readonly<SourceViewmodelAnimTimes>, nowValue: number) {
  const now = finite(nowValue), animTime = finite(input.animTime);
  let previousAnimTime = finite(input.previousAnimTime);
  if (previousAnimTime === 0) previousAnimTime = animTime;
  const interval = Math.max(0, Math.min(F(.2), F(now - animTime)));
  if (interval <= .001) return { state: { animTime, previousAnimTime }, interval: 0, advanced: false };
  return { state: { animTime: now, previousAnimTime: animTime }, interval, advanced: true };
}
