import * as T from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSourceRedlineFinishOwner, SOURCE_AK_FINISH_WEAPON, type SourceRedlineFinishOwner } from "../game/source-redline-finish";
import type { SourceWeaponFinish } from "../game/source-weapon-finish";

const mocked = vi.hoisted(() => ({ normal:vi.fn(), create: vi.fn(), compose: vi.fn(), setPattern: vi.fn(), dispose: vi.fn() }));
// Only the factory is replaced: the style the owner builds up front and the palette registers it
// asks about are the module's real ones, so this exercises ownership rather than a restated rule.
vi.mock("../game/source-redline-compositor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/source-redline-compositor")>()),
  createSourceRedlineCompositor: mocked.create,
}));
vi.mock("../game/source-paint-normal",()=>({loadSourcePaintNormal:mocked.normal}));
const finish = (seed = 422, wear = .4): SourceWeaponFinish => ({ weapon: "vandal", paintKitId: 282, seed, wear });
const output = () => ({ size: 1,
  color: { size: 1, rgba: new Uint8Array([240, 120, 20, 1]), sha256: "color-bytes" },
  exponent: { size: 1, rgba: new Uint8Array([2, 30, 60, 0]), sha256: "exponent-bytes" },
  pattern: { paintKitId: 282, sourceMaterial: "materials/models/weapons/customization/paints/custom/workshop/elegantredv1.1.vtf", sha256: "pattern-sha" },
});
/** The verified finish's own description, so these tests exercise ownership rather than
 * the catalogue and the pattern manifest, which have tests of their own. */
const resolved = { kit: { paintKitId: 282, style: 7,
    colours: [[128,128,128],[128,128,128],[128,128,128],[128,128,128]] as readonly (readonly number[])[],
    phongExponent: 150, phongIntensity: 10, phongAlbedoBoost: -1,
    patternScale: 1, patternOffsetX: [0, 0] as const, patternOffsetY: [0, 0] as const,
    patternRotate: [0, 0] as const, wearMinimum: .1, wearMaximum: .7 },
  pattern: { paintKitId: 282, sourceMaterial: output().pattern.sourceMaterial,
    path: "png/pattern.png", bytes: 1, sha256: "pattern-sha", rgba8Sha256: "decoded-sha",
    width: 1, height: 1, vtfFlags: 0 } };
const resolver = { resolve: vi.fn(async (paintKitId: number) => {
    if (paintKitId !== 282) throw Error(`Finish ${paintKitId} is not an original weapon_ak47 finish`);
    return resolved;
  }), available: vi.fn(async () => [282]) };
function deferred() {
  let resolve!: (value: ReturnType<typeof output>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ReturnType<typeof output>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function model(array = false) {
  const root = new T.Group(), original = new T.MeshPhongMaterial(), arms = new T.MeshPhongMaterial();
  original.name = "Source_AK47_VertexLitGeneric";
  arms.name = "Source_Arms_VertexLitGeneric";
  const mesh: T.Mesh = new T.Mesh(new T.BufferGeometry(), array ? [arms, original, arms] : original);
  const other = new T.Mesh(new T.BufferGeometry(), arms);
  root.add(mesh, other);
  return { root, mesh, original, arms, other, originalContainer: mesh.material };
}
const owners: SourceRedlineFinishOwner[] = [];
async function owner(signal?: AbortSignal) {
  const instance = await createSourceRedlineFinishOwner({ inputBaseURL: "/original/", patternBaseURL: "/patterns/", resolve: resolver, weapon: SOURCE_AK_FINISH_WEAPON, signal });
  owners.push(instance); return instance;
}
async function tick() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.resetAllMocks();
  mocked.compose.mockImplementation(async () => output());
  mocked.setPattern.mockResolvedValue(undefined);
  mocked.create.mockResolvedValue({ compose: mocked.compose, setPattern: mocked.setPattern,
    boundPattern: () => ({ paintKitId: 282, sourceMaterial: null, sha256: "pattern-sha" }),
    dispose: mocked.dispose });
});
afterEach(() => { for (const instance of owners.splice(0)) instance.dispose(); vi.restoreAllMocks(); });

