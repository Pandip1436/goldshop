import type { ImageRef } from './types';

/**
 * Widths generated for every uploaded image. The upload pipeline always writes all three
 * files (never upscaling), so `/uploads/{key}-{w}.webp` exists for each width.
 */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;

export function imageUrl(img: ImageRef, width: number = 960): string {
  if (img.url) return img.url;
  const w = IMAGE_WIDTHS.find((x) => x >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
  return `/uploads/${img.key}-${w}.webp`;
}

export function imageSrcSet(img: ImageRef): string | undefined {
  if (img.url) return undefined;
  // Describe each file by its real width so the browser never picks an upscaled one.
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const w of IMAGE_WIDTHS) {
    const real = Math.min(w, img.width || w);
    if (seen.has(real)) continue;
    seen.add(real);
    parts.push(`/uploads/${img.key}-${w}.webp ${real}w`);
  }
  return parts.join(', ');
}
