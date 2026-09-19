import { afterEach, beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSourcePlayerMovement, type SourceMovementState, type SourceMovementInput } from '../game/source-player-movement';
import { sourceMapQueryGroups } from '../game/source-map-collision';
beforeAll(() => RAPIER.init());
const scale=.0254, worlds:RAPIER.World[]=[], disposers:(()=>void)[]=[];
afterEach(()=>{disposers.splice(0).forEach(fn=>fn());worlds.splice(0).forEach(world=>world.free());});
const level={metersPerSourceUnit:scale,queryGroups:sourceMapQueryGroups,
  player:{standing:{halfExtents:[16*scale,36*scale,16*scale] as [number,number,number],eyeHeight:64*scale},
    crouching:{halfExtents:[16*scale,27*scale,16*scale] as [number,number,number],eyeHeight:46*scale},
    gravity:800*scale,stepHeight:18*scale,standableNormal:.7}};
const idle:SourceMovementInput={forward:0,right:0,yaw:0,jump:false,crouch:false,dt:1/60,maxSpeed:215*scale};
function fixture(stance:SourceMovementState['stance']='standing',y=.002){
  const world=new RAPIER.World({x:0,y:-level.player.gravity,z:0});worlds.push(world);
  world.createCollider(RAPIER.ColliderDesc.cuboid(100,.5,100).setTranslation(0,-.5,0).setCollisionGroups(sourceMapQueryGroups('player')));
  const half=level.player[stance].halfExtents;
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,y+half[1],0));
  const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(...half),body);
  const movement=createSourcePlayerMovement(world,level);disposers.push(movement.dispose);world.step();
  let state:SourceMovementState={feet:{x:0,y,z:0},velocity:{x:0,y:0,z:0},grounded:y<.02,stance,jumpHeld:false};
  function tick(patch:Partial<SourceMovementInput>={}){
    const result=movement.step(body,collider,state,{...idle,crouch:state.stance==='crouching',...patch});
    state=result;world.step();return result;
  }
  return {world,body,collider,movement,tick,get state(){return state;},set state(value:SourceMovementState){state=value;}};
}
it('accelerates from rest and applies measured Source ground friction instead of setting requested speed instantly',()=>{
  const f=fixture();const first=f.tick({right:1});
  expect(first.velocity.x/scale).toBeCloseTo(215*5.5/60,5);expect(first.grounded).toBe(true);
  for(let i=0;i<120;i++)f.tick({right:1});expect(f.state.velocity.x/scale).toBeCloseTo(215,3);
  f.state={...f.state,velocity:{x:100*scale,y:0,z:0}};
  expect(f.tick().velocity.x/scale).toBeCloseTo(100-100*5.2/60,4);
  for(let i=0;i<90;i++)f.tick();expect(Math.hypot(f.state.velocity.x,f.state.velocity.z)).toBe(0);
});
it('uses the SDK air projection cap without ground friction or a diagonal input boost',()=>{
  const f=fixture('standing',20);
  expect(f.tick({right:1}).velocity.x/scale).toBeCloseTo(30,5);
  expect(f.tick({right:1}).velocity.x/scale).toBeCloseTo(30,5);
  expect(f.tick().velocity.x/scale).toBeCloseTo(30,5);
  const ground=fixture();for(let i=0;i<120;i++)ground.tick({right:1,forward:1});
  // Native swept-contact normals have float error near the floor. This checks
  // the player-facing constraint (no diagonal speed boost), not bit equality
  // with a collision-free arithmetic path.
  const speed=Math.hypot(ground.state.velocity.x,ground.state.velocity.z);
  expect(speed).toBeLessThanOrEqual(idle.maxSpeed+1e-5);expect(speed).toBeGreaterThan(idle.maxSpeed*.99);
});
it('uses the current CS duck acceleration base so friction cannot pin crouch movement near rest',()=>{
  const f=fixture('crouching');
  const first=f.tick({right:1});expect(first.velocity.x/scale).toBeCloseTo(250*.34*5.5/60,5);
  for(let i=0;i<180;i++)f.tick({right:1});
  expect(f.state.velocity.x/scale).toBeCloseTo(215*.34,3);
  expect(f.state.feet.x).toBeGreaterThan(3);
});
it('rejects standing into a low ceiling with the full 72u AABB then stands after it is removed',()=>{
  const f=fixture('crouching');
  const ceiling=f.world.createCollider(RAPIER.ColliderDesc.cuboid(2,.2,2).setTranslation(0,1.7,0).setCollisionGroups(sourceMapQueryGroups('player')));
  f.world.step();
  const blocked=f.tick({crouch:false});expect(blocked.stance).toBe('crouching');expect(blocked.stanceBlocked).toBe(true);
  expect(blocked.eye.y-blocked.feet.y).toBeCloseTo(46*scale,8);
  f.world.removeCollider(ceiling,false);f.world.step();
  const clear=f.tick({crouch:false});expect(clear.stance).toBe('standing');expect(clear.stanceBlocked).toBe(false);
  expect(clear.eye.y-clear.feet.y).toBeCloseTo(64*scale,8);
});
it('jumps once while held, lands, and requires a release before the next jump',()=>{
  const f=fixture();let jumps=0,maxY=0,landed=false;
  for(let i=0;i<180;i++){const state=f.tick({jump:true});jumps+=Number(state.jumped);maxY=Math.max(maxY,state.feet.y);if(i>10&&state.grounded)landed=true;}
  expect(jumps).toBe(1);expect(landed).toBe(true);expect(f.state.grounded).toBe(true);
  expect(maxY).toBeGreaterThan(1.40);expect(maxY).toBeLessThan(1.50);
  f.tick({jump:false});expect(f.tick({jump:true}).jumped).toBe(true);
});
it('does not buffer an airborne jump press into an automatic landing jump',()=>{
  const f=fixture('standing',3);let jumps=0;
  for(let i=0;i<150;i++)jumps+=Number(f.tick({jump:true}).jumped);
  expect(jumps).toBe(0);expect(f.state.grounded).toBe(true);
  f.tick();expect(f.tick({jump:true}).jumped).toBe(true);
});
it('keeps the hull axis aligned and blocks playerclip while ignoring projectile-only walls',()=>{
  const f=fixture();
  f.world.createCollider(RAPIER.ColliderDesc.cuboid(3,2,.02).setTranslation(0,2,-2).setCollisionGroups(sourceMapQueryGroups('player')));
  f.world.createCollider(RAPIER.ColliderDesc.cuboid(3,2,.02).setTranslation(0,2,-.7).setCollisionGroups(sourceMapQueryGroups('projectile')));
  f.body.setRotation({x:0,y:Math.sin(.4),z:0,w:Math.cos(.4)},false);f.world.step();
  for(let i=0;i<120;i++)f.tick({forward:1});
  expect(f.state.feet.z).toBeLessThan(-1);expect(f.state.feet.z).toBeGreaterThan(-2+.02+16*scale-.001);
  expect(f.state.velocity.z).toBeCloseTo(0,5);expect(f.body.rotation()).toEqual({x:0,y:0,z:0,w:1});
  f.tick({forward:1,yaw:Math.PI/2});expect(f.state.feet.x).toBeLessThan(0);
  expect(f.collider.shapeType()).toBe(RAPIER.ShapeType.Cuboid);
});
it('preserves the airborne hull top when crouching and stops at the original floor on landing',()=>{
  const f=fixture('standing',3),oldTop=f.state.feet.y+72*scale;
  const down=f.tick({crouch:true});
  expect(down.stance).toBe('crouching');expect(down.feet.y+54*scale).toBeCloseTo(oldTop-800*scale*(1/60)**2/2,5);
  for(let i=0;i<150;i++)f.tick({crouch:true});expect(f.state.grounded).toBe(true);
  expect(f.state.feet.y).toBeGreaterThan(-.00002);expect(f.state.feet.y).toBeLessThan(.003);
});
it('rejects invalid dt before mutation and owns only its controller',()=>{
  const f=fixture(),before=f.body.translation();
  expect(()=>f.tick({dt:NaN})).toThrow();expect(f.body.translation()).toEqual(before);
  f.movement.dispose();f.movement.dispose();expect(f.world.getRigidBody(f.body.handle)).toBe(f.body);
  expect(()=>f.tick()).toThrow('disposed');
});
it('shares a controller without sharing another actor jump latch, velocity or stance',()=>{
  const f=fixture(),half=level.player.crouching.halfExtents;
  const body=f.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5,.002+half[1],0));
  const collider=f.world.createCollider(RAPIER.ColliderDesc.cuboid(...half),body);f.world.step();
  const state:SourceMovementState={feet:{x:5,y:.002,z:0},velocity:{x:0,y:0,z:0},grounded:true,stance:'crouching',jumpHeld:false};
  const first=f.movement.step(f.body,f.collider,f.state,{...idle,jump:true});
  const second=f.movement.step(body,collider,state,{...idle,crouch:true,right:1});f.world.step();
  expect(first.jumped).toBe(true);expect(second.jumped).toBe(false);expect(second.jumpHeld).toBe(false);
  expect(second.stance).toBe('crouching');expect(first.stance).toBe('standing');
  expect(second.velocity.x).toBeGreaterThan(0);expect(first.velocity.x).toBe(0);
  expect(first.velocity.y).toBeGreaterThan(0);expect(second.grounded).toBe(true);
  const next=f.movement.step(body,collider,second,{...idle,crouch:true,jump:true});expect(next.jumped).toBe(true);
});

