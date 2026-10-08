import { SlashCommandBuilder } from 'discord.js';
import { browsers } from '../../features/music/presentation/browserState.js';

export const data = new SlashCommandBuilder().setName('music').setDescription('本地與遠端音樂播放器').setDMPermission(false)
    .addSubcommand(sub => sub.setName('play').setDescription('播放歌曲或加入佇列')
        .addStringOption(option => option.setName('song').setDescription('搜尋歌曲名稱').setAutocomplete(true).setRequired(true))
        .addStringOption(option => option.setName('source').setDescription('曲庫來源，預設遠端')
            .addChoices({ name: '遠端曲庫', value: 'remote' }, { name: '本地曲庫', value: 'local' }))
        .addBooleanOption(option => option.setName('next').setDescription('排在待播佇列最前方')))
    .addSubcommand(sub => sub.setName('library').setDescription('瀏覽曲庫')
        .addStringOption(option => option.setName('query').setDescription('歌曲或演出者關鍵字'))
        .addStringOption(option => option.setName('source').setDescription('曲庫來源，預設遠端')
            .addChoices({ name: '遠端曲庫', value: 'remote' }, { name: '本地曲庫', value: 'local' })))
    .addSubcommand(sub => sub.setName('queue').setDescription('查看待播清單'))
    .addSubcommand(sub => sub.setName('panel').setDescription('取得或重建播放器面板'))
    .addSubcommand(sub => sub.setName('stop').setDescription('結束播放並離開語音頻道'))
    .addSubcommand(sub => sub.setName('pause').setDescription('暫停播放'))
    .addSubcommand(sub => sub.setName('resume').setDescription('繼續播放'))
    .addSubcommand(sub => sub.setName('skip').setDescription('下一首（單曲循環也會跳過）'))
    .addSubcommand(sub => sub.setName('previous').setDescription('回到上一首，現在歌曲排到待播首位'))
    .addSubcommand(sub => sub.setName('restart').setDescription('目前歌曲從頭播放'))
    .addSubcommand(sub => sub.setName('seek').setDescription('跳到目前歌曲的指定秒數')
        .addIntegerOption(o => o.setName('seconds').setDescription('從歌曲開頭算起的秒數').setMinValue(0).setRequired(true)))
    .addSubcommand(sub => sub.setName('volume').setDescription('設定播放音量')
        .addIntegerOption(o => o.setName('percent').setDescription('0–100').setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand(sub => sub.setName('repeat').setDescription('設定循環方式')
        .addStringOption(o => o.setName('mode').setDescription('循環方式').setRequired(true)
            .addChoices({ name: '關閉', value: 'off' }, { name: '單曲', value: 'one' }, { name: '佇列', value: 'all' })))
    .addSubcommand(sub => sub.setName('shuffle').setDescription('打亂待播歌曲'))
    .addSubcommand(sub => sub.setName('remove').setDescription('移除待播歌曲（位置見 /music queue）')
        .addIntegerOption(o => o.setName('position').setDescription('待播位置，從 1 開始').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('move').setDescription('調整待播歌曲順序')
        .addIntegerOption(o => o.setName('from').setDescription('原位置').setMinValue(1).setRequired(true))
        .addIntegerOption(o => o.setName('to').setDescription('目標位置').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub.setName('clear').setDescription('清空待播歌曲，保留目前播放'))
    .addSubcommand(sub => sub.setName('reload').setDescription('重新讀取曲庫，預設遠端（所有成員可使用）')
        .addStringOption(option => option.setName('source').setDescription('曲庫來源，預設遠端')
            .addChoices({ name: '遠端曲庫', value: 'remote' }, { name: '本地曲庫', value: 'local' })));


export { execute, handleMusicInteraction, handleMusicInteraction as handleInteraction } from '../../features/music/presentation/commands.js';

export async function loadHandlers(reloadKey: string) {
    const url = new URL('../../features/music/presentation/commands.js', import.meta.url);
    if (import.meta.url.split('?')[0].endsWith('.ts')) url.pathname = url.pathname.replace(/\.js$/, '.ts');
    url.searchParams.set('update', reloadKey);
    const handlers: typeof import('../../features/music/presentation/commands.js') = await import(url.href);
    return { execute: handlers.execute, handleInteraction: handlers.handleMusicInteraction };
}
export function afterReload(): void { browsers.clear(); }
