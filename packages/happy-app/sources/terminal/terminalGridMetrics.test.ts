import { describe, expect, it } from 'vitest';
import { resolveMeasuredTerminalCellMetrics } from './terminalGridMetrics';

describe('resolveMeasuredTerminalCellMetrics', () => {
    const roundToHalf = (value: number) => Math.round(value * 2) / 2;

    it('keeps the width of a cell as the font advances it', () => {
        const metrics = resolveMeasuredTerminalCellMetrics({
            measuredTextWidth: 78.3,
            measuredTextHeight: 15.4,
            measureTextLength: 10,
            roundToNearestPixel: roundToHalf,
        });
        expect(metrics.cellWidth).toBeCloseTo(7.83, 5);
    });

    it('snaps the height of a row to the pixel grid', () => {
        const metrics = resolveMeasuredTerminalCellMetrics({
            measuredTextWidth: 78.3,
            measuredTextHeight: 15.4,
            measureTextLength: 10,
            roundToNearestPixel: roundToHalf,
        });
        expect(metrics.cellHeight).toBe(15.5);
    });
});
