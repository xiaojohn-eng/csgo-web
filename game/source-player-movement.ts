import RAPIER from '@dimforge/rapier3d-compat';
import type { SourcePlayerHull } from './source-level.js';
import type { SourceCollisionRole } from './source-map-collision.js';
import {sourceFallVelocityBeforeMove,sourceFallVelocityAfterMove} from './source-landing.js';
import {sourceWalkingGate,sourceRifleGroundAccelerate} from './source-walking.js';

/** Shared simulation identity: includes native IN_SPEED and verified floor recovery. */
export const SOURCE_PLAYER_MOVEMENT_VERSION='csgo-player-movement-12426148-r2' as const;

type Vec3 = { x: number; y: number; z: number };
export type SourceMovementState = {
  feet: Vec3; velocity: Vec3; grounded: boolean; stance: 'standing' | 'crouching';
  /** Authoritative previous button state. Keep per actor; do not accept from a client snapshot. */
  jumpHeld: boolean;
  /** Native m_flFallVelocity, Source units/s; retained across command snapshots. */
  fallVelocitySource?:number;
  /** Native m_bIsWalking gate state, distinct from the current IN_SPEED key. */
  walking?:boolean;
};
export type SourceMovementInput = {
  /** W is positive forward, D positive right; axes are in [-1,1]. */
  forward: number; right: number; yaw: number; jump: boolean; crouch: boolean; dt: number;
  walk?:boolean;
  /** Metres/second weapon wish-speed ceiling before the current CS duck crop.
   * IN_SPEED is derived below; scoped/stamina modifiers remain outside. */
  maxSpeed: number;
};
type MovementLevel = {
  metersPerSourceUnit: number; queryGroups(role: SourceCollisionRole): number;
  player: { standing: SourcePlayerHull; crouching: SourcePlayerHull; gravity: number;
    stepHeight: number; standableNormal: number };
};
export const SOURCE_MOVEMENT_EVIDENCE = Object.freeze({
  serverSha256: '7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386',
  sdkCommit: 'b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474',
  groundAccelerate: 5.5, airAccelerate: 12, friction: 5.2, stopSpeedUnits: 80,
  jumpImpulseUnits: 301.993377, maxVelocityUnits: 3500,
  // These algorithms/constants are evidenced in the fixed SDK, not an engine
  // trace comparison of the CS:GO override. See docs/source-player-movement.md.
  sdkAirSpeedCapUnits: 30,
  // Current ELF CCSGameMovement override, not generic SDK's 1/3 crop:
  // 0xba1330 acceleration / 0xba7580 duck crop, float constants at 0x12c4e50/3c.
  csGroundAccelerationBaseUnits: 250, csDuckMultiplier: 0.3400000035762787,
  csWalkMultiplier:0.5199999809265137,csWalkActivationMarginUnits:25,
});
const identity = { x: 0, y: 0, z: 0, w: 1 };
const down = { x: 0, y: -1, z: 0 };
const pointValid = (value: Vec3) => [value.x, value.y, value.z].every(Number.isFinite);
const dot = (a: Vec3, b: Vec3) => a.x*b.x+a.y*b.y+a.z*b.z;

/** Owns one reusable Rapier KCC, not actors or the world. It can process several
 * actors sequentially because button/velocity/stance state is caller-owned.
 * step() stages the supplied kinematic body. Caller steps the world once after
 * processing its actors, with the same dt; no hidden timers or simulation step.
 */
