import { playTracks, displayText } from '../../music/api.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Playlist } from '../model.js';
import { resolvePlaylist } from '../tracks.js';

export async function playPlaylist(interaction: ChatInputCommandInteraction, playlist: Playlist): Promise<void> {
    const owner = interaction.user.id;
    if (!interaction.guild?.voiceStates.cache.get(owner)?.channel) throw new Error('請先加入一般語音頻道再播放清單。');
    const resolved = await resolvePlaylist(playlist.entries);
    if (!resolved.tracks.length) throw new Error('清單沒有可播放的歌曲。請確認本地檔案、遠端曲庫設定與連線。');
    if (interaction.options.getBoolean('shuffle')) {
        for (let i = resolved.tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [resolved.tracks[i], resolved.tracks[j]] = [resolved.tracks[j], resolved.tracks[i]];
        }
    }
    const result = await playTracks(interaction, resolved.tracks, interaction.options.getBoolean('next') ?? false);
    await interaction.editReply({ content: result + (resolved.unavailable.length
        ? `\n另有 ${resolved.unavailable.length} 首暫時無法取得，已略過（收藏仍保留）：${resolved.unavailable.slice(0, 5).map(t => displayText(t.title, 80)).join('、')}` : ''),
        allowedMentions: { parse: [] } }); return;
}
