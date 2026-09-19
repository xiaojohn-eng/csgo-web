import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Player } from '../../game/types';

/** Real shipped C02 geometry/skin/animation. Only browser image/material I/O is stripped in memory. */
export async function loadC02Geometry() {
  const source = readFileSync(new URL('../../public/models/web-w01/falcon-combat-actions.glb', import.meta.url));
  const jsonBytes = new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(12, true);
  const json = JSON.parse(source.subarray(20, 20 + jsonBytes).toString());
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.materials = []; json.images = []; json.textures = [];
  const text = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const binary = source.subarray(20 + jsonBytes), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binary.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const data = Buffer.concat([header, padded, binary]);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

export const c02Player = (): Player => ({ id: 'performance', name: 'Performance', team: 'amber', bot: false,
  x: 2, y: 1, z: -3, yaw: .5, pitch: .6, vy: 0, vx: 0, vz: 0, shotHeat: 0, shotIdle: 1,
  grounded: true, crouch: true, stancePhase: .7, stanceRate: 0, stanceTarget: true,
  hp: 100, armor: 0, alive: true, weapon: 'vandal', primary: 'vandal', slot: 0,
  ammo: 30, reserve: 90, primaryAmmo: 30, primaryReserve: 90, pistolAmmo: 12, pistolReserve: 48,
  reload: .8, cooldown: 0, kills: 0, deaths: 0, money: 0, ack: 0, respawn: 0, use: 0,
  grenades: 0, smokes: 0, flashes: 0, flash: 0, reveal: 0 });
