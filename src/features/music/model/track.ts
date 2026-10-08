export interface LocalTrack {
    id: string;
    path: string;
    filename: string;
    title: string;
    artist?: string;
    duration?: number;
}

export interface RemoteTrack {
    source: 'remote';
    id: string;
    title: string;
    artist?: string;
    duration?: number;
    mimeType: string;
    byteSize: number;
    sha256: string;
}

export type MusicTrack = LocalTrack | RemoteTrack;
export const isRemoteTrack = (track: MusicTrack): track is RemoteTrack => 'source' in track && track.source === 'remote';
export const trackSource = (track: MusicTrack): 'local' | 'remote' => isRemoteTrack(track) ? 'remote' : 'local';
export const trackKey = (track: MusicTrack): string => `${trackSource(track)}:${track.id}`;
