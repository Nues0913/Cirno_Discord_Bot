import { UserActionError } from '../../../shared/logging/operationErrors.js';
import { trackKey, type MusicTrack } from './track.js';
export type RepeatMode = 'off' | 'one' | 'all';
export interface QueueEntry { track: MusicTrack; requestedBy: string; }
export class MusicQueue {
    current?: QueueEntry;
    pending: QueueEntry[] = [];
    repeat: RepeatMode = 'off';
    history: QueueEntry[] = [];
    revision = 0;
    add(entry: QueueEntry): void { this.addMany([entry]); }
    addMany(entries: QueueEntry[], next = false): void {
        if (this.pending.length + entries.length > 100) throw new UserActionError('待播佇列最多 100 首，未加入任何歌曲。');
        if (next) this.pending.unshift(...entries); else this.pending.push(...entries);
        this.revision++;
    }
    remove(position: number): QueueEntry {
        this.position(position);
        this.revision++;
        return this.pending.splice(position - 1, 1)[0];
    }
    move(from: number, to: number): void {
        this.position(from); this.position(to);
        const [entry] = this.pending.splice(from - 1, 1);
        this.pending.splice(to - 1, 0, entry); this.revision++;
    }
    clearPending(): void { this.pending = []; this.revision++; }
    private position(value: number): void {
        if (!Number.isInteger(value) || value < 1 || value > this.pending.length) throw new UserActionError('位置超出待播佇列範圍。');
    }
    previous(): QueueEntry {
        if (!this.history.length) throw new UserActionError('沒有上一首播放紀錄。');
        const previous = this.history[this.history.length - 1];
        const rotated = this.pending.lastIndexOf(previous);
        if (this.current && this.pending.length >= 100 && rotated < 0) throw new UserActionError('待播佇列已滿，請先移除一首再回上一首。');
        // Undo the previous repeat-all rotation rather than accumulating duplicates.
        if (rotated >= 0) this.pending.splice(rotated, 1);
        if (this.current) this.pending.unshift(this.current);
        this.current = this.history.pop()!; this.revision++;
        return this.current;
    }
    advance(reason: 'finished' | 'skip' | 'error'): QueueEntry | undefined {
        const previous = this.current;
        if (reason === 'finished' && previous && this.repeat === 'one') return previous;
        if (previous && reason !== 'error') {
            this.history.push(previous);
            if (this.history.length > 20) this.history.shift();
        }
        this.revision++;
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
        this.revision++;
        for (let i = this.pending.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [this.pending[i], this.pending[j]] = [this.pending[j], this.pending[i]];
        }
    }
    clear(): void { this.current = undefined; this.pending = []; this.history = []; this.revision++; }
}
