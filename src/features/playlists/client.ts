import { remoteMusicApiSettings } from '../../shared/http/musicApi.js';
import { UserActionError } from '../../shared/logging/operationErrors.js';

export interface PlaylistClient {
    request(owner: string, method: string, path: string, body?: unknown, timeout?: number): Promise<unknown>;
}

export class PlaylistHttpClient implements PlaylistClient {
    constructor(private readonly fetcher: typeof fetch = fetch) {}
    async request(owner: string, method: string, path: string, body?: unknown, timeout = 8000): Promise<unknown> {
        if (!/^[0-9]{17,20}$/.test(owner)) throw new UserActionError('Discord 使用者 ID 無效。');
        const { base, token } = remoteMusicApiSettings();
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
            if (response.status === 401 || response.status === 403) throw new Error('清單服務驗證失敗，請檢查 REMOTE_MUSIC_API_TOKEN 是否與 Server 的 API_TOKEN 相同。');
            if (response.status === 404) {
                if (path === '') throw new Error('Server 的清單 API 路由不存在（HTTP 404），請更新 music_server 並重新建置、啟動 API 服務。');
                throw new UserActionError('找不到你的清單或項目，請重新讀取清單。');
            }
            if ([400, 409, 413].includes(response.status)) {
                const message = (value as { error?: unknown })?.error;
                throw new UserActionError(typeof message === 'string' ? message.slice(0, 300) : '清單操作衝突，請重新讀取後操作。');
            }
            throw new Error(`清單服務暫時無法使用（HTTP ${response.status}）。`);
        }
        return value;
    }
}
