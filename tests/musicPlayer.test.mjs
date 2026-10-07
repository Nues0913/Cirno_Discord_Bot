import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicPlayer, MusicSession } from '../dist/lib/localMusicPlayer.js';
import { VoiceSessionManager } from '../dist/lib/voiceSessionManager.js';
import { renderMusicPanel } from '../dist/lib/musicPanel.js';
function fixture(t) {
    const player = new MusicPlayer();
    const channel = { id: 'voice', guild: { id: 'guild', voiceStates: { cache: new Map([['listener', { channelId: 'voice' }], ['outsider', { channelId: 'other' }]]) } } };
    const session = new MusicSession(channel, new VoiceSessionManager().acquire('guild', 'music'));
    session.status = 'playing';
    session.queue.addMany(['a', 'b', 'c'].map(id => ({ track: { id, title: id, duration: 120 }, requestedBy: 'listener' })));
    session.queue.advance('finished');
    session.panel.update = () => {};
    session.panel.message = { id: 'panel' };
    session.player = { pause: () => true, unpause: () => true, stop: () => {}, removeAllListeners: () => {} };
    player.sessions.set('guild', session);
    const plays = [];
    player.playCurrent = async (s, offset = 0, paused = false) => { plays.push({ id: s.queue.current.track.id, offset, paused }); s.offset = offset; s.generation++; };
    t.after(() => session.clearAudio());
    return { player, session, plays };
}
test('all playback and queue mutations require membership in the active voice channel', async t => {
    const { player, session } = fixture(t);
    for (const action of ['skip', 'previous', 'restart', 'seek', 'volume', 'shuffle', 'pauseOnly', 'resume', 'repeatMode', 'stop']) {
        await assert.rejects(player.control('guild', 'outsider', action, undefined, 10), /加入/);
    }
    await assert.rejects(player.editQueue('guild', 'outsider', session.id, session.queue.revision, 'clear'), /加入/);
    assert.equal(session.queue.current.track.id, 'a'); assert.equal(session.queue.pending.length, 2);
});
test('stale song panel and racing queue edits are rejected', async t => {
    const { player, session } = fixture(t);
    await assert.rejects(player.control('guild', 'listener', 'skip', { sessionId: session.id, messageId: 'old', generation: 0 }), /失效/);
    await assert.rejects(player.control('guild', 'listener', 'restart', { sessionId: session.id, messageId: 'panel', generation: -1 }), /切換/);
    const revision = session.queue.revision;
    const one = player.editQueue('guild', 'listener', session.id, revision, 'remove', 1);
    const two = player.editQueue('guild', 'listener', session.id, revision, 'remove', 1);
    await one; await assert.rejects(two, /變更/);
    assert.equal(session.queue.pending[0].track.id, 'c');
});
test('seek validation, elapsed offset and paused state are preserved', async t => {
    const { player, session, plays } = fixture(t);
    await player.control('guild', 'listener', 'pauseOnly');
    assert.equal(session.status, 'paused');
    await player.control('guild', 'listener', 'seek', undefined, 40);
    assert.deepEqual(plays.at(-1), { id: 'a', offset: 40, paused: true });
    assert.equal(session.view().elapsed, 40);
    for (const value of [-1, NaN, 120, Infinity]) await assert.rejects(player.control('guild', 'listener', 'seek', undefined, value), /秒數/);
    session.queue.current.track.duration = undefined;
    await assert.rejects(player.control('guild', 'listener', 'seek', undefined, 1), /秒數/);
    await player.control('guild', 'listener', 'restart');
    assert.equal(plays.at(-1).offset, 0);
});
test('explicit pause/resume are idempotent and exact volume is bounded', async t => {
    const { player, session } = fixture(t);
    await player.control('guild', 'listener', 'pauseOnly'); await player.control('guild', 'listener', 'pauseOnly');
    assert.equal(session.status, 'paused');
    await player.control('guild', 'listener', 'resume'); await player.control('guild', 'listener', 'resume');
    assert.equal(session.status, 'playing'); assert.equal(session.pauseTimer, undefined);
    await player.control('guild', 'listener', 'volume', undefined, 23); assert.equal(session.volume, 23);
    for (const value of [-1, 101, NaN]) await assert.rejects(player.control('guild', 'listener', 'volume', undefined, value));
});
test('next bypasses single-repeat, previous restores history, batch enqueue is atomic', async t => {
    const { player, session, plays } = fixture(t);
    await player.control('guild', 'listener', 'repeatMode', undefined, 'one');
    await player.control('guild', 'listener', 'skip'); assert.equal(plays.at(-1).id, 'b');
    await player.control('guild', 'listener', 'previous'); assert.equal(plays.at(-1).id, 'a');
    const track = { id: 'remote', source: 'remote', title: 'remote' };
    await player.enqueueMany(session.channel, {}, 'listener', 'Name', [track, track], true);
    assert.deepEqual(session.queue.pending.slice(0, 2).map(e => e.track.source), ['remote', 'remote']);
    const count = session.queue.pending.length;
    await assert.rejects(player.enqueueMany(session.channel, {}, 'listener', 'Name', Array(100).fill(track)), /100/);
    assert.equal(session.queue.pending.length, count);
});
test('Discord panel respects component limits and disables previous without history', t => {
    const { session } = fixture(t);
    const rendered = renderMusicPanel(session.view());
    assert.ok(rendered.components.length <= 5);
    const buttons = rendered.components.flatMap(row => row.toJSON().components);
    assert.ok(buttons.every(b => b.custom_id.length <= 100));
    assert.equal(buttons.find(b => b.custom_id.includes(':previous:')).disabled, true);
    session.status = 'ended';
    assert.ok(renderMusicPanel(session.view()).components.flatMap(row => row.toJSON().components).every(b => b.disabled));
});
