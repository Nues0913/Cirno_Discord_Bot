import { musicLibrary, getRemoteSong, remoteLibraryKey, isRemoteTrack, type MusicTrack } from '../music/api.js';
import type { SavedTrack } from './model.js';

export function saveTrack(track: MusicTrack): SavedTrack {
    return { source: isRemoteTrack(track) ? 'remote' : 'local', id: track.id, title: track.title.slice(0, 500), artist: track.artist?.slice(0, 500),
        ...(isRemoteTrack(track) ? { library: remoteLibraryKey() } : {}) };
}
export async function resolvePlaylist(tracks: SavedTrack[]): Promise<{ tracks: MusicTrack[]; unavailable: SavedTrack[] }> {
    await musicLibrary.load();
    const resolved: Array<MusicTrack | undefined> = new Array(tracks.length);
    let cursor = 0;
    // Bound remote requests while preserving playlist order and duplicate entries.
    await Promise.all(Array.from({ length: Math.min(4, tracks.length) }, async () => {
        while (cursor < tracks.length) {
            const index = cursor++;
            const reference = tracks[index];
            try {
                if (reference.source === 'remote') {
                    if (reference.library !== remoteLibraryKey()) continue;
                    resolved[index] = await getRemoteSong(reference.id);
                } else {
                    const track = musicLibrary.get(reference.id);
                    if (track) { await musicLibrary.playablePath(track); resolved[index] = track; }
                }
            } catch { /* Unavailable entries remain saved so they can be repaired or retried. */ }
        }
    }));
    return { tracks: resolved.filter((t): t is MusicTrack => !!t), unavailable: tracks.filter((_, i) => !resolved[i]) };
}
