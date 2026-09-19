import type { SourceLevelData } from './source-level.js';
import type { SourceMapCollisionData } from './source-map-collision.js';
import type { SourceNavigationData } from './source-navigation.js';
import type { SourceHitboxProvider,SourcePoseDriver } from './source-player-contract.js';
import type {Team,WeaponId} from './types.js';
import type {SourceBuyZone} from './source-buy-zone.js';
/** Caller loads assets before constructing Simulation. Data can be shared read
 * only; Worlds, colliders and controllers cannot. No fetch or native resources. */
export type SourceScenario={
  /** Room/protocol map key; the original BSP level.id remains independently checked. */
  mapId?:string;
  simulationVersion?:string;
  /** The map's own `func_buyzone` volumes, read from its collision artifact and entity
   * list. A scenario that declares none has no buy zone rule to apply; the shipped map
   * scenario always declares the map's own. */
  buyZones?:readonly SourceBuyZone[];
  /** The build's original surface/decal/sound table for the map this scenario runs, as the
   * exporter staged it. It is validated against the scenario's own BSP before any shot uses
   * it, so a scenario that declares the wrong map's table is refused rather than drawing
   * another map's decals; a scenario that declares none (transplanted scaffolding or a
   * fixture) simply reports no surface for the shots that stop on the world. */
  impacts?:unknown;
  /** Local authority dependency for deterministic fixtures/replay. Never read
   * from room options, an Input, or a remote snapshot. */
  rifleSeed?:()=>number;
  /** One authority seed per current pistol command, never client supplied. */
  pistolSeed?:()=>number;
  level:SourceLevelData;collision:SourceMapCollisionData;navigation?:SourceNavigationData;
  hitboxes?:SourceHitboxProvider;poseDriver?:SourcePoseDriver;
  poseDrivers?:Partial<Record<Team,SourcePoseDriver>>;
  hitboxesByTeam?:Partial<Record<Team,SourceHitboxProvider>>;
  weapons?:readonly WeaponId[];
  defaultWeaponByTeam?:Partial<Record<Team,WeaponId>>;
  defaultSecondaryWeaponByTeam?:Partial<Record<Team,WeaponId>>;
  poseDriversByWeapon?:Partial<Record<Team,Partial<Record<WeaponId,SourcePoseDriver>>>>;
  hitboxesByWeapon?:Partial<Record<Team,Partial<Record<WeaponId,SourceHitboxProvider>>>>;
};
