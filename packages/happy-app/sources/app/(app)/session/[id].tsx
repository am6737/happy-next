import * as React from 'react';
import { useNavigation, useRoute } from "@react-navigation/native";
import { ActivityIndicator, View } from 'react-native';
import { SessionView } from '@/-session/SessionView';
import { getCurrentLanguage, t } from '@/text';
import AgentHistoryPage from './history';
import RecentSessionsPage from './recent';
import ClaudeSessionsPage from './claude';
import { appendMockSessionExchange, ensureMockSessionLoaded } from '@/features/aiTeams/mockSessionBridge';
import { findAiExecutionSession } from '@/features/aiTeams/mockData';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';

// Fallback mapping for when Expo Router on Native incorrectly
// matches static routes against this dynamic [id] route
const STATIC_ROUTES: Record<string, { component: React.ComponentType; title: () => string }> = {
    history: { component: AgentHistoryPage, title: () => t('agentHistory.title') },
    recent: { component: RecentSessionsPage, title: () => t('sessionHistory.title') },
    claude: { component: ClaudeSessionsPage, title: () => t('claudeHistory.title') },
};

function MockSessionRoute({ sessionId, mockExecutionSession }: { sessionId: string; mockExecutionSession: NonNullable<ReturnType<typeof findAiExecutionSession>> }) {
    const [ready, setReady] = React.useState(false);
    const isZh = getCurrentLanguage().startsWith('zh');

    React.useEffect(() => {
        ensureMockSessionLoaded(mockExecutionSession);
        setReady(true);
    }, [mockExecutionSession.id]);

    if (!ready) {
        return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
    }

    return (
        <SessionView
            id={sessionId}
            mock={{
                onSend: (text) => appendMockSessionExchange(
                    sessionId,
                    text,
                    isZh ? '收到。我会基于当前执行上下文继续处理。' : 'Understood. I will continue from the current execution context.',
                ),
            }}
        />
    );
}

export default React.memo(() => {
    const route = useRoute();
    const navigation = useNavigation();
    const sessionId = (route.params! as any).id as string;

    const staticRoute = STATIC_ROUTES[sessionId];
    const aiTeamData = useManagedAiTeamData();
    const mockExecutionSession = findAiExecutionSession(aiTeamData, sessionId);

    // When a static route is incorrectly matched as [id], override the header
    // title to match the static page. Otherwise leave the header to the chat
    // configuration injected by SessionView.
    React.useEffect(() => {
        if (staticRoute) {
            navigation.setOptions({
                headerShown: true,
                headerTitle: staticRoute.title(),
            });
        }
    }, [staticRoute, navigation]);

    if (staticRoute) {
        const StaticComponent = staticRoute.component;
        return <StaticComponent />;
    }

    if (mockExecutionSession) {
        return <MockSessionRoute sessionId={sessionId} mockExecutionSession={mockExecutionSession} />;
    }

    return (<SessionView id={sessionId} />);
});