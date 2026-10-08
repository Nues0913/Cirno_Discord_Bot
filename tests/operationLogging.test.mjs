import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const logged = [];
mock.module('../dist/shared/logging/logger.js', { defaultExport: Object.fromEntries(
    ['info', 'warn', 'error'].map(level => [level, (...args) => logged.push({ level, args })])
) });
const { UserActionError, ConfigurationError } = await import('../dist/shared/logging/operationErrors.js');
const { logInteractionError } = await import('../dist/shared/discord/interactionErrors.js');
const { validatePlaylistId } = await import('../dist/features/playlists/validation.js');
const { MusicPlayer } = await import('../dist/features/music/playback/player.js');
const { MusicQueue } = await import('../dist/features/music/model/queue.js');
const { assertPlaybackPermissions } = await import('../dist/features/music/playback/permissions.js');
const { PlaylistHttpClient } = await import('../dist/features/playlists/client.js');
const { completePlaylist } = await import('../dist/features/playlists/presentation/autocomplete.js');
const { playlists } = await import('../dist/features/playlists/store.js');
const { remoteMusicApiSettings } = await import('../dist/shared/http/musicApi.js');
const { searchRemoteSongs, getRemoteSong } = await import('../dist/features/music/library/remoteLibrary.js');
const { streamCompletion } = await import('../dist/features/assistant/providerClient.js');
const owner = '123456789012345678';

function assertLogged(error, level) {
    logged.length = 0;
    logInteractionError(error);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, level);
    if (level === 'error') assert.equal(logged[0].args[0], error);
    else assert.equal(typeof logged[0].args[0], 'string');
}

test('explicit user/configuration errors log without stacks; unclassified failures stay ERROR', () => {
    assertLogged(new UserActionError('input rejected'), 'info');
    assertLogged(new ConfigurationError('operator attention'), 'warn');
    assertLogged(new TypeError('internal bug'), 'error');
    // Identical text must not accidentally downgrade an unrelated internal failure.
    assertLogged(new Error('此面板已失效，請使用 /music panel 或 /music play。'), 'error');
});

test('invalid playlist IDs, expired panels and empty history are INFO', () => {
    for (const action of [() => validatePlaylistId('typed name'),
        () => new MusicPlayer().assertPanel('guild', 'old-session', 'old-message'),
        () => new MusicQueue().previous()]) {
        assert.throws(action, error => { assertLogged(error, 'info'); return error instanceof UserActionError; });
    }
});

test('a user outside voice logs INFO while missing Bot permissions log WARN', () => {
    const channel = { id: 'voice', guild: { voiceStates: { cache: new Map() }, members: { me: {} } },
        permissionsFor: () => ({ has: () => false }) };
    assert.throws(() => assertPlaybackPermissions(channel, {}, owner), error => {
        assertLogged(error, 'info'); return true;
    });
    channel.guild.voiceStates.cache.set(owner, { channelId: 'voice' });
    assert.throws(() => assertPlaybackPermissions(channel, {}, owner), error => {
        assertLogged(error, 'warn'); return true;
    });
});

test('Discord missing input/message logs INFO and permission/callback failures log WARN without tokens', () => {
    for (const [code, level] of [['CommandInteractionOptionNotFound', 'info'], [10008, 'info'],
        [50001, 'warn'], [50013, 'warn'], [10062, 'warn'], [40060, 'warn']]) {
        const error = Object.assign(new Error('private-fixture-token'), {
            code, url: 'https://discord.com/interactions/private-fixture-token/callback'
        });
        assertLogged(error, level);
        assert.doesNotMatch(JSON.stringify(logged), /private-fixture-token|https:\/\//);
    }
});

test('entry autocomplete before playlist selection responds once without loading data or logging', async t => {
    logged.length = 0;
    const get = t.mock.method(playlists, 'get', async () => { throw new Error('must not query'); });
    const interaction = { user: { id: owner }, responded: false, options: {
        getFocused: () => ({ name: 'entry', value: '' }),
        getString: (name, required) => { assert.equal(name, 'playlist'); assert.notEqual(required, true); return null; }
    }, respond: t.mock.fn(async choices => { assert.deepEqual(choices, []); }) };
    await completePlaylist(interaction);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(interaction.respond.mock.callCount(), 1);
    assert.deepEqual(logged, []);
});

test('invalid selected playlist IDs in autocomplete log INFO and respond with empty choices', async t => {
    logged.length = 0;
    const interaction = { user: { id: owner }, responded: false, options: {
        getFocused: () => ({ name: 'entry', value: '' }), getString: () => 'unselected playlist name'
    }, respond: t.mock.fn(async choices => assert.deepEqual(choices, [])) };
    await completePlaylist(interaction);
    assert.deepEqual(logged.map(entry => entry.level), ['info']);
    assert.equal(interaction.respond.mock.callCount(), 1);
});

function configure(t) {
    const keys = ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'];
    const saved = keys.map(key => process.env[key]);
    process.env.REMOTE_MUSIC_API_URL = 'http://127.0.0.1:12345/';
    process.env.REMOTE_MUSIC_API_TOKEN = 'fixture-token';
    t.after(() => keys.forEach((key, i) => {
        if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    }));
}

test('absent or invalid API settings are WARN without exposing the configured URL', t => {
    configure(t);
    delete process.env.REMOTE_MUSIC_API_TOKEN;
    assert.throws(remoteMusicApiSettings, error => { assertLogged(error, 'warn'); return true; });
    process.env.REMOTE_MUSIC_API_TOKEN = 'fixture-token';
    process.env.REMOTE_MUSIC_API_URL = 'https://secret:password@example.com';
    assert.throws(remoteMusicApiSettings, error => { assertLogged(error, 'warn'); return true; });
    assert.doesNotMatch(JSON.stringify(logged), /secret|password/);
});

test('an unconfigured assistant API key logs WARN before making a network request', async t => {
    const saved = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    t.after(() => { if (saved === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = saved; });
    const fetcher = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    await assert.rejects(streamCompletion([]), error => { assertLogged(error, 'warn'); return true; });
    assert.equal(fetcher.mock.callCount(), 0);
});

test('playlist HTTP user conflicts are INFO; auth, unavailable routes and server failures remain ERROR', async t => {
    configure(t);
    for (const [status, path, level] of [[400, '', 'info'], [409, '/record', 'info'], [413, '', 'info'],
        [404, '/record', 'info'], [404, '', 'error'], [401, '', 'error'], [403, '', 'error'], [503, '', 'error']]) {
        const client = new PlaylistHttpClient(async () => new Response('{"error":"rejected"}', { status }));
        await assert.rejects(client.request(owner, 'GET', path), error => { assertLogged(error, level); return true; });
    }
});

test('network failures and malformed service responses remain ERROR', async t => {
    configure(t);
    for (const fetcher of [async () => { throw new Error('ECONNRESET'); }, async () => new Response('not json')]) {
        await assert.rejects(new PlaylistHttpClient(fetcher).request(owner, 'GET', ''), error => {
            assertLogged(error, 'error'); return true;
        });
    }
});

test('missing song records log INFO, but a missing search route and invalid song data remain ERROR', async t => {
    configure(t);
    let status = 404;
    t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status }));
    await assert.rejects(getRemoteSong('00000000-0000-4000-8000-000000000001'), error => {
        assertLogged(error, 'info'); return true;
    });
    await assert.rejects(searchRemoteSongs(), error => { assertLogged(error, 'error'); return true; });
    status = 200;
    await assert.rejects(getRemoteSong('00000000-0000-4000-8000-000000000001'), error => {
        assertLogged(error, 'error'); return true;
    });
});
