import { SOURCE_REDLINE_PROGRAM_DATA } from "./source-redline-program-data";

export type SourceRedlinePass = "color" | "exponent";
export const SOURCE_REDLINE_PROGRAM_VERSION =
  "app740-12426148-customweapon-style7-token-candidate-r1";
const regKind = (word: number) => ((word >>> 28) & 7) | ((word >>> 8) & 24);
function register(word: number) {
  const prefix = ({ 0: "r", 1: "v", 2: "c", 6: "o", 8: "oc", 10: "s" } as Record<number, string>)[
    regKind(word)
  ];
  if (!prefix) throw Error("Unsupported original CustomWeapon register");
  return prefix + (word & 2047);
}
function read(word: number) {
  const modifier = (word >>> 24) & 15;
  if (modifier !== 0 && modifier !== 1 && modifier !== 11) throw Error("Unsupported CustomWeapon source modifier");
  const swizzle = Array.from({ length: 4 }, (_, i) => "xyzw"[(word >>> (16 + 2 * i)) & 3]).join("");
  const value=register(word)+"."+swizzle;
  return modifier===11?`abs(${value})`:(modifier===1?"-":"")+value;
}
function body(tokens: readonly (readonly number[])[]) {
  const lines: string[] = [];
  for (const row of tokens) {
    const op = row[0] & 65535,
      word = row[1];
    if (op === 31) continue;
    if (op === 81) {
      lines.push(
        `vec4 ${register(word)}=uintBitsToFloat(uvec4(${row
          .slice(2)
          .map((n) => n + "u")
          .join(",")}));`,
      );
      continue;
    }
    const args = row.slice(2).map(read);
    let value: string;
    if (op === 1) value = args[0];
    else if (op === 2) value = `(${args[0]}+${args[1]})`;
    else if (op === 4) value = `(roundSource(${args[0]}*${args[1]})+${args[2]})`;
    else if (op === 5) value = `(${args[0]}*${args[1]})`;
    else if (op === 6) value = `vec4(1.0/(${args[0]}).x)`;
    else if (op === 7) value = `vec4(inversesqrt(abs((${args[0]}).x)))`;
    else if (op === 8)
      value = `vec4(roundSource(roundSource(${args[0]}*${args[1]}).x+roundSource(${args[0]}*${args[1]}).y)+roundSource(${args[0]}*${args[1]}).z)`;
    else if (op === 11) value = `max(${args[0]},${args[1]})`;
    else if (op === 18)
      value = `(roundSource(${args[0]}*${args[1]})+roundSource(roundSource(vec4(1.0)-${args[0]})*${args[2]}))`;
    else if (op === 32) value = `vec4(pow(abs((${args[0]}).x),(${args[1]}).x))`;
    else if (op === 88) value = `mix(${args[2]},${args[1]},greaterThanEqual(${args[0]},vec4(0.0)))`;
    else if (op === 90) value = `vec4(roundSource(roundSource(${args[0]}*${args[1]}).x+roundSource(${args[0]}*${args[1]}).y)+(${args[2]}).x)`;
    else if (op === 66) value = `sample${row[3] & 2047}((${args[0]}).xy)`;
    else throw Error("Unsupported original CustomWeapon opcode " + op);
    const mask = Array.from({ length: 4 }, (_, i) =>
      word & (1 << (16 + i)) ? "xyzw"[i] : "",
    ).join("");
    if (!mask || (word >>> 24) & 15 || word & (0x6 << 20))
      throw Error("Unsupported original CustomWeapon destination");
    lines.push(`tmp=roundSource(${value});`);
    if (word & (1 << 20)) lines.push("tmp=clamp(tmp,vec4(0.0),vec4(1.0));");
    lines.push(`${register(word)}.${mask}=tmp.${mask};`);
  }
  return lines.join("\n");
}
const rounding = `uniform highp uint sourceRoundBarrier;
vec4 roundSource(vec4 x){return uintBitsToFloat(floatBitsToUint(x)^uvec4(sourceRoundBarrier));}
float roundSource(float x){return uintBitsToFloat(floatBitsToUint(x)^sourceRoundBarrier);}`;
/** The working registers a program writes, declared from the program's own destinations rather than
 * from a fixed count: a permutation that uses more of them than another would otherwise compile as
 * an undeclared identifier, which is what the styles that use a sixth temporary did. The verified
 * style's own programs stop at r5, so its shader is unchanged by this. */
