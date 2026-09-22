import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  PixelRatio,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { G, Path } from "react-native-svg";
import type { ITheme } from "@xterm/headless";

import {
  createTerminalCellStyleResolver,
  DEFAULT_TERMINAL_THEME,
} from "./terminalColors";
import type { TerminalGlyphRect } from "./terminalCustomGlyph";
import { DEFAULT_TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY } from "./terminalFont";
import type { TerminalViewportState } from "./headlessTerminalState";
import {
  resolveMeasuredTerminalCellMetrics,
  resolveTerminalCustomGlyphCellTransform,
  resolveTerminalGridMetricsMeasurement,
  resolveTerminalCursorOffset,
  type TerminalGridCellMetrics,
} from "./terminalGridMetrics";
import {
  buildRows,
  type TerminalCustomGlyphCell,
  type TerminalCustomGlyphRun,
  type TerminalRowModel,
  type TerminalRun,
} from "./terminalRowModel";

const MEASURE_TEXT = "mmmmmmmmmm";
const INITIAL_CELL_WIDTH_RATIO = 0.62;
const INITIAL_CELL_HEIGHT_RATIO = 1.35;

interface CellMetrics {
  cellWidth: number;
  cellHeight: number;
}

interface TerminalGridViewport {
  width: number;
  height: number;
}

interface TerminalGridRowProps {
  row: TerminalRowModel;
  cellWidth: number;
  cellHeight: number;
  fontFamily?: string;
  fontSize: number;
  styleEpoch: string;
}

interface TerminalGridRunProps {
  run: TerminalRun;
  cellWidth: number;
  cellHeight: number;
  textStyle: StyleProp<TextStyle>;
}

export interface TerminalGridViewProps {
  state: TerminalViewportState;
  xtermTheme?: ITheme;
  fontFamily?: string;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
  onCellMetricsChange?: (metrics: TerminalGridCellMetrics) => void;
  cursorVisible?: boolean;
}

function estimateCellMetrics(fontSize: number): CellMetrics {
  return {
    cellWidth: snapPixel(fontSize * INITIAL_CELL_WIDTH_RATIO),
    cellHeight: snapPixel(fontSize * INITIAL_CELL_HEIGHT_RATIO),
  };
}

function snapPixel(value: number): number {
  return Math.max(1, PixelRatio.roundToNearestPixel(value));
}

function resolveVisibleCols(input: {
  viewportWidth: number;
  cellWidth: number;
  gridCols: number;
}): number {
  if (input.viewportWidth <= 0 || input.cellWidth <= 0 || input.gridCols <= 0) {
    return 0;
  }
  return Math.min(input.gridCols, Math.max(1, Math.floor(input.viewportWidth / input.cellWidth)));
}

function TerminalGridRun({ run, cellWidth, cellHeight, textStyle }: TerminalGridRunProps) {
  const runStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.run,
      {
        backgroundColor: run.style.backgroundColor,
        height: cellHeight,
        width: run.cellCount * cellWidth,
      },
    ],
    [cellHeight, cellWidth, run.cellCount, run.style.backgroundColor],
  );
  const runTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [textStyle, run.style],
    [run.style, textStyle],
  );

  return (
    <View style={runStyle}>
      {run.renderKind === "custom-glyph" ? (
        <TerminalGridCustomGlyphRun run={run} cellWidth={cellWidth} cellHeight={cellHeight} />
      ) : (
        <Text numberOfLines={1} style={runTextStyle}>
          {run.text}
        </Text>
      )}
    </View>
  );
}

interface TerminalGridCustomGlyphRunProps {
  run: TerminalCustomGlyphRun;
  cellWidth: number;
  cellHeight: number;
}

interface TerminalGridCustomGlyphRectProps {
  cell: TerminalCustomGlyphCell;
  rect: TerminalGlyphRect;
  cellWidth: number;
  cellHeight: number;
  foregroundColor: string;
}

