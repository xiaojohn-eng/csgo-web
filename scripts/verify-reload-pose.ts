// Replay the authoritative poses a LAN client recorded through the renderer's
// own sampler and report how far the merged original reload moves the pose the
// character actor consumes.
//
// The reloading client cannot sample its own rendered bone: the local player's
// world-model actor is deliberately hidden in first person, and the pointer-lock
// design lets only one client render at a time, so a second client cannot watch
// it either. Sampling the recorded authoritative pose with
// `sampleSourceCharacterPose` is exactly the input the actor writes into its
// bones, so the numbers below are the rendered pose by construction.
//
// Usage: node --import tsx scripts/verify-reload-pose.ts <evidence.json>
// Prints one JSON object on the last line: { issues, measured }.
import { readFileSync } from 'node:fs';
import { prepareSourceCharacterPose, sampleSourceCharacterPose,
  type SourceCharacterPoseData, type SourceCharacterPoseIndex, type SourceCharacterPoseInput } from '../game/source-character-pose.js';

const folder = '.reference-assets/source-exports/character-t/continuous';
// One Source unit is the same length the actor root scales by.
const METRES_PER_UNIT = 0.01905;
// The original AK reload works the magazine with the left hand while the right
// hand keeps the grip, so both hands are measured and the larger travel is the
// one that has to prove the action.
const BONES = ['ValveBiped.Bip01_L_Hand', 'ValveBiped.Bip01_R_Hand'];

type PlayerRow = { name: string; reloadCycle: number | null; reloadWeight: number | null; pose: SourceCharacterPoseInput | null };
type Slide = { t: number; players: PlayerRow[] };
type Row = { t: number; p: PlayerRow | undefined };
type Measurement = { bone: string; samples: number; aimToMid: number; midToEnd: number; residual: number; midCycle: number;
  hands: { bone: string; out: number; back: number; residual: number }[];
  magazine: { window: { hide: number; show: number } | null; hiddenSamples: number; visibleSamples: number;
    firstCycle: number; firstVisible: boolean; lastCycle: number; lastVisible: boolean } };

function measure(evidence: Record<string, unknown>): { issues: string[]; measured: Measurement | null } {
  const issues: string[] = [];
  const who = String(evidence.hostLabel ?? 'Reload Host');
  const samples = (evidence.samples ?? []) as Slide[];
  if (!samples.length) return { issues: ['the evidence carries no recorded samples'], measured: null };
  const rows = samples.map((s) => ({ t: s.t, p: s.players?.find((q) => q.name === who) })).filter((r) => r.p?.pose);
  const armed = rows.filter((r) => r.p!.reloadCycle !== null || r.p!.reloadWeight !== null);
  if (armed.length < 6) return { issues: [`only ${armed.length} recorded poses carry the reload layer`], measured: null };
  const first = armed[0], last = armed[armed.length - 1];
  const aim = [...rows].reverse().find((r) => r.t < first.t)!;
  const settled = rows.find((r) => r.t > last.t + 0.2);
  if (!aim || !settled) return { issues: ['the recording does not bracket the reload with aim poses'], measured: null };
  const mid = armed.reduce((best, r) =>
    Math.abs((r.p!.reloadCycle ?? 0) - 0.5) < Math.abs((best.p!.reloadCycle ?? 0) - 0.5) ? r : best, armed[0]);

  const index: SourceCharacterPoseIndex = prepareSourceCharacterPose(
    JSON.parse(readFileSync(`${folder}/pose-data.json`, 'utf8')) as SourceCharacterPoseData,
    readFileSync(`${folder}/frames.f64.bin`));
  const bones = BONES.map((name) => ({ name, index: index.data.mainBones.findIndex((b) => b.name === name) }))
    .filter((b) => b.index >= 0);
  if (!bones.length) return { issues: [`the audited dataset carries none of ${BONES.join(', ')}`], measured: null };
  const at = (row: Row, bone: number) => {
    const pose = sampleSourceCharacterPose(index, row.p!.pose!);
    // Source bones keep fixed local translations (the pose drives rotations), so
    // the rendered displacement is the bone's world translation.
    return [pose.sourceWorldMatrices[bone * 16 + 12], pose.sourceWorldMatrices[bone * 16 + 13], pose.sourceWorldMatrices[bone * 16 + 14]];
  };
  const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * METRES_PER_UNIT;
  const travelled = bones.map((entry) => {
    const from = at(aim, entry.index), through = at(mid, entry.index), back = at(settled, entry.index);
    return { bone: entry.name.replace('ValveBiped.Bip01_', ''),
      out: distance(from, through), back: distance(through, back), residual: distance(from, back) };
  }).sort((a, b) => b.out - a.out);
  const lead = travelled[0];
  // The original magazine display window: the world weapon's magazine must be
  // out of the gun between the dataset's own eject and unhide events and seated
  // either side of them.
  const magazineWindow = index.reload?.magazine ?? null;
  const trace = armed.map((row) => ({ cycle: row.p!.reloadCycle ?? 0,
    visible: sampleSourceCharacterPose(index, row.p!.pose!).magazineVisible }));
  const hiddenSamples = trace.filter((r) => !r.visible).length;
  const head = trace[0], tail = trace[trace.length - 1];
  const magazine: Measurement['magazine'] = { window: magazineWindow, hiddenSamples,
    visibleSamples: trace.length - hiddenSamples, firstCycle: +head.cycle.toFixed(3), firstVisible: head.visible,
    lastCycle: +tail.cycle.toFixed(3), lastVisible: tail.visible };
  if (magazineWindow) {
    if (!hiddenSamples) issues.push('the magazine never left the weapon during the reload');
    if (!head.visible) issues.push('the magazine was out of the weapon before the reload started');
    if (!tail.visible) issues.push('the fresh magazine was never seated before the reload ended');
  }
  const measured: Measurement = {
    bone: lead.bone,
    samples: armed.length,
    aimToMid: +lead.out.toFixed(4),
    midToEnd: +lead.back.toFixed(4),
    residual: +lead.residual.toFixed(4),
    midCycle: +(mid.p!.reloadCycle ?? 0).toFixed(3),
    hands: travelled.map((t) => ({ ...t, out: +t.out.toFixed(4), back: +t.back.toFixed(4), residual: +t.residual.toFixed(4) })),
    magazine,
  };
  if (!(measured.aimToMid > 0.05)) issues.push(`the renderer pose moved only ${measured.aimToMid}m mid-reload`);
  if (!(measured.midToEnd > 0.05)) issues.push(`the renderer pose did not swing back (${measured.midToEnd}m)`);
  if (!(measured.residual < 0.02)) issues.push(`the renderer pose did not return to the aim (${measured.residual}m)`);
  return { issues, measured };
}

const evidencePath = process.argv[2];
if (!evidencePath) {
  console.error('usage: node --import tsx scripts/verify-reload-pose.ts <evidence.json>');
  process.exit(2);
}
const result = measure(JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>);
if (result.issues.length) console.error(result.issues.map((i) => `  - ${i}`).join('\n'));
console.log(JSON.stringify(result));
process.exitCode = result.issues.length ? 1 : 0;
