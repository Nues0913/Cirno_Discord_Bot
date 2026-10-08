import { SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';

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


export { execute, handlePlaylistInteraction, handlePlaylistInteraction as handleInteraction } from '../../features/playlists/presentation/commands.js';

export async function loadHandlers(reloadKey: string) {
    const url = new URL('../../features/playlists/presentation/commands.js', import.meta.url);
    if (import.meta.url.split('?')[0].endsWith('.ts')) url.pathname = url.pathname.replace(/\.js$/, '.ts');
    url.searchParams.set('update', reloadKey);
    const handlers: typeof import('../../features/playlists/presentation/commands.js') = await import(url.href);
    return { execute: handlers.execute, handleInteraction: handlers.handlePlaylistInteraction };
}
