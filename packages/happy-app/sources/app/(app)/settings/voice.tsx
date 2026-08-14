import { useState, useCallback } from 'react';
import { View, Platform } from 'react-native';
import { SpeechRateSlider } from '@/components/SpeechRateSlider';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { ActionMenuModal } from '@/components/ActionMenuModal';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { Text } from '@/components/StyledText';
import { useSettingMutable } from '@/sync/storage';
import { findLanguageByCode, getLanguageDisplayName, LANGUAGES } from '@/constants/Languages';
import { findVoiceByType, getVoiceName } from '@/constants/Voices';
import { t } from '@/text';
import { Switch } from '@/components/Switch';
import {
    getActionConfirmation,
    setActionConfirmation,
    getActionConfirmationSpeed,
    setActionConfirmationSpeed,
    getWelcomeMessage,
    hasCustomWelcomeMessage,
    type ActionConfirmationSpeed,
} from '@/sync/voiceConfig';

function truncate(s: string, maxLen: number): string {
    return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}


// On web, keep switch taps from bubbling to the row's onPress (which opens the speed picker).
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const switchWebStopHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

export default function VoiceSettingsScreen() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const [voiceAssistantLanguage] = useSettingMutable('voiceAssistantLanguage');
    const currentLanguage = findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];
    const [voiceAssistantVoice] = useSettingMutable('voiceAssistantVoice');
    const selectedVoice = findVoiceByType(voiceAssistantVoice);
    const [speechRate, setSpeechRate] = useSettingMutable('voiceAssistantSpeechRate');
    // Local mirror so the slider stays responsive; persist on release.
    const [speechRateLocal, setSpeechRateLocal] = useState(speechRate);

    // Local state that refreshes when returning from sub-pages
    const [sendConfirmationEnabled, setSendConfirmationEnabled] = useState(() => getActionConfirmation());
    const [confirmationSpeed, setConfirmationSpeed] = useState<ActionConfirmationSpeed>(() => getActionConfirmationSpeed());
    const [speedMenuVisible, setSpeedMenuVisible] = useState(false);
    const [welcomeMessage, setWelcomeMessageState] = useState(() => getWelcomeMessage());

    useFocusEffect(
        useCallback(() => {
            setSendConfirmationEnabled(getActionConfirmation());
            setConfirmationSpeed(getActionConfirmationSpeed());
            setWelcomeMessageState(getWelcomeMessage());
        }, []),
    );

    const handleSendConfirmationChange = (value: boolean) => {
        setActionConfirmation(value);
        setSendConfirmationEnabled(value);
        // Picking the countdown speed is now part of enabling confirmation.
        if (value) setSpeedMenuVisible(true);
    };

    const handleSpeedChange = (value: ActionConfirmationSpeed) => {
        setActionConfirmationSpeed(value);
        setConfirmationSpeed(value);
    };

    const SPEED_SECONDS: Record<ActionConfirmationSpeed, number> = { fast: 3, normal: 5, slow: 8 };
    const speedLabel: Record<ActionConfirmationSpeed, string> = {
        fast: t('settingsVoice.speedFast'),
        normal: t('settingsVoice.speedNormal'),
        slow: t('settingsVoice.speedSlow'),
    };
    const speedMenuItems: ActionMenuItem[] = (['fast', 'normal', 'slow'] as const).map((s) => ({
        label: speedLabel[s],
        selected: confirmationSpeed === s,
        onPress: () => handleSpeedChange(s),
    }));

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Welcome Message */}
            <ItemGroup
                title={t('settingsVoice.welcomeMessageTitle')}
                footer={t('settingsVoice.welcomeMessageDescription')}
            >
                <Item
                    title={t('settingsVoice.welcomeMessage')}
                    icon={<Ionicons name="chatbubble-ellipses-outline" size={29} color="#FF9500" />}
                    detail={welcomeMessage ? truncate(welcomeMessage, 30) : t('settingsVoice.usingDefaultConfig')}
                    subtitle={hasCustomWelcomeMessage() ? t('settingsVoice.usingCustomConfig') : t('settingsVoice.usingDefaultConfig')}
                    onPress={() => router.push('/settings/voice/welcome-message')}
                />
            </ItemGroup>

            {/* Language Settings */}
            <ItemGroup
                title={t('settingsVoice.languageTitle')}
                footer={t('settingsVoice.languageDescription')}
            >
                <Item
                    title={t('settingsVoice.preferredLanguage')}
                    subtitle={t('settingsVoice.preferredLanguageSubtitle')}
                    icon={<Ionicons name="language-outline" size={29} color="#007AFF" />}
                    detail={getLanguageDisplayName(currentLanguage)}
                    onPress={() => router.push('/settings/voice/language')}
                />
            </ItemGroup>

            {/* Voice / Timbre */}
            <ItemGroup
                title={t('settingsVoice.voiceTitle')}
                footer={t('settingsVoice.voiceDescription')}
            >
                <Item
                    title={t('settingsVoice.voiceSelectTitle')}
                    icon={<Ionicons name="mic-outline" size={29} color="#AF52DE" />}
                    detail={selectedVoice ? getVoiceName(selectedVoice) : t('settingsVoice.voiceDefault')}
                    onPress={() => router.push('/settings/voice/voice')}
                />
            </ItemGroup>

            {/* Speech Rate */}
            <ItemGroup
                title={t('settingsVoice.speechRateTitle')}
                footer={t('settingsVoice.speechRateDescription')}
            >
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 20, marginBottom: 4 }}>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
                            {speechRateLocal === 0
                                ? t('settingsVoice.speechRateNormal')
                                : String(speechRateLocal)}
                        </Text>
                    </View>
                    <SpeechRateSlider
                        minimumValue={-50}
                        maximumValue={100}
                        step={5}
                        value={speechRateLocal}
                        onValueChange={(v) => setSpeechRateLocal(Math.round(v))}
                        onSlidingComplete={(v) => setSpeechRate(Math.round(v))}
                        minimumTrackTintColor="#007AFF"
                        maximumTrackTintColor={theme.colors.divider}
                        thumbTintColor="#007AFF"
                    />
                </View>
            </ItemGroup>

            {/* Send Confirmation (with countdown speed picker) */}
            <ItemGroup
                title={t('settingsVoice.actionConfirmationTitle')}
                footer={t('settingsVoice.actionConfirmationDescription')}
            >
                <Item
                    title={t('settingsVoice.actionConfirmationLabel')}
                    subtitle={t('settingsVoice.actionConfirmationSubtitle')}
                    icon={<Ionicons name="shield-checkmark-outline" size={29} color="#34C759" />}
                    rightElement={
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            {sendConfirmationEnabled && (
                                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                                    {`${SPEED_SECONDS[confirmationSpeed]}s`}
                                </Text>
                            )}
                            <View {...switchWebStopHandlers}>
                                <Switch
                                    value={sendConfirmationEnabled}
                                    onValueChange={handleSendConfirmationChange}
                                />
                            </View>
                        </View>
                    }
                    onPress={sendConfirmationEnabled ? () => setSpeedMenuVisible(true) : undefined}
                    showChevron={false}
                />
            </ItemGroup>

            <ActionMenuModal
                visible={speedMenuVisible}
                title={t('settingsVoice.actionConfirmationSpeedTitle')}
                items={speedMenuItems}
                onClose={() => setSpeedMenuVisible(false)}
            />
        </ItemList>
    );
}
