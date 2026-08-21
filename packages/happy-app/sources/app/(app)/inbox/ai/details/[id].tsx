import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { AiGroupAvatar, AiIdentityAvatar } from '@/features/aiTeams/components';
import { useManagedAiTeamData } from '@/features/aiTeams/agentStore';
import { findAiAgent } from '@/features/aiTeams/types';
import { deriveAiAgentPresence, getAiAgentPresenceLabel } from '@/features/aiTeams/agentPresence';
import { getCurrentLanguage } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingBottom: 48,
    },
    overview: {
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 26,
    },
    title: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 21,
        lineHeight: 28,
        marginTop: 12,
        textAlign: 'center',
    },
    subtitle: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        marginTop: 4,
        textAlign: 'center',
    },
    section: {
        marginTop: 18,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        paddingHorizontal: 20,
        marginBottom: 8,
    },
    list: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    row: {
        minHeight: 66,
        paddingHorizontal: 20,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    rowPressed: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    rowBody: {
        flex: 1,
        minWidth: 0,
    },
    rowTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 15,
        lineHeight: 20,
    },
    rowTitleLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    aiBadge: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceHighest,
    },
    aiBadgeText: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 9,
        lineHeight: 12,
    },
    rowSubtitle: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 2,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
        marginLeft: 76,
    },
    humanAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
    missing: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        padding: 24,
        textAlign: 'center',
    },
}));

export default function AiGroupConversationDetailsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const data = useManagedAiTeamData();
    const isZh = getCurrentLanguage().startsWith('zh');
    const conversation = data.conversations.find((item) => item.id === id && item.kind === 'group');

    if (!conversation) {
        return (
            <View style={styles.screen}>
                <Stack.Screen options={{ headerTitle: isZh ? '群聊详情' : 'Group details' }} />
                <Text style={styles.missing}>{isZh ? '没有找到这个群聊' : 'Group conversation not found'}</Text>
            </View>
        );
    }

    const members = conversation.participantAgentIds
        .map((agentId) => findAiAgent(data, agentId))
        .filter((member) => member !== undefined);
    const participantCount = members.length + conversation.humanParticipantCount;
    const participantSummary = isZh
        ? `${participantCount} 位成员`
        : `${participantCount} ${participantCount === 1 ? 'member' : 'members'}`;

    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ headerTitle: isZh ? '群聊详情' : 'Group details' }} />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.overview}>
                    <AiGroupAvatar members={members} size={68} />
                    <Text style={styles.title}>{conversation.title}</Text>
                    <Text style={styles.subtitle}>{participantSummary}</Text>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{isZh ? '群聊成员' : 'Members'}</Text>
                    <View style={styles.list}>
                        <View style={styles.row}>
                            <View style={styles.humanAvatar}>
                                <Ionicons name="person-outline" size={21} color={theme.colors.textSecondary} />
                            </View>
                            <View style={styles.rowBody}>
                                <Text style={styles.rowTitle}>{isZh ? '你' : 'You'}</Text>
                            </View>
                        </View>
                        {members.length > 0 ? <View style={styles.divider} /> : null}
                        {members.map((member, index) => {
                            const presence = deriveAiAgentPresence(member, data.workItems);
                            return (
                            <React.Fragment key={member.id}>
                                <Pressable
                                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                                    onPress={() => router.push(`/settings/agents/${member.id}` as never)}
                                >
                                    <AiIdentityAvatar id={member.id} name={member.name} size={44} />
                                    <View style={styles.rowBody}>
                                        <View style={styles.rowTitleLine}>
                                            <Text style={styles.rowTitle}>{member.name}</Text>
                                            <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI</Text></View>
                                        </View>
                                        <Text style={styles.rowSubtitle} numberOfLines={1}>{member.role} · {getAiAgentPresenceLabel(presence, isZh)}</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={17} color={theme.colors.textSecondary} />
                                </Pressable>
                                {index < members.length - 1 ? <View style={styles.divider} /> : null}
                            </React.Fragment>
                            );
                        })}
                    </View>
                </View>
            </ScrollView>
        </View>
    );
}
