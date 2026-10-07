import { describe, expect, it } from 'vitest';
import { applyMachineOrder, mergeMachineOrder } from './machineOrder';

const id = (value: string) => value;

describe('applyMachineOrder', () => {
    it('puts saved machines first and keeps the rest in their incoming order', () => {
        expect(applyMachineOrder(['a', 'b', 'c', 'd'], id, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
    });

    it('ignores saved machines that are not in the list', () => {
        expect(applyMachineOrder(['a', 'b'], id, ['x', 'b'])).toEqual(['b', 'a']);
    });

    it('keeps the incoming order without a saved order', () => {
        expect(applyMachineOrder(['b', 'a'], id, [])).toEqual(['b', 'a']);
    });
});

describe('mergeMachineOrder', () => {
    it('keeps saved machines that are not shown after the shown ones', () => {
        expect(mergeMachineOrder(['a', 'off', 'b'], ['b', 'a'])).toEqual(['b', 'a', 'off']);
    });
});
