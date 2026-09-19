/** Normal App740 CheckParameters IN_SPEED gate, before wish-axis cropping.
 * See docs/source-walking.md. It does not own a KCC, input key or tick clock. */
const f=Math.fround;
export const SOURCE_WALKING_VERSION='csgo-walking-12426148-r1' as const;
export type SourceWalkingInput={
  maxSpeedSource:number;
  /** Original m_vecVelocity, Source units/s, XYZ with Z up. All three axes. */
  velocitySource:readonly[number,number,number];
  walkingBefore:boolean;speedButton:boolean;duckPressed:boolean;ducking:boolean;ducked:boolean;
};
export function sourceWalkingGate(c:SourceWalkingInput){
  if(!Number.isFinite(f(c.maxSpeedSource))||c.maxSpeedSource<0||c.velocitySource.length!==3||!c.velocitySource.every(v=>Number.isFinite(f(v)))||![c.walkingBefore,c.speedButton,c.duckPressed,c.ducking,c.ducked].every(v=>typeof v==='boolean'))throw Error('Invalid Source walking input');
  const max=f(c.maxSpeedSource),requested=c.speedButton&&!c.duckPressed&&!c.ducking&&!c.ducked;
  if(!requested)return {walking:false,walkRequested:false,wishSpeedLimitSource:max};
  const v=c.velocitySource.map(f),length=f(Math.sqrt(f(f(v[2]!*v[2]!)+f(f(v[0]!*v[0]!)+f(v[1]!*v[1]!)))));
  const cap=f(max*f(.52)),activate=length<f(cap+25);
  // The high-speed branch preserves the previous flag. Accelerate has its
  // own IN_SPEED branch, so simply cropping every request to .52 is wrong.
  return {walking:activate?true:c.walkingBefore,walkRequested:true,wishSpeedLimitSource:activate?cap:max};
}
export type SourceRifleGroundAccelerationInput={
  /** Velocity after the caller's ground friction; not the earlier gate sample. */
  velocitySource:readonly[number,number,number];wishDirectionSource:readonly[number,number,number];
  wishSpeedSource:number;weaponSpeedSource:number;speedButton:boolean;dt:number;surfaceFriction?:number;
};
/** Original ordinary standing rifle Accelerate through velocity stores.
 * No duck/hostage/heavy armor/ExoJump/encumbrance/stamina slowdown or air branch.
 * The caller applies ground friction first and KCC afterwards. Direction must
 * already be normalized. This is not a replacement for the whole controller. */
export function sourceRifleGroundAccelerate(c:SourceRifleGroundAccelerationInput):[number,number,number]{
  const friction=c.surfaceFriction??1;
  if(![...c.velocitySource,...c.wishDirectionSource,c.wishSpeedSource,c.weaponSpeedSource,c.dt,friction].every(v=>Number.isFinite(f(v)))||c.velocitySource.length!==3||c.wishDirectionSource.length!==3||c.wishSpeedSource<0||c.weaponSpeedSource<=0||c.dt<0||friction<0||typeof c.speedButton!=='boolean'||Math.abs(Math.hypot(...c.wishDirectionSource)-1)>1e-5)throw Error('Invalid ordinary Source ground acceleration');
  const v=c.velocitySource.map(f),direction=c.wishDirectionSource.map(f),wish=f(c.wishSpeedSource),dt=f(c.dt);
  const projection=f(f(f(direction[0]!*v[0]!)+f(direction[1]!*v[1]!))+f(direction[2]!*v[2]!));
  const add=f(wish-projection);if(add<=0)return v as[number,number,number];
  const base=Math.max(250,wish),ratio=Math.min(f(f(c.weaponSpeedSource)/250),1);
  let acceleration=f(5.5),speed=f(base*(c.speedButton?1:ratio));
  if(c.speedButton){
    speed=f(speed*f(.52));
    const cap=f(f(base*ratio)*f(.52)),current=Math.max(projection,0);
    if(current>f(cap-5)){
      const factor=Math.min(1,Math.max(0,f(f(f(f(cap-current)-5)*f(.2))+1)));
      acceleration=f(acceleration*factor);
    }
  }
  const amount=Math.min(add,f(f(f(dt*acceleration)*speed)*f(friction)));
  return v.map((value,i)=>f(value+f(direction[i]!*amount)))as[number,number,number];
}
