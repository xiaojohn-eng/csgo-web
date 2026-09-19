import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createSourceGlockCommandState, sourceGlockCommandFrame, sourceGlockHolster, sourceGlockDeploy, sourceGlockBeginDeploy,
  SOURCE_GLOCK_COMMAND_SOURCE_SHA256, SOURCE_GLOCK_COMMAND_VERSION, SOURCE_GLOCK_DRAW_SEQUENCE_DURATION,
  type SourceGlockCommandContext, type SourceGlockCommandState } from '../game/source-glock-command';
const sourcePath = 'output/tests/source-glock-command-native.json';
const bytes = await readFile(sourcePath), native = JSON.parse(new TextDecoder().decode(bytes));
assert.equal(native.serverSha256, SOURCE_GLOCK_COMMAND_SOURCE_SHA256);
for (const [index, row] of native.cases.entries()) {
  const input = createSourceGlockCommandState(row.input as Partial<SourceGlockCommandState>), c = row.context;
  const result = c.operation === 'holster' ? sourceGlockHolster(input, { now: c.now, sequenceDuration: c.holsterDuration ?? 0, owner: c.owner })
    : c.operation === 'deploy-prefix' ? sourceGlockBeginDeploy(input)
    : c.operation === 'deploy' ? sourceGlockDeploy(input, { now: c.now, sequenceDuration: c.drawDuration ?? SOURCE_GLOCK_DRAW_SEQUENCE_DURATION, owner: c.owner })
    : sourceGlockCommandFrame(input, c as SourceGlockCommandContext);
  const { attributes: _attributes, ...expected } = row.result;
  assert.deepStrictEqual(result, expected, `${index}: ${row.label}`);
}
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const files = ['game/source-glock-command.ts', 'scripts/probe-source-glock-command.py', 'scripts/inspect-source-glock-command.py', 'scripts/validate-source-glock-command.ts', 'tests/source-glock-command.test.ts'];
const sourceFiles = await Promise.all(files.map(async path => ({ path, sha256: hash(await readFile(path)) })));
const report = { version: SOURCE_GLOCK_COMMAND_VERSION, sourceServerSha256: native.serverSha256, sourceItemsSha256: native.itemsSha256,
  oracle: { path: sourcePath, sha256: hash(bytes), cases: native.cases.length, criticalOriginalAddressesExecuted: native.criticalExecuted },
  sourceFiles, validation: { exactStateEventDispatchButtonMatches: native.cases.length, mismatches: 0 },
  boundaries: native.boundaries, publicIntegration: false };
await writeFile('output/tests/source-glock-command-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ cases: native.cases.length, mismatches: 0, report: 'output/tests/source-glock-command-validation.json' }));
