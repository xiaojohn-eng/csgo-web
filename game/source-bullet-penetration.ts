import type { SourceBulletWeapon } from './source-damage.js';

/** Conservative geometry-only penetration limits for the staged Source weapons.
 * The original BSP does not expose surface penetration modifiers in this
 * adapter, so thickness is measured in metres. AWP's local items catalog records
 * penetration=2.5 (the highest supported weapon); its 0.75m geometric envelope
 * is the explicitly documented 1.25x AK-47 inference, not a native material
 * penetration claim. */
export type SourcePenetrationWeapon = SourceBulletWeapon | 'awp';
export const SOURCE_BULLET_PENETRATION_METRES: Readonly<Record<SourcePenetrationWeapon, number>> = Object.freeze({
  ak47: 0.60,
  m4a4: 0.50,
  glock18: 0.25,
  deagle: 0.40,
  'usp-s': 0.25,
  awp: 0.75,
});

export function sourceBulletPenetrationFactor(weapon: SourcePenetrationWeapon, thicknessMetres: number): number {
  const limit = SOURCE_BULLET_PENETRATION_METRES[weapon];
  if (!Number.isFinite(thicknessMetres) || thicknessMetres < 0 || !limit) return 0;
  if (thicknessMetres >= limit) return 0;
  // Source penetration loses damage as material thickness grows. Keep a small
  // residual for thin cover while never increasing the original hit damage.
  return Math.max(0.1, 1 - 0.9 * thicknessMetres / limit);
}
