// Test-only IPC fixture access around the actual production room and WebSocket server.
// This process is launched on a fresh loopback port; it never connects to port 2567.
import { matchMaker } from '../../node_modules/@colyseus/core/build/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sourceFiles = ['server/index.ts', 'server/lan.ts', 'server/visibility.ts', 'game/simulation.ts',
  'game/types.ts', 'game/map.ts', 'game/tactics.ts', 'game/handling.ts', 'game/character-contract.ts',
  'tests/net-session.test.ts', 'node_modules/@colyseus/core/build/Room.mjs', 'node_modules/@colyseus/sdk/build/Room.mjs'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file,
  createHash('sha256').update(readFileSync(new URL('../../' + file, import.meta.url))).digest('hex')]));
const bootHashes = sourceHashes();
await import('../../server/index.ts');

function read(room) {
  if (!room) return null;
  return {
    info: room.roomInfo(),
    players: room.sim.players.map(p => ({ ...p })),
    bodies: Object.fromEntries([...room.sim.bodies].map(([id, v]) => [id,
      { body: v.body.handle, collider: v.collider.handle, enabled: v.collider.isEnabled() }])),
    inputs: Object.fromEntries(room.sim.inputs),
    queues: Object.fromEntries(room.queues),
    connected: [...room.clients].map(c => c.sessionId),
    retained: [...(room.reconnectingSessions?.keys() ?? [])],
  };
}

process.on('message', async ({ requestId, action, roomId, playerId, patch, input }) => {
  try {
    const room = roomId && matchMaker.getLocalRoomById(roomId);
    let value;
    if (action === 'sourceHashes') value = sourceHashes();
    else if (action === 'state') value = read(room);
    else if (action === 'seed' || action === 'seedAndDrop') {
      if (!room) throw Error('Fixture room missing');
      // Deterministic fixture only: bots cannot attack while checking transfer invariants.
      room.sim.bots = false;
      room.sim.phase = 'live';
      room.sim.remaining = 999;
      const p = room.sim.players.find(p => p.id === playerId);
      if (!p) throw Error('Fixture player missing');
      Object.assign(p, patch);
      room.sim.bodies.get(playerId).collider.setEnabled(p.alive);
      if (input) {
        room.sim.setInput(playerId, input);
        room.queues.get(playerId)?.push(input);
      }
      value = read(room);
      if (action === 'seedAndDrop') room.clients.get(playerId).ref.terminate();
    } else if (action === 'drop') {
      if (!room?.clients.get(playerId)) throw Error('Connected fixture player missing');
      room.clients.get(playerId).ref.terminate();
      value = true;
    } else if (action === 'closeRoom') {
      if (room) await room.disconnect();
      value = true;
    } else throw Error('Unknown fixture action');
    process.send?.({ requestId, value });
  } catch (error) {
    process.send?.({ requestId, error: String(error?.stack ?? error) });
  }
});
process.send?.({ ready: true, sourceHashes: bootHashes });
