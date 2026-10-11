import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Teammate } from 'happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { ItemList } from '@/components/ItemList';
import { Action, styles, TeammateAvatar, TeammateAvailability } from '@/components/teammates/ui';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useTeammateDelegationAgents } from '@/hooks/useTeammateDelegationAgents';
import { useGithubIssue } from '@/hooks/useGithubData';
import { Modal } from '@/modal';
import { storage } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { rankTeammatesForIssue } from '@/sync/teammateRanking';
import { getServerUrl } from '@/sync/serverConfig';
import { ChannelApiError } from '@/sync/apiChannels';
import { delegateIssueToTeammate } from '@/sync/teammateTaskDelegate';
import { t } from '@/text';

function DelegateAgent({ teammate, reasons, issue, onDone, begin, finish, locked }: {
    teammate: Teammate; reasons: string[]; issue: { resourceId: string; title: string; url: string }; onDone: () => void; begin: () => boolean; finish: () => void; locked: boolean;
}) {
    const { credentials } = useAuth();
    const [busy, delegate] = useHappyAction(async () => {
        if (!credentials || !begin()) return;
        try {
            const server = getServerUrl();
            const task = await delegateIssueToTeammate(credentials, teammate, issue, sync.channels, () => sync.tasks.isCurrent(credentials, server));
            storage.getState().applyTeammateTask(task);
            onDone();
        } catch (error) {
            Modal.alert(t('teammateTasks.delegate'), t(error instanceof ChannelApiError && error.code === 'already_delegated'
                ? 'teammateTasks.alreadyDelegated' : 'teammateTasks.error'));
        } finally { finish(); }
    });
    return <View style={styles.card}>
        <View style={styles.row}><TeammateAvatar teammate={teammate} /><Text style={styles.heading}>{teammate.name}</Text></View>
        <Text style={styles.text}>{teammate.role}</Text>
        <TeammateAvailability teammate={teammate} />
        <Text style={styles.muted}>{reasons.length ? reasons.slice(0, 3).map(reason => reason === 'repo' ? t('teammateTasks.reasonRepo')
            : reason === 'role' ? t('teammateTasks.reasonRole') : `${t('teammateTasks.reasonSkill')}: ${reason.slice(6)}`).join(' · ') : t('teammateTasks.noReasons')}</Text>
        <Action title={t('teammateTasks.delegate')} disabled={busy || locked || !credentials} onPress={delegate} />
    </View>;
}

export default React.memo(function DelegateScreen() {
    const { owner, repo, number, title } = useLocalSearchParams<{ owner: string; repo: string; number: string; title: string }>();
    const router = useRouter();
    const teammates = storage(state => state.teammates);
    const [locked, setLocked] = React.useState(false);
    const lock = React.useRef(false);
    const begin = () => { if (lock.current) return false; lock.current = true; setLocked(true); return true; };
    const finish = () => { lock.current = false; setLocked(false); };
    const loaded = storage(state => state.teammatesLoaded);
    const { data: githubIssue } = useGithubIssue(owner, repo, Number(number));
    useTeammateDelegationAgents();
    const issue = { resourceId: `${owner}/${repo}#${number}`, title: githubIssue?.title || title, url: `https://github.com/${owner}/${repo}/issues/${number}` };
    const ranked = rankTeammatesForIssue(Object.values(teammates).filter(agent => agent.status === 'active'), {
        repo: `${owner}/${repo}`, title: issue.title, body: githubIssue?.body, labels: githubIssue?.labels.map(label => label.name),
    });
    return <ItemList contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{t('teammateTasks.pick')}</Text><Text style={styles.text}>{issue.title}</Text>
        {!loaded && <ActivityIndicator />}
        {loaded && !ranked.length && <Text style={styles.muted}>{t('teammateTasks.empty')}</Text>}
        {ranked.map(({ teammate, reasons }) => <DelegateAgent key={teammate.id} teammate={teammate} reasons={reasons} issue={issue} locked={locked} begin={begin} finish={finish} onDone={() => router.back()} />)}
    </ItemList>;
});
