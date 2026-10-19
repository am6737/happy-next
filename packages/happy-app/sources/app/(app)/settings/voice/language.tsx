import React, { useState, useMemo } from 'react';
import { View, FlatList, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSettingMutable } from '@/sync/storage';
import { useUnistyles } from 'react-native-unistyles';
import { LANGUAGES, getLanguageDisplayName } from '@/constants/Languages';
import { t } from '@/text';
import { layout } from '@/components/layout';
import { SearchField } from '@/components/SearchField';

export default function LanguageSelectionScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const [voiceAssistantLanguage, setVoiceAssistantLanguage] = useSettingMutable('voiceAssistantLanguage');
    const [searchQuery, setSearchQuery] = useState('');

    // Filter languages based on search query
    const filteredLanguages = useMemo(() => {
        if (!searchQuery) return LANGUAGES;
        
        const query = searchQuery.toLowerCase();
        return LANGUAGES.filter(lang => 
            lang.name.toLowerCase().includes(query) ||
            lang.nativeName.toLowerCase().includes(query) ||
            (lang.code && lang.code.toLowerCase().includes(query)) ||
            (lang.region && lang.region.toLowerCase().includes(query))
        );
    }, [searchQuery]);


    const handleLanguageSelect = (languageCode: string | null) => {
        setVoiceAssistantLanguage(languageCode);
        router.back();
    };

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Search Header */}
            <View style={{
                paddingTop: 12,
                paddingBottom: 4,
                alignItems: 'center',
            }}>
                <View style={{
                    width: '100%',
                    maxWidth: layout.maxWidth,
                    paddingHorizontal: Platform.select({ ios: 0, default: 4 }),
                }}>
                    <SearchField
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={t('settingsVoice.language.searchPlaceholder')}
                        style={{ marginHorizontal: Platform.select({ ios: 16, default: 12 }) }}
                    />
                </View>
            </View>

            {/* Language List */}
            <ItemGroup 
                title={t('settingsVoice.language.title')} 
                footer={t('settingsVoice.language.footer', { count: filteredLanguages.length })}
            >
                <FlatList
                    data={filteredLanguages}
                    keyExtractor={(item) => item.code || 'autodetect'}
                    renderItem={({ item }) => (
                        <Item
                            title={getLanguageDisplayName(item)}
                            subtitle={item.code || t('settingsVoice.language.autoDetect')}
                            icon={<Ionicons name="language-outline" size={29} color="#007AFF" />}
                            rightElement={
                                voiceAssistantLanguage === item.code ? (
                                    <Ionicons name="checkmark-circle" size={24} color="#007AFF" />
                                ) : null
                            }
                            onPress={() => handleLanguageSelect(item.code)}
                            showChevron={false}
                        />
                    )}
                    scrollEnabled={false}
                />
            </ItemGroup>
        </ItemList>
    );
}
