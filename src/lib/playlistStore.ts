import { RemotePlaylistStore } from './remotePlaylistStore.js';

export interface SavedTrack {
    source: 'local' | 'remote';
    id: string;
    title: string;
    artist?: string;
    library?: string;
}
export interface PlaylistEntry extends SavedTrack { entryId: string; }
export interface Playlist {
    id: string;
    ownerId: string;
    name: string;
    revision: number;
    entries: PlaylistEntry[];
}
// Playlist persistence belongs to music_server. The Bot only calls its API.
// Missing configuration and service errors must never select local storage.
export const playlists = new RemotePlaylistStore();
