import * as React from 'react';
import { useNavigation, useRoute } from "@react-navigation/native";
import { SessionView } from '@/-session/SessionView';
import { t } from '@/text';
import AgentHistoryPage from './history';
import RecentSessionsPage from './recent';
import ClaudeSessionsPage from './claude';

// Fallback mapping for when Expo Router on Native incorrectly
// matches static routes against this dynamic [id] route
const STATIC_ROUTES: Record<string, { component: React.ComponentType; title: () => string }> = {
    history: { component: AgentHistoryPage, title: () => t('agentHistory.title') },
    recent: { component: RecentSessionsPage, title: () => t('sessionHistory.title') },
    claude: { component: ClaudeSessionsPage, title: () => t('claudeHistory.title') },
};

export default React.memo(() => {
    const route = useRoute();
    const navigation = useNavigation();
    const sessionId = (route.params! as any).id as string;

    const staticRoute = STATIC_ROUTES[sessionId];

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

    return (<SessionView id={sessionId} />);
});
