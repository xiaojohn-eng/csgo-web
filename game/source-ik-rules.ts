/** The original player IK chains and per-animation IK rules.
 *
 * The CS:GO player animation model declares four IK chains (`rhand`, `lhand`,
 * `rfoot`, `lfoot`) and every animation that needs one carries IK rules: the
 * cycle window in which a chain is planted on the ground (`GROUND`), released
 * from whatever holds it (`RELEASE`), or moved by its own baked error pose
 * (`SELF`). The rules live in the `.ani` animblock, not in the animation frames
 * this project had already exported, so until now nothing in the renderer could
 * see them.
 *
 * `scripts/export-source-ik-rules.py` decodes them with the pinned SourceIO
 * parser (Blender) and `scripts/stage-source-ik-rules.py` stages the rule set the
 * shipped pose datasets actually sample, cross-checking every descriptor's rule
 * count against `pose-data.json`. This module parses and queries that file.
 */
export type SourceIKRuleType = 'SELF' | 'WORLD' | 'GROUND' | 'RELEASE' | 'ATTACHMENT' | 'UNLATCH';
export type SourceIKWindow = { start: number; peak: number; tail: number; end: number };
export type SourceIKRule = { index: number; type: SourceIKRuleType; chain: number; slot: number; bone: number;
  window: SourceIKWindow; pos: number[]; q: number[]; compressedIkError: number;
  height: number; radius: number; floor: number; contact: number; drop: number; top: number;
  /** Original name of the world attachment a rule locks onto, when it has one.
   * No player or world weapon animation in this build carries one. */
  attachment?: string };
export type SourceIKChain = { index: number; name: string; linkType: number;
  links: { bone: number; name: string; kneeDir: number[] }[] };
export type SourceIKTeam = { animationModel: string; bones: number; chains: SourceIKChain[];
  rules: ReadonlyMap<string, readonly SourceIKRule[]> };
export type SourceIKRules = { format: 'source-ik-rules-v1'; build: number; recordBytes: number;
  teams: Record<'t' | 'ct', SourceIKTeam> };

