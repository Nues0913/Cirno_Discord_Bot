import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

let dns, serve;
const requests = [];
mock.module('node:dns/promises', { namedExports: { lookup: (...args) => dns(...args) } });
mock.module('node:https', { namedExports: { request: (options, callback) => {
    const req = new EventEmitter(); requests.push(options);
    req.destroy = error => req.emit('error', error);
    const abort = () => req.destroy(options.signal.reason);
    options.signal.addEventListener('abort', abort, { once: true });
    req.end = () => setImmediate(() => {
        if (options.signal.aborted) return abort();
        const response = new EventEmitter();
        response.statusCode = 200; response.headers = { 'content-type': 'text/html' };
        response.destroy = error => { response.destroyed = true; if (error) response.emit('error', error); };
        const finish = () => options.signal.removeEventListener('abort', abort);
        response.on('end', finish); response.on('close', finish);
        serve(response, callback);
    });
    req.once('error', () => options.signal.removeEventListener('abort', abort));
    return req;
} } });
const { fetchPublicUrl } = await import('../dist/features/assistant/integrations/safeWebFetch.js');
function fixture(t) {
    const previous = process.env.DIRECT_FETCH_TIMEOUT_MS;
    process.env.DIRECT_FETCH_TIMEOUT_MS = '50';
    t.after(() => { if (previous === undefined) delete process.env.DIRECT_FETCH_TIMEOUT_MS; else process.env.DIRECT_FETCH_TIMEOUT_MS = previous; });
    requests.length = 0;
    dns = async () => [{ address: '8.8.8.8', family: 4 }];
}
test('uppercase entities decode and invalid Unicode points cannot terminate the process', async t => {
    fixture(t);
    serve = (res, callback) => { callback(res); res.emit('data', Buffer.from('<p>&#X41; &#1114112; &#xD800; &AMP;</p>')); res.emit('end'); };
    const result = JSON.parse(await fetchPublicUrl('https://example.com/'));
    assert.equal(result.content, 'A &#1114112; &#xD800; &');
});
test('invalid redirects fail as tool results and each destination remains subject to private-address validation', async t => {
    fixture(t);
    for (const location of ['https://[broken/', 'http://example.com/']) {
        serve = (res, callback) => { res.statusCode = 302; res.headers.location = location; callback(res); };
        const result = JSON.parse(await fetchPublicUrl('https://example.com/'));
        assert.ok(result.error);
    }
    dns = async host => [{ address: host === 'internal.example' ? '127.0.0.1' : '8.8.8.8', family: 4 }];
    serve = (res, callback) => { res.statusCode = 302; res.headers.location = 'https://internal.example/'; callback(res); };
    assert.match(JSON.parse(await fetchPublicUrl('https://example.com/')).error, /private/);
});
test('total deadline includes stalled DNS and continuously arriving body data', async t => {
    fixture(t);
    let resolveDns;
    dns = () => new Promise(resolve => { resolveDns = resolve; });
    // Keep the test alive; AbortSignal deadlines are intentionally unref'ed by Node.
    const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
    const result = JSON.parse(await fetchPublicUrl('https://example.com/'));
    assert.match(result.error, /timeout/i); assert.equal(requests.length, 0);
    resolveDns([{ address: '8.8.8.8', family: 4 }]); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 0);
    dns = async () => [{ address: '8.8.8.8', family: 4 }];
    serve = (res, callback) => {
        callback(res);
        const timer = setInterval(() => res.emit('data', Buffer.from('slow')), 5);
        t.after(() => clearInterval(timer));
    };
    assert.match(JSON.parse(await fetchPublicUrl('https://example.com/')).error, /timeout/i);
});
test('caller cancellation aborts transport instead of returning a result that starts another model round', async t => {
    fixture(t); let started;
    const ready = new Promise(resolve => { started = resolve; });
    serve = (res, callback) => { callback(res); started(); };
    const controller = new AbortController();
    const result = fetchPublicUrl('https://example.com/', controller.signal);
    const rejected = assert.rejects(result, { name: 'AbortError' });
    await ready; controller.abort(); await rejected;
    assert.ok(requests[0].signal.aborted);
});
