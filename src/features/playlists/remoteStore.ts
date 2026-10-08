import type { Playlist, SavedTrack } from './model.js';
import { PlaylistHttpClient, type PlaylistClient } from './client.js';
import { validatePlaylist, validatePlaylistId } from './validation.js';

export class RemotePlaylistStore {
    constructor(private readonly client: PlaylistClient = new PlaylistHttpClient()) {}
    async list(owner: string): Promise<Playlist[]> {
        const result = await this.client.request(owner, 'GET', '', undefined, 2000) as { items?: unknown };
        if (!result || !Array.isArray(result.items) || result.items.length > 20) throw new Error('清單服務回傳無效資料。');
        return result.items.map(p => validatePlaylist(p, owner));
    }
    async get(owner: string, id: string): Promise<Playlist> {
        return validatePlaylist(await this.client.request(owner, 'GET', `/${validatePlaylistId(id)}`, undefined, 2000), owner, id);
    }
    async create(owner: string, name: string, tracks: SavedTrack[] = []): Promise<Playlist> {
        return validatePlaylist(await this.client.request(owner, 'POST', '', { name, tracks }), owner);
    }
    async rename(owner: string, id: string, name: string, expectedRevision?: number): Promise<Playlist> {
        const revision = expectedRevision ?? (await this.get(owner, id)).revision;
        return validatePlaylist(await this.client.request(owner, 'PATCH', `/${validatePlaylistId(id)}`, { name, revision }), owner, id);
    }
    async delete(owner: string, id: string, revision: number): Promise<void> {
        await this.client.request(owner, 'DELETE', `/${validatePlaylistId(id)}`, { revision });
    }
    async add(owner: string, id: string, tracks: SavedTrack[], expectedRevision?: number): Promise<Playlist> {
        const revision = expectedRevision ?? (await this.get(owner, id)).revision;
        return validatePlaylist(await this.client.request(owner, 'POST', `/${validatePlaylistId(id)}/entries`, { tracks, revision }), owner, id);
    }
    async remove(owner: string, id: string, entryId: string, expectedRevision?: number): Promise<Playlist> {
        const revision = expectedRevision ?? (await this.get(owner, id)).revision;
        return validatePlaylist(await this.client.request(owner, 'DELETE', `/${validatePlaylistId(id)}/entries/${validatePlaylistId(entryId)}`, { revision }), owner, id);
    }
    async move(owner: string, id: string, entryId: string, position: number, expectedRevision?: number): Promise<Playlist> {
        const revision = expectedRevision ?? (await this.get(owner, id)).revision;
        return validatePlaylist(await this.client.request(owner, 'PATCH', `/${validatePlaylistId(id)}/entries/${validatePlaylistId(entryId)}`, { revision, position }), owner, id);
    }
}
