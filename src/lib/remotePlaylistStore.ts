import type { Playlist, SavedTrack } from './playlistStore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function settings() {
    const raw = process.env.PLAYLIST_API_URL?.trim();
    const token = process.env.PLAYLIST_API_TOKEN?.trim();
    if (!raw || !token || token.length < 32) throw new Error('請設定 PLAYLIST_API_URL 與獨立的 PLAYLIST_API_TOKEN（至少 32 字元）。');
    let base: URL;
    try { base = new URL(raw.endsWith('/') ? raw : `${raw}/`); } catch { throw new Error('PLAYLIST_API_URL 無效。'); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('PLAYLIST_API_URL 必須是沒有憑證或查詢參數的 HTTP(S) 網址。');
    return { base, token };
}
function validate(value: unknown, owner: string, id?: string): Playlist {
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
export class RemotePlaylistStore {
    private id(id: string): string {
        if (!UUID.test(id)) throw new Error('播放清單或歌曲項目 ID 無效。');
        return id;
    }
    private async request(owner: string, method: string, path: string, body?: unknown, timeout = 8000): Promise<unknown> {
        if (!/^[0-9]{17,20}$/.test(owner)) throw new Error('Discord 使用者 ID 無效。');
        const { base, token } = settings();
        let response: Response;
        try {
            response = await fetch(new URL(`v1/playlists${path}`, base), {
                method, headers: { Authorization: `Bearer ${token}`, 'X-Discord-User-Id': owner,
                    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(timeout)
            });
        } catch { throw new Error('無法連線至清單服務，請稍後重新確認清單；不會切換成本地儲存。'); }
        if (response.status === 204) return undefined;
        let value: unknown;
        try { value = await response.json(); } catch { throw new Error('清單服務回傳無效資料。'); }
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error('清單服務驗證失敗，請檢查專用 Bot 金鑰。');
            if (response.status === 404) throw new Error('找不到你的清單或項目，請確認 Server 已啟用新版清單 API。');
            if ([400, 409, 413].includes(response.status)) {
                const message = (value as { error?: unknown })?.error;
                throw new Error(typeof message === 'string' ? message.slice(0, 300) : '清單操作衝突，請重新讀取後操作。');
            }
            throw new Error(`清單服務暫時無法使用（HTTP ${response.status}）。`);
        }
        return value;
    }
    async list(owner: string): Promise<Playlist[]> {
        const result = await this.request(owner, 'GET', '', undefined, 2000) as { items?: unknown };
        if (!result || !Array.isArray(result.items) || result.items.length > 20) throw new Error('清單服務回傳無效資料。');
        return result.items.map(p => validate(p, owner));
    }
    async get(owner: string, id: string): Promise<Playlist> {
        return validate(await this.request(owner, 'GET', `/${this.id(id)}`, undefined, 2000), owner, id);
    }
    async create(owner: string, name: string, tracks: SavedTrack[] = []): Promise<Playlist> {
        return validate(await this.request(owner, 'POST', '', { name, tracks }), owner);
    }
    async rename(owner: string, id: string, name: string): Promise<Playlist> {
        const { revision } = await this.get(owner, id);
        return validate(await this.request(owner, 'PATCH', `/${this.id(id)}`, { name, revision }), owner, id);
    }
    async delete(owner: string, id: string, revision: number): Promise<void> {
        await this.request(owner, 'DELETE', `/${this.id(id)}`, { revision });
    }
    async add(owner: string, id: string, tracks: SavedTrack[]): Promise<Playlist> {
        const { revision } = await this.get(owner, id);
        return validate(await this.request(owner, 'POST', `/${this.id(id)}/entries`, { tracks, revision }), owner, id);
    }
    async remove(owner: string, id: string, entryId: string): Promise<Playlist> {
        const { revision } = await this.get(owner, id);
        return validate(await this.request(owner, 'DELETE', `/${this.id(id)}/entries/${this.id(entryId)}`, { revision }), owner, id);
    }
    async move(owner: string, id: string, entryId: string, position: number): Promise<Playlist> {
        const { revision } = await this.get(owner, id);
        return validate(await this.request(owner, 'PATCH', `/${this.id(id)}/entries/${this.id(entryId)}`, { revision, position }), owner, id);
    }
}