describe("original Redline finish ownership", () => {
  it("shares and disposes the finish normal with its FP/world lease, restoring defaults exactly",async()=>{
    const normal=new T.DataTexture(new Uint8Array([128,128,255,0]),1,1),dispose=vi.spyOn(normal,'dispose');
    mocked.normal.mockResolvedValue(normal);
    resolver.resolve.mockResolvedValue({...resolved,normal:{...resolved.pattern,sourceMaterial:'original_normal.vtf'}} as typeof resolved);
    const dress=await owner(),fp=model(true),world=model();
    await dress.apply(fp.root,finish());await dress.apply(world.root,finish());
    expect(mocked.normal).toHaveBeenCalledTimes(1);
    expect((world.mesh.material as T.MeshPhongMaterial).normalMap).toBe(normal);
    expect((world.mesh.material as T.MeshPhongMaterial).userData.sourceFinishEvidence.normalDecodedVerified).toBe(true);
    await dress.apply(fp.root,null);expect(fp.mesh.material).toBe(fp.originalContainer);expect(dispose).not.toHaveBeenCalled();
    await dress.apply(world.root,null);expect(world.mesh.material).toBe(world.original);expect(dispose).toHaveBeenCalledTimes(1);
    dress.dispose();expect(dispose).toHaveBeenCalledTimes(1);
  });
  it("releases a normal whose fetch completes after the requesting root returns to its default",async()=>{
    let deliver!:(texture:T.DataTexture)=>void;
    mocked.normal.mockImplementation(()=>new Promise<T.DataTexture>(resolve=>{deliver=resolve;}));
    resolver.resolve.mockResolvedValue({...resolved,normal:resolved.pattern} as typeof resolved);
    const dress=await owner(),fp=model(),pending=dress.apply(fp.root,finish());
    await vi.waitFor(()=>expect(mocked.normal).toHaveBeenCalledOnce());
    await dress.apply(fp.root,null);
    const normal=new T.DataTexture(),dispose=vi.spyOn(normal,'dispose');deliver(normal);await pending;
    expect(fp.mesh.material).toBe(fp.original);expect(dispose).toHaveBeenCalledOnce();
  });

  it("selects both style-5 factor branches and applies the cloned AWP boost to FP and world materials", async () => {
    mocked.compose.mockImplementation(async () => {
      const value = output();
      return { size: value.size, color: value.color, exponent: value.exponent };
    });
    mocked.create.mockImplementation(async (options: { style: number; phongAlbedoFactor: number }) => ({
      compose: mocked.compose, setPattern: mocked.setPattern, setPalette: vi.fn(), dispose: mocked.dispose,
      audit: { shaderSelection: { style: options.style, lowAlbedo: options.phongAlbedoFactor < 1,
        colorStatic: options.style + (options.phongAlbedoFactor < 1 ? 160 : 0),
        exponentStatic: options.style + 10 + (options.phongAlbedoFactor < 1 ? 160 : 0) } },
    }));
    const instance = await createSourceRedlineFinishOwner({ inputBaseURL: '/awp/', patternBaseURL: '/patterns/',
      weapon: { ...SOURCE_AK_FINISH_WEAPON, id: 'awp', phong: {
        phongBoost: 2, phongAlbedoBoost: 40, phongFresnelRanges: [.8, .8, 1] } },
      resolve: { available: async () => [51, 395], resolve: async (id) => ({
        kit: { ...resolved.kit, paintKitId: id, style: 5, phongIntensity: 255,
          phongAlbedoBoost: id === 51 ? 40 : 60, wearMinimum: id === 51 ? 0 : .1,
          wearMaximum: id === 51 ? .08 : .2 },
        pattern: { ...resolved.pattern, paintKitId: id },
      }) },
    });
    owners.push(instance);
    const fp = model(), world = model();
    const lightning: SourceWeaponFinish = { weapon: 'awp', paintKitId: 51, seed: 422, wear: .05 };
    const war: SourceWeaponFinish = { weapon: 'awp', paintKitId: 395, seed: 422, wear: .15 };
    await instance.apply(fp.root, lightning);
    expect((fp.mesh.material as T.Material).userData.sourceParameters.albedoBoost).toBe(40);
    await Promise.all([instance.apply(fp.root, war), instance.apply(world.root, war)]);
    expect(fp.mesh.material).toBe(world.mesh.material);
    const skin = fp.mesh.material as T.MeshPhongMaterial;
    expect(skin.userData.sourceParameters.albedoBoost).toBe(60);
    expect(skin.userData.sourceParameters.albedoTint).toBe(true);
    expect(skin.userData.sourceFinishEvidence.shaderSelection).toEqual({ style: 5, lowAlbedo: true,
      colorStatic: 165, exponentStatic: 175 });
    const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <lights_phong_pars_fragment>\n#include <lights_phong_fragment>' };
    skin.onBeforeCompile(shader as never, undefined as never);
    expect((shader.uniforms as Record<string, { value: number }>).sourceAlbedoBoost.value).toBe(60);
    await instance.apply(fp.root, lightning);
    expect((fp.mesh.material as T.Material).userData.sourceParameters.albedoBoost).toBe(40);
    expect(mocked.create.mock.calls.map(call => [call[0].style, call[0].phongAlbedoFactor < 1]))
      .toEqual([[7, false], [5, false], [5, true], [5,false]]);
    expect(mocked.dispose).toHaveBeenCalledTimes(3);
    expect(mocked.compose.mock.calls.map(call => call[0].phongIntensity)).toEqual([1, 1, 1]);
  });
  it("preserves independent compositor color and exponent dimensions in the actual material maps", async () => {
    mocked.compose.mockResolvedValueOnce({ size: 4,
      color: { size: 4, rgba: new Uint8Array(4 * 4 * 4), sha256: "c" },
      exponent: { size: 2, rgba: new Uint8Array(2 * 2 * 4), sha256: "e" },
    });
    const instance = await owner(), m = model();
    await instance.apply(m.root, finish());
    const skin = m.mesh.material as T.MeshPhongMaterial;
    expect((skin.map as T.DataTexture).image.width).toBe(4);
    const shader = { uniforms: {}, fragmentShader: "#include <common>\n#include <lights_phong_pars_fragment>\n#include <lights_phong_fragment>" };
    skin.onBeforeCompile(shader as never, undefined as never);
    const exponent = (shader.uniforms as Record<string, { value: T.DataTexture }>).sourceExponentMap.value;
    expect(exponent.image.width).toBe(2);
    expect(exponent.image.height).toBe(2);
    expect(skin.userData.sourceFinishEvidence.sizes).toEqual({ color: 4, exponent: 2 });
  });
  it("replaces only exact AK slots, uses straight RGBA maps, and restores original array identity", async () => {
    const instance = await owner(), m = model(true);
    await instance.apply(m.root, finish());
    const materials = m.mesh.material as T.MeshPhongMaterial[];
    expect(materials[0]).toBe(m.arms); expect(materials[2]).toBe(m.arms);
    expect(m.other.material).toBe(m.arms);
    const skin = materials[1], map = skin.map as T.DataTexture;
    expect(skin.name).toBe("Source_AK47_VertexLitGeneric");
    expect(skin.userData.sourceParameters.boost).toBe(2);
    expect(map.image.data).toEqual(new Uint8Array([240, 120, 20, 1]));
    expect(map.colorSpace).toBe(T.SRGBColorSpace);
    expect(map.premultiplyAlpha).toBe(false); expect(map.flipY).toBe(false);
    expect(map.generateMipmaps).toBe(false);
    expect(map.mipmaps).toHaveLength(Math.log2(map.image.width)+1);
    expect(map.wrapS).toBe(T.RepeatWrapping); expect(map.wrapT).toBe(T.RepeatWrapping);
    expect(map.anisotropy).toBe(8);
    expect(mocked.compose.mock.calls[0].slice(1)).toEqual([1024, 256]);
    expect(skin.userData.sourceFinish.seed).toBe(422);
    const shader = { uniforms: {}, fragmentShader: "#include <common>\n#include <lights_phong_pars_fragment>\n#include <lights_phong_fragment>" };
    // The Source factory's real onBeforeCompile closes over its own exponent view.
    skin.onBeforeCompile(shader as never, undefined as never);
    const controls = (shader.uniforms as Record<string, { value: T.DataTexture }>).sourceExponentMap.value;
    expect(controls.colorSpace).toBe(T.NoColorSpace);
    expect(controls.wrapS).toBe(T.RepeatWrapping); expect(controls.anisotropy).toBe(8);
    expect(controls.image.data).toEqual(new Uint8Array([2, 30, 60, 0]));
    await instance.apply(m.root, null);
    expect(m.mesh.material).toBe(m.originalContainer);
  });

  it("shares FP/world output until the last root releases, never disposes borrowed defaults", async () => {
    const instance = await owner(), fp = model(), world = model();
    const textures = vi.spyOn(T.Texture.prototype, "dispose"), originalDispose = vi.spyOn(fp.original, "dispose");
    await Promise.all([instance.apply(fp.root, finish()), instance.apply(world.root, finish())]);
    expect(mocked.compose).toHaveBeenCalledTimes(1);
    expect(fp.mesh.material).toBe(world.mesh.material);
    const materialDispose = vi.spyOn(fp.mesh.material as T.Material, "dispose");
    instance.releaseRoot(fp.root);
    expect(fp.mesh.material).toBe(fp.original); expect(materialDispose).not.toHaveBeenCalled();
    instance.releaseRoot(world.root);
    expect(materialDispose).toHaveBeenCalledTimes(1); expect(textures).toHaveBeenCalledTimes(3);
    expect(originalDispose).not.toHaveBeenCalled();
    instance.releaseRoot(world.root); instance.dispose(); instance.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(1); expect(mocked.dispose).toHaveBeenCalledTimes(1);
  });

  it("serializes GPU calls and an old completion cannot overwrite a newer seed", async () => {
    const a = deferred(), b = deferred();
    mocked.compose.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const instance = await owner(), m = model();
    const old = instance.apply(m.root, finish(0)); await tick();
    const latest = instance.apply(m.root, finish(1000)); await tick();
    expect(mocked.compose).toHaveBeenCalledTimes(1);
    a.resolve(output()); await tick();
    expect(m.mesh.material).toBe(m.original);
    expect(mocked.compose).toHaveBeenCalledTimes(2);
    b.resolve(output()); await Promise.all([old, latest]);
    expect((m.mesh.material as T.Material).userData.sourceFinish.seed).toBe(1000);
  });

  it("reuses an in-flight selection revisited quickly and skips abandoned queued work", async () => {
    const a = deferred(); mocked.compose.mockReturnValueOnce(a.promise);
    const instance = await owner(), m = model();
    const first = instance.apply(m.root, finish(0)); await tick();
    const abandoned = instance.apply(m.root, finish(422));
    const latest = instance.apply(m.root, finish(0));
    a.resolve(output()); await Promise.all([first, abandoned, latest]);
    expect(mocked.compose).toHaveBeenCalledTimes(1);
    expect((m.mesh.material as T.Material).userData.sourceFinish.seed).toBe(0);
  });

  it.each(["default", "release", "dispose", "abort"])("%s during composition prevents late assignment/allocation", async (action) => {
    const a = deferred(); mocked.compose.mockReturnValueOnce(a.promise);
    const controller = new AbortController(), instance = await owner(controller.signal), m = model();
    const textures = vi.spyOn(T.Texture.prototype, "dispose");
    const pending = instance.apply(m.root, finish()); await tick();
    if (action === "default") await instance.apply(m.root, null);
    else if (action === "release") instance.releaseRoot(m.root);
    else if (action === "dispose") instance.dispose();
    else controller.abort();
    a.resolve(output()); await pending;
    expect(m.mesh.material).toBe(m.original);
    expect(textures).not.toHaveBeenCalled();
    if (action === "dispose" || action === "abort")
      await expect(instance.apply(m.root, finish())).rejects.toThrow("disposed");
  });

  it("keeps active material on a current failure and the queue can recover", async () => {
    const instance = await owner(), m = model();
    await instance.apply(m.root, finish(0)); const previous = m.mesh.material;
    mocked.compose.mockRejectedValueOnce(Error("GPU unavailable"));
    await expect(instance.apply(m.root, finish(422))).rejects.toThrow("GPU unavailable");
    expect(m.mesh.material).toBe(previous);
    await instance.apply(m.root, finish(1000));
    expect((m.mesh.material as T.Material).userData.sourceFinish.seed).toBe(1000);
  });

  it("suppresses stale failures and can cancel a pending change by selecting active finish", async () => {
    const instance = await owner(), m = model();
    await instance.apply(m.root, finish(0)); const previous = m.mesh.material;
    const a = deferred(); mocked.compose.mockReturnValueOnce(a.promise);
    const stale = instance.apply(m.root, finish(422)); await tick();
    await instance.apply(m.root, finish(0));
    a.reject(Error("stale GPU failure")); await expect(stale).resolves.toBeUndefined();
    expect(m.mesh.material).toBe(previous); expect(mocked.compose).toHaveBeenCalledTimes(2);
  });

  it("bounds past material storage and regenerates a released selection", async () => {
    const instance = await owner(), m = model();
    const disposed: ReturnType<typeof vi.spyOn>[] = [];
    for (let seed = 0; seed < 8; seed++) {
      await instance.apply(m.root, finish(seed));
      disposed.push(vi.spyOn(m.mesh.material as T.Material, "dispose"));
    }
    for (const spy of disposed.slice(0, -1)) expect(spy).toHaveBeenCalledTimes(1);
    expect(disposed[7]).not.toHaveBeenCalled();
    instance.releaseRoot(m.root);
    await instance.apply(m.root, finish(0));
    expect(mocked.compose).toHaveBeenCalledTimes(9);
  });

  it("release then immediate same-root acquisition cannot restore the old root state", async () => {
    const a = deferred(); mocked.compose.mockReturnValueOnce(a.promise);
    const instance = await owner(), m = model();
    const old = instance.apply(m.root, finish(422)); await tick();
    instance.releaseRoot(m.root);
    const latest = instance.apply(m.root, finish(422));
    a.resolve(output()); await Promise.all([old, latest]);
    expect(mocked.compose).toHaveBeenCalledTimes(1);
    expect((m.mesh.material as T.Material).userData.sourceFinish.seed).toBe(422);
    instance.releaseRoot(m.root); expect(m.mesh.material).toBe(m.original);
  });

  it("does no work for other guns and refuses overlapping roots without breaking ownership", async () => {
    const instance = await owner(), m = model(), other = model();
    other.original.name = "Source_M4A4_VertexLitGeneric";
    await instance.apply(other.root, finish()); expect(mocked.compose).not.toHaveBeenCalled();
    await instance.apply(m.root, finish());
    await expect(instance.apply(m.mesh, finish())).rejects.toThrow("must not overlap");
    instance.releaseRoot(m.root); expect(m.mesh.material).toBe(m.original);
  });

  it("does not clobber an external material replacement or accept invalid input", async () => {
    const instance = await owner(), m = model();
    await instance.apply(m.root, finish());
    const active = m.mesh.material;
    await expect(instance.apply(m.root, finish(1001))).rejects.toThrow("seed 0..1000");
    expect(m.mesh.material).toBe(active);
    const external = new T.MeshBasicMaterial(); m.mesh.material = external;
    await instance.apply(m.root, finish(0));
    instance.releaseRoot(m.root); expect(m.mesh.material).toBe(external);
  });

  it("disposes a compositor if the signal aborts during asynchronous initialization", async () => {
    const controller = new AbortController();
    mocked.create.mockImplementation(async () => {
      controller.abort(); return { compose: mocked.compose, dispose: mocked.dispose };
    });
    await expect(owner(controller.signal)).rejects.toThrow();
    expect(mocked.dispose).toHaveBeenCalledTimes(1);
  });
});
