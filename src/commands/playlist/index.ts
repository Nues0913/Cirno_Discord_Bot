import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder,
    type ChatInputCommandInteraction, type Interaction, type ButtonInteraction, type SlashCommandSubcommandBuilder
} from 'discord.js';
import { playlists, type Playlist } from '../../lib/playlistStore.js';
import { saveTrack, resolvePlaylist } from '../../lib/playlistTracks.js';
import { musicLibrary } from '../../lib/localMusicLibrary.js';
import { musicPlayer } from '../../lib/localMusicPlayer.js';
import { displayText } from '../../lib/musicPanel.js';
import { searchRemoteSongs } from '../../lib/remoteMusicLibrary.js';
import { findTracks, playTracks } from '../music/index.js';
import logger from '../../lib/logger.js';

const withPlaylist = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o =>
    o.setName('playlist').setDescription('選擇你的播放清單').setRequired(true).setAutocomplete(true));
const withName = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o =>
    o.setName('name').setDescription('清單名稱（1–60 字）').setRequired(true).setMinLength(1).setMaxLength(60));
const withEntry = (sub: SlashCommandSubcommandBuilder) => sub.addStringOption(o =>
    o.setName('entry').setDescription('選擇清單中的歌曲').setRequired(true).setAutocomplete(true));

