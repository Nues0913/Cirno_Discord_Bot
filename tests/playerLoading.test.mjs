import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
let load;
mock.module('../dist/lib/remoteAudio.js', { namedExports: {
    createRemoteStreamAudio: (...args) => load(...args),
    createRemoteDownloadedAudio: (...args) => load(...args)
} });
const { MusicPlayer, MusicSession } = await import('../dist/lib/localMusicPlayer.js');
const { VoiceSessionManager } = await import('../dist/lib/voiceSessionManager.js');
function fixture(t) {
    const player = new MusicPlayer();
    const channel = { id: 'voice', guild: { id: 'guild', voiceStates: { cache: new Map([['user', { channelId: 'voice' }]]) } } };
    const session = new MusicSession(channel, new VoiceSessionManager().acquire('guild', 'music'));
    session.panel.update = () => {};
    session.queue.addMany(['a', 'b', 'c'].map(id => ({ track: { source: 'remote', id, title: id }, requestedBy: 'user' })));
    session.lease.onDispose(() => player.dispose(session));
    player.sessions.set('guild', session);
    t.after(() => player.end(session, 'test cleanup'));
    return { player, session };
}
test('automatic network aborts skip failed songs and end after three rather than hanging in loading', async t => {
    const { player, session } = fixture(t);
    let attempts = 0;
    load = async (_track, _volume, _error, controller) => {
        attempts++; controller.abort(); throw new Error('simulated transport timeout');
    };
    await player.tasks.run('guild', () => player.advance(session, 'finished'));
    assert.equal(attempts, 3); assert.equal(session.failures, 3);
    assert.equal(session.active, false); assert.equal(session.status, 'ended');
});
test('authorized stop interrupts an in-flight load without treating cancellation as a bad song', async t => {
    const { player, session } = fixture(t);
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    load = async (_track, _volume, _error, controller) => {
        started();
        await new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    };
    const loading = player.tasks.run('guild', () => player.advance(session, 'finished'));
    await ready;
    const stopped = player.control('guild', 'user', 'stop');
    await Promise.all([loading, stopped]);
    assert.equal(session.failures, 0); assert.equal(session.active, false);
});
test('late completion from replaced audio cannot advance the current song', async t => {
    const { player, session } = fixture(t);
    let advances = 0; player.advance = async () => { advances++; };
    session.generation = 4;
    player.scheduleAdvance(session, 3, 'finished');
    await player.tasks.run('guild', () => {});
    assert.equal(advances, 0);
    player.scheduleAdvance(session, 4, 'finished');
    await player.tasks.run('guild', () => {});
    assert.equal(advances, 1);
});
