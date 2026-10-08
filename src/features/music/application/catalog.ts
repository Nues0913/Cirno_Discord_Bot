import { musicLibrary } from '../library/localLibrary.js';
import { getRemoteSong, isRemoteId, searchRemoteSongs } from '../library/remoteLibrary.js';
import type { MusicTrack } from '../model/track.js';
export type MusicSource = 'local' | 'remote';
export const DEFAULT_MUSIC_SOURCE: MusicSource = 'remote';
export const selectedMusicSource = (value?: string | null): MusicSource => value === 'local' ? 'local' : DEFAULT_MUSIC_SOURCE;

export async function findTracks(source: MusicSource, query: string): Promise<MusicTrack[]> {
    if (source === 'remote') {
        if (isRemoteId(query)) return [await getRemoteSong(query)];
        return (await searchRemoteSongs(query)).items;
    }
    const exact = musicLibrary.get(query);
    return exact ? [exact] : musicLibrary.search(query);
}
