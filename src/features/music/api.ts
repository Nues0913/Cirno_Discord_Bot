// Public operations used by playlists; music internals import their concrete modules directly.
export { musicLibrary } from './library/localLibrary.js';
export { getRemoteSong, remoteLibraryKey, searchRemoteSongs } from './library/remoteLibrary.js';
export { isRemoteTrack, type MusicTrack } from './model/track.js';
export { musicPlayer } from './playback/player.js';
export { findTracks, selectedMusicSource, DEFAULT_MUSIC_SOURCE } from './application/catalog.js';
export { playTracks } from './presentation/playbackActions.js';
export { displayText } from './presentation/panel.js';
