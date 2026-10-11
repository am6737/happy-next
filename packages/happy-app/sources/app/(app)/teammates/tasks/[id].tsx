import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ItemList } from '@/components/ItemList';
import { TeammateTaskPanel } from '@/components/teammates/TeammateTaskPanel';
import { styles } from '@/components/teammates/ui';

export default React.memo(function TeammateTaskScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    return <ItemList contentContainerStyle={styles.content}><TeammateTaskPanel id={id} /></ItemList>;
});
