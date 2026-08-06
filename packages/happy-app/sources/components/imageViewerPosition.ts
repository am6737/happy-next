export function clampImageViewerIndex(initialIndex: number, imageCount: number): number {
  if (imageCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(initialIndex), 0), imageCount - 1);
}
