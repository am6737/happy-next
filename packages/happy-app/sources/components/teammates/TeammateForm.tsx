import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { TEAMMATE_CONTEXT_BUDGET_DEFAULT, TEAMMATE_CONTEXT_BUDGET_MIN, TEAMMATE_CONTEXT_BUDGET_MAX, TEAMMATE_CONTROLLER_PROVIDERS, TEAMMATE_WORKER_PROVIDERS, type Teammate } from 'happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { useAllMachines } from '@/sync/storage';
import type { TeammateSeed } from '@/sync/teammateDraft';
import {
    ALL_DAYS, TEAMMATE_HEARTBEAT_PRESETS, isAdvancedSection, teammateFormSection,
    type TeammateFormError, type TeammateFormField, type TeammateFormSection, type TeammateRuntimeValue,
} from '@/sync/teammateFormModel';
import { useTeammateFormState } from '@/hooks/useTeammateFormState';
import { useMachineSkills } from '@/hooks/useMachineSkills';
import { getCachedGithubRepos } from '@/hooks/useGithubData';
import { isMachineOnline } from '@/utils/machineUtils';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { Typography } from '@/constants/Typography';
import { getCurrentLanguage, t } from '@/text';
import { TeammateAvatar } from './ui';
import { SkillPicker } from './SkillPicker';
import { TeammateRuntimeFields } from './TeammateRuntimeFields';
import { ColorPicker, MachinePicker, TagInput } from './TeammateFormFields';
import { TeammateSheet, SheetTextInput, useTeammateSheet } from './TeammateSheet';
import {
    Card, CardHeading, CollapsibleCard, CountStepper, FieldError, InputRow, KIT_PAGE_PADDING, OptionPills, PillButton, Row, SectionLabel, ToggleRow,
} from './kit';

export type TeammateFormFocus = 'runtime' | 'schedule';

// Monday first; 0 is Sunday.
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const CUSTOM = 'custom';

function isHeartbeatPreset(minutes: number | null): boolean {
    return (TEAMMATE_HEARTBEAT_PRESETS as readonly (number | null)[]).includes(minutes);
}

function dayName(day: number): string {
    // 2024-01-07 was a Sunday.
    return new Intl.DateTimeFormat(getCurrentLanguage(), { weekday: 'short' }).format(new Date(2024, 0, 7 + day));
}

function heartbeatLabel(minutes: number | null): string {
    if (minutes === null) return t('teammates.form.off');
    if (minutes === 60) return t('teammates.form.hourly');
    if (minutes % 60 === 0) return t('teammates.form.everyHours', { count: minutes / 60 });
    return t('teammates.form.everyMinutes', { count: minutes });
}

function providerName(provider: TeammateRuntimeValue['provider']): string {
    return t(`agentInput.agent.${provider}`);
}

function runtimeLabel({ provider, model }: TeammateRuntimeValue): string {
    return model ? `${providerName(provider)}  ${model}` : providerName(provider);
}

function errorText(field: TeammateFormField, error: TeammateFormError | undefined): string | undefined {
    switch (error) {
        case undefined: return undefined;
        case 'required': return t('teammates.form.required');
        case 'taken': return t('teammates.errors.name_taken');
        case 'timezone': return t('teammates.timezoneHint');
        case 'hours': return t('teammates.hoursHint');
        case 'days': return t('teammates.form.pickDay');
        case 'invalid':
            if (field === 'contextBudgetTokens') return t('teammates.form.contextBudgetRange', {
                min: new Intl.NumberFormat(getCurrentLanguage()).format(TEAMMATE_CONTEXT_BUDGET_MIN),
                max: new Intl.NumberFormat(getCurrentLanguage()).format(TEAMMATE_CONTEXT_BUDGET_MAX),
            });
            if (field === 'monthlyBudgetUsd') return t('teammates.budgetHint');
            if (field === 'heartbeatIntervalMin') return t('teammates.form.heartbeatRange');
            if (field === 'dreamingHour') return t('teammates.form.dreamingRange');
            if (field === 'name') return t('teammates.nameHint');
            return t('teammates.invalidValue');
    }
}

