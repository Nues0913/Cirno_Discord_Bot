import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePlaylist } from '../dist/features/playlists/tracks.js';
import { musicLibrary } from '../dist/features/music/library/localLibrary.js';
import logger from '../dist/shared/logging/logger.js';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const missing = '00000000-0000-4000-8000-000000000003';

async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-playlist-resolution-'));
    const localPath = join(directory, 'unavailable-local-library');
    await writeFile(localPath, 'A regular file cannot be scanned as a music directory.');
    const keys = ['MUSIC_AUDIO_DIRECTORY', 'REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'];
    const previous = keys.map(key => process.env[key]);
    const requests = [];
    const failure = { status: undefined };
    const server = createServer((request, response) => {
        requests.push(request.url);
        if (failure.status) {
            response.writeHead(failure.status).end();
            if (failure.remaining && --failure.remaining === 0) failure.status = undefined;
            return;
        }
        if (request.headers.authorization !== 'Bearer resolution-fixture-token') {
            response.writeHead(401).end(); return;
        }
        const id = request.url?.split('/').at(-1);
        if (id !== first && id !== second) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id, title: id, artist: null, mimeType: 'audio/wav',
            byteSize: 100, sha256: 'a'.repeat(64), durationSeconds: 60 }));
    });
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        keys.forEach((key, index) => {
            if (previous[index] === undefined) delete process.env[key];
            else process.env[key] = previous[index];
        });
        await rm(directory, { recursive: true, force: true });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.MUSIC_AUDIO_DIRECTORY = localPath;
    process.env.REMOTE_MUSIC_API_URL = `http://127.0.0.1:${server.address().port}/`;
    process.env.REMOTE_MUSIC_API_TOKEN = 'resolution-fixture-token';
    const load = musicLibrary.load;
    t.mock.method(musicLibrary, 'load', () => load.call(musicLibrary));
    t.mock.method(musicLibrary, 'get', () => { throw Error('A failed scan must not use cached local tracks'); });
    const errors = [];
    t.mock.method(logger, 'error', error => errors.push(error));
    return { requests, errors, failure, remote: id => ({ source: 'remote', id, title: id, library: process.env.REMOTE_MUSIC_API_URL }) };
}

test('remote-only playlists resolve in order with duplicates without scanning an unavailable local directory', async t => {
    const { requests, remote } = await fixture(t);
    const saved = [remote(second), remote(first), remote(second)];
    const snapshot = structuredClone(saved);
    const result = await resolvePlaylist(saved);
    assert.deepEqual(result.tracks.map(track => track.id), [second, first, second]);
    assert.deepEqual(result.unavailable, []);
    assert.equal(requests.length, 2);
    assert.equal(musicLibrary.load.mock.callCount(), 0);
    assert.deepEqual(saved, snapshot);
});

test('a failed local scan only marks local entries unavailable while remote failures remain isolated', async t => {
    const { requests, errors, remote } = await fixture(t);
    const local = { source: 'local', id: 'saved-local-id', title: 'Saved local song' };
    const saved = [local, remote(second), remote(missing), remote(first), local, remote(second)];
    const snapshot = structuredClone(saved);
    const result = await resolvePlaylist(saved);
    assert.deepEqual(result.tracks.map(track => track.id), [second, first, second]);
    assert.deepEqual(result.unavailable, [local, remote(missing), local]);
    assert.equal(requests.length, 3);
    assert.equal(musicLibrary.load.mock.callCount(), 1);
    assert.equal(musicLibrary.get.mock.callCount(), 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'ENOTDIR');
    assert.deepEqual(saved, snapshot);
});

test('local-only playlists retain all saved entries when their directory cannot be scanned', async t => {
    const { requests } = await fixture(t);
    const saved = [{ source: 'local', id: 'saved-local-id', title: 'Saved local song' }];
    const result = await resolvePlaylist(saved);
    assert.deepEqual(result.tracks, []);
    assert.deepEqual(result.unavailable, saved);
    assert.equal(musicLibrary.load.mock.callCount(), 1);
    assert.equal(requests.length, 0);
});

test('an empty playlist does not access either library', async t => {
    const { requests } = await fixture(t);
    assert.deepEqual(await resolvePlaylist([]), { tracks: [], unavailable: [] });
    assert.equal(musicLibrary.load.mock.callCount(), 0);
    assert.equal(requests.length, 0);
});

test('skipping saved remote songs does not hide server failures or remove saved entries', async t => {
    const { errors, failure, remote } = await fixture(t);
    const saved = [remote(first)];
    for (const status of [503, 401]) {
        failure.status = status;
        const result = await resolvePlaylist(saved);
        assert.deepEqual(result.tracks, []);
        assert.deepEqual(result.unavailable, saved);
        assert.equal(errors.length, status === 503 ? 1 : 2);
    }
    assert.match(errors[0].message, /HTTP 503/);
    assert.match(errors[1].message, /驗證失敗/);
});

test('100 duplicate references share one metadata query while preserving all entries', async t => {
    const { requests, remote } = await fixture(t);
    const saved = Array.from({ length: 100 }, () => remote(first));
    const result = await resolvePlaylist(saved);
    assert.equal(result.tracks.length, 100); assert.deepEqual(result.unavailable, []);
    assert.equal(requests.length, 1);
});

test('read-only 429 retries recover transient limits and remain bounded for a persistent limit', async t => {
    const { requests, failure, remote, errors } = await fixture(t);
    failure.status = 429; failure.remaining = 1;
    let result = await resolvePlaylist([remote(first)]);
    assert.equal(result.tracks.length, 1); assert.equal(requests.length, 2);
    failure.status = 429;
    result = await resolvePlaylist(Array.from({ length: 100 }, () => remote(first)));
    assert.equal(result.unavailable.length, 100); assert.equal(requests.length, 5);
    assert.equal(errors.length, 1); assert.match(errors[0].message, /HTTP 429/);
});
