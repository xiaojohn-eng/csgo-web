import { eyeHeight } from './character-contract.js';
import { sight } from './map.js';
import type { Player } from './types.js';
export type Smoke = {
  id: number;
  x: number;
  y: number;
  z: number;
  age: number;
  remaining: number;
};
export function smokeRadius(s: Smoke) {
  return 3.5 * Math.min(1, s.age / 0.7) * Math.min(1, s.remaining / 1.5);
}
export function smokeBlocks(
  a: { x: number; y?: number; z: number },
  b: { x: number; y?: number; z: number },
  clouds: Smoke[],
) {
  const dx = b.x - a.x,
    dy = (b.y ?? 1.4) - (a.y ?? 1.4),
    dz = b.z - a.z,
    length = Math.hypot(dx, dy, dz);
  if (length < 0.001) return false;
  return clouds.some((s) => {
    const x = a.x - s.x,
      y = (a.y ?? 1.4) - s.y,
      z = a.z - s.z;
    const projection = -(x * dx + y * dy + z * dz) / length,
      r = smokeRadius(s);
    const perpendicular = x * x + y * y + z * z - projection * projection;
    if (perpendicular >= r * r) return false;
    const half = Math.sqrt(r * r - perpendicular);
    return (
      Math.min(length, projection + half) - Math.max(0, projection - half) > 0.7
    );
  });
}
export function flashExposure(
  p: Player,
  source: { x: number; y: number; z: number },
  context?:{eyeOrigin(p:Player):{x:number;y:number;z:number};sight(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}):boolean},
) {
  if(p.sourceContract&&!context)throw Error('Source flash exposure requires the scene contract');
  const sourceContext=p.sourceContract?context:undefined;
  const eye = sourceContext?sourceContext.eyeOrigin(p):{ x: p.x, y: p.y + eyeHeight(p), z: p.z };
  const x = source.x - eye.x,
    y = source.y - eye.y,
    z = source.z - eye.z,
    d = Math.hypot(x, y, z);
  if (d > 24 || !(sourceContext?sourceContext.sight(eye,source):sight(eye, source))) return 0;
  const facing =
    (-Math.sin(p.yaw) * Math.cos(p.pitch) * x +
      Math.sin(p.pitch) * y -
      Math.cos(p.yaw) * Math.cos(p.pitch) * z) /
    Math.max(0.01, d);
  return (
    Math.min(1, Math.max(0, 1 - d / 28)) *
    (facing > 0.5 ? 1 : facing > -0.1 ? 0.5 : 0.15)
  );
}
