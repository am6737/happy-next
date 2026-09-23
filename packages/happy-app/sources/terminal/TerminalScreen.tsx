import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    Pressable,
    StyleSheet,
    Text,
    View,
    useColorScheme,
    type LayoutChangeEvent,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { TerminalGridView } from './TerminalGridView';
import { TerminalInput, type TerminalInputHandle } from './TerminalInput';
import { TerminalKeyBar } from './TerminalKeyBar';
import type { TerminalViewportState } from './headlessTerminalState';
import { TerminalStream, type TerminalStreamStatus } from './terminalStream';
import { encodeTerminalKeyInput } from './terminalKeyInput';
import type { NativeTerminalKey } from './terminalKeyEvents';
import { resolveTerminalTheme } from './terminalTheme';
import type { TerminalGridCellMetrics } from './terminalGridMetrics';
import { resolveMeasuredNativeTerminalSize } from './terminalSizeMeasurement';
import { t } from '@/text';

export interface TerminalScreenProps {
    machineId: string;
    terminalId: string;
    /** Which shell this is, for the end of the key bar. */
    status?: string;
    onTitle?: (title: string | undefined) => void;
    onExit?: (info: { exitCode: number | null; signal: number | null }) => void;
}

/**
 * Stand-in rendered only so the grid can measure its own font before anything
 * has been attached. Cell size is derived from a fixed probe string, so the
 * contents here do not affect the measurement.
 */
const UNMEASURED_VIEWPORT: TerminalViewportState = {
    rows: 0,
    cols: 0,
    firstRow: 0,
    oldestRow: 0,
    newestRow: 0,
    grid: [],
    cursor: { row: 0, col: 0, hidden: true },
};

/**
 * A live terminal: the grid, the keyboard, the key bar, and the stream between
 * them.
 *
 * The stream only starts once the view has been measured. Attaching earlier
 * would claim a guessed size on the shell and then immediately resize it, which
 * makes programs that redraw on SIGWINCH (anything full-screen) flash a
 * mis-wrapped frame on entry.
 */
