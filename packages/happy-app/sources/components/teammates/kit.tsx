import React from 'react';
import { ActivityIndicator, Platform, Pressable, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

/**
 * Building blocks for the Agent create, edit and profile screens: white page, soft grey rounded cards that
 * group related rows, no dividers inside cards, and one solid primary button per screen.
 */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const KIT_PAGE_PADDING = 24;

/** Text input that keeps a bottom sheet above the keyboard on native; the sheet's own input does not work on web. */
export const SheetTextInput = Platform.OS === 'web' ? TextInput : BottomSheetTextInput;

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
    return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({ title, detail }: { title: string; detail?: string }) {
    return (
        <View style={styles.sectionLabel}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {detail && <Text style={styles.sectionTitle}>{detail}</Text>}
        </View>
    );
}

export function FieldError({ message }: { message?: string | null }) {
    if (!message) return null;
    return <Text accessibilityRole="alert" style={styles.error}>{message}</Text>;
}

/** Label on the left, value on the right; tappable rows open an editor. */
export function Row({ label, value, placeholder, onPress, changed = false, error, right, disabled = false }: {
    label: string; value?: string; placeholder?: string; onPress?: () => void; changed?: boolean; error?: string | null;
    right?: React.ReactNode; disabled?: boolean;
}) {
    const { theme } = useUnistyles();
    const body = (
        <>
            <View style={styles.row}>
                <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
                <View style={styles.rowRight}>
                    {right ?? (
                        <Text style={[styles.rowValue, !value && styles.placeholder, changed && styles.changed]} numberOfLines={1}>
                            {value || placeholder}
                        </Text>
                    )}
                    {onPress && !right && <Ionicons name="chevron-forward" size={14} color={theme.colors.textSecondary} style={styles.chevron} />}
                </View>
            </View>
            <FieldError message={error} />
        </>
    );
    if (!onPress) return <View>{body}</View>;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{ text: value }} disabled={disabled} onPress={onPress}
            style={({ pressed }) => [disabled && styles.disabled, pressed && styles.pressed]}>
            {body}
        </Pressable>
    );
}

/** Label on the left, an inline text field on the right. Use `inSheet` inside a bottom sheet. */
export function InputRow({ label, value, onChange, placeholder, prefix, numeric = false, changed = false, error, inSheet = false }: {
    label: string; value: string; onChange: (value: string) => void; placeholder?: string; prefix?: string; numeric?: boolean;
    changed?: boolean; error?: string | null; inSheet?: boolean;
}) {
    const { theme } = useUnistyles();
    const Input = inSheet ? SheetTextInput : TextInput;
    return (
        <View>
            <View style={styles.row}>
                <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
                <View style={[styles.rowRight, styles.inputRight]}>
                    {prefix && <Text style={[styles.rowValue, changed && styles.changed]}>{prefix}</Text>}
                    <Input
                        accessibilityLabel={label}
                        value={value}
                        onChangeText={onChange}
                        placeholder={placeholder}
                        placeholderTextColor={theme.colors.input.placeholder}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType={numeric ? 'numeric' : 'default'}
                        style={[styles.rowValue, styles.input, changed && styles.changed, Platform.OS === 'web' && { outlineStyle: 'none', outline: 'none', outlineWidth: 0 } as any]}
                    />
                </View>
            </View>
            <FieldError message={error} />
        </View>
    );
}

