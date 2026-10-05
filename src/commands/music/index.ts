import { randomBytes } from 'node:crypto';
import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
    SlashCommandBuilder, StringSelectMenuBuilder,
    type ChatInputCommandInteraction, type Interaction, type GuildTextBasedChannel,
    type ButtonInteraction, type StringSelectMenuInteraction
} from 'discord.js';
import { musicLibrary, type LocalTrack } from '../../lib/localMusicLibrary.js';
import { getRemoteSong, isRemoteId, searchRemoteSongs, type RemotePage } from '../../lib/remoteMusicLibrary.js';
import { isRemoteTrack, trackSource, type MusicTrack } from '../../lib/musicTrack.js';
import { musicPlayer } from '../../lib/localMusicPlayer.js';
import { displayText, durationText } from '../../lib/musicPanel.js';
import logger from '../../lib/logger.js';

export const data = new SlashCommandBuilder().setName('music').setDescription('本地與遠端音樂播放器').setDMPermission(false)
    .addSubcommand(sub => sub.setName('play').setDescription('播放歌曲或加入佇列')
        .addStringOption(option => option.setName('song').setDescription('搜尋歌曲名稱').setAutocomplete(true).setRequired(true))
        .addStringOption(option => option.setName('source').setDescription('曲庫來源，預設本地')
            .addChoices({ name: '本地曲庫', value: 'local' }, { name: '遠端曲庫', value: 'remote' })))
    .addSubcommand(sub => sub.setName('library').setDescription('瀏覽曲庫')
        .addStringOption(option => option.setName('query').setDescription('歌曲或演出者關鍵字'))
        .addStringOption(option => option.setName('source').setDescription('曲庫來源，預設本地')
            .addChoices({ name: '本地曲庫', value: 'local' }, { name: '遠端曲庫', value: 'remote' })))
    .addSubcommand(sub => sub.setName('queue').setDescription('查看待播清單'))
    .addSubcommand(sub => sub.setName('panel').setDescription('取得或重建播放器面板'))
    .addSubcommand(sub => sub.setName('stop').setDescription('結束播放並離開語音頻道'))
    .addSubcommand(sub => sub.setName('reload').setDescription('重新掃描本地曲庫（所有成員可使用）'));

