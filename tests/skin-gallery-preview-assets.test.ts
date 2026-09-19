import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SOURCE_FINISHES, SOURCE_FINISH_WEAPONS } from '../game/source-finish-table';

const root = resolve('public/source/csgo-12426148/skin-previews-20260913');
const index = JSON.parse(readFileSync(resolve(root, 'index.json'), 'utf8')) as {
  format: string;
  sourceApp: number;
  build: number;
  summary: { weapons: number; finishes: number; defaults: number; files: number };
  images: { weapon: string; paintKitId: number | null; paintKitName: string; file: string }[];
};

describe('Source inventory preview gallery assets', () => {
  it('keeps every staged finish and default bound to a real PNG URL', () => {
    expect(index).toMatchObject({
      format: 'source-skin-previews-v1',
      sourceApp: 740,
      build: 12426148,
      summary: { weapons: 6, finishes: 238, defaults: 6, files: 244 },
    });
    const imageFiles = new Set(index.images.map(image => image.file));
    expect(index.images).toHaveLength(244);
    for (const weapon of SOURCE_FINISH_WEAPONS) {
      expect(imageFiles.has(`${weapon.id}/default.png`)).toBe(true);
      expect(existsSync(resolve(root, weapon.id, 'default.png'))).toBe(true);
      for (const finish of SOURCE_FINISHES[weapon.id]) {
        const file = `${weapon.id}/${finish.paintKitId}.png`;
        expect(imageFiles.has(file)).toBe(true);
        expect(existsSync(resolve(root, file))).toBe(true);
      }
    }
  });
});
