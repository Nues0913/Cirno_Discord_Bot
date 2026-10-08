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
