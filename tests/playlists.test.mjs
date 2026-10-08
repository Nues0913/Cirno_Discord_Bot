import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { playlists } from '../dist/lib/playlistStore.js';

test('every playlist operation requires the backend, even with legacy JSON present', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-backend-required-'));
    const originalCwd = process.cwd();
    const keys = ['PLAYLIST_API_URL', 'PLAYLIST_API_TOKEN'];
    const originalSettings = keys.map(key => process.env[key]);
    t.after(async () => {
        process.chdir(originalCwd);
        keys.forEach((key, i) => {
            if (originalSettings[i] === undefined) delete process.env[key];
            else process.env[key] = originalSettings[i];
        });
        await rm(directory, { recursive: true, force: true });
    });
    await mkdir(join(directory, 'data'));
    const file = join(directory, 'data/playlists.json');
    // An intentionally invalid legacy file also proves it is never read by CRUD.
    const legacy = '{legacy file must not be read or overwritten';
    await writeFile(file, legacy);
    process.chdir(directory);
    const owner = '123456789012345678', id = randomUUID(), entryId = randomUUID();
    const operations = [
        () => playlists.list(owner), () => playlists.get(owner, id),
        () => playlists.create(owner, 'new'), () => playlists.rename(owner, id, 'new'),
        () => playlists.delete(owner, id, 1), () => playlists.add(owner, id, []),
        () => playlists.remove(owner, id, entryId), () => playlists.move(owner, id, entryId, 1)
    ];
    for (const settings of [[], ['http://127.0.0.1/'], [undefined, 'test-only-token-012345678901234567890']]) {
        keys.forEach((key, i) => {
            if (settings[i] === undefined) delete process.env[key]; else process.env[key] = settings[i];
        });
        for (const operation of operations) await assert.rejects(operation, /請設定 PLAYLIST_API_URL/);
    }
    assert.equal(await readFile(file, 'utf8'), legacy);
    assert.deepEqual(await readdir(join(directory, 'data')), ['playlists.json']);
});
