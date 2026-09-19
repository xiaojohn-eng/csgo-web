/** App740 12426148 original event 54 state stores. See docs/source-pistol-animation-events.md.
 * Invoke from the authoritative weapon animation timeline AFTER the command frame.
 * This function does not create, schedule, deduplicate or authenticate events.
 */
export const SOURCE_COMPLETE_RELOAD_EVENT = 54 as const;
export const SOURCE_RELOAD_EVENT_SOURCE_SHA256 = '7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386';
export interface SourceReloadEventState { clip: number; reserve: number; reloadVisComplete: boolean }
/** Original event handler does not test reloading, busy clock or previous aa4.
 * The caller must reject stale/cancelled sequence events before invoking it.
 * Current weapon selection and sequence generation belong to that caller.
 */
export function sourcePistolCompleteReload<T extends SourceReloadEventState>(input: Readonly<T>, context: { weapon: 'glock' | 'usp-s' | 'deagle'; owner?: boolean }): T {
  const maxClip = context.weapon === 'glock' ? 20 : context.weapon === 'usp-s' ? 12 : context.weapon === 'deagle' ? 7 : 0;
  if (!maxClip || !Number.isInteger(input.clip) || input.clip < 0 || input.clip > maxClip || !Number.isInteger(input.reserve) || input.reserve < 0 || input.reserve > 0x7fffffff) throw new RangeError('Invalid original pistol reload event state');
  if (typeof input.reloadVisComplete !== 'boolean') throw new TypeError('Invalid original pistol reload completion flag');
  const state: T = { ...input, reloadVisComplete: true };
  if (context.owner !== false) {
    const transferred = Math.min(maxClip - state.clip, state.reserve);
    state.clip += transferred; state.reserve -= transferred;
  }
  return state;
}
/** Original 5a80d0 nonloop event collector compares f32 start <= cycle < end.
 * Keep the previous actual sequence cycle; a float elapsed/duration calculation
 * is not a replacement for the original animation playback clock.
 */
export function sourcePistolEventInCycleWindow(cycle: number, start: number, end: number): boolean {
  if (![cycle, start, end].every(Number.isFinite)) throw new RangeError('Invalid original pistol event cycle');
  const c = Math.fround(cycle), a = Math.fround(start), b = Math.fround(end);
  return a <= c && c < b;
}
