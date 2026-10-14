import sharp from "sharp";
import { labOfRgb, oklchOfLab, round } from "../analyse/color.ts";

export const IMAGE_PALETTE_VERSION = "image-palette-1";
export type ImagePalette = { intent: "dominant" | "vibrant" | "muted"; colors: { hex: string; share: number }[] };

type Bucket = { r: number; g: number; b: number; count: number; share: number; chroma: number; lightness: number };

function hex(bucket: Pick<Bucket, "r" | "g" | "b">): string {
  return `#${[bucket.r, bucket.g, bucket.b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function distinct(sorted: Bucket[], count: number): Bucket[] {
  const chosen: Bucket[] = [];
  for (const candidate of sorted) {
    if (chosen.every((entry) => Math.hypot(entry.r - candidate.r, entry.g - candidate.g, entry.b - candidate.b) >= 42)) chosen.push(candidate);
    if (chosen.length === count) break;
  }
  for (const candidate of sorted) {
    if (!chosen.includes(candidate)) chosen.push(candidate);
    if (chosen.length === count) break;
  }
  return chosen;
}

export async function extractImagePalettes(bytes: Buffer): Promise<ImagePalette[]> {
  const { data, info } = await sharp(bytes, { animated: false })
    .rotate()
    .resize({ width: 96, height: 96, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<number, number>();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const r = Math.min(255, (data[offset] & 0xe0) + 16);
    const g = Math.min(255, (data[offset + 1] & 0xe0) + 16);
    const b = Math.min(255, (data[offset + 2] & 0xe0) + 16);
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = Math.max(1, info.width * info.height);
  const buckets = [...counts.entries()].map(([key, count]) => {
    const r = (key >> 16) & 0xff;
    const g = (key >> 8) & 0xff;
    const b = key & 0xff;
    const value = oklchOfLab(labOfRgb(r, g, b));
    return { r, g, b, count, share: count / total, chroma: value.c, lightness: value.l };
  });
  const dominant = distinct([...buckets].sort((a, b) => b.count - a.count), 6);
  const vibrant = distinct([...buckets].sort((a, b) => b.chroma - a.chroma || b.count - a.count), 6);
  const muted = distinct([...buckets].sort((a, b) => a.chroma - b.chroma || Math.abs(a.lightness - 0.58) - Math.abs(b.lightness - 0.58) || b.count - a.count), 6);
  const palette = (intent: ImagePalette["intent"], entries: Bucket[]): ImagePalette => ({
    intent,
    colors: entries.map((entry) => ({ hex: hex(entry), share: round(entry.share, 4) })),
  });
  return [palette("dominant", dominant), palette("vibrant", vibrant), palette("muted", muted)];
}