const TYPES: readonly SourceIKRuleType[] = ['SELF', 'WORLD', 'GROUND', 'RELEASE', 'ATTACHMENT', 'UNLATCH'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function window(raw: unknown, where: string): SourceIKWindow {
  check(raw && typeof raw === 'object', `${where}: IK rule without a window`);
  const w = raw as Record<string, unknown>;
  for (const key of ['start', 'peak', 'tail', 'end'] as const) check(finite(w[key]), `${where}: nonfinite IK window ${key}`);
  const out = { start: w.start as number, peak: w.peak as number, tail: w.tail as number, end: w.end as number };
  check(out.start <= out.peak && out.peak <= out.tail && out.tail <= out.end, `${where}: IK window is not monotonic`);
  check(out.end > out.start, `${where}: IK window is empty`);
  return out;
}

function rule(raw: unknown, where: string, index: number, chainCount: number, boneCount: number): SourceIKRule {
  check(raw && typeof raw === 'object', `${where}: malformed IK rule`);
  const r = raw as Record<string, unknown>;
  check(typeof r.type === 'string' && (TYPES as readonly string[]).includes(r.type), `${where}: unknown IK rule type ${String(r.type)}`);
  check(Number.isInteger(r.chain) && (r.chain as number) >= 0 && (r.chain as number) < chainCount, `${where}: IK rule chain outside the chain table`);
  check(Number.isInteger(r.bone) && (r.bone as number) >= 0 && (r.bone as number) < boneCount, `${where}: IK rule bone outside the bone table`);
  check(Number.isInteger(r.index), `${where}: IK rule without its own index`);
  check(r.index === 0 || r.index === index, `${where}: IK rule index ${String(r.index)} is not its position ${index}`);
  for (const key of ['slot', 'compressedIkError', 'height', 'radius', 'floor', 'contact', 'drop', 'top'])
    check(finite(r[key]), `${where}: nonfinite IK rule ${key}`);
  for (const key of ['pos', 'q'])
    check(Array.isArray(r[key]) && (r[key] as unknown[]).every(finite), `${where}: nonfinite IK rule ${key}`);
  if (r.attachment !== undefined) check(typeof r.attachment === 'string' && r.attachment.length > 0, `${where}: empty IK attachment`);
  return { index: r.index as number, type: r.type as SourceIKRuleType, chain: r.chain as number, slot: r.slot as number,
    bone: r.bone as number, window: window(r.window, where), pos: r.pos as number[], q: r.q as number[],
    compressedIkError: r.compressedIkError as number, height: r.height as number, radius: r.radius as number,
    floor: r.floor as number, contact: r.contact as number, drop: r.drop as number, top: r.top as number,
    ...(r.attachment === undefined ? {} : { attachment: r.attachment as string }) };
}

function chain(raw: unknown, where: string, index: number, boneCount: number): SourceIKChain {
  check(raw && typeof raw === 'object', `${where}: malformed IK chain`);
  const c = raw as Record<string, unknown>;
  check(c.index === index && typeof c.name === 'string' && (c.name as string).length > 0, `${where}: IK chain without its own name`);
  check(Number.isInteger(c.linkType), `${where}: IK chain without a link type`);
  const links = c.links;
  check(Array.isArray(links) && links.length > 0, `${where}: IK chain ${c.name as string} has no links`);
  for (const raw of links as unknown[]) {
    check(raw && typeof raw === 'object', `${where}: malformed IK link`);
    const link = raw as Record<string, unknown>;
    check(Number.isInteger(link.bone) && (link.bone as number) >= 0 && (link.bone as number) < boneCount, `${where}: IK link bone outside the bone table`);
    check(typeof link.name === 'string' && (link.name as string).length > 0, `${where}: IK link without its original bone name`);
    check(Array.isArray(link.kneeDir) && (link.kneeDir as unknown[]).length === 3 && (link.kneeDir as unknown[]).every(finite),
      `${where}: IK link without an original knee direction`);
  }
  return { index: c.index as number, name: c.name as string, linkType: c.linkType as number,
    links: (links as { bone: number; name: string; kneeDir: number[] }[]) };
}

function team(raw: unknown, where: string): SourceIKTeam {
  check(raw && typeof raw === 'object', `${where}: missing original IK team`);
  const t = raw as Record<string, unknown>;
  check(typeof t.animationModel === 'string', `${where}: IK team without its original animation model`);
  check(Number.isInteger(t.bones) && (t.bones as number) > 0, `${where}: IK team without a bone count`);
  const boneCount = t.bones as number;
  check(Array.isArray(t.ikChains) && (t.ikChains as unknown[]).length > 0, `${where}: IK team without chains`);
  const chains = (t.ikChains as unknown[]).map((c, i) => chain(c, where, i, boneCount));
  check(new Set(chains.map(c => c.name)).size === chains.length, `${where}: duplicate IK chain names`);
  check(t.rules && typeof t.rules === 'object', `${where}: IK team without rules`);
  const rules = new Map<string, readonly SourceIKRule[]>();
  for (const [name, list] of Object.entries(t.rules as Record<string, unknown>)) {
    check(name.length > 0 && Array.isArray(list) && (list as unknown[]).length > 0, `${where}: ${name} carries no IK rules`);
    rules.set(name, (list as unknown[]).map((r, i) => rule(r, `${where}/${name}`, i, chains.length, boneCount)));
  }
  return { animationModel: t.animationModel, bones: boneCount, chains, rules };
}

/** Parses and validates the staged original IK rule set. */
export function parseSourceIKRules(raw: unknown): SourceIKRules {
  check(raw && typeof raw === 'object', 'Malformed original IK rule data');
  const data = raw as Record<string, unknown>;
  check(data.format === 'source-ik-rules-v1', 'Unexpected original IK rule format');
  check(data.build === 12426148, 'Unexpected original IK rule build');
  check(data.recordBytes === 152, 'Unexpected original IK rule record size');
  check(data.teams && typeof data.teams === 'object', 'Original IK rule data without teams');
  const teams = data.teams as Record<string, unknown>;
  check(teams.t !== undefined && teams.ct !== undefined, 'Original IK rule data without both teams');
  return { format: 'source-ik-rules-v1', build: data.build as number, recordBytes: data.recordBytes as number,
    teams: { t: team(teams.t, 't'), ct: team(teams.ct, 'ct') } };
}

/** Loads the staged original IK rule set that ships beside the character frames.
 * Both teams' rules live in one file, so every original character owner shares
 * one fetch. */
export async function loadSourceIKRules(options: { baseUrl?: string; signal?: AbortSignal } = {}): Promise<SourceIKRules> {
  const url = new URL(options.baseUrl ?? '/source/csgo-12426148/ik/ik-rules.json', globalThis.location?.href ?? 'http://127.0.0.1/');
  const response = await fetch(url.href, { signal: options.signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`Source IK rule data HTTP ${response.status}`);
  const rules = parseSourceIKRules(await response.json());
  if (rules.build !== 12426148 || rules.teams.t.animationModel !== 'models/player/t_animations.mdl' ||
    rules.teams.ct.animationModel !== 'models/player/ct_animations.mdl')
    throw new Error('Original IK rule data disagrees with this build');
  return rules;
}

/** The rules the original animation `descriptorName` carries for one team, or an
 * empty list when that animation needs none. */
export function sourceIKRulesForDescriptor(data: SourceIKRules, team: 't' | 'ct', descriptorName: string): readonly SourceIKRule[] {
  return data.teams[team].rules.get(descriptorName) ?? [];
}

/** The original left/right foot ground rules of one animation. */
export function sourceGroundIKRules(data: SourceIKRules, team: 't' | 'ct', descriptorName: string): readonly SourceIKRule[] {
  return sourceIKRulesForDescriptor(data, team, descriptorName).filter(rule => rule.type === 'GROUND');
}

/** The original rule envelope: zero before `start`, full between `peak` and
 * `tail`, zero after `end`, ramping in between. The cycle is measured as an
 * offset from the window start modulo one animation cycle, so a window that
 * reaches past 1 (the original run rules do: a contact at 0.9 fades out at 1.05)
 * still wraps onto the next loop instead of being clamped. */
export function sourceIKWindowWeight(window: SourceIKWindow, cycle: number): number {
  if (!Number.isFinite(cycle)) return 0;
  const span = window.end - window.start;
  if (!(span > 0)) return 0;
  const at = ((cycle - window.start) % 1 + 1) % 1;
  if (at > span) return 0;
  const rise = window.peak - window.start, fall = window.end - window.tail;
  if (at < rise) return rise > 0 ? at / rise : 1;
  if (at <= window.tail - window.start) return 1;
  if (fall <= 0) return 0;
  const out = 1 - (at - (window.tail - window.start)) / fall;
  return out > 0 ? out : 0;
}
