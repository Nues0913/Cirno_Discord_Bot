import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { createLocalAudio } from '../dist/lib/localAudio.js';
import { createRemoteStreamAudio, createRemoteDownloadedAudio } from '../dist/lib/remoteAudio.js';
import { musicLibrary } from '../dist/lib/localMusicLibrary.js';
import { saveTrack, resolvePlaylist } from '../dist/lib/playlistTracks.js';

async function consume(factory) {
    let error;
    const audio = await factory(e => { error = e; });
    let frames = 0;
    try { for await (const packet of audio.resource.playStream) { assert.ok(packet.length); frames++; } }
    finally { audio.dispose(); }
    assert.ifError(error);
    assert.ok(frames > 0);
    return frames;
}
test('real FFmpeg seeks local, remote-stream and verified remote-download audio; mixed playlists resolve in order', { timeout: 20000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-audio-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const songs = join(directory, 'songs'); await mkdir(songs);
    const path = join(songs, 'test.wav');
    const generated = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-y', path]);
    assert.equal(generated.status, 0, generated.stderr.toString());
    const bytes = await readFile(path);
    const id = '00000000-0000-4000-8000-000000000001';
    const track = { source: 'remote', id, title: 'remote fixture', duration: 2, mimeType: 'audio/wav', byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') };
    const requests = [];
    const server = createServer((req, res) => {
        requests.push(req.url);
        if (req.headers.authorization !== 'Bearer test-fixture-token') { res.writeHead(401).end(); return; }
        if (req.url === `/v1/songs/${id}/audio`) {
            res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length) }); res.end(bytes);
        } else if (req.url === `/v1/songs/${id}`) {
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ...track, durationSeconds: 2 }));
        } else res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    process.env.REMOTE_MUSIC_API_URL = `http://127.0.0.1:${server.address().port}/`;
    process.env.REMOTE_MUSIC_API_TOKEN = 'test-fixture-token';
    process.env.REMOTE_MUSIC_CACHE_DIRECTORY = join(directory, 'cache');
    process.env.MUSIC_AUDIO_DIRECTORY = songs;
    const local = (await musicLibrary.reload())[0];
    const full = await consume(error => createLocalAudio(path, 70, error));
    const seeked = await consume(error => createLocalAudio(path, 70, error, 1));
    assert.ok(full > seeked + 40, `${full} vs ${seeked} frames`);
    for (const factory of [createRemoteStreamAudio, createRemoteDownloadedAudio]) {
        const count = await consume(error => factory(track, 70, error, new AbortController(), 1));
        assert.ok(Math.abs(count - seeked) <= 1, `remote ${count} vs local ${seeked}`);
    }
    await assert.rejects(createRemoteDownloadedAudio({ ...track, sha256: '0'.repeat(64) }, 70, () => {}, new AbortController()), /雜湊/);
    const savedRemote = saveTrack(track), savedLocal = saveTrack(local);
    const resolved = await resolvePlaylist([savedLocal, savedRemote, { ...savedRemote, id: '00000000-0000-4000-8000-000000000099' }, savedRemote]);
    assert.deepEqual(resolved.tracks.map(t => t.id), [local.id, id, id]);
    assert.equal(resolved.unavailable.length, 1);
    const before = requests.length;
    const wrongLibrary = await resolvePlaylist([{ ...savedRemote, library: 'https://another-library.example/' }]);
    assert.equal(wrongLibrary.tracks.length, 0); assert.equal(requests.length, before);
});
