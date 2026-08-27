export type RasterImportMetadata = {
  height: number;
  mime:
    | "image/bmp"
    | "image/gif"
    | "image/jpeg"
    | "image/png"
    | "image/tiff"
    | "image/webp";
  width: number;
};

/** Builds the bounded SVG wrapper used by a raster document import. */
export function createRasterImportSvg(
  href: string,
  metadata: Pick<RasterImportMetadata, "height" | "width">,
): string {
  if (
    !href ||
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height)
  )
    throw new Error("Raster SVG wrapper has invalid dimensions or href");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}px" height="${metadata.height}px" viewBox="0 0 ${metadata.width} ${metadata.height}"><image id="raster_import" x="0" y="0" width="${metadata.width}" height="${metadata.height}" preserveAspectRatio="none" href="${escapeAttribute(href)}"/></svg>\n`;
}

/** Identifies the narrow raster allowlist by bytes, never by filename. */
export function sniffRasterMime(
  bytes: Uint8Array,
): RasterImportMetadata["mime"] {
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d)
    return "image/bmp";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF(?:87a|89a)$/u)
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0x00) ||
      (bytes[0] === 0x4d &&
        bytes[1] === 0x4d &&
        bytes[2] === 0x00 &&
        bytes[3] === 0x2a))
  )
    return "image/tiff";
  throw new Error("Image asset is not a supported raster format");
}

/** Reads intrinsic canvas dimensions without decoding pixel data. */
export function inspectRasterImport(
  bytes: Uint8Array,
  maximumMegapixels: number,
): RasterImportMetadata {
  if (!Number.isInteger(maximumMegapixels) || maximumMegapixels < 1)
    throw new Error("Raster megapixel limit is invalid");
  const mime = sniffRasterMime(bytes);
  const dimensions =
    mime === "image/bmp"
      ? bmpDimensions(bytes)
      : mime === "image/png"
        ? pngDimensions(bytes)
        : mime === "image/jpeg"
          ? jpegDimensions(bytes)
          : mime === "image/gif"
            ? gifDimensions(bytes)
            : mime === "image/tiff"
              ? tiffDimensions(bytes)
              : webpDimensions(bytes);
  if (dimensions.width < 1 || dimensions.height < 1)
    throw new Error("Raster image has invalid intrinsic dimensions");
  if (dimensions.width * dimensions.height > maximumMegapixels * 1_000_000)
    throw new Error("Raster image exceeds the configured megapixel limit");
  return { ...dimensions, mime };
}

function bmpDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length < 18) throw new Error("BMP image is missing its DIB header");
  const pixelOffset = readUInt32LE(bytes, 10);
  const dibSize = readUInt32LE(bytes, 14);
  let bitsPerPixel: number;
  let height: number;
  let width: number;
  if (dibSize === 12) {
    if (bytes.length < 26)
      throw new Error("BMP image is missing core header dimensions");
    if (readUInt16LE(bytes, 22) !== 1)
      throw new Error("BMP image must contain exactly one plane");
    width = readUInt16LE(bytes, 18);
    height = readUInt16LE(bytes, 20);
    bitsPerPixel = readUInt16LE(bytes, 24);
  } else {
    if (dibSize < 40 || bytes.length < 54)
      throw new Error("BMP image has an unsupported DIB header");
    if (readUInt16LE(bytes, 26) !== 1)
      throw new Error("BMP image must contain exactly one plane");
    if (readUInt32LE(bytes, 30) !== 0)
      throw new Error("BMP image compression is not supported");
    width = readInt32LE(bytes, 18);
    const rawHeight = readInt32LE(bytes, 22);
    if (rawHeight === -2_147_483_648)
      throw new Error("BMP image has invalid dimensions");
    height = Math.abs(rawHeight);
    bitsPerPixel = readUInt16LE(bytes, 28);
  }
  if (width <= 0 || height <= 0)
    throw new Error("BMP image has invalid dimensions");
  if (![1, 4, 8, 16, 24, 32].includes(bitsPerPixel))
    throw new Error("BMP image has an unsupported pixel format");
  const rowBytes = Math.ceil((width * bitsPerPixel) / 32) * 4;
  if (pixelOffset < 14 + dibSize || pixelOffset > bytes.length - rowBytes)
    throw new Error("BMP image is missing pixel data");
  return { height, width };
}

function tiffDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length < 10)
    throw new Error("TIFF image is missing its IFD header");
  const littleEndian = bytes[0] === 0x49;
  const read16 = (offset: number) =>
    readTiffUInt16(bytes, offset, littleEndian);
  const read32 = (offset: number) =>
    readTiffUInt32(bytes, offset, littleEndian);
  const ifdOffset = read32(4);
  if (ifdOffset > bytes.length - 2)
    throw new Error("TIFF image IFD offset is invalid");
  const entryCount = read16(ifdOffset);
  if (entryCount > 128 || ifdOffset + 2 + entryCount * 12 + 4 > bytes.length)
    throw new Error("TIFF image IFD entries are invalid");
  const tags = new Map<number, number>();
  for (let index = 0; index < entryCount; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    const tag = read16(offset);
    const type = read16(offset + 2);
    const count = read32(offset + 4);
    if (
      (tag === 256 ||
        tag === 257 ||
        tag === 259 ||
        tag === 273 ||
        tag === 279) &&
      count === 1 &&
      (type === 3 || type === 4)
    )
      tags.set(tag, type === 3 ? read16(offset + 8) : read32(offset + 8));
  }
  const width = tags.get(256);
  const height = tags.get(257);
  const compression = tags.get(259) ?? 1;
  const stripOffset = tags.get(273);
  const stripByteCount = tags.get(279);
  if (width === undefined || height === undefined || width < 1 || height < 1)
    throw new Error("TIFF image is missing valid dimensions");
  if (compression !== 1)
    throw new Error("TIFF image compression is not supported");
  if (
    stripOffset === undefined ||
    stripByteCount === undefined ||
    stripByteCount < 1 ||
    stripOffset > bytes.length - stripByteCount
  )
    throw new Error("TIFF image is missing strip data");
  return { height, width };
}

function pngDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (
    bytes.length < 33 ||
    readUInt32BE(bytes, 8) !== 13 ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR" ||
    crc32(bytes.subarray(12, 29)) !== readUInt32BE(bytes, 29)
  )
    throw new Error("PNG image is missing its IHDR dimensions");
  return { height: readUInt32(bytes, 20), width: readUInt32(bytes, 16) };
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length)
    throw new Error("Raster dimension header is truncated");
  return (
    bytes[offset]! * 0x1_00_00_00 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function gifDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length < 10) throw new Error("GIF image is missing dimensions");
  return { height: readUInt16LE(bytes, 8), width: readUInt16LE(bytes, 6) };
}

function jpegDimensions(bytes: Uint8Array): { height: number; width: number } {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) break;
    if (isJpegSof(marker)) {
      if (length < 7) break;
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      };
    }
    offset += length;
  }
  throw new Error("JPEG image is missing a supported frame dimensions marker");
}

function webpDimensions(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length < 30) throw new Error("WebP image is missing dimensions");
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X")
    return {
      height: readUInt24LE(bytes, 27) + 1,
      width: readUInt24LE(bytes, 24) + 1,
    };
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a)
      throw new Error("WebP VP8 image is missing its frame header");
    return {
      height: readUInt16LE(bytes, 28) & 0x3fff,
      width: readUInt16LE(bytes, 26) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f)
      throw new Error("WebP VP8L image has an invalid header");
    const bits = readUInt32LE(bytes, 21);
    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
  }
  throw new Error("WebP image uses an unsupported dimension header");
}

function isJpegSof(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length)
    throw new Error("Raster dimension header is truncated");
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length)
    throw new Error("Raster dimension header is truncated");
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length)
    throw new Error("Raster dimension header is truncated");
  return (
    bytes[offset]! * 0x1_00_00_00 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length)
    throw new Error("Raster dimension header is truncated");
  return (
    bytes[offset]! +
    (bytes[offset + 1]! << 8) +
    (bytes[offset + 2]! << 16) +
    bytes[offset + 3]! * 0x1_00_00_00
  );
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length)
    throw new Error("Raster dimension header is truncated");
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  );
}

function readTiffUInt16(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number {
  if (offset + 2 > bytes.length)
    throw new Error("TIFF image header is truncated");
  return littleEndian
    ? bytes[offset]! | (bytes[offset + 1]! << 8)
    : (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readTiffUInt32(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
): number {
  if (offset + 4 > bytes.length)
    throw new Error("TIFF image header is truncated");
  return littleEndian
    ? readUInt32LE(bytes, offset)
    : readUInt32BE(bytes, offset);
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}
