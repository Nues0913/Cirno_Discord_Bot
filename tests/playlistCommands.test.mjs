import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelType, MessageFlags } from 'discord.js';
import { PlaylistStore, playlists } from '../dist/lib/playlistStore.js';
import { data, execute, handlePlaylistInteraction } from '../dist/commands/playlist/index.js';
import { musicLibrary } from '../dist/lib/localMusicLibrary.js';
import { musicPlayer } from '../dist/lib/localMusicPlayer.js';
import { data as musicData } from '../dist/commands/music/index.js';
const owner = '123456789012345678';
async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'cirno-command-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new PlaylistStore(join(directory, 'playlists.json'));
    for (const method of ['get', 'list', 'create', 'rename', 'delete', 'add', 'remove', 'move']) t.mock.method(playlists, method, store[method].bind(store));
    return store;
}
function command(sub, values = {}, user = owner) {
    const replies = [];
    const interaction = { guildId: 'guild', user: { id: user }, replies, deferred: false,
        options: { getSubcommand: () => sub, getString: key => values[key] ?? null, getInteger: key => values[key] ?? null, getBoolean: key => values[key] ?? null },
        deferReply: async payload => { assert.equal(payload.flags, MessageFlags.Ephemeral); interaction.deferred = true; },
        editReply: async payload => replies.push(payload) };
    return interaction;
}
function button(customId, user = owner) {
    const replies = [];
    const interaction = { customId, user: { id: user }, message: { createdTimestamp: Date.now() }, deferred: false, replies,
        isAutocomplete: () => false, isButton: () => true,
        deferUpdate: async () => { interaction.deferred = true; }, editReply: async p => replies.push(p), reply: async p => replies.push(p) };
    return interaction;
}
test('slash command definitions are valid and all required options precede optional ones', () => {
    for (const command of [data, musicData]) {
        const schema = command.toJSON(); assert.ok(schema.options.length <= 25);
        for (const sub of schema.options) {
            let optional = false;
            for (const option of sub.options ?? []) { if (!option.required) optional = true; else assert.equal(optional, false); }
        }
    }
});
test('create/list/show remain private and paginated at Discord limits', async t => {
    const store = await fixture(t);
    const create = command('create', { name: '中文清單' }); await execute(create);
    const id = (await store.list(owner))[0].id;
    await store.add(owner, id, Array.from({ length: 23 }, (_, i) => ({ source: i % 2 ? 'remote' : 'local', id: String(i), title: '@everyone 歌曲 ' + i })));
    const show = command('show', { playlist: id }); await execute(show);
    const payload = show.replies[0];
    assert.equal(payload.embeds[0].toJSON().description.split('\n').length, 10);
    assert.deepEqual(payload.allowedMentions.parse, []);
    const next = payload.components[0].toJSON().components[1].custom_id;
    assert.ok(next.length <= 100);
    const page = button(next); await handlePlaylistInteraction(page);
    assert.match(page.replies[0].embeds[0].toJSON().description, /^11\./);
    const list = command('list'); await execute(list);
    assert.match(list.replies[0].embeds[0].toJSON().description, /中文清單/);
});
test('forged playlist ID cannot read or mutate another user through commands or buttons', async t => {
    const store = await fixture(t); const p = await store.create(owner, 'private');
    const attack = command('rename', { playlist: p.id, name: 'stolen' }, 'other'); await execute(attack);
    assert.match(attack.replies[0].content, /找不到/);
    const forged = button(`playlist:delete:${p.id}:${p.revision}:${owner}`, 'other');
    await handlePlaylistInteraction(forged);
    assert.equal(forged.replies[0].flags, MessageFlags.Ephemeral);
    assert.match(forged.replies[0].content, /擁有者/);
    assert.equal((await store.get(owner, p.id)).name, 'private');
});
test('delete requires explicit confirmation and rejects stale confirmation', async t => {
    const store = await fixture(t); const p = await store.create(owner, 'keep');
    const del = command('delete', { playlist: p.id }); await execute(del);
    assert.equal((await store.list(owner)).length, 1);
    const id = del.replies[0].components[0].toJSON().components[0].custom_id;
    await store.rename(owner, p.id, 'updated');
    const stale = button(id); await handlePlaylistInteraction(stale); assert.match(stale.replies[0].content, /更新/);
    const again = command('delete', { playlist: p.id }); await execute(again);
    const confirmed = button(again.replies[0].components[0].toJSON().components[0].custom_id);
    await handlePlaylistInteraction(confirmed); assert.equal((await store.list(owner)).length, 0);
});
test('playlist play resolves songs, reports unavailable entries and shuffles only the queued copy', async t => {
    const store = await fixture(t);
    const tracks = ['a', 'b', 'missing'].map(id => ({ source: 'local', id, title: id }));
    const p = await store.create(owner, 'play me', tracks);
    t.mock.method(musicLibrary, 'load', async () => []);
    t.mock.method(musicLibrary, 'get', id => id === 'missing' ? undefined : { id, title: id, path: id, filename: id });
    t.mock.method(musicLibrary, 'playablePath', async track => track.path);
    t.mock.method(Math, 'random', () => 0);
    let queued;
    t.mock.method(musicPlayer, 'enqueueMany', async (...args) => { queued = args; return { panel: {} }; });
    const play = command('play', { playlist: p.id, shuffle: true, next: true });
    const voice = { type: ChannelType.GuildVoice };
    play.guild = { voiceStates: { cache: new Map([[owner, { channel: voice }]]) } };
    play.channel = { isDMBased: () => false, isTextBased: () => true };
    await execute(play);
    assert.deepEqual(queued[4].map(track => track.id), ['b', 'a']);
    assert.equal(queued[5], true);
    assert.match(play.replies[0].content, /1 首暫時無法取得/);
    assert.deepEqual((await store.get(owner, p.id)).entries.map(e => e.id), ['a', 'b', 'missing']);
});
