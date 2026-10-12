import * as React from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { FloatingOverlay } from './FloatingOverlay';

interface AgentInputAutocompleteProps {
    suggestions: React.ReactElement[];
    selectedIndex?: number;
    onSelect: (index: number) => void;
    itemHeight: number;
}

export const AgentInputAutocomplete = React.memo((props: AgentInputAutocompleteProps) => {
    const { suggestions, selectedIndex = -1, onSelect, itemHeight } = props;
    const { theme } = useUnistyles();

    if (suggestions.length === 0) {
        return null;
    }

    return (
        <FloatingOverlay maxHeight={240} keyboardShouldPersistTaps="handled" selectedIndex={selectedIndex} itemHeight={itemHeight}>
            {suggestions.map((suggestion, index) => (
                <Pressable
                    key={index}
                    onPress={() => onSelect(index)}
                    style={({ pressed }) => ({
                        height: itemHeight,
                        backgroundColor: pressed
                            ? theme.colors.floatingOverlay.pressed
                            : selectedIndex === index
                                ? theme.colors.floatingOverlay.selected
                                : 'transparent',
                    })}
                >
                    {suggestion}
                </Pressable>
            ))}
        </FloatingOverlay>
    );
});