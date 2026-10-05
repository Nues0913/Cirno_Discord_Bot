import { trackKey, type MusicTrack } from './musicTrack.js';
export type RepeatMode = 'off' | 'one' | 'all';
export interface QueueEntry { track: MusicTrack; requestedBy: string; }
export class MusicQueue {
    current?: QueueEntry;
    pending: QueueEntry[] = [];
    repeat: RepeatMode = 'off';
    add(entry: QueueEntry): void {
        if (this.pending.length >= 100) throw new Error('待播佇列已達 100 首上限。');
        this.pending.push(entry);
    }
    advance(reason: 'finished' | 'skip' | 'error'): QueueEntry | undefined {
        const previous = this.current;
        // Both natural completion and manual advance restart the current song in single-repeat mode.
        // Errors still remove the failed song, so repeat cannot trap the player on a bad file.
        if (reason !== 'error' && previous && this.repeat === 'one') return previous;
        if (previous && this.repeat === 'all' && reason !== 'error') {
            this.pending.push(previous);
        }
        if (reason === 'error' && previous) {
            this.pending = this.pending.filter(entry => trackKey(entry.track) !== trackKey(previous.track));
        }
        this.current = this.pending.shift();
        return this.current;
    }
    cycleRepeat(): void { this.repeat = this.repeat === 'off' ? 'one' : this.repeat === 'one' ? 'all' : 'off'; }
    shuffle(random = Math.random): void {
        for (let i = this.pending.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [this.pending[i], this.pending[j]] = [this.pending[j], this.pending[i]];
        }
    }
    clear(): void { this.current = undefined; this.pending = []; }
}

// Serializes guild mutations without retaining completed guilds forever.
export class GuildTasks {
    private tasks = new Map<string, Promise<unknown>>();
    run<T>(guildId: string, task: () => Promise<T> | T): Promise<T> {
        const result = (this.tasks.get(guildId) ?? Promise.resolve()).catch(() => undefined).then(task);
        this.tasks.set(guildId, result);
        void result.finally(() => {
            if (this.tasks.get(guildId) === result) this.tasks.delete(guildId);
        }).catch(() => undefined);
        return result;
    }
}
