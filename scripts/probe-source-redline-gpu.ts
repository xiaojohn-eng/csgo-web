import {
  sourceRedlineFragmentShader,
  sourceRedlineVertexShader,
} from "../game/source-redline-program";
type Case = {
  samples: Record<string, number[]>;
  c3: number[];
  expected: Record<string, { rgba: number[] }>;
};
export async function probeSourceRedlineGPU(oracle: { cases: Case[] }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true })!;
  if (!gl || !gl.getExtension("EXT_color_buffer_float"))
    throw Error("Float WebGL2 target required");
  const shaders: WebGLShader[] = [],
    programs: WebGLProgram[] = [];
  const compile = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    shaders.push(s);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)!);
    return s;
  };
  const vertex = compile(gl.VERTEX_SHADER, sourceRedlineVertexShader());
  const tex = gl.createTexture(),
    fb = gl.createFramebuffer(),
    vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw Error("Float framebuffer incomplete");
  const pixel = new Float32Array(4),
    results: unknown[] = [];
  try {
    for (const pass of ["color", "exponent"] as const) {
      const p = gl.createProgram()!;
      programs.push(p);
      gl.attachShader(p, vertex);
      gl.attachShader(
        p,
        compile(gl.FRAGMENT_SHADER, sourceRedlineFragmentShader(pass, "uniforms")),
      );
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p)!);
      gl.useProgram(p);
      gl.uniform1ui(gl.getUniformLocation(p, "sourceRoundBarrier"), 0);
      for (let n = 48; n <= 53; n++)
        gl.uniform4fv(gl.getUniformLocation(p, "c" + n), n % 2 ? [0, 1, 0, 0] : [1, 0, 0, 0]);
      let maximumAbsoluteError = 0,
        worst: { index: number; actual: number[]; expected: number[] } | undefined;
      for (const [index, c] of oracle.cases.entries()) {
        gl.uniform4fv(gl.getUniformLocation(p, "c3"), c.c3);
        for (const [sampler, value] of Object.entries(c.samples))
          gl.uniform4fv(gl.getUniformLocation(p, "sampleValue" + sampler), value);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
        const expected = c.expected[pass].rgba,
          error = Math.max(...expected.map((n, i) => Math.abs(n - pixel[i])));
        if (error > maximumAbsoluteError) {
          maximumAbsoluteError = error;
          worst = { index, actual: Array.from(pixel), expected };
        }
        if (!Array.from(pixel).every(Number.isFinite) || error > 0.0001)
          throw Error(JSON.stringify({ pass, index, pixel: Array.from(pixel), expected, error }));
      }
      results.push({ pass, cases: oracle.cases.length, maximumAbsoluteError, worst });
    }
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw Error("GL error " + error);
    return {
      status: "portable_gpu_matches_independent_original_token_interpreter",
      results,
      glError: error,
      boundary:
        "Original bytecode decoded independently in Python and translated to WebGL2, synthetic sampled values. Original D3D GPU, seed mapping, final skin appearance are not claimed.",
    };
  } finally {
    for (const p of programs) gl.deleteProgram(p);
    for (const s of shaders) gl.deleteShader(s);
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fb);
    gl.deleteVertexArray(vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
