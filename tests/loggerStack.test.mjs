import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import winston from 'winston';
import logger from '../dist/shared/logging/logger.js';
import { DiscordAPIError } from '@discordjs/rest';
import { logInteractionError } from '../dist/shared/discord/interactionErrors.js';

test('ERROR logging preserves the original failure stack with either calling signature', t => {
    const captured = [];
    const stream = new Writable({ objectMode: true, write(info, _encoding, done) { captured.push(info); done(); } });
    for (const transport of logger.transports) transport.close?.();
    logger.clear();
    logger.add(new winston.transports.Stream({ stream }));
    t.after(() => logger.close());
    const original = new TypeError('fixture internal failure');
    original.stack = 'TypeError: fixture internal failure\n    at originalFailure (fixture-source.ts:42:7)';
    logger.error(original);
    logger.error('context', original);
    assert.equal(captured.length, 2);
    for (const entry of captured) {
        assert.equal(entry.stack, original.stack);
        assert.match(entry.message, /fixture internal failure/);
        assert.doesNotMatch(entry.stack, /logging\/logger.js/);
    }
    assert.match(captured[1].message, /context/);
    assert.equal(original.message, 'fixture internal failure');
    for (const code of [50035, 99999]) {
        const url = 'https://discord.com/api/v10/webhooks/123456789012345678/private-fixture-token/messages/@original';
        const error = new DiscordAPIError({ message: 'Invalid Form Body', code }, code, 400, 'PATCH', url,
            { files: [], json: { content: 'private-body-content' } });
        error.cause = Object.assign(new Error(`Failed ${url}`), { headers: { Authorization: 'Bearer private-header-token' } });
        logInteractionError(error);
        assert.equal(error.url, url, 'logging must not mutate errors');
    }
    logger.error('HTTP failed', { url: 'https://example.com/?api_key=private-query-key', headers: { Cookie: 'private-cookie' } });
    logger.log('error', 'HTTP failed', { url: 'https://username:private-password@example.com/', authorization: 'Basic private-basic-header' });
    const formatted = captured.map(entry => entry[Symbol.for('message')]).join('\n');
    assert.doesNotMatch(formatted, /private-fixture-token|private-header-token|private-body-content|private-query-key|private-cookie|private-password|private-basic-header/);
    assert.match(formatted, /50035/);
    assert.match(formatted, /PATCH/);
    assert.match(formatted, /REDACTED/);
});
