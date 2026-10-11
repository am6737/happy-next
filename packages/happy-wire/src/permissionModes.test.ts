import { describe, expect, it } from 'vitest';
import { isPermissionModeForAgent, PermissionModeSchema } from './permissionModes';

describe('qoder permission modes', () => {
    it('accepts the qodercli modes Happy offers', () => {
        for (const mode of ['default', 'acceptEdits', 'auto', 'yolo']) {
            expect(isPermissionModeForAgent('qoder', mode)).toBe(true);
        }
        expect(isPermissionModeForAgent('qoder', 'plan')).toBe(false);
        expect(isPermissionModeForAgent('qoder', 'dontAsk')).toBe(false);
        expect(PermissionModeSchema.safeParse('dontAsk').success).toBe(false);
    });
});
