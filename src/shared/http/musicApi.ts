export function remoteMusicApiSettings(): { base: URL; token: string } {
    const raw = process.env.REMOTE_MUSIC_API_URL?.trim();
    const token = process.env.REMOTE_MUSIC_API_TOKEN?.trim();
    if (!raw || !token) throw new Error('請設定 REMOTE_MUSIC_API_URL 與 REMOTE_MUSIC_API_TOKEN。');
    let base: URL;
    try { base = new URL(raw.endsWith('/') ? raw : `${raw}/`); }
    catch { throw new Error('REMOTE_MUSIC_API_URL 不是有效網址。'); }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error('REMOTE_MUSIC_API_URL 必須是 HTTP 或 HTTPS 服務根網址。');
    }
    return { base, token };
}