it('retains the prior fall sample when initial ground categorization lands and fires the callback once',()=>{
 const f=fixture();f.state={...f.state,grounded:false,velocity:{x:0,y:-5,z:0},fallVelocitySource:185};
 const first=f.tick();expect(first.grounded).toBe(true);expect(first.velocity.y).toBe(0);
 expect(first.landedFallVelocitySource).toBe(185);expect(first.fallVelocitySource).toBe(0);
 expect(f.tick().landedFallVelocitySource).toBeNull();
});
it('carries the pre-gravity airborne impact sample through JSON replay instead of post-contact zero velocity',()=>{
 const a=fixture('standing',3),b=fixture('standing',3);let landed=0;
 for(let i=0;i<90;i++){
  if(i===15)b.state=JSON.parse(JSON.stringify(a.state));
  const prior=a.state.velocity.y/scale,next=a.tick(),other=b.tick();
  expect(other.fallVelocitySource).toBe(next.fallVelocitySource);
  if(next.landedFallVelocitySource!==null){
   landed++;expect(next.landedFallVelocitySource).toBeCloseTo(-prior,3);
   expect(next.velocity.y).toBe(0);expect(next.landedFallVelocitySource).toBeGreaterThan(0);
  }
 }
 expect(landed).toBe(1);
});

