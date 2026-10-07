import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicQueue, GuildTasks } from '../dist/lib/musicQueue.js';
const entry = (id, source = 'local') => ({ track: { id, title: id, ...(source === 'remote' ? { source } : { filename: id }) }, requestedBy: 'listener' });
function queue() { const q = new MusicQueue(); q.addMany(['a', 'b', 'c'].map(id => entry(id))); q.advance('finished'); return q; }
test('single repeat repeats completion, but next always skips', () => {
    const q = queue(); q.repeat = 'one';
    assert.equal(q.advance('finished').track.id, 'a');
    assert.equal(q.advance('skip').track.id, 'b');
    assert.equal(q.previous().track.id, 'a');
    assert.deepEqual(q.pending.map(e => e.track.id), ['b', 'c']);
});
test('repeat all rotates, failed tracks are excluded by source and history is bounded', () => {
    const q = queue(); q.repeat = 'all';
    for (let i = 0; i < 25; i++) q.advance('finished');
    assert.equal(q.history.length, 20);
    assert.equal(q.pending.length, 2);
    q.clear(); q.addMany([entry('same'), entry('same', 'remote'), entry('same')]); q.advance('finished');
    assert.equal(q.advance('error').track.source, 'remote');
    assert.equal(q.pending.length, 0);
});
test('insert next, reorder, remove and clear preserve the current track', () => {
    const q = queue(); q.addMany([entry('x'), entry('y')], true);
    assert.deepEqual(q.pending.map(e => e.track.id), ['x', 'y', 'b', 'c']);
    q.move(4, 1); assert.deepEqual(q.pending.map(e => e.track.id), ['c', 'x', 'y', 'b']);
    assert.equal(q.remove(2).track.id, 'x');
    assert.throws(() => q.move(0, 1)); assert.throws(() => q.remove(20));
    q.clearPending(); assert.equal(q.current.track.id, 'a'); assert.equal(q.pending.length, 0);
});
test('batch enqueue and previous enforce capacity atomically', () => {
    const q = queue(); q.advance('skip');
    q.addMany(Array.from({ length: 99 }, () => entry('fill')));
    assert.throws(() => q.addMany([entry('over')]), /100/);
    assert.throws(() => q.previous(), /已滿/);
    assert.equal(q.pending.length, 100); assert.equal(q.current.track.id, 'b');
    assert.equal(q.history.at(-1).track.id, 'a');
});
test('shuffle only permutes pending tracks and advances the revision', () => {
    const q = queue(); const before = q.revision;
    q.shuffle(() => 0); assert.equal(q.current.track.id, 'a');
    assert.deepEqual(q.pending.map(e => e.track.id), ['c', 'b']); assert.ok(q.revision > before);
});
test('guild mutations remain ordered after a rejected mutation', async () => {
    const tasks = new GuildTasks(), results = [];
    const a = tasks.run('g', async () => { await new Promise(r => setTimeout(r, 10)); results.push(1); throw Error('failed'); });
    const b = tasks.run('g', () => results.push(2));
    await assert.rejects(a); await b; assert.deepEqual(results, [1, 2]);
});
test('previous undoes repeat-all rotation without growing duplicate queue entries', () => {
    const q = queue(); q.repeat = 'all';
    q.advance('skip');
    assert.deepEqual(q.pending.map(e => e.track.id), ['c', 'a']);
    for (let i = 0; i < 5; i++) {
        q.previous(); assert.equal(q.current.track.id, 'a');
        assert.deepEqual(q.pending.map(e => e.track.id), ['b', 'c']);
        q.advance('skip');
    }
    assert.equal(q.pending.length, 2);
});
