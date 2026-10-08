import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection, Events } from 'discord.js';
import { MusicPlayer } from '../dist/features/music/playback/player.js';
import { loadCommands } from '../dist/app/commandLoader.js';
import { JsonEssayRepository } from '../dist/features/copyessay/repository.js';
import { browsers, BrowserRegistry } from '../dist/features/music/presentation/browserState.js';

test('initializing twice registers one listener; shutdown removes it and permits reinitialization', () => {
    const client = new EventEmitter(); const player = new MusicPlayer();
    player.initialize(client); player.initialize(client);
    assert.equal(client.listenerCount(Events.VoiceStateUpdate), 1);
    player.shutdown(); assert.equal(client.listenerCount(Events.VoiceStateUpdate), 0);
    player.initialize(client); assert.equal(client.listenerCount(Events.VoiceStateUpdate), 1);
    player.shutdown();
});
test('command reload refreshes handler functions, clears personal menus and leaves helpers unregistered', async () => {
    const client = { commands: new Collection() };
    const definitions = await loadCommands(client);
    assert.equal(definitions.length, 6);
    const execute = client.commands.get('music').execute;
    browsers.set('old', { expires: Date.now() + 10000 });
    await loadCommands(client, true);
    assert.notEqual(client.commands.get('music').execute, execute);
    assert.equal(browsers.get('old'), undefined);
    assert.equal(client.commands.get('copymanager').handleInteraction instanceof Function, true);
});
test('browser reads at capacity do not evict a valid selection; a new selection evicts the oldest', () => {
    const registry = new BrowserRegistry();
    for (let i = 0; i < 1000; i++) registry.set(String(i), { expires: Date.now() + 10000 });
    assert.ok(registry.get('0'));
    registry.set('1000', { expires: Date.now() + 10000 });
    assert.equal(registry.get('0'), undefined); assert.ok(registry.get('1'));
});
test('concurrent JSON mutations preserve both writes and a failed mutation does not block later writes', async t => {
    const root = await mkdtemp(join(tmpdir(), 'essay-repository-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'essays.json'); const repository = new JsonEssayRepository(path);
    await Promise.all(['one', 'two'].map(title => repository.mutate(essays => essays.push({ title }))));
    assert.deepEqual((await repository.readAll()).map(e => e.title), ['one', 'two']);
    await assert.rejects(repository.mutate(() => { throw new Error('invalid edit'); }), /invalid edit/);
    await repository.mutate(essays => essays.push({ title: 'three' }));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 3);
    assert.deepEqual(await readdir(root), ['essays.json']);
});

test('reorganized essay feature reads the existing root data file and preserves IDs when appending', async t => {
    const root = await mkdtemp(join(tmpdir(), 'essay-existing-data-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const feature = join(root, 'dist/features/copyessay');
    await mkdir(feature, { recursive: true }); await mkdir(join(root, 'data'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const existing = { id: 99, title: 'existing', content: 'legacy content', created_at: '2020-01-01' };
    await writeFile(join(root, 'data/copyessay.json'), JSON.stringify([existing]));
    for (const filename of ['model.js', 'repository.js', 'search.js', 'store.js']) {
        await copyFile(new URL(`../dist/features/copyessay/${filename}`, import.meta.url), join(feature, filename));
    }
    const store = await import(pathToFileURL(join(feature, 'store.js')).href);
    assert.deepEqual(await store.getById(99), existing);
    assert.equal((await store.add('new', 'new content')).id, 100);
    const persisted = JSON.parse(await readFile(join(root, 'data/copyessay.json'), 'utf8'));
    assert.deepEqual(persisted[0], existing); assert.equal(persisted.length, 2);
});
