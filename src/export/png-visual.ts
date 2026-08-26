import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type DecodedPng = { height: number; rgba: Buffer; width: number };
export type PngVisualDifference = {
  differingPixels: number;
  maxChannelDelta: number;
  meanChannelDelta: number;
  totalPixels: number;
};

/** Decodes the non-interlaced, 8-bit grayscale/RGB/RGBA PNGs produced by the
 * supported Inkscape export path. Other encodings fail closed. */
export function decodePngRgba(bytes: Buffer): DecodedPng {
  if (!bytes.subarray(0, 8).equals(SIGNATURE))
    throw new Error("PNG signature is invalid");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const data: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error("PNG is truncated");
    if (type === "IHDR") {
      if (length !== 13) throw new Error("PNG IHDR is invalid");
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      if (bytes[start + 8] !== 8 || bytes[start + 12] !== 0)
        throw new Error(
          "PNG visual decoder requires 8-bit non-interlaced data",
        );
      colorType = bytes[start + 9] ?? -1;
      if (colorType !== 0 && colorType !== 2 && colorType !== 6)
        throw new Error("PNG visual decoder does not support this color type");
    } else if (type === "IDAT") data.push(bytes.subarray(start, end));
    else if (type === "IEND") break;
    offset = end + 4;
  }
  if (width < 1 || height < 1 || colorType < 0 || data.length === 0)
    throw new Error("PNG visual data is incomplete");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(data));
  if (inflated.length !== height * (stride + 1))
    throw new Error("PNG scanlines have an invalid length");
  const raw = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * (stride + 1)]!;
    const input = inflated.subarray(
      row * (stride + 1) + 1,
      (row + 1) * (stride + 1),
    );
    const output = raw.subarray(row * stride, (row + 1) * stride);
    const previous =
      row === 0 ? undefined : raw.subarray((row - 1) * stride, row * stride);
    for (let column = 0; column < stride; column += 1) {
      const left = column < channels ? 0 : output[column - channels]!;
      const above = previous?.[column] ?? 0;
      const upperLeft =
        column < channels ? 0 : (previous?.[column - channels] ?? 0);
      const value = input[column]!;
      output[column] =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 255
            : filter === 2
              ? (value + above) & 255
              : filter === 3
                ? (value + Math.floor((left + above) / 2)) & 255
                : filter === 4
                  ? (value + paeth(left, above, upperLeft)) & 255
                  : (() => {
                      throw new Error("PNG filter is unsupported");
                    })();
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (channels === 1) rgba.fill(raw[source]!, target, target + 3);
    else raw.copy(rgba, target, source, source + 3);
    rgba[target + 3] = channels === 4 ? raw[source + 3]! : 255;
  }
  return { height, rgba, width };
}

export function comparePngVisual(
  actual: DecodedPng,
  expected: DecodedPng,
  channelTolerance = 0,
): PngVisualDifference {
  if (
    !Number.isInteger(channelTolerance) ||
    channelTolerance < 0 ||
    channelTolerance > 255
  )
    throw new Error("PNG channel tolerance is invalid");
  if (actual.width !== expected.width || actual.height !== expected.height)
    throw new Error("PNG visual dimensions differ");
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let totalDelta = 0;
  for (let pixel = 0; pixel < actual.width * actual.height; pixel += 1) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        actual.rgba[pixel * 4 + channel]! - expected.rgba[pixel * 4 + channel]!,
      );
      totalDelta += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > channelTolerance) differs = true;
    }
    if (differs) differingPixels += 1;
  }
  return {
    differingPixels,
    maxChannelDelta,
    meanChannelDelta: totalDelta / actual.rgba.length,
    totalPixels: actual.width * actual.height,
  };
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}
