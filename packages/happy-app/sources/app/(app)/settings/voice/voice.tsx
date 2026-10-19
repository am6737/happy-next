import React, { useState, useMemo } from 'react';
import { View, FlatList, Platform, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSettingMutable } from '@/sync/storage';
import { useUnistyles } from 'react-native-unistyles';
import { VOICES, type Voice, getVoiceName, getVoiceDescription } from '@/constants/Voices';
import { useVoicePreview } from '@/hooks/useVoicePreview';
import { VoiceDetailSheet } from '@/components/VoiceDetailSheet';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { SearchField } from '@/components/SearchField';

// On web, stop avatar taps from bubbling to the row (which would select + navigate).
const stopPropagation = (e: { stopPropagation: () => void }) => e.stopPropagation();
const webStopHandlers = Platform.OS === 'web'
    ? { onClick: stopPropagation, onPointerDown: stopPropagation, onTouchStart: stopPropagation }
    : {};

// A single voice row: avatar + name/description, a preview (play/pause) button,
// and a checkmark when selected. Tapping the row selects; tapping the avatar opens
// the detail sheet; tapping preview only plays.
function VoiceRow({
    voice,
    selected,
    onSelect,
    onShowDetail,
}: {
    voice: Voice;
    selected: boolean;
    onSelect: () => void;
    onShowDetail: () => void;
}) {
    const { isPlaying, loading, toggle } = useVoicePreview(voice.voiceType, voice.trialUrl);
    return (
        <Item
            title={[getVoiceName(voice), voice.flags].filter(Boolean).join(' ')}
            subtitle={getVoiceDescription(voice)}
            icon={
                <View {...webStopHandlers}>
                    <Pressable onPress={onShowDetail} hitSlop={6}>
                        <Image
                            source={{ uri: voice.avatar }}
                            style={{ width: 48, height: 48, borderRadius: 24 }}
                            contentFit="cover"
                            transition={150}
                        />
                    </Pressable>
                </View>
            }
            iconContainerStyle={{ width: 48, height: 48 }}
            rightElement={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Pressable
                        onPress={toggle}
                        hitSlop={8}
                        accessibilityLabel={t('settingsVoice.voicePreview')}
                    >
                        {loading ? (
                            <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                                <ActivityIndicator size="small" color="#007AFF" />
                            </View>
                        ) : (
                            <Ionicons
                                name={isPlaying ? 'pause-circle' : 'play-circle-outline'}
                                size={28}
                                color="#007AFF"
                            />
                        )}
                    </Pressable>
                    {selected ? (
                        <Ionicons name="checkmark-circle" size={24} color="#007AFF" />
                    ) : null}
                </View>
            }
            onPress={onSelect}
            showChevron={false}
        />
    );
}

export default function VoiceSelectionScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantVoice, setVoiceAssistantVoice] = useSettingMutable('voiceAssistantVoice');
    const [searchQuery, setSearchQuery] = useState('');
    const [detailVoice, setDetailVoice] = useState<Voice | null>(null);
    const [detailVisible, setDetailVisible] = useState(false);

    const filteredVoices = useMemo(() => {
        if (!searchQuery) return VOICES;
        const q = searchQuery.toLowerCase();
        return VOICES.filter(
            (v) =>
                v.name.toLowerCase().includes(q) ||
                v.nameEn.toLowerCase().includes(q) ||
                v.description.toLowerCase().includes(q) ||
                v.descriptionEn.toLowerCase().includes(q) ||
                v.voiceType.toLowerCase().includes(q),
        );
    }, [searchQuery]);

    const handleSelect = (voiceType: string | null) => {
        setVoiceAssistantVoice(voiceType);
        router.back();
    };

    const handleShowDetail = (voice: Voice) => {
        setDetailVoice(voice);
        setDetailVisible(true);
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Search Header */}
            <View style={{ paddingTop: 12, paddingBottom: 4, alignItems: 'center' }}>
                <View
                    style={{
                        width: '100%',
                        maxWidth: layout.maxWidth,
                        paddingHorizontal: Platform.select({ ios: 0, default: 4 }),
                    }}
                >
                    <SearchField
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={t('settingsVoice.voiceSearchPlaceholder')}
                        style={{ marginHorizontal: Platform.select({ ios: 16, default: 12 }) }}
                    />
                </View>
            </View>

            {/* Default option (shown only when not searching) */}
            {!searchQuery && (
                <ItemGroup>
                    <Item
                        title={t('settingsVoice.voiceDefault')}
                        icon={<Ionicons name="mic-outline" size={29} color="#8E8E93" />}
                        rightElement={
                            voiceAssistantVoice === null ? (
                                <Ionicons name="checkmark-circle" size={24} color="#007AFF" />
                            ) : null
                        }
                        onPress={() => handleSelect(null)}
                        showChevron={false}
                    />
                </ItemGroup>
            )}

            {/* Voice List */}
            <ItemGroup
                title={t('settingsVoice.voiceSelectTitle')}
                footer={t('settingsVoice.voiceFooter', { count: filteredVoices.length })}
            >
                <FlatList
                    data={filteredVoices}
                    keyExtractor={(item) => item.voiceType}
                    renderItem={({ item }) => (
                        <VoiceRow
                            voice={item}
                            selected={voiceAssistantVoice === item.voiceType}
                            onSelect={() => handleSelect(item.voiceType)}
                            onShowDetail={() => handleShowDetail(item)}
                        />
                    )}
                    scrollEnabled={false}
                />
            </ItemGroup>

            <VoiceDetailSheet
                visible={detailVisible}
                voice={detailVoice}
                selected={!!detailVoice && voiceAssistantVoice === detailVoice.voiceType}
                onClose={() => setDetailVisible(false)}
                onUse={(voiceType) => {
                    setDetailVisible(false);
                    handleSelect(voiceType);
                }}
                onClosed={() => setDetailVoice(null)}
            />
        </ItemList>
    );
}
