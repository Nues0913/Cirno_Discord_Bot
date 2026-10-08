import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { isRemoteTrack, type MusicTrack } from '../model/track.js';
import type { MusicSession } from '../playback/session.js';
import type { Browser } from './browserState.js';
import { displayText, durationText } from './panel.js';

export function renderBrowserView(key: string, browser: Browser, tracks: MusicTrack[], session?: MusicSession) {
    if (browser.kind === 'queue' && (!session || session.id !== browser.sessionId)) throw new Error('播放已結束，請重新使用 /music queue。');
    const items = browser.kind === 'library' ? tracks : session!.queue.pending;
    const pageSize = browser.kind === 'library' ? 25 : 10;
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    if (browser.source !== 'remote' || browser.kind !== 'library') browser.page = Math.max(0, Math.min(pages - 1, browser.page));
    const offset = browser.page * pageSize;
    const embed = new EmbedBuilder().setColor(0x20b2aa)
        .setTitle(browser.kind === 'library' ? `🎵 ${browser.source === 'remote' ? '遠端' : '本地'}曲庫` : '📜 待播清單')
        .setFooter({ text: browser.source === 'remote' && browser.kind === 'library'
            ? `第 ${browser.page + 1} 頁 · 選單 15 分鐘後失效`
            : `第 ${browser.page + 1} / ${pages} 頁 · 共 ${items.length} 首 · 選單 15 分鐘後失效` });
    const components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];
    if (browser.kind === 'library') {
        embed.setDescription(items.length ? `選擇歌曲即可加入播放。${browser.query ? `\n搜尋：${displayText(browser.query)}` : ''}` :
            browser.source === 'remote' ? '遠端曲庫沒有符合的歌曲。' : '找不到歌曲。請調整關鍵字，或由管理者將音檔放入曲庫後執行 /music reload。');
        const slice = browser.source === 'remote' ? tracks : tracks.slice(offset, offset + pageSize);
        if (slice.length) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder().setCustomId(`musicbrowse:${key}:select`).setPlaceholder('選一首歌曲加入播放')
                .addOptions(slice.map(track => ({
                    label: `${track.title.slice(0, 90)} · ${track.id.slice(0, 5)}`, value: track.id,
                    description: `${track.artist ?? (isRemoteTrack(track) ? '遠端歌曲' : track.filename)} · ${durationText(track.duration)} · ${track.id.slice(0, 5)}`.slice(0, 100)
                })))
        ));
    } else {
        const lines = session!.queue.pending.slice(offset, offset + pageSize).map((entry, index) =>
            `${offset + index + 1}. **${displayText(entry.track.title, 130)}** · ${displayText(entry.requestedBy, 40)}`);
        embed.setDescription(`正在播放：${displayText(session!.queue.current?.track.title ?? '載入中')}\n\n${lines.join('\n') || '尚無待播歌曲。'}`);
    }
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`musicbrowse:${key}:prev`).setLabel('上一頁').setStyle(ButtonStyle.Secondary).setDisabled(browser.page === 0),
        new ButtonBuilder().setCustomId(`musicbrowse:${key}:next`).setLabel('下一頁').setStyle(ButtonStyle.Secondary).setDisabled(
            browser.source === 'remote' && browser.kind === 'library' ? !browser.remotePages.get(browser.page)?.nextCursor : browser.page >= pages - 1)
    ));
    return { embeds: [embed], components, allowedMentions: { parse: [] as [] } };
}
