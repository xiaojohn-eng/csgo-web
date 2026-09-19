import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRoomRecovery, Game, readRoomRecovery } from '../game/runtime';

const storage = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

describe('room seat recovery persistence', () => {
  afterEach(() => { storage.clear(); delete (globalThis as { localStorage?: unknown }).localStorage; });

  it('accepts a persisted Colyseus reconnection token record', () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
    storage.set('breachline.room-recovery', JSON.stringify({ endpoint: 'ws://lan.test', token: 'room:token', code: 'ABC123', name: 'A', roomName: 'Dust II', mapId: 'de_dust2', savedAt: Date.now() }));
    expect(readRoomRecovery()).toMatchObject({ endpoint: 'ws://lan.test', token: 'room:token', code: 'ABC123', mapId: 'de_dust2' });
  });

  it('rejects malformed records and explicit leave cleanup removes the token', () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
    storage.set('breachline.room-recovery', '{bad json');
    expect(readRoomRecovery()).toBeNull();
    storage.set('breachline.room-recovery', JSON.stringify({ token: 'only-token' }));
    expect(readRoomRecovery()).toBeNull();
    clearRoomRecovery();
    expect(storage.has('breachline.room-recovery')).toBe(false);
  });

  it('does not consume a token when the current page is on another map', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
    storage.set('breachline.room-recovery', JSON.stringify({ endpoint: 'ws://lan.test', token: 'room:token', code: 'ABC123', name: 'A', roomName: 'Dust II', mapId: 'de_dust2', savedAt: Date.now() }));
    const connect = vi.spyOn(Game.prototype, 'connect').mockResolvedValue(undefined);
    const game = Object.assign(Object.create(Game.prototype) as Game, { mapId: 'port-selene-m01', error: '', notify: vi.fn() });
    await expect(game.reconnectStoredRoom('fallback')).resolves.toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(readRoomRecovery()).not.toBeNull();
    connect.mockRestore();
  });

  it('drops the socket as a reconnectable close during page teardown and keeps the token', () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
    storage.set('breachline.room-recovery', JSON.stringify({ endpoint: 'ws://lan.test', token: 'room:token', code: 'ABC123', name: 'A', roomName: 'Dust II', mapId: 'de_dust2', savedAt: Date.now() }));
    const removeAllListeners = vi.fn();
    const close = vi.fn();
    const room = { removeAllListeners, reconnection: { enabled: true, maxRetries: 10, enqueuedMessages: [] as unknown[] }, connection: { isOpen: true, close } };
    const game = Object.assign(Object.create(Game.prototype) as Game, {
      disposed: false, room, synchronizedRoom: room, recovering: false, online: true,
      frameId: 1, controller: new AbortController(), art: { dispose: vi.fn() }, audio: { dispose: vi.fn() },
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    (game as any).dispose({ preserveRoomRecovery: true });
    expect(removeAllListeners).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(4010);
    expect(room.reconnection.enabled).toBe(false);
    expect(room.reconnection.maxRetries).toBe(0);
    expect((game as any).room).toBeNull();
    expect((game as any).online).toBe(false);
    expect(readRoomRecovery()).not.toBeNull();
    vi.unstubAllGlobals();
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage;
  });
});
