/** Installed client 0xf52458..0xf524d2: integer * float32(1/255),
 * then the original "%f" literal serializes six decimal places.
 * Text formatting/parsing is portable, checked against 512 native arguments. */
export function sourceRedlinePhongMaterialValue(schemaInteger: number) {
  if (!Number.isInteger(schemaInteger) || schemaInteger < 0 || schemaInteger > 255)
    throw Error("Original paintkit Phong integer must be 0..255");
  return Math.fround(Number(Math.fround(schemaInteger * Math.fround(1 / 255)).toFixed(6)));
}
/** Explicit material wear value. This is not an inventory wear-remap function. */
export function sourceRedlineWearMaterialValue(wear: number) {
  if (!Number.isFinite(wear) || wear < 0 || wear > 1)
    throw Error("Explicit material wear must be 0..1");
  return Math.fround(Number(Math.fround(wear).toFixed(6)));
}
/** Original client 0xf52421..0xf52441 formats the clone's float32 factor with
 * "%f" before the material system parses it. Non-dyadic ratios need this step
 * too; float32(40/60) and float32(Number("0.666667")) are different values.
 * Four native zero-boost kits format +Infinity as "inf"; CMaterialVar strtod and
 * float storage preserve it (source-paint-zero-albedo.json). */
export function sourceRedlineAlbedoMaterialValue(factor: number) {
  const value = Math.fround(factor);
  if (factor === Infinity) return Infinity;
  if (!Number.isFinite(value) || value <= 0)
    throw Error("Original paintkit albedo factor must be a positive float32 or original +Infinity");
  return Math.fround(Number(value.toFixed(6)));
}
/** Original stdshader 0x66633..0x666d7 uses the material factor directly
 * through 1, otherwise a double reciprocal rounded back to float32. */
export function sourceRedlineAlbedoShaderConstant(materialFactor: number) {
  const factor = Math.fround(materialFactor);
  if (materialFactor === Infinity) return 0; // Original reciprocal emits finite +0 into PS c3.x.
  if (!Number.isFinite(factor)) throw Error("Redline albedo factor must be finite float32 or original +Infinity");
  return factor > 1 ? Math.fround(1 / factor) : factor;
}
export const SOURCE_REDLINE_PHONG_MATERIAL_PARAMETERS = Object.freeze({
  // The real caller clones AK's VMT before submitting its compositor request.
  // Original f5277c..f5291c preserves AK albedo boost 35 and divides kit
  // intensity 10 by AK phongboost 2, truncating to integer 5 at object+c48.
  // See probe-source-redline-phong.py for original caller + clone execution.
  phongAlbedoFactor: 35,
  phongExponent: sourceRedlinePhongMaterialValue(150),
  phongIntensity: sourceRedlinePhongMaterialValue(5),
});
