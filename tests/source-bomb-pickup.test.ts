import {afterEach,beforeAll,expect,it} from 'vitest';
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

it('drops the unplanted bomb on carrier death and lets a living T recover it',()=>{
  const s=simulation(),carrier=s.addPlayer('carrier','Carrier','amber'),killer=s.addPlayer('killer','Killer','blue'),picker=s.addPlayer('picker','Picker','amber');
  s.phase='live';s.bomb.carrier=carrier.id;carrier.x=picker.x;carrier.z=picker.z;carrier.y=picker.y;
  s.damage(carrier,killer,1000,false);
  expect([s.bomb.planted,s.bomb.dropped,s.bomb.carrier]).toEqual([false,true,null]);
  expect([s.bomb.x,s.bomb.y,s.bomb.z]).toEqual([carrier.x,carrier.y,carrier.z]);
  s.setInput(picker.id,{...EMPTY_INPUT,seq:1,slot:1,use:true});s.step();
  expect([s.bomb.dropped,s.bomb.carrier]).toEqual([false,picker.id]);
  expect(s.snapshot(picker.id).bomb).toMatchObject({dropped:false,carrier:picker.id});
});

it('keeps planting priority when a dropped bomb and plant zone share the E key',()=>{
  const s=simulation(),carrier=s.addPlayer('carrier','Carrier','amber');
  s.phase='live';s.bomb.carrier=carrier.id;carrier.x=-4;carrier.z=0;carrier.y=-3.75;
  s.droppedWeapons.create({id:'nearby:ak',ownerId:'dead',weapon:'vandal',createdAt:s.time,
    position:[carrier.x+.2,carrier.y+1,carrier.z],quaternion:[0,0,0,1],velocity:[0,0,0],angularVelocity:[0,0,0],sleeping:true});
  s.setInput(carrier.id,{...EMPTY_INPUT,seq:1,slot:1,use:true});s.step();
  expect(s.bomb.carrier).toBe(carrier.id);expect(s.bomb.planted).toBe(false);
  expect(s.bomb.site).toBe('');expect(s.droppedWeapons.read()).toHaveLength(1);
});
