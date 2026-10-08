import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRemoteStreamAudio } from '../dist/features/music/audio/remoteAudio.js';

const wav = Buffer.alloc(44 + 64_000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(64_000, 40);
const track = { source: 'remote', id: '00000000-0000-4000-8000-000000000003', title: 'stream fixture',
    duration: 4, mimeType: 'audio/wav', byteSize: wav.length, sha256: createHash('sha256').update(wav).digest('hex') };
const partial = wav.subarray(0, 32_044);

async function server(t, handler) {
    const instance = createServer(handler);
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    const keys = ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'];
    const previous = keys.map(key => process.env[key]);
    process.env.REMOTE_MUSIC_API_URL = `http://127.0.0.1:${instance.address().port}/`;
    process.env.REMOTE_MUSIC_API_TOKEN = 'stream-fixture-secret';
    t.after(async () => {
        keys.forEach((key, i) => {
            if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
        });
        instance.closeAllConnections();
        await new Promise(resolve => instance.close(resolve));
    });
}

test('interrupted HTTP audio reports received bytes and socket cause without credentials', { timeout: 5000 }, async t => {
    await server(t, (_req, res) => {
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.length) });
        res.write(partial);
        const timer = setTimeout(() => res.destroy(), 100);
        res.on('close', () => clearTimeout(timer));
    });
    const errors = [];
    let receivedError;
    const failure = new Promise(resolve => { receivedError = resolve; });
    const audio = await createRemoteStreamAudio(track, 70, error => { errors.push(error); receivedError(error); }, new AbortController());
    t.after(() => audio.dispose());
    const error = await failure;
    assert.match(error.message, /遠端音檔串流失敗/);
    assert.ok(error.message.includes(`${partial.length}/${wav.length} bytes`), error.message);
    assert.match(error.message, /UND_ERR_SOCKET/);
    assert.equal(error.cause.message, 'terminated');
    assert.ok(!error.message.includes(process.env.REMOTE_MUSIC_API_TOKEN));
    assert.ok(!error.message.includes(process.env.REMOTE_MUSIC_API_URL));
    await delay(200);
    assert.equal(errors.length, 1);
});

test('HTTP interruption followed by a decoder failure reports only one playback failure', { timeout: 5000 }, async t => {
    await server(t, (_req, res) => {
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.length) });
        res.write(Buffer.alloc(partial.length));
        const timer = setTimeout(() => res.destroy(), 100);
        res.on('close', () => clearTimeout(timer));
    });
    const errors = [];
    let receivedError;
    const failure = new Promise(resolve => { receivedError = resolve; });
    const audio = await createRemoteStreamAudio(track, 70, error => { errors.push(error); receivedError(error); }, new AbortController());
    t.after(() => audio.dispose());
    await failure;
    await delay(300);
    assert.equal(errors.length, 1);
});

test('disposing an active HTTP stream cancels the transfer without reporting playback failure', { timeout: 5000 }, async t => {
    let closed;
    const connectionClosed = new Promise(resolve => { closed = resolve; });
    await server(t, (_req, res) => {
        res.on('close', closed);
        res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(wav.length) });
        res.write(partial);
    });
    const errors = [];
    const audio = await createRemoteStreamAudio(track, 70, error => errors.push(error), new AbortController());
    t.after(() => audio.dispose());
    audio.dispose();
    await connectionClosed;
    await delay(100);
    assert.equal(errors.length, 0);
});
