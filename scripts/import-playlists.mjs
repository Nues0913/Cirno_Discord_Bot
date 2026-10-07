import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RemotePlaylistStore } from '../dist/lib/remotePlaylistStore.js';

// Run while the old Bot is stopped. The source is never modified or deleted.
export async function importPlaylists(file, store = new RemotePlaylistStore()) {
    const document = JSON.parse(await readFile(file, 'utf8'));
    if (document.version !== 1 || !Array.isArray(document.playlists)) throw new Error('Unsupported playlist file');
    let imported = 0;
    for (const playlist of document.playlists) {
        if (!playlist || !Array.isArray(playlist.entries)) throw new Error('Invalid playlist data; source file unchanged');
        await store.import(playlist);
        imported++;
    }
    return imported;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const count = await importPlaylists(process.argv[2] ?? 'data/playlists.json');
        console.log(`Imported/verified ${count} playlists. Original file retained. Re-running the same file is safe.`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Import failed');
        process.exitCode = 1;
    }
}
