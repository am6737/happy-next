import * as React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetView, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { CRON_PRESETS, describeCron } from '@/data/mockRepos';

interface ScheduleCronSheetProps {
    scheduleCron: string | null;
    onChange: (cron: string | null) => void;
}

type SelectedType = 'preset' | 'disabled' | 'custom';

export const ScheduleCronSheet = React.memo(React.forwardRef<BottomSheetModal, ScheduleCronSheetProps>(
    ({ scheduleCron, onChange }, ref) => {
        const { theme } = useUnistyles();
        const innerRef = React.useRef<BottomSheetModal>(null);

        // Determine initial selection type based on current value
        const getInitialType = (): SelectedType => {
            if (!scheduleCron) return 'disabled';
            const isPreset = CRON_PRESETS.some((p) => p.value === scheduleCron);
            return isPreset ? 'preset' : 'custom';
        };

        const [selectedType, setSelectedType] = React.useState<SelectedType>(getInitialType);
        const [customValue, setCustomValue] = React.useState(scheduleCron ?? '');

        // Sync state when sheet opens
        React.useImperativeHandle(ref, () => {
            const modal = innerRef.current!;
            return new Proxy(modal, {
                get(target, prop, receiver) {
                    if (prop === 'present') {
                        return (...args: any[]) => {
                            // Reset state on open
                            setSelectedType(getInitialType());
                            setCustomValue(scheduleCron ?? '');
                            return target.present(...args);
                        };
                    }
                    return Reflect.get(target, prop, receiver);
                },
            });
        }, [scheduleCron]);

        const handlePresetSelect = React.useCallback((value: string) => {
            onChange(value);
            innerRef.current?.dismiss();
        }, [onChange]);

        const handleDisable = React.useCallback(() => {
            setSelectedType('disabled');
            onChange(null);
            innerRef.current?.dismiss();
        }, [onChange]);

        const handleCustomModeSelect = React.useCallback(() => {
            setSelectedType('custom');
        }, []);

        const handleCustomSave = React.useCallback(() => {
            onChange(customValue.trim() || null);
            innerRef.current?.dismiss();
        }, [customValue, onChange]);

        const handleCustomChange = React.useCallback((text: string) => {
            setCustomValue(text);
        }, []);

        const renderBackdrop = React.useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    appearsOnIndex={0}
                    disappearsOnIndex={-1}
                    pressBehavior="close"
                />
            ),
            [],
        );

        const displayDescription = selectedType === 'custom' && customValue
            ? describeCron(customValue)
            : selectedType === 'preset' && scheduleCron && CRON_PRESETS.find((p) => p.value === scheduleCron)
                ? describeCron(scheduleCron)
                : null;

        const isPresetSelected = selectedType === 'preset';
        const isDisabledSelected = selectedType === 'disabled';
        const isCustomSelected = selectedType === 'custom';

        return (
            <BottomSheetModal
                ref={innerRef}
                snapPoints={['70%']}
                enableDynamicSizing={false}
                backdropComponent={renderBackdrop}
                backgroundStyle={{ backgroundColor: theme.colors.surface }}
                handleIndicatorStyle={{ backgroundColor: theme.colors.textSecondary }}
            >
                <BottomSheetView style={styles.container}>
                    {/* Header */}
                    <View style={[styles.header, { borderColor: theme.colors.divider }]}>
                        <Text style={[styles.title, { color: theme.colors.text }]}>
                            {t('repoSettings.selectSchedule')}
                        </Text>
                    </View>

                    <BottomSheetScrollView contentContainerStyle={styles.content}>
                        {/* Preset options */}
                        <View style={styles.section}>
                            {CRON_PRESETS.map((preset) => {
                                const isSelected = isPresetSelected && scheduleCron === preset.value;
                                return (
                                    <Pressable
                                        key={preset.value}
                                        style={[styles.optionItem, { borderColor: theme.colors.divider }]}
                                        onPress={() => handlePresetSelect(preset.value)}
                                    >
                                        <View style={styles.optionLeft}>
                                            <Ionicons
                                                name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                                                size={22}
                                                color={isSelected ? theme.colors.button.primary.background : theme.colors.textSecondary}
                                            />
                                            <Text
                                                style={[
                                                    styles.optionLabel,
                                                    { color: theme.colors.text },
                                                    isSelected && { fontWeight: '600' },
                                                ]}
                                            >
                                                {preset.label}
                                            </Text>
                                        </View>
                                        <Text style={[styles.optionValue, { color: theme.colors.textSecondary }]}>
                                            {preset.value}
                                        </Text>
                                    </Pressable>
                                );
                            })}

                            {/* Disabled option */}
                            <Pressable
                                style={[styles.optionItem, { borderColor: theme.colors.divider }]}
                                onPress={handleDisable}
                            >
                                <View style={styles.optionLeft}>
                                    <Ionicons
                                        name={isDisabledSelected ? 'radio-button-on' : 'radio-button-off'}
                                        size={22}
                                        color={isDisabledSelected ? theme.colors.button.primary.background : theme.colors.textSecondary}
                                    />
                                    <Text
                                        style={[
                                            styles.optionLabel,
                                            { color: theme.colors.text },
                                            isDisabledSelected && { fontWeight: '600' },
                                        ]}
                                    >
                                        {t('repoSettings.disabled')}
                                    </Text>
                                </View>
                            </Pressable>
                        </View>

                        {/* Divider */}
                        <View style={[styles.divider, { backgroundColor: theme.colors.divider }]} />

                        {/* Custom input section */}
                        <View style={styles.section}>
                            <View style={styles.customHeader}>
                                <Pressable
                                    style={styles.customLabel}
                                    onPress={handleCustomModeSelect}
                                >
                                    <Ionicons
                                        name={isCustomSelected ? 'radio-button-on' : 'radio-button-off'}
                                        size={22}
                                        color={isCustomSelected ? theme.colors.button.primary.background : theme.colors.textSecondary}
                                    />
                                    <Text
                                        style={[
                                            styles.optionLabel,
                                            { color: theme.colors.text },
                                            isCustomSelected && { fontWeight: '600' },
                                        ]}
                                    >
                                        {t('repoSettings.custom')}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={handleCustomSave}
                                    hitSlop={8}
                                    style={[styles.saveButton, { backgroundColor: theme.colors.button.primary.background }]}
                                >
                                    <Text style={styles.saveButtonText}>{t('common.save')}</Text>
                                </Pressable>
                            </View>

                            {/* Custom cron input */}
                            <View style={[styles.customInputContainer, { backgroundColor: theme.colors.groupped.background, borderColor: theme.colors.divider }]}>
                                <TextInput
                                    style={[styles.customInput, { color: theme.colors.text }]}
                                    value={customValue}
                                    onChangeText={handleCustomChange}
                                    placeholder="0 * * * *"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    onFocus={handleCustomModeSelect}
                                />
                                {displayDescription && (
                                    <Text style={[styles.customDescription, { color: theme.colors.textSecondary }]}>
                                        {displayDescription}
                                    </Text>
                                )}
                            </View>
                        </View>

                        {/* Help text */}
                        <View style={styles.helpSection}>
                            <Text style={[styles.helpText, { color: theme.colors.textSecondary }]}>
                                {t('repoSettings.customCronHelp')}
                            </Text>
                        </View>
                    </BottomSheetScrollView>
                </BottomSheetView>
            </BottomSheetModal>
        );
    }
));

// ---- Styles ----

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
    },
    content: {
        paddingVertical: 8,
    },
    section: {
        paddingHorizontal: 16,
    },
    optionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 0,
    },
    optionLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    optionLabel: {
        fontSize: 16,
    },
    optionValue: {
        fontSize: 12,
        fontFamily: 'Menlo',
    },
    divider: {
        height: 1,
        marginVertical: 12,
        marginHorizontal: 16,
    },
    customHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 4,
    },
    customLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    saveButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    customInputContainer: {
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
    },
    customInput: {
        fontSize: 15,
        fontFamily: 'Menlo',
        padding: 0,
    },
    customDescription: {
        fontSize: 13,
        marginTop: 6,
    },
    helpSection: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    helpText: {
        fontSize: 12,
        lineHeight: 16,
    },
});
