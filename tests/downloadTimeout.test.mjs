import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteDownloadedAudio } from '../dist/features/music/audio/remoteAudio.js';

test('download times out on an idle body, keeps progressing past 15 seconds, and preserves control cancellation', { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-download-timeout-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    // A real, short PCM WAV is decoded only after its deliberately slow transfer completes.
    const bytes = Buffer.alloc(44 + 1600);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36); bytes.writeUInt32LE(1600, 40);
    const timers = [];
    let cancelReady;
    const ready = new Promise(resolve => { cancelReady = resolve; });
    const server = createServer((req, res) => {
        const id = req.url.split('/')[3];
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length) }); res.flushHeaders();
        if (id.endsWith('1')) return; // Headers arrive, but the body never starts.
        res.write(bytes.subarray(0, 44));
        if (id.endsWith('3')) {
            timers.push(setTimeout(() => res.write(bytes.subarray(44, 844)), 8000));
            timers.push(setTimeout(() => res.end(bytes.subarray(844)), 16000));
        } else if (id.endsWith('4')) cancelReady();
        // The other body stalls after its first chunk.
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
        timers.forEach(clearTimeout); server.closeAllConnections();
        return new Promise(resolve => server.close(resolve));
    });
    process.env.REMOTE_MUSIC_API_URL = `http://127.0.0.1:${server.address().port}/`;
    process.env.REMOTE_MUSIC_API_TOKEN = 'timeout-fixture-token';
    process.env.REMOTE_MUSIC_CACHE_DIRECTORY = directory;
    const base = { source: 'remote', title: 'WAV fixture', mimeType: 'audio/wav', byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') };
    const download = (number, controller) => createRemoteDownloadedAudio({ ...base,
        id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}` }, 70, () => {}, controller);
    const idle = async number => {
        const controller = new AbortController();
        await assert.rejects(download(number, controller), /下載逾時.*15 秒/);
        assert.equal(controller.signal.aborted, true);
    };
    const slow = async () => {
        let audio;
        try {
            const controller = new AbortController();
            const start = Date.now();
            audio = await download(3, controller);
            assert.ok(Date.now() - start >= 15000, 'progress must extend the deadline beyond the initial timeout');
            let frames = 0;
            for await (const packet of audio.resource.playStream) { assert.ok(packet.length); frames++; }
            assert.ok(frames > 0);
            assert.equal(controller.signal.aborted, false);
        } finally { audio?.dispose(); }
    };
    const cancelled = async () => {
        const controller = new AbortController();
        const result = assert.rejects(download(4, controller));
        await ready; controller.abort('control'); await result;
        assert.equal(controller.signal.reason, 'control');
    };
    await Promise.all([idle(1), idle(2), slow(), cancelled()]);
    for (let retry = 0; retry < 100 && (await readdir(directory)).length; retry++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(await readdir(directory), [], 'failed, cancelled and completed downloads must remove their files');
});
