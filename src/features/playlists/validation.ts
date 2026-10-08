import { UserActionError } from '../../shared/logging/operationErrors.js';
import type { Playlist } from './model.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validatePlaylist(value: unknown, owner: string, id?: string): Playlist {
    const p = value as Playlist;
    if (!p || typeof p.id !== 'string' || !UUID.test(p.id) || (id && p.id !== id) || p.ownerId !== owner ||
        typeof p.name !== 'string' || !p.name.length || p.name.length > 60 || !Number.isSafeInteger(p.revision) || p.revision < 1 ||
        !Array.isArray(p.entries) || p.entries.length > 100 || p.entries.some(e => !e || !UUID.test(e.entryId) ||
            !['local', 'remote'].includes(e.source) || typeof e.id !== 'string' || typeof e.title !== 'string' ||
            (e.artist !== undefined && typeof e.artist !== 'string') || (e.library !== undefined && typeof e.library !== 'string'))) {
        throw new Error('清單服務回傳無效資料，操作已停止。');
    }
    return p;
}

export function validatePlaylistId(id: string): string {
    if (!UUID.test(id)) throw new UserActionError('播放清單或歌曲項目 ID 無效。');
    return id;
}
