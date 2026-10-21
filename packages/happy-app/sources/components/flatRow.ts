import type { TextStyle, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

// An Item laid flat on the background: 64 tall with a 40 avatar 12 from its text, a little lower
// than the session list's standard rows since it carries less; the row itself is inset and rounded
// by its list.
export const FLAT_ROW_AVATAR_SIZE = 40;

export const flatRowItemStyle: ViewStyle = {
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 8,
};

export const flatRowIconContainerStyle: ViewStyle = {
    width: FLAT_ROW_AVATAR_SIZE,
    height: FLAT_ROW_AVATAR_SIZE,
    marginRight: 12,
};

// Its text as large and as dark as a session row's: a 16 medium title over a 13 line.
const styles = StyleSheet.create((theme) => ({
    title: {
        ...Typography.default('medium'),
        fontSize: 16,
        lineHeight: 22,
        letterSpacing: 0,
        color: theme.colors.sessionList.text,
    },
}));

export const flatRowTitleStyle = styles.title;

export const flatRowSubtitleStyle: TextStyle = {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    marginTop: 2,
};