function workingDeclarations(tokens: readonly (readonly number[])[]) {
  let highest = -1;
  for (const row of tokens) {
    // An opcode with no destination writes no register, and only a temp destination is declared
    // here: the output registers have their own declaration.
    if ((row[0] & 65535) === 31) continue;
    if (regKind(row[1]) !== 0) continue;
    highest = Math.max(highest, row[1] & 2047);
  }
  return Array.from({ length: highest + 1 }, (_, index) => `vec4 r${index}=vec4(0.0);`).join("\n");
}

/** Exact selected original instructions translated to WebGL2. This operates on
 * already sampled values; FMA/legacy D3D filtering precision remains a boundary.
 * uniforms mode is only for independent GPU arithmetic probes. textures mode
 * consumes native sampler color spaces supplied by the texture owner. */
export function sourceRedlineFragmentShader(
  pass: SourceRedlinePass,
  sampling: "textures" | "uniforms" = "textures",
) {
  const samplers = pass === "color" ? [0, 1, 3, 5, 8] : [0, 1, 2, 8];
  return sourceCustomWeaponFragmentShader(
    { tokens: SOURCE_REDLINE_PROGRAM_DATA[pass].tokens, samplers, constants: [3] },
    sampling);
}

/** The same translation for any of the original `CustomWeapon` permutations.
 *
 * A style is a static permutation of one shader, so another style's program is the
 * same translator pointed at that permutation's own token stream. Its declared
 * samplers and float constants come from the permutation's own constant table, not
 * from this file: passing exactly what the program declares is what makes a missing
 * input a refusal rather than a black sample or an undeclared uniform. */
export function sourceCustomWeaponFragmentShader(
  program: { tokens: readonly (readonly number[])[]; samplers: readonly number[];
    constants: readonly number[] },
  sampling: "textures" | "uniforms" = "textures",
) {
  const { samplers, constants } = program;
  const reads = samplers
    .map((i) =>
      sampling === "textures"
        ? `uniform sampler2D s${i}; vec4 sample${i}(vec2 uv){return texture(s${i},uv);}`
        : `uniform vec4 sampleValue${i}; vec4 sample${i}(vec2 uv){return sampleValue${i};}`,
    )
    .join("\n");
  // `c3` is written by the caller's own verified upload; every other constant the
  // permutation declares is a uniform it reads, so it is declared here by its own
  // register number.
  const uniforms = constants.filter((register) => register !== 3)
    .map((register) => `uniform vec4 c${register};`)
    .join("");
  return `#version 300 es
precision highp float; precision highp int;
${rounding}
in vec4 v0; in vec4 v1; uniform vec4 c3;
${uniforms}
${reads}
out vec4 outputColor;
void main(){
${workingDeclarations(program.tokens)}
vec4 oc0=vec4(0.0),tmp;
${body(program.tokens)}
outputColor=oc0;
}`;
}

/** Original non-preview VS writes original UV plus three independent original
 * 2x4 texture transforms. The caller must supply verified transforms; this API
 * deliberately does not invent a paint seed to transform mapping. */
export function sourceRedlineVertexShader() {
  return `#version 300 es
precision highp float; precision highp int;
${rounding}
uniform vec4 c48;uniform vec4 c49;uniform vec4 c50;uniform vec4 c51;uniform vec4 c52;uniform vec4 c53;
out vec4 v0;out vec4 v1;
void main(){
vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
vec4 sourcePosition=vec4(p*2.0-1.0,0.0,1.0),sourceUV=vec4(p,0.0,1.0);
vec4 o0=vec4(0.0),o1=vec4(0.0),o2=vec4(0.0),r0=vec4(0.0),tmp;
${body(SOURCE_REDLINE_PROGRAM_DATA.vertex.tokens).replaceAll("v0.", "sourcePosition.").replaceAll("v1.", "sourceUV.")}
gl_Position=o0;v0=o1;v1=o2;
}`;
}
