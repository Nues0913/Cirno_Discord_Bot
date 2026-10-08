import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let port, ca;
const nativeRequest = https.request;
mock.module('node:dns/promises', { namedExports: { lookup: async () => [{ address: '8.8.8.8', family: 4 }] } });
// Redirect only the test transport to loopback; production DNS/URL validation stays real.
mock.module('node:https', { namedExports: { request: (options, callback) => nativeRequest({
    ...options, hostname: '127.0.0.1', port, ca
}, callback) } });
const { fetchPublicUrl } = await import('../dist/features/assistant/integrations/safeWebFetch.js');
test('real TLS redirects release their original response; a slow active response still hits the overall deadline', async t => {
    const root = await mkdtemp(join(tmpdir(), 'cirno-web-transport-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key'), '-out', join(root, 'cert'),
        '-days', '1', '-subj', '/CN=example.com', '-addext', 'subjectAltName=DNS:example.com'], { stdio: 'pipe' });
    ca = await readFile(join(root, 'cert'));
    const server = https.createServer({ key: await readFile(join(root, 'key')), cert: ca }, (req, res) => {
        if (req.url === '/redirect') {
            res.writeHead(302, { location: '/target' }); res.write('redirecting');
            res.on('close', () => res.end()); return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        if (req.url === '/target') return res.end('redirect success');
        res.write('slow'); const timer = setInterval(() => res.write('slow'), 20);
        res.on('close', () => clearInterval(timer));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const old = process.env.DIRECT_FETCH_TIMEOUT_MS;
    t.after(() => { if (old === undefined) delete process.env.DIRECT_FETCH_TIMEOUT_MS; else process.env.DIRECT_FETCH_TIMEOUT_MS = old; });
    process.env.DIRECT_FETCH_TIMEOUT_MS = '2000';
    assert.equal(JSON.parse(await fetchPublicUrl('https://example.com/redirect')).content, 'redirect success');
    process.env.DIRECT_FETCH_TIMEOUT_MS = '150';
    const started = Date.now();
    const result = JSON.parse(await fetchPublicUrl('https://example.com/slow'));
    assert.ok(result.error); assert.equal(result.content, undefined);
    assert.ok(Date.now() - started < 1500);
});