type MusicInteraction = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;
type MusicSource = 'local' | 'remote';
const selectedSource = (value: string | null): MusicSource => value === 'remote' ? 'remote' : 'local';
async function findTracks(source: MusicSource, query: string): Promise<MusicTrack[]> {
    if (source === 'remote') {
        if (isRemoteId(query)) return [await getRemoteSong(query)];
        return (await searchRemoteSongs(query)).items;
    }
    const exact = musicLibrary.get(query);
    return exact ? [exact] : musicLibrary.search(query);
}
interface Browser {
    userId: string; guildId: string; sessionId?: string; kind: 'library' | 'queue';
    source: MusicSource; query: string; page: number; expires: number;
    ids: string[]; remotePages: Map<number, RemotePage>;
}
const browsers = new Map<string, Browser>();
function pruneBrowsers(): void {
    for (const [key, value] of browsers) if (value.expires < Date.now()) browsers.delete(key);
    while (browsers.size >= 1000) browsers.delete(browsers.keys().next().value!);
}
async function createBrowser(interaction: MusicInteraction, kind: Browser['kind'], query = '', source: Browser['source'] = 'local') {
    pruneBrowsers();
    const key = randomBytes(8).toString('hex');
    const browser: Browser = {
        userId: interaction.user.id, guildId: interaction.guildId!,
        sessionId: musicPlayer.get(interaction.guildId!)?.id,
        kind, source, query, page: 0, expires: Date.now() + 15 * 60_000,
        ids: kind === 'library' && source === 'local' ? musicLibrary.search(query).map(track => track.id) : [],
        remotePages: new Map()
    };
    if (kind === 'library' && source === 'remote') browser.remotePages.set(0, await searchRemoteSongs(query));
    browsers.set(key, browser);
    return renderBrowser(key, browser);
}
function renderBrowser(key: string, browser: Browser) {
    const tracks = browser.source === 'remote'
        ? browser.remotePages.get(browser.page)?.items ?? []
        : browser.ids.map(id => musicLibrary.get(id)).filter((track): track is LocalTrack => !!track);
    const session = musicPlayer.get(browser.guildId);
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
function textChannel(interaction: MusicInteraction): GuildTextBasedChannel {
    const channel = interaction.channel;
    if (!interaction.guild || !channel || channel.isDMBased() || !channel.isTextBased()) throw new Error('請在伺服器文字頻道使用此功能。');
    return channel as GuildTextBasedChannel;
}
async function play(interaction: MusicInteraction, track: MusicTrack): Promise<string> {
    const channel = interaction.guild!.voiceStates.cache.get(interaction.user.id)?.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('請先加入一般語音頻道再點歌（不支援 Stage 頻道）。');
    const session = await musicPlayer.enqueue(channel, textChannel(interaction), interaction.user.id, interaction.user.displayName, track);
    return `已加入播放：**${displayText(track.title)}**${session.panel.message ? `\n${session.panel.message.url}` : ''}`;
}
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (!interaction.guildId || !interaction.guild) throw new Error('請在伺服器內使用此指令。');
        switch (interaction.options.getSubcommand()) {
            case 'play': {
                const source = selectedSource(interaction.options.getString('source'));
                if (source === 'local') await musicLibrary.load();
                const query = interaction.options.getString('song', true);
                const matches = await findTracks(source, query);
                if (!matches.length) throw new Error('找不到此歌曲，請使用 /music library 查看曲庫。');
                if (matches.length > 1) {
                    await interaction.editReply(await createBrowser(interaction, 'library', query, source)); return;
                }
                await interaction.editReply({ content: await play(interaction, matches[0]), allowedMentions: { parse: [] } }); return;
            }
            case 'library':
                { const source = selectedSource(interaction.options.getString('source'));
                if (source === 'local') await musicLibrary.load();
                await interaction.editReply(await createBrowser(interaction, 'library', interaction.options.getString('query') ?? '', source)); return; }
            case 'queue':
                await interaction.editReply(await createBrowser(interaction, 'queue')); return;
            case 'panel':
                await interaction.editReply(await musicPlayer.panel(interaction.guildId, textChannel(interaction), interaction.user.id)); return;
            case 'stop':
                await musicPlayer.control(interaction.guildId, interaction.user.id, 'stop');
                await interaction.editReply('已結束播放並離開語音頻道。'); return;
            case 'reload':
                await interaction.editReply(`曲庫已更新，共 ${(await musicLibrary.reload()).length} 首歌曲。`); return;
        }
    } catch (error) { await reportError(interaction, error); }
}
async function reportError(interaction: MusicInteraction, error: unknown): Promise<void> {
    const content = error instanceof Error && !(error as { code?: unknown }).code ? error.message : '操作失敗，請稍後再試或檢查 Bot 權限。';
    logger.error(error);
    const payload = { content, allowedMentions: { parse: [] as [] } };
    if (interaction.deferred && interaction.ephemeral && !interaction.replied) {
        await interaction.editReply({ ...payload, embeds: [], components: [] });
    } else if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
export async function handleMusicInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isAutocomplete() && interaction.commandName === 'music') {
        // The initial scan runs at startup; don't hold autocomplete open for filesystem work.
        const source = interaction.options.getString('source') ?? 'local';
        try {
            const tracks = source === 'remote'
                ? (await searchRemoteSongs(String(interaction.options.getFocused()), undefined, 25, 2000)).items
                : musicLibrary.search(String(interaction.options.getFocused())).slice(0, 25);
            await interaction.respond(tracks.map(track => ({
                name: `${track.title.slice(0, 65)} · ${(track.artist ?? (isRemoteTrack(track) ? '遠端歌曲' : track.filename)).slice(0, 20)} · ${track.id.slice(0, 5)}`,
                value: track.id
            })));
        } catch (error) { logger.error(error); await interaction.respond([]); }
        return true;
    }
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) ||
        !(interaction.customId.startsWith('music:') || interaction.customId.startsWith('musicbrowse:'))) return false;
    try {
        if (!interaction.guildId || !interaction.guild) throw new Error('請在伺服器內操作播放器。');
        const [prefix, key, action, generation] = interaction.customId.split(':');
        if (prefix === 'musicbrowse') {
            pruneBrowsers();
            const browser = browsers.get(key);
            if (!browser || browser.userId !== interaction.user.id || browser.guildId !== interaction.guildId) throw new Error('選單已失效，請重新使用 /music library 或 /music queue。');
            if (action === 'select' && interaction.isStringSelectMenu() && browser.kind === 'library') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                if (browser.sessionId && musicPlayer.get(browser.guildId)?.id !== browser.sessionId) throw new Error('原播放已結束，請重新開啟曲庫。');
                const id = interaction.values[0];
                const track = browser.source === 'remote'
                    ? browser.remotePages.get(browser.page)?.items.some(item => item.id === id) ? await getRemoteSong(id) : undefined
                    : browser.ids.includes(id) ? musicLibrary.get(id) : undefined;
                if (!track) throw new Error('歌曲已移除，請重新開啟曲庫。');
                await interaction.editReply({ content: await play(interaction, track), allowedMentions: { parse: [] } });
            } else if (interaction.isButton() && ['prev', 'next'].includes(action)) {
                await interaction.deferUpdate();
                const nextPage = action === 'next' ? browser.page + 1 : Math.max(0, browser.page - 1);
                if (browser.source === 'remote' && browser.kind === 'library' && action === 'next') {
                    const cursor = browser.remotePages.get(browser.page)?.nextCursor;
                    if (!cursor) throw new Error('已到最後一頁。');
                    if (!browser.remotePages.has(nextPage)) browser.remotePages.set(nextPage, await searchRemoteSongs(browser.query, cursor));
                }
                browser.page = nextPage;
                await interaction.editReply(renderBrowser(key, browser));
            } else throw new Error('無效的選單操作。');
        } else {
            musicPlayer.assertPanel(interaction.guildId, key, interaction.message.id);
            if (action === 'library' || action === 'queue') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const source = action === 'library' && musicPlayer.get(interaction.guildId)?.queue.current
                    ? trackSource(musicPlayer.get(interaction.guildId)!.queue.current!.track) : 'local';
                if (action === 'library' && source === 'local') await musicLibrary.load();
                await interaction.editReply(await createBrowser(interaction, action, '', source));
            } else {
                await interaction.deferUpdate();
                await musicPlayer.control(interaction.guildId, interaction.user.id, action, {
                    sessionId: key, messageId: interaction.message.id, generation: Number(generation)
                });
            }
        }
    } catch (error) { await reportError(interaction, error); }
    return true;
}
