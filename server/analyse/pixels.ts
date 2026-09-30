/**
 * The sharp adapter: every place the analysis touches image bytes.
 *
 * `analyse` itself never decodes anything. The loader calls these functions,
 * hands the analysis plain arrays, and the analysis stays a pure function a
 * test can feed from a fixture.
 */

import sharp from "sharp";
import type { Box } from "../capture/artifacts.ts";

/** A downscaled RGB raster of the whole page, with the factor back to CSS pixels. */
export type Raster = { width: number; height: number; data: Uint8Array; scale: number };

/** The stitched page, downscaled to at most `maxPixels` (§4.2: ≤ 200 k pixels). */
export async function loadRaster(path: string, maxPixels = 200_000): Promise<Raster> {
  const meta = await sharp(path, { limitInputPixels: false }).metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .resize({ width: targetWidth, kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data), scale: info.width / width };
}

/**
 * 64-bit difference hash: 9×8 greyscale, one bit per horizontal step. Two
 * crops of the same component differ by a few bits; a Hamming distance ≤ 6
 * is a near-duplicate (§5.4).
 */
export async function dHash(path: string): Promise<string> {
  const pixels = await sharp(path).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits = (bits << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export async function isUniformImage(path: string): Promise<boolean> {
  const stats = await sharp(path).stats();
  return stats.channels.slice(0, 3).every((channel) => channel.stdev < 1.5);
}

/** A region of the stitched page as a WebP file (mood crops). */
export async function cutWebp(source: string, box: Box, target: string, maxHeight = 1200): Promise<boolean> {
  const meta = await sharp(source, { limitInputPixels: false }).metadata();
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const width = Math.min((meta.width ?? 0) - left, Math.ceil(box.width));
  const height = Math.min((meta.height ?? 0) - top, Math.ceil(box.height));
  if (width < 8 || height < 8) return false;
  let image = sharp(source, { limitInputPixels: false }).extract({ left, top, width, height });
  if (height > maxHeight) image = image.resize({ height: maxHeight });
  await image.webp({ quality: 84 }).toFile(target);
  return true;
}
