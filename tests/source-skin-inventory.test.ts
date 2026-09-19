import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';

const games:Simulation[]=[];
beforeAll(initPhysics);
afterEach(()=>games.splice(0).forEach(game=>game.dispose()));
function setup(){
  const fixture=sourceSimulationFixture();
  fixture.weapons=['vandal','m4a4','glock','usp','deagle','awp'];
  fixture.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};
  fixture.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
  const game=new Simulation('demolition',false,fixture,'competitiveShort');games.push(game);
  const player=game.addPlayer('picker','Picker','amber');player.money=16000;
  return {game,player};
}
const vandal={weapon:'vandal' as const,paintKitId:282,seed:1,wear:.2};
const glock={weapon:'glock' as const,paintKitId:2,seed:2,wear:.1};
const deagle={weapon:'deagle' as const,paintKitId:37,seed:3,wear:.05};

describe('Source per-weapon finish inventory',()=>{
  it('applies multiple configured defaults and switches only the active slot finish',()=>{
    const {game,player}=setup();
    expect(game.setSourceFinishLoadout(player.id,'vandal',vandal)).toBe(true);
    expect(game.setSourceFinishLoadout(player.id,'glock',glock)).toBe(true);
    expect(game.buy(player.id,'vandal')).toBe(true);
    expect(player.primaryFinish).toEqual(vandal);
    expect(player.sourceWeaponFinish).toEqual(vandal);
    game.phase='live';game.bomb.carrier=null;
    game.setInput(player.id,{...EMPTY_INPUT,seq:1,slot:1});game.step();
    expect(player.weapon).toBe('glock');expect(player.sourceWeaponFinish).toEqual(glock);
    game.setInput(player.id,{...EMPTY_INPUT,seq:2,slot:0});game.step();
    expect(player.weapon).toBe('vandal');expect(player.sourceWeaponFinish).toEqual(vandal);
  });

  it('does not let a bulk loadout update overwrite a picked entity finish',()=>{
    const {game,player}=setup();game.phase='live';game.bomb.carrier=null;
    const picked={weapon:'deagle' as const,paintKitId:37,seed:3,wear:.05};
    game.droppedWeapons.create({id:'enemy:deagle',ownerId:'enemy',weapon:'deagle',createdAt:game.time,
      position:[player.x+.3,player.y+1,player.z],quaternion:[0,0,0,1],ammo:4,reserve:19,sourceWeaponFinish:picked,sleeping:true});
    game.interact(player,{...EMPTY_INPUT,seq:1,use:true},1/60);
    expect(player.secondary).toBe('deagle');expect(player.secondaryFinish).toEqual(picked);
    expect(game.setSourceFinishLoadout(player.id,'deagle',deagle)).toBe(true);
    expect(player.secondaryFinish).toEqual(picked);
    game.interact(player,{...EMPTY_INPUT,seq:2},1/60);
    game.interact(player,{...EMPTY_INPUT,seq:3,use:true},1/60);
    expect(player.sourceWeaponFinish).toEqual(picked);
  });

  it('moves the entity finish through drop and pickup while retaining loadout defaults',()=>{
    const {game,player}=setup();expect(game.setSourceFinishLoadout(player.id,'vandal',vandal)).toBe(true);
    expect(game.buy(player.id,'vandal')).toBe(true);game.phase='live';game.bomb.carrier=null;
    game.setInput(player.id,{...EMPTY_INPUT,seq:1,slot:0,drop:true});game.step();
    const dropped=game.droppedWeapons.read().find(row=>row.weapon==='vandal');
    expect(dropped?.sourceWeaponFinish).toEqual(vandal);expect(player.primaryFinish).toBeUndefined();
    player.x+=.4;game.interact(player,{...EMPTY_INPUT,seq:2,use:true},1/60);
    expect(player.primaryFinish).toEqual(vandal);expect(player.sourceWeaponFinish).toEqual(vandal);
    expect(game.setSourceFinishLoadout(player.id,'vandal',{...vandal,seed:9})).toBe(true);
    // Picked entity remains the one in hand; changing the future default does not repaint it.
    expect(player.sourceWeaponFinish).toEqual(vandal);
  });

  it('uses configured defaults after a respawn instead of a picked finish',()=>{
    const {game,player}=setup();expect(game.setSourceFinishLoadout(player.id,'vandal',vandal)).toBe(true);
    expect(game.buy(player.id,'vandal')).toBe(true);
    player.sourceWeaponFinish={...vandal,seed:99};player.primaryFinish=player.sourceWeaponFinish;
    game.spawn(player);
    expect(player.primaryFinish).toEqual(vandal);expect(player.sourceWeaponFinish).toEqual(vandal);
  });

  it('rejects invalid bulk entries without partially changing the loadout',()=>{
    const {game,player}=setup();expect(game.setSourceFinishLoadout(player.id,'vandal',vandal)).toBe(true);
    expect(game.setSourceFinishLoadoutBulk(player.id,[{weapon:'glock'}])).toBe(false);
    expect(game.setSourceFinishLoadout(player.id,'glock',null)).toBe(true);
    expect(game.setSourceFinishLoadoutBulk(player.id,[{weapon:'vandal',paintKitId:282,seed:1,wear:.2},{weapon:'bogus'}])).toBe(false);
    expect(game.setSourceFinishLoadout(player.id,'vandal',vandal)).toBe(true);
  });
});
