import { afterAll, beforeAll, expect, it } from 'vitest';
import { Game } from '../game/runtime';
import { WeaponInspect } from '../game/weapon-inspect';
import { Simulation, initPhysics } from '../game/simulation';

let sim: Simulation;
beforeAll(async () => { await initPhysics(); sim = new Simulation('training', false); });
afterAll(() => sim.dispose());

it('clearing held controls preserves the authoritative pistol selection without firing after resume', () => {
  const p = sim.addPlayer('local', 'Local', 'amber');
  p.slot = 1; p.weapon = 'sidearm'; p.ammo = 3;
  // Exercise the real input controller without constructing the GPU/audio subsystems.
  const game = Object.assign(Object.create(Game.prototype) as Game, {
    snapshot: sim.snapshot('local'), you: 'local', keys: new Set(['Digit2', 'KeyW']),
    pressed: new Set(['KeyR']), firePressed: true, firing: true, aim: true,
    paused: false, seq: 0, yaw: 0, pitch: 0,
    art: { inspection: new WeaponInspect() },
  });
  game.clearInput();
  const resumed = game.input();
  expect(resumed).toMatchObject({ slot: 1, mx: 0, mz: 0, fire: false, reload: false, aim: false });
});

it('F inspection does not throw the flashbang, while Q retains a dedicated flash action', () => {
  const game = Object.assign(Object.create(Game.prototype) as Game, {
    snapshot: null, keys: new Set(), pressed: new Set(['KeyF']), paused: false,
    seq: 0, yaw: 0, pitch: 0, firing: false, firePressed: false, aim: false,
  });
  expect(game.input().grenade).toBe(false);
  game.pressed.add('KeyQ');
  expect(game.input()).toMatchObject({grenade:true,utility:'flash'});
});

it('latches the held throw key with its utility and keeps reporting the hold until keyup', () => {
  const game = Object.assign(Object.create(Game.prototype) as Game, {
    snapshot: null, keys: new Set(['KeyG']), pressed: new Set(['KeyG']), paused: false,
    seq: 0, yaw: 0, pitch: 0, firing: false, firePressed: false, aim: false,
    grenadeUtility: 'he',
  });
  // Press edge: the throw fires this tick and latches the utility for the hold.
  expect(game.input()).toMatchObject({grenade:true, grenadeHold:true, utility:'he'});
  // The hold keeps reporting while the key stays down, long after the pressed
  // edge cleared.
  expect(game.input()).toMatchObject({grenade:false, grenadeHold:true, utility:'he'});
  // The release input no longer holds the key that started the hold but keeps
  // the latched utility so the authority throws the right grenade.
  game.keys.clear();
  expect(game.input()).toMatchObject({grenadeHold:false, utility:'he'});
  // The paused input reports no hold state at all.
  game.keys.add('KeyV'); game.paused = true;
  expect(game.input().grenadeHold).toBeUndefined();
});

it('samples both Shift keys as IN_SPEED and clears the request while paused or released',()=>{
 const game=Object.assign(Object.create(Game.prototype)as Game,{snapshot:null,keys:new Set(['ShiftLeft']),pressed:new Set(),paused:false,seq:0,yaw:0,pitch:0,firing:false,firePressed:false,aim:false});
 expect(game.input().walk).toBe(true);game.keys=new Set(['ShiftRight']);expect(game.input().walk).toBe(true);
 game.paused=true;expect(game.input().walk).toBe(false);game.paused=false;game.keys.clear();expect(game.input().walk).toBe(false);
});
