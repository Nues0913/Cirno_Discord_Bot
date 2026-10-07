// Integration check against a checkout of music_server, with an isolated real SQLite DB.
// Build both projects first, then: node scripts/test-playlist-server.mjs ../music_server/api
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { playlists } from '../dist/lib/playlistStore.js';
import { RemotePlaylistStore } from '../dist/lib/remotePlaylistStore.js';
import { saveTrack, resolvePlaylist } from '../dist/lib/playlistTracks.js';
import { musicLibrary } from '../dist/lib/localMusicLibrary.js';
import { getRemoteSong } from '../dist/lib/remoteMusicLibrary.js';
import { importPlaylists } from './import-playlists.mjs';

const api = resolve(process.argv[2] ?? '../music_server/api');
const { buildApp } = await import(pathToFileURL(join(api, 'dist/app.js')).href);
const { connectDatabase } = await import(pathToFileURL(join(api, 'dist/db.js')).href);
const root = await mkdtemp(join(tmpdir(), 'music-playlist-integration-'));
let db, app;
try {
    const databaseUrl = `file:${join(root, 'integration.db')}?connection_limit=1`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        cwd: api, env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info' }, stdio: 'pipe'
    });
    db = await connectDatabase(databaseUrl);
    const songs = join(root, 'songs'); await mkdir(songs);
    const wav = Buffer.alloc(44 + 1600);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(1600, 40);
    await writeFile(join(songs, 'local.wav'), wav);
    const song = await db.song.create({ data: { fileKey: 'remote.wav', title: '遠端歌曲', mimeType: 'audio/wav',
        byteSize: wav.length, durationSeconds: 0.1, sha256: createHash('sha256').update(wav).digest('hex') } });
    const playback = 'integration-playback-token-012345678901234567890';
    const credential = 'integration-playlist-token-012345678901234567890';
    app = buildApp({ db, token: playback, playlistToken: credential, audioRoot: songs });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    process.env.PLAYLIST_API_URL = address;
    process.env.PLAYLIST_API_TOKEN = credential;
    process.env.REMOTE_MUSIC_API_URL = address;
    process.env.REMOTE_MUSIC_API_TOKEN = playback;
    process.env.MUSIC_AUDIO_DIRECTORY = songs;
    const user = '123456789012345678';
    const local = (await musicLibrary.reload())[0], remote = await getRemoteSong(song.id);
    let p = await playlists.create(user, '混合曲庫', [saveTrack(local), saveTrack(remote)]);
    assert.equal(p.entries.length, 2);
    const resolved = await resolvePlaylist((await playlists.get(user, p.id)).entries);
    assert.deepEqual(resolved.tracks.map(t => t.id), [local.id, remote.id]);
    p = await playlists.add(user, p.id, [saveTrack(remote)]);
    p = await playlists.move(user, p.id, p.entries[2].entryId, 1);
    assert.equal(p.entries[0].source, 'remote');
    p = await playlists.remove(user, p.id, p.entries[0].entryId);
    p = await playlists.rename(user, p.id, '我的收藏');
    await assert.rejects(playlists.get('223456789012345678', p.id), /找不到/);
    assert.equal((await fetch(`${address}/v1/playlists`, { headers: { Authorization: `Bearer ${playback}`, 'X-Discord-User-Id': user } })).status, 401);
    await db.song.update({ where: { id: remote.id }, data: { status: 'disabled' } });
    const unavailable = await resolvePlaylist((await playlists.get(user, p.id)).entries);
    assert.equal(unavailable.tracks.length, 1); assert.equal(unavailable.unavailable.length, 1);
    const legacy = { ...p, id: randomUUID(), name: 'Legacy', entries: p.entries.map(e => ({ ...e, entryId: randomUUID() })) };
    const file = join(root, 'playlists.json'), source = JSON.stringify({ version: 1, playlists: [legacy] });
    await writeFile(file, source);
    assert.equal(await importPlaylists(file), 1);
    await playlists.rename(user, legacy.id, 'Edited after import');
    assert.equal(await importPlaylists(file), 1);
    assert.equal((await playlists.get(user, legacy.id)).name, 'Edited after import');
    assert.equal(await readFile(file, 'utf8'), source);
    const independentClient = new RemotePlaylistStore();
    assert.equal((await independentClient.list(user)).length, 2);
    await playlists.delete(user, p.id, p.revision);
    assert.equal((await independentClient.list(user)).length, 1);
    console.log('PASS: real HTTP + SQLite; mixed playlist CRUD, owner isolation, dedicated auth, disabled songs, idempotent legacy import and independent clients.');
} finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    await rm(root, { recursive: true, force: true });
}
