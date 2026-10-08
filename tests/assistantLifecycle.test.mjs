import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
let model;
mock.module('../dist/features/assistant/reply.js', { namedExports: { generateNvidiaNimReply: (...args) => model(...args) } });
const { registerMentions } = await import('../dist/features/assistant/presentation/mentions.js');
test('mention cleanup aborts active work, rejects late callbacks/results and permits a fresh registration', async t => {
    let complete, signal, started;
    const ready = new Promise(resolve => { started = resolve; });
    model = (_prompt, update, _status, incoming) => {
        signal = incoming; started();
        return new Promise(resolve => { complete = answer => { update('late preview'); resolve(answer); }; });
    };
    const client = new EventEmitter(); client.user = { id: 'bot' };
    const edits = [], sends = [];
    const message = { author: { bot: false }, mentions: { users: new Map([['bot', {}]]) }, content: '<@bot> question',
        channel: { isSendable: () => true, send: async p => sends.push(p) }, reply: async () => ({ edit: async p => edits.push(p) }) };
    const dispose = registerMentions(client); t.after(dispose);
    client.emit('messageCreate', message); await ready; dispose(); dispose();
    assert.ok(signal.aborted); assert.equal(client.listenerCount('messageCreate'), 0);
    complete('late answer'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(edits, []); assert.deepEqual(sends, []);
    model = async () => 'fresh answer';
    const next = registerMentions(client); t.after(next);
    client.emit('messageCreate', message); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(edits.map(p => p.content), ['fresh answer']);
});