/** Compact − value + control for the right side of a row. */
export function CountStepper({ label, value, onChange, min, max, changed = false }: {
    label: string; value: number; onChange: (value: number) => void; min: number; max: number; changed?: boolean;
}) {
    const { theme } = useUnistyles();
    const button = (delta: number, icon: IconName) => {
        const disabled = delta < 0 ? value <= min : value >= max;
        return (
            <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${delta < 0 ? '−' : '+'}`} accessibilityState={{ disabled }}
                disabled={disabled} hitSlop={6} onPress={() => onChange(value + delta)} style={({ pressed }) => [styles.stepButton, disabled && styles.disabled, pressed && styles.pressed]}>
                <Ionicons name={icon} size={16} color={theme.colors.text} />
            </Pressable>
        );
    };
    return (
        <View style={styles.stepper}>
            {button(-1, 'remove')}
            <Text style={[styles.stepValue, changed && styles.changed]}>{value}</Text>
            {button(1, 'add')}
        </View>
    );
}

export function ToggleRow({ label, value, onChange, changed = false }: { label: string; value: boolean; onChange: (value: boolean) => void; changed?: boolean }) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.row}>
            <Text style={[styles.rowLabel, changed && styles.changed]} numberOfLines={1}>{label}</Text>
            <Switch accessibilityLabel={label} value={value} onValueChange={onChange}
                trackColor={{ true: theme.colors.button.primary.background, false: theme.colors.divider }} />
        </View>
    );
}

/** Single choice from a short list, shown as pills under an optional label. */
export function OptionPills<T extends string | number | null>({ label, options, value, onChange, changed = false, error }: {
    label?: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; changed?: boolean; error?: string | null;
}) {
    return (
        <View style={styles.block}>
            {label && <Text style={[styles.rowLabel, changed && styles.changed]}>{label}</Text>}
            <View accessibilityRole="radiogroup" style={styles.pills}>
                {options.map(option => {
                    const selected = option.value === value;
                    return (
                        <Pressable key={String(option.value)} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={option.label}
                            onPress={() => onChange(option.value)} style={({ pressed }) => [styles.pill, selected && styles.pillSelected, pressed && styles.pressed]}>
                            <Text style={[styles.pillText, selected && styles.pillTextSelected]} numberOfLines={1}>{option.label}</Text>
                        </Pressable>
                    );
                })}
            </View>
            <FieldError message={error} />
        </View>
    );
}

/** A card whose header toggles its body; while collapsed a one-line summary sits under it. */
export function CollapsibleCard({ title, summary, note, expanded, onToggle, children }: {
    title: string; summary?: string; note?: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
    const { theme } = useUnistyles();
    return (
        <View>
            <View style={styles.card}>
                <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded }} onPress={onToggle}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                    <Text style={styles.rowLabel}>{title}</Text>
                    <View style={styles.rowRight}>
                        {note && <Text style={styles.changedNote}>{note}</Text>}
                        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.textSecondary} />
                    </View>
                </Pressable>
                {expanded && children}
            </View>
            {!expanded && summary && <Text style={styles.summary} numberOfLines={2}>{summary}</Text>}
        </View>
    );
}

/** Small grey heading that splits one card into groups. */
export function CardHeading({ title }: { title: string }) {
    return <Text style={styles.cardHeading}>{title}</Text>;
}

export function PillButton({ label, icon, kind = 'primary', onPress, disabled = false, loading = false, grow = false }: {
    label: string; icon?: IconName; kind?: 'primary' | 'secondary' | 'icon'; onPress: () => void; disabled?: boolean; loading?: boolean; grow?: boolean;
}) {
    const { theme } = useUnistyles();
    const tint = kind === 'primary' ? theme.colors.button.primary.tint : theme.colors.text;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }}
            disabled={disabled || loading} onPress={onPress}
            style={({ pressed }) => [styles.button, kind === 'primary' && styles.buttonPrimary, kind === 'icon' && styles.buttonIcon, grow && styles.grow,
                disabled && styles.disabled, pressed && styles.pressed]}>
            {loading ? <ActivityIndicator size="small" color={tint} /> : (
                <>
                    {icon && <Ionicons name={icon} size={kind === 'icon' ? 20 : 17} color={tint} />}
                    {kind !== 'icon' && <Text style={[styles.buttonText, { color: tint }]} numberOfLines={1}>{label}</Text>}
                </>
            )}
        </Pressable>
    );
}

export function StatusDot({ color, size = 6 }: { color: string; size?: number }) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 4,
        backgroundColor: theme.colors.surfaceHigh,
    },
    sectionLabel: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 28,
        marginBottom: 10,
        paddingHorizontal: 4,
    },
    sectionTitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    cardHeading: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 14,
        marginBottom: 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        minHeight: 50,
        paddingVertical: 12,
    },
    rowLabel: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
    },
    rowRight: {
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    rowValue: {
        ...Typography.default(),
        flexShrink: 1,
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'right',
    },
    inputRight: {
        flex: 1,
        justifyContent: 'flex-end',
        gap: 2,
    },
    input: {
        flex: 1,
        minWidth: 60,
        paddingVertical: 0,
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    stepButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    stepValue: {
        ...Typography.default('semiBold'),
        minWidth: 28,
        fontSize: 15,
        textAlign: 'center',
        color: theme.colors.text,
    },
    chevron: {
        opacity: 0.6,
    },
    placeholder: {
        opacity: 0.6,
    },
    changed: {
        color: theme.colors.box.warning.text,
    },
    changedNote: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.box.warning.text,
    },
    summary: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        marginTop: 8,
        paddingHorizontal: 4,
    },
    error: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textDestructive,
        marginTop: -4,
        marginBottom: 10,
    },
    block: {
        gap: 12,
        paddingVertical: 12,
    },
    pills: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    pill: {
        height: 32,
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
    },
    pillSelected: {
        backgroundColor: theme.colors.button.primary.background,
    },
    pillText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    pillTextSelected: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.primary.tint,
    },
    button: {
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 20,
        borderRadius: 22,
        backgroundColor: theme.colors.surfaceHigh,
    },
    buttonPrimary: {
        backgroundColor: theme.colors.button.primary.background,
    },
    buttonIcon: {
        width: 44,
        paddingHorizontal: 0,
    },
    buttonText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
    },
    grow: {
        flex: 1,
    },
    disabled: {
        opacity: 0.4,
    },
    pressed: {
        opacity: 0.7,
    },
}));
