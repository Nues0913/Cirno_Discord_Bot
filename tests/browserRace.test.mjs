import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from '../dist/features/music/presentation/libraryBrowser.js';
import { browsers } from '../dist/features/music/presentation/browserState.js';
import { handleMusicInteraction } from '../dist/features/music/presentation/commands.js';
test('late remote NEXT cannot overwrite the more recent PREV selection', async t => {
    const old = ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'].map(k => process.env[k]);
    process.env.REMOTE_MUSIC_API_URL = 'http://fixture.invalid/'; process.env.REMOTE_MUSIC_API_TOKEN = 'fixture';
    t.after(() => { browsers.clear(); ['REMOTE_MUSIC_API_URL', 'REMOTE_MUSIC_API_TOKEN'].forEach((k, i) => {
        if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i];
    }); });
    const ids = [1, 2, 3].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    t.mock.method(globalThis, 'fetch', async url => {
        const cursor = new URL(url).searchParams.get('cursor');
        if (cursor === ids[1]) { started(); await new Promise(resolve => { release = resolve; }); }
        const index = cursor === ids[1] ? 2 : cursor === ids[0] ? 1 : 0;
        return new Response(JSON.stringify({ items: [{ id: ids[index], title: 'fixture', mimeType: 'audio/wav', byteSize: 10, sha256: 'a'.repeat(64) }], nextCursor: index < 2 ? ids[index] : null }));
    });
    const owner = { user: { id: 'owner' }, guildId: 'guild' };
    const payload = await createBrowser(owner, 'library');
    const key = payload.components[0].toJSON().components[0].custom_id.split(':')[1];
    const browser = browsers.get(key), rendered = [];
    const button = action => ({ ...owner, guild: {}, isAutocomplete: () => false, isButton: () => true,
        isStringSelectMenu: () => false, customId: `musicbrowse:${key}:${action}`, deferUpdate: async () => {},
        editReply: async p => rendered.push(p.embeds[0].toJSON().footer.text), followUp: async () => {}, reply: async () => {} });
    await handleMusicInteraction(button('next'));
    const late = handleMusicInteraction(button('next')); await ready;
    await handleMusicInteraction(button('prev')); const final = rendered.at(-1);
    release(); await late;
    assert.equal(browser.page, 0); assert.equal(rendered.at(-1), final); assert.equal(rendered.length, 2);
});
