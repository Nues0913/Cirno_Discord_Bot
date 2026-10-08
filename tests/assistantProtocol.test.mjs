import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCompletionStream } from '../dist/features/assistant/protocol.js';
import { StreamingReply } from '../dist/features/assistant/presentation/streamingReply.js';

function stream(parts, cancelled) {
    const bytes = new TextEncoder().encode(parts);
    let offset = 0;
    return new ReadableStream({
        pull(controller) {
            if (offset === bytes.length) return controller.close();
            // Deliberately split UTF-8, JSON and CRLF across transport reads.
            controller.enqueue(bytes.slice(offset, ++offset));
        }, cancel: cancelled
    });
}
const event = delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\r\n`;
test('SSE preserves UTF-8 and assembles tool fragments in index order, releasing the stream at DONE', async () => {
    const updates = []; let cancelled = false;
    const body = stream(': heartbeat\r\n' + event({ content: '繁體' }) + event({ reasoning_content: 'reason' })
        + event({ tool_calls: [{ index: 1, id: 'second', function: { name: 'web_', arguments: '{"query":' } },
            { index: 0, id: 'first', function: { name: 'fetch_url', arguments: '{}' } }] })
        + event({ tool_calls: [{ index: 1, function: { name: 'search', arguments: '"天氣"}' } }], content: '中文' })
        + 'data: [DONE]\r\nignored after completion', () => { cancelled = true; });
    const result = await readCompletionStream(body, content => updates.push(content));
    assert.equal(result.content, '繁體中文'); assert.equal(result.reasoningContent, 'reason');
    assert.deepEqual(updates, ['繁體', '繁體中文']);
    assert.deepEqual(result.toolCalls.map(call => call.id), ['first', 'second']);
    assert.deepEqual(result.toolCalls[1].function, { name: 'web_search', arguments: '{"query":"天氣"}' });
    assert.ok(cancelled); assert.equal(body.locked, false);
});
test('malformed streaming response releases its reader and final unterminated line is processed', async () => {
    let cancelled = false;
    const body = stream('data: not-json\n', () => { cancelled = true; });
    await assert.rejects(readCompletionStream(body), /invalid streaming data/);
    assert.ok(cancelled); assert.equal(body.locked, false);
    const final = await readCompletionStream(stream('data: {"choices":[{"delta":{"content":"final"}}]}'));
    assert.equal(final.content, 'final');
});
test('final Discord answer waits for queued edits and splits messages without mentions', async () => {
    const rendered = []; let finishEdit;
    const first = new Promise(resolve => { finishEdit = resolve; });
    const response = { async edit(payload) { if (!rendered.length) { rendered.push(payload); await first; } else rendered.push(payload); } };
    const sent = []; const source = { channel: { isSendable: () => true, async send(payload) { sent.push(payload); } } };
    const reply = new StreamingReply(source, response);
    reply.update('partial'); await Promise.resolve();
    const complete = reply.complete('x'.repeat(2100));
    assert.equal(rendered.length, 1); finishEdit(); await complete;
    assert.equal(rendered.at(-1).content.length, 2000); assert.equal(sent[0].content.length, 100);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});
