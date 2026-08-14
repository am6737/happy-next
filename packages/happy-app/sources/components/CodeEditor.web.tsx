import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
    Decoration,
    EditorView,
    drawSelection,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from '@codemirror/view';
import {
    StreamLanguage,
    defaultHighlightStyle,
    syntaxHighlighting,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { MONO_FONT_STACK } from '@/components/codeEditorConstants';

interface CodeEditorProps {
    value: string;
    onChangeText: (text: string) => void;
    bottomPadding?: number;
    language?: string;
    readOnly?: boolean;
    revealLine?: number;
    revealColumn?: number;
    lineWrapping?: boolean;
}

export interface CodeEditorHandle {
    focus: () => void;
    blur: () => void;
}

interface EditorCompartments {
    language: Compartment;
    theme: Compartment;
    readOnly: Compartment;
    editable: Compartment;
    bottomPadding: Compartment;
    lineWrapping: Compartment;
}

const targetLineEffect = StateEffect.define<{ line: number; theme: 'light' | 'dark' }>();

const targetLineField = StateField.define({
    create: () => Decoration.none,
    update(decorations, transaction) {
        decorations = decorations.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (effect.is(targetLineEffect)) {
                const line = transaction.state.doc.line(effect.value.line);
                const className = effect.value.theme === 'dark'
                    ? 'happy-target-line-dark'
                    : 'happy-target-line-light';
                decorations = Decoration.set([
                    Decoration.line({ class: className }).range(line.from),
                ]);
            }
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

function getLanguageExtension(language: string): Extension {
    switch ((language || '').toLowerCase()) {
        case 'javascript':
        case 'jsx':
            return javascript({ jsx: true });
        case 'typescript':
        case 'tsx':
            return javascript({ jsx: true, typescript: true });
        case 'python':
            return python();
        case 'html':
        case 'htm':
            return html();
        case 'css':
            return css();
        case 'json':
            return json();
        case 'markdown':
        case 'md':
            return markdown();
        case 'xml':
            return xml();
        case 'yaml':
        case 'yml':
            return yaml();
        case 'sql':
            return sql();
        case 'shell':
        case 'bash':
        case 'sh':
            return StreamLanguage.define(shell);
        default:
            return [];
    }
}

function getThemeExtension(theme: 'light' | 'dark'): Extension {
    const isDark = theme === 'dark';
    return [
        EditorView.theme({
            '&': {
                height: '100%',
                backgroundColor: isDark ? '#14161a' : '#ffffff',
                color: isDark ? '#d4d4d4' : '#1f2328',
            },
            '.cm-scroller': {
                overflow: 'auto',
                fontFamily: MONO_FONT_STACK,
                fontSize: '14px',
                lineHeight: '20px',
            },
            '.cm-cursor, .cm-dropCursor': {
                borderLeftColor: isDark ? '#d4d4d4' : '#1f2328',
            },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
                backgroundColor: isDark ? '#264f78' : '#add6ff',
            },
            '.cm-gutters': {
                backgroundColor: isDark ? '#14161a' : '#ffffff',
                borderRight: 'none',
                userSelect: 'none',
            },
            '.cm-lineNumbers .cm-gutterElement': {
                color: isDark ? '#6b7280' : '#9ca3af',
            },
            '.cm-activeLineGutter .cm-gutterElement, .cm-gutterElement.cm-activeLineGutter': {
                color: isDark ? '#9ca3af' : '#4b5563',
            },
            '.happy-target-line-dark': {
                background: '#ff8a0038',
                borderLeft: '3px solid #ff9f1a',
            },
            '.happy-target-line-light': {
                background: '#ff6a0026',
                borderLeft: '3px solid #d9480f',
            },
        }, { dark: isDark }),
        syntaxHighlighting(isDark ? oneDarkHighlightStyle : defaultHighlightStyle),
    ];
}

function getBottomPaddingExtension(bottomPadding: number): Extension {
    const padding = Number.isFinite(bottomPadding) ? Math.max(0, bottomPadding) : 16;
    return EditorView.contentAttributes.of({
        style: `padding-top: 12px; padding-bottom: ${padding}px;`,
    });
}

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(({
    value,
    onChangeText,
    bottomPadding = 16,
    language = 'plaintext',
    readOnly = false,
    revealLine,
    revealColumn,
    lineWrapping = false,
}, ref) => {
    const { rt } = useUnistyles();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const editorRef = React.useRef<EditorView | null>(null);
    const compartmentsRef = React.useRef<EditorCompartments | null>(null);
    const lastValueFromEditorRef = React.useRef(value);
    const suppressChangesRef = React.useRef(false);
    const onChangeTextRef = React.useRef(onChangeText);
    onChangeTextRef.current = onChangeText;
    const themeMode = rt.themeName === 'dark' ? 'dark' : 'light';

    React.useEffect(() => {
        const parent = containerRef.current;
        if (!parent) return;

        const compartments: EditorCompartments = {
            language: new Compartment(),
            theme: new Compartment(),
            readOnly: new Compartment(),
            editable: new Compartment(),
            bottomPadding: new Compartment(),
            lineWrapping: new Compartment(),
        };
        compartmentsRef.current = compartments;

        const updateListener = EditorView.updateListener.of((update) => {
            if (!update.docChanged || suppressChangesRef.current) return;
            const nextValue = update.state.doc.toString();
            lastValueFromEditorRef.current = nextValue;
            onChangeTextRef.current(nextValue);
        });

        const state = EditorState.create({
            doc: value,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                drawSelection(),
                history(),
                compartments.language.of(getLanguageExtension(language)),
                compartments.theme.of(getThemeExtension(themeMode)),
                compartments.readOnly.of(EditorState.readOnly.of(readOnly)),
                compartments.editable.of(EditorView.editable.of(!readOnly)),
                compartments.bottomPadding.of(getBottomPaddingExtension(bottomPadding)),
                compartments.lineWrapping.of(lineWrapping ? EditorView.lineWrapping : []),
                EditorView.contentAttributes.of({ tabindex: '0' }),
                targetLineField,
                highlightSelectionMatches(),
                keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
                updateListener,
            ],
        });

        const editor = new EditorView({ state, parent });
        editorRef.current = editor;

        return () => {
            editor.destroy();
            editorRef.current = null;
            compartmentsRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        const editor = editorRef.current;
        if (!editor || value === lastValueFromEditorRef.current) return;
        lastValueFromEditorRef.current = value;
        suppressChangesRef.current = true;
        try {
            editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: value },
            });
        } finally {
            suppressChangesRef.current = false;
        }
    }, [value]);

    React.useEffect(() => {
        const editor = editorRef.current;
        const compartments = compartmentsRef.current;
        if (!editor || !compartments) return;
        editor.dispatch({ effects: compartments.language.reconfigure(getLanguageExtension(language)) });
    }, [language]);

    React.useEffect(() => {
        const editor = editorRef.current;
        const compartments = compartmentsRef.current;
        if (!editor || !compartments) return;
        editor.dispatch({ effects: compartments.theme.reconfigure(getThemeExtension(themeMode)) });
    }, [themeMode]);

    React.useEffect(() => {
        const editor = editorRef.current;
        const compartments = compartmentsRef.current;
        if (!editor || !compartments) return;
        editor.dispatch({
            effects: [
                compartments.readOnly.reconfigure(EditorState.readOnly.of(readOnly)),
                compartments.editable.reconfigure(EditorView.editable.of(!readOnly)),
            ],
        });
    }, [readOnly]);

    React.useEffect(() => {
        const editor = editorRef.current;
        const compartments = compartmentsRef.current;
        if (!editor || !compartments) return;
        editor.dispatch({
            effects: compartments.bottomPadding.reconfigure(getBottomPaddingExtension(bottomPadding)),
        });
    }, [bottomPadding]);

    React.useEffect(() => {
        const editor = editorRef.current;
        const compartments = compartmentsRef.current;
        if (!editor || !compartments) return;
        editor.dispatch({
            effects: compartments.lineWrapping.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
        });
    }, [lineWrapping]);

    React.useEffect(() => {
        const editor = editorRef.current;
        if (!editor || !revealLine || !Number.isFinite(revealLine) || revealLine < 1) return;

        const lineNumber = Math.min(editor.state.doc.lines, Math.max(1, Math.floor(revealLine)));
        const line = editor.state.doc.line(lineNumber);
        const requestedColumn = revealColumn && Number.isFinite(revealColumn)
            ? Math.floor(revealColumn)
            : 1;
        const column = Math.min(line.length + 1, Math.max(1, requestedColumn));
        const position = line.from + column - 1;

        editor.dispatch({
            selection: { anchor: position },
            effects: [
                EditorView.scrollIntoView(position, { y: 'center' }),
                targetLineEffect.of({ line: lineNumber, theme: themeMode }),
            ],
        });
    }, [revealColumn, revealLine, themeMode]);

    React.useImperativeHandle(ref, () => ({
        focus: () => editorRef.current?.focus(),
        blur: () => editorRef.current?.contentDOM.blur(),
    }), []);

    return (
        <View style={{ flex: 1 }}>
            <div
                ref={containerRef}
                style={{ width: '100%', height: '100%', overflow: 'hidden' }}
            />
        </View>
    );
});

CodeEditor.displayName = 'CodeEditor';
