import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaylistStore } from '../dist/lib/playlistStore.js';
const local = { source: 'local', id: 'a', title: '本地歌曲' };
const remote = { source: 'remote', id: 'b', title: '遠端歌曲', library: 'https://music.example/' };
async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-playlists-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'playlists.json');
    return { store: new PlaylistStore(path), path };
}
test('personal multi-playlist ownership applies to every read and mutation', async t => {
    const { store } = await fixture(t);
    const a = await store.create('alice', '放鬆', [local]);
    await store.create('alice', '工作', [remote]);
    await store.create('bob', '放鬆');
    assert.equal((await store.list('alice')).length, 2);
    assert.equal((await store.list('bob')).length, 1);
    for (const operation of [
        () => store.get('bob', a.id), () => store.rename('bob', a.id, 'stolen'),
        () => store.delete('bob', a.id, a.revision), () => store.add('bob', a.id, [remote]),
        () => store.remove('bob', a.id, a.entries[0].entryId), () => store.move('bob', a.id, a.entries[0].entryId, 1)
    ]) await assert.rejects(operation, /找不到/);
    assert.equal((await store.get('alice', a.id)).name, '放鬆');
});
test('atomic persistence survives store recreation and concurrent updates without losing songs', async t => {
    const { store, path } = await fixture(t);
    const p = await store.create('alice', '混合', [local, remote]);
    const other = new PlaylistStore(path);
    await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? store : other).add('alice', p.id, [{ ...local, id: String(i) }])));
    const saved = await new PlaylistStore(path).get('alice', p.id);
    assert.equal(saved.entries.length, 32);
    assert.equal(new Set(saved.entries.map(e => e.entryId)).size, 32);
    assert.equal(saved.entries[1].library, remote.library);
    saved.entries.length = 0;
    assert.equal((await store.get('alice', p.id)).entries.length, 32);
});
test('stable entry identities distinguish duplicates through moves and removals', async t => {
    const { store } = await fixture(t);
    let p = await store.create('alice', '重複歌曲', [local, remote, local]);
    const first = p.entries[0].entryId, last = p.entries[2].entryId;
    p = await store.move('alice', p.id, last, 1);
    assert.equal(p.entries[0].entryId, last);
    p = await store.remove('alice', p.id, first);
    assert.deepEqual(p.entries.map(e => e.entryId), [last, p.entries[1].entryId]);
    assert.equal(p.entries[1].source, 'remote');
    await assert.rejects(store.move('alice', p.id, last, 3), /範圍/);
    await assert.rejects(store.remove('alice', p.id, first), /不在/);
});
test('duplicate names, capacity and stale delete confirmation do not destroy existing data', async t => {
    const { store } = await fixture(t);
    const p = await store.create('alice', 'Mix', Array.from({ length: 99 }, () => local));
    await assert.rejects(store.create('alice', '  Ｍｉｘ  '), /同名/);
    await assert.rejects(store.create('alice', '\n'), /名稱/);
    await assert.rejects(store.add('alice', p.id, [local, remote]), /未加入/);
    assert.equal((await store.get('alice', p.id)).entries.length, 99);
    await store.rename('alice', p.id, 'New name');
    await assert.rejects(store.delete('alice', p.id, p.revision), /已更新/);
    const updated = await store.get('alice', p.id);
    await store.delete('alice', p.id, updated.revision);
    assert.equal((await store.list('alice')).length, 0);
});
test('enforces per-user playlist limit without blocking another user', async t => {
    const { store } = await fixture(t);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.create('alice', String(i))));
    await assert.rejects(store.create('alice', 'overflow'), /20/);
    await store.create('bob', 'first');
    assert.equal((await store.list('bob')).length, 1);
});
test('corrupt storage is never silently overwritten by a new operation', async t => {
    const { store, path } = await fixture(t);
    await writeFile(path, '{broken');
    await assert.rejects(store.create('alice', 'do not overwrite'));
    assert.equal(await readFile(path, 'utf8'), '{broken');
    await writeFile(path, JSON.stringify({ version: 99, playlists: [] }));
    await assert.rejects(store.create('alice', 'wrong version'), /損壞/);
});
