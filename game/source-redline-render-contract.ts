import type { SourceRedlinePass } from "./source-redline-program";

/** Installed CShaderShadowDX8 slot +0x98 -> D3D state 194 ->
 * libtogl GL_FRAMEBUFFER_SRGB. This is write-state evidence, not a pixel oracle. */
export function sourceRedlineSRGBWrite(pass: SourceRedlinePass, preview = false) {
  return pass === "color" || preview;
}

/** Original materialsystem pool with all four targets allocated successfully.
 * Logical requests above 1024 still render/read back through the 1024 target. */
export function sourceRedlineRenderTargetSize(logicalSize: number) {
  if (!Number.isInteger(logicalSize) || logicalSize < 1 || logicalSize > 4096)
    throw Error("Redline logical render target request must be 1..4096");
  return [128, 256, 512, 1024].find((size) => size >= logicalSize) ?? 1024;
}

/** Highest original pool target plus the actual Redline exponent descriptor.
 * FP/world caller profile and live mat_picmip are still not mirrored here. */
export const SOURCE_REDLINE_FINISH_SIZES = Object.freeze({ color: 1024, exponent: 256 });
export const SOURCE_REDLINE_OUTPUT_BOUNDARY = Object.freeze({
  originalWriteStateVerified: true,
  originalPoolAndVTFAllocationVerified: true,
  originalStorage: { color: "DXT5_RUNTIME", exponent: "DXT1_RUNTIME" },
  browserStorage: "straight uncompressed RGBA8 DataTexture",
  originalCompressionReproduced: false,
  originalMipBytesReproduced: false, // Final DXT bytes are still separate.
  originalUncompressedMipGenerationReproduced: true,
  gameplayProfileAndPicmipVerified: false,
});
