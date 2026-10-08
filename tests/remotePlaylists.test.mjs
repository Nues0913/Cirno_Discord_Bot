import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { RemotePlaylistStore } from '../dist/features/playlists/remoteStore.js';
import { remoteLibraryKey } from '../dist/features/music/library/remoteLibrary.js';
import { playlists } from '../dist/features/playlists/store.js';
const owner = '123456789012345678';
async function server(t, handler) {
    const instance = createServer(async (request, response) => {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        handler(request, response, body);
    });
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    const saved = [process.env.REMOTE_MUSIC_API_URL, process.env.REMOTE_MUSIC_API_TOKEN];
    process.env.REMOTE_MUSIC_API_URL = `http://127.0.0.1:${instance.address().port}/`;
    process.env.REMOTE_MUSIC_API_TOKEN = 'test-shared-api-secret-012345678901234567890';
    t.after(async () => {
        for (const [i, key] of ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'].entries()) {
            if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
        }
        instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve));
    });
}
test('Bot backend delegates all CRUD requests with shared API auth and authenticated Discord ID', async t => {
    const entryId = randomUUID();
    const p = { id: randomUUID(), ownerId: owner, name: 'mix', revision: 4, entries: [{ entryId, source: 'local', id: 'song', title: 'song' }] };
    const calls = [];
    await server(t, (req, res, body) => {
        assert.equal(req.headers.authorization, `Bearer ${process.env.REMOTE_MUSIC_API_TOKEN}`);
        assert.equal(req.headers['x-discord-user-id'], owner);
        calls.push({ method: req.method, url: req.url, body });
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'DELETE' && req.url === `/v1/playlists/${p.id}`) res.writeHead(204).end();
        else res.end(JSON.stringify(req.url === '/v1/playlists' && req.method === 'GET' ? { items: [p] } : p));
    });
    assert.equal((await playlists.list(owner))[0].id, p.id);
    await playlists.create(owner, 'mix', [p.entries[0]]);
    await playlists.rename(owner, p.id, 'new');
    await playlists.add(owner, p.id, [{ source: 'local', id: 'another', title: 'another' }]);
    await playlists.move(owner, p.id, entryId, 1);
    await playlists.remove(owner, p.id, entryId);
    await playlists.delete(owner, p.id, 3);
    for (const call of calls.filter(c => ['PATCH', 'POST', 'DELETE'].includes(c.method) && c.url !== '/v1/playlists')) {
        assert.equal(call.body.revision, call.method === 'DELETE' && call.url === `/v1/playlists/${p.id}` ? 3 : 4);
    }
    assert.ok(calls.some(c => c.method === 'PATCH' && c.url.endsWith(`/entries/${entryId}`) && c.body.position === 1));
});
test('server conflicts/auth failures are surfaced without retry or fallback local writes', async t => {
    let status = 409, calls = 0;
    await server(t, (_req, res) => { calls++; res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: '清單已更新' })); });
    await assert.rejects(playlists.create(owner, 'new'), /已更新/);
    assert.equal(calls, 1);
    status = 401; await assert.rejects(playlists.list(owner), /驗證失敗/);
    status = 503; await assert.rejects(playlists.list(owner), /503/);
    delete process.env.REMOTE_MUSIC_API_TOKEN;
    await assert.rejects(playlists.list(owner), /請設定/);
    assert.equal(calls, 3);
});
test('song and playlist clients reject the same invalid backend URLs before sending credentials', async t => {
    let calls = 0;
    await server(t, (_req, res) => { calls++; res.end('{}'); });
    for (const value of ['invalid', 'file:///tmp/music', 'https://user:password@example.com/',
        'https://example.com/?token=secret', 'https://example.com/#fragment']) {
        process.env.REMOTE_MUSIC_API_URL = value;
        assert.throws(() => remoteLibraryKey(), /REMOTE_MUSIC_API_URL/);
        await assert.rejects(playlists.list(owner), /REMOTE_MUSIC_API_URL/);
    }
    assert.equal(calls, 0);
});
test('rejects wrong-owner data and redirects, keeping credential off redirect destinations', async t => {
    let mode = 'owner';
    await server(t, (_req, res) => {
        if (mode === 'redirect') res.writeHead(302, { location: 'https://example.invalid/' }).end();
        else res.end(JSON.stringify({ items: [{ id: randomUUID(), name: 'private', ownerId: 'other', revision: 1, entries: [] }] }));
    });
    await assert.rejects(playlists.list(owner), /無效資料/);
    mode = 'redirect'; await assert.rejects(playlists.list(owner), /無法連線/);
});

test('writes send the revision read by the caller without fetching a newer version or retrying conflicts', async t => {
    const p = { id: randomUUID(), ownerId: owner, name: 'snapshot', revision: 7, entries: [] };
    const calls = []; let conflict = false;
    await server(t, (req, res, body) => {
        calls.push({ method: req.method, body });
        if (conflict) res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ error: '清單已更新' }));
        else res.end(JSON.stringify(p));
    });
    const store = new RemotePlaylistStore();
    await store.rename(owner, p.id, 'new', 6);
    await store.add(owner, p.id, [], 6);
    await store.remove(owner, p.id, randomUUID(), 6);
    await store.move(owner, p.id, randomUUID(), 1, 6);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(call => call.method !== 'GET' && call.body.revision === 6));
    conflict = true; await assert.rejects(store.rename(owner, p.id, 'stale', 6), /已更新/);
    assert.equal(calls.length, 5);
});
