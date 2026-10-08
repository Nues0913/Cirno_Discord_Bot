import { RemotePlaylistStore } from './remoteStore.js';

// Playlist persistence belongs to music_server. The Bot only calls its API.
// Missing configuration and service errors must never select local storage.
export const playlists = new RemotePlaylistStore();
