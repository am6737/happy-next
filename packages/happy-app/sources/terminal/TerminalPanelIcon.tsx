import { memo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * The terminal panel's header icons, drawn here so they share one size and one line weight.
 *
 * Plus and cross are drawn on a 24 grid, edge to edge: Ionicons' own leave most of their box
 * empty and look a size smaller than the icons beside them. The rest are Ionicons' outlines
 * (`trash-outline`, `browsers-outline`, `scan-outline`) on their 512 grid, framed with a little
 * margin so they sit a touch smaller than the plus and cross. Both draw their lines at a sixteenth
 * of the box, so they come out the same weight at any size.
 */
const IONICON_MARGIN = 12;
const IONICON_VIEW_BOX = `${-IONICON_MARGIN} ${-IONICON_MARGIN} ${512 + IONICON_MARGIN * 2} ${512 + IONICON_MARGIN * 2}`;
const IONICON_STROKE = (512 + IONICON_MARGIN * 2) / 16;

export type TerminalPanelIconName = 'add' | 'close' | 'trash' | 'window' | 'maximize';

export const TerminalPanelIcon = memo(({ name, color, size = 16 }: {
    name: TerminalPanelIconName;
    color: string;
    size?: number;
}) => {
    const line = { fill: 'none', stroke: color, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
    switch (name) {
        case 'add':
            return (
                <Svg height={size} viewBox="0 0 24 24" width={size}>
                    <Path {...line} d="M12 2.5v19M2.5 12h19" strokeWidth={1.5} />
                </Svg>
            );
        case 'close':
            return (
                <Svg height={size} viewBox="0 0 24 24" width={size}>
                    <Path {...line} d="M20 4L4 20M4 4l16 16" strokeWidth={1.5} />
                </Svg>
            );
        case 'trash':
            return (
                <Svg height={size} viewBox={IONICON_VIEW_BOX} width={size}>
                    <Path {...line} d="M112 112l20 320c.95 18.49 14.4 32 32 32h184c17.67 0 30.87-13.51 32-32l20-320" strokeWidth={IONICON_STROKE} />
                    <Path {...line} d="M80 112h352" strokeWidth={IONICON_STROKE} />
                    <Path {...line} d="M192 112V72h0a23.93 23.93 0 0124-24h80a23.93 23.93 0 0124 24h0v40M256 176v224M184 176l8 224M328 176l-8 224" strokeWidth={IONICON_STROKE} />
                </Svg>
            );
        case 'window':
            return (
                <Svg height={size} viewBox={IONICON_VIEW_BOX} width={size}>
                    <Rect {...line} height={384} rx={48} ry={48} strokeWidth={IONICON_STROKE} width={416} x={48} y={64} />
                    <Path
                        d="M397.82 64H114.18C77.69 64 48 94.15 48 131.2V176h16c0-16 16-32 32-32h320c16 0 32 16 32 32h16v-44.8c0-37.05-29.69-67.2-66.18-67.2z"
                        fill={color}
                    />
                </Svg>
            );
        case 'maximize':
            return (
                <Svg height={size} viewBox={IONICON_VIEW_BOX} width={size}>
                    <Path
                        {...line}
                        d="M336 448h56a56 56 0 0056-56v-56M448 176v-56a56 56 0 00-56-56h-56M176 448h-56a56 56 0 01-56-56v-56M64 176v-56a56 56 0 0156-56h56"
                        strokeWidth={IONICON_STROKE}
                    />
                </Svg>
            );
    }
});
