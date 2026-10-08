import type { RemotePage } from '../library/remoteLibrary.js';
import type { MusicSource } from '../application/catalog.js';
export interface Browser {
    userId: string; guildId: string; sessionId?: string; kind: 'library' | 'queue';
    source: MusicSource; query: string; page: number; expires: number; next: boolean;
    ids: string[]; remotePages: Map<number, RemotePage>;
}

export class BrowserRegistry {
    private readonly records = new Map<string, Browser>();
    clear(): void { this.records.clear(); }
    prune(): void {
        for (const [key, browser] of this.records) if (browser.expires < Date.now()) this.records.delete(key);
    }
    set(key: string, browser: Browser): void {
        this.prune(); this.records.set(key, browser);
        while (this.records.size > 1000) this.records.delete(this.records.keys().next().value!);
    }
    get(key: string): Browser | undefined { this.prune(); return this.records.get(key); }
}
export const browsers = new BrowserRegistry();
