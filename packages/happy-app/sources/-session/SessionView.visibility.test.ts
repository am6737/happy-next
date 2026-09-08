import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import { canForkSession } from '@/utils/sessionLifecycle';

// Exercise the actual JSX prop without loading the native screen's dependencies.
const source = ts.createSourceFile('SessionView.tsx',
    readFileSync(new URL('./SessionView.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions: string[] = [];
function visit(node: ts.Node): void {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'DuplicateSheet') {
        for (const prop of node.attributes.properties) {
            if (ts.isJsxAttribute(prop) && prop.name.getText(source) === 'visible' &&
                prop.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression) {
                expressions.push(prop.initializer.expression.getText(source));
            }
        }
    }
    ts.forEachChild(node, visit);
}
visit(source);

function visible(session: Session, duplicateSheetVisible: boolean): boolean {
    expect(expressions).toHaveLength(1);
    return new Function('session', 'duplicateSheetVisible', 'canForkSession',
        `return (${expressions[0]});`)(session, duplicateSheetVisible, canForkSession);
}

describe('SessionView duplicate sheet visibility', () => {
    it.each([undefined, 'running'])('opens offline sessions with lifecycle %s and survives heartbeat expiry', lifecycleState => {
        const session = { active: false, metadata: { lifecycleState } } as Session;
        expect(visible(session, true)).toBe(true);
        expect(visible(session, false)).toBe(false);
        session.active = true;
        expect(visible(session, true)).toBe(true);
        session.active = false;
        expect(visible(session, true)).toBe(true);
        session.metadata!.lifecycleState = 'archived';
        expect(visible(session, true)).toBe(false);
    });

    it.each([true, false])('hides explicitly archived sessions when active is %s', active => {
        const session = { active, metadata: { lifecycleState: 'archived' } } as Session;
        expect(visible(session, true)).toBe(false);
    });
});