export function createSourcePlayerMovement(world: RAPIER.World, level: MovementLevel) {
  const unit = level.metersPerSourceUnit, profile = level.player;
  if (!(unit > 0) || !Number.isFinite(unit) || !(profile.gravity > 0) || !Number.isFinite(profile.gravity) ||
    !(profile.stepHeight > 0) || !Number.isFinite(profile.stepHeight) ||
    !(profile.standableNormal > 0 && profile.standableNormal < 1)) throw new Error('Invalid Source movement profile');
  for (const [stance, height, eye] of [['standing',72,64],['crouching',54,46]] as const) {
    const hull=profile[stance],expected=[16*unit,height*unit/2,16*unit];
    if (hull.halfExtents.some((value,i)=>!Number.isFinite(value)||Math.abs(value-expected[i])>1e-9) ||
      !Number.isFinite(hull.eyeHeight)||Math.abs(hull.eyeHeight-eye*unit)>1e-9) throw new Error('Expected current CS:GO 72/54 hull and 64/46 eye profile');
  }
  const shapes = { standing: new RAPIER.Cuboid(...profile.standing.halfExtents), crouching: new RAPIER.Cuboid(...profile.crouching.halfExtents) };
  const groups=level.queryGroups('player'),flags=RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const epsilon=unit/32,probeDistance=2*unit,penetrationTolerance=Math.min(epsilon*.02,1e-5);
  const controller=world.createCharacterController(epsilon);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.setMaxSlopeClimbAngle(Math.acos(profile.standableNormal));
  controller.setMinSlopeSlideAngle(Math.acos(profile.standableNormal));
  let disposed=false;
  const centerOf = (feet:Vec3,stance:SourceMovementState['stance']) => ({...feet,y:feet.y+profile[stance].halfExtents[1]});
  function blockers(feet:Vec3,stance:SourceMovementState['stance'],self:RAPIER.Collider) {
    const center=centerOf(feet,stance),shape=shapes[stance],candidates:RAPIER.Collider[]=[];
    world.intersectionsWithShape(center,identity,shape,candidate=>{candidates.push(candidate);return true;},flags,groups,self);
    // Do not re-enter Rapier queries from inside its callback (WASM borrowing).
    return candidates.filter(candidate=>(candidate.contactShape(shape,center,identity,0)?.distance??0)<-penetrationTolerance);
  }
  function support(feet:Vec3,stance:SourceMovementState['stance'],self:RAPIER.Collider,maxDrop=probeDistance) {
    // Probe the actual surface, then retain the KCC offset outside it. At a
    // sub-millimetre targetDistance Rapier's GJK tolerance can return half the
    // gap; repeatedly subtracting that value would sink a stationary actor.
    const hit=world.castShape(centerOf(feet,stance),identity,down,shapes[stance],0,maxDrop,true,flags,groups,self);
    return hit && hit.normal1.y>=profile.standableNormal && hit.time_of_impact>=0 ? hit : null;
  }
  function step(body:RAPIER.RigidBody,collider:RAPIER.Collider,state:SourceMovementState,input:SourceMovementInput) {
    if(disposed)throw new Error('Source movement already disposed');
    if(!pointValid(state.feet)||!pointValid(state.velocity)||!['standing','crouching'].includes(state.stance)||
      ![input.forward,input.right,input.yaw,input.dt,input.maxSpeed].every(Number.isFinite)||input.dt<=0||input.dt>.1||input.maxSpeed<0)
      throw new Error('Invalid Source movement state/input');
    if(world.getRigidBody(body.handle)!==body||world.getCollider(collider.handle)!==collider||
      body.bodyType()!==RAPIER.RigidBodyType.KinematicPositionBased||collider.parent()?.handle!==body.handle)
      throw new Error('Source movement needs the caller position-kinematic body and its collider');
    const dt=input.dt,feet={...state.feet},velocity={...state.velocity};
    const walking=sourceWalkingGate({maxSpeedSource:input.maxSpeed/unit,
      velocitySource:[velocity.x/unit,-velocity.z/unit,velocity.y/unit],walkingBefore:state.walking??false,
      speedButton:input.walk??false,duckPressed:input.crouch,ducking:false,ducked:state.stance==='crouching'});
    let stance=state.stance,grounded=false,jumped=false,stanceBlocked=false;
    let stanceBlockers:number[]=[];
    // Ground categorization is a full hull trace, not a center ray. No coyote
    // timer or automatic airborne jump buffering is added.
    if(velocity.y<=0){const floor=support(feet,stance,collider);if(floor){feet.y-=Math.max(0,floor.time_of_impact-epsilon);grounded=true;}}
    const sampledFall=sourceFallVelocityBeforeMove(state.fallVelocitySource??0,grounded,velocity.y/unit);
    const wantedStance=input.crouch?'crouching':'standing';
    if(wantedStance!==stance){
      const candidate={...feet};
      // Fixed SDK FinishDuck / FinishUnDuck: preserve feet on ground, hull top
      // in air. The final expanded box contains the previous crouched box.
      if(!grounded)candidate.y+=2*(profile[stance].halfExtents[1]-profile[wantedStance].halfExtents[1]);
      const blocking=wantedStance==='standing'?blockers(candidate,wantedStance,collider):[];
      if(blocking.length){stanceBlocked=true;stanceBlockers=blocking.map(value=>value.handle);}
      else{Object.assign(feet,candidate);stance=wantedStance;}
    }
    const [hx,hy,hz]=profile[stance].halfExtents;
    const oldShape=collider.shape;
    if(oldShape.type!==RAPIER.ShapeType.Cuboid ||
      (oldShape as RAPIER.Cuboid).halfExtents.x!==hx || (oldShape as RAPIER.Cuboid).halfExtents.y!==hy || (oldShape as RAPIER.Cuboid).halfExtents.z!==hz)
      collider.setShape(shapes[stance]);
    collider.setCollisionGroups(groups);
    collider.setTranslationWrtParent({x:0,y:0,z:0});collider.setRotationWrtParent(identity);
    body.setRotation(identity,false);body.setNextKinematicRotation(identity);
    body.setTranslation(centerOf(feet,stance),false);
    world.propagateModifiedBodyPositionsToColliders();
    const wasGrounded=grounded;
    if(input.jump&&!state.jumpHeld&&grounded){velocity.y=SOURCE_MOVEMENT_EVIDENCE.jumpImpulseUnits*unit;grounded=false;jumped=true;}
    else if(grounded)velocity.y=0;
    let forward=Math.max(-1,Math.min(1,input.forward)),right=Math.max(-1,Math.min(1,input.right));
    const inputLength=Math.hypot(forward,right);
    if(inputLength>1){forward/=inputLength;right/=inputLength;}
    const duckCrop=stance==='crouching'?SOURCE_MOVEMENT_EVIDENCE.csDuckMultiplier:1;
    const wishLimit=walking.wishSpeedLimitSource*unit;
    const wish={x:(-Math.sin(input.yaw)*forward+Math.cos(input.yaw)*right)*wishLimit*duckCrop,
      y:0,z:(-Math.cos(input.yaw)*forward-Math.sin(input.yaw)*right)*wishLimit*duckCrop};
    const wishSpeed=Math.hypot(wish.x,wish.z),direction=wishSpeed?{x:wish.x/wishSpeed,y:0,z:wish.z/wishSpeed}:{x:0,y:0,z:0};
    if(grounded){
      const speed=Math.hypot(velocity.x,velocity.z);
      if(speed>=.1*unit){
        const next=Math.max(0,speed-Math.max(speed,SOURCE_MOVEMENT_EVIDENCE.stopSpeedUnits*unit)*SOURCE_MOVEMENT_EVIDENCE.friction*dt);
        velocity.x*=next/speed;velocity.z*=next/speed;
      }
    }
    const speedCap=grounded?wishSpeed:Math.min(wishSpeed,SOURCE_MOVEMENT_EVIDENCE.sdkAirSpeedCapUnits*unit);
    const add=Math.max(0,speedCap-dot(velocity,direction));
    // Current CS override decouples ground acceleration from the cropped wish
    // speed. The full-duck branch uses 250*.34, which can overcome stop friction;
    // blindly using the generic SDK formula with CS ConVars cannot do that.
    const groundBase=Math.max(SOURCE_MOVEMENT_EVIDENCE.csGroundAccelerationBaseUnits*unit,wishSpeed);
    const groundScale=stance==='crouching'?SOURCE_MOVEMENT_EVIDENCE.csDuckMultiplier:
      Math.min(1,input.maxSpeed/(SOURCE_MOVEMENT_EVIDENCE.csGroundAccelerationBaseUnits*unit));
    if(grounded&&stance==='standing'&&wishSpeed>0){
      const accelerated=sourceRifleGroundAccelerate({velocitySource:[velocity.x/unit,-velocity.z/unit,velocity.y/unit],
        wishDirectionSource:[direction.x,-direction.z,0],wishSpeedSource:wishSpeed/unit,weaponSpeedSource:input.maxSpeed/unit,
        speedButton:input.walk??false,dt});
      velocity.x=accelerated[0]*unit;velocity.z=-accelerated[1]*unit;
    }else{
      const amount=Math.min(add,grounded?SOURCE_MOVEMENT_EVIDENCE.groundAccelerate*groundBase*groundScale*dt:
        SOURCE_MOVEMENT_EVIDENCE.airAccelerate*wishSpeed*dt);
      velocity.x+=direction.x*amount;velocity.z+=direction.z*amount;
    }
    if(grounded&&Math.hypot(velocity.x,velocity.z)<unit){velocity.x=0;velocity.z=0;}
    const maxVelocity=SOURCE_MOVEMENT_EVIDENCE.maxVelocityUnits*unit;
    for(const axis of ['x','y','z'] as const)velocity[axis]=Math.max(-maxVelocity,Math.min(maxVelocity,velocity[axis]));
    if(grounded){controller.enableAutostep(profile.stepHeight,0,false);controller.enableSnapToGround(profile.stepHeight);}
    else{controller.disableAutostep();controller.disableSnapToGround();}
    // Fixed SDK's two gravity half-steps, using this CS build's jump impulse.
    // SDK WalkMove zeroes vertical velocity on ground; gravity half-steps are
    // applied to airborne movement, not as a repeated floor penetration.
    const midY=grounded?0:velocity.y-profile.gravity*dt/2;
    controller.computeColliderMovement(collider,{x:velocity.x*dt,y:midY*dt,z:velocity.z*dt},flags,groups);
    const movement=controller.computedMovement();
    const collisions=Array.from({length:controller.numComputedCollisions()},(_,i)=>{
      const hit=controller.computedCollision(i)!;
      let normal={x:hit.normal1.x,y:hit.normal1.y,z:hit.normal1.z};
      // Near-contact GJK normals can tilt on a flat face. Only replace one
      // when a ray on this SAME collider independently returns the exact
      // horizontal facet at the original witness (within the existing gap).
      // This is not a center-ray support test or a wall exclusion.
      if(hit.collider&&normal.y>=profile.standableNormal){
        const origin={x:hit.witness1.x+normal.x*unit,y:hit.witness1.y+normal.y*unit,z:hit.witness1.z+normal.z*unit};
        const ray=new RAPIER.Ray(origin,{x:-normal.x,y:-normal.y,z:-normal.z});
        const exact=hit.collider.castRayAndGetNormal(ray,2*unit,false);
        if(exact&&exact.normal.x===0&&exact.normal.y===1&&exact.normal.z===0&&Math.abs(exact.timeOfImpact-unit)<=epsilon)normal={x:0,y:1,z:0};
      }
      return {handle:hit.collider?.handle??null,normal};
    });
    const nextFeet={x:feet.x+movement.x,y:feet.y+movement.y,z:feet.z+movement.z};
    const response={...velocity,y:grounded?0:midY};
    for(const {normal:n} of collisions){
      // A successful native autostep passes its first riser contact. Clipping
      // against that already-cleared wall would erase valid stair movement.
      const crossedRiser=grounded&&movement.y>epsilon&&n.y<profile.standableNormal&&
        movement.x*n.x+movement.z*n.z < -epsilon;
      if(crossedRiser)continue;
      const inward=dot(response,n);
      if(inward<0){response.x-=inward*n.x;response.y-=inward*n.y;response.z-=inward*n.z;}
    }
    response.y-=profile.gravity*dt/2;
    grounded=!jumped&&midY<=0&&controller.computedGrounded();
    let groundHandle:number|null=null;
    if(midY<=0&&!jumped){const floor=support(nextFeet,stance,collider);
      if(floor){nextFeet.y-=Math.max(0,floor.time_of_impact-epsilon);grounded=true;groundHandle=floor.collider.handle;
        const contact=floor.collider.contactShape(shapes[stance],centerOf(nextFeet,stance),identity,0);
        if(contact&&contact.distance < -penetrationTolerance&&contact.normal1.y>=profile.standableNormal){
          // Rapier snap can accumulate sub-mm negative translations. Repair
          // the actual measured penetration, then verify the whole AABB so
          // a floor repair cannot expand the actor into a ceiling or wall.
          const repaired={...nextFeet,y:nextFeet.y+(-contact.distance+epsilon)/contact.normal1.y};
          if(blockers(repaired,stance,collider).length===0)Object.assign(nextFeet,repaired);
          else{Object.assign(nextFeet,feet);response.x=response.y=response.z=0;grounded=wasGrounded;}
        }
      }}
    if(grounded)response.y=0;
    for(const axis of ['x','y','z'] as const)response[axis]=Math.max(-maxVelocity,Math.min(maxVelocity,response[axis]));
    for(const axis of ['x','z'] as const)if(Math.abs(response[axis])<.1*unit)response[axis]=0;
    body.setNextKinematicTranslation(centerOf(nextFeet,stance));
    const falling=sourceFallVelocityAfterMove(sampledFall,grounded);
    return {feet:nextFeet,velocity:response,grounded,stance,jumpHeld:input.jump,walking:walking.walking,jumped,stanceBlocked,stanceBlockers,
      ...falling,
      eye:{x:nextFeet.x,y:nextFeet.y+profile[stance].eyeHeight,z:nextFeet.z},collisions,groundHandle,
      stepped:wasGrounded&&!jumped&&movement.y>epsilon};
  }
  return {step,dispose(){if(!disposed){disposed=true;world.removeCharacterController(controller);}},
    parameters:{...SOURCE_MOVEMENT_EVIDENCE,metersPerSourceUnit:unit,gravity:profile.gravity,stepHeight:profile.stepHeight,
      collisionOffset:epsilon,groundProbeDistance:probeDistance,surfaceFriction:1,
      boundaries:'Rapier KCC geometry response; fixed SDK friction/air algorithm and current ELF CS ordinary ground/duck/IN_SPEED branch. No water/ladder/moving-base, scoped modifiers, stamina or gradual CS duck state machine.'}};
}
