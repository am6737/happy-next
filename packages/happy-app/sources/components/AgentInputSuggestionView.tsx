import * as React from 'react';
import { View, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

type SuggestionScope = 'REPO' | 'USER' | 'PLUGIN' | 'SYSTEM';

function getScopeLabel(scope: SuggestionScope): string {
    return scope === 'REPO' ? t('agentInput.suggestion.skillScopeRepo')
        : scope === 'USER' ? t('agentInput.suggestion.skillScopePersonal')
        : scope === 'PLUGIN' ? t('agentInput.suggestion.skillScopePlugin')
        : t('agentInput.suggestion.skillScopeSystem');
}

interface CommandSuggestionProps {
    command: string;
    description?: string;
    scope?: SuggestionScope;
    kind?: 'command' | 'skill';
}

export const CommandSuggestion = React.memo(({ command, description, scope, kind }: CommandSuggestionProps) => {
    return (
        <View style={styles.suggestionContainer}>
            <View style={styles.iconContainer}>
                <Ionicons
                    name={kind === 'skill' ? 'cube-outline' : 'code-slash-outline'}
                    size={16}
                    color={styles.iconColor.color}
                />
            </View>
            <Text 
                style={[styles.commandText, { marginRight: (description || scope) ? 12 : 0 }]}
                numberOfLines={1}
            >
                {command}
            </Text>
            {description ? (
                <Text
                    style={styles.descriptionText}
                    numberOfLines={1}
                >
                    {description}
                </Text>
            ) : scope ? (
                <View style={styles.descriptionSpacer} />
            ) : null}
            {scope && (
                <Text style={styles.labelText}>
                    {getScopeLabel(scope)}
                </Text>
            )}
        </View>
    );
});

interface SkillSuggestionProps {
    name: string;
    description?: string;
    scope: 'REPO' | 'USER' | 'ADMIN' | 'SYSTEM';
    displayName?: string;
    showSkillCategory?: boolean;
}

export const SkillSuggestion = React.memo(({ name, description, scope, displayName, showSkillCategory }: SkillSuggestionProps) => {
    const scopeLabel = getScopeLabel(scope === 'ADMIN' ? 'SYSTEM' : scope);
    const label = showSkillCategory ? t('agentInput.suggestion.skillLabel') : scopeLabel;
    const title = displayName || name;

    return (
        <View style={styles.suggestionContainer}>
            <View style={styles.iconContainer}>
                <Ionicons
                    name="cube-outline"
                    size={16}
                    color={styles.iconColor.color}
                />
            </View>
            <Text
                style={[styles.commandText, { marginRight: description ? 12 : 0 }]}
                numberOfLines={1}
            >
                {title}
            </Text>
            {description ? (
                <Text
                    style={styles.descriptionText}
                    numberOfLines={1}
                >
                    {description}
                </Text>
            ) : (
                <View style={styles.descriptionSpacer} />
            )}
            <Text style={styles.labelText}>
                {label}
            </Text>
        </View>
    );
});

interface FileMentionProps {
    fileName: string;
    filePath: string;
    fileType?: 'file' | 'folder';
}

export const FileMentionSuggestion = React.memo(({ fileName, filePath, fileType = 'file' }: FileMentionProps) => {
    return (
        <View style={styles.suggestionContainer}>
            <View style={styles.iconContainer}>
                <Ionicons
                    name={fileType === 'folder' ? 'folder' : 'document-text'}
                    size={16}
                    color={styles.iconColor.color}
                />
            </View>
            <Text 
                style={styles.fileNameText}
                numberOfLines={1}
            >
                {filePath}{fileName}
            </Text>
            <Text style={styles.labelText}>
                {fileType === 'folder' ? t('agentInput.suggestion.folderLabel') : t('agentInput.suggestion.fileLabel')}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create((theme, runtime) => ({
    suggestionContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        height: 48,
    },
    commandText: {
        flexShrink: 1,
        fontSize: 14,
        color: theme.colors.text,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    descriptionText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    descriptionSpacer: {
        flex: 1,
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: runtime.themeName === 'dark'
            ? theme.colors.surfaceHighest
            : theme.colors.surfaceHigh,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    iconColor: {
        color: theme.colors.textSecondary,
    },
    fileNameText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    labelText: {
        flexShrink: 0,
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginLeft: 8,
        ...Typography.default(),
    },
}));
