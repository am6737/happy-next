import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/StyledText';
import { useUnistyles } from 'react-native-unistyles';

export type FileViewTab<T extends string> = {
    value: T;
    label: string;
};

/**
 * The tab bar every file screen shows below the path header. Labels are underlined rather
 * than boxed, so a file opened from the tree and the same file opened from a diff look alike.
 */
export function FileViewTabs<T extends string>({
    tabs,
    value,
    onChange,
    trailing,
}: {
    tabs: FileViewTab<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Actions pinned to the right of the bar, e.g. the preview's fullscreen and zoom. */
    trailing?: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    return (
        <View
            style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                paddingHorizontal: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
            }}
        >
            <View style={{ flexDirection: 'row', flexShrink: 0 }}>
                {tabs.map((tab) => (
                    <Pressable
                        key={tab.value}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: value === tab.value }}
                        onPress={() => onChange(tab.value)}
                        style={{
                            paddingHorizontal: 12,
                            minHeight: 40,
                            justifyContent: 'center',
                            borderBottomWidth: 2,
                            borderBottomColor:
                                value === tab.value
                                    ? theme.colors.textLink
                                    : 'transparent',
                        }}
                    >
                        <Text
                            style={{
                                fontSize: 14,
                                color:
                                    value === tab.value
                                        ? theme.colors.textLink
                                        : theme.colors.textSecondary,
                            }}
                        >
                            {tab.label}
                        </Text>
                    </Pressable>
                ))}
            </View>
            {trailing}
        </View>
    );
}
