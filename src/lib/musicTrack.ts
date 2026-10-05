import type { LocalTrack } from './localMusicLibrary.js';
import type { RemoteTrack } from './remoteMusicLibrary.js';

export type MusicTrack = LocalTrack | RemoteTrack;
export const isRemoteTrack = (track: MusicTrack): track is RemoteTrack => 'source' in track && track.source === 'remote';
export const trackSource = (track: MusicTrack): 'local' | 'remote' => isRemoteTrack(track) ? 'remote' : 'local';
export const trackKey = (track: MusicTrack): string => `${trackSource(track)}:${track.id}`;
