export interface RemoteTrack {
    source: 'remote';
    id: string;
    title: string;
    artist?: string;
    duration?: number;
    mimeType: string;
    byteSize: number;
    sha256: string;
}

export interface RemotePage { items: RemoteTrack[]; nextCursor?: string; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const MAX_AUDIO_BYTES = 268_435_456;
export const isRemoteId = (value: string): boolean => UUID.test(value);

function settings(): { base: URL; token: string } {
    const raw = process.env.REMOTE_MUSIC_API_URL?.trim();
    const token = process.env.REMOTE_MUSIC_API_TOKEN?.trim();
    if (!raw || !token) throw new Error('遠端曲庫未設定，請設定 REMOTE_MUSIC_API_URL 與 REMOTE_MUSIC_API_TOKEN。');
    let base: URL;
    try { base = new URL(raw.endsWith('/') ? raw : `${raw}/`); }
    catch { throw new Error('REMOTE_MUSIC_API_URL 不是有效網址。'); }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error('REMOTE_MUSIC_API_URL 必須是 HTTP 或 HTTPS 服務根網址。');
    }
    return { base, token };
}

export function remoteLibraryKey(): string { return settings().base.href; }

function url(path: string, query?: URLSearchParams): URL {
    const { base } = settings();
    const result = new URL(path, base);
    if (query) result.search = query.toString();
    return result;
}

function parseTrack(value: unknown): RemoteTrack {
    if (!value || typeof value !== 'object') throw new Error('遠端曲庫回傳無效歌曲資料。');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !UUID.test(item.id) || typeof item.title !== 'string' ||
        typeof item.mimeType !== 'string' || !item.mimeType.startsWith('audio/') ||
        typeof item.byteSize !== 'number' || !Number.isSafeInteger(item.byteSize) || item.byteSize <= 0 || item.byteSize > MAX_AUDIO_BYTES ||
        typeof item.sha256 !== 'string' || !HASH.test(item.sha256) ||
        (item.artist !== null && item.artist !== undefined && typeof item.artist !== 'string') ||
        (item.durationSeconds !== null && item.durationSeconds !== undefined &&
            (typeof item.durationSeconds !== 'number' || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0))) {
        throw new Error('遠端曲庫回傳無效歌曲資料。');
    }
    return { source: 'remote', id: item.id, title: item.title, artist: item.artist || undefined,
        duration: item.durationSeconds || undefined, mimeType: item.mimeType, byteSize: item.byteSize, sha256: item.sha256 };
}

async function request(path: string, query?: URLSearchParams, timeoutMs = 8000): Promise<Response> {
    const { token } = settings();
    let response: Response;
    try {
        response = await fetch(url(path, query), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    } catch {
        throw new Error('無法連線至遠端曲庫。');
    }
    if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) throw new Error('遠端歌曲已移除，請重新開啟曲庫。');
        if (response.status === 401) throw new Error('遠端曲庫驗證失敗，請檢查 API token。');
        throw new Error(`遠端曲庫暫時無法使用（HTTP ${response.status}）。`);
    }
    return response;
}

export async function searchRemoteSongs(query = '', cursor?: string, limit = 25, timeoutMs = 8000): Promise<RemotePage> {
    if (cursor && !UUID.test(cursor)) throw new Error('遠端曲庫游標無效。');
    const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(25, limit))) });
    if (query.trim()) params.set('query', query.trim().slice(0, 200));
    if (cursor) params.set('cursor', cursor);
    const response = await request('v1/songs', params, timeoutMs);
    const body = await response.json() as { items?: unknown; nextCursor?: unknown };
    if (!Array.isArray(body.items) || body.items.length > 25 ||
        (body.nextCursor !== null && body.nextCursor !== undefined && (typeof body.nextCursor !== 'string' || !UUID.test(body.nextCursor)))) {
        throw new Error('遠端曲庫回傳無效的搜尋結果。');
    }
    return { items: body.items.map(parseTrack), nextCursor: body.nextCursor || undefined };
}

export async function getRemoteSong(id: string): Promise<RemoteTrack> {
    if (!UUID.test(id)) throw new Error('遠端歌曲 ID 無效。');
    const response = await request(`v1/songs/${id}`);
    return parseTrack(await response.json());
}

export async function openRemoteAudio(id: string, controller: AbortController): Promise<Response> {
    if (!UUID.test(id)) throw new Error('遠端歌曲 ID 無效。');
    const { token } = settings();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(url(`v1/songs/${id}/audio`), {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal, redirect: 'error'
        });
        if (response.status !== 200 || !response.body) {
            await response.body?.cancel();
            throw new Error(response.status === 404 ? '遠端音檔已移除。' : `遠端音檔無法讀取（HTTP ${response.status}）。`);
        }
        return response;
    } catch (error) {
        if (controller.signal.aborted) throw new Error('遠端音檔連線逾時。');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

export function remoteMusicMode(): 'stream' | 'download' {
    const mode = process.env.REMOTE_MUSIC_MODE?.trim() || 'stream';
    if (mode !== 'stream' && mode !== 'download') throw new Error('REMOTE_MUSIC_MODE 只能是 stream 或 download。');
    return mode;
}
