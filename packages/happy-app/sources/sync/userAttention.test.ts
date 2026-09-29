import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { createUserAttention, USER_IDLE_AFTER_MS } from './userAttention';

function setup(focused: boolean) {
    const env = { time: 1_000, focused };
    const attention = createUserAttention({
        now: () => env.time,
        isFocused: () => env.focused,
    });
    return { env, attention };
}

describe('createUserAttention', () => {
    it('counts a window that starts focused as present', () => {
        expect(setup(true).attention.isPresent()).toBe(true);
    });

    it('is not present while unfocused, even right after input', () => {
        const { env, attention } = setup(true);
        env.focused = false;
        attention.recordActivity();
        expect(attention.isPresent()).toBe(false);
    });

    it('goes idle after the threshold without input', () => {
        const { env, attention } = setup(true);
        env.time += USER_IDLE_AFTER_MS - 1;
        expect(attention.isPresent()).toBe(true);
        env.time += 1;
        expect(attention.isPresent()).toBe(false);
    });

    it('ignores input that arrives while unfocused', () => {
        const { env, attention } = setup(false);
        attention.recordActivity();
        env.focused = true;
        expect(attention.isPresent()).toBe(false);
    });

    it('notifies once when input brings the person back', () => {
        const { env, attention } = setup(false);
        const listener = vi.fn();
        attention.onPresent(listener);

        env.focused = true;
        attention.recordActivity();
        attention.recordActivity();
        expect(listener).toHaveBeenCalledTimes(1);

        env.time += USER_IDLE_AFTER_MS;
        attention.recordActivity();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('needs fresh input after leaving, even within the idle window', () => {
        const { env, attention } = setup(true);
        const listener = vi.fn();
        attention.onPresent(listener);

        env.focused = false;
        attention.recordLeave();
        env.time += 1_000;
        env.focused = true;
        expect(attention.isPresent()).toBe(false);

        attention.recordActivity();
        expect(attention.isPresent()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps presence when leave fires but focus stayed (iframe)', () => {
        const { attention } = setup(true);
        attention.recordLeave();
        expect(attention.isPresent()).toBe(true);
    });

    it('stops notifying after unsubscribe', () => {
        const { env, attention } = setup(false);
        const listener = vi.fn();
        const unsubscribe = attention.onPresent(listener);
        unsubscribe();
        env.focused = true;
        attention.recordActivity();
        expect(listener).not.toHaveBeenCalled();
    });
});
