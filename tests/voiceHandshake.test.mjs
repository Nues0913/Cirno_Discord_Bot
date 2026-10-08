import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
let waiting, calls = 0;
mock.module('@discordjs/voice', { namedExports: {
    VoiceConnectionStatus: { Ready: 'ready', Disconnected: 'disconnected', Destroyed: 'destroyed' },
    joinVoiceChannel: () => {
        const connection = new EventEmitter(); connection.state = { status: 'connecting' };
        connection.destroy = () => { connection.state.status = 'destroyed'; connection.emit('destroyed'); };
        return connection;
    },
    entersState: (_connection, _status, signal) => { calls++; waiting(signal); return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }); },
    createAudioResource() {}, createAudioPlayer() {}, AudioPlayerStatus: {}, NoSubscriberBehavior: {}, StreamType: {}
} });
const { MusicPlayer } = await import('../dist/features/music/playback/player.js');
const { MusicSession } = await import('../dist/features/music/playback/session.js');
const { VoiceSessionManager } = await import('../dist/features/voice/sessionManager.js');
test('authorized STOP cancels the real handshake path before the guild task can load audio', async t => {
    const player = new MusicPlayer();
    const channel = { id: 'voice', guild: { id: 'guild', voiceStates: { cache: new Map([['owner', { channelId: 'voice' }], ['outsider', { channelId: 'other' }]]) } } };
    const panel = { message: { id: 'panel' }, update() {} };
    const session = new MusicSession(channel, new VoiceSessionManager().acquire('guild', 'music'), () => panel);
    player.sessions.set('guild', session); session.lease.onDispose(() => player.dispose(session));
    t.after(() => player.shutdown());
    let started, signal; const ready = new Promise(resolve => { started = resolve; });
    waiting = value => { signal = value; started(); };
    const connecting = player.tasks.run('guild', () => player.connect(session));
    const rejected = assert.rejects(connecting, { name: 'AbortError' }); await ready;
    // Invalid controls must not abort the active session even though they are queued.
    const outsider = player.control('guild', 'outsider', 'stop');
    const stale = player.control('guild', 'owner', 'stop', { sessionId: 'old', messageId: 'panel', generation: 0 });
    const invalid = [assert.rejects(outsider), assert.rejects(stale)];
    assert.equal(signal.aborted, false);
    await player.control('guild', 'owner', 'stop', { sessionId: session.id, messageId: 'panel', generation: 0 });
    await Promise.all([rejected, ...invalid]);
    assert.ok(signal.aborted); assert.equal(session.active, false); assert.equal(player.get('guild'), undefined);
    assert.equal(calls, 1);
});
