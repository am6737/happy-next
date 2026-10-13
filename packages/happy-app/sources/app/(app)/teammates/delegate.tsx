import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Teammate } from 'happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { TeammateAvatar } from '@/components/teammates/ui';
import { Card, KIT_PAGE_PADDING, PillButton, SectionLabel, StatusDot } from '@/components/teammates/kit';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useTeammateDelegationAgents } from '@/hooks/useTeammateDelegationAgents';
import { useGithubIssue } from '@/hooks/useGithubData';
import { Modal } from '@/modal';
import { storage, useMachine } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { rankTeammatesForIssue } from '@/sync/teammateRanking';
import { getTeammateWorkload } from '@/sync/teammateWorkload';
import { getServerUrl } from '@/sync/serverConfig';
import { ChannelApiError } from '@/sync/apiChannels';
import { delegateIssueToTeammate } from '@/sync/teammateTaskDelegate';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';

function reasonLabel(reason: string): string {
    if (reason === 'repo') return t('teammateTasks.reasonRepo');
    if (reason === 'role') return t('teammateTasks.reasonRole');
    return `${t('teammateTasks.reasonSkill')}: ${reason.slice(6)}`;
}

/** A single-choice Agent row: avatar, name, then availability and why it matches. */
function AgentOption({ teammate, reasons, selected, onSelect }: { teammate: Teammate; reasons: string[]; selected: boolean; onSelect: () => void }) {
    const { theme } = useUnistyles();
    const machine = useMachine(teammate.machineId);
    const runs = storage(state => state.teammateRuns[teammate.id]);
    const tasks = storage(state => state.teammateTasks[teammate.id]);
    const online = !!machine && isMachineOnline(machine);
    const availability = online ? t(`teammates.${getTeammateWorkload(teammate, runs, tasks)}`) : t('teammates.offline');
    return (
        <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={teammate.name} onPress={onSelect}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <TeammateAvatar teammate={teammate} size={40} />
            <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>{teammate.name}</Text>
                <View style={styles.meta}>
                    <View style={styles.availability}>
                        <StatusDot color={online ? theme.colors.status.connected : theme.colors.textSecondary} />
                        <Text style={styles.detail} numberOfLines={1}>{availability}</Text>
                    </View>
                    {reasons.slice(0, 3).map(reason => <Text key={reason} style={styles.detail} numberOfLines={1}>{reasonLabel(reason)}</Text>)}
                </View>
            </View>
            <View style={[styles.indicator, selected && styles.indicatorSelected]}>
                {selected && <Ionicons name="checkmark" size={15} color={theme.colors.button.primary.tint} />}
            </View>
        </Pressable>
    );
}

/** Hands a GitHub issue to one Agent. Agents are ranked by how well they fit; the best match is preselected. */
export default React.memo(function DelegateScreen() {
    const { owner, repo, number, title } = useLocalSearchParams<{ owner: string; repo: string; number: string; title: string }>();
    const router = useRouter();
    const { credentials } = useAuth();
    const teammates = storage(state => state.teammates);
    const loaded = storage(state => state.teammatesLoaded);
    const { data: githubIssue } = useGithubIssue(owner, repo, Number(number));
    useTeammateDelegationAgents();
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const issue = { resourceId: `${owner}/${repo}#${number}`, title: githubIssue?.title || title, url: `https://github.com/${owner}/${repo}/issues/${number}` };
    const ranked = rankTeammatesForIssue(Object.values(teammates).filter(agent => agent.status === 'active'), {
        repo: `${owner}/${repo}`,
        title: issue.title,
        body: githubIssue?.body,
        labels: githubIssue?.labels.map(label => label.name),
    });
    const selected = ranked.find(({ teammate }) => teammate.id === selectedId)?.teammate ?? ranked[0]?.teammate;

    const [busy, delegate] = useHappyAction(async () => {
        if (!credentials || !selected) return;
        try {
            const server = getServerUrl();
            const task = await delegateIssueToTeammate(credentials, selected, issue, sync.channels, () => sync.tasks.isCurrent(credentials, server));
            storage.getState().applyTeammateTask(task);
            router.back();
        } catch (error) {
            Modal.alert(t('teammateTasks.delegate'), t(error instanceof ChannelApiError && error.code === 'already_delegated'
                ? 'teammateTasks.alreadyDelegated' : 'teammateTasks.error'));
        }
    });

    return (
        <ScrollView style={styles.page} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
            <Text style={styles.repo}>{`${owner}/${repo} #${number}`}</Text>
            <Text style={styles.title}>{issue.title}</Text>

            {!loaded && <ActivityIndicator style={styles.loading} />}
            {loaded && !ranked.length && <Text style={styles.empty}>{t('teammateTasks.empty')}</Text>}
            {ranked.length > 0 && (
                <>
                    <SectionLabel title={t('teammateTasks.ranked')} />
                    <Card>
                        <View accessibilityRole="radiogroup">
                            {ranked.map(({ teammate, reasons }) => (
                                <AgentOption key={teammate.id} teammate={teammate} reasons={reasons} selected={teammate.id === selected?.id}
                                    onSelect={() => setSelectedId(teammate.id)} />
                            ))}
                        </View>
                    </Card>
                    <View style={styles.submit}>
                        <PillButton grow label={t('teammateTasks.delegateTo', { name: selected?.name ?? '' })} loading={busy}
                            disabled={!credentials || !selected} onPress={delegate} />
                    </View>
                </>
            )}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 12,
        paddingBottom: 48,
    },
    repo: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        lineHeight: 26,
        color: theme.colors.text,
        marginTop: 4,
    },
    loading: {
        marginTop: 40,
    },
    empty: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 40,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
    },
    rowBody: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    meta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 3,
        overflow: 'hidden',
    },
    availability: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    detail: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    indicator: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: theme.colors.divider,
        alignItems: 'center',
        justifyContent: 'center',
    },
    indicatorSelected: {
        borderWidth: 0,
        backgroundColor: theme.colors.button.primary.background,
    },
    submit: {
        flexDirection: 'row',
        marginTop: 28,
    },
    pressed: {
        opacity: 0.7,
    },
}));
