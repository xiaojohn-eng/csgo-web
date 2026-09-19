import {beforeAll, expect, it} from 'vitest';
import {Simulation, initPhysics} from '../game/simulation';
import {EMPTY_INPUT} from '../game/types';
import {CHARACTER, eyeHeight} from '../game/character-contract';
beforeAll(async()=>initPhysics());
it('standing eye and head hit match the measured C02 height, including the helmet top',()=>{
 const sim=new Simulation('training',false);
 try {
  const shooter=sim.addPlayer('a','A','amber'), target=sim.addPlayer('b','B','blue');
  shooter.x=-20;shooter.y=0;shooter.z=5;shooter.yaw=0;
  target.x=-20;target.y=0;target.z=0;target.armor=0;
  // Aim through the upper helmet: the old head sphere ended at 1.74 m and missed this ray.
  const pitch=Math.atan2(1.80-eyeHeight(shooter),5);
  shooter.pitch=pitch; // shoot consumes authoritative player orientation, not raw input yaw/pitch.
  sim.shoot(shooter,{...EMPTY_INPUT,yaw:0,pitch,time:0,seq:1});
  expect(target.hp).toBeLessThan(100);
  expect(sim.events.some(e=>e.type==='hit'&&e.head)).toBe(true);
  const collider=sim.bodies.get(shooter.id)!.collider;
  expect(2*(collider.halfHeight()+collider.radius())).toBeCloseTo(CHARACTER.standingHeight,5);
  expect(CHARACTER.standingHeight - 1.846612417).toBeGreaterThan(.01);
  expect(CHARACTER.eyeHeight).toBeGreaterThan(1.68);
 } finally {sim.dispose();}
});
