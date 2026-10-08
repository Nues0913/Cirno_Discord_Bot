import { MessageFlags, type ChatInputCommandInteraction, type Interaction, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { musicLibrary } from '../library/localLibrary.js';
import { getRemoteSong, searchRemoteSongs } from '../library/remoteLibrary.js';
import { isRemoteTrack, trackSource } from '../model/track.js';
import { musicPlayer } from '../playback/player.js';
import { isInteractionResponseUnavailable, logInteractionError } from '../../../shared/discord/interactionErrors.js';

import { findTracks, type MusicSource } from '../application/catalog.js';
import { createBrowser, renderBrowser } from './libraryBrowser.js';
import { browsers } from './browserState.js';
import { playTracks, textChannel, type MusicInteraction } from './playbackActions.js';
const selectedSource = (value: string | null): MusicSource => value === 'remote' ? 'remote' : 'local';
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (!interaction.guildId || !interaction.guild) throw new Error('請在伺服器內使用此指令。');
        const subcommand = interaction.options.getSubcommand();
        if (['pause', 'resume', 'skip', 'previous', 'restart', 'seek', 'volume', 'repeat', 'shuffle'].includes(subcommand)) {
            const action = subcommand === 'pause' ? 'pauseOnly' : subcommand === 'repeat' ? 'repeatMode' : subcommand;
            const value = subcommand === 'seek' ? interaction.options.getInteger('seconds', true)
                : subcommand === 'volume' ? interaction.options.getInteger('percent', true)
                : subcommand === 'repeat' ? interaction.options.getString('mode', true) : undefined;
            await musicPlayer.control(interaction.guildId, interaction.user.id, action, undefined, value);
            await interaction.editReply('已更新播放器。'); return;
        }
        if (subcommand === 'remove' || subcommand === 'move' || subcommand === 'clear') {
            const session = musicPlayer.get(interaction.guildId);
            if (!session) throw new Error('目前沒有播放中的音樂。');
            await musicPlayer.editQueue(interaction.guildId, interaction.user.id, session.id, session.queue.revision, subcommand,
                interaction.options.getInteger(subcommand === 'remove' ? 'position' : 'from') ?? undefined,
                interaction.options.getInteger('to') ?? undefined);
            await interaction.editReply('已更新待播佇列，目前歌曲繼續播放。'); return;
        }
        switch (subcommand) {
            case 'play': {
                const source = selectedSource(interaction.options.getString('source'));
                if (source === 'local') await musicLibrary.load();
                const query = interaction.options.getString('song', true);
                const matches = await findTracks(source, query);
                if (!matches.length) throw new Error('找不到此歌曲，請使用 /music library 查看曲庫。');
                if (matches.length > 1) {
                    await interaction.editReply(await createBrowser(interaction, 'library', query, source, interaction.options.getBoolean('next') ?? false)); return;
                }
                await interaction.editReply({ content: await playTracks(interaction, [matches[0]], interaction.options.getBoolean('next') ?? false), allowedMentions: { parse: [] } }); return;
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
    logInteractionError(error);
    if (isInteractionResponseUnavailable(error)) return;
    const content = error instanceof Error && !(error as { code?: unknown }).code ? error.message : '操作失敗，請稍後再試或檢查 Bot 權限。';
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
        } catch (error) {
            logInteractionError(error);
            if (!isInteractionResponseUnavailable(error) && !interaction.responded) await interaction.respond([]);
        }
        return true;
    }
    if (!(interaction.isButton() || interaction.isStringSelectMenu()) ||
        !(interaction.customId.startsWith('music:') || interaction.customId.startsWith('musicbrowse:'))) return false;
    try {
        if (!interaction.guildId || !interaction.guild) throw new Error('請在伺服器內操作播放器。');
        const [prefix, key, action, generation] = interaction.customId.split(':');
        if (prefix === 'musicbrowse') await handleBrowserInteraction(interaction, key, action);
        else await handlePanelInteraction(interaction, key, action, generation);
    } catch (error) { await reportError(interaction, error); }
    return true;
}

async function handleBrowserInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction, key: string, action: string): Promise<void> {
    if (!interaction.guildId) throw new Error('請在伺服器內操作播放器。');
    browsers.prune();
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
        await interaction.editReply({ content: await playTracks(interaction, [track], browser.next), allowedMentions: { parse: [] } });
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
}
async function handlePanelInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction, key: string, action: string, generation: string): Promise<void> {
    if (!interaction.guildId) throw new Error('請在伺服器內操作播放器。');
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
