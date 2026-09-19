// Isolated IPC fixtures. The production room, simulation, SDK and WebSocket transport remain real.
import { matchMaker } from '../../node_modules/@colyseus/core/build/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = ['game/runtime.ts', 'game/simulation.ts', 'game/types.ts', 'server/index.ts', 'server/lan.ts',
  'tests/initial-sync.test.ts', 'node_modules/@colyseus/core/build/Room.mjs', 'node_modules/@colyseus/sdk/build/Room.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file,
  createHash('sha256').update(readFileSync(new URL('../../' + file, import.meta.url))).digest('hex')]));
const bootHashes = hashes();
const { OperationRoom } = await import('../../server/index.ts');
const create = OperationRoom.prototype.onCreate;
const snapshots = OperationRoom.prototype.sendSnapshots;
OperationRoom.prototype.onCreate = async function (options) {
  this.fixtureHeld = true;
  this.fixtureMessages = [];
  const register = this.onMessage.bind(this);
  this.onMessage = (type, callback) => register(type, (client, value) => {
    this.fixtureMessages.push({ type, playerId: client.sessionId, value });
    return callback(client, value);
  });
  await create.call(this, options);
  this.sim.bots = false;
  this.sim.remaining = 999;
};
OperationRoom.prototype.sendSnapshots = function () {
  if (!this.fixtureHeld) snapshots.call(this);
};
const read = room => room ? {
  players: room.sim.players.map(p => ({ ...p })),
  connected: [...room.connectedSessions], retained: [...room.reconnectingSessions.keys()],
  messages: room.fixtureMessages,
} : null;
process.on('message', async ({ requestId, action, roomId, playerId, patch }) => {
  try {
    const room = roomId && matchMaker.getLocalRoomById(roomId);
    let value;
    if (action === 'hashes') value = hashes();
    else if (action === 'state') value = read(room);
    else if (action === 'seed') {
      const p = room.sim.players.find(p => p.id === playerId);
      Object.assign(p, patch);
      room.sim.inputs.delete(playerId);
      room.queues.get(playerId).length = 0;
      value = read(room);
    } else if (action === 'snapshot' || action === 'snapshotWithoutOwn') {
      const snapshot = room.sim.snapshot(playerId);
      if (action === 'snapshotWithoutOwn') snapshot.players = snapshot.players.filter(p => p.id !== playerId);
      room.clients.get(playerId).send('snapshot', snapshot);
      value = snapshot;
    } else if (action === 'drop') {
      room.clients.get(playerId).ref.terminate(); value = true;
    } else if (action === 'clearMessages') {
      room.fixtureMessages.length = 0; value = true;
    } else if (action === 'close') {
      if (room) await room.disconnect(); value = true;
    } else throw Error('Unknown fixture action');
    process.send?.({ requestId, value });
  } catch (error) { process.send?.({ requestId, error: String(error?.stack ?? error) }); }
});
process.send?.({ ready: true, hashes: bootHashes });
