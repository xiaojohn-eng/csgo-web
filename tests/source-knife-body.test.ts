import { afterEach, beforeAll, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadServerSourceCharacter } from '../server/source-character-data';
import { createSourceRifleProfiles } from '../game/source-rifle-profiles';
import { createSourcePlayerContract } from '../game/source-player-contract';
import { Simulation, initPhysics } from '../game/simulation';
import { EMPTY_INPUT } from '../game/types';
import { sourceSimulationFixture } from './fixtures/source-simulation-fixture';

const games: Simulation[] = [];
beforeAll(initPhysics);
afterEach(() => games.splice(0).forEach(game => game.dispose()));

it('keeps a real Source body pose and hittable body when the player draws a knife', async () => {
  const load = (folder: string) => loadServerSourceCharacter(resolve('public/source/csgo-12426148', folder, 'manifest.json'));
  const [tAK, tM4, ctAK, ctM4] = await Promise.all([
    load('character-ak'), load('character-t-m4'), load('character-ct-ak'), load('character-ct-m4'),
  ]);
  const fixture = sourceSimulationFixture();
  const profiles = createSourceRifleProfiles({ amber: { vandal: tAK, m4a4: tM4 }, blue: { vandal: ctAK, m4a4: ctM4 } }, 'fixture-map');
  const game = new Simulation('training', false, { ...fixture, ...profiles }); games.push(game);
  const target = game.addPlayer('target', 'Target', 'blue');
  const contract = createSourcePlayerContract(fixture.level.player, profiles);
  const origin = { x: target.x, y: target.y + 1.3, z: target.z + 3 };
  const direction = { x: 0, y: 0, z: -1 };
  expect(contract.raycast(target, origin, direction, 4)).not.toBeNull();
  game.setInput(target.id, { ...EMPTY_INPUT, seq: 1, slot: 2 }); game.step();
  expect(target.weapon).toBe('knife');
  expect(contract.poseDriverFor(target)).toBeDefined();
  expect(target.sourcePoseVersion).toBe(ctAK.poseVersion);
  expect(contract.raycast(target, origin, direction, 4)).not.toBeNull();
});
