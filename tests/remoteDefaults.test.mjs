import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ChannelType } from 'discord.js';
import { data as musicData, execute as executeMusic, handleMusicInteraction } from '../dist/commands/music/index.js';
import { data as playlistData, execute as executePlaylist } from '../dist/commands/playlist/index.js';
import { completePlaylist } from '../dist/features/playlists/presentation/autocomplete.js';
import { createBrowser } from '../dist/features/music/presentation/libraryBrowser.js';
import { browsers } from '../dist/features/music/presentation/browserState.js';
import { musicLibrary } from '../dist/features/music/library/localLibrary.js';
import { musicPlayer } from '../dist/features/music/playback/player.js';
import { playlists } from '../dist/features/playlists/store.js';
import logger from '../dist/shared/logging/logger.js';

const owner = '123456789012345678';
const first = '00000000-0000-4000-8000-000000000001', second = '00000000-0000-4000-8000-000000000002';
const song = id => ({ id, title: `remote ${id}`, mimeType: 'audio/wav', byteSize: 100, sha256: 'a'.repeat(64), durationSeconds: 2 });
function interaction(sub, values = {}) {
    const replies = [];
    const result = { commandName: 'music', guildId: 'guild', user: { id: owner, displayName: 'listener' }, replies,
        guild: { voiceStates: { cache: new Map([[owner, { channel: { type: ChannelType.GuildVoice } }]]) } },
        channel: { isDMBased: () => false, isTextBased: () => true },
        message: { id: 'panel', createdTimestamp: Date.now() },
        isAutocomplete: () => false, isButton: () => false, isStringSelectMenu: () => false,
        options: { getSubcommand: () => sub, getString: key => values[key] ?? null,
            getInteger: () => null, getBoolean: key => values[key] ?? null,
            getFocused: detailed => detailed ? { name: 'song', value: values.query ?? '' } : values.query ?? '' },
        deferReply: async () => { result.deferred = true; result.ephemeral = true; }, deferUpdate: async () => {},
        editReply: async payload => replies.push(payload), reply: async payload => replies.push(payload),
        followUp: async payload => replies.push(payload), respond: async payload => replies.push(payload) };
    return result;
}
function browserOf(payload) {
    const key = payload.components[0].toJSON().components[0].custom_id.split(':')[1];
    return { key, browser: browsers.get(key) };
}
async function fixture(t) {
    t.mock.method(logger, 'error', () => {});
    const requests = [], queued = [], localCalls = [];
    let status = 200;
    const server = createServer((req, res) => {
        assert.equal(req.headers.authorization, 'Bearer defaults-test-token');
        const url = new URL(req.url, 'http://fixture'); requests.push(url);
        res.writeHead(status, { 'content-type': 'application/json' });
        if (status !== 200) { res.end('{}'); return; }
        if (url.pathname === '/v1/songs') {
            const items = url.searchParams.get('cursor') ? [song(second)]
                : url.searchParams.get('query') === 'ambiguous' ? [song(first), song(second)] : [song(first)];
            res.end(JSON.stringify({ items, nextCursor: url.searchParams.get('cursor') ? null : first }));
        } else res.end(JSON.stringify(song(url.pathname.split('/').at(-1))));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const keys = ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'];
    const previous = keys.map(key => process.env[key]);
    process.env.REMOTE_MUSIC_API_URL = `http://127.0.0.1:${server.address().port}/`;
    process.env.REMOTE_MUSIC_API_TOKEN = 'defaults-test-token';
    t.after(async () => {
        keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
        browsers.clear(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    });
    for (const method of ['load', 'reload', 'search', 'get']) t.mock.method(musicLibrary, method, () => {
        localCalls.push(method); throw new Error('Unexpected local library access');
    });
    t.mock.method(musicPlayer, 'get', () => undefined);
    t.mock.method(musicPlayer, 'assertPanel', () => {});
    t.mock.method(musicPlayer, 'enqueueMany', async (...args) => { queued.push(args[4]); return { panel: {} }; });
    return { requests, queued, localCalls, fail: () => { status = 503; } };
}

test('every source option advertises remote as the default and first choice', () => {
    for (const data of [musicData, playlistData]) for (const sub of data.toJSON().options) {
        const source = sub.options?.find(option => option.name === 'source');
        if (source) { assert.match(source.description, /預設遠端/); assert.equal(source.choices[0].value, 'remote'); }
    }
    assert.ok(musicData.toJSON().options.find(sub => sub.name === 'reload').options.some(option => option.name === 'source'));
});
test('music play and ambiguous matches default to remote without scanning local files', async t => {
    const { queued, localCalls } = await fixture(t);
    const play = interaction('play', { song: first }); await executeMusic(play);
    assert.equal(queued[0][0].source, 'remote'); assert.equal(queued[0][0].id, first);
    const ambiguous = interaction('play', { song: 'ambiguous' }); await executeMusic(ambiguous);
    assert.equal(browserOf(ambiguous.replies[0]).browser.source, 'remote');
    assert.deepEqual(localCalls, []);
});
test('library, reload and browser helper all default to remote', async t => {
    const { requests, localCalls } = await fixture(t);
    for (const sub of ['library', 'reload']) {
        const command = interaction(sub); await executeMusic(command);
        assert.equal(browserOf(command.replies[0]).browser.source, 'remote');
    }
    assert.equal(browserOf(await createBrowser(interaction('library'), 'library')).browser.source, 'remote');
    assert.equal(requests.length, 3); assert.deepEqual(localCalls, []);
});
test('panel song selection opens remote even when the current track is local or absent', async t => {
    const { localCalls } = await fixture(t);
    for (const current of [undefined, { track: { id: 'local', title: 'local', filename: 'local.wav' } }]) {
        t.mock.method(musicPlayer, 'get', () => ({ id: 'session', queue: { current, pending: [] } }));
        const button = interaction('panel'); button.isButton = () => true; button.customId = 'music:session:library:1';
        await handleMusicInteraction(button);
        assert.equal(browserOf(button.replies[0]).browser.source, 'remote');
    }
    assert.deepEqual(localCalls, []);
});
test('remote browser pagination and selection keep using the remote catalog', async t => {
    const { requests, queued, localCalls } = await fixture(t);
    const { key, browser } = browserOf(await createBrowser(interaction('library'), 'library'));
    const next = interaction('library'); next.isButton = () => true; next.customId = `musicbrowse:${key}:next`;
    await handleMusicInteraction(next);
    assert.equal(browser.page, 1); assert.equal(requests.at(-1).searchParams.get('cursor'), first);
    const select = interaction('library'); select.isStringSelectMenu = () => true;
    select.customId = `musicbrowse:${key}:select`; select.values = [second];
    await handleMusicInteraction(select);
    assert.equal(queued[0][0].source, 'remote'); assert.equal(queued[0][0].id, second);
    assert.deepEqual(localCalls, []);
});
test('queue commands and panel queue preserve existing mixed entries without querying either catalog', async t => {
    const { requests, localCalls } = await fixture(t);
    const pending = [{ track: { id: 'local', title: 'local queued', filename: 'local.wav' }, requestedBy: 'listener' },
        { track: { ...song(first), source: 'remote' }, requestedBy: 'listener' }];
    t.mock.method(musicPlayer, 'get', () => ({ id: 'session', queue: { pending } }));
    const command = interaction('queue'); await executeMusic(command);
    const button = interaction('queue'); button.isButton = () => true; button.customId = 'music:session:queue:1';
    await handleMusicInteraction(button);
    for (const payload of [command.replies[0], button.replies[0]]) {
        assert.match(payload.embeds[0].toJSON().description, /local queued/);
        assert.match(payload.embeds[0].toJSON().description, /remote/);
    }
    assert.equal(pending[0].track.id, 'local'); assert.deepEqual(requests, []); assert.deepEqual(localCalls, []);
});
test('music and playlist song autocomplete default to the same remote catalog', async t => {
    const { localCalls } = await fixture(t);
    for (const handler of [handleMusicInteraction, completePlaylist]) {
        const autocomplete = interaction('add'); autocomplete.isAutocomplete = () => true;
        await handler(autocomplete); assert.equal(autocomplete.replies[0][0].value, first);
    }
    assert.deepEqual(localCalls, []);
});
test('playlist add without a source saves a remote reference to the shared backend', async t => {
    const { localCalls } = await fixture(t);
    const id = '00000000-0000-4000-8000-000000000010';
    const playlist = { id, ownerId: owner, name: 'mix', revision: 1, entries: [] };
    t.mock.method(playlists, 'get', async () => playlist);
    const add = t.mock.method(playlists, 'add', async (_owner, _id, tracks, revision) => {
        assert.equal(revision, 1); assert.equal(tracks[0].source, 'remote');
        assert.equal(tracks[0].library, process.env.REMOTE_MUSIC_API_URL);
        return { ...playlist, revision: 2, entries: tracks.map(track => ({ ...track, entryId: first })) };
    });
    await executePlaylist(interaction('add', { playlist: id, song: first }));
    assert.equal(add.mock.callCount(), 1); assert.deepEqual(localCalls, []);
});
test('explicit local sources still work for play, browse, reload and both autocomplete handlers', async t => {
    const { queued, requests } = await fixture(t);
    const local = { id: 'local-id', title: 'local song', filename: 'local.wav' };
    t.mock.method(musicLibrary, 'load', async () => [local]);
    t.mock.method(musicLibrary, 'get', () => local);
    t.mock.method(musicLibrary, 'search', () => [local]);
    t.mock.method(musicLibrary, 'reload', async () => [local]);
    await executeMusic(interaction('play', { source: 'local', song: local.id }));
    assert.equal(queued[0][0].id, local.id);
    const library = interaction('library', { source: 'local' }); await executeMusic(library);
    assert.equal(browserOf(library.replies[0]).browser.source, 'local');
    const reload = interaction('reload', { source: 'local' }); await executeMusic(reload);
    assert.match(reload.replies[0], /本地曲庫已更新/);
    for (const handler of [handleMusicInteraction, completePlaylist]) {
        const autocomplete = interaction('add', { source: 'local' }); autocomplete.isAutocomplete = () => true;
        await handler(autocomplete); assert.equal(autocomplete.replies[0][0].value, local.id);
    }
    const id = '00000000-0000-4000-8000-000000000010';
    const playlist = { id, ownerId: owner, name: 'local', revision: 1, entries: [] };
    t.mock.method(playlists, 'get', async () => playlist);
    const add = t.mock.method(playlists, 'add', async (_owner, _id, tracks) => {
        assert.equal(tracks[0].source, 'local'); assert.equal(tracks[0].id, local.id);
        return { ...playlist, entries: tracks.map(track => ({ ...track, entryId: first })) };
    });
    await executePlaylist(interaction('add', { playlist: id, song: local.id, source: 'local' }));
    assert.equal(add.mock.callCount(), 1);
    assert.deepEqual(requests, []);
});
test('remote default failures never fall back to the local library', async t => {
    const { localCalls, fail } = await fixture(t); fail();
    const library = interaction('library'); await executeMusic(library);
    assert.match(library.replies[0].content, /503/); assert.deepEqual(localCalls, []);
    delete process.env.REMOTE_MUSIC_API_TOKEN;
    const missing = interaction('library'); await executeMusic(missing);
    assert.match(missing.replies[0].content, /請設定 REMOTE_MUSIC_API_URL/); assert.deepEqual(localCalls, []);
});
