import {afterEach,beforeAll,describe,expect,it} from 'vitest';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT} from '../game/types';
import {sourceSimulationFixture} from './fixtures/source-simulation-fixture';

const live:Simulation[]=[];
beforeAll(initPhysics);
afterEach(()=>live.splice(0).forEach(s=>s.dispose()));
function simulation(){
  const fixture=sourceSimulationFixture();
  fixture.weapons=['vandal','m4a4','glock','usp','deagle','awp'];
  fixture.defaultWeaponByTeam={amber:'vandal',blue:'m4a4'};
  fixture.defaultSecondaryWeaponByTeam={amber:'glock',blue:'usp'};
  const s=new Simulation('demolition',false,fixture,'competitiveShort');live.push(s);return s;
}

describe('Source primary weapon pickup authority',()=>{
  it('transfers a nearby dropped primary and preserves the death clip/reserve and finish',()=>{
    const s=simulation(),p=s.addPlayer('picker','Picker','blue');
    const drop=s.droppedWeapons.create({id:'dead:ak',ownerId:'dead',weapon:'vandal',createdAt:s.time,
      position:[p.x+.5,p.y+1,p.z],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],
      ammo:11,reserve:47,sourceWeaponFinish:{weapon:'vandal',paintKitId:282,seed:37,wear:.2},sleeping:true});
    expect(drop.weapon).toBe('vandal');
    s.phase='live';s.bomb.carrier=null;
    s.setInput(p.id,{...EMPTY_INPUT,seq:1,slot:1,use:true});s.step();
    expect([p.primary,p.weapon,p.slot,p.ammo,p.reserve,p.primaryAmmo,p.primaryReserve,p.money])
      .toEqual(['vandal','vandal',0,11,47,11,47,800]);
    expect(p.sourceWeaponFinish).toEqual({weapon:'vandal',paintKitId:282,seed:37,wear:.2});
    expect(s.droppedWeapons.read()).toEqual([]);
  });

  it('does not steal a drop while the primary slot is occupied',()=>{
    const s=simulation(),p=s.addPlayer('picker','Picker','blue');
    p.money=5000;expect(s.buy(p.id,'m4a4')).toBe(true);
    s.droppedWeapons.create({id:'dead:awp',ownerId:'dead',weapon:'awp',createdAt:s.time,
      position:[p.x+.4,p.y+1,p.z],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],sleeping:true});
    s.phase='live';s.bomb.carrier=null;s.setInput(p.id,{...EMPTY_INPUT,seq:1,slot:0,use:true});s.step();
    expect(p.primary).toBe('m4a4');expect(s.droppedWeapons.read()).toHaveLength(1);
  });

  it('uses a full original clip for legacy drops without ammo fields',()=>{
    const s=simulation(),p=s.addPlayer('picker','Picker','amber');
    s.droppedWeapons.create({id:'legacy:m4',ownerId:'dead',weapon:'m4a4',createdAt:s.time,
      position:[p.x+.3,p.y+1,p.z],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],sleeping:true});
    s.phase='live';s.bomb.carrier=null;s.setInput(p.id,{...EMPTY_INPUT,seq:1,slot:1,use:true});s.step();
    expect([p.primary,p.ammo,p.reserve]).toEqual(['m4a4',30,90]);
  });

  it('drops the active primary with its exact ammo and picks up a pistol into slot 1',()=>{
    const s=simulation(),p=s.addPlayer('picker','Picker','blue');p.money=5000;expect(s.buy(p.id,'m4a4')).toBe(true);
    p.ammo=13;p.reserve=61;s.phase='live';s.bomb.carrier=null;
    s.setInput(p.id,{...EMPTY_INPUT,seq:1,slot:0,drop:true});s.step();
    expect([p.primary,p.weapon,p.slot]).toEqual([null,'usp',1]);
    const dropped=s.droppedWeapons.read().find(d=>d.weapon==='m4a4')!;
    expect([dropped.ammo,dropped.reserve]).toEqual([13,61]);
    p.x+=2;
    s.droppedWeapons.create({id:'dead:deagle',ownerId:'dead',weapon:'deagle',createdAt:s.time,
      position:[p.x+.2,p.y+1,p.z],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],ammo:4,reserve:19,sleeping:true});
    s.setInput(p.id,{...EMPTY_INPUT,seq:2,slot:1,use:true});s.step();
    expect([p.secondary,p.weapon,p.slot,p.ammo,p.reserve]).toEqual(['deagle','deagle',1,4,19]);
  });
});
