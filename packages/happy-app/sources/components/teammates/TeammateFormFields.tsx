import React from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const AVATAR_COLORS = ['#5B6EF5', '#8B5CF6', '#EC4899', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#0EA5E9', '#64748B'];

export function FormSection({ icon, title, hint, expanded, onToggle, children }: {
    icon: IconName; title: string; hint: string; expanded?: boolean; onToggle?: () => void; children: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    const open = expanded ?? true;
    const header = (
        <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}><Ionicons name={icon} size={18} color={theme.colors.textLink} /></View>
            <View style={styles.sectionTitles}>
                <Text style={styles.sectionTitle}>{title}</Text>
                <Text style={styles.sectionHint}>{hint}</Text>
            </View>
            {onToggle && <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.textSecondary} />}
        </View>
    );
    return (
        <View style={styles.section}>
            {onToggle ? (
                <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={onToggle}>
                    {header}
                </Pressable>
            ) : header}
            {open && <View style={styles.sectionBody}>{children}</View>}
        </View>
    );
}

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

export function TextField({ label, hideLabel = false, value, onChange, placeholder, hint, error, prefix, multiline = false, tall = false, editable = true, numeric = false, onSubmit }: {
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

export function Stepper({ label, value, onChange, min, max, hint, error }: {
    label: string; value: string; onChange: (value: string) => void; min: number; max: number; hint?: string; error?: string;
}) {
    const { theme } = useUnistyles();
    const current = Number(value) || min;
    const step = (delta: number) => onChange(String(Math.min(max, Math.max(min, current + delta))));
    return (
        <FieldShell label={label} hint={hint} error={error}>
            <View style={styles.stepper}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${label} −`}
                    accessibilityState={{ disabled: current <= min }}
                    disabled={current <= min}
                    onPress={() => step(-1)}
                    style={[styles.iconButton, current <= min && styles.disabled]}
                >
                    <Ionicons name="remove" size={18} color={theme.colors.text} />
                </Pressable>
                <Text style={styles.stepperValue}>{value}</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${label} +`}
                    accessibilityState={{ disabled: current >= max }}
                    disabled={current >= max}
                    onPress={() => step(1)}
                    style={[styles.iconButton, current >= max && styles.disabled]}
                >
                    <Ionicons name="add" size={18} color={theme.colors.text} />
                </Pressable>
            </View>
        </FieldShell>
    );
}

/** Selectable pill used for suggested answers and examples. */
export function ChoiceChip({ label, selected = false, icon, onPress, disabled = false }: {
    label: string; selected?: boolean; icon?: IconName; onPress: () => void; disabled?: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, (pressed || disabled) && styles.disabled]}
        >
            {icon && <Ionicons name={icon} size={14} color={selected ? theme.colors.textLink : theme.colors.textSecondary} />}
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
        </Pressable>
    );
}

/** Sticky bottom bar for wizard actions, padded for the home indicator. */
export function FooterBar({ error, children }: { error?: string | null; children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.footerInner}>
                {error && <Text accessibilityRole="alert" style={styles.footerError}>{error}</Text>}
                <View style={styles.footerActions}>{children}</View>
            </View>
        </View>
    );
}

export function ActionButton({ label, onPress, kind = 'primary', disabled = false, loading = false, grow = true }: {
    label: string; onPress: () => void; kind?: 'primary' | 'secondary'; disabled?: boolean; loading?: boolean; grow?: boolean;
}) {
    const { theme } = useUnistyles();
    const primary = kind === 'primary';
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: disabled || loading }}
            disabled={disabled || loading}
            onPress={onPress}
            style={({ pressed }) => [
                styles.action,
                primary ? styles.actionPrimary : styles.actionSecondary,
                grow && styles.actionGrow,
                disabled && styles.actionDisabled,
                pressed && styles.actionPressed,
            ]}
        >
            {loading
                ? <ActivityIndicator color={primary ? theme.colors.button.primary.tint : theme.colors.text} />
                : <Text style={[styles.actionText, primary ? styles.actionTextPrimary : styles.actionTextSecondary]}>{label}</Text>}
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    choice: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    choiceSelected: {
        borderColor: theme.colors.textLink,
        backgroundColor: theme.colors.surfaceHighest,
    },
    choiceText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
    },
    choiceTextSelected: {
        ...Typography.default('semiBold'),
        color: theme.colors.textLink,
    },
    footer: {
        paddingTop: 12,
        paddingHorizontal: 16,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    footerInner: {
        width: '100%',
        maxWidth: 688,
        alignSelf: 'center',
        gap: 8,
    },
    footerError: {
        ...Typography.default(),
        fontSize: 13,
        textAlign: 'center',
        color: theme.colors.textDestructive,
    },
    footerActions: {
        flexDirection: 'row',
        gap: 10,
    },
    action: {
        minHeight: 48,
        paddingHorizontal: 20,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionGrow: {
        flex: 1,
    },
    actionPrimary: {
        backgroundColor: theme.colors.button.primary.background,
    },
    actionSecondary: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    actionDisabled: {
        opacity: 0.45,
    },
    actionPressed: {
        opacity: 0.85,
    },
    actionText: {
        ...Typography.default('semiBold'),
        fontSize: 16,
    },
    actionTextPrimary: {
        color: theme.colors.button.primary.tint,
    },
    actionTextSecondary: {
        color: theme.colors.text,
    },
    section: {
        padding: 18,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    sectionIcon: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    sectionTitles: {
        flex: 1,
        gap: 1,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        color: theme.colors.text,
    },
    sectionHint: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    sectionBody: {
        gap: 18,
        marginTop: 18,
    },
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
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    stepperValue: {
        ...Typography.default('semiBold'),
        minWidth: 28,
        fontSize: 18,
        textAlign: 'center',
        color: theme.colors.text,
    },
}));
