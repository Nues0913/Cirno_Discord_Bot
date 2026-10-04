export type VoiceOwner = 'entrance' | 'music';

export class VoiceLease {
    private cleanups: Array<() => void> = [];
    private disposed = false;
    constructor(readonly guildId: string, readonly owner: VoiceOwner, private manager: VoiceSessionManager) {}
    get active(): boolean { return !this.disposed && this.manager.current(this.guildId) === this; }
    onDispose(cleanup: () => void): void {
        if (this.disposed) cleanup();
        else this.cleanups.push(cleanup);
    }
    release(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.manager.release(this);
        // All resources must be released even if one cleanup fails.
        for (const cleanup of this.cleanups.splice(0)) {
            try { cleanup(); } catch { /* cleanup must not invalidate the new owner */ }
        }
    }
}

export class VoiceSessionManager {
    private leases = new Map<string, VoiceLease>();
    current(guildId: string): VoiceLease | undefined { return this.leases.get(guildId); }
    acquire(guildId: string, owner: VoiceOwner): VoiceLease | undefined {
        const previous = this.leases.get(guildId);
        if (owner === 'entrance' && previous?.owner === 'music') return undefined;
        const lease = new VoiceLease(guildId, owner, this);
        // Invalidate the old owner before running callbacks that may release it.
        this.leases.set(guildId, lease);
        previous?.release();
        return lease;
    }
    release(lease: VoiceLease): void {
        if (this.leases.get(lease.guildId) === lease) this.leases.delete(lease.guildId);
    }
}

export const voiceSessions = new VoiceSessionManager();