it('walks at original rifle cap, suppresses walking during duck and resumes running on release',()=>{
 const f=fixture();const first=f.tick({right:1,walk:true});
 expect(first.walking).toBe(true);expect(first.velocity.x/scale).toBeCloseTo(130*5.5/60,5);
 for(let i=0;i<120;i++)f.tick({right:1,walk:true});
 expect(f.state.velocity.x/scale).toBeCloseTo(215*.52,3);
 const duck=f.tick({right:1,walk:true,crouch:true});expect(duck.walking).toBe(false);
 for(let i=0;i<120;i++)f.tick({right:1,walk:true,crouch:true});
 expect(f.state.velocity.x/scale).toBeCloseTo(215*.34,3);
 const stood=f.tick({crouch:false,right:1,walk:true});expect(stood.stance,JSON.stringify(stood)).toBe('standing');f.tick({right:1,walk:true,crouch:false});
 expect(f.state.walking).toBe(true);
 const run=f.tick({right:1,walk:false});expect(run.walking).toBe(false);
 for(let i=0;i<90;i++)f.tick({right:1,walk:false});expect(f.state.velocity.x/scale).toBeCloseTo(215,3);
});
it('decelerates a running Shift request before activating the original walking flag',()=>{
 const f=fixture();f.state={...f.state,walking:false,velocity:{x:200*scale,y:0,z:0}};
 const first=f.tick({right:1,walk:true});expect(first.walking).toBe(false);
 expect(first.velocity.x/scale).toBeCloseTo(200*(1-5.2/60),4);
 expect(first.velocity.x/scale).toBeGreaterThan(215*.52+25);
 let activated=false;
 for(let i=0;i<30;i++){const next=f.tick({right:1,walk:true});activated||=next.walking;}
 expect(activated).toBe(true);expect(f.state.velocity.x/scale).toBeCloseTo(215*.52,3);
});
it('replays walking transitions through JSON without borrowing another actor flag',()=>{
 const a=fixture(),b=fixture();
 for(let i=0;i<240;i++){
  const input={right:1,walk:i>30&&i<180,crouch:i>120&&i<150,jump:i===85};
  if(i===65)b.state=JSON.parse(JSON.stringify(a.state));
  const next=a.tick(input),other=b.tick(input);
  expect(other.walking).toBe(next.walking);expect(other.velocity).toEqual(next.velocity);expect(other.fallVelocitySource).toBe(next.fallVelocitySource);
 }
});
it('does not sink into a flat floor during sustained run or crouch movement',()=>{
 for(const stance of ['standing','crouching']as const){
  const f=fixture(stance);
  for(let i=0;i<360;i++)f.tick({right:1,walk:false});
  expect(f.state.feet.y,`${stance} ${JSON.stringify(f.state.feet)}`).toBeGreaterThan(-.0001);
  expect(f.state.grounded).toBe(true);
 }
});
it('validates a floor recovery against a low ceiling instead of lifting the AABB through it',()=>{
 const f=fixture('crouching',.00002),height=54*scale;
 const ceiling=f.world.createCollider(RAPIER.ColliderDesc.cuboid(100,.2,100).setTranslation(0,height+.00005+.2,0).setCollisionGroups(sourceMapQueryGroups('player')));f.world.step();
 for(let i=0;i<100;i++){
  const state=f.tick({right:1,crouch:true,walk:true}),half=level.player.crouching.halfExtents;
  const contact=ceiling.contactShape(new RAPIER.Cuboid(...half),{...state.feet,y:state.feet.y+half[1]},{x:0,y:0,z:0,w:1},0);
  expect(contact?.distance??0).toBeGreaterThanOrEqual(-.00001);expect(state.feet.y).toBeGreaterThan(-.00001);
 }
 expect(f.tick({crouch:false}).stanceBlocked).toBe(true);
});
