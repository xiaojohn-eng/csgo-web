import { describe, expect, it } from 'vitest';
import * as lan from '../server/lan';
import { WEB_VERSION } from '../game/protocol';
import type { NetworkInterfaceInfo } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

describe('CSGO web LAN contract', () => {
  it('serves LAN HTTP without unsupported origin-isolation headers while preserving CSP and exact origins', async () => {
    const { ALLOWED_ORIGINS: _ignored, ...environment } = process.env;
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...environment, HOST: '0.0.0.0', PORT: '0', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    let startupTimer: ReturnType<typeof setTimeout>;
    const ready = new Promise<number>((resolve, reject) => {
      startupTimer = setTimeout(() => reject(new Error(`Isolated HTTP startup timeout: ${log}`)), 5000);
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Isolated HTTP exited: ${log}`)));
      child.stderr.on('data', value => { log += value; });
      child.stdout.on('data', value => {
        log += value;
        const match = /authority server ready on 0\.0\.0\.0:(\d+)/.exec(log);
        if (match) resolve(Number(match[1]));
      });
    });
    try {
      const port = await ready;
      clearTimeout(startupTimer!);
      const addresses = ['127.0.0.1', ...lan.lanAddresses()];
      for (const address of addresses) {
        const origin = `http://${address}:${port}`;
        const response = await fetch(origin + '/api/server-info', { headers: { Origin: origin } });
        expect(response.status).toBe(200);
        expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
        expect(response.headers.get('origin-agent-cluster')).toBeNull();
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'wasm-unsafe-eval'");
        expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
        expect(response.headers.get('access-control-allow-origin')).toBe(origin);
        expect((await fetch(origin + '/api/server-info', { headers: { Origin: origin + '.evil.invalid' } })).status).toBe(403);
      }
    } finally {
      clearTimeout(startupTimer!);
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM');
        const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
        await exited; clearTimeout(kill);
      }
    }
  }, 10000);

  it('isolates the new game wire protocol from all old BREACHLINE clients', () => {
    expect(WEB_VERSION).toBe('csgo-web-r4');
    expect(() => lan.requireWebVersion({ version: 'csgo-web-r4' })).not.toThrow();
    for (const version of ['csgo-web-r1', 'web-w04', 'web-w03', '', undefined])
      expect(() => lan.requireWebVersion({ version })).toThrow(/VERSION_MISMATCH.*csgo-web-r4/);
  });
  it('advertises only allowed URLs reachable through the configured bind address', () => {
    const module = lan as typeof lan & { serverInfo?: (port: number, host: string, origins: string[], addresses: string[]) => { lanUrls: string[]; localUrl: string | null; port: number } };
    expect(module.serverInfo, 'server-info address contract must exist').toBeTypeOf('function');
    if (!module.serverInfo) return;
    const origins = ['http://127.0.0.1:27015', 'http://192.168.1.8:27015'];
    const info = module.serverInfo(27015, '0.0.0.0', origins, ['192.168.1.8', '10.0.0.8']);
    expect(info.lanUrls).toEqual(['http://192.168.1.8:27015/']);
    expect(info.localUrl).toBe('http://127.0.0.1:27015/');
    expect(info.port).toBe(27015);
    expect(module.serverInfo(27015, '127.0.0.1', origins, ['192.168.1.8']).lanUrls).toEqual([]);
    expect(module.serverInfo(27015, '192.168.1.8', origins, ['192.168.1.8']).localUrl).toBeNull();
  });
  it('excludes benchmarking tunnel and VM bridge addresses from shared LAN addresses', () => {
    const common = { family: 'IPv4' as const, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null };
    const addresses: Record<string, NetworkInterfaceInfo[]> = {
      en0: [{ ...common, internal: false, address: '192.168.1.100' }],
      utun4: [{ ...common, internal: false, address: '198.18.0.1' }],
      bridge101: [{ ...common, internal: false, address: '192.168.194.0' }],
      bridge100: [{ ...common, internal: false, address: '192.168.139.3' }],
      lo0: [{ ...common, internal: true, address: '127.0.0.1' }],
    };
    expect(lan.lanAddresses(addresses)).toEqual(['192.168.1.100']);
  });
});
