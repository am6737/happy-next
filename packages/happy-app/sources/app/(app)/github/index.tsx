import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { GitHubListView } from '@/components/GitHubListView';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export default function GitHubPage() {
    const { theme } = useUnistyles();
    const [repo, setRepo] = React.useState<string | null>(null);
    const repoPickerTriggerRef = React.useRef<(() => void) | null>(null);
    const title = repo ? repo.split('/').pop() || repo : t('github.allRepos');

    return (
        <View style={{ flex: 1 }}>
            <Stack.Screen
                options={{
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
