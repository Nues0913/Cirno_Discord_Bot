import { musicLibrary } from '../library/localLibrary.js';
import { remoteMusicMode } from '../library/remoteLibrary.js';
import { isRemoteTrack, type MusicTrack } from '../model/track.js';
import { createLocalAudio } from '../audio/localAudio.js';
import { createRemoteDownloadedAudio, createRemoteStreamAudio } from '../audio/remoteAudio.js';

export type AudioLoader = (track: MusicTrack, volume: number, onError: (error: Error) => void,
    controller: AbortController, offset: number) => Promise<ReturnType<typeof createLocalAudio>>;
export const loadTrackAudio: AudioLoader = async (track, volume, onError, controller, offset) => {
    if (!isRemoteTrack(track)) return createLocalAudio(await musicLibrary.playablePath(track), volume, onError, offset);
    const create = remoteMusicMode() === 'stream' ? createRemoteStreamAudio : createRemoteDownloadedAudio;
    return create(track, volume, onError, controller, offset);
};
