import { UserActionError } from '../../../shared/logging/operationErrors.js';
import { musicPlayer } from '../../music/api.js';
import { MessageFlags, type ChatInputCommandInteraction, type Interaction, type ButtonInteraction } from 'discord.js';
import { playlists } from '../store.js';
import { saveTrack } from '../tracks.js';
import { isInteractionResponseUnavailable, logInteractionError } from '../../../shared/discord/interactionErrors.js';
import { renderPlaylist, renderDeleteConfirmation, renderPlaylistList } from './view.js';
import { completePlaylist } from './autocomplete.js';
import { playPlaylist } from './playback.js';
import { addSelectedTrack } from './addTrack.js';

async function report(interaction: ChatInputCommandInteraction | ButtonInteraction, error: unknown) {
    logInteractionError(error);
    if (isInteractionResponseUnavailable(error)) return;
    const content = error instanceof Error && !(error as { code?: unknown }).code
        ? error.message : '操作失敗，請稍後再試；若持續發生請通知管理者。';
    const payload = { content, allowedMentions: { parse: [] as [] } };
    if (interaction.deferred || interaction.replied) await interaction.editReply({ ...payload, embeds: [], components: [] });
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (!interaction.guildId) throw new UserActionError('請在伺服器中使用清單功能。');
        const owner = interaction.user.id;
        const sub = interaction.options.getSubcommand();
        const id = interaction.options.getString('playlist');
        if (sub === 'list') {
            const all = await playlists.list(owner);
            await interaction.editReply(renderPlaylistList(all)); return;
        }
        if (sub === 'create' || sub === 'save') {
            const session = musicPlayer.get(interaction.guildId);
            const entries = sub === 'save' ? [session?.queue.current, ...(session?.queue.pending ?? [])].filter(e => !!e) : [];
            if (sub === 'save' && !entries.length) throw new UserActionError('目前沒有可以儲存的播放佇列。');
            await interaction.editReply(renderPlaylist(await playlists.create(owner, interaction.options.getString('name', true), entries.map(e => saveTrack(e.track))))); return;
        }
        const playlist = await playlists.get(owner, id!);
        switch (sub) {
            case 'show': await interaction.editReply(renderPlaylist(playlist)); return;
            case 'rename': await interaction.editReply(renderPlaylist(await playlists.rename(owner, playlist.id, interaction.options.getString('name', true), playlist.revision))); return;
            case 'delete':
                await interaction.editReply(renderDeleteConfirmation(playlist)); return;
            case 'add': await addSelectedTrack(interaction, playlist); return;
            case 'add-current': {
                const entry = musicPlayer.get(interaction.guildId)?.queue.current;
                if (!entry) throw new UserActionError('目前沒有播放中的歌曲。');
                await interaction.editReply(renderPlaylist(await playlists.add(owner, playlist.id, [saveTrack(entry.track)], playlist.revision))); return;
            }
            case 'remove': await interaction.editReply(renderPlaylist(await playlists.remove(owner, playlist.id, interaction.options.getString('entry', true), playlist.revision))); return;
            case 'move': await interaction.editReply(renderPlaylist(await playlists.move(owner, playlist.id,
                interaction.options.getString('entry', true), interaction.options.getInteger('position', true), playlist.revision))); return;
            case 'play': await playPlaylist(interaction, playlist); return;
        }
    } catch (error) { await report(interaction, error); }
}
export async function handlePlaylistInteraction(interaction: Interaction): Promise<boolean> {
    if (interaction.isAutocomplete() && interaction.commandName === 'playlist') {
        await completePlaylist(interaction);
        return true;
    }
    if (!interaction.isButton() || !interaction.customId.startsWith('playlist:')) return false;
    try {
        const [, action, id, value, owner] = interaction.customId.split(':');
        if (owner !== interaction.user.id) throw new UserActionError('只有清單擁有者可以使用此選單。');
        if (Date.now() - interaction.message.createdTimestamp > 15 * 60_000) throw new UserActionError('選單已逾時，請重新執行指令。');
        await interaction.deferUpdate();
        if (action === 'cancel') { await interaction.editReply({ content: '已取消刪除。', components: [] }); return true; }
        if (action === 'delete') {
            await playlists.delete(owner, id, Number(value));
            await interaction.editReply({ content: '已刪除播放清單。', embeds: [], components: [] });
        } else if (action === 'page' && Number.isInteger(Number(value))) {
            await interaction.editReply(renderPlaylist(await playlists.get(owner, id), Number(value)));
        } else throw new UserActionError('無效的清單操作。');
    } catch (error) { await report(interaction, error); }
    return true;
}
