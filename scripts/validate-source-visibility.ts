import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { prepareSourceVisibility, querySourceVisibility } from '../game/source-visibility';

const directory = resolve('.reference-assets/source-exports/dust2/visibility');
const raw = readFileSync(resolve(directory, 'visibility.json'));
const data = JSON.parse(raw.toString()), fixtures = JSON.parse(readFileSync(resolve(directory, 'spawn-fixtures.json'), 'utf8'));
// Independently reconstruct every RLE PVS row from the preserved original lump.
// Does not call the Python decompressor or use its bit-offset receipt.
const originalVis = readFileSync(resolve(directory, 'original-visibility-lump.bin'));
const originalView = new DataView(originalVis.buffer, originalVis.byteOffset, originalVis.byteLength);
assert.equal(originalView.getInt32(0, true), data.clusterCount);
const rowBytes = Math.ceil(data.clusterCount / 8);
for (let cluster = 0; cluster < data.clusterCount; cluster++) {
  let at = originalView.getInt32(4 + 8 * cluster, true);
  if (at === -1) { assert.equal(data.pvsRows[cluster], null); continue; }
  assert(at >= 4 + 8 * data.clusterCount && at < originalVis.length);
  const row = Buffer.alloc(rowBytes); let written = 0;
  while (written < rowBytes) {
    assert(at < originalVis.length); const value = originalVis[at++];
    if (value !== 0) row[written++] = value;
    else {
      assert(at < originalVis.length); const count = originalVis[at++];
      assert(count > 0 && written + count <= rowBytes); written += count;
    }
  }
  assert.equal(row.toString('base64'), data.pvsRows[cluster]);
}
const start = performance.now(), index = prepareSourceVisibility(data), prepareMs = performance.now() - start;
assert(index.valid, index.reason); const samples = []; let totalMs = 0;
for (const spawn of fixtures) for (const eye of [false, true]) {
  const values = eye ? spawn.browserEye64 : spawn.browserOrigin, expected = eye ? spawn.eyeExpected : spawn.originExpected;
  const point = { x: values[0], y: values[1], z: values[2] }, timer = performance.now(), result = querySourceVisibility(index, point);
  const milliseconds = performance.now() - timer; totalMs += milliseconds;
  assert.deepEqual([result.leaf, result.cluster, result.worldFaceIds, result.staticPropIds], [expected.leaf, expected.cluster, expected.faces, expected.props]);
  assert.equal(result.allVisible, expected.allVisible);
  samples.push({ hammerid: spawn.hammerid, team: spawn.team, eye64: eye, leaf: result.leaf, cluster: result.cluster,
    allVisible: result.allVisible, faceCount: result.worldFaceIds.length, propCount: result.staticPropIds.length, milliseconds });
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const result = { status: 'passed', sourceBspSha256: data.sourceBspSha256, dataSha256: sha(raw), dataBytes: raw.length,
  originalVisSha256: sha(originalVis), originalPvsRowsVerified: data.clusterCount,
  moduleSha256: sha(readFileSync(resolve('game/source-visibility.ts'))), extractorSha256: sha(readFileSync(resolve('scripts/extract-source-visibility.py'))),
  prepareMs, samples: samples.length, meanQueryMs: totalMs / samples.length,
  details: samples, boundary: 'Original 30 spawn origins + original Z+64 Source-unit diagnostic eye points; CPU validation, not renderer/GPU or actual player eye calibration.' };
writeFileSync(resolve(directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, details: undefined }));
