import { describe, it, expect } from 'vitest';
import { cleanRoomName, parseAllowedOrigins, requireWebVersion, isControlRequest } from '../server/lan.js';

describe('csgo-web-r4 room contract', () => {
  it('requires the exact protocol version including on legacy code joins', () => {
    expect(() => requireWebVersion({ version: 'csgo-web-r4' })).not.toThrow();
    for (const options of [null, {}, { version: '2.0.0' }, { version: 'web-w02' }, { version: 'web-w03' }, { version: true }, 'csgo-web-r4'])
      expect(() => requireWebVersion(options)).toThrow(/VERSION_MISMATCH.*csgo-web-r4/);
  });
  it('keeps a room title distinct from a player name and limits Unicode characters', () => {
    expect(cleanRoomName(' <大厅>\u0000  ')).toBe('大厅');
    expect(cleanRoomName('😀'.repeat(40))).toBe('😀'.repeat(32));
    expect(cleanRoomName({ name: 'untrusted' })).toBe('局域网行动');
    expect(cleanRoomName('  ')).toBe('局域网行动');
  });
  it('accepts only explicit HTTP origins with no paths, credentials or wildcards', () => {
    expect(parseAllowedOrigins(' http://127.0.0.1:2567, https://lan.example '))
      .toEqual(['http://127.0.0.1:2567', 'https://lan.example']);
    for (const value of ['*', 'null', '', 'http://host/path', 'http://user:pass@host', 'ws://host', 'http://*.example'])
      expect(() => parseAllowedOrigins(value)).toThrow(/ALLOWED_ORIGINS/);
  });
  it('rate limits API and matching paths without charging assets or health', () => {
    for (const path of ['/api/rooms', '/matchmake/create/operation', '/%6datchmake/join/operation'])
      expect(isControlRequest(path)).toBe(true);
    for (const path of ['/', '/models/operator.glb', '/audio/sidearm.wav', '/assets/index.js', '/health'])
      expect(isControlRequest(path)).toBe(false);
  });
});
