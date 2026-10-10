import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../node_modules/react-native-ui-datepicker',
);
const wheelWebSource = readFileSync(
    resolve(packageRoot, 'src/components/time-picker/wheel-web.tsx'),
    'utf8',
);

function selectWheelValue(
    next: { value: number | string } | undefined,
    current: number | string,
    first: { value: number | string } | undefined,
): number | string | undefined {
    if (next?.value === current) return undefined;
    if (next != null && next.value != null) return next.value;
    if (first != null && first.value != null) return first.value;
    return undefined;
}

describe('Web date picker time wheel', () => {
    it('keeps numeric zero selectable for hours and minutes', () => {
        expect(selectWheelValue({ value: 0 }, 23, { value: 0 })).toBe(0);
        expect(selectWheelValue({ value: 0 }, 59, { value: 0 })).toBe(0);
        expect(selectWheelValue(undefined, 1, { value: 0 })).toBe(0);

        // This guards the patch applied to react-native-ui-datepicker: the old truthy checks
        // dropped both values because JavaScript treats numeric 0 as false.
        expect(wheelWebSource).toContain('newValue != null && newValue.value != null');
        expect(wheelWebSource).toContain('items[0] != null && items[0].value != null');
    });
});
