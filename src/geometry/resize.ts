import { type PageSize, type UserRect, toCssPixels } from "./units.js";

export type ViewBoxPolicy =
  "explicit" | "preserve_user_scale" | "preserve_viewbox";
export type ResizeMode =
  "page_only" | "scale_content_contain" | "scale_content_cover";
export type ResizePlan = {
  contentTransform?: readonly [number, number, number, number, number, number];
  newViewBox: UserRect;
  warnings: readonly string[];
};

export function planResize(input: {
  currentPage: PageSize;
  currentViewBox: UserRect;
  mode: ResizeMode;
  policy?: ViewBoxPolicy;
  targetPage: PageSize;
}): ResizePlan {
  const currentWidth = toCssPixels(input.currentPage.width);
  const currentHeight = toCssPixels(input.currentPage.height);
  const targetWidth = toCssPixels(input.targetPage.width);
  const targetHeight = toCssPixels(input.targetPage.height);
  if (input.mode === "page_only") {
    const policy = input.policy ?? "preserve_user_scale";
    if (policy === "explicit")
      throw new Error("Explicit viewBox requires a supplied viewBox");
    if (policy === "preserve_viewbox")
      return {
        newViewBox: input.currentViewBox,
        warnings: ["DOCUMENT_SCALE_CHANGED"],
      };
    return {
      newViewBox: {
        x: input.currentViewBox.x,
        y: input.currentViewBox.y,
        width: (input.currentViewBox.width * targetWidth) / currentWidth,
        height: (input.currentViewBox.height * targetHeight) / currentHeight,
      },
      warnings:
        currentWidth / input.currentViewBox.width ===
        currentHeight / input.currentViewBox.height
          ? []
          : ["NON_UNIFORM_DOCUMENT_SCALE"],
    };
  }
  const scale =
    input.mode === "scale_content_contain"
      ? Math.min(targetWidth / currentWidth, targetHeight / currentHeight)
      : Math.max(targetWidth / currentWidth, targetHeight / currentHeight);
  const offsetX = (targetWidth - currentWidth * scale) / 2;
  const offsetY = (targetHeight - currentHeight * scale) / 2;
  return {
    contentTransform: [scale, 0, 0, scale, offsetX, offsetY],
    newViewBox: {
      x: input.currentViewBox.x,
      y: input.currentViewBox.y,
      width: (input.currentViewBox.width * targetWidth) / currentWidth,
      height: (input.currentViewBox.height * targetHeight) / currentHeight,
    },
    warnings:
      input.mode === "scale_content_cover" ? ["CONTENT_MAY_BE_CROPPED"] : [],
  };
}
