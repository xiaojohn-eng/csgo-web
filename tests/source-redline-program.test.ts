import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { SOURCE_REDLINE_PROGRAM_DATA } from "../game/source-redline-program-data";
import {
  sourceRedlinePhongMaterialValue,
  sourceRedlineWearMaterialValue,
} from "../game/source-redline-parameters";
const base = ".reference-assets/source-exports/ak47-redline-programs/";
const evidence = JSON.parse(readFileSync(base + "evidence.json", "utf8"));
const client = JSON.parse(readFileSync(base + "client-parameters.json", "utf8"));
it("retains every original instruction and exact original program identity", () => {
  for (const [index, pass] of ["color", "exponent", "vertex"].entries()) {
    const entry = SOURCE_REDLINE_PROGRAM_DATA[pass as keyof typeof SOURCE_REDLINE_PROGRAM_DATA],
      raw = readFileSync(base + evidence.programs[index].file);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(entry.sha256);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength),
      words = Array.from({ length: raw.byteLength / 4 }, (_, i) => view.getUint32(i * 4, true)),
      tokens = [];
    expect([0xffff0300, 0xfffe0300]).toContain(words[0]);
    for (let at = 1; at < words.length;) {
      const token = words[at],
        op = token & 65535;
      if (op === 65535) {
        expect(at).toBe(words.length - 1);
        break;
      }
      const count = op === 65534 ? (token >>> 16) & 32767 : (token >>> 24) & 15;
      if (op !== 65534) tokens.push(words.slice(at, at + count + 1));
      at += count + 1;
    }
    expect(tokens).toEqual(entry.tokens);
  }
});
it("maps schema integers to the original client arithmetic and original %f precision", () => {
  expect(client.scalarCases).toHaveLength(512);
  for (const c of client.scalarCases) {
    expect(c.originalFormat).toBe("%f");
    expect(sourceRedlinePhongMaterialValue(c.schemaInteger)).toBe(c.portableParsedFloat32);
  }
  // Direct division skips original material text serialization.
  expect(sourceRedlinePhongMaterialValue(150)).not.toBe(Math.fround(150 / 255));
  for (const c of client.wearCases)
    expect(sourceRedlineWearMaterialValue(c.input)).toBe(c.portableParsedFloat32);
});
it("binds only samplers declared by each selected original program", () => {
  const bindings = evidence.samplerBindCommands;
  for (const [index, samplers] of [
    [0, [0, 1, 3, 5, 8]],
    [1, [0, 1, 2, 8]],
  ] as const) {
    expect(
      evidence.programs[index].ctab.constants
        .filter((c: { registerSet: number }) => c.registerSet === 3)
        .map((c: { index: number }) => c.index)
        .sort((a: number, b: number) => a - b),
    ).toEqual(samplers);
    for (const s of samplers) {
      const native = bindings.find((b: { sampler: number }) => b.sampler === s);
      expect(native.nativeCommand).toBe(10);
      expect(native.srgbRead).toBe([0, 3, 5, 8].includes(s));
    }
  }
});
it("rejects out-of-range or nonfinite original scalar inputs", () => {
  for (const x of [-1, 0.5, 256, Infinity, NaN])
    expect(() => sourceRedlinePhongMaterialValue(x)).toThrow();
  for (const x of [-0.1, 1.01, Infinity, NaN])
    expect(() => sourceRedlineWearMaterialValue(x)).toThrow();
});
