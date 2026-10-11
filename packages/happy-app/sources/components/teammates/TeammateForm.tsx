import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';
import {
    TeammateCreateRequestSchema, TEAMMATE_CONTROLLER_PROVIDERS, TEAMMATE_HANDLE_REGEX, TEAMMATE_WORKER_PROVIDERS, type Teammate, type TeammateCreateRequest,
} from 'happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { sync } from '@/sync/sync';
import { storage, useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { createTeammate, updateTeammate } from '@/sync/apiTeammates';
import { encryptTeammateProfileEnv } from '@/sync/teammateRuntimeEnv';
import type { TeammateSeed } from '@/sync/teammateDraft';
import { isMachineOnline } from '@/utils/machineUtils';
import { useMachineSkills } from '@/hooks/useMachineSkills';
import { SkillPicker } from './SkillPicker';
import { getCachedGithubRepos } from '@/hooks/useGithubData';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { buildTeammateSchedulePayload } from '@/sync/teammateSchedule';
import { TeammateAvatar, teammateColor, teammateErrorMessage, teammatePermissionLabel } from './ui';
import { TeammateRuntimeFields, type TeammateRuntimeValue } from './TeammateRuntimeFields';
import {
    ActionButton, ColorPicker, FooterBar, FormSection, MachinePicker, Stepper, SwitchRow, TagInput, TextField,
} from './TeammateFormFields';

const CONTENT_MAX_WIDTH = 720;
const HOUR_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

type StepId = 'identity' | 'persona' | 'instructions' | 'runtime' | 'review' | 'governance';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Creating ends on a review page that also holds the optional governance settings; editing has no
// review, so governance gets its own step and every step is reachable from the header.
const CREATE_STEPS: StepId[] = ['identity', 'persona', 'instructions', 'runtime', 'review'];
const EDIT_STEPS: StepId[] = ['identity', 'persona', 'instructions', 'runtime', 'governance'];

// Request fields shown on each step; anything unlisted (budget, schedule, dreaming) lives on the last step.
const FIELD_STEPS: Record<string, StepId> = {
    name: 'identity', handle: 'identity', avatar: 'identity',
    role: 'persona', skills: 'persona', repos: 'persona',
    instructions: 'instructions',
    machineId: 'identity', workerProvider: 'runtime', model: 'runtime', workerPermissionMode: 'runtime', workerProfileId: 'runtime', workerEnv: 'runtime',
    controllerProvider: 'runtime', controllerModel: 'runtime', controllerPermissionMode: 'runtime', controllerProfileId: 'runtime', controllerEnv: 'runtime',
    maxConcurrentRuns: 'runtime', canSelfAssign: 'runtime',
};

const STEP_ICONS: Record<StepId, IconName> = {
    identity: 'person-circle-outline',
    persona: 'briefcase-outline',
    instructions: 'document-text-outline',
    runtime: 'hardware-chip-outline',
    review: 'checkmark-done-outline',
    governance: 'shield-checkmark-outline',
};

function stepTitle(step: StepId): string {
    switch (step) {
        case 'identity': return t('teammates.identity');
        case 'persona': return t('teammates.persona');
        case 'instructions': return t('teammates.wizard.instructionsTitle');
        case 'runtime': return t('teammates.runtime');
        case 'review': return t('teammates.wizard.review');
        case 'governance': return t('teammates.governance');
    }
}

function stepHint(step: StepId): string {
    switch (step) {
        case 'identity': return t('teammates.identityHint');
        case 'persona': return t('teammates.personaHint');
        case 'instructions': return t('teammates.wizard.instructionsHint');
        case 'runtime': return t('teammates.runtimeHint');
        case 'review': return t('teammates.wizard.reviewHint');
        case 'governance': return t('teammates.governanceHint');
    }
}

function suggestHandle(name: string): string {
    const result = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    return result.length >= 2 ? result : '';
}

function runtimeSummary({ provider, model, permissionMode }: TeammateRuntimeValue): string {
    return [t(`agentInput.agent.${provider}`), model || t('teammates.defaultModel'), teammatePermissionLabel(permissionMode)].join(' · ');
}

function machineName(machine: Machine | undefined): string {
    return machine ? machine.metadata?.displayName || machine.metadata?.host || machine.id : t('teammates.wizard.noMachine');
}

/** Live preview of the Agent as it will appear in chats, tinted with its avatar color. */
function PreviewCard({ name, handle, role, color }: { name: string; handle: string; role: string; color: string }) {
    const { theme } = useUnistyles();
    const tint = teammateColor({ avatar: { color } }, theme.colors.textLink);
    return (
        <View style={styles.preview}>
            <View style={[styles.previewTint, { backgroundColor: tint }]} />
            <TeammateAvatar teammate={{ name, avatar: { color } }} size={64} />
            <View style={styles.previewText}>
                <Text style={[styles.previewName, !name && styles.placeholder]} numberOfLines={1}>{name || t('teammates.unnamed')}</Text>
                <Text style={styles.previewHandle} numberOfLines={1}>@{handle || '…'}</Text>
                <Text style={[styles.previewRole, !role && styles.placeholder]} numberOfLines={2}>{role || t('teammates.noRole')}</Text>
            </View>
        </View>
    );
}

/** "Step 2 of 5", the step title and a segmented progress bar whose reachable segments jump to that step. */
function StepHeader({ steps, current, reachable, onSelect }: {
    steps: StepId[]; current: number; reachable: number; onSelect: (index: number) => void;
}) {
    const { theme } = useUnistyles();
    const step = steps[current];
    return (
        <View style={styles.header}>
            <View style={styles.progress}>
                {steps.map((id, index) => (
                    <Pressable
                        key={id}
                        accessibilityRole="button"
                        accessibilityLabel={stepTitle(id)}
                        accessibilityState={{ selected: index === current, disabled: index > reachable }}
                        disabled={index > reachable}
                        hitSlop={{ top: 10, bottom: 10 }}
                        onPress={() => onSelect(index)}
                        style={styles.progressHit}
                    >
                        <View style={[styles.progressSegment, index <= current && styles.progressDone]} />
                    </Pressable>
                ))}
            </View>
            <Text style={styles.stepOf}>{t('teammates.wizard.stepOf', { current: current + 1, total: steps.length })}</Text>
            <View style={styles.headerTitleRow}>
                <Ionicons name={STEP_ICONS[step]} size={22} color={theme.colors.textLink} />
                <Text style={styles.headerTitle}>{stepTitle(step)}</Text>
            </View>
            <Text style={styles.headerHint}>{stepHint(step)}</Text>
        </View>
    );
}

function SummaryCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
    return (
        <View style={styles.summary}>
            <View style={styles.summaryHeader}>
                <Text style={styles.summaryTitle}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('teammates.wizard.edit')} ${title}`} hitSlop={8} onPress={onEdit}>
                    <Text style={styles.summaryEdit}>{t('teammates.wizard.edit')}</Text>
                </Pressable>
            </View>
            {children}
        </View>
    );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text style={styles.summaryValue} numberOfLines={2}>{value}</Text>
        </View>
    );
}

function Chips({ values }: { values: string[] }) {
    return (
        <View style={styles.chips}>
            {values.map(value => (
                <View key={value} style={styles.chip}>
                    <Text style={styles.chipText} numberOfLines={1}>{value}</Text>
                </View>
            ))}
        </View>
    );
}

export function TeammateForm({ teammate, seed, initialStep }: { teammate?: Teammate; seed?: TeammateSeed; initialStep?: string }) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { credentials } = useAuth();
    const machines = useAllMachines();
    const draft = seed?.draft;
    const steps = teammate ? EDIT_STEPS : CREATE_STEPS;
    const lastStep = steps.length - 1;
    // A drafted Agent has every step filled in already, so it opens on review.
    const [step, setStep] = React.useState(() => Math.max(steps.indexOf(initialStep as StepId), seed ? lastStep : 0));
    const [reached, setReached] = React.useState(teammate || seed ? lastStep : 0);
    const [name, setName] = React.useState(teammate?.name ?? draft?.name ?? '');
    const [handle, setHandle] = React.useState(teammate?.handle ?? draft?.handle ?? '');
    const [handleTouched, setHandleTouched] = React.useState(!!teammate || !!draft?.handle);
    const [color, setColor] = React.useState(teammate?.avatar?.color ?? draft?.avatar?.color ?? '#5B6EF5');
    const [role, setRole] = React.useState(teammate?.role ?? draft?.role ?? '');
    // Skills are picked from the machine; a drafted Agent never carries any.
    const [skills, setSkills] = React.useState(teammate?.skills ?? []);
    const [repos, setRepos] = React.useState(teammate?.repos ?? []);
    const [instructions, setInstructions] = React.useState(teammate?.instructions ?? draft?.instructions ?? '');
    const [machineId, setMachineId] = React.useState(teammate?.machineId ?? seed?.machineId ?? '');
    const machineSkills = useMachineSkills(machineId);
    const [controller, setController] = React.useState<TeammateRuntimeValue<Teammate['controllerProvider']>>({
        provider: teammate?.controllerProvider ?? 'claude', model: teammate?.controllerModel ?? '',
        permissionMode: teammate?.controllerPermissionMode ?? 'default', profileId: teammate?.controllerProfileId ?? '',
    });
    const [worker, setWorker] = React.useState<TeammateRuntimeValue>({
        provider: teammate?.workerProvider ?? 'claude', model: teammate?.model ?? '',
        permissionMode: teammate?.workerPermissionMode ?? 'default', profileId: teammate?.workerProfileId ?? '',
    });
    const [concurrency, setConcurrency] = React.useState(String(teammate?.maxConcurrentRuns ?? 3));
    const [selfAssign, setSelfAssign] = React.useState(teammate?.canSelfAssign ?? false);
    const [budget, setBudget] = React.useState(teammate?.monthlyBudgetUsd?.toString() ?? '');
    const [heartbeat, setHeartbeat] = React.useState(teammate?.heartbeatIntervalMin?.toString() ?? '');
    const [activeHours, setActiveHours] = React.useState(!!teammate?.activeHours);
    const [start, setStart] = React.useState(teammate?.activeHours?.start ?? '09:00');
    const [end, setEnd] = React.useState(teammate?.activeHours?.end ?? '18:00');
    const [timezone, setTimezone] = React.useState(teammate?.timezone ?? teammate?.activeHours?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
    const [dreaming, setDreaming] = React.useState(teammate?.dreamingHour?.toString() ?? '');
    const rewrapPending = React.useRef(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [errors, setErrors] = React.useState<Record<string, string>>({});
    const [advanced, setAdvanced] = React.useState(false);
    const scroll = React.useRef<ScrollView>(null);
    const suggestions = credentials ? getCachedGithubRepos(credentials).map(repo => repo.fullName) : [];

    React.useEffect(() => {
        if (!teammate && !machineId && machines.length) setMachineId((machines.find(isMachineOnline) ?? machines[0]).id);
    }, [machines, machineId, teammate]);
    React.useEffect(() => {
        scroll.current?.scrollTo({ y: 0, animated: false });
    }, [step]);

    const goTo = (index: number) => {
        setError(null);
        setStep(index);
        setReached(value => Math.max(value, index));
    };

    const validateStep = (id: StepId): Record<string, string> => {
        const result: Record<string, string> = {};
        if (id === 'identity' && !name.trim()) result.name = t('teammates.invalidValue');
        if (id === 'identity' && !TEAMMATE_HANDLE_REGEX.test(handle)) result.handle = t('teammates.handleHint');
        if (id === 'identity' && !machineId) result.machineId = t('teammates.invalidValue');
        return result;
    };

    const next = () => {
        const stepErrors = validateStep(steps[step]);
        setErrors(stepErrors);
        if (Object.keys(stepErrors).length) {
            setError(t('teammates.checkFields'));
            return;
        }
        goTo(step + 1);
    };

    const save = async () => {
        if (!credentials || saving) return;
        const body: TeammateCreateRequest = {
            name: name.trim(), handle: handle.trim(), avatar: { ...teammate?.avatar, color }, role: role.trim(), skills, repos, instructions,
            machineId,
            controllerProvider: controller.provider, controllerModel: controller.model || null, controllerPermissionMode: controller.permissionMode,
            controllerProfileId: controller.profileId || null,
            workerProvider: worker.provider, model: worker.model || null, workerPermissionMode: worker.permissionMode,
            workerProfileId: worker.profileId || null,
            maxConcurrentRuns: Number(concurrency), canSelfAssign: selfAssign,
            monthlyBudgetUsd: budget.trim() ? Number(budget) : null,
            heartbeatIntervalMin: heartbeat.trim() ? Number(heartbeat) : null,
            ...buildTeammateSchedulePayload(timezone, activeHours, start, end, teammate?.activeHours?.days),
            dreamingHour: dreaming.trim() ? Number(dreaming) : null,
        };
        const parsed = TeammateCreateRequestSchema.safeParse(body);
        const nextErrors: Record<string, string> = {};
        if (!parsed.success) for (const issue of parsed.error.issues) nextErrors[String(issue.path[0])] = t('teammates.invalidValue');
        if (!TEAMMATE_HANDLE_REGEX.test(handle)) nextErrors.handle = t('teammates.handleHint');
        try { new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(); } catch { nextErrors.timezone = t('teammates.timezoneHint'); }
        if (activeHours && (!HOUR_REGEX.test(start) || !HOUR_REGEX.test(end))) nextErrors.activeHours = t('teammates.hoursHint');
        setErrors(nextErrors);
        setError(null);
        if (!parsed.success || Object.keys(nextErrors).length) {
            // Jump to the earliest step that holds a failing field so the error is visible.
            const failing = Object.keys(nextErrors).map(key => steps.indexOf(FIELD_STEPS[key] ?? steps[lastStep]));
            const target = failing.length ? Math.min(...failing) : step;
            if (target === lastStep) setAdvanced(true);
            setStep(target);
            setError(t('teammates.checkFields'));
            return;
        }
        setSaving(true);
        try {
            // Profile environments may hold secrets, so they are sealed for the bound machine on every save;
            // a profile deleted since it was picked falls back to the machine's own configuration.
            const [controllerEnv, workerEnv] = await Promise.all([controller, worker].map(role => encryptTeammateProfileEnv(machineId, role.profileId || null, role.provider)));
            const request = {
                ...parsed.data, controllerEnv, workerEnv,
                controllerProfileId: controllerEnv && parsed.data.controllerProfileId, workerProfileId: workerEnv && parsed.data.workerProfileId,
            };
            const { handle: _handle, ...update } = request;
            const saved = teammate ? await updateTeammate(credentials, teammate.id, update) : await createTeammate(credentials, request);
            rewrapPending.current ||= !!teammate && teammate.machineId !== saved.machineId;
            storage.getState().applyTeammates([saved]);
            if (rewrapPending.current) {
                try { await sync.channels.rewrapMember(saved); rewrapPending.current = false; }
                catch { setError(t('channels.rewrapError')); return; }
            }
            if (teammate) router.back(); else router.replace(`/teammates/${saved.id}`);
        } catch (error) { setError(teammateErrorMessage(error)); }
        finally { setSaving(false); }
    };

    const disabled = saving || !credentials || !machines.length || teammate?.status === 'archived';
    const current = steps[step];
    const governance = (
        <>
            <TextField label={t('teammates.budget')} prefix="$" value={budget} onChange={setBudget} numeric hint={t('teammates.budgetHint')} error={errors.monthlyBudgetUsd} />
            <TextField label={t('teammates.heartbeat')} value={heartbeat} onChange={setHeartbeat} numeric hint={t('teammates.heartbeatHint')} error={errors.heartbeatIntervalMin} />
            <SwitchRow title={t('teammates.activeHours')} value={activeHours} onChange={setActiveHours} />
            {activeHours && (
                <View style={styles.hoursRow}>
                    <View style={styles.hoursField}>
                        <TextField label={t('teammates.start')} value={start} onChange={setStart} placeholder="09:00" error={errors.activeHours} />
                    </View>
                    <View style={styles.hoursField}>
                        <TextField label={t('teammates.end')} value={end} onChange={setEnd} placeholder="18:00" />
                    </View>
                </View>
            )}
            <TextField label={t('teammates.timezone')} value={timezone} onChange={setTimezone} hint={t('teammates.timezoneHint')} error={errors.timezone} />
            <TextField
                label={t('teammates.dreaming')}
                value={dreaming}
                onChange={setDreaming}
                numeric
                hint={t('teammates.dreamingTimezoneHint', { timezone })}
                error={errors.dreamingHour}
            />
        </>
    );

    return (
        <View style={styles.page}>
            <ScrollView ref={scroll} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <StepHeader steps={steps} current={step} reachable={reached} onSelect={goTo} />

                {current === 'identity' && (
                    <View style={styles.card}>
                        <PreviewCard name={name} handle={handle} role={role} color={color} />
                        <TextField
                            label={t('teammates.name')}
                            placeholder={t('teammates.namePlaceholder')}
                            value={name}
                            onChange={value => { setName(value); if (!handleTouched) setHandle(suggestHandle(value)); }}
                            error={errors.name}
                        />
                        <TextField
                            label={t('teammates.handle')}
                            prefix="@"
                            value={handle}
                            onChange={value => { setHandleTouched(true); setHandle(value.toLowerCase().replace(/^@/, '')); }}
                            editable={!teammate}
                            hint={teammate ? t('teammates.handleImmutable') : t('teammates.handleHint')}
                            error={errors.handle}
                        />
                        <ColorPicker value={color} onChange={setColor} />
                        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} error={errors.machineId} />
                    </View>
                )}

                {current === 'persona' && (
                    <View style={styles.card}>
                        <TextField label={t('teammates.role')} placeholder={t('teammates.rolePlaceholder')} value={role} onChange={setRole} error={errors.role} />
                        <SkillPicker state={machineSkills} value={skills} onChange={setSkills} hint={t('teammates.skillPickerHint')} error={errors.skills} />
                        <TagInput
                            label={t('teammates.repos')}
                            placeholder={t('teammates.repoPlaceholder')}
                            values={repos}
                            onChange={setRepos}
                            suggestions={suggestions}
                            hint={t('teammates.reposHint')}
                            error={errors.repos}
                        />
                    </View>
                )}

                {current === 'instructions' && (
                    <View style={styles.card}>
                        <TextField
                            label={t('teammates.instructions')}
                            hideLabel
                            placeholder={t('teammates.instructionsPlaceholder')}
                            value={instructions}
                            onChange={setInstructions}
                            multiline
                            tall
                            error={errors.instructions}
                        />
                    </View>
                )}

                {current === 'runtime' && (
                    <View style={styles.card}>
                        <TeammateRuntimeFields title={t('teammates.controllerRuntime')} hint={t('teammates.controllerRuntimeHint')} providers={TEAMMATE_CONTROLLER_PROVIDERS} value={controller} onChange={setController} />
                        <TeammateRuntimeFields title={t('teammates.workerRuntime')} hint={t('teammates.workerRuntimeHint')} providers={TEAMMATE_WORKER_PROVIDERS} value={worker} onChange={setWorker} />
                        <Stepper
                            label={t('teammates.concurrency')}
                            value={concurrency}
                            onChange={setConcurrency}
                            min={1}
                            max={10}
                            hint={t('teammates.concurrencyHint')}
                            error={errors.maxConcurrentRuns}
                        />
                        <SwitchRow title={t('teammates.selfAssign')} hint={t('teammates.selfAssignHint')} value={selfAssign} onChange={setSelfAssign} />
                    </View>
                )}

                {current === 'governance' && <View style={styles.card}>{governance}</View>}

                {current === 'review' && (
                    <>
                        {seed && (
                            <View style={styles.notice}>
                                <Ionicons name="sparkles-outline" size={16} color={theme.colors.textLink} />
                                <Text style={styles.noticeText}>{t('teammates.wizard.fromAi')}</Text>
                            </View>
                        )}
                        <PreviewCard name={name} handle={handle} role={role} color={color} />
                        <SummaryCard title={stepTitle('persona')} onEdit={() => goTo(steps.indexOf('persona'))}>
                            <SummaryRow label={t('teammates.role')} value={role.trim() || t('teammates.noRole')} />
                            {skills.length > 0 && <Chips values={skills} />}
                            <SummaryRow label={t('teammates.repos')} value={repos.length ? repos.join(', ') : '—'} />
                        </SummaryCard>
                        <SummaryCard title={stepTitle('instructions')} onEdit={() => goTo(steps.indexOf('instructions'))}>
                            <Text style={[styles.excerpt, !instructions.trim() && styles.placeholder]} numberOfLines={6}>
                                {instructions.trim() || t('teammates.wizard.noInstructions')}
                            </Text>
                        </SummaryCard>
                        <SummaryCard title={stepTitle('runtime')} onEdit={() => goTo(steps.indexOf('runtime'))}>
                            <SummaryRow label={t('teammates.machine')} value={machineName(machines.find(machine => machine.id === machineId))} />
                            <SummaryRow label={t('teammates.controllerRuntime')} value={runtimeSummary(controller)} />
                            <SummaryRow label={t('teammates.workerRuntime')} value={runtimeSummary(worker)} />
                            <SummaryRow label={t('teammates.concurrency')} value={concurrency} />
                        </SummaryCard>
                        <FormSection
                            icon="shield-checkmark-outline"
                            title={t('teammates.governance')}
                            hint={t('teammates.governanceHint')}
                            expanded={advanced}
                            onToggle={() => setAdvanced(value => !value)}
                        >
                            {governance}
                        </FormSection>
                    </>
                )}
            </ScrollView>

            <FooterBar error={error}>
                {teammate ? (
                    <ActionButton label={t('common.save')} onPress={save} disabled={disabled} loading={saving} />
                ) : (
                    <>
                        {step > 0 && <ActionButton kind="secondary" grow={false} label={t('common.back')} onPress={() => goTo(step - 1)} />}
                        {step < lastStep
                            ? <ActionButton label={t('common.continue')} onPress={next} />
                            : <ActionButton label={t('teammates.create')} onPress={save} disabled={disabled} loading={saving} />}
                    </>
                )}
            </FooterBar>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        width: '100%',
        maxWidth: CONTENT_MAX_WIDTH,
        alignSelf: 'center',
        gap: 16,
        padding: 16,
        paddingBottom: 32,
    },
    header: {
        gap: 6,
        paddingHorizontal: 4,
    },
    progress: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 10,
    },
    progressHit: {
        flex: 1,
    },
    progressSegment: {
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.divider,
    },
    progressDone: {
        backgroundColor: theme.colors.textLink,
    },
    stepOf: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: theme.colors.textSecondary,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        ...Typography.default('semiBold'),
        fontSize: 24,
        color: theme.colors.text,
    },
    headerHint: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    card: {
        gap: 16,
        padding: 16,
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
    },
    preview: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: 18,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
    },
    previewTint: {
        ...StyleSheet.absoluteFillObject,
        opacity: 0.12,
    },
    previewText: {
        flex: 1,
        gap: 2,
    },
    previewName: {
        ...Typography.default('semiBold'),
        fontSize: 20,
        color: theme.colors.text,
    },
    previewHandle: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    previewRole: {
        ...Typography.default(),
        marginTop: 4,
        fontSize: 14,
        color: theme.colors.text,
    },
    placeholder: {
        color: theme.colors.textSecondary,
    },
    notice: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHighest,
    },
    noticeText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text,
    },
    summary: {
        gap: 10,
        padding: 16,
        borderRadius: 16,
        backgroundColor: theme.colors.surface,
    },
    summaryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    summaryTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text,
    },
    summaryEdit: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.textLink,
    },
    summaryRow: {
        flexDirection: 'row',
        gap: 12,
    },
    summaryLabel: {
        ...Typography.default(),
        width: 110,
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    summaryValue: {
        ...Typography.default(),
        flex: 1,
        fontSize: 14,
        color: theme.colors.text,
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    chip: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHighest,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
    },
    excerpt: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
    },
    hoursRow: {
        flexDirection: 'row',
        gap: 12,
    },
    hoursField: {
        flex: 1,
    },
}));
