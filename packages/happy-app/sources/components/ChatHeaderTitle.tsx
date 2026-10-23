import * as React from 'react';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export const ChatHeaderTitle = React.memo((props: { title: string; subtitle?: string; width?: number; align?: 'left' | 'center' }) => {
    const { theme } = useUnistyles();
    const isLeft = (props.align ?? 'center') === 'left';
    const hasFixedWidth = props.width !== undefined;
    // Without a fixed width the container is as wide as its text, so a 100% width there would be
    // circular: Android then lays the text out wider than the header leaves it and clips the line,
    // ellipsis included. The text is measured against the room it has instead.
    const textAlignStyle = hasFixedWidth
        ? { width: '100%' as const, textAlign: isLeft ? 'left' as const : 'center' as const }
        : (isLeft ? { textAlign: 'left' as const } : null);
    return (
        <View style={{
            width: props.width,
            alignItems: isLeft ? 'flex-start' : 'center',
            justifyContent: 'center',
            flexGrow: isLeft && !hasFixedWidth ? 1 : 0,
            flexShrink: isLeft || !hasFixedWidth ? 1 : 0,
            minWidth: 0,
        }}>
            <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{
                    fontSize: 17,
                    // Android pads text above and below for the font's ascent; the title and
                    // subtitle drop it, so the two lines stand as close as on iOS.
                    includeFontPadding: false,
                    color: theme.colors.header.tint,
                    ...textAlignStyle,
                    ...Typography.default('semiBold'),
                }}
            >
                {props.title}
            </Text>
            {props.subtitle ? (
                <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                        fontSize: 12,
                        lineHeight: 14,
                        includeFontPadding: false,
                        opacity: 0.7,
                        color: theme.colors.header.tint,
                        ...textAlignStyle,
                        ...Typography.default(),
                    }}
                >
                    {props.subtitle}
                </Text>
            ) : null}
        </View>
    );
});
