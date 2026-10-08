import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { parseFile } from 'music-metadata';

export const AUDIO_EXTENSIONS = new Set(['.webm', '.opus', '.ogg', '.m4a', '.mp3', '.wav']);
export type { LocalTrack } from '../model/track.js';
import type { LocalTrack } from '../model/track.js';

export function isWithin(root: string, file: string): boolean {
    const rel = relative(root, file);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export class LocalMusicLibrary {
    private tracks = new Map<string, LocalTrack>();
    private cache = new Map<string, { stamp: string; track: LocalTrack }>();
    private loaded = false;
    private scanning?: Promise<LocalTrack[]>;
    constructor(private directory?: string) {}
    get root(): string { return resolve(this.directory ?? (process.env.MUSIC_AUDIO_DIRECTORY?.trim() || 'assets/songs')); }
    async load(): Promise<LocalTrack[]> { return this.loaded ? this.all() : this.reload(); }
    all(): LocalTrack[] { return [...this.tracks.values()]; }
    get(id: string): LocalTrack | undefined { return this.tracks.get(id); }
    search(query: string): LocalTrack[] {
        const words = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        return this.all().filter(track => {
            const text = `${track.title} ${track.artist ?? ''} ${track.filename} ${track.id}`.normalize('NFKC').toLocaleLowerCase();
            return words.every(word => text.includes(word));
        });
    }
    reload(): Promise<LocalTrack[]> {
        if (!this.scanning) {
            this.scanning = this.scan().finally(() => { this.scanning = undefined; });
        }
        return this.scanning;
    }
    private async scan(): Promise<LocalTrack[]> {
        const next = new Map<string, LocalTrack>();
        const nextCache = new Map<string, { stamp: string; track: LocalTrack }>();
        let root: string;
        try { root = await realpath(this.root); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            this.tracks = next; this.cache = nextCache; this.loaded = true;
            return [];
        }
        const entries = (await readdir(root, { withFileTypes: true }))
            .filter(entry => (entry.isFile() || entry.isSymbolicLink()) && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        for (const entry of entries) {
            try {
                const path = resolve(root, entry.name);
                const actual = await realpath(path);
                if (!isWithin(root, actual)) continue;
                const info = await stat(actual);
                if (!info.isFile()) continue;
                const stamp = `${actual}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
                let track = this.cache.get(path)?.stamp === stamp ? this.cache.get(path)!.track : undefined;
                if (!track) {
                    const metadata = await parseFile(actual, { skipCovers: true }).catch(() => undefined);
                    const duration = metadata?.format.duration;
                    track = {
                        id: createHash('sha256').update(path).digest('hex').slice(0, 16), path,
                        filename: entry.name,
                        title: metadata?.common.title?.trim() || basename(entry.name, extname(entry.name)),
                        artist: metadata?.common.artist?.trim() || undefined,
                        duration: duration && Number.isFinite(duration) && duration > 0 ? duration : undefined
                    };
                }
                next.set(track.id, track);
                nextCache.set(path, { stamp, track });
            } catch { /* Files can disappear during a scan. */ }
        }
        this.tracks = next; this.cache = nextCache; this.loaded = true;
        return this.all();
    }
    async playablePath(track: LocalTrack): Promise<string> {
        const root = await realpath(this.root);
        const actual = await realpath(track.path);
        if (!isWithin(root, actual) || !(await stat(actual)).isFile()) throw new Error('音檔已移除或不在曲庫內。');
        return actual;
    }
}
export const musicLibrary = new LocalMusicLibrary();
