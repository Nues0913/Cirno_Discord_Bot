import { randomBytes } from 'node:crypto';
import { musicLibrary, type LocalTrack } from '../library/localLibrary.js';
import { searchRemoteSongs } from '../library/remoteLibrary.js';
import { musicPlayer } from '../playback/player.js';

import { browsers, type Browser } from './browserState.js';
import { renderBrowserView } from './browserView.js';
import type { MusicInteraction } from './playbackActions.js';
export async function createBrowser(interaction: MusicInteraction, kind: Browser['kind'], query = '', source: Browser['source'] = 'local', next = false) {
    browsers.prune();
    const key = randomBytes(8).toString('hex');
    const browser: Browser = {
        userId: interaction.user.id, guildId: interaction.guildId!,
        sessionId: musicPlayer.get(interaction.guildId!)?.id,
        kind, source, query, next, page: 0, expires: Date.now() + 15 * 60_000,
        ids: kind === 'library' && source === 'local' ? musicLibrary.search(query).map(track => track.id) : [],
        remotePages: new Map()
    };
    if (kind === 'library' && source === 'remote') browser.remotePages.set(0, await searchRemoteSongs(query));
    browsers.set(key, browser);
    return renderBrowser(key, browser);
}

export function renderBrowser(key: string, browser: Browser) {
    const tracks = browser.source === 'remote'
        ? browser.remotePages.get(browser.page)?.items ?? []
        : browser.ids.map(id => musicLibrary.get(id)).filter((track): track is LocalTrack => !!track);
    const session = musicPlayer.get(browser.guildId);
    return renderBrowserView(key, browser, tracks, session);
}
