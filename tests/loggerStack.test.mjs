import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import winston from 'winston';
import logger from '../dist/shared/logging/logger.js';

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
});
