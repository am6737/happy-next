export interface TerminalGridCellMetrics {
  cellWidth: number;
  cellHeight: number;
}

export interface TerminalGridCellMetricsInput {
  measuredTextWidth: number;
  measuredTextHeight: number;
  measureTextLength: number;
  roundToNearestPixel: (value: number) => number;
}

export interface TerminalCursorOffsetInput {
  cursorCol: number;
  cursorRow: number;
  metrics: TerminalGridCellMetrics;
}

export interface TerminalCursorOffset {
  x: number;
  y: number;
}

export interface TerminalCustomGlyphCellTransformInput {
  cellOffset: number;
  cellWidth: number;
  cellHeight: number;
}

export function resolveTerminalCustomGlyphCellTransform(
  input: TerminalCustomGlyphCellTransformInput,
): string {
  const translateX = input.cellOffset * input.cellWidth;
  return `matrix(${input.cellWidth} 0 0 ${input.cellHeight} ${translateX} 0)`;
}

export function resolveMeasuredTerminalCellMetrics(
  input: TerminalGridCellMetricsInput,
): TerminalGridCellMetrics {
  const textLength = Math.max(1, input.measureTextLength);
  return {
    // Not snapped to a pixel: a run is laid out as `cellCount * cellWidth` while the text inside
    // it advances by the font's own, fractional, width. Rounding 7.8 up to 8 puts every run
    // 0.2px per cell past where its text ends, so whatever follows a styled run — the file
    // names in `ls -l` — lands further right the longer the run before it is. Height is
    // snapped because rows stack on it and nothing advances inside a row's height.
    cellWidth: Math.max(1, input.measuredTextWidth / textLength),
    cellHeight: snapCellMetric(input.measuredTextHeight, input.roundToNearestPixel),
  };
}

export function resolveTerminalGridMetricsMeasurement(
  previous: TerminalGridCellMetrics | null,
  next: TerminalGridCellMetrics,
): TerminalGridCellMetrics | null {
  if (previous?.cellWidth === next.cellWidth && previous.cellHeight === next.cellHeight) {
    return null;
  }
  return next;
}

export function resolveTerminalCursorOffset(
  input: TerminalCursorOffsetInput,
): TerminalCursorOffset {
  return {
    x: input.cursorCol * input.metrics.cellWidth,
    y: input.cursorRow * input.metrics.cellHeight,
  };
}

function snapCellMetric(value: number, roundToNearestPixel: (value: number) => number): number {
  return Math.max(1, roundToNearestPixel(value));
}
