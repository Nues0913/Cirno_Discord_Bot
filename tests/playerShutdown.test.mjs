import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MusicPlayer } from '../dist/features/music/playback/player.js';

function fixture(t) {
    const client = new EventEmitter(), player = new MusicPlayer();
    player.initialize(client);
    const guild = { id: 'shutdown-guild', members: { me: {} },
        voiceStates: { cache: new Map([['user', { channelId: 'voice' }]]) } };
    const channel = { id: 'voice', guild, joinable: true, permissionsFor: () => ({ has: () => true }) };
    const text = { isThread: () => false, permissionsFor: () => ({ has: () => true }),
        send: t.mock.fn(async () => ({ id: 'panel', edit: async () => {} })) };
    // Replace only Discord network connection; scheduling, permissions and sessions remain real.
    const connect = t.mock.method(player, 'connect', async session => {
        session.queue.advance('finished'); session.status = 'playing';
    });
    const enqueue = () => player.enqueueMany(channel, text, 'user', 'Name', [{ id: 'song', title: 'Song' }]);
    t.after(() => player.shutdown());
    return { client, player, guild, text, connect, enqueue };
}

async function holdGuild(player, guildId, t) {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const running = player.tasks.run(guildId, () => {
        started(); return new Promise(resolve => { release = resolve; });
    });
    await ready;
    t.after(() => release());
    return { release, running };
}

test('shutdown rejects queued enqueue before it can publish a panel or create a connection', async t => {
    const { player, guild, text, connect, enqueue } = fixture(t);
    const held = await holdGuild(player, guild.id, t);
    const queued = enqueue();
    const rejected = assert.rejects(queued, /已停止/);
    player.shutdown(); held.release();
    await Promise.all([held.running, rejected]);
    assert.equal(player.get(guild.id), undefined);
    assert.equal(text.send.mock.callCount(), 0);
    assert.equal(connect.mock.callCount(), 0);
});

test('reinitialization rejects old queued operations and only accepts work from the new lifecycle', async t => {
    const { client, player, guild, text, connect, enqueue } = fixture(t);
    const held = await holdGuild(player, guild.id, t);
    const stale = [enqueue(), player.control(guild.id, 'user', 'stop'),
        player.editQueue(guild.id, 'user', 'old-session', 0, 'clear'), player.panel(guild.id, text, 'user')];
    const rejected = stale.map(operation => assert.rejects(operation, /已停止或重新啟動/));
    player.shutdown(); player.initialize(client);
    const current = enqueue();
    held.release();
    const [, , session] = await Promise.all([held.running, Promise.all(rejected), current]);
    assert.equal(session.active, true);
    assert.equal(player.get(guild.id), session);
    assert.equal(session.queue.current.track.id, 'song');
    assert.equal(session.queue.pending.length, 0);
    assert.equal(text.send.mock.callCount(), 1);
    assert.equal(connect.mock.callCount(), 1);
});

test('a stopped player rejects new public operations until initialized again', async t => {
    const { player, guild, text, connect, enqueue } = fixture(t);
    player.shutdown(); player.shutdown();
    for (const operation of [enqueue, () => player.control(guild.id, 'user', 'stop'),
        () => player.editQueue(guild.id, 'user', 'old-session', 0, 'clear'), () => player.panel(guild.id, text, 'user')]) {
        await assert.rejects(operation(), /已停止/);
    }
    assert.equal(player.get(guild.id), undefined);
    assert.equal(text.send.mock.callCount(), 0);
    assert.equal(connect.mock.callCount(), 0);
});
