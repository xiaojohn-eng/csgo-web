import { expect, it } from "vitest";
import {SOURCE_FINISHES,SOURCE_FINISH_WEAPONS} from "../game/source-finish-table";
import {validSourceWeaponFinish} from "../game/source-weapon-finish";
import { readFileSync } from "node:fs";
import { SourceUniformRandomStream } from "../game/source-spread";
import { sourceRedlineSkinParameters, sourceRedlineUVMatrix, SOURCE_REDLINE_KIT_282,
  SOURCE_AK_PHONG_ALBEDO_BOOST, SOURCE_AK_PHONG_BOOST } from "../game/source-redline-seed";
import { SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS, sourceRedlinePhongMaterialValue } from "../game/source-redline-parameters";
import { loadSourcePaintKits, sourcePaintKitFor, sourceRedlineKitFor } from "../game/source-paint-kits";
import { beforeEach, vi } from "vitest";
import { readFileSync as readStaged } from "node:fs";
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob([
    readStaged("public/source/csgo-12426148/skins/paint-kits.json") as unknown as Uint8Array<ArrayBuffer>,
  ]))));
});
const evidence = JSON.parse(
  readFileSync(".reference-assets/source-exports/ak47-redline-programs/seed-uv.json", "utf8"),
);
it("matches all original x64 RNG draws, including zero-width intervals that consume state", () => {
  for (const row of evidence.cases) {
    const rng = new SourceUniformRandomStream(row.seed);
    for (const draw of row.draws)
      expect(rng.randomFloat(draw.range[0], draw.range[1])).toBe(draw.value);
  }
});
it("matches original client fields and original five-field matrix parser for every supported UI seed", () => {
  let max = 0;
  for (const row of evidence.cases.filter((r: { seed: number }) => r.seed >= 0 && r.seed <= 1000)) {
    const actual = sourceRedlineSkinParameters({ paintKitId: 282, seed: row.seed, wear: 0.4 });
    for (const name of ["pattern", "wear", "grunge"] as const) {
      expect(actual.sourceUVFields[name]).toEqual(row.fields[name]);
      const matrix = sourceRedlineUVMatrix(row.fields[name]).flat();
      const want = row.matrices[name].nativeMatrix.slice(0, 8);
      for (let i = 0; i < 8; i++) max = Math.max(max, Math.abs(matrix[i] - want[i]));
      expect(matrix).toEqual(want);
    }
  }
  expect(max).toBe(0);
});
it("enforces the documented skin input domain without silently remapping wear", () => {
  for (const input of [
    { paintKitId: 1, seed: 1, wear: 0.4 },
    { paintKitId: 282, seed: -1, wear: 0.4 },
    { paintKitId: 282, seed: 1001, wear: 0.4 },
    { paintKitId: 282, seed: 1.5, wear: 0.4 },
    { paintKitId: 282, seed: 1, wear: 0.09 },
    { paintKitId: 282, seed: 1, wear: 0.71 },
  ])
    expect(() =>
      sourceRedlineSkinParameters(input as Parameters<typeof sourceRedlineSkinParameters>[0]),
    ).toThrow();
  const a = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: 0.4 }),
    b = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: 0.4 });
  expect(a).toEqual(b);
  expect(a.wear).toBe(Math.fround(0.4));
});

it("preserves the original direct seed ABI instead of rifle spread seed plus one", () => {
  const zero = sourceRedlineSkinParameters({ paintKitId: 282, seed: 0, wear: 0.4 });
  const one = sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: 0.4 });
  expect(zero.sourceUVFields).toEqual(one.sourceUVFields);
  for (const c of evidence.descriptorCases) {
    const parameters = sourceRedlineSkinParameters(c.input);
    expect(parameters.sourceInput.seed).toBe(c.nativeObjectValues[1]);
    expect(parameters.wear).toBe(Math.fround(c.nativeObjectValues[2]));
  }
});

it("keeps the verified finish's composition exactly while taking its own numbers from the catalogue", async () => {
  // The default finish must reproduce what the earlier verified composition produced:
  // the same Phong material values, the same pinned pattern transform and the same
  // wear/grunge transforms for a given seed.
  const reference = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 });
  expect({
    phongAlbedoFactor: reference.phongAlbedoFactor,
    phongExponent: reference.phongExponent,
    phongIntensity: reference.phongIntensity,
  }).toEqual(SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS);
  expect(reference.sourceUVFields.pattern).toEqual([1, 0, 0, 0]);
  // The staged catalogue's own record of that finish adapts to the same description.
  const { catalogue } = await loadSourcePaintKits("/staged/");
  const staged = sourcePaintKitFor(catalogue, "weapon_ak47", "282");
  expect(sourceRedlineKitFor(staged)).toEqual(SOURCE_REDLINE_KIT_282);
  expect(sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 }, sourceRedlineKitFor(staged)))
    .toEqual(reference);
});

