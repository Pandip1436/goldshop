import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_WIDTHS, type ImageRef } from '@goldshop/shared';
import { env } from '../config/env';
import { randomToken } from '../lib/crypto';
import { badRequest } from '../lib/errors';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff']);
const MAX_PIXELS = 60_000_000;

/**
 * Validates an uploaded image by decoding it (not by trusting its extension or MIME type),
 * strips metadata (including GPS), applies EXIF rotation and writes WebP files at each width.
 */
export async function processImage(buffer: Buffer, folder: string, alt = ''): Promise<ImageRef> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw badRequest('That file is not a supported image.');
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw badRequest('Upload a JPEG, PNG, WebP or AVIF image.');

  const safeFolder = folder.replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'misc';
  const now = new Date();
  const key = `${safeFolder}/${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}/${randomToken(9)}`;
  const dir = path.join(env.uploadDir, path.dirname(key));
  await fs.mkdir(dir, { recursive: true });

  const base = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();
  // EXIF orientations 5–8 are rotated 90°, so width and height swap after .rotate().
  const swapped = (meta.orientation ?? 1) >= 5;
  const origW = (swapped ? meta.height : meta.width) ?? 0;
  const origH = (swapped ? meta.width : meta.height) ?? 0;

  for (const w of IMAGE_WIDTHS) {
    await base
      .clone()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: w >= 1600 ? 80 : 82, effort: 4 })
      .toFile(path.join(env.uploadDir, `${key}-${w}.webp`));
  }

  return { key, alt: alt.slice(0, 200), width: origW, height: origH };
}

export async function deleteImageFiles(key: string): Promise<void> {
  if (!key || key.includes('..')) return;
  await Promise.all(
    IMAGE_WIDTHS.map((w) => fs.rm(path.join(env.uploadDir, `${key}-${w}.webp`), { force: true }).catch(() => undefined)),
  );
}
