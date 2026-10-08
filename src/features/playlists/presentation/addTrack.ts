import { UserActionError } from '../../../shared/logging/operationErrors.js';
import { musicLibrary, findTracks, selectedMusicSource } from '../../music/api.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Playlist } from '../model.js';
import { playlists } from '../store.js';
import { saveTrack } from '../tracks.js';
import { renderPlaylist } from './view.js';

export async function addSelectedTrack(interaction: ChatInputCommandInteraction, playlist: Playlist): Promise<void> {
    const source = selectedMusicSource(interaction.options.getString('source'));
    if (source === 'local') await musicLibrary.load();
    const tracks = await findTracks(source, interaction.options.getString('song', true));
    if (tracks.length !== 1) throw new UserActionError('請從歌曲自動完成選單選定一首歌曲。本地歌曲請先選 source:本地。');
    const updated = await playlists.add(interaction.user.id, playlist.id, [saveTrack(tracks[0])], playlist.revision);
    await interaction.editReply(renderPlaylist(updated));
}
