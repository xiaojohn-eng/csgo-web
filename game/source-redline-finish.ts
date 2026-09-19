import * as T from "three";
import {sourcePaintMipChain} from "./source-paint-mips";
import {loadSourcePaintNormal} from "./source-paint-normal";
import { createSourceFinishMaterial } from "./source-materials";
import { createSourceRedlineCompositor, SOURCE_REDLINE_STYLE, sourcePaletteRegisters,
  type SourceKitWeaponInput } from "./source-redline-compositor";
import { SOURCE_AK_WEAPON_PHONG, sourceRedlineSkinParameters, type SourceWeaponPhong } from "./source-redline-seed";
import type { SourceAkFinish, SourceAkFinishResolver } from "./source-ak-finishes";
import { SOURCE_REDLINE_FINISH_SIZES, SOURCE_REDLINE_OUTPUT_BOUNDARY } from "./source-redline-render-contract";
import type { SourceFinishWeaponId, SourceWeaponFinish } from "./source-weapon-finish";

/** One weapon this port can give an original finish to: its own id, the original gun-body
 * material names its models carry, the name the composed material takes, and the weapon's
 * own original Phong values (the AK-47's material carries 2/35, the M4A1's 2/25).
 *
 * The names are what let one owner serve both the first-person model and the world models:
 * the M4A1's two models name their gun body differently and both are the same original
 * material. Nothing else about a weapon is assumed here; every value is read from the
 * original install by `scripts/extract-source-kit-inputs.py`. */
export interface SourceFinishWeaponSpec {
  id: SourceFinishWeaponId;
  /** The original gun-body material names to replace, exactly as the models name them. */
  replaces: readonly string[];
  /** The name the composed material takes, which is how a later audit recognises it. */
  materialName: string;
  phong: SourceWeaponPhong;
}
/** The AK-47's own spec: the values the verified Redline path has always used. */
export const SOURCE_AK_FINISH_WEAPON: SourceFinishWeaponSpec = Object.freeze({
  id: "vandal",
  replaces: ["Source_AK47_VertexLitGeneric"],
  materialName: "Source_AK47_VertexLitGeneric",
  phong: SOURCE_AK_WEAPON_PHONG,
});

type Parameters = ReturnType<typeof sourceRedlineSkinParameters>;
/** One style's programs and its own bound copy of the weapon's textures. */
type SourceRedlineCompositor = Awaited<ReturnType<typeof createSourceRedlineCompositor>>;
type Resource = {
  color: T.DataTexture;
  exponent: T.DataTexture;
  normal?: T.DataTexture;
  adapted: ReturnType<typeof createSourceFinishMaterial>;
};
type Entry = {
  key: string;
  users: number;
  settled: boolean;
  resource?: Resource;
  promise: Promise<Resource | undefined>;
};
type Lease = { entry: Entry; released: boolean };
type Binding = {
  mesh: T.Mesh;
  original: T.Material | T.Material[];
  assigned?: T.Material | T.Material[];
};
type RootState = {
  version: number;
  bindings: Binding[];
  active?: Lease;
  pending?: Lease;
};
export interface SourceRedlineFinishOwner {
  /** Only the exact original gun-body material names that weapon's models carry are
   * eligible; those are the weapon spec's, not a constant. Roots must not overlap. A
   * stale request resolves without changing the current finish. */
  apply(root: T.Object3D, finish: SourceWeaponFinish | null): Promise<void>;
  /** Restore borrowed defaults before the caller disposes its view/world model. */
  releaseRoot(root: T.Object3D): void;
  /** Idempotent; restores all roots and releases only resources owned here. */
  dispose(): void;
}

function texture(rgba: Uint8Array, size: number, color: boolean) {
  // Original base alpha controls Phong. Canvas/PNG premultiplication destroys
  // this independent channel; keep the compositor readPixels bytes directly.
  const result = new T.DataTexture(rgba, size, size, T.RGBAFormat, T.UnsignedByteType);
  result.colorSpace = color ? T.SRGBColorSpace : T.NoColorSpace;
  result.flipY = false;
  result.premultiplyAlpha = false;
  // Match the existing original AK runtime sampler contract. This is separate
  // from the compositor's input VTF flags and is not a D3D filtering parity claim.
  result.wrapS = result.wrapT = T.RepeatWrapping;
  result.anisotropy = 8;
  result.magFilter = T.LinearFilter;
  result.minFilter = T.LinearMipmapLinearFilter;
  result.mipmaps = sourcePaintMipChain(rgba,size);
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}

