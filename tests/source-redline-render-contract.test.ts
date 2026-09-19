import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sourceRedlineSkinParameters } from "../game/source-redline-seed";
import { sourceRedlineAlbedoShaderConstant } from "../game/source-redline-parameters";
import { sourceRedlineRenderTargetSize, sourceRedlineSRGBWrite, SOURCE_REDLINE_FINISH_SIZES, SOURCE_REDLINE_OUTPUT_BOUNDARY } from "../game/source-redline-render-contract";

const folder = ".reference-assets/source-exports/ak47-redline-programs/";
const render = JSON.parse(readFileSync(folder + "render-contract.json", "utf8"));
const phong = JSON.parse(readFileSync(folder + "phong-parameters.json", "utf8"));

it("matches the complete original CustomWeapon c3 writer including its reciprocal branch", () => {
  for (const row of phong.nativeCustomWeaponAlbedoUpload.cases)
    expect(sourceRedlineAlbedoShaderConstant(row.materialPhongAlbedoFactor)).toBe(row.nativeC3[0]);
  for (const value of [NaN, -Infinity, 1e100])
    expect(() => sourceRedlineAlbedoShaderConstant(value)).toThrow();
});

it("uses the actual successful original clone parameters before compositor submission", () => {
  const clone = phong.clientMaterialCloneParameterBranch;
  const original = clone.cases[clone.redlineAKCaseIndex];
  const selected = sourceRedlineSkinParameters({ paintKitId: 282, seed: 422, wear: .4 });
  const scalars = original.laterCompositeScalarArguments;
  expect(selected.phongIntensity).toBe(scalars.phongIntensity.hostParsedFloat32);
  expect(selected.phongExponent).toBe(scalars.phongExponent.hostParsedFloat32);
  expect(selected.phongAlbedoFactor).toBe(scalars.phongAlbedoFactor.hostParsedFloat32);
  expect(original.nativeCompositeIntensityInteger).toBe(5);
  expect(original.materialAfterBranch.$phongboost).toBe(2);
  expect(original.materialAfterBranch.$phongalbedoboost).toBe(35);
});

it("matches the original shadow bit, D3D command and GL dispatch for each pass", () => {
  expect(render.writeCases).toHaveLength(32);
  for (const row of render.writeCases) {
    const enabled = sourceRedlineSRGBWrite(row.exponent ? "exponent" : "color", row.preview);
    expect(Number(enabled)).toBe(row.nativeArgument);
    expect(row.nativeD3DCommand).toEqual([1, 194, Number(enabled && row.hardwareSupportsSRGB)]);
    expect(row.nativeGLCalls).toEqual([{ enabled: enabled && row.hardwareSupportsSRGB, cap: 0x8db9 }]);
  }
});

it("follows original physical allocation rather than assuming logical 2048 means a 2048 final texture", () => {
  for (const row of render.renderTargetCases)
    expect(sourceRedlineRenderTargetSize(row.requested)).toBe(row.nativeTargetSize);
  for (const row of render.finalVTFInitCases) {
    const init = row.nativeFinalVTFInit;
    expect(init.width).toBe(sourceRedlineRenderTargetSize(row.logicalRequest));
    expect(init.height).toBe(init.width);
    expect(render.imageFormats[init.format].name).toBe(row.exponent ? "DXT1_RUNTIME" : "DXT5_RUNTIME");
  }
  expect(SOURCE_REDLINE_FINISH_SIZES.color).toBe(sourceRedlineRenderTargetSize(2048));
  for (const row of render.exponentDescriptorCases.filter((r: { redlineDefault: boolean }) => r.redlineDefault))
    expect(SOURCE_REDLINE_FINISH_SIZES.exponent).toBe(row.nativeExponentSize);
  expect(SOURCE_REDLINE_OUTPUT_BOUNDARY.originalCompressionReproduced).toBe(false);
  expect(SOURCE_REDLINE_OUTPUT_BOUNDARY.gameplayProfileAndPicmipVerified).toBe(false);
});
