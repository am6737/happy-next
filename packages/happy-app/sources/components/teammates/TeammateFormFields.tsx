import React from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export const AVATAR_COLORS = ['#5B6EF5', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#64748B'];

export function FieldShell({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: React.ReactNode }) {
    return (
        <View style={styles.field}>
            {label && <Text style={styles.label}>{label}</Text>}
            {children}
            {hint && !error && <Text style={styles.hint}>{hint}</Text>}
            {error && <Text style={styles.error}>{error}</Text>}
        </View>
    );
}

function TextField({ label, hideLabel = false, value, onChange, placeholder, hint, error, prefix, multiline = false, tall = false, editable = true, numeric = false, onSubmit }: {
    label: string; hideLabel?: boolean; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; error?: string;
    prefix?: string; multiline?: boolean; tall?: boolean; editable?: boolean; numeric?: boolean; onSubmit?: () => void;
}) {
    const { theme } = useUnistyles();
    const [focused, setFocused] = React.useState(false);
    return (
        <FieldShell label={hideLabel ? undefined : label} hint={hint} error={error}>
            <View style={[styles.inputBox, focused && styles.inputFocused, !!error && styles.inputError, !editable && styles.inputDisabled]}>
                {prefix && <Text style={styles.affix}>{prefix}</Text>}
                <TextInput
                    accessibilityLabel={label}
                    value={value}
                    onChangeText={onChange}
                    onSubmitEditing={onSubmit}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={placeholder}
                    placeholderTextColor={theme.colors.input.placeholder}
                    editable={editable}
                    multiline={multiline}
                    autoCapitalize="none"
                    keyboardType={numeric ? 'numeric' : 'default'}
                    style={[styles.input, multiline && styles.inputMultiline, tall && styles.inputTall]}
                />
            </View>
        </FieldShell>
    );
}

export function SwitchRow({ title, hint, value, onChange }: { title: string; hint?: string; value: boolean; onChange: (value: boolean) => void }) {
    return (
        <View style={styles.switchRow}>
            <View style={styles.switchText}>
                <Text style={styles.switchTitle}>{title}</Text>
                {hint && <Text style={styles.hint}>{hint}</Text>}
            </View>
            <Switch accessibilityLabel={title} value={value} onValueChange={onChange} />
        </View>
    );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const { theme } = useUnistyles();
    const [custom, setCustom] = React.useState(!AVATAR_COLORS.includes(value.toUpperCase()));
    return (
        <FieldShell label={t('teammates.color')}>
            <View style={styles.wrap}>
                {AVATAR_COLORS.map(color => {
                    const selected = !custom && color === value.toUpperCase();
                    return (
                        <Pressable
                            key={color}
                            accessibilityRole="button"
                            accessibilityLabel={color}
                            accessibilityState={{ selected }}
                            onPress={() => { setCustom(false); onChange(color); }}
                            style={[styles.swatchRing, selected && { borderColor: theme.colors.text }]}
                        >
                            <View style={[styles.swatch, { backgroundColor: color }]}>
                                {selected && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                            </View>
                        </Pressable>
                    );
                })}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('teammates.customColor')}
                    accessibilityState={{ selected: custom }}
                    onPress={() => setCustom(true)}
                    style={[styles.swatchRing, custom && { borderColor: theme.colors.text }]}
                >
                    <View style={[styles.swatch, styles.swatchCustom]}>
                        <Ionicons name="color-palette-outline" size={16} color={theme.colors.textSecondary} />
                    </View>
                </Pressable>
            </View>
            {custom && <TextField label={t('teammates.customColor')} hideLabel prefix="#" value={value.replace(/^#/, '')} onChange={next => onChange(`#${next.replace(/^#/, '')}`)} hint={t('teammates.colorHint')} />}
        </FieldShell>
    );
}

export function TagInput({ label, placeholder, values, onChange, suggestions = [], hint, error }: {
    label: string; placeholder: string; values: string[]; onChange: (values: string[]) => void; suggestions?: string[]; hint?: string; error?: string;
}) {
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState('');
    const add = (value: string) => {
        onChange([...new Set([...values, ...value.split(',').map(s => s.trim()).filter(Boolean)])]);
        setDraft('');
    };
    const remaining = suggestions.filter(value => !values.includes(value)).slice(0, 8);
    return (
        <FieldShell label={label} hint={hint} error={error}>
            {values.length > 0 && (
                <View style={styles.wrap}>
                    {values.map(value => (
                        <Pressable
                            key={value}
                            accessibilityRole="button"
                            accessibilityLabel={`${t('common.remove')} ${value}`}
                            onPress={() => onChange(values.filter(item => item !== value))}
                            style={styles.tag}
                        >
                            <Text style={styles.tagText}>{value}</Text>
                            <Ionicons name="close" size={14} color={theme.colors.textSecondary} />
                        </Pressable>
                    ))}
                </View>
            )}
            <View style={styles.tagInputRow}>
                <View style={styles.tagInputField}>
                    <TextField label={label} hideLabel value={draft} onChange={setDraft} placeholder={placeholder} onSubmit={() => add(draft)} />
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('teammates.addChip')}
                    accessibilityState={{ disabled: !draft.trim() }}
                    disabled={!draft.trim()}
                    onPress={() => add(draft)}
                    style={[styles.iconButton, !draft.trim() && styles.disabled]}
                >
                    <Ionicons name="add" size={20} color={theme.colors.text} />
                </Pressable>
            </View>
            {remaining.length > 0 && (
                <View style={styles.wrap}>
                    {remaining.map(value => (
                        <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${t('teammates.addChip')} ${value}`} onPress={() => add(value)} style={styles.suggestion}>
                            <Ionicons name="add" size={13} color={theme.colors.textSecondary} />
                            <Text style={styles.suggestionText}>{value}</Text>
                        </Pressable>
                    ))}
                </View>
            )}
        </FieldShell>
    );
}

export function Segmented<T extends string>({ label, options, value, onChange }: {
    label: string; options: Array<{ id: T; label: string }>; value: T; onChange: (value: T) => void;
}) {
    return (
        <FieldShell label={label}>
            <View style={styles.segmentTrack}>
                {options.map(option => {
                    const selected = option.id === value;
                    return (
                        <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityLabel={option.label}
                            accessibilityState={{ selected }}
                            onPress={() => onChange(option.id)}
                            style={[styles.segment, selected && styles.segmentSelected]}
                        >
                            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]} numberOfLines={1}>{option.label}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </FieldShell>
    );
}

export function PillGroup<T extends string>({ label, options, value, onChange }: {
    label: string; options: Array<{ id: T; label: string }>; value: T; onChange: (value: T) => void;
}) {
    return (
        <FieldShell label={label}>
            <View style={styles.wrap}>
                {options.map(option => {
                    const selected = option.id === value;
                    return (
                        <Pressable
                            key={option.id}
                            accessibilityRole="button"
                            accessibilityLabel={option.label}
                            accessibilityState={{ selected }}
                            onPress={() => onChange(option.id)}
                            style={[styles.pill, selected && styles.pillSelected]}
                        >
                            <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{option.label}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </FieldShell>
    );
}

export function MachinePicker({ machines, value, onChange, error, label }: {
    machines: Machine[]; value: string; onChange: (id: string) => void; error?: string; label?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <FieldShell label={label ?? t('teammates.machine')} hint={machines.length ? undefined : t('sessionScope.noMachinesHint')} error={error}>
            <View style={styles.machineList}>
                {machines.map(machine => {
                    const selected = machine.id === value;
                    const online = isMachineOnline(machine);
                    const name = machine.metadata?.displayName || machine.metadata?.host || machine.id;
                    return (
                        <Pressable
                            key={machine.id}
                            accessibilityRole="radio"
                            accessibilityLabel={name}
                            accessibilityState={{ selected }}
                            onPress={() => onChange(machine.id)}
                            style={[styles.machineRow, selected && styles.machineRowSelected]}
                        >
                            <View style={styles.machineIcon}>
                                <Ionicons name="desktop-outline" size={18} color={theme.colors.textSecondary} />
                            </View>
                            <View style={styles.machineText}>
                                <Text style={styles.machineName} numberOfLines={1}>{name}</Text>
                                <View style={styles.machineStatus}>
                                    <View style={[styles.dot, { backgroundColor: online ? theme.colors.status.connected : theme.colors.textSecondary }]} />
                                    <Text style={styles.hint}>{t(online ? 'teammates.online' : 'teammates.offline')}</Text>
                                </View>
                            </View>
                            <Ionicons
                                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                                size={22}
                                color={selected ? theme.colors.textLink : theme.colors.divider}
                            />
                        </Pressable>
                    );
                })}
            </View>
        </FieldShell>
    );
}

const styles = StyleSheet.create((theme) => ({
    field: {
        gap: 7,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    hint: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.textSecondary,
    },
    error: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textDestructive,
    },
    inputBox: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: theme.colors.input.background,
    },
    inputFocused: {
        borderColor: theme.colors.textLink,
    },
    inputError: {
        borderColor: theme.colors.textDestructive,
    },
    inputDisabled: {
        opacity: 0.6,
    },
    affix: {
        ...Typography.default('semiBold'),
        marginRight: 4,
        fontSize: 15,
        color: theme.colors.textSecondary,
    },
    input: {
        ...Typography.default(),
        flex: 1,
        paddingVertical: 10,
        fontSize: 15,
        color: theme.colors.input.text,
    },
    inputMultiline: {
        minHeight: 140,
        textAlignVertical: 'top',
    },
    inputTall: {
        minHeight: 320,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    switchText: {
        flex: 1,
        gap: 2,
    },
    switchTitle: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    wrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    swatchRing: {
        padding: 2,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    swatch: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    swatchCustom: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingLeft: 10,
        paddingRight: 8,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
    },
    tagText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
    },
    tagInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tagInputField: {
        flex: 1,
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    disabled: {
        opacity: 0.4,
    },
    suggestion: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.divider,
    },
    suggestionText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    segmentTrack: {
        flexDirection: 'row',
        padding: 3,
        borderRadius: 11,
        backgroundColor: theme.colors.surfaceHighest,
    },
    segment: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 6,
        borderRadius: 8,
    },
    segmentSelected: {
        backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
    },
    segmentText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    segmentTextSelected: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
    },
    pill: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    pillSelected: {
        borderColor: theme.colors.button.primary.background,
        backgroundColor: theme.colors.button.primary.background,
    },
    pillText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    pillTextSelected: {
        color: theme.colors.button.primary.tint,
    },
    machineList: {
        gap: 8,
    },
    machineRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    machineRowSelected: {
        borderColor: theme.colors.textLink,
    },
    machineIcon: {
        width: 34,
        height: 34,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    machineText: {
        flex: 1,
        gap: 2,
    },
    machineName: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        color: theme.colors.text,
    },
    machineStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
}));