/** One private compositor, serialized generation, and reference-counted shared
 * FP/world materials. Settled entries with no root/request users are disposed;
 * there is no growing cache of past seed/wear selections. Compositing and this
 * bounded Source Phong adapter remain distinct from full original-client QA. */
export async function createSourceRedlineFinishOwner(options: {
  inputBaseURL: string;
  /** Where the finishes' own pattern textures are served from, for the compositor to
   * bind per finish. */
  patternBaseURL: string;
  /** Which finishes exist and what each one is composed from. Resolving is separated
   * from ownership so this owner can be exercised without any original asset at all. */
  resolve: SourceAkFinishResolver;
  /** Which weapon this owner dresses, and the values that are the weapon's rather than a
   * finish's. One owner serves one weapon, because a weapon's sampled textures are fixed
   * when its compositor is built. */
  weapon: SourceFinishWeaponSpec;
  /** The weapon's own sampled textures, for a weapon whose inputs are staged per weapon.
   * Omitted, the compositor reads the verified Redline receipt instead. */
  weaponInputs?: readonly SourceKitWeaponInput[];
  /** The style built up front. A weapon's original finishes span several styles, and one style is
   * one pair of programs - so this is the compositor created eagerly (the verified Redline style
   * by default), and a finish of another style gets its own, built on first use and released with
   * this owner. */
  style?: number;
  signal?: AbortSignal;
}): Promise<SourceRedlineFinishOwner> {
  const defaultStyle = options.style ?? SOURCE_REDLINE_STYLE;
  /** One compositor per style and albedo-factor branch. Two finishes share it only
   * when both select the same original pair of programs. */
  const compositors = new Map<string, Promise<SourceRedlineCompositor>>();
  /** The compositors that finished building. Kept separately so disposal can release them
   * synchronously and exactly once, rather than through a promise that may or may not have
   * settled by the time a caller asks. */
  const built = new Set<SourceRedlineCompositor>();
  let disposed = false;
  const compositorFor = (style: number, phongAlbedoFactor = 1) => {
    const key = `${style}:${phongAlbedoFactor < 1}`;
    let pending = compositors.get(key);
    if (!pending) {
      // Jobs are serialized and composed maps own their bytes. An old branch's
      // input textures/programs can be released before the next branch is built;
      // retaining nine full weapon input sets would grow GPU memory on skin switches.
      for(const previous of built)previous.dispose();
      built.clear();compositors.clear();
      pending = createSourceRedlineCompositor({ ...options, style, phongAlbedoFactor }).then((created) => {
        built.add(created);
        // Disposal during the build is what releases it; the caller must not use it.
        if (disposed) {
          created.dispose();
          throw Error("Source Redline finish owner disposed");
        }
        return created;
      }, (error: unknown) => {
        // A style whose compositor failed to build is retried rather than cached as failed, or one
        // transient failure would retire that style for the session.
        compositors.delete(key);
        throw error;
      });
      compositors.set(key, pending);
    }
    return pending;
  };
  // The style the owner was asked for is built up front, so a build that cannot succeed is
  // reported where the owner is created rather than at the first selection. Every other style is
  // built on first use, because a weapon's finishes span several styles and building all of them
  // would upload the weapon's textures once per style for styles no one selects.
  await compositorFor(defaultStyle);
  const weapon = options.weapon;
  const resolveFinish = options.resolve.resolve;
  const roots = new Map<T.Object3D, RootState>();
  const meshOwners = new WeakMap<T.Mesh, RootState>();
  const entries = new Map<string, Entry>();
  let tail: Promise<unknown> = Promise.resolve();

  const evict = (entry: Entry) => {
    if (entry.users || !entry.settled) return;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (entry.resource) {
      entry.resource.adapted.dispose();
      entry.resource.color.dispose();
      entry.resource.exponent.dispose();
      entry.resource.normal?.dispose();
      entry.resource = undefined;
    }
  };
  const release = (lease?: Lease) => {
    if (!lease || lease.released) return;
    lease.released = true;
    lease.entry.users--;
    evict(lease.entry);
  };
  const acquire = (key: string, parameters: Parameters, resolved: SourceAkFinish, style: number): Lease => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, users: 0, settled: false, promise: Promise.resolve(undefined) };
      entries.set(key, entry);
      const created = entry;
      created.promise = tail.then(async () => {
        if (disposed || !created.users) return undefined;
        // The finish's own style gets its own programs and its own bound textures. A finish of
        // the style the owner built up front reuses that compositor, so the verified composition
        // binds exactly what it always did; another style's is built here, on first use.
        const compositor = await compositorFor(style, parameters.phongAlbedoFactor);
        if (disposed || !created.users) return undefined;
        // Whether this finish's colours are what its style's colour program reads, or whether the
        // style declares no palette constant at all (the verified one does not).
        const styleTakesPalette = sourcePaletteRegisters(style, parameters.phongAlbedoFactor).length > 0;
        // The finish's own palette and artwork are bound before composing, and all of it runs
        // inside this job, so neither binding can be swapped out from under a composition. A style
        // whose program samples no pattern, or declares no palette constant, binds neither.
        if (styleTakesPalette) compositor.setPalette(resolved.kit.colours);
        if (resolved.pattern) await compositor.setPattern(resolved.pattern);
        if (disposed || !created.users) return undefined;
        const output = await compositor.compose(parameters, SOURCE_REDLINE_FINISH_SIZES.color, SOURCE_REDLINE_FINISH_SIZES.exponent);
        if (disposed || !created.users) return undefined;
        const color = texture(output.color.rgba, output.color.size, true);
        const exponent = texture(output.exponent.rgba, output.exponent.size, false);
        let normal:T.DataTexture|undefined;
        try {
          if(resolved.normal)normal=await loadSourcePaintNormal(resolved.normal,options.patternBaseURL,options.signal);
          if(disposed||!created.users){color.dispose();exponent.dispose();normal?.dispose();return undefined;}
          // The compositor reports the pattern it actually bound. This job bound this
          // finish's own, so the two agreeing is the check that nothing swapped the
          // single pattern slot underneath the composition.
          const pattern = resolved.pattern;
          const bound = (output as { pattern?: { paintKitId: number; sha256: string } }).pattern;
          if (pattern && bound && (bound.paintKitId !== pattern.paintKitId || bound.sha256 !== pattern.sha256))
            throw Error("Original Redline composition used a different pattern than it was given");
          const adapted = createSourceFinishMaterial(
            { name: weapon.materialName, ...parameters.materialPhong, envmap:weapon.phong.envmap }, color, exponent, normal);
          adapted.material.userData.sourceFinish = {
            weapon: weapon.id, paintKitId: parameters.sourceInput.paintKitId, seed: parameters.sourceInput.seed,
            wear: parameters.wear,
          } as SourceWeaponFinish;
          adapted.material.userData.sourceFinishEvidence = {
            status: style === SOURCE_REDLINE_STYLE ? "original_style7_shader_candidate"
              : "original_customweapon_shader_candidate",
            parameterEvidence: parameters.parameterEvidence,
            colorSHA256: output.color.sha256,
            exponentSHA256: output.exponent.sha256,
            size: output.size,
            sizes: { color: output.color.size, exponent: output.exponent.size },
            outputBoundary: SOURCE_REDLINE_OUTPUT_BOUNDARY,
            shaderSelection: compositor.audit?.shaderSelection,
            // Which original material the pattern came from, so a composed finish can be
            // traced to its own artwork rather than to the verified finish's. A style
            // whose program samples no pattern has none, and says so rather than naming
            // another finish's.
            patternSourceMaterial: pattern ? pattern.sourceMaterial : null,
            patternSha256: pattern ? pattern.sha256 : null,
            normalSourceMaterial:resolved.normal?.sourceMaterial??null,
            normalSha256:resolved.normal?.sha256??null,
            normalDecodedVerified:!!normal,
            originalClientOutputCompared: false,
            mipCounts:{color:color.mipmaps.length,exponent:exponent.mipmaps.length},
            outputSampling: "Original RGBA8888 gamma-2.2 mip algorithm, linear mip interpolation, repeat, anisotropy 8",
          };
          return (created.resource = { color, exponent, normal, adapted });
        } catch (error) {
          color.dispose(); exponent.dispose(); normal?.dispose(); throw error;
        }
      }).finally(() => { created.settled = true; evict(created); });
      // One failing composition must not poison subsequent requests.
      tail = created.promise.then(() => undefined, () => undefined);
    }
    entry.users++;
    return { entry, released: false };
  };
  const releaseRoot = (root: T.Object3D) => {
    const state = roots.get(root);
    if (!state) return;
    roots.delete(root);
    state.version++;
    release(state.pending);
    for (const binding of state.bindings) {
      // Respect a separate caller's replacement made after our assignment.
      if (binding.assigned && binding.mesh.material === binding.assigned)
        binding.mesh.material = binding.original;
      meshOwners.delete(binding.mesh);
    }
    release(state.active);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener("abort", dispose);
    for (const root of roots.keys()) releaseRoot(root);
    // Every style's compositor goes with the owner, whether or not it has been used yet. A
    // compositor still being built at this moment releases itself when it settles.
    for (const created of built) created.dispose();
    built.clear();
    compositors.clear();
    // Pending jobs retain their own entries until they settle; none may create
    // textures or modify a root after this point.
    entries.clear();
  };
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) {
    dispose();
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  return {
    releaseRoot,
    dispose,
    async apply(root, finish) {
      if (disposed) throw Error("Source Redline finish owner disposed");
      // Validate/copy before cancelling a currently valid request.
      if (finish && finish.weapon !== weapon.id)
        throw Error(`This owner dresses ${weapon.id}, not ${finish.weapon}`);
      if (!finish) { releaseRoot(root); return; }
      // Resolve before cancelling a currently valid request, so an unsupported finish
      // leaves whatever is already applied alone.
      const resolved = await resolveFinish(finish.paintKitId);
      if (disposed) throw Error("Source Redline finish owner disposed");
      const parameters = sourceRedlineSkinParameters(
        { paintKitId: finish.paintKitId, seed: finish.seed, wear: finish.wear }, resolved.kit,
        weapon.phong);
      const key = `${finish.paintKitId}:${parameters.sourceInput.seed}:${parameters.wear}`;
      let state = roots.get(root);
      if (!state) {
        const bindings: Binding[] = [];
        root.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          if (materials.some((material) => weapon.replaces.includes(material.name))) {
            if (meshOwners.has(object)) throw Error("Redline roots must not overlap");
            bindings.push({ mesh: object, original: object.material });
          }
        });
        if (!bindings.length) return;
        state = { version: 0, bindings };
        roots.set(root, state);
        for (const binding of bindings) meshOwners.set(binding.mesh, state);
      }
      const request = ++state.version;
      release(state.pending);
      state.pending = undefined;
      if (state.active?.entry.key === key) return;
      const lease = acquire(key, parameters, resolved, resolved.kit.style);
      state.pending = lease;
      const current = () => !disposed && roots.get(root) === state &&
        state.version === request && state.pending === lease;
      try {
        const resource = await lease.entry.promise;
        if (!current() || !resource) return;
        for (const binding of state.bindings) {
          if (binding.mesh.material !== (binding.assigned ?? binding.original)) continue;
          const replace = (m: T.Material) =>
            weapon.replaces.includes(m.name) ? resource.adapted.material : m;
          binding.assigned = Array.isArray(binding.original)
            ? binding.original.map(replace) : replace(binding.original);
          binding.mesh.material = binding.assigned;
        }
        const previous = state.active;
        state.active = lease;
        state.pending = undefined;
        release(previous);
      } catch (error) {
        if (current()) throw error;
      } finally {
        if (state.active !== lease) release(lease);
        if (state.pending === lease) state.pending = undefined;
      }
    },
  };
}
