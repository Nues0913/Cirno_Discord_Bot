import { displayText } from '../../music/api.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Playlist } from '../model.js';

export function renderPlaylist(playlist: Playlist, page = 0) {
    const pages = Math.max(1, Math.ceil(playlist.entries.length / 10));
    page = Math.max(0, Math.min(pages - 1, page));
    const lines = playlist.entries.slice(page * 10, page * 10 + 10).map((entry, index) =>
        `${page * 10 + index + 1}. **${displayText(entry.title, 140)}** · ${entry.source === 'remote' ? '遠端' : '本地'}`);
    return {
        content: '',
        embeds: [new EmbedBuilder().setColor(0x20b2aa).setTitle(`🎶 ${playlist.name}`)
            .setDescription(lines.join('\n') || '清單還沒有歌曲。使用 /playlist add 或 /playlist add-current 加入。')
            .setFooter({ text: `第 ${page + 1}/${pages} 頁 · ${playlist.entries.length}/100 首 · 僅自己可管理` })],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`playlist:page:${playlist.id}:${page - 1}:${playlist.ownerId}`)
                .setLabel('上一頁').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`playlist:page:${playlist.id}:${page + 1}:${playlist.ownerId}`)
                .setLabel('下一頁').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1))],
        allowedMentions: { parse: [] as [] }
    };
}

export function renderPlaylistList(playlists: Playlist[]) {
    const description = playlists.length ? `共 ${playlists.length}/20 份：\n` + playlists.map(p =>
        `• **${displayText(p.name, 120)}** · ${p.entries.length} 首`).join('\n')
        : '你還沒有播放清單，使用 /playlist create 建立第一份。';
    return { embeds: [new EmbedBuilder().setColor(0x20b2aa).setTitle('你的播放清單').setDescription(description)],
        allowedMentions: { parse: [] as [] } };
}

export function renderDeleteConfirmation(playlist: Playlist) {
    return {
        content: `確定刪除「${displayText(playlist.name)}」及其中 ${playlist.entries.length} 首收藏？曲庫中的音檔不會刪除。`,
        allowedMentions: { parse: [] as [] }, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`playlist:delete:${playlist.id}:${playlist.revision}:${playlist.ownerId}`)
                .setLabel('確認刪除').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`playlist:cancel:${playlist.id}:0:${playlist.ownerId}`)
                .setLabel('取消').setStyle(ButtonStyle.Secondary))]
    };
}
