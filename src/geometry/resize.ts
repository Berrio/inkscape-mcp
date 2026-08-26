import { type PageSize, type UserRect, toCssPixels } from "./units.js";

export type ViewBoxPolicy =
  "explicit" | "preserve_user_scale" | "preserve_viewbox";
export type ResizeMode =
  "page_only" | "scale_content_contain" | "scale_content_cover";
export type ResizeAnchor =
  | "bottom_center"
  | "bottom_left"
  | "bottom_right"
  | "center"
  | "center_left"
  | "center_right"
  | "top_center"
  | "top_left"
  | "top_right";
export type ResizePlan = {
  contentTransform?: readonly [number, number, number, number, number, number];
  newViewBox: UserRect;
  warnings: readonly string[];
};

export function planResize(input: {
  currentPage: PageSize;
  currentViewBox: UserRect;
  anchor?: ResizeAnchor;
  mode: ResizeMode;
  policy?: ViewBoxPolicy;
  targetPage: PageSize;
}): ResizePlan {
  const currentWidth = toCssPixels(input.currentPage.width);
  const currentHeight = toCssPixels(input.currentPage.height);
  const targetWidth = toCssPixels(input.targetPage.width);
  const targetHeight = toCssPixels(input.targetPage.height);
  const anchor = anchorFractions(
    input.anchor ?? (input.mode === "page_only" ? "top_left" : "center"),
  );
  if (input.mode === "page_only") {
    const policy = input.policy ?? "preserve_user_scale";
    if (policy === "explicit")
      throw new Error("Explicit viewBox requires a supplied viewBox");
    if (policy === "preserve_viewbox")
      return {
        newViewBox: input.currentViewBox,
        warnings: ["DOCUMENT_SCALE_CHANGED"],
      };
    const width = (input.currentViewBox.width * targetWidth) / currentWidth;
    const height = (input.currentViewBox.height * targetHeight) / currentHeight;
    return {
      newViewBox: {
        x:
          input.currentViewBox.x +
          (input.currentViewBox.width - width) * anchor.x,
        y:
          input.currentViewBox.y +
          (input.currentViewBox.height - height) * anchor.y,
        width,
        height,
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
  const offsetX = (targetWidth - currentWidth * scale) * anchor.x;
  const offsetY = (targetHeight - currentHeight * scale) * anchor.y;
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
function anchorFractions(anchor: ResizeAnchor): { x: number; y: number } {
  if (anchor === "center") return { x: 0.5, y: 0.5 };
  const [vertical, horizontal] = anchor.split("_");
  return {
    x: horizontal === "right" ? 1 : horizontal === "center" ? 0.5 : 0,
    y: vertical === "bottom" ? 1 : vertical === "center" ? 0.5 : 0,
  };
}
