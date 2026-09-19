import type { Player } from './types.js';

/**
 * The Source spectator camera may only follow a living teammate after the local
 * combat life has ended. Keeping this selection pure makes the authority's
 * aliveness/team rules explicit and gives the client a deterministic fallback
 * when an interpolated snapshot removes the current target.
 */
export function spectatorCandidates(players: readonly Player[], you: string): Player[] {
  const own = players.find((player) => player.id === you);
  if (!own || own.alive) return [];
  return players.filter((player) => player.id !== you && player.team === own.team && player.alive);
}

export function selectSpectatorTarget(
  players: readonly Player[],
  you: string,
  current: string | null = null,
): Player | null {
  const candidates = spectatorCandidates(players, you);
  if (!candidates.length) return null;
  const existing = candidates.find((player) => player.id === current);
  return existing ?? candidates[0];
}

/** Cycle through living teammates. The selected id is deliberately retained
 * only as a client camera choice; movement, shooting and visibility remain
 * authority-owned and the dead player's input is ignored by Simulation. */
export function cycleSpectatorTarget(
  players: readonly Player[],
  you: string,
  current: string | null,
  direction: 1 | -1 = 1,
): Player | null {
  const candidates = spectatorCandidates(players, you);
  if (!candidates.length) return null;
  const index = candidates.findIndex((player) => player.id === current);
  const next = index < 0 ? 0 : (index + direction + candidates.length) % candidates.length;
  return candidates[next];
}
