import { useCallback, useRef, useState } from 'react';
import type { NativeSyntheticEvent, TextInputChangeEventData } from 'react-native';

/**
 * The text of a field that acts on what is typed, as a search does, passed on only once typed: while
 * an input method is still composing — Chinese pinyin before a character is picked — the field shows
 * it, but acting on it would act on the letters. iOS says on each change whether the text is still
 * being composed (`isComposing`, from our React Native patch); elsewhere every change counts.
 *
 * The field keeps the text itself (`value` and `onChange` go on the `TextInput`), so it never waits
 * for a value back. Picking a candidate changes the text and passes it on; submitting or leaving the
 * field passes it on as well, for a composition committed as it was, which changes nothing.
 * `setText` puts a text in the field from outside and passes it on; `showText` only puts it there,
 * for a text the owner already has.
 */
export function useCommittedText(onCommit: (text: string) => void) {
    const [text, setTextState] = useState('');
    const textRef = useRef('');
    const committedRef = useRef('');
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    const commit = useCallback((value: string) => {
        if (value === committedRef.current) return;
        committedRef.current = value;
        onCommitRef.current(value);
    }, []);

    const showText = useCallback((value: string) => {
        textRef.current = value;
        committedRef.current = value;
        setTextState(value);
    }, []);

    const setText = useCallback((value: string) => {
        textRef.current = value;
        setTextState(value);
        commit(value);
    }, [commit]);

    const onChange = useCallback((e: NativeSyntheticEvent<TextInputChangeEventData>) => {
        const value = e.nativeEvent.text;
        textRef.current = value;
        setTextState(value);
        if (!(e.nativeEvent as { isComposing?: boolean }).isComposing) {
            commit(value);
        }
    }, [commit]);

    const commitCurrent = useCallback(() => commit(textRef.current), [commit]);

    return { value: text, onChange, onSubmitEditing: commitCurrent, onEndEditing: commitCurrent, setText, showText };
}
