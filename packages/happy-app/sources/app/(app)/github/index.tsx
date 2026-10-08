import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Stack } from '@/components/navigation/AppStack';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { GitHubListView } from '@/components/GitHubListView';
import { Typography } from '@/constants/Typography';
import { isRunningOnMac } from '@/utils/platform';
import { softHeaderOptions } from '@/components/navigation/softHeader';
import { t } from '@/text';

export default function GitHubPage() {
    const { theme } = useUnistyles();
    const [repo, setRepo] = React.useState<string | null>(null);
    const repoPickerTriggerRef = React.useRef<(() => void) | null>(null);
    const title = repo ? repo.split('/').pop() || repo : t('github.allRepos');
    // The soft header only keeps its edge effect with a plain string title, so on iOS the repo
    // moves into the subtitle and the picker behind a header button instead of the title.
    const useNativeSoftHeader = Platform.OS === 'ios' && !isRunningOnMac();

    return (
        <View style={{ flex: 1 }}>
            <Stack.Screen
                options={useNativeSoftHeader ? {
                    ...softHeaderOptions,
                    headerTitle: t('tabs.github'),
                    headerSubtitle: repo || t('github.allRepos'),
                    headerSubtitleColor: theme.colors.textSecondary,
                    headerRight: () => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('github.switchRepo')}
                            onPress={() => repoPickerTriggerRef.current?.()}
                            hitSlop={10}
                            style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
                        >
                            <Ionicons name="swap-horizontal-outline" size={22} color={theme.colors.header.tint} />
                        </Pressable>
                    ),
                } : {
                    headerTitle: () => (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={repo || title}
                            onPress={() => repoPickerTriggerRef.current?.()}
                            hitSlop={10}
                            style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%' }}
                        >
                            <Text
                                numberOfLines={1}
                                style={{ maxWidth: 200, flexShrink: 1, fontSize: 17, color: theme.colors.header.tint, ...Typography.default('semiBold') }}
                            >
                                {title}
                            </Text>
                            <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />
                        </Pressable>
                    ),
                }}
            />
            <GitHubListView onRepoChange={setRepo} repoPickerTriggerRef={repoPickerTriggerRef} />
        </View>
    );
}
