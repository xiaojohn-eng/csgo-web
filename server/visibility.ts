import { eyeHeight } from '../game/character-contract.js';
import { sight } from '../game/map.js';
import { smokeBlocks } from '../game/tactics.js';
import type { Snapshot,Player } from '../game/types.js';
/** Mutates a fresh per-recipient snapshot, never authoritative player state. */
export function filterVisibility(
  s: Snapshot,
  recipient: string,
  eventCursor: number,
  context?:{eyeOrigin(p:Player):{x:number;y:number;z:number};sight(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}):boolean},
) {
  const own = s.players.find((p) => p.id === recipient);
  if (!own) return;
  if(own.sourceContract&&!context)throw Error('Source visibility requires the scene contract');
  const sourceContext=own.sourceContract?context:undefined;
  const eye = sourceContext?sourceContext.eyeOrigin(own):{ x: own.x, y: own.y + eyeHeight(own), z: own.z };
  const canSee=sourceContext?(a:typeof eye,b:typeof eye)=>sourceContext.sight(a,b):sight;
  for (const p of s.players) {
    const target = p.sourceContract&&context?context.eyeOrigin(p):{ x: p.x, y: p.y + (p.crouch ? 0.95 : 1.4), z: p.z };
    if (
      p.team !== own.team &&
      (!canSee(eye, target) || smokeBlocks(eye, target, s.smokes))
    ) {
      p.x = p.z = p.yaw = p.pitch = p.vx = p.vy = p.vz = 0;
      p.y = -100;
      p.hp = 100;
      p.armor = p.money = 0;
      p.shotHeat = 0;
      p.shotIdle = 0;
    }
  }
  s.events = s.events
    .filter((e) => e.id > eventCursor)
    .map((e) => {
      const source = { x: e.x ?? 0, y: e.y ?? 1.4, z: e.z ?? 0 };
      if (
        e.type !== 'shot' ||
        e.by === own.id ||
        (canSee(eye, source) && !smokeBlocks(eye, source, s.smokes))
      )
        return e;
      return {
        id: e.id,
        time: e.time,
        type: 'report',
        by: e.by,
        weapon: e.weapon,
        ...(e.weapon==='usp'&&e.sourcePistolShot?{sourcePistolSoundMode:e.sourcePistolShot.mode}:{}),
        x: Math.round(source.x / 2) * 2,
        y: source.y,
        z: Math.round(source.z / 2) * 2,
      };
    });
}
