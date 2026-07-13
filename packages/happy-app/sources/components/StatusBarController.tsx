import React from 'react';
import {
    AppState,
    Keyboard,
    Platform,
    StatusBar as RNStatusBar,
    type StatusBarStyle,
} from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { usePathname } from 'expo-router';
import { UnistylesRuntime, useUnistyles } from 'react-native-unistyles';

type StatusBarIntent = {
    id: string;
    priority: number;
    barStyle?: StatusBarStyle;
    backgroundColor?: string;
    rootBackgroundColor?: string;
    translucent?: boolean;
};

export type StatusBarIntentOptions = Omit<StatusBarIntent, 'id'> & {
    id?: string;
};

type StatusBarSnapshot = Required<Omit<StatusBarIntent, 'id' | 'priority'>>;

type StatusBarControllerValue = {
    pushIntent: (intent: StatusBarIntentOptions) => () => void;
};

const StatusBarControllerContext = React.createContext<StatusBarControllerValue | null>(null);

let externalPushIntent: StatusBarControllerValue['pushIntent'] | null = null;

export function pushStatusBarIntent(intent: StatusBarIntentOptions) {
    return externalPushIntent?.(intent) ?? (() => { });
}

function mergeStatusBarSnapshot(base: StatusBarSnapshot, intents: StatusBarIntent[]): StatusBarSnapshot {
    return [...intents]
        .sort((a, b) => a.priority - b.priority)
        .reduce<StatusBarSnapshot>((snapshot, intent) => ({
            barStyle: intent.barStyle ?? snapshot.barStyle,
            backgroundColor: intent.backgroundColor ?? snapshot.backgroundColor,
            rootBackgroundColor: intent.rootBackgroundColor ?? snapshot.rootBackgroundColor,
            translucent: intent.translucent ?? snapshot.translucent,
        }), base);
}

export function useStatusBarIntent(intent: StatusBarIntentOptions | null | false | undefined) {
    const controller = React.useContext(StatusBarControllerContext);
    const intentKey = intent
        ? JSON.stringify([
            intent.id,
            intent.priority,
            intent.barStyle,
            intent.backgroundColor,
            intent.rootBackgroundColor,
            intent.translucent,
        ])
        : null;

    React.useEffect(() => {
        if (!controller || !intent) {
            return;
        }
        return controller.pushIntent(intent);
    }, [controller, intentKey]);
}

export function StatusBarControllerProvider({ children }: { children?: React.ReactNode }) {
    const pathname = usePathname();
    const { theme } = useUnistyles();
    const [intents, setIntents] = React.useState<StatusBarIntent[]>([]);

    const baseSnapshot = React.useMemo<StatusBarSnapshot>(() => ({
        barStyle: theme.dark ? 'light-content' : 'dark-content',
        backgroundColor: 'transparent',
        rootBackgroundColor: theme.colors.groupped.background,
        translucent: true,
    }), [theme.dark, theme.colors.groupped.background]);

    const snapshot = React.useMemo(
        () => mergeStatusBarSnapshot(baseSnapshot, intents),
        [baseSnapshot, intents]
    );

    const applySnapshot = React.useCallback((animated = false) => {
        RNStatusBar.setBarStyle(snapshot.barStyle, animated);
        UnistylesRuntime.setRootViewBackgroundColor(snapshot.rootBackgroundColor);
        void SystemUI.setBackgroundColorAsync(snapshot.rootBackgroundColor);

        if (Platform.OS === 'android') {
            RNStatusBar.setTranslucent(snapshot.translucent);
            RNStatusBar.setBackgroundColor(snapshot.backgroundColor, animated);
        }
    }, [snapshot]);

    const pushIntent = React.useCallback((intent: StatusBarIntentOptions) => {
        const id = intent.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const normalizedIntent: StatusBarIntent = {
            ...intent,
            id,
        };

        setIntents((prev) => [...prev.filter((item) => item.id !== id), normalizedIntent]);

        return () => {
            setIntents((prev) => prev.filter((item) => item.id !== id));
        };
    }, []);

    React.useEffect(() => {
        externalPushIntent = pushIntent;
        return () => {
            if (externalPushIntent === pushIntent) {
                externalPushIntent = null;
            }
        };
    }, [pushIntent]);

    React.useLayoutEffect(() => {
        applySnapshot(false);
    }, [applySnapshot, pathname]);

    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
                applySnapshot(false);
            }
        });
        return () => subscription.remove();
    }, [applySnapshot]);

    React.useEffect(() => {
        const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const subscription = Keyboard.addListener(event, () => {
            applySnapshot(false);
        });
        return () => subscription.remove();
    }, [applySnapshot]);

    // iOS 26 can reset the native status bar style mid keyboard animation, so we
    // re-apply the current snapshot once the show/hide animation has completed.
    React.useEffect(() => {
        if (Platform.OS !== 'ios') {
            return;
        }
        const subscriptions = [
            Keyboard.addListener('keyboardDidShow', () => applySnapshot(false)),
            Keyboard.addListener('keyboardDidHide', () => applySnapshot(false)),
        ];
        return () => subscriptions.forEach((subscription) => subscription.remove());
    }, [applySnapshot]);

    const contextValue = React.useMemo<StatusBarControllerValue>(() => ({
        pushIntent,
    }), [pushIntent]);

    return (
        <StatusBarControllerContext.Provider value={contextValue}>
            <RNStatusBar
                barStyle={snapshot.barStyle}
                animated={true}
                translucent={snapshot.translucent}
                backgroundColor={snapshot.backgroundColor}
            />
            {children}
        </StatusBarControllerContext.Provider>
    );
}
