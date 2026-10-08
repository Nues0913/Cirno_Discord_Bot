export function playlistApiSettings() {
    const raw = process.env.PLAYLIST_API_URL?.trim();
    const token = process.env.PLAYLIST_API_TOKEN?.trim();
    if (!raw || !token || token.length < 32) throw new Error('請設定 PLAYLIST_API_URL 與獨立的 PLAYLIST_API_TOKEN（至少 32 字元）。');
    let base: URL;
    try { base = new URL(raw.endsWith('/') ? raw : `${raw}/`); } catch { throw new Error('PLAYLIST_API_URL 無效。'); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('PLAYLIST_API_URL 必須是沒有憑證或查詢參數的 HTTP(S) 網址。');
    return { base, token };
}

export interface PlaylistClient {
    request(owner: string, method: string, path: string, body?: unknown, timeout?: number): Promise<unknown>;
}

export class PlaylistHttpClient implements PlaylistClient {
    constructor(private readonly fetcher: typeof fetch = fetch) {}
    async request(owner: string, method: string, path: string, body?: unknown, timeout = 8000): Promise<unknown> {
        if (!/^[0-9]{17,20}$/.test(owner)) throw new Error('Discord 使用者 ID 無效。');
        const { base, token } = playlistApiSettings();
        let response: Response;
        try {
            response = await this.fetcher(new URL(`v1/playlists${path}`, base), {
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
}
