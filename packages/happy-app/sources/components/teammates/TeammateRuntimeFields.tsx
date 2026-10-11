import React from 'react';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import {
    FAST_MODE_SUFFIX, MODEL_MODE_DEFAULT,
    buildClaudeModelMode, buildCodexModelMode, claudeAlways1M, claudeBaseFamily, claudeFamilyWith1M, claudeHas1MOptIn, claudeSupportsFastMode,
    formatReasoningEffortLabel, getClaudeReasoningOptions, getCodexReasoningOptions, getModelFamilyOptions, getPermissionModesForAgent,
    isModelModeForAgent, parseClaudeModelMode, parseCodexModelMode, splitFastModeSuffix,
    type PermissionMode, type TeammateWorkerProvider,
} from 'happy-wire';
import { useSetting } from '@/sync/storage';
import { DEFAULT_PROFILES, getBuiltInProfile } from '@/sync/profileUtils';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { teammatePermissionLabel } from './ui';
import { PillGroup, Segmented, SwitchRow } from './TeammateFormFields';

const MACHINE_CONFIG = '';

export type TeammateRuntimeValue<P extends TeammateWorkerProvider = TeammateWorkerProvider> = {
    provider: P;
    /** Model catalog mode, optionally `-fast`; '' means the provider default. */
    model: string;
    permissionMode: PermissionMode;
    /** '' means the machine's own configuration. */
    profileId: string;
};

/**
 * Provider, model (family, reasoning effort, 1M context, fast), permission mode and environment profile for one
 * Agent runtime role, mirroring what the new-session page offers. Models outside the catalog (older free-text
 * values) stay selectable so editing an Agent never silently changes its model.
 */
export function TeammateRuntimeFields<P extends TeammateWorkerProvider>({ title, hint, providers, value, onChange }: {
    title: string; hint: string; providers: readonly P[]; value: TeammateRuntimeValue<P>; onChange: (value: TeammateRuntimeValue<P>) => void;
}) {
    const customProfiles = useSetting('profiles');
    const { provider } = value;
    const { mode, fast } = splitFastModeSuffix(value.model || MODEL_MODE_DEFAULT);
    const custom = !isModelModeForAgent(provider, mode);
    const claude = parseClaudeModelMode(mode);
    const codex = parseCodexModelMode(mode);
    const family = custom || provider === 'gemini' ? mode : provider === 'claude' ? claude.family : codex.family;
    const baseFamily = provider === 'claude' ? claudeBaseFamily(family) : family;
    const efforts: readonly string[] = custom || family === MODEL_MODE_DEFAULT || provider === 'gemini' ? []
        : provider === 'claude' ? getClaudeReasoningOptions(family) : getCodexReasoningOptions(family);
    const effort = (provider === 'claude' ? claude.effort : codex.effort) ?? efforts[0];
    const supportsFast = provider === 'claude' && !custom && claudeSupportsFastMode(baseFamily);
    const optIn1m = provider === 'claude' && !custom && claudeHas1MOptIn(baseFamily) && !claudeAlways1M(baseFamily);

    const familyOptions = getModelFamilyOptions(provider).map(option => ({
        id: option.value, label: option.value === MODEL_MODE_DEFAULT ? t('teammates.defaultModel') : option.label,
    }));
    const profiles = [...DEFAULT_PROFILES.map(profile => getBuiltInProfile(profile.id)!), ...customProfiles]
        .filter(profile => profile.compatibility[provider] || profile.id === value.profileId);

    const setModel = (nextFamily: string, nextEffort: string | undefined, nextFast: boolean) => {
        const choose = (options: readonly string[]) => nextEffort && options.includes(nextEffort) ? nextEffort : options.includes('high') ? 'high' : options[0];
        const catalogFamily = familyOptions.some(option => option.id === claudeBaseFamily(nextFamily));
        const built = nextFamily === MODEL_MODE_DEFAULT || provider === 'gemini' || !catalogFamily
            ? nextFamily
            : provider === 'claude'
                ? buildClaudeModelMode(nextFamily, choose(getClaudeReasoningOptions(nextFamily)) as Parameters<typeof buildClaudeModelMode>[1])
                : buildCodexModelMode(nextFamily, choose(getCodexReasoningOptions(nextFamily)) as Parameters<typeof buildCodexModelMode>[1]);
        const withFast = nextFast && provider === 'claude' && claudeSupportsFastMode(claudeBaseFamily(nextFamily)) ? `${built}${FAST_MODE_SUFFIX}` : built;
        onChange({ ...value, model: withFast === MODEL_MODE_DEFAULT ? '' : withFast });
    };

    return (
        <View style={styles.section}>
            <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.hint}>{hint}</Text>
            </View>
            <Segmented
                label={t('teammates.provider')}
                value={provider}
                options={providers.map(id => ({ id, label: t(`agentInput.agent.${id as TeammateWorkerProvider}`) }))}
                onChange={next => onChange({ provider: next, model: '', permissionMode: 'default', profileId: value.profileId })}
            />
            <PillGroup
                label={t('teammates.model')}
                value={baseFamily}
                options={custom ? [...familyOptions, { id: mode, label: mode }] : familyOptions}
                onChange={next => setModel(next, effort, fast)}
            />
            {efforts.length > 0 && (
                <PillGroup
                    label={t('agentInput.model.reasoningEffort')}
                    value={effort}
                    options={efforts.map(id => ({ id, label: formatReasoningEffortLabel(id) ?? id }))}
                    onChange={next => setModel(family, next, fast)}
                />
            )}
            {optIn1m && (
                <SwitchRow title={t('agentInput.model.context1m')} value={family !== baseFamily} onChange={on => setModel(claudeFamilyWith1M(baseFamily, on), effort, fast)} />
            )}
            {supportsFast && <SwitchRow title={t('agentInput.model.fastMode')} value={fast} onChange={on => setModel(family, effort, on)} />}
            <PillGroup
                label={t('agentInput.permissionMode.title')}
                value={value.permissionMode}
                options={getPermissionModesForAgent(provider).map(id => ({ id, label: teammatePermissionLabel(id) }))}
                onChange={next => onChange({ ...value, permissionMode: next })}
            />
            <PillGroup
                label={t('teammates.envProfile')}
                value={value.profileId}
                options={[{ id: MACHINE_CONFIG, label: t('teammates.machineConfig') }, ...profiles.map(profile => ({ id: profile.id, label: profile.name }))]}
                onChange={next => onChange({ ...value, profileId: next })}
            />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    section: {
        gap: 16,
    },
    header: {
        gap: 2,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text,
    },
    hint: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
    },
}));