function TerminalGridCustomGlyphRect({
  cell,
  rect,
  cellWidth,
  cellHeight,
  foregroundColor,
}: TerminalGridCustomGlyphRectProps) {
  const style = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      backgroundColor: foregroundColor,
      left: (cell.offset + rect.x) * cellWidth,
      top: rect.y * cellHeight,
      width: rect.width * cellWidth,
      height: rect.height * cellHeight,
    }),
    [cell.offset, cellHeight, cellWidth, foregroundColor, rect],
  );

  return <View style={style} />;
}

function TerminalGridCustomGlyphRun({
  run,
  cellWidth,
  cellHeight,
}: TerminalGridCustomGlyphRunProps) {
  const opacity = typeof run.style.opacity === "number" ? run.style.opacity : 1;

  return (
    <View style={[styles.customGlyphRun, { opacity }]}>
      {run.glyphs.map((cell) =>
        cell.glyph.kind === "rects"
          ? cell.glyph.rects.map((rect) => (
              <TerminalGridCustomGlyphRect
                key={`${cell.key}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`}
                cell={cell}
                rect={rect}
                cellWidth={cellWidth}
                cellHeight={cellHeight}
                foregroundColor={run.foregroundColor}
              />
            ))
          : null,
      )}
      <Svg
        height={cellHeight}
        pointerEvents="none"
        preserveAspectRatio="none"
        style={styles.customGlyphSvg}
        viewBox={`0 0 ${run.cellCount * cellWidth} ${cellHeight}`}
        width={run.cellCount * cellWidth}
      >
        <G fill="none" stroke={run.foregroundColor}>
          {run.glyphs.map((cell) =>
            cell.glyph.kind === "path" ? (
              <Path
                d={cell.glyph.path}
                key={cell.key}
                strokeLinecap="butt"
                strokeLinejoin="miter"
                strokeWidth={cell.glyph.strokeWidth}
                transform={resolveTerminalCustomGlyphCellTransform({
                  cellOffset: cell.offset,
                  cellWidth,
                  cellHeight,
                })}
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}
        </G>
      </Svg>
    </View>
  );
}

const MemoTerminalGridRun = memo(TerminalGridRun, (previous, next) => {
  return (
    previous.run === next.run &&
    previous.cellWidth === next.cellWidth &&
    previous.cellHeight === next.cellHeight &&
    previous.textStyle === next.textStyle
  );
});

function TerminalGridRow({
  row,
  cellWidth,
  cellHeight,
  fontFamily,
  fontSize,
}: TerminalGridRowProps) {
  const rowStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.row, { height: cellHeight }],
    [cellHeight],
  );
  const textStyle = useMemo<StyleProp<TextStyle>>(
    () => [
      styles.rowText,
      {
        height: cellHeight,
        lineHeight: cellHeight,
        fontFamily,
        fontSize,
      },
    ],
    [cellHeight, fontFamily, fontSize],
  );
  const accessibilityLabel = useMemo(
    () =>
      row.runs
        .map((run) => run.text)
        .join("")
        .trimEnd(),
    [row.runs],
  );

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible={accessibilityLabel.length > 0}
      style={rowStyle}
      testID={`terminal-row-${row.index}`}
    >
      {row.runs.map((run) => (
        <MemoTerminalGridRun
          key={run.key}
          run={run}
          cellWidth={cellWidth}
          cellHeight={cellHeight}
          textStyle={textStyle}
        />
      ))}
    </View>
  );
}

const MemoTerminalGridRow = memo(TerminalGridRow, (previous, next) => {
  return (
    previous.row.hash === next.row.hash &&
    previous.cellWidth === next.cellWidth &&
    previous.cellHeight === next.cellHeight &&
    previous.fontFamily === next.fontFamily &&
    previous.fontSize === next.fontSize &&
    previous.styleEpoch === next.styleEpoch
  );
});