export const TerminalScreen = memo(({ machineId, terminalId, status, onTitle, onExit }: TerminalScreenProps) => {
    const { rt, theme } = useUnistyles();
    const systemScheme = useColorScheme();
    const scheme = rt.themeName === 'light' || rt.themeName === 'dark' ? rt.themeName : systemScheme ?? 'dark';
    const xtermTheme = useMemo(() => resolveTerminalTheme(scheme), [scheme]);

    const [viewport, setViewport] = useState<TerminalViewportState | null>(null);
    const [streamStatus, setStreamStatus] = useState<TerminalStreamStatus>({
        attaching: true,
        error: null,
        offline: false,
    });
    const [cellMetrics, setCellMetrics] = useState<TerminalGridCellMetrics | null>(null);
    const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [ctrlActive, setCtrlActive] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [cursorVisible, setCursorVisible] = useState(true);
    const physicalKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isInputFocused) {
            setCursorVisible(true);
            return;
        }
        const timer = setInterval(() => setCursorVisible((visible) => !visible), 530);
        return () => clearInterval(timer);
    }, [isInputFocused]);

    const streamRef = useRef<TerminalStream | null>(null);
    const inputRef = useRef<TerminalInputHandle>(null);

    const size = useMemo(
        () => resolveMeasuredNativeTerminalSize({ layout, metrics: cellMetrics }),
        [layout, cellMetrics],
    );
    const sizeRef = useRef(size);
    sizeRef.current = size;

    // Kept in refs so the stream effect does not restart whenever the parent
    // re-creates its callbacks.
    const onTitleRef = useRef(onTitle);
    onTitleRef.current = onTitle;
    const onExitRef = useRef(onExit);
    onExitRef.current = onExit;

    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', () => setIsKeyboardVisible(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setIsKeyboardVisible(false));
        return () => {
            show.remove();
            hide.remove();
        };
    }, []);

    // Keyed on whether a size exists rather than on the size itself: a stream
    // survives resizing, and re-running this on every measurement would tear
    // down and rebuild the connection each time the keyboard opens.
    const hasSize = size !== null;
    useEffect(() => {
        const initialSize = sizeRef.current;
        if (!initialSize) {
            return;
        }
        const stream = new TerminalStream({
            machineId,
            terminalId,
            size: initialSize,
            onViewport: setViewport,
            onStatus: setStreamStatus,
            onTitle: (title) => onTitleRef.current?.(title),
            onExit: (info) => onExitRef.current?.(info),
        });
        streamRef.current = stream;
        stream.start();
        return () => {
            stream.dispose();
            streamRef.current = null;
        };
    }, [hasSize, machineId, terminalId]);

    useEffect(() => {
        if (size) {
            streamRef.current?.resize(size);
        }
    }, [size]);

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout((current) =>
            current?.width === width && current.height === height ? current : { width, height },
        );
    }, []);

    /**
     * Sends what the soft keyboard produced.
     *
     * When Ctrl is armed it has to be applied here rather than in the input
     * component: the keyboard reports the character `c`, and only the terminal
     * knows it was meant as `\x03`.
     */
    const handleInput = useCallback(
        (data: string) => {
            const stream = streamRef.current;
            if (!stream) {
                return;
            }
            if (ctrlActive) {
                setCtrlActive(false);
                const [first] = Array.from(data);
                if (data.length > 0 && first !== undefined) {
                    // Anything typed after Ctrl is a control chord, and the rest
                    // of a paste is not — send the chord and drop the remainder
                    // rather than pretending every character was modified.
                    stream.write(encodeTerminalKeyInput({ key: first, ctrl: true }));
                    return;
                }
            }
            if (physicalKeyRef.current === data) {
                physicalKeyRef.current = null;
                return;
            }
            stream.write(data);
        },
        [ctrlActive],
    );

    const handlePhysicalKey = useCallback((event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }) => {
        const stream = streamRef.current;
        if (!stream || event.key.length !== 1) return;
        if (event.ctrlKey || event.metaKey || event.altKey) {
            stream.write(encodeTerminalKeyInput({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }, { inputMode: stream.getInputMode() }));
            physicalKeyRef.current = event.key;
            return;
        }
        physicalKeyRef.current = null;
    }, []);

    const handleTerminalKey = useCallback((key: NativeTerminalKey | string) => {
        const stream = streamRef.current;
        if (!stream) {
            return;
        }
        stream.write(encodeTerminalKeyInput({ key, ctrl: ctrlActive }, { inputMode: stream.getInputMode() }));
        setCtrlActive(false);
    }, [ctrlActive]);

    const handleSendRaw = useCallback((data: string) => {
        streamRef.current?.write(data);
    }, []);

    const toggleCtrl = useCallback(() => setCtrlActive((active) => !active), []);

    const focusKeyboard = useCallback(() => {
        inputRef.current?.showKeyboard();
    }, []);

    const backgroundColor = xtermTheme.background ?? '#1E1E1E';

    return (
        // The key bar at the bottom is what yields to the keyboard, and its own
        // padding is what makes this column resize when it does; see the bar.
        <View style={styles.root}>
            <View style={[styles.gridArea, { backgroundColor }]}>
                {/* Rendered even before a terminal exists: measuring the font is
                    what tells us the grid size, and the grid size is what the
                    stream needs to attach. Gating this on the size would mean
                    neither ever happens. */}
                <Pressable onPress={focusKeyboard} onLayout={handleLayout} style={styles.gridHitbox}>
                    <TerminalGridView
                        state={viewport ?? UNMEASURED_VIEWPORT}
                        xtermTheme={xtermTheme}
                        cursorVisible={cursorVisible}
                        onCellMetricsChange={setCellMetrics}
                    />
                </Pressable>

                {!viewport && streamStatus.attaching ? (
                    <View style={styles.overlay} pointerEvents="none">
                        <ActivityIndicator color={xtermTheme.foreground} />
                    </View>
                ) : null}

                {/* While the machine is away the attach is expected to fail, and
                    its error would only restate what the notice below already
                    says — in worse words. */}
                {streamStatus.error && !streamStatus.offline ? (
                    <View style={styles.overlay}>
                        <Text style={[styles.errorText, { color: xtermTheme.foreground }]}>{streamStatus.error}</Text>
                    </View>
                ) : null}

                <TerminalInput
                    ref={inputRef}
                    isKeyboardVisible={isKeyboardVisible}
                    onInput={handleInput}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    onTerminalKey={handleTerminalKey}
                    onPhysicalKey={handlePhysicalKey}
                />
            </View>

            {/* Sits between the screen and the keys rather than over the screen:
                the frozen content is still worth reading, and this is the one
                thing about it that is out of date. */}
            {streamStatus.offline ? (
                <View
                    style={[
                        styles.offlineNotice,
                        { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.divider },
                    ]}
                >
                    <Text style={[styles.offlineText, { color: theme.colors.textSecondary }]}>
                        {t('terminalSession.machineOffline')}
                    </Text>
                </View>
            ) : null}

            <TerminalKeyBar
                ctrlActive={ctrlActive}
                onToggleCtrl={toggleCtrl}
                onKey={handleTerminalKey}
                onSend={handleSendRaw}
                status={status}
            />
        </View>
    );
});

const styles = StyleSheet.create({
    root: {
        backgroundColor: '#1E1E1E',
        flex: 1,
    },
    gridArea: {
        flex: 1,
    },
    gridHitbox: {
        flex: 1,
        margin: 12,
    },
    overlay: {
        alignItems: 'center',
        bottom: 0,
        justifyContent: 'center',
        left: 0,
        position: 'absolute',
        right: 0,
        top: 0,
    },
    errorText: {
        fontSize: 14,
        paddingHorizontal: 24,
        textAlign: 'center',
    },
    offlineNotice: {
        alignItems: 'center',
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    offlineText: {
        fontSize: 12,
    },
});
