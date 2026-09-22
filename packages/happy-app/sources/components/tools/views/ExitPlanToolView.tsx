import * as React from 'react';
import { LayoutChangeEvent, Pressable, Text, View, ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { LinearGradient } from 'expo-linear-gradient';
import { ToolViewProps } from "./_all";
import { ToolSectionView } from '../../tools/ToolSectionView';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { knownTools } from '../../tools/knownTools';
import { usePlanExpansion } from '@/hooks/usePlanExpansion';
import { t } from '@/text';

/**
 * How much of a plan shows before the reader asks for the rest. Tall enough to read the shape of a
 * proposal — its headings, its first steps — and short enough that one long plan cannot take the
 * whole page, which is what a plan proposal otherwise does: it is written to be read in full.
 */
const PLAN_PREVIEW_MAX_PX = 240;

/** The strip the fade and its button share at the bottom of a folded plan. */
const PLAN_FADE_PX = 72;

/**
 * Where the fade lies, at the bottom of the folded box. A plain object rather than a
 * `StyleSheet.create` entry, because
 * `LinearGradient` composes its own style onto the one it is given — `[props.style, {...}]` — and a
 * themed style does not survive that on web: it arrives at the DOM as a class name that the array
 * drops, leaving the gradient with no box at all. Nothing here is themed, so nothing is lost.
 */
const FADE_STYLE: ViewStyle = { position: 'absolute', left: 0, right: 0, bottom: 0, height: PLAN_FADE_PX };

/**
 * A theme colour at a given alpha. The fade has to start from the very colour it fades into, at
 * zero alpha, rather than from `transparent`: a bare `transparent` is `rgba(0, 0, 0, 0)`, and an
 * engine that interpolates it without premultiplying would drag the last lines of the plan through
 * black. The theme's colours are hex, hence the parse.
 */
function withAlpha(color: string, alpha: number): string {
    const hex = color.replace('#', '');
    const full = hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex;
    const value = parseInt(full, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export const ExitPlanToolView = React.memo<ToolViewProps>(({ tool, messageId }) => {
    const { theme } = useUnistyles();
    let plan = '<empty>'
    const parsed = knownTools.ExitPlanMode.input.safeParse(tool.input);
    if (parsed.success) {
        plan = parsed.data.plan ?? '<empty>';
    }

    const { expanded, heightPx, toggle, reportHeight } = usePlanExpansion(messageId);
    // null means "not measured yet", and the two states it can become are not the same: a plan
    // shorter than the preview is never folded, however the reader left it. Until the measurement
    // arrives the plan is folded anyway, so that the row's height is the folded one from its first
    // frame — the button and its fade join one frame later, once the plan is known to be long.
    const oversize = heightPx === null ? null : heightPx > PLAN_PREVIEW_MAX_PX;
    const folded = !expanded && oversize !== false;

    const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
        reportHeight(event.nativeEvent.layout.height);
    }, [reportHeight]);

    const label = expanded ? t('tools.plan.collapse') : t('tools.plan.expand');

    return (
        <ToolSectionView>
            <View style={styles.plan}>
                {/* The plan is cut here, and nothing else lives inside this box: the fade covers the
                    cut, and the button is below the box, on the card's own background — over the
                    plan's last lines it would sit on top of what it is offering to reveal. */}
                <View style={folded ? styles.frameFolded : undefined}>
                    {/* Measured, never clipped: this is the plan's own height, and the box above is
                        the one that decides how much of it shows. */}
                    <View style={styles.content} onLayout={handleLayout}>
                        <MarkdownView markdown={plan} />
                    </View>
                    {folded && (
                        <LinearGradient
                            colors={[withAlpha(theme.colors.surfaceHigh, 0), theme.colors.surfaceHigh]}
                            style={FADE_STYLE}
                            pointerEvents="none"
                        />
                    )}
                </View>
                {oversize === true && (
                    <Pressable
                        style={styles.toggle}
                        onPress={toggle}
                        accessibilityRole="button"
                        accessibilityState={{ expanded }}
                        accessibilityLabel={label}
                    >
                        <Text style={styles.toggleText}>{label}</Text>
                    </Pressable>
                )}
            </View>
        </ToolSectionView>
    );
});

const styles = StyleSheet.create((theme) => ({
    plan: {
        paddingHorizontal: 8,
        marginTop: -10,
    },
    // The cap and the cut go together: react-native leaves `flexShrink` at 0, so the content keeps
    // its own height and this box is what clips it — a cut, not a squeeze. An open plan is left to
    // overflow as it always did.
    frameFolded: {
        maxHeight: PLAN_PREVIEW_MAX_PX,
        overflow: 'hidden',
    },
    content: {
        flexShrink: 0,
    },
    toggle: {
        alignItems: 'center',
        paddingVertical: 8,
    },
    toggleText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textLink,
    },
}));