/**
 * One-page form for creating (from an AI draft or blank) and editing an Agent. Basic info and instructions are
 * always visible; runtime, schedule and budget sit in a collapsed "advanced" card that opens on `focus` or when
 * one of its fields fails validation. Larger editors open in bottom sheets. Editing shows Discard/Save only once
 * something changed and asks before leaving with unsaved changes.
 */
export function TeammateForm({ teammate, seed, focus }: { teammate?: Teammate; seed?: TeammateSeed; focus?: TeammateFormFocus }) {
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const { theme } = useUnistyles();
    const { credentials } = useAuth();
    const machines = useAllMachines();
    const form = useTeammateFormState({ teammate, seed });
    const { values, set, errors } = form;
    const editing = !!teammate;
    const changed = React.useMemo(() => new Set(editing ? form.changed : []), [editing, form.changed]);
    const dirty = form.changed.length > 0;
    const machineSkills = useMachineSkills(values.machineId);
    const missingSkills = machineSkills.status === 'ready' ? values.skills.filter(skill => !machineSkills.skills.some(item => item.name === skill)).length : 0;
    const repoSuggestions = credentials ? getCachedGithubRepos(credentials).map(repo => repo.fullName) : [];
    const [advanced, setAdvanced] = React.useState(!!focus);
    const [customHeartbeat, setCustomHeartbeat] = React.useState(() => !isHeartbeatPreset(values.heartbeatIntervalMin));
    const scroll = React.useRef<ScrollView>(null);
    const sectionY = React.useRef<Partial<Record<TeammateFormSection, number>>>({});
    const focused = React.useRef(false);
    const allowExit = React.useRef(false);
    const sheets = {
        color: useTeammateSheet(), machine: useTeammateSheet(), library: useTeammateSheet(), instructions: useTeammateSheet(),
        controller: useTeammateSheet(), worker: useTeammateSheet(), hours: useTeammateSheet(),
    };

    // A new Agent defaults to the first online machine without counting as a change.
    const { setDefault } = form;
    React.useEffect(() => {
        if (!editing && !values.machineId && machines.length) setDefault('machineId', (machines.find(isMachineOnline) ?? machines[0]).id);
    }, [editing, machines, values.machineId, setDefault]);

    React.useEffect(() => navigation.addListener('beforeRemove', event => {
        if (allowExit.current || !dirty) return;
        event.preventDefault();
        Modal.confirm(t('artifacts.discardChanges'), t('artifacts.discardChangesDescription'), { confirmText: t('common.discard'), destructive: true })
            .then(confirmed => {
                if (!confirmed) return;
                allowExit.current = true;
                navigation.dispatch(event.data.action);
            });
    }), [navigation, dirty]);

    const scrollTo = (section: TeammateFormSection) => {
        // Wait a frame so a just-expanded card has been laid out.
        setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, (sectionY.current[section] ?? 0) - 16), animated: true }), 50);
    };
    const onSectionLayout = (section: TeammateFormSection) => (event: { nativeEvent: { layout: { y: number } } }) => {
        sectionY.current[section] = event.nativeEvent.layout.y;
        if (section === 'runtime' && focus && !focused.current) {
            focused.current = true;
            scrollTo('runtime');
        }
    };

    const save = async () => {
        const result = await form.submit();
        if (!result.ok) {
            if (result.section) {
                if (isAdvancedSection(result.section)) setAdvanced(true);
                scrollTo(isAdvancedSection(result.section) ? 'runtime' : result.section);
            }
            return;
        }
        allowExit.current = true;
        if (editing) {
            router.back();
            return;
        }
        // Created from the new-Agent screen: drop it and this form so Back from the profile leaves creation.
        const detail = `/teammates/${encodeURIComponent(result.teammate.id)}` as const;
        const state = navigation.getState();
        if (state && state.routes[state.index - 1]?.name === 'teammates/new/index') {
            router.dismiss(2);
            router.push(detail);
        } else {
            router.replace(detail);
        }
    };

    const discard = () => {
        Modal.confirm(t('artifacts.discardChanges'), t('artifacts.discardChangesDescription'), { confirmText: t('common.discard'), destructive: true })
            .then(confirmed => {
                if (!confirmed) return;
                form.reset();
                setCustomHeartbeat(!isHeartbeatPreset(form.initial.heartbeatIntervalMin));
            });
    };

    const machine = machines.find(item => item.id === values.machineId);
    const machineName = machine ? machine.metadata?.displayName || machine.metadata?.host || machine.id : undefined;
    const libraryCount = values.skills.length + values.repos.length;
    const allDays = ALL_DAYS.every(day => values.activeDays.includes(day));
    const sortedDays = WEEK.filter(day => values.activeDays.includes(day));
    const daysLabel = allDays ? t('teammates.form.everyDay')
        : sortedDays.length === WEEKDAYS.length && WEEKDAYS.every(day => values.activeDays.includes(day)) ? t('teammates.form.weekdays')
            : sortedDays.map(dayName).join(' ');
    const hoursLabel = values.activeHoursEnabled ? `${daysLabel} ${values.activeHoursStart}–${values.activeHoursEnd}` : t('teammates.form.anyTime');
    const budget = values.monthlyBudgetUsd.trim();
    const advancedChanged = form.changed.some(field => isAdvancedSection(teammateFormSection(field)));
    const advancedSummary = !editing && !advancedChanged ? t('teammates.form.defaultsSummary') : [
        t('teammates.form.plannerSummary', { provider: providerName(values.controller.provider) }),
        t('teammates.form.workerSummary', { provider: providerName(values.worker.provider) }),
        `${t('teammates.form.heartbeat')} ${heartbeatLabel(values.heartbeatIntervalMin)}`,
        ...budget ? [t('teammates.form.budgetSummary', { amount: budget })] : [],
    ].join('  ');
    const heartbeatOptions = [
        ...TEAMMATE_HEARTBEAT_PRESETS.map(minutes => ({ value: String(minutes), label: heartbeatLabel(minutes) })),
        { value: CUSTOM, label: t('teammates.form.custom') },
    ];
    const hoursError = errorText('activeHoursStart', errors.activeHoursStart) ?? errorText('activeDays', errors.activeDays);
    const showFooter = !editing || dirty;

    return (
        <View style={styles.page}>
            <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
                <View style={styles.lead}>
                    <TeammateAvatar teammate={{ name: values.name, avatar: { color: values.color } }} size={48} />
                    <View style={styles.leadText}>
                        <Text style={[styles.leadName, !values.name && styles.muted]} numberOfLines={1}>{values.name || t('teammates.unnamed')}</Text>
                        {!!values.role.trim() && <Text style={styles.leadRole} numberOfLines={1}>{values.role.trim()}</Text>}
                    </View>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={sheets.color.present}>
                        <Text style={[styles.link, changed.has('color') && styles.changed]}>{t('teammates.form.changeColor')}</Text>
                    </Pressable>
                </View>

                <View onLayout={onSectionLayout('basic')}>
                    <SectionLabel title={t('teammates.form.basics')} />
                    <Card>
                        <InputRow label={t('teammates.name')} value={values.name} onChange={value => set('name', value)} placeholder={t('teammates.namePlaceholder')}
                            changed={changed.has('name')} error={errorText('name', errors.name)} />
                        <InputRow label={t('teammates.role')} value={values.role} onChange={value => set('role', value)} placeholder={t('teammates.rolePlaceholder')}
                            changed={changed.has('role')} error={errorText('role', errors.role)} />
                        <Row label={t('teammates.machine')} value={machineName} placeholder={t('teammates.wizard.noMachine')} onPress={sheets.machine.present}
                            changed={changed.has('machineId')} error={errorText('machineId', errors.machineId)} />
                        <Row label={t('teammates.form.skillsAndRepos')} value={libraryCount ? t('teammates.form.itemCount', { count: libraryCount }) : undefined}
                            placeholder={t('teammates.form.none')} onPress={sheets.library.present} changed={changed.has('skills') || changed.has('repos')}
                            error={errorText('repos', errors.repos) ?? errorText('skills', errors.skills) ?? (missingSkills ? t('teammates.form.skillsMissing', { count: missingSkills }) : null)} />
                    </Card>
                </View>

                <View onLayout={onSectionLayout('instructions')}>
                    <SectionLabel title={t('teammates.wizard.instructionsTitle')} />
                    <Card>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('teammates.wizard.instructionsTitle')} onPress={sheets.instructions.present}
                            style={({ pressed }) => [styles.instructions, pressed && styles.pressed]}>
                            <Text style={[styles.excerpt, !values.instructions.trim() && styles.muted, changed.has('instructions') && styles.changed]} numberOfLines={3}>
                                {values.instructions.trim() || t('teammates.wizard.noInstructions')}
                            </Text>
                            <Text style={styles.link}>{t('teammates.wizard.edit')}</Text>
                        </Pressable>
                        <FieldError message={errorText('instructions', errors.instructions)} />
                    </Card>
                </View>

                <View onLayout={onSectionLayout('runtime')} style={styles.advanced}>
                    <CollapsibleCard title={t('teammates.form.advanced')} summary={advancedSummary} note={editing && advancedChanged ? t('teammates.form.modified') : undefined}
                        expanded={advanced} onToggle={() => setAdvanced(value => !value)}>
                        <CardHeading title={t('teammates.runtime')} />
                        <Row label={t('teammates.controllerRuntime')} value={runtimeLabel(values.controller)} onPress={sheets.controller.present}
                            changed={changed.has('controller')} error={errorText('controller', errors.controller)} />
                        <Row label={t('teammates.workerRuntime')} value={runtimeLabel(values.worker)} onPress={sheets.worker.present}
                            changed={changed.has('worker')} error={errorText('worker', errors.worker)} />
                        <Row label={t('teammates.concurrency')} error={errorText('maxConcurrentRuns', errors.maxConcurrentRuns)} right={(
                            <CountStepper label={t('teammates.concurrency')} value={values.maxConcurrentRuns} onChange={value => set('maxConcurrentRuns', value)}
                                min={1} max={10} changed={changed.has('maxConcurrentRuns')} />
                        )} />
                        <ToggleRow label={t('teammates.selfAssign')} value={values.canSelfAssign} onChange={value => set('canSelfAssign', value)} changed={changed.has('canSelfAssign')} />
                        <ToggleRow label={t('teammates.form.contextAutoRollover')} value={values.contextAutoRollover}
                            onChange={value => set('contextAutoRollover', value)} changed={changed.has('contextAutoRollover')} />
                        <Text style={styles.sheetHint}>{t(values.contextAutoRollover ? 'teammates.form.contextAutoRolloverOnHint' : 'teammates.form.contextAutoRolloverOffHint')}</Text>
                        {values.contextAutoRollover && (
                            <>
                                <InputRow label={t('teammates.form.contextBudget')} numeric value={values.contextBudgetTokens}
                                    placeholder={new Intl.NumberFormat(getCurrentLanguage()).format(TEAMMATE_CONTEXT_BUDGET_DEFAULT)}
                                    onChange={value => set('contextBudgetTokens', value)} changed={changed.has('contextBudgetTokens')}
                                    error={errorText('contextBudgetTokens', errors.contextBudgetTokens)} />
                                <Text style={styles.sheetHint}>{t('teammates.form.contextBudgetHint')}</Text>
                            </>
                        )}

                        <CardHeading title={t('teammates.form.scheduleAndBudget')} />
                        <OptionPills label={t('teammates.form.heartbeat')} options={heartbeatOptions}
                            value={customHeartbeat ? CUSTOM : String(values.heartbeatIntervalMin)}
                            onChange={value => {
                                setCustomHeartbeat(value === CUSTOM);
                                if (value !== CUSTOM) set('heartbeatIntervalMin', value === 'null' ? null : Number(value));
                            }}
                            changed={changed.has('heartbeatIntervalMin')} error={customHeartbeat ? undefined : errorText('heartbeatIntervalMin', errors.heartbeatIntervalMin)} />
                        {customHeartbeat && (
                            <InputRow label={t('teammates.form.intervalMinutes')} numeric value={values.heartbeatIntervalMin?.toString() ?? ''} placeholder="30"
                                onChange={text => set('heartbeatIntervalMin', text.trim() ? Number(text) : null)}
                                changed={changed.has('heartbeatIntervalMin')} error={errorText('heartbeatIntervalMin', errors.heartbeatIntervalMin)} />
                        )}
                        <Row label={t('teammates.activeHours')} value={hoursLabel} onPress={sheets.hours.present}
                            changed={['activeHoursEnabled', 'activeHoursStart', 'activeHoursEnd', 'activeDays'].some(field => changed.has(field as TeammateFormField))}
                            error={hoursError} />
                        <InputRow label={t('teammates.timezone')} value={values.timezone} onChange={value => set('timezone', value)} placeholder="UTC"
                            changed={changed.has('timezone')} error={errorText('timezone', errors.timezone)} />
                        <InputRow label={t('teammates.dreaming')} numeric value={values.dreamingHour?.toString() ?? ''} placeholder={t('teammates.form.off')}
                            onChange={text => set('dreamingHour', text.trim() ? Number(text) : null)}
                            changed={changed.has('dreamingHour')} error={errorText('dreamingHour', errors.dreamingHour)} />
                        <InputRow label={t('teammates.form.monthlyBudget')} prefix="$" numeric value={values.monthlyBudgetUsd} placeholder={t('teammates.form.noLimit')}
                            onChange={value => set('monthlyBudgetUsd', value)} changed={changed.has('monthlyBudgetUsd')} error={errorText('monthlyBudgetUsd', errors.monthlyBudgetUsd)} />
                    </CollapsibleCard>
                </View>
            </ScrollView>

            {showFooter && (
                <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
                    {form.error && <Text accessibilityRole="alert" style={styles.footerError}>{form.error}</Text>}
                    <View style={styles.footerButtons}>
                        {editing && <PillButton kind="secondary" label={t('common.discard')} onPress={discard} disabled={form.saving} grow />}
                        <PillButton label={editing ? t('common.save') : t('teammates.create')} onPress={save} loading={form.saving}
                            disabled={!form.canSave || !machines.length} grow />
                    </View>
                </View>
            )}

            <TeammateSheet ref={sheets.color.ref} title={t('teammates.color')}>
                <ColorPicker value={values.color} onChange={value => set('color', value)} />
            </TeammateSheet>
            <TeammateSheet ref={sheets.machine.ref} title={t('teammates.machine')}>
                <MachinePicker machines={machines} label="" value={values.machineId} onChange={id => { set('machineId', id); sheets.machine.dismiss(); }} />
            </TeammateSheet>
            <TeammateSheet ref={sheets.library.ref} title={t('teammates.form.skillsAndRepos')} size="large">
                <SkillPicker state={machineSkills} value={values.skills} onChange={value => set('skills', value)} hint={t('teammates.skillPickerHint')} />
                <TagInput label={t('teammates.repos')} placeholder={t('teammates.repoPlaceholder')} values={values.repos} onChange={value => set('repos', value)}
                    suggestions={repoSuggestions} hint={t('teammates.reposHint')} error={errorText('repos', errors.repos)} />
            </TeammateSheet>
            <TeammateSheet ref={sheets.instructions.ref} title={t('teammates.wizard.instructionsTitle')} size="large">
                <Text style={styles.sheetHint}>{t('teammates.wizard.instructionsHint')}</Text>
                <SheetTextInput
                    accessibilityLabel={t('teammates.instructions')}
                    value={values.instructions}
                    onChangeText={value => set('instructions', value)}
                    placeholder={t('teammates.instructionsPlaceholder')}
                    placeholderTextColor={theme.colors.input.placeholder}
                    multiline
                    textAlignVertical="top"
                    style={styles.instructionsInput}
                />
            </TeammateSheet>
            <TeammateSheet ref={sheets.controller.ref} title={t('teammates.controllerRuntime')}>
                <TeammateRuntimeFields title="" hint={t('teammates.controllerRuntimeHint')} providers={TEAMMATE_CONTROLLER_PROVIDERS}
                    value={values.controller} onChange={value => set('controller', value)} />
            </TeammateSheet>
            <TeammateSheet ref={sheets.worker.ref} title={t('teammates.workerRuntime')}>
                <TeammateRuntimeFields title="" hint={t('teammates.workerRuntimeHint')} providers={TEAMMATE_WORKER_PROVIDERS}
                    value={values.worker} onChange={value => set('worker', value)} />
            </TeammateSheet>
            <TeammateSheet ref={sheets.hours.ref} title={t('teammates.activeHours')}>
                <Text style={styles.sheetHint}>{t('teammates.form.activeHoursHint')}</Text>
                <View style={styles.sheetCard}>
                    <ToggleRow label={t('teammates.form.limitHours')} value={values.activeHoursEnabled} onChange={value => set('activeHoursEnabled', value)} />
                    {values.activeHoursEnabled && (
                        <>
                            <View style={styles.days} accessibilityRole="none">
                                {WEEK.map(day => {
                                    const on = values.activeDays.includes(day);
                                    return (
                                        <Pressable key={day} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={dayName(day)}
                                            onPress={() => set('activeDays', on ? values.activeDays.filter(item => item !== day) : [...values.activeDays, day])}
                                            style={[styles.day, on && styles.daySelected]}>
                                            <Text style={[styles.dayText, on && styles.dayTextSelected]} numberOfLines={1}>{dayName(day)}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                            <FieldError message={errorText('activeDays', errors.activeDays)} />
                            <InputRow inSheet label={t('teammates.start')} value={values.activeHoursStart} onChange={value => set('activeHoursStart', value)} placeholder="09:00" />
                            <InputRow inSheet label={t('teammates.end')} value={values.activeHoursEnd} onChange={value => set('activeHoursEnd', value)} placeholder="18:00"
                                error={errorText('activeHoursStart', errors.activeHoursStart)} />
                        </>
                    )}
                </View>
            </TeammateSheet>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 16,
        paddingBottom: 40,
    },
    lead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 4,
    },
    leadText: {
        flex: 1,
        gap: 2,
    },
    leadName: {
        ...Typography.default('semiBold'),
        fontSize: 18,
        color: theme.colors.text,
    },
    leadRole: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    link: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    changed: {
        color: theme.colors.box.warning.text,
    },
    muted: {
        color: theme.colors.textSecondary,
    },
    pressed: {
        opacity: 0.7,
    },
    instructions: {
        gap: 8,
        paddingVertical: 14,
    },
    excerpt: {
        ...Typography.default(),
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
    },
    advanced: {
        marginTop: 28,
    },
    footer: {
        gap: 8,
        paddingHorizontal: KIT_PAGE_PADDING,
        paddingTop: 12,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: theme.colors.surface,
    },
    footerError: {
        ...Typography.default(),
        fontSize: 13,
        textAlign: 'center',
        color: theme.colors.textDestructive,
    },
    footerButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    sheetHint: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
    sheetCard: {
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 4,
        backgroundColor: theme.colors.surfaceHigh,
    },
    instructionsInput: {
        ...Typography.default(),
        flexGrow: 1,
        minHeight: 320,
        padding: 16,
        borderRadius: 18,
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.text,
        backgroundColor: theme.colors.surfaceHigh,
    },
    days: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        paddingVertical: 8,
    },
    day: {
        minWidth: 40,
        height: 32,
        paddingHorizontal: 8,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
    },
    daySelected: {
        backgroundColor: theme.colors.button.primary.background,
    },
    dayText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    dayTextSelected: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.primary.tint,
    },
}));
