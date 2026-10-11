/** Controller sessions remain hidden; only worker metadata identifies an Agent badge. */
export function workerTeammateId(metadata?: { teammate?: { id: string; role: string } } | null): string | null {
    return metadata?.teammate?.role === 'worker' ? metadata.teammate.id : null;
}
