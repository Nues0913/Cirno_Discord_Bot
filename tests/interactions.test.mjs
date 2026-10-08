import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Events } from 'discord.js';

const logged = [];
mock.module('../dist/shared/logging/logger.js', { defaultExport: {
    info: () => {}, error: (...args) => logged.push(args), warn: (...args) => logged.push(args),
} });
const { registerInteractions } = await import('../dist/app/interactions.js');
const { handleMusicInteraction } = await import('../dist/features/music/presentation/commands.js');
const { handlePlaylistInteraction } = await import('../dist/features/playlists/presentation/commands.js');
const { completePlaylist } = await import('../dist/features/playlists/presentation/autocomplete.js');
const { browsers } = await import('../dist/features/music/presentation/browserState.js');

const flush = () => new Promise(resolve => setImmediate(resolve));
function callbackError(code) {
    return Object.assign(new Error('Discord callback failed'), { code,
        url: 'https://discord.com/api/v10/interactions/fixture/private-fixture-token/callback' });
}
function fixture(t, execute) {
    const client = new EventEmitter();
    client.commands = new Map([['fixture', { data: { name: 'fixture' }, execute }]]);
    t.after(registerInteractions(client));
    const interaction = { commandName: 'fixture', user: { tag: 'fixture' },
        isChatInputCommand: () => true, isRepliable: () => true,
        replied: false, deferred: false, reply: t.mock.fn(async () => {}), followUp: t.mock.fn(async () => {}) };
    return { client, interaction };
}

test('registering twice processes an interaction once; repeated cleanup cannot remove a new registration', async t => {
    const execute = t.mock.fn(async () => {});
    const { client, interaction } = fixture(t, execute);
    const first = registerInteractions(client), second = registerInteractions(client);
    assert.equal(client.listenerCount(Events.InteractionCreate), 1);
    client.emit(Events.InteractionCreate, interaction); await flush();
    assert.equal(execute.mock.callCount(), 1);
    first(); second(); assert.equal(client.listenerCount(Events.InteractionCreate), 0);
    const next = registerInteractions(client); t.after(next);
    first(); assert.equal(client.listenerCount(Events.InteractionCreate), 1);
    client.emit(Events.InteractionCreate, interaction); await flush();
    assert.equal(execute.mock.callCount(), 2);
});

test('expired and already acknowledged callbacks do not trigger another reply or log their token', async t => {
    logged.length = 0;
    for (const code of [10062, 40060]) {
        const { client, interaction } = fixture(t, async () => { throw callbackError(code); });
        client.emit(Events.InteractionCreate, interaction); await flush();
        assert.equal(interaction.reply.mock.callCount(), 0);
        assert.equal(interaction.followUp.mock.callCount(), 0);
    }
    assert.equal(logged.length, 2);
    assert.match(JSON.stringify(logged), /10062/); assert.match(JSON.stringify(logged), /40060/);
    assert.doesNotMatch(JSON.stringify(logged), /private-fixture-token|https:\/\/discord/);
});

test('ordinary command failures still notify users with the appropriate response', async t => {
    for (const acknowledged of [false, true]) {
        const { client, interaction } = fixture(t, async () => { throw new Error('ordinary failure'); });
        interaction.deferred = acknowledged;
        client.emit(Events.InteractionCreate, interaction); await flush();
        assert.equal(interaction.reply.mock.callCount(), acknowledged ? 0 : 1);
        assert.equal(interaction.followUp.mock.callCount(), acknowledged ? 1 : 0);
    }
});

test('a rejected error notification is not retried', async t => {
    const { client, interaction } = fixture(t, async () => { throw new Error('ordinary failure'); });
    interaction.reply = t.mock.fn(async () => { throw callbackError(10062); });
    client.emit(Events.InteractionCreate, interaction); await flush();
    assert.equal(interaction.reply.mock.callCount(), 1);
    assert.equal(interaction.followUp.mock.callCount(), 0);
});

test('music and playlist buttons stop after Discord rejects their acknowledgement', async t => {
    browsers.set('fixture', { userId: 'owner', guildId: 'guild', expires: Date.now() + 60000 });
    t.after(() => browsers.clear());
    for (const [handle, customId] of [[handleMusicInteraction, 'musicbrowse:fixture:next'],
        [handlePlaylistInteraction, 'playlist:cancel:fixture:0:owner']]) {
        const interaction = { customId, user: { id: 'owner' }, guildId: 'guild', guild: {},
            message: { createdTimestamp: Date.now() }, isAutocomplete: () => false, isButton: () => true,
            isStringSelectMenu: () => false, deferred: false, replied: false,
            deferUpdate: t.mock.fn(async () => { throw callbackError(40060); }),
            reply: t.mock.fn(async () => { throw callbackError(40060); }), followUp: t.mock.fn(async () => {}) };
        assert.equal(await handle(interaction), true);
        assert.equal(interaction.deferUpdate.mock.callCount(), 1);
        assert.equal(interaction.reply.mock.callCount(), 0);
        assert.equal(interaction.followUp.mock.callCount(), 0);
    }
});

test('a stale music menu whose error reply is rejected does not cause another global reply', async t => {
    const { client, interaction } = fixture(t, async () => {});
    client.commands = new Map([['music', { handleInteraction: handleMusicInteraction }]]);
    Object.assign(interaction, { customId: 'musicbrowse:expired:next', guildId: 'guild', guild: {},
        isAutocomplete: () => false, isButton: () => true, isStringSelectMenu: () => false,
        reply: t.mock.fn(async () => { throw callbackError(40060); }) });
    client.emit(Events.InteractionCreate, interaction); await flush();
    assert.equal(interaction.reply.mock.callCount(), 1);
    assert.equal(interaction.followUp.mock.callCount(), 0);
});

test('autocomplete never submits a second response after a callback rejection', async t => {
    for (const handle of [handleMusicInteraction, completePlaylist]) {
        const interaction = { commandName: 'music', isAutocomplete: () => true, responded: false,
            options: { getString: () => 'local', getFocused: detailed => detailed ? { name: 'unsupported', value: '' } : '' },
            respond: t.mock.fn(async () => { throw callbackError(10062); }) };
        await handle(interaction);
        assert.equal(interaction.respond.mock.callCount(), 1);
    }
});
