import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface SavedTrack {
    source: 'local' | 'remote';
    id: string;
    title: string;
    artist?: string;
    library?: string;
}
export interface PlaylistEntry extends SavedTrack { entryId: string; }
export interface Playlist {
    id: string;
    ownerId: string;
    name: string;
    revision: number;
    entries: PlaylistEntry[];
}
interface Document { version: 1; playlists: Playlist[]; }
export const MAX_PLAYLISTS = 20;
export const MAX_PLAYLIST_TRACKS = 100;

// One shared writer per file, including module reloads. Atomic replacement protects the
// last valid document from interrupted writes. Run one bot process per data directory.
const writers = new Map<string, Promise<unknown>>();
export class PlaylistStore {
    constructor(private path = resolve('data/playlists.json')) {}
    private async read(): Promise<Document> {
        let raw: string;
        try { raw = await readFile(this.path, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, playlists: [] }; throw error; }
        const damaged = () => new Error('播放清單資料損壞，請管理者還原備份；原檔未被覆寫。');
        let doc: Document;
        try { doc = JSON.parse(raw) as Document; } catch { throw damaged(); }
        if (!doc || doc.version !== 1 || !Array.isArray(doc.playlists) || doc.playlists.some(p =>
            !p || typeof p.id !== 'string' || typeof p.ownerId !== 'string' || typeof p.name !== 'string' ||
            !Number.isSafeInteger(p.revision) || !Array.isArray(p.entries) || p.entries.some(e =>
                !e || typeof e.entryId !== 'string' || typeof e.id !== 'string' || typeof e.title !== 'string' ||
                !['local', 'remote'].includes(e.source)))) throw damaged();
        return doc;
    }
    private run<T>(task: (doc: Document) => T, write = false): Promise<T> {
        const operation = (writers.get(this.path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
            const doc = await this.read();
            const result = task(doc);
            if (write) {
                await mkdir(dirname(this.path), { recursive: true });
                const temporary = `${this.path}.${randomUUID()}.tmp`;
                try {
                    const file = await open(temporary, 'wx', 0o600);
                    try { await file.writeFile(JSON.stringify(doc)); await file.sync(); } finally { await file.close(); }
                    await rename(temporary, this.path);
                } finally { await rm(temporary, { force: true }); }
            }
            return structuredClone(result);
        });
        writers.set(this.path, operation);
        void operation.finally(() => { if (writers.get(this.path) === operation) writers.delete(this.path); }).catch(() => undefined);
        return operation;
    }
    private owned(doc: Document, owner: string, id: string): Playlist {
        const playlist = doc.playlists.find(p => p.id === id && p.ownerId === owner);
        if (!playlist) throw new Error('找不到你的播放清單，請重新選擇。');
        return playlist;
    }
    private name(doc: Document, owner: string, name: string, except?: string): string {
        name = name.normalize('NFKC').trim();
        if (!name || name.length > 60 || /[\r\n\x00-\x1f]/.test(name)) throw new Error('清單名稱須為 1–60 字且不可換行。');
        if (doc.playlists.some(p => p.ownerId === owner && p.id !== except && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            throw new Error('你已有同名的播放清單。');
        }
        return name;
    }
    list(owner: string): Promise<Playlist[]> { return this.run(doc => doc.playlists.filter(p => p.ownerId === owner)); }
    get(owner: string, id: string): Promise<Playlist> { return this.run(doc => this.owned(doc, owner, id)); }
    create(owner: string, name: string, tracks: SavedTrack[] = []): Promise<Playlist> {
        return this.run(doc => {
            if (doc.playlists.filter(p => p.ownerId === owner).length >= MAX_PLAYLISTS) throw new Error(`每人最多 ${MAX_PLAYLISTS} 份清單。`);
            if (tracks.length > MAX_PLAYLIST_TRACKS) throw new Error(`每份清單最多 ${MAX_PLAYLIST_TRACKS} 首。`);
            const playlist: Playlist = { id: randomUUID(), ownerId: owner, name: this.name(doc, owner, name), revision: 1,
                entries: tracks.map(t => ({ ...t, entryId: randomUUID() })) };
            doc.playlists.push(playlist);
            return playlist;
        }, true);
    }
    rename(owner: string, id: string, name: string): Promise<Playlist> {
        return this.run(doc => { const p = this.owned(doc, owner, id); p.name = this.name(doc, owner, name, id); p.revision++; return p; }, true);
    }
    delete(owner: string, id: string, revision: number): Promise<void> {
        return this.run(doc => {
            const p = this.owned(doc, owner, id);
            if (p.revision !== revision) throw new Error('清單已更新，請重新執行刪除並確認。');
            doc.playlists = doc.playlists.filter(item => item !== p);
        }, true);
    }
    add(owner: string, id: string, tracks: SavedTrack[]): Promise<Playlist> {
        return this.run(doc => {
            const p = this.owned(doc, owner, id);
            if (p.entries.length + tracks.length > MAX_PLAYLIST_TRACKS) throw new Error(`每份清單最多 ${MAX_PLAYLIST_TRACKS} 首，未加入任何歌曲。`);
            p.entries.push(...tracks.map(t => ({ ...t, entryId: randomUUID() }))); p.revision++; return p;
        }, true);
    }
    remove(owner: string, id: string, entryId: string): Promise<Playlist> {
        return this.run(doc => {
            const p = this.owned(doc, owner, id); const index = p.entries.findIndex(e => e.entryId === entryId);
            if (index < 0) throw new Error('此歌曲已不在清單中，請重新選擇。');
            p.entries.splice(index, 1); p.revision++; return p;
        }, true);
    }
    move(owner: string, id: string, entryId: string, position: number): Promise<Playlist> {
        return this.run(doc => {
            const p = this.owned(doc, owner, id); const index = p.entries.findIndex(e => e.entryId === entryId);
            if (index < 0) throw new Error('此歌曲已不在清單中，請重新選擇。');
            if (!Number.isInteger(position) || position < 1 || position > p.entries.length) throw new Error('目標位置超出清單範圍。');
            const [entry] = p.entries.splice(index, 1); p.entries.splice(position - 1, 0, entry); p.revision++; return p;
        }, true);
    }
}
export const playlists = new PlaylistStore();
