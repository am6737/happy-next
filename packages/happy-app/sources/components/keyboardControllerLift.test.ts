import { beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the patched sources, rather than the package's prebuilt lib output.
import ScrollViewWithBottomPadding from '../../node_modules/react-native-keyboard-controller/src/components/ScrollViewWithBottomPadding';
import { useChatKeyboard } from '../../node_modules/react-native-keyboard-controller/src/components/KeyboardChatScrollView/useChatKeyboard';

const state = vi.hoisted(() => ({
    handler: {} as Record<string, (event: { height: number; duration: number }) => void>,
    reactions: [] as {
        prepare: () => unknown;
        react: (current: unknown, previous: unknown) => void;
        previous: unknown;
    }[],
    animatedProps: [] as (() => Record<string, unknown>)[],
    commands: [] as number[][],
    scroll: { value: 1000 },
    nativeY: 1000,
    nativeLift: 0,
}));

vi.mock('react', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react')>()),
    useEffect: vi.fn(),
}));
vi.mock('react-native', () => ({
    Platform: { OS: 'android' },
    StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('react-native-reanimated', () => ({
    default: { createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedRef: () => () => ({}),
    scrollTo: vi.fn(),
    runOnJS: (fn: unknown) => fn,
    dispatchCommand: (_ref: unknown, command: string, args: number[]) => {
        expect(command).toBe('setKeyboardLift');
        state.commands.push(args);
        state.nativeLift = args[0];
        if (args[1] >= 0) {
            state.nativeY = args[1];
        }
    },
}));
vi.mock('../../node_modules/react-native-keyboard-controller/src/bindings', () => ({ ClippingScrollView: 'ClippingScrollView' }));
vi.mock('../../node_modules/react-native-keyboard-controller/src/hooks', () => ({
    useKeyboardHandler: (handler: typeof state.handler) => {
        state.handler = handler;
    },
}));
vi.mock('../../node_modules/react-native-keyboard-controller/src/reanimated', () => ({
    useDerivedValue: (getter: () => unknown) => ({
        get value() {
            return getter();
        },
    }),
    useAnimatedProps: (getter: () => Record<string, unknown>) => {
        state.animatedProps.push(getter);
        return {};
    },
    useAnimatedReaction: (
        prepare: () => unknown,
        react: (current: unknown, previous: unknown) => void,
    ) => {
        state.reactions.push({ prepare, react, previous: null });
    },
}));
vi.mock('../../node_modules/react-native-keyboard-controller/src/components/hooks/useScrollState', () => ({
    default: () => ({
        offset: state.scroll,
        layout: { value: { width: 400, height: 800 } },
        size: { value: { width: 400, height: 10000 } },
        onLayout: vi.fn(),
        onContentSizeChange: vi.fn(),
    }),
}));

const flush = () => {
    for (const reaction of state.reactions) {
        const current = reaction.prepare();
        reaction.react(current, reaction.previous);
        reaction.previous = current;
    }
};

const event = (name: string, height: number) => {
    state.handler[name]({ height, duration: 250 });
    flush();
};

const mount = () => {
    const keyboard = useChatKeyboard((() => null) as never, {
        inverted: false,
        keyboardLiftBehavior: 'always',
        freeze: { value: false } as never,
        offset: 0,
        blankSpace: { value: 0 } as never,
        extraContentPadding: { value: 0 } as never,
    });
    // Render only this wrapper: the hooks/native commands above are controlled test doubles.
    const component = ScrollViewWithBottomPadding as unknown as {
        render: (props: unknown, ref: null) => { props: { style: Record<string, unknown> } };
    };
    const view = component.render({
        ScrollViewComponent: 'ScrollView',
        bottomPadding: keyboard.padding,
        lift: keyboard.lift,
        liftHandOff: keyboard.liftHandOff,
    }, null);
    flush();
    state.commands.length = 0;
    return view;
};

beforeEach(() => {
    state.handler = {};
    state.reactions.length = 0;
    state.animatedProps.length = 0;
    state.commands.length = 0;
    state.scroll.value = 1000;
    state.nativeY = 1000;
    state.nativeLift = 0;
});

describe('Android command-owned chat lift', () => {
    it('never publishes the lift or Android handoff as Fabric props', () => {
        const view = mount();
        event('onStart', 300);
        event('onMove', 300);
        event('onEnd', 300);

        expect(view.props.style).not.toHaveProperty('transform');
        for (const props of state.animatedProps) {
            expect(props()).not.toHaveProperty('contentOffset');
            expect(props()).not.toHaveProperty('transform');
            expect(props()).not.toHaveProperty('backfaceVisibility');
        }
    });

    it('only translates during motion and hands off scroll + lift atomically', () => {
        mount();
        event('onStart', 300);
        for (const height of [50, 150, 300]) {
            event('onMove', height);
            expect(state.commands.at(-1)).toEqual([height, -1]);
            expect(state.nativeY + state.nativeLift).toBe(1000 + height);
        }
        event('onEnd', 300);
        expect(state.commands.at(-1)).toEqual([0, 1300]);
        expect(state.nativeY + state.nativeLift).toBe(1300);

        state.scroll.value = state.nativeY;
        flush();
        event('onStart', 0);
        expect(state.commands.at(-1)).toEqual([300, 1000]);
        expect(state.nativeY + state.nativeLift).toBe(1300);
        for (const height of [250, 150, 0]) {
            event('onMove', height);
            expect(state.commands.at(-1)).toEqual([height, -1]);
            expect(state.nativeY).toBe(1000);
        }
        event('onEnd', 0);
        expect(state.commands.at(-1)).toEqual([0, 1000]);
        expect(state.nativeLift).toBe(0);
    });

    it('does not wait for a scroll event to clear or start the next lift', () => {
        mount();
        event('onStart', 300);
        event('onMove', 300);
        event('onEnd', 300);
        // The native scroll has happened, but its Reanimated scroll event is still pending.
        expect(state.scroll.value).toBe(1000);
        event('onStart', 0);
        expect(state.commands.at(-1)).toEqual([300, 1000]);
        event('onMove', 250);
        expect(state.commands.at(-1)).toEqual([250, -1]);
        // Even a late event from the opening handoff must not stop the closing animation.
        state.scroll.value = 1300;
        flush();
        event('onMove', 150);
        expect(state.commands.at(-1)).toEqual([150, -1]);
    });

    it('uses the latest lift when keyboard callbacks coalesce before a handoff', () => {
        mount();
        event('onStart', 300);
        event('onMove', 300);
        event('onEnd', 300);
        state.handler.onStart({ height: 0, duration: 250 });
        state.handler.onMove({ height: 250, duration: 250 });
        flush();
        expect(state.commands.at(-1)).toEqual([250, 1000]);
        expect(state.nativeY + state.nativeLift).toBe(1250);
    });

    it('does not replay an old handoff during later updates', () => {
        mount();
        event('onStart', 300);
        event('onMove', 300);
        event('onEnd', 300);
        state.commands.length = 0;
        flush();
        flush();
        expect(state.commands).toEqual([]);
        event('onStart', 0);
        event('onMove', 200);
        expect(state.commands.at(-1)).toEqual([200, -1]);
    });
});
