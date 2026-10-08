// Integration check against a checkout of music_server, with an isolated real SQLite DB.
// Build both projects first, then: node scripts/test-playlist-server.mjs ../music_server/api
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { playlists } from '../dist/features/playlists/store.js';
import { RemotePlaylistStore } from '../dist/features/playlists/remoteStore.js';
import { saveTrack, resolvePlaylist } from '../dist/features/playlists/tracks.js';
import { musicLibrary } from '../dist/features/music/library/localLibrary.js';
import { getRemoteSong } from '../dist/features/music/library/remoteLibrary.js';

const api = resolve(process.argv[2] ?? '../music_server/api');
const { buildApp } = await import(pathToFileURL(join(api, 'dist/app.js')).href);
const { connectDatabase } = await import(pathToFileURL(join(api, 'dist/infrastructure/database.js')).href);
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
    const credential = 'integration-api-token-012345678901234567890';
    app = buildApp({ db, token: credential, audioRoot: songs });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    process.env.REMOTE_MUSIC_API_URL = address;
    process.env.REMOTE_MUSIC_API_TOKEN = credential;
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
    // Verify Bot API writes reached the backend tables, including order and revision.
    const persisted = await db.playlist.findUniqueOrThrow({ where: { id: p.id }, include: { entries: { orderBy: { position: 'asc' } } } });
    assert.equal(persisted.ownerId, user);
    assert.equal(persisted.name, p.name);
    assert.equal(persisted.revision, p.revision);
    assert.deepEqual(persisted.entries.map(e => e.entryId), p.entries.map(e => e.entryId));
    await assert.rejects(playlists.get('223456789012345678', p.id), /找不到/);
    assert.equal((await fetch(`${address}/v1/playlists`, { headers: { Authorization: 'Bearer wrong-credential', 'X-Discord-User-Id': user } })).status, 401);
    await db.song.update({ where: { id: remote.id }, data: { status: 'disabled' } });
    const unavailable = await resolvePlaylist((await playlists.get(user, p.id)).entries);
    assert.equal(unavailable.tracks.length, 1); assert.equal(unavailable.unavailable.length, 1);
    const independentClient = new RemotePlaylistStore();
    assert.equal((await independentClient.list(user)).length, 1);
    // A returned Int32 maximum must remain readable and deletable through the Bot client.
    const maximumRevision = 2_147_483_647;
    await db.playlist.update({ where: { id: p.id }, data: { revision: maximumRevision - 1 } });
    p = await playlists.rename(user, p.id, '版本上限', maximumRevision - 1);
    assert.equal(p.revision, maximumRevision);
    await assert.rejects(playlists.rename(user, p.id, '不可溢位', p.revision), /版本已達上限/);
    assert.deepEqual(await independentClient.get(user, p.id), p);
    await playlists.delete(user, p.id, p.revision);
    assert.equal(await db.playlist.count({ where: { id: p.id } }), 0);
    assert.equal(await db.playlistEntry.count({ where: { playlistId: p.id } }), 0);
    assert.equal((await independentClient.list(user)).length, 0);
    console.log('PASS: real HTTP + SQLite; mixed playlist CRUD, owner isolation, shared auth, disabled songs, database persistence, independent clients and maximum-revision deletion.');
} finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    await rm(root, { recursive: true, force: true });
}
