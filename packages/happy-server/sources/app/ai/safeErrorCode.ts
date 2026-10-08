export function safeErrorCode(value: string | null | undefined): string | null {
    return value && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null;
}