export function TerminalGridView({
  state,
  xtermTheme = DEFAULT_TERMINAL_THEME,
  fontFamily = TERMINAL_FONT_FAMILY,
  fontSize = DEFAULT_TERMINAL_FONT_SIZE,
  style,
  onCellMetricsChange,
  cursorVisible = true,
}: TerminalGridViewProps) {
  const [metrics, setMetrics] = useState<CellMetrics>(() => estimateCellMetrics(fontSize));
  const measuredMetricsRef = useRef<TerminalGridCellMetrics | null>(null);
  const [viewport, setViewport] = useState<TerminalGridViewport | null>(null);
  const resolver = useMemo(() => createTerminalCellStyleResolver(xtermTheme), [xtermTheme]);
  const visibleCols = useMemo(() => {
    const viewportWidth = viewport?.width ?? state.cols * metrics.cellWidth;
    return resolveVisibleCols({
      viewportWidth,
      cellWidth: metrics.cellWidth,
      gridCols: state.cols,
    });
  }, [metrics.cellWidth, state.cols, viewport?.width]);
  const projectedGrid = useMemo(
    () => state.grid.map((row) => row.slice(0, visibleCols)),
    [state.grid, visibleCols],
  );
  const rows = useMemo(
    () => buildRows({ grid: projectedGrid, resolver }),
    [projectedGrid, resolver],
  );

  const containerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.root, { backgroundColor: resolver.backgroundColor }, style],
    [resolver.backgroundColor, style],
  );
  const gridStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.grid,
      {
        width: visibleCols * metrics.cellWidth,
        height: state.grid.length * metrics.cellHeight,
      },
    ],
    [metrics.cellHeight, metrics.cellWidth, state.grid.length, visibleCols],
  );
  const measureStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.measureText, { fontFamily: fontFamily, fontSize }],
    [fontFamily, fontSize],
  );
  const cursorStyle = useMemo<StyleProp<ViewStyle>>(() => {
    const cursorOffset = resolveTerminalCursorOffset({
      cursorCol: state.cursor.col,
      cursorRow: state.cursor.row,
      metrics,
    });
    return [
      styles.cursor,
      {
        backgroundColor: resolver.cursorColor,
        width: metrics.cellWidth,
        height: metrics.cellHeight,
        transform: [{ translateX: cursorOffset.x }, { translateY: cursorOffset.y }],
      },
    ];
  }, [metrics, state.cursor.col, state.cursor.row, resolver.cursorColor]);

  const handleMeasure = useCallback(
    (event: LayoutChangeEvent) => {
      const nextMetrics = resolveMeasuredTerminalCellMetrics({
        measuredTextWidth: event.nativeEvent.layout.width,
        measuredTextHeight: event.nativeEvent.layout.height,
        measureTextLength: MEASURE_TEXT.length,
        roundToNearestPixel: (value) => PixelRatio.roundToNearestPixel(value),
      });
      const changedMetrics = resolveTerminalGridMetricsMeasurement(
        measuredMetricsRef.current,
        nextMetrics,
      );
      if (!changedMetrics) {
        return;
      }
      measuredMetricsRef.current = changedMetrics;
      setMetrics(changedMetrics);
      onCellMetricsChange?.(changedMetrics);
    },
    [onCellMetricsChange],
  );

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((current) => {
      if (current?.width === width && current.height === height) {
        return current;
      }
      return { width, height };
    });
  }, []);

  return (
    <View onLayout={handleContainerLayout} pointerEvents="none" style={containerStyle}>
      <View style={gridStyle}>
        <Text onLayout={handleMeasure} pointerEvents="none" style={measureStyle}>
          {MEASURE_TEXT}
        </Text>
        {rows.map((row) => (
          <MemoTerminalGridRow
            key={row.index}
            row={row}
            cellWidth={metrics.cellWidth}
            cellHeight={metrics.cellHeight}
            fontFamily={fontFamily}
            fontSize={fontSize}
            styleEpoch={resolver.themeKey}
          />
        ))}
        {!state.cursor.hidden && cursorVisible && <View pointerEvents="none" style={cursorStyle} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
  grid: {
    position: "relative",
  },
  row: {
    flexDirection: "row",
  },
  run: {
    overflow: "hidden",
  },
  customGlyphRun: {
    flex: 1,
    position: "relative",
  },
  customGlyphSvg: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  rowText: {
    includeFontPadding: false,
    margin: 0,
    padding: 0,
  },
  measureText: {
    includeFontPadding: false,
    opacity: 0,
    position: "absolute",
  },
  cursor: {
    left: 0,
    opacity: 0.45,
    position: "absolute",
    top: 0,
  },
});
