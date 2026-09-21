import { memo, useMemo } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { t } from '@/text';
import { TerminalWorkspace } from '@/terminal/TerminalWorkspace';

/**
 * Every shell on every machine, one tab each.
 *
 * The route takes no machine: a tab strip is a place you go and stay, and one
 * that only held a single machine's shells would have to be left to reach the
 * next. `machineId` and `terminalId` are a request to reveal one particular
 * tab, which is why they are query parameters — they pick the tab to open on,
 * they do not define the screen.
 */
export default memo(function TerminalsPage() {
    const params = useLocalSearchParams<{ machineId?: string; terminalId?: string; request?: string }>();
    const machineId = typeof params.machineId === 'string' ? params.machineId : undefined;
    const terminalId = typeof params.terminalId === 'string' ? params.terminalId : undefined;
    const request = typeof params.request === 'string' ? params.request : '';

    // `request` is part of the identity on purpose: being sent to the tab that
    // is already on screen still has to bring it back into view, and a value
    // that never changes cannot make that happen.
    const focus = useMemo(
        () => (machineId && terminalId ? { machineId, terminalId } : null),
        [machineId, terminalId, request],
    );

    return (
        <>
            <Stack.Screen options={{ headerTitle: t('terminalSession.title') }} />
            <TerminalWorkspace focus={focus} />
        </>
    );
});
