import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamCompletion } from '../dist/features/assistant/providerClient.js';
import { executeToolCall } from '../dist/features/assistant/tools.js';
test('model and search transports receive caller cancellation and terminate outstanding bodies/tools', async t => {
    const keys = ['NVIDIA_API_KEY', 'TAVILY_API_KEY']; const old = keys.map(k => process.env[k]);
    keys.forEach(k => { process.env[k] = 'fake-cancellation-fixture'; });
    t.after(() => keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }));
    const captured = []; let bodyCancelled = false, started;
    const ready = new Promise(resolve => { started = resolve; });
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        captured.push(options.signal); started();
        return new Response(new ReadableStream({ cancel() { bodyCancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const controller = new AbortController();
    const reading = streamCompletion([{ role: 'user', content: 'question' }], undefined, false, 'auto', controller.signal);
    const rejected = assert.rejects(reading, { name: 'AbortError' });
    await ready; await new Promise(resolve => setImmediate(resolve)); controller.abort(); await rejected;
    assert.ok(captured[0].aborted); assert.ok(bodyCancelled);
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
        captured.push(options.signal);
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    });
    const searchController = new AbortController();
    const searching = executeToolCall({ id: 'search', function: { name: 'web_search', arguments: '{"query":"fixture"}' } }, searchController.signal);
    const searchRejected = assert.rejects(searching, { name: 'AbortError' });
    searchController.abort(); await searchRejected; assert.ok(captured[1].aborted);
});
