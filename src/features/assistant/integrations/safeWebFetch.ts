import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

interface FetchResult {
    url: string;
    status: number;
    contentType: string;
    date: string | null;
    lastModified: string | null;
    content: string;
}

function getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isBlockedIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
        return true;
    }

    const [a, b] = octets;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51)
        || (a === 203 && b === 0)
        || a >= 224;
}

function isBlockedAddress(address: string): boolean {
    if (address.includes('.')) {
        const mappedIpv4 = address.toLowerCase().match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
        return isBlockedIpv4(mappedIpv4 ?? address);
    }

    const normalized = address.toLowerCase();
    return !/^[23]/.test(normalized)
        || normalized.startsWith('2001:db8:');
}

function decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
    };

    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
        if (entity.startsWith('#')) {
            const hex = entity.toLowerCase().startsWith('#x');
            const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
            return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
                && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : match;
        }
        return namedEntities[entity.toLowerCase()] ?? match;
    });
}

function htmlToText(html: string): string {
    return decodeHtmlEntities(
        html
            .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|article|section|li|tr|h[1-6])>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
}

async function validateAndResolve(url: URL, signal: AbortSignal): Promise<{ address: string; family: number }> {
    signal.throwIfAborted();
    if (url.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs are allowed.');
    }
    if (url.username || url.password) {
        throw new Error('URLs containing credentials are not allowed.');
    }
    if (url.port && url.port !== '443') {
        throw new Error('Only the standard HTTPS port is allowed.');
    }

    // Native DNS lookup cannot be cancelled, but late results must not start a request.
    const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        lookup(url.hostname, { all: true, verbatim: true }).then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(result => isBlockedAddress(result.address))) {
        throw new Error('The URL resolves to a private, local, or reserved network address.');
    }
    return addresses[0];
}

async function requestUrl(url: URL, signal: AbortSignal, redirectCount = 0): Promise<FetchResult> {
    const resolved = await validateAndResolve(url, signal);
    const timeoutMs = getPositiveInteger(process.env.DIRECT_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const maxBytes = Math.min(
        getPositiveInteger(process.env.DIRECT_FETCH_MAX_BYTES, DEFAULT_MAX_BYTES),
        2_000_000
    );

    return new Promise<FetchResult>((resolve, reject) => {
        const req = request({
            hostname: resolved.address,
            family: resolved.family,
            port: 443,
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            servername: url.hostname,
            headers: {
                Host: url.host,
                Accept: 'application/json,text/html,application/xml,text/plain;q=0.9,*/*;q=0.1',
                'Accept-Encoding': 'identity',
                'User-Agent': 'DiscordBotV4/1.0 (+server-side data fetch)'
            },
            timeout: timeoutMs,
            signal
        }, response => {
            response.on('error', reject);
            try {
                const status = response.statusCode ?? 0;
                const location = response.headers.location;
                if (status >= 300 && status < 400 && location) {
                    response.destroy();
                    if (redirectCount >= MAX_REDIRECTS) {
                        reject(new Error('The URL exceeded the redirect limit.'));
                        return;
                    }
                    requestUrl(new URL(location, url), signal, redirectCount + 1).then(resolve, reject);
                    return;
                }
                if (status < 200 || status >= 300) {
                    response.destroy();
                    reject(new Error(`Direct fetch failed (HTTP ${status}).`));
                    return;
                }

                const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
                const allowedType = contentType.startsWith('text/')
                    || contentType.includes('json')
                    || contentType.includes('xml');
                if (!allowedType) {
                    response.destroy();
                    reject(new Error(`Unsupported response type: ${contentType || 'unknown'}.`));
                    return;
                }

                const chunks: Buffer[] = [];
                let receivedBytes = 0;
                response.on('data', (chunk: Buffer) => {
                    receivedBytes += chunk.length;
                    if (receivedBytes > maxBytes) {
                        response.destroy(new Error(`The response exceeded ${maxBytes} bytes.`));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    try {
                        signal.throwIfAborted();
                        const rawContent = Buffer.concat(chunks).toString('utf8');
                        const textContent = contentType.includes('html')
                            ? htmlToText(rawContent)
                            : rawContent.trim();
                        resolve({
                            url: url.toString(),
                            status,
                            contentType,
                            date: typeof response.headers.date === 'string' ? response.headers.date : null,
                            lastModified: typeof response.headers['last-modified'] === 'string'
                                ? response.headers['last-modified']
                                : null,
                            content: textContent.slice(0, 50_000)
                        });
                    } catch (error) { reject(error); }
                });
            } catch (error) { response.destroy(); reject(error); }
        });

        req.on('timeout', () => req.destroy(new Error(`Direct fetch timed out after ${timeoutMs} ms.`)));
        req.on('error', reject);
        req.end();
    });
}

export async function fetchPublicUrl(rawUrl: string, callerSignal?: AbortSignal): Promise<string> {
    callerSignal?.throwIfAborted();
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return JSON.stringify({ error: 'The supplied URL is invalid.' });
    }

    try {
        const deadline = AbortSignal.timeout(getPositiveInteger(process.env.DIRECT_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS));
        const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
        return JSON.stringify(await requestUrl(url, signal));
    } catch (error) {
        callerSignal?.throwIfAborted();
        return JSON.stringify({
            url: url.toString(),
            error: error instanceof Error ? error.message : 'Direct fetch failed.'
        });
    }
}
