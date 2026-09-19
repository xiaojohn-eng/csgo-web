/** Read the rifle dispatcher's four smoke subsystems out of the staged graph, with the
 * build's own executed native defaults applied, so the reader that draws them can be
 * written against the numbers the runtime will actually see rather than against names.
 *
 * Run: npx tsx scripts/probe-source-muzzle-smoke-parameters.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareSourcePistolParticleGraph, sourcePistolParticleParameters, type SourceParticleNativeDefaults,
  type SourceParticleElement } from '../game/source-pistol-particles-graph';
import type { GraphPhase } from '../game/source-rifle-muzzle-particles';

const root = resolve(import.meta.dirname, '..');
const dir = process.env.PARTICLE_GRAPH_DIR ? resolve(process.env.PARTICLE_GRAPH_DIR) : resolve(root, 'public/source/csgo-12426148/muzzle-particles');
const graph = prepareSourcePistolParticleGraph(JSON.parse(readFileSync(resolve(dir, 'graph.json'), 'utf8')));
const defaultsPath = process.env.PARTICLE_NATIVE_DEFAULTS
  ? resolve(process.env.PARTICLE_NATIVE_DEFAULTS) : resolve(dir, 'native-defaults.json');
const native = JSON.parse(readFileSync(defaultsPath, 'utf8')) as SourceParticleNativeDefaults;
const SYSTEMS = (process.env.PARTICLE_SYSTEMS ?? 'weapon_muzzle_flash_smoke_small2,weapon_muzzle_flash_smoke_small3,weapon_shell_eject_smoke_assrifle2,weapon_shell_eject_smoke_assrifle3').split(',');
const PHASES: GraphPhase[] = ['emitters', 'initializers', 'operators', 'renderers', 'forces', 'constraints', 'children'];
const rows: Record<string, unknown>[] = [];
for (const system of SYSTEMS) {
  const element = graph.systems.get(system) as SourceParticleElement | undefined;
  if (!element) throw new Error('system absent: ' + system);
  const entry: Record<string, unknown> = { system,
    material: element.attributes.material ?? null,
    ownAttributes: Object.fromEntries(Object.entries(element.attributes).filter(([key, value]) =>
      !PHASES.includes(key as GraphPhase) && value !== undefined && key !== 'name')) };
  for (const phase of PHASES) {
    const found = graph.phase(system, phase).map((candidate) => {
      const resolved = sourcePistolParticleParameters(candidate, native);
      return { name: candidate.attributes.functionName ?? candidate.name, unknownOverrides: resolved.unknownOverrides,
        values: Object.fromEntries(Object.entries(resolved.values).sort(([a], [b]) => a.localeCompare(b))) };
    });
    if (found.length) entry[phase] = found;
  }
  rows.push(entry);
  process.stdout.write('===== ' + system + '\n' + JSON.stringify(entry, null, 1) + '\n');
}
mkdirSync(resolve(root, 'output'), { recursive: true });
writeFileSync(resolve(root, 'output/source-muzzle-smoke-parameters.json'), JSON.stringify(rows, null, 2) + '\n');
// The parameters the smoke reader has to read, kept beside the other original reads so a
// change in the shipped graph shows up as a change in the tracked record.
writeFileSync(resolve(root, 'output/source-muzzle-smoke-parameters-last.json'), JSON.stringify(rows, null, 2) + '\n');
writeFileSync(resolve(root, 'research/source-muzzle-smoke-parameters.json'), JSON.stringify({
  format: 'source-muzzle-smoke-parameters-v1',
  graph: 'public/source/csgo-12426148/muzzle-particles/graph.json',
  nativeDefaults: 'public/source/csgo-12426148/muzzle-particles/native-defaults.json',
  note: 'Every phase of the rifle dispatcher\'s four smoke subsystems, with the native unpack '
    + 'defaults this build executes applied by the repository\'s own reader. Each system emits '
    + 'instantaneously, so the numbers here are its whole definition; the three on '
    + 'vistasmokev1_emods / vistasmokev4_nearcull also carry $dualsequence.',
  sequenceBlend: 'research/source-spritecard-sequence-blend.json',
  systems: rows,
}, null, 2) + '\n');
