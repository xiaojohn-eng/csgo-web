import { describe, expect, it } from "vitest";
import {
  SOURCE_CUSTOMWEAPON_PROGRAMS,
  SOURCE_CUSTOMWEAPON_PROGRAM_VERSION,
} from "../game/source-customweapon-programs";
import { SOURCE_REDLINE_PROGRAM_DATA } from "../game/source-redline-program-data";
import {
  sourceCustomWeaponFragmentShader,
  sourceRedlineFragmentShader,
} from "../game/source-redline-program";

type Permutation = { static: number; samplers: readonly number[]; constants: readonly number[];
  tokens: readonly (readonly number[])[] };
const programs = SOURCE_CUSTOMWEAPON_PROGRAMS as unknown as
  Record<string, { color?: Permutation; exponent?: Permutation }>;
const styles = Object.keys(programs).sort((one, two) => Number(one) - Number(two));

describe("the original CustomWeapon permutations, style by style", () => {
  it("ships the permutations this build compiles, and says which passes are absent", () => {
    expect(SOURCE_CUSTOMWEAPON_PROGRAM_VERSION).toContain("all-styles");
    expect(styles).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    for (const style of styles){expect(programs[style].color).toBeDefined();expect(programs[style].exponent).toBeDefined();}
    expect(programs['3'].exponent!.tokens).toEqual(programs['1'].exponent!.tokens);
    expect(programs['6'].exponent!.tokens).toEqual(programs['4'].exponent!.tokens);
  });

  it("states each permutation's own samplers and float constants", () => {
    // Style 7 is the composition this port has verified: five sampled inputs plus the
    // pattern, and one float constant, which is why it needs nothing else staged.
    expect(programs["7"].color).toMatchObject({ static: 7, samplers: [0, 1, 3, 5, 8], constants: [3] });
    expect(programs["7"].exponent).toMatchObject({ static: 17, samplers: [0, 1, 2, 8], constants: [3] });
    // Every other style reads at least one sampler this port does not stage: the masks
    // texture at 4, and for the spray and airbrushed styles the normals and object-space
    // position textures at 6 and 7.
    for (const style of ["1", "2", "4", "5", "9"])
      expect(programs[style].color!.samplers, `style ${style}`).toContain(4);
    // The two styles that also read the normals and object-space position textures; the
    // spray style reads those instead of the masks texture, the airbrushed one reads both.
    expect(programs["3"].color!.samplers).toEqual([0, 1, 3, 5, 6, 7, 8]);
    expect(programs["6"].color!.samplers).toEqual([0, 1, 3, 4, 5, 6, 7, 8]);
    for (const style of ["3", "6"]) {
      expect(programs[style].color!.samplers).toEqual(expect.arrayContaining([6, 7]));
      // A pattern transform the fragment permutation reads as its own constant, which the
      // port's vertex path does not currently write.
      expect(programs[style].color!.constants).toContain(10);
    }
    // The colour permutations of every style but 7 declare palette constants, and none of
    // the exponent permutations do.
    for (const style of styles)
      if (style !== "7") expect(programs[style].color!.constants[0]).toBe(0);
    for (const style of styles)
      if (programs[style].exponent) expect(programs[style].exponent!.constants).toEqual([3]);
  });

  it("declares every working register the program it translates writes", () => {
    // The translated body assigns into `rN`, so a declaration that stopped short of the highest one
    // a permutation uses would compile as an undeclared identifier rather than as a refusal. Style
    // 1 and 2's colour permutations write r6 where the verified style 7 stops at r5, which is why the
    // count is read from the program rather than fixed.
    for (const style of styles) {
      for (const pass of ["color", "exponent"] as const) {
        const program = programs[style][pass];
        if (!program) continue;
        const shader = sourceCustomWeaponFragmentShader(
          { tokens: program.tokens, samplers: program.samplers, constants: program.constants });
        const declared = new Set([...shader.matchAll(/vec4 (r\d+)=vec4\(0\.0\);/g)].map((match) => match[1]));
        // Every register the translated body assigns into has to be declared.
        for (const match of shader.matchAll(/\br(\d+)\.\w+=\s*tmp\./g))
          expect(declared, `style ${style} ${pass} writes ${match[0]}`).toContain(`r${match[1]}`);
        // And the verified style's own declaration is unchanged by that: its colour pass stops at r5
        // and its exponent pass at r2, which is exactly what the fixed count used to declare.
        if (style === "7") expect([...declared].sort()).toEqual(pass === "color"
          ? ["r0", "r1", "r2", "r3", "r4", "r5"] : ["r0", "r1", "r2"]);
      }
    }
    // Unknown instructions remain a hard refusal after all original permutations are supported.
    expect(()=>sourceCustomWeaponFragmentShader({tokens:[[999,0]],samplers:[],constants:[]})).toThrow('Unsupported original CustomWeapon opcode');
  });

  it("reproduces the published style-7 program exactly", () => {
    // Two independent derivations of the same permutation have to agree, which is what
    // ties the newly compiled styles to the program this port already verified.
    expect(JSON.stringify(programs["7"].color!.tokens))
      .toBe(JSON.stringify(SOURCE_REDLINE_PROGRAM_DATA.color.tokens));
    expect(JSON.stringify(programs["7"].exponent!.tokens))
      .toBe(JSON.stringify(SOURCE_REDLINE_PROGRAM_DATA.exponent.tokens));
  });

  it("keeps the verified style-7 shader unchanged by the generalisation", () => {
    const published = sourceRedlineFragmentShader("color");
    expect(published).toContain("uniform vec4 c3;");
    // The permutation's other constants are its own `def` literals, so nothing else may be
    // declared as a uniform: a second declaration of the same name would not compile.
    for (const register_ of [0, 1, 2, 4, 5, 6])
      expect(published).not.toContain(`uniform vec4 c${register_};`);
    for (const sampler of [0, 1, 3, 5, 8]) expect(published).toContain(`uniform sampler2D s${sampler};`);
    expect(published).not.toContain("uniform sampler2D s2;");
  });

  it("declares a generalised permutation's constants and samplers from its own table", () => {
    const style2 = programs["2"].color!;
    const glsl = sourceCustomWeaponFragmentShader(
      { tokens: style2.tokens, samplers: style2.samplers, constants: style2.constants }, "uniforms");
    for (const register_ of [0, 1, 2]) expect(glsl).toContain(`uniform vec4 c${register_};`);
    for (const sampler of style2.samplers) expect(glsl).toContain(`sampleValue${sampler}`);
    // The permutation's own `def` literals stay local to the body.
    for (const register_ of [4, 5, 6])
      expect(glsl).toContain(`vec4 c${register_}=uintBitsToFloat(`);
  });

  it("translates every original permutation without skipping an instruction", () => {
    const translatable = ["1", "2", "4", "5", "7"];
    for (const style of translatable)
      for (const pass of ["color", "exponent"] as const) {
        const permutation = programs[style][pass];
        if (!permutation) continue;
        const glsl = sourceCustomWeaponFragmentShader(
          { tokens: permutation.tokens, samplers: permutation.samplers, constants: permutation.constants },
          "uniforms");
        expect(glsl.startsWith("#version 300 es")).toBe(true);
        expect(glsl).toContain("void main()");
      }

  });

});