it("gives every finish its own Phong values and its own wear window", async () => {
  const { catalogue } = await loadSourcePaintKits("/staged/");
  // A second original finish whose own numbers differ from the verified one's: kit 506
  // carries the original's maximum exponent and intensity and a window that stops short
  // of the verified finish's.
  const kit = sourceRedlineKitFor(sourcePaintKitFor(catalogue, "weapon_ak47", "506"));
  expect(kit.paintKitId).toBe(506);
  expect(kit).not.toEqual(SOURCE_REDLINE_KIT_282);
  const parameters = sourceRedlineSkinParameters({ paintKitId: 506, seed: 422, wear: .4 }, kit);
  // The exponent is the finish's own; the intensity is the finish's own divided by the
  // weapon's Phong boost and truncated, which is what the original caller does.
  expect(kit.phongExponent).toBe(255);
  expect(parameters.phongExponent).toBe(sourceRedlinePhongMaterialValue(255));
  expect(parameters.phongIntensity)
    .toBe(sourceRedlinePhongMaterialValue(Math.trunc(255 / SOURCE_AK_PHONG_BOOST)));
  expect(parameters.phongAlbedoFactor).toBe(SOURCE_AK_PHONG_ALBEDO_BOOST);
  const verified = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 });
  expect(parameters.phongExponent).not.toBe(verified.phongExponent);
  expect(parameters.phongIntensity).not.toBe(verified.phongIntensity);
  // Its own wear window is enforced, so a wear the verified finish allows but this one
  // does not is refused rather than quietly composed.
  expect(kit.wearMaximum).toBeLessThan(SOURCE_REDLINE_KIT_282.wearMaximum);
  expect(kit.wearMinimum).toBe(0);
  expect(() => sourceRedlineSkinParameters({ paintKitId: 506, seed: 1, wear: .68 }, kit))
    .toThrow(`wears from ${kit.wearMinimum} to ${kit.wearMaximum}`);
  expect(() => sourceRedlineSkinParameters({ paintKitId: 506, seed: 1, wear: .67 }, kit)).not.toThrow();
  expect(() => sourceRedlineSkinParameters({ paintKitId: 506, seed: 1, wear: 0 }, kit)).not.toThrow();
  // Every AK style-7 finish the extracted artwork covers is usable through this path.
  const covered = ["180", "282", "300", "302", "316", "340", "341", "380", "422", "474", "490", "506",
    "600", "724", "801", "1004", "1141", "1221"];
  expect(covered).toHaveLength(18);
  for (const id of covered) {
    const finish = sourceRedlineKitFor(sourcePaintKitFor(catalogue, "weapon_ak47", id));
    const composed = sourceRedlineSkinParameters({ paintKitId: finish.paintKitId, seed: 422, wear: .5 }, finish);
    expect(composed.sourceUVFields.pattern).toEqual([1, 0, 0, 0]);
    expect(Number.isFinite(composed.phongExponent)).toBe(true);
    expect(Number.isFinite(composed.phongIntensity)).toBe(true);
  }
});