export const data = new SlashCommandBuilder().setName('playlist').setDescription('管理你的個人播放清單').setDMPermission(false)
    .addSubcommand(s => withName(s.setName('create').setDescription('建立一份空白播放清單')))
    .addSubcommand(s => s.setName('list').setDescription('查看自己的所有清單'))
    .addSubcommand(s => withPlaylist(s.setName('show').setDescription('查看清單歌曲')))
    .addSubcommand(s => withName(withPlaylist(s.setName('rename').setDescription('重新命名清單'))))
    .addSubcommand(s => withPlaylist(s.setName('delete').setDescription('刪除清單（需要確認）')))
    .addSubcommand(s => withPlaylist(s.setName('add').setDescription('加入本地或遠端歌曲'))
        .addStringOption(o => o.setName('song').setDescription('從自動完成選擇歌曲').setAutocomplete(true).setRequired(true))
        .addStringOption(o => o.setName('source').setDescription('曲庫來源，預設本地')
            .addChoices({ name: '本地', value: 'local' }, { name: '遠端', value: 'remote' })))
    .addSubcommand(s => withPlaylist(s.setName('add-current').setDescription('將目前歌曲收藏到自己的清單')))
    .addSubcommand(s => withName(s.setName('save').setDescription('將目前歌曲及待播佇列另存為新清單')))
    .addSubcommand(s => withEntry(withPlaylist(s.setName('remove').setDescription('移除清單中的一首歌曲'))))
    .addSubcommand(s => withEntry(withPlaylist(s.setName('move').setDescription('調整清單歌曲順序')))
        .addIntegerOption(o => o.setName('position').setDescription('新位置，從 1 開始').setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand(s => withPlaylist(s.setName('play').setDescription('整份加入播放，無法取得的歌曲會略過'))
        .addBooleanOption(o => o.setName('shuffle').setDescription('先打亂此次播放順序（不修改清單）'))
        .addBooleanOption(o => o.setName('next').setDescription('插入待播佇列最前方')));

function render(playlist: Playlist, page = 0) {
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
async function report(interaction: ChatInputCommandInteraction | ButtonInteraction, error: unknown) {
    logger.error(error);
    const content = error instanceof Error && !(error as { code?: unknown }).code
        ? error.message : '操作失敗，請稍後再試；若持續發生請通知管理者。';
    const payload = { content, allowedMentions: { parse: [] as [] } };
    if (interaction.deferred || interaction.replied) await interaction.editReply({ ...payload, embeds: [], components: [] });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (!interaction.guildId) throw new Error('請在伺服器中使用清單功能。');
        const owner = interaction.user.id;
        const sub = interaction.options.getSubcommand();
        const id = interaction.options.getString('playlist');
        if (sub === 'list') {
            const all = await playlists.list(owner);
            await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x20b2aa).setTitle('你的播放清單').setDescription(all.length ? `共 ${all.length}/20 份：\n` + all.map(p =>
                `• **${displayText(p.name, 120)}** · ${p.entries.length} 首`).join('\n') : '你還沒有播放清單，使用 /playlist create 建立第一份。')],
                allowedMentions: { parse: [] } }); return;
        }
        if (sub === 'create' || sub === 'save') {
            const session = musicPlayer.get(interaction.guildId);
            const entries = sub === 'save' ? [session?.queue.current, ...(session?.queue.pending ?? [])].filter(e => !!e) : [];
            if (sub === 'save' && !entries.length) throw new Error('目前沒有可以儲存的播放佇列。');
            await interaction.editReply(render(await playlists.create(owner, interaction.options.getString('name', true), entries.map(e => saveTrack(e.track))))); return;
        }
        const playlist = await playlists.get(owner, id!);
        switch (sub) {
            case 'show': await interaction.editReply(render(playlist)); return;
            case 'rename': await interaction.editReply(render(await playlists.rename(owner, playlist.id, interaction.options.getString('name', true)))); return;
            case 'delete':
                await interaction.editReply({ content: `確定刪除「${displayText(playlist.name)}」及其中 ${playlist.entries.length} 首收藏？曲庫中的音檔不會刪除。`,
                    allowedMentions: { parse: [] }, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder().setCustomId(`playlist:delete:${playlist.id}:${playlist.revision}:${owner}`)
                            .setLabel('確認刪除').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`playlist:cancel:${playlist.id}:0:${owner}`)
                            .setLabel('取消').setStyle(ButtonStyle.Secondary))] }); return;
            case 'add': {
                const source = interaction.options.getString('source') === 'remote' ? 'remote' : 'local';
                if (source === 'local') await musicLibrary.load();
                const tracks = await findTracks(source, interaction.options.getString('song', true));
                if (tracks.length !== 1) throw new Error('請從歌曲自動完成選單選定一首歌曲。遠端歌曲請先選 source:遠端。');
                await interaction.editReply(render(await playlists.add(owner, playlist.id, [saveTrack(tracks[0])]))); return;
            }
            case 'add-current': {
                const entry = musicPlayer.get(interaction.guildId)?.queue.current;
                if (!entry) throw new Error('目前沒有播放中的歌曲。');
                await interaction.editReply(render(await playlists.add(owner, playlist.id, [saveTrack(entry.track)]))); return;
            }
            case 'remove': await interaction.editReply(render(await playlists.remove(owner, playlist.id, interaction.options.getString('entry', true)))); return;
            case 'move': await interaction.editReply(render(await playlists.move(owner, playlist.id,
                interaction.options.getString('entry', true), interaction.options.getInteger('position', true)))); return;
            case 'play': {
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
        }
    } catch (error) { await report(interaction, error); }
}
export async function handlePlaylistInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isAutocomplete() && interaction.commandName === 'playlist') {
        try {
            const focus = interaction.options.getFocused(true);
            const query = String(focus.value).toLocaleLowerCase();
            if (focus.name === 'playlist') {
                const all = await playlists.list(interaction.user.id);
                await interaction.respond(all.filter(p => p.name.toLocaleLowerCase().includes(query)).slice(0, 25).map(p => ({ name: `${p.name} · ${p.entries.length} 首`, value: p.id })));
            } else if (focus.name === 'entry') {
                const p = await playlists.get(interaction.user.id, interaction.options.getString('playlist', true));
                await interaction.respond(p.entries.map((e, i) => ({ name: `${i + 1}. ${e.title} · ${e.source === 'remote' ? '遠端' : '本地'}`.slice(0, 100), value: e.entryId }))
                    .filter(e => e.name.toLocaleLowerCase().includes(query)).slice(0, 25));
            } else if (focus.name === 'song') {
                const tracks = interaction.options.getString('source') === 'remote'
                    ? (await searchRemoteSongs(query, undefined, 25, 2000)).items : musicLibrary.search(query).slice(0, 25);
                await interaction.respond(tracks.map(t => ({ name: `${t.title.slice(0, 65)} · ${t.artist?.slice(0, 20) ?? ''} · ${t.id.slice(0, 5)}`, value: t.id })));
            } else await interaction.respond([]);
        } catch (error) { logger.error(error); if (!interaction.responded) await interaction.respond([]); }
        return true;
    }
    if (!interaction.isButton() || !interaction.customId.startsWith('playlist:')) return false;
    try {
        const [, action, id, value, owner] = interaction.customId.split(':');
        if (owner !== interaction.user.id) throw new Error('只有清單擁有者可以使用此選單。');
        if (Date.now() - interaction.message.createdTimestamp > 15 * 60_000) throw new Error('選單已逾時，請重新執行指令。');
        await interaction.deferUpdate();
        if (action === 'cancel') { await interaction.editReply({ content: '已取消刪除。', components: [] }); return true; }
        if (action === 'delete') {
            await playlists.delete(owner, id, Number(value));
            await interaction.editReply({ content: '已刪除播放清單。', embeds: [], components: [] });
        } else if (action === 'page' && Number.isInteger(Number(value))) {
            await interaction.editReply(render(await playlists.get(owner, id), Number(value)));
        } else throw new Error('無效的清單操作。');
    } catch (error) { await report(interaction, error); }
    return true;
}
