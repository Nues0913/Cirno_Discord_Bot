import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { playlists } from '../dist/features/playlists/store.js';

test('every playlist operation requires the backend without creating local storage', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-backend-required-'));
    const originalCwd = process.cwd();
    const keys = ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'];
    const originalSettings = keys.map(key => process.env[key]);
    t.after(async () => {
        process.chdir(originalCwd);
        keys.forEach((key, i) => {
            if (originalSettings[i] === undefined) delete process.env[key];
            else process.env[key] = originalSettings[i];
        });
        await rm(directory, { recursive: true, force: true });
    });
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
        for (const operation of operations) await assert.rejects(operation, /請設定 REMOTE_MUSIC_API_URL/);
    }
    assert.deepEqual(await readdir(directory), []);
});