it("refuses a finish whose own description this derivation was not verified against", async () => {
  const { catalogue } = await loadSourcePaintKits("/staged/");
  const kit = sourceRedlineKitFor(sourcePaintKitFor(catalogue, "weapon_ak47", "282"));
  // A finish asked for under another id.
  expect(() => sourceRedlineSkinParameters({ paintKitId: 302, seed: 1, wear: .4 }, kit))
    .toThrow("cannot be asked for as 302");
  // A finish that carries its own albedo boost divides the weapon's own by it, which is the
  // original's own branch: the port's earlier execution harness recorded material 35 against kit 8
  // giving exactly 4.375, so the same case is pinned here.
  const overridden = sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: .4 },
    { ...kit, phongAlbedoBoost: 8 });
  expect(overridden.phongAlbedoFactor).toBe(Math.fround(35 / 8));
  expect(overridden.phongAlbedoFactor).toBe(4.375);
  // Original zero-boost kits preserve Infinity through CMaterialVar and upload its reciprocal zero.
  expect(sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: .4 },
    { ...kit, phongAlbedoBoost: 0 }).phongAlbedoFactor).toBe(Infinity);
  // And a value that is not the original's own convention is refused.
  expect(() => sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: .4 },
    { ...kit, phongAlbedoBoost: -2 })).toThrow("is not the original's own value");
  // A pattern transform that runs from a start value to an end value is a range the composition
  // draws from - the client's own `CUniformRandomStream::RandomFloat(start, end)` - not an
  // animation: the draw lands inside the range and follows the finish's seed.
  const ranged = { ...kit, patternOffsetX: [0, .5], patternRotate: [-15, 15] } as typeof kit;
  // Seeds 1, 2, 3 and 1000: seed 0 is the same stream as seed 1, which is the RNG's own arithmetic
  // (`idum = -seed`, and a non-positive `idum` is replaced by 1), not a property of this draw.
  const drawn = [1, 2, 3, 1000].map((seed) =>
    sourceRedlineSkinParameters({ paintKitId: 282, seed, wear: .4 }, ranged).sourceUVFields.pattern);
  for (const fields of drawn) {
    expect(fields[1]).toBeGreaterThanOrEqual(0);
    expect(fields[1]).toBeLessThanOrEqual(.5);
    expect(fields[3]).toBeGreaterThanOrEqual(-15);
    expect(fields[3]).toBeLessThanOrEqual(15);
  }
  // Different seeds are different patterns, which is what a pattern index is.
  expect(new Set(drawn.map((fields) => fields.join(","))).size).toBe(drawn.length);
  // A reversed range is a range like any other, and nine original kits carry one: the client's own
  // draw neither swaps the interval nor clamps it.
  const reversed = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 },
    { ...kit, patternRotate: [15, -15] } as typeof kit).sourceUVFields.pattern;
  expect(reversed[3]).toBeGreaterThanOrEqual(-15);
  expect(reversed[3]).toBeLessThanOrEqual(15);
  // A range that is a point still returns exactly that point, which is what keeps the verified
  // finish's own composition unchanged: its three ranges are points.
  expect(sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 })
    .sourceUVFields.pattern).toEqual([1, 0, 0, 0]);
  // Phong values outside the original's own integer range, and a degenerate scale.
  expect(() => sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: .4 },
    { ...kit, phongExponent: 256 })).toThrow("Phong values must be 0..255");
  expect(() => sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: .4 },
    { ...kit, patternScale: 0 })).toThrow("pattern scale must be a finite non-zero number");
  // A wear window that is not a window.
  expect(() => sourceRedlineSkinParameters({ paintKitId: 282, seed: 1, wear: .4 },
    { ...kit, wearMaximum: .05 })).toThrow("wear window is not a window");
  // The seed domain is unchanged.
  expect(() => sourceRedlineSkinParameters({ paintKitId: 282, seed: 1001, wear: .4 }, kit))
    .toThrow("seed 0..1000");
});


it("accepts all 476 original skin endpoints after repeated wire validation into actual weapon composition parameters",async()=>{
  const {catalogue}=await loadSourcePaintKits('/original/');let endpoints=0;
  for(const weapon of SOURCE_FINISH_WEAPONS){
    const inputs=JSON.parse(readFileSync(`public/source/csgo-12426148/kit-inputs-fidelity-20260913/${weapon.originalWeapon}/inputs.json`,'utf8'));
    for(const finish of SOURCE_FINISHES[weapon.id]){
      const entry=sourcePaintKitFor(catalogue,weapon.originalWeapon,String(finish.paintKitId));
      const kit=sourceRedlineKitFor(entry,weapon.originalWeapon);
      for(const wear of [finish.wearMinimum,finish.wearMaximum]){
        const once=validSourceWeaponFinish({weapon:weapon.id,paintKitId:finish.paintKitId,seed:422,wear});
        const twice=validSourceWeaponFinish(JSON.parse(JSON.stringify(once)));
        expect(twice,`${weapon.id}:${finish.paintKitId} wear=${wear}`).not.toBeNull();
        const actual=sourceRedlineSkinParameters(twice!,kit,inputs.phong);
        expect(actual).toEqual(sourceRedlineSkinParameters(once!,kit,inputs.phong));
        expect(actual.sourceInput.wear).toBe(twice!.wear);endpoints++;
      }
      for(const wear of [kit.wearMinimum-.001,kit.wearMaximum+.001,NaN,Infinity,-Infinity,Number.MAX_VALUE])
        expect(()=>sourceRedlineSkinParameters({paintKitId:finish.paintKitId,seed:422,wear},kit,inputs.phong)).toThrow(/wears from/);
    }
  }
  expect(endpoints).toBe(476);
});
