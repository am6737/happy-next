import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { TeammateSkillInfo } from 'happy-wire';
import type { MachineSkillsState } from '@/hooks/useMachineSkills';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { FieldShell } from './TeammateFormFields';

/**
 * Picks real Skills installed on the Agent's machine. Names that were saved earlier but are not installed
 * stay visible (flagged) so they can be removed. When the machine cannot be reached the saved names are
 * shown read-only; there is no error state.
 */
export function SkillPicker({ state, value, onChange, hint, error }: {
    state: MachineSkillsState; value: string[]; onChange: (value: string[]) => void; hint?: string; error?: string;
}) {
    const { theme } = useUnistyles();
    const [query, setQuery] = React.useState('');
    const editable = state.status === 'ready';
    const installed = React.useMemo(() => new Map(state.skills.map(skill => [skill.name, skill])), [state.skills]);
    const selected = new Set(value);
    // Only a loaded list can say a name is not installed; offline, every saved name is shown as-is.
    const missing = editable ? value.filter(name => !installed.has(name)) : [];
    const needle = query.trim().toLowerCase();
    const candidates = state.skills.filter(skill => !needle || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle));
    const toggle = (name: string) => onChange(selected.has(name) ? value.filter(item => item !== name) : [...value, name]);

    const row = (skill: TeammateSkillInfo) => {
        const on = selected.has(skill.name);
        return (
            <Pressable
                key={skill.name}
                accessibilityRole="checkbox"
                accessibilityLabel={skill.name}
                accessibilityState={{ checked: on }}
                onPress={() => toggle(skill.name)}
                style={[styles.row, on && styles.rowSelected]}
            >
                <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>{skill.name}</Text>
                    {!!skill.description && <Text style={styles.description} numberOfLines={2}>{skill.description}</Text>}
                </View>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? theme.colors.textLink : theme.colors.divider} />
            </Pressable>
        );
    };

    return (
        <FieldShell label={t('teammates.skills')} hint={hint} error={error}>
            {editable && state.skills.length > 6 && (
                <TextInput
                    accessibilityLabel={t('teammates.skillSearch')}
                    placeholder={t('teammates.skillSearch')}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={query}
                    onChangeText={setQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.search}
                />
            )}
            {state.status === 'loading' && <Text style={styles.note}>{t('common.loading')}</Text>}
            {state.status === 'unavailable' && <Text style={styles.note}>{t('teammates.skillOffline')}</Text>}
            {editable && !state.skills.length && <Text style={styles.note}>{t('teammates.skillNone')}</Text>}

            <View style={styles.list}>
                {missing.map(name => (
                    <Pressable
                        key={`missing:${name}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${name}, ${t('teammates.skillMissing')}`}
                        onPress={() => toggle(name)}
                        style={[styles.row, styles.rowMissing]}
                    >
                        <View style={styles.rowText}>
                            <Text style={styles.name} numberOfLines={1}>{name}</Text>
                            <Text style={styles.missing}>{t('teammates.skillMissing')}</Text>
                        </View>
                        <Ionicons name="close-circle-outline" size={22} color={theme.colors.textSecondary} />
                    </Pressable>
                ))}
                {editable
                    ? candidates.map(row)
                    : value.map(name => (
                        <View key={name} style={styles.row}>
                            <View style={styles.rowText}><Text style={styles.name} numberOfLines={1}>{name}</Text></View>
                        </View>
                    ))}
            </View>
        </FieldShell>
    );
}

const styles = StyleSheet.create((theme) => ({
    list: { gap: 8 },
    search: {
        ...Typography.default(),
        fontSize: 15,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        color: theme.colors.text,
        backgroundColor: theme.colors.surfaceHighest,
    },
    note: { ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    rowSelected: { borderColor: theme.colors.textLink },
    rowMissing: { borderColor: theme.colors.warningCritical },
    rowText: { flex: 1, gap: 2 },
    name: { ...Typography.default('semiBold'), fontSize: 15, color: theme.colors.text },
    description: { ...Typography.default(), fontSize: 13, color: theme.colors.textSecondary },
    missing: { ...Typography.default(), fontSize: 12, color: theme.colors.warningCritical },
}));
