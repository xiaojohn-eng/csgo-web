import type { Player, WeaponId } from './types';

/** A retained input can reselect the old slot before the first post-buy snapshot. */
export function sourcePurchasedSlot(
  pending: WeaponId | null,
  own: Pick<Player, 'primary' | 'secondary'>,
): 0 | 1 | null {
  if (pending === null) return null;
  if (own.primary === pending) return 0;
  if (own.secondary === pending) return 1;
  return null;
}
